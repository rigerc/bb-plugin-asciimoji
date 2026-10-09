import { AsyncLocalStorage } from 'node:async_hooks';
import { randomInt, randomUUID, createHash } from 'node:crypto';
import { cliCommand, defineCli, defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { createFaceLibrary, libraryViewSchema, libraryEntrySchema, FaceLibraryError } from './library.js';
import { generateFaceV3, varyFaceV3, CatalogVariationConflictError } from './family-definitions.js';
import { migrateGeneratedV1 } from './migration.js';
import { FACES, FAMILY_IDS, faceValidationError, renderFace, type FaceFamily, generatedFaceSchema, generatedFaceV2Schema, generatedFaceV3Schema, type GeneratedFaceV3, type GeneratedFace } from './faces.js';

const threadIdSchema = z.string().regex(/^thr_[a-zA-Z0-9_-]+$/).max(128);
export const faceSchema = z.string().refine(value => faceValidationError(value) === null,
  'Use a visible face of at most 40 characters on one line, without control or formatting characters.').transform(value => value.trim());
export const familySchema = z.enum(FAMILY_IDS);
export const glyphProfileSchema = z.enum(['unicode', 'ascii']);
type GlyphProfile = z.infer<typeof glyphProfileSchema>;
const generationDefaultsSchema = z.object({ glyphProfile: glyphProfileSchema, glyphProfileOrigin: z.enum(['global','project']), glyphProfileOverride: glyphProfileSchema.nullable() });
export const locksSchema = z.object({ outline: z.boolean().optional(), eyes: z.boolean().optional(), mouth: z.boolean().optional(), accessory: z.boolean().optional() }).strict();
const resemblanceSchema = z.enum(['close', 'wide']);
const effectiveLocksSchema = z.object({ outline: z.boolean(), eyes: z.boolean(), mouth: z.boolean(), accessory: z.boolean() });
const originSchema = z.enum(['global', 'project']);
const projectDefaultSchema = z.object({ family: familySchema, origin: originSchema, override: familySchema.nullable() });
export const generatedSchema = generatedFaceSchema;
const legacyChoice = z.object({ version: z.literal(1), kind: z.literal('generated'), family: familySchema.optional() }).strict();
const generatedChoice = z.object({ version: z.literal(2), kind: z.literal('generated'), seed: z.number().int().min(0).max(2147483647),
  identity: generatedFaceV2Schema }).strict();
export const generatedChoiceV3Schema = z.object({ version: z.literal(3), kind: z.literal('generated'), seed: z.number().int().min(0).max(2147483647), identity: generatedFaceV3Schema, glyphProfile: glyphProfileSchema.optional(), history: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20).optional() }).strict();
const anyGeneratedChoice = z.union([generatedChoice, generatedChoiceV3Schema]);
export const expressionsSchema = z.object({ running: faceSchema.optional(), waiting: faceSchema.optional(), error: faceSchema.optional() }).strict();
const savedFaceSchema = z.object({ face: faceSchema, expressions: expressionsSchema.optional() }).strict();
const customChoice = savedFaceSchema.extend({ version: z.literal(2), kind: z.literal('custom') }).strict();
const librarySchema = libraryViewSchema;
const stateSchema = z.enum(['idle', 'running', 'waiting', 'error']);
export const identitySchema = z.object({ threadId: threadIdSchema, projectId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(128), face: faceSchema,
  source: z.enum(['automatic', 'generated', 'preset', 'custom']), generated: generatedSchema.optional(), glyphProfile: glyphProfileSchema.optional(), expressions: expressionsSchema.optional() }).refine(identity => !identity.generated || !identity.expressions, 'Generated snapshots contain their own expressions');
export type Identity = z.infer<typeof identitySchema>;
export type LibraryFace = z.infer<typeof savedFaceSchema>;
const threadInput = z.object({ threadId: threadIdSchema }).strict();
export const rpcContract = defineRpcContract({
  get: { input: threadInput, output: identitySchema },
  getMany: { input: z.object({ threadIds: z.array(threadIdSchema).max(200) }).strict(), output: z.array(identitySchema) },
  set: { input: threadInput.extend({ face: faceSchema, expressions: expressionsSchema.optional() }), output: identitySchema },
  shuffle: { input: threadInput, output: identitySchema },
  generate: { input: threadInput.extend({ family: familySchema.optional(), glyphProfile: glyphProfileSchema.optional() }), output: identitySchema },
  vary: { input: threadInput.extend({ locks: locksSchema.optional(), resemblance: resemblanceSchema.optional() }), output: identitySchema },
  candidates: { input: threadInput.extend({ locks: locksSchema.optional(), resemblance: resemblanceSchema.optional(), count: z.number().int().min(1).max(6).optional() }), output: z.object({ candidates: z.array(z.object({ token: z.string(), face: faceSchema, generated: generatedFaceV3Schema })).max(6), locks: effectiveLocksSchema, notice: z.string().optional() }) },
  applyCandidate: { input: threadInput.extend({ token: z.string().max(64) }), output: identitySchema },
  previews: { input: threadInput.extend({ glyphProfile: glyphProfileSchema.optional() }), output: z.array(z.object({ family: familySchema, face: faceSchema })) },
  getLibrary: { input: z.object({}).strict(), output: librarySchema },
  favorite: { input: savedFaceSchema.extend({ saved: z.boolean() }).strict(), output: librarySchema },
  favoriteCharacter: { input: threadInput.extend({ saved: z.boolean() }), output: libraryViewSchema },
  removeLibraryEntry: { input: z.object({ entry: libraryEntrySchema }).strict(), output: libraryViewSchema },
  applyLibraryCharacter: { input: threadInput.extend({ snapshotId: z.string().regex(/^[a-f0-9]{64}$/) }), output: identitySchema },
  reviewLibrary: { input: z.object({}).strict(), output: libraryViewSchema },
  reconcileLibrary: { input: z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), keepCurrent: z.literal(true).optional(), add: z.array(z.string().max(1024)).max(50).optional(), remove: z.array(z.string().max(1024)).max(50).optional(), recentAdd: z.array(z.string().max(1024)).max(20).optional(), recentRemove: z.array(z.string().max(1024)).max(20).optional() }).strict(), output: libraryViewSchema },
  activity: { input: z.object({ threadIds: z.array(threadIdSchema).max(200) }).strict(),
    output: z.array(z.object({ threadId: threadIdSchema, state: stateSchema })) },
  getGenerationDefaults: { input: threadInput, output: generationDefaultsSchema },
  setGenerationDefaults: { input: threadInput.extend({ glyphProfile: glyphProfileSchema.nullable().optional() }), output: generationDefaultsSchema },
  getProjectDefault: { input: threadInput, output: projectDefaultSchema },
  setProjectDefault: { input: threadInput.extend({ family: familySchema.nullable() }), output: projectDefaultSchema },
  reset: { input: threadInput, output: identitySchema },
});

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    showHeader: { type: 'boolean', label: 'Show face in thread header', description: 'Show the thread face in the thread header.', default: true },
    showSidebar: { type: 'boolean', label: 'Show faces beside threads in sidebar', description: 'Show a face beside each thread in the sidebar.', default: false },
    showActivity: { type: 'boolean', label: 'Show activity state', description: 'Show running, waiting, and error feedback on faces.', default: true },
    activityStyle: { type: 'select', label: 'Activity presentation', description: 'Expressions change generated faces; markers add a small status symbol.', options: ['expressions', 'markers'], default: 'expressions' },
    useThemeColor: { type: 'boolean', label: 'Use theme accent color', description: 'Color faces with the active theme primary color.', default: false },
    animation: { type: 'select', label: 'Animation style', description: 'Off disables motion; Subtle and Playful animate working faces.', options: ['off', 'subtle', 'playful'], default: 'subtle' },
    sidebarWidth: { type: 'select', label: 'Sidebar face width', description: 'How much horizontal space sidebar faces may use.', options: ['compact', 'standard', 'expanded'], default: 'standard' },
    defaultGlyphProfile: { type: 'select', label: 'Default glyph profile', description: 'Changes following automatic faces; saved choices stay fixed.', options: ['unicode','ascii'], default: 'unicode' },
    defaultFamily: { type: 'select', label: 'Default face family', description: 'Global fallback for projects without an explicit override.', options: [...FAMILY_IDS], default: 'classic' },
  });
  const key = (threadId: string) => `thread:${threadId}`;
  const projectKey = (projectId: string) => `project:${projectId}:family`;
  async function globalFamily(): Promise<FaceFamily> {
    try {
      const values = await settings.get();
      const parsed = familySchema.safeParse((values as Record<string, unknown>).defaultFamily);
      return parsed.success ? parsed.data : 'classic';
    } catch { return 'classic'; }
  }
  async function projectOverride(projectId: string): Promise<FaceFamily | null> {
    const stored = familySchema.safeParse(await bb.storage.kv.get(projectKey(projectId)));
    return stored.success ? stored.data : null;
  }
  async function projectFamily(projectId: string): Promise<FaceFamily> {
    return (await projectOverride(projectId)) ?? (await globalFamily());
  }
  const generationKey = (projectId: string, field: string) => `project:${projectId}:${field}`;
  async function generationDefaults(projectId: string) {
    const values = await settings.get();
    // The retired per-project edition key is ignored; delete it lazily so old
    // project overrides do not linger in storage.
    await bb.storage.kv.delete(generationKey(projectId, 'edition')).catch(() => undefined);
    const glyphProfileOverride = glyphProfileSchema.safeParse(await bb.storage.kv.get(generationKey(projectId, 'glyphProfile')));
    const glyphProfile = glyphProfileOverride.success ? glyphProfileOverride.data : glyphProfileSchema.parse(values.defaultGlyphProfile ?? 'unicode');
    return generationDefaultsSchema.parse({
      glyphProfile,
      glyphProfileOrigin: glyphProfileOverride.success ? 'project' : 'global',
      glyphProfileOverride: glyphProfileOverride.success ? glyphProfileOverride.data : null,
    });
  }
  async function getGenerationDefaults(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    return generationDefaults(thread.projectId);
  }
  async function setGenerationDefaults(threadId: string, request: { glyphProfile?: GlyphProfile | null }) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (request.glyphProfile !== undefined) {
      if (request.glyphProfile === null) await bb.storage.kv.delete(generationKey(thread.projectId, 'glyphProfile'));
      else await bb.storage.kv.set(generationKey(thread.projectId, 'glyphProfile'), request.glyphProfile);
    }
    bb.realtime.publish('changed', { projectId: thread.projectId });
    return generationDefaults(thread.projectId);
  }
  async function getProjectDefault(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    const override = await projectOverride(thread.projectId);
    const effective = override ?? (await globalFamily());
    return { family: effective, origin: (override ? 'project' : 'global') as 'project' | 'global', override };
  }
  async function setProjectDefault(threadId: string, family: FaceFamily | null) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (family === null) await bb.storage.kv.delete(projectKey(thread.projectId));
    else await bb.storage.kv.set(projectKey(thread.projectId), family);
    bb.realtime.publish('changed', { projectId: thread.projectId });
    return getProjectDefault(threadId);
  }
  settings.onChange((next, prev) => {
    const before = (prev as Record<string, unknown>).defaultFamily;
    const after = (next as Record<string, unknown>).defaultFamily;
    if (after !== before || next.defaultGlyphProfile !== prev.defaultGlyphProfile) bb.realtime.publish('changed', { globalDefault: after ?? 'classic' });
  });
  /** Automatic children inherit their parent's eyes, so a parent change can alter
   * their derived faces. Collect automatic descendants for targeted invalidation.
   * Traversal stops at pinned/custom threads: their frozen faces block propagation
   * to deeper generations. Migration snapshots also block propagation. */
  async function findAutomaticDescendants(rootId: string): Promise<string[]> {
    const seen = new Set<string>([rootId]);
    const queue = [{ id: rootId, depth: 0 }];
    const affected: string[] = [];
    let requests = 0;
    for (let index = 0; index < queue.length; index++) {
      const parent = queue[index]!;
      for (const archived of [false, true]) {
        for (let offset = 0; ; offset += 100) {
          if (++requests > 512) throw new Error('Descendant traversal request bound reached');
          const children = await bb.sdk.threads.list({ parentThreadId: parent.id, includeHidden: true, archived, limit: 100, offset });
          for (const child of children) {
            if (seen.has(child.id)) continue;
            if (seen.size >= 2001) throw new Error('Descendant traversal node bound reached');
            seen.add(child.id);
            const stored = await bb.storage.kv.get(key(child.id));
            if (stored !== null && stored !== undefined) continue;
            if (parent.depth >= 64) throw new Error('Descendant traversal depth bound reached');
            if (affected.length >= 200) throw new Error('Descendant invalidation payload bound reached');
            affected.push(child.id);
            queue.push({ id: child.id, depth: parent.depth + 1 });
          }
          if (children.length < 100) break;
        }
      }
    }
    return affected;
  }
  async function notifyChanged(threadId: string) {
    try {
      const affected = await findAutomaticDescendants(threadId);
      bb.realtime.publish('changed', affected.length ? { threadId, affectedThreadIds: affected } : { threadId });
    } catch (error) {
      bb.log.warn(`Asciimoji descendant invalidation failed: ${error instanceof Error ? error.message : String(error)}`);
      const thread = await bb.sdk.threads.get({ threadId });
      bb.realtime.publish('changed', { projectId: thread.projectId });
    }
  }
  async function buildIdentity(threadId: string, family: FaceFamily, seed = 0, ancestors = new Set<string>(), glyphProfile: GlyphProfile = 'unicode'): Promise<GeneratedFace> {
    const thread = await bb.sdk.threads.get({ threadId });
    let inheritedPair: [string, string] | undefined;
    if (thread.parentThreadId && !ancestors.has(thread.parentThreadId) && ancestors.size < 64) {
      try {
        const parent = await get(thread.parentThreadId, new Set([...ancestors, threadId]));
        if (parent.generated && parent.generated.family === family) {
          // Version-2 parents contribute their single eyes value as a symmetric pair.
          inheritedPair = parent.generated.version === 2 ? [parent.generated.eyes, parent.generated.eyes] : parent.generated.eyePair;
        }
      } catch { /* Missing parents do not make the child's face unavailable. */ }
    }
    return generateFaceV3(threadId, family, { seed, inheritedEyes: inheritedPair, glyphProfile });
  }
  async function get(threadId: string, ancestors = new Set<string>()): Promise<Identity> {
    const thread = await bb.sdk.threads.get({ threadId });
    let value = await bb.storage.kv.get(key(threadId));
    const base = { threadId, projectId: thread.projectId };
    if (legacyChoice.safeParse(value).success) {
      const migrate = async () => {
        let observed = await bb.storage.kv.get(key(threadId));
        for (let attempt = 0; attempt < 2; attempt++) {
          const legacy = legacyChoice.safeParse(observed);
          if (!legacy.success) return observed;
          const identity = migrateGeneratedV1(threadId, thread.parentThreadId, legacy.data.family ?? 'classic');
          const latest = await bb.storage.kv.get(key(threadId));
          if (JSON.stringify(latest) !== JSON.stringify(observed)) { observed = latest; continue; }
          assertWritable(threadId);
          const migrated = generatedChoice.parse({ version: 2, kind: 'generated', seed: 0, identity });
          await bb.storage.kv.set(key(threadId), migrated);
          return migrated;
        }
        if (legacyChoice.safeParse(observed).success) throw new Error('Saved face changed during migration; retry the request.');
        return observed;
      };
      // Reads inside this thread's mutation already own its queue. Parent migrations
      // acquire their own queue, and external reads serialize with saves/deletion.
      value = mutationContext.getStore() === threadId ? await migrate() : await mutate(threadId, migrate);
    }
    // Parse the final value: a concurrent writer can replace a v1 recipe with
    // a custom/preset choice while migration is preparing its snapshot.
    const stored = faceSchema.safeParse(value);
    const custom = customChoice.safeParse(value);
    if (stored.success || custom.success) {
      const face = custom.success ? custom.data.face : stored.data!;
      const expressions = custom.success ? custom.data.expressions : undefined;
      return { ...base, face,
        source: !expressions && FACES.some(item => item.face === face) ? 'preset' : 'custom',
        ...(expressions ? { expressions } : {}) };
    }
    const choice = anyGeneratedChoice.safeParse(value);
    const defaults = choice.success ? undefined : await generationDefaults(thread.projectId);
    const glyphProfile = choice.success && choice.data.version === 3 ? choice.data.glyphProfile ?? 'unicode' : defaults?.glyphProfile ?? 'unicode';
    const generated = choice.success ? choice.data.identity
      : await buildIdentity(threadId, await projectFamily(thread.projectId), 0, ancestors, glyphProfile);
    return { ...base, face: renderFace(generated, { glyphProfile }),
      source: choice.success ? 'generated' : 'automatic', generated, ...(generated.version === 3 ? { glyphProfile } : {}) };
  }
  const library = createFaceLibrary(bb.storage.kv, () => bb.realtime.publish('library', {}));
  async function libraryCall<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) { if (error instanceof FaceLibraryError) throw new Error(`${error.code}: ${error.message}`); throw error; }
  }
  const readLibrary = () => libraryCall(() => library.read());
  const remember = (entry: LibraryFace) => libraryCall(() => library.rememberText(entry));
  const favorite = (entry: LibraryFace, saved: boolean) => libraryCall(() => library.favoriteText(entry, saved));
  void library.cleanup().catch(error => bb.log.warn(`Asciimoji library cleanup: ${String(error)}`));
  const mutationContext = new AsyncLocalStorage<string>();
  const mutationQueues = new Map<string, Promise<unknown>>();
  const deletedThreads = new Set<string>();
  let disposed = false;
  function assertWritable(threadId: string) {
    if (disposed || deletedThreads.has(threadId)) throw new Error('THREAD_DELETED: This thread is no longer available.');
  }
  function mutate<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = mutationQueues.get(threadId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => { assertWritable(threadId); return mutationContext.run(threadId, operation); });
    mutationQueues.set(threadId, pending);
    void pending.finally(() => { if (mutationQueues.get(threadId) === pending) mutationQueues.delete(threadId); }).catch(() => undefined);
    return pending;
  }
  const set = (threadId: string, value: string, expressions?: z.infer<typeof expressionsSchema>) => mutate(threadId, () => setUnlocked(threadId, value, expressions));
  const reset = (threadId: string) => mutate(threadId, () => resetUnlocked(threadId));
  const shuffle = (threadId: string) => mutate(threadId, () => shuffleUnlocked(threadId));
  const generate = (threadId: string, family?: FaceFamily, glyphProfile: GlyphProfile = 'unicode') => mutate(threadId, () => generateUnlocked(threadId, family, glyphProfile));
  const vary = (threadId: string, locks?: z.infer<typeof locksSchema>, resemblance?: 'close' | 'wide') => mutate(threadId, () => varyUnlocked(threadId, locks, resemblance));
  async function setUnlocked(threadId: string, value: string, expressions?: z.infer<typeof expressionsSchema>) {
    await bb.sdk.threads.get({ threadId });
    const entry = savedFaceSchema.parse({ face: value, ...(expressions ? { expressions } : {}) });
    const mapped = Object.values(entry.expressions ?? {}).some(Boolean);
    await readLibrary();
    assertWritable(threadId);
    await bb.storage.kv.set(key(threadId), mapped ? { version: 2, kind: 'custom', ...entry } : entry.face);
    await notifyChanged(threadId);
    await remember(mapped ? entry : { face: entry.face });
    return get(threadId);
  }
  async function resetUnlocked(threadId: string) {
    clearTokens(threadId);
    await bb.sdk.threads.get({ threadId });
    await bb.storage.kv.delete(key(threadId));
    await notifyChanged(threadId);
    return get(threadId);
  }
  async function shuffleUnlocked(threadId: string) {
    const current = await get(threadId);
    const choices = FACES.filter(item => item.face !== current.face);
    return setUnlocked(threadId, choices[randomInt(choices.length)]!.face);
  }
  async function generateUnlocked(threadId: string, family?: FaceFamily, glyphProfile: GlyphProfile = 'unicode') {
    const thread = await bb.sdk.threads.get({ threadId });
    const selected = family ?? await projectFamily(thread.projectId);
    return saveGenerated(threadId, await buildIdentity(threadId, selected, 0, new Set(), glyphProfile), 0, glyphProfile);
  }
  async function saveGenerated(threadId: string, identity: GeneratedFace, seed: number, glyphProfile: GlyphProfile = 'unicode') {
    const previous = generatedChoiceV3Schema.safeParse(await bb.storage.kv.get(key(threadId)));
    const history = identity.version === 3 && previous.success
      ? [...new Set([signature(previous.data.identity), ...(previous.data.history ?? [])])].slice(0, 20) : [];
    await readLibrary();
    assertWritable(threadId);
    await bb.storage.kv.set(key(threadId), anyGeneratedChoice.parse({ version: identity.version, kind: 'generated', identity, seed, ...(identity.version === 3 ? { history, glyphProfile } : {}) }));
    await notifyChanged(threadId);
    await libraryCall(() => library.rememberCharacter(identity, identity.version === 3 ? glyphProfile : undefined));
    return get(threadId);
  }
  async function varyUnlocked(threadId: string, locks?: z.infer<typeof locksSchema>, resemblance?: 'close' | 'wide') {
    const current = await get(threadId);
    if (current.generated?.version === 3) {
      const batch = await candidatesUnlocked(threadId, locks, resemblance, 1);
      if (!batch.candidates.length) throw new Error('CANDIDATES_UNAVAILABLE: Relax locks for more choices.');
      return applyCandidateUnlocked(threadId, batch.candidates[0]!.token);
    }
    const family = current.generated?.family ?? (current.generated ? 'classic' : await projectFamily(current.projectId));
    let seed = randomInt(2147483000);
    for (let attempt = 0; attempt < 256; attempt++) {
      seed = (seed + 1) % 2147483648;
      const identity = await buildIdentity(threadId, family, seed);
      if (renderFace(identity) !== current.face) return saveGenerated(threadId, identity, seed);
    }
    throw new Error('Could not find another variation. Try again.');
  }
  type EffectiveLocks = z.infer<typeof effectiveLocksSchema>;
  type TokenEntry = { threadId: string; created: number; context: string; identity: GeneratedFaceV3; glyphProfile: GlyphProfile; seed: number; locks: EffectiveLocks };
  const tokens = new Map<string, TokenEntry>();
  const signature = (identity: GeneratedFaceV3) => createHash('sha256').update(JSON.stringify({
    family: identity.family, personality: identity.personality, outline: identity.outline, eyePair: identity.eyePair,
    mouth: identity.mouth, accessory: identity.accessory, layers: identity.layers,
  })).digest('hex');
  const clearTokens = (threadId: string) => { for (const [token, entry] of tokens) if (entry.threadId === threadId) tokens.delete(token); };
  function pruneTokens() {
    const now = Date.now();
    for (const [token, entry] of tokens) if (now - entry.created >= 300000) tokens.delete(token);
  }
  async function candidateContext(threadId: string) {
    const current = await get(threadId);
    if (current.generated?.version !== 3) throw new Error('CANDIDATES_UNAVAILABLE: Generate a character first.');
    const thread = await bb.sdk.threads.get({ threadId });
    const parent = thread.parentThreadId ? await get(thread.parentThreadId).catch(() => undefined) : undefined;
    const stored = await bb.storage.kv.get(key(threadId));
    const saved = generatedChoiceV3Schema.safeParse(stored);
    const parentPair = parent?.generated?.family === current.generated.family
      ? parent.generated.version === 3 ? parent.generated.eyePair : [parent.generated.eyes, parent.generated.eyes] : undefined;
    const inherited = parentPair && JSON.stringify(parentPair) === JSON.stringify(current.generated.eyePair);
    const fingerprint = createHash('sha256').update(JSON.stringify({ stored, current, parent, defaults: await getProjectDefault(threadId), generationDefaults: await getGenerationDefaults(threadId) })).digest('hex');
    return { current, identity: current.generated, fingerprint, inherited: !!inherited, history: saved.success ? saved.data.history ?? [] : [] };
  }
  async function candidatesUnlocked(threadId: string, requested: z.infer<typeof locksSchema> = {}, resemblance: 'close' | 'wide' = 'close', count = 6) {
    assertWritable(threadId);
    pruneTokens();
    const context = await candidateContext(threadId);
    const locks = { outline: requested.outline ?? false, eyes: requested.eyes ?? context.inherited, mouth: requested.mouth ?? false, accessory: requested.accessory ?? false };
    const excluded = new Set([signature(context.identity), ...context.history]);
    const results: Array<{ token: string; face: string; generated: GeneratedFaceV3 }> = [];
    let seed = randomInt(2147483000);
    for (let attempts = 0; attempts < 256 && results.length < count; attempts++) {
      seed = (seed + 1) % 2147483648;
      let identity: GeneratedFaceV3;
      try { identity = varyFaceV3(context.identity, seed, { threadId, locks, resemblance, glyphProfile: context.current.glyphProfile }); }
      catch (error) { if (error instanceof CatalogVariationConflictError) continue; throw error; }
      const mark = signature(identity);
      if (excluded.has(mark)) continue;
      excluded.add(mark);
      while ([...tokens.values()].filter(value => value.threadId === threadId).length >= 12) {
        const oldest = [...tokens].find(([, entry]) => entry.threadId === threadId);
        if (oldest) tokens.delete(oldest[0]); else break;
      }
      while (tokens.size >= 1200) tokens.delete(tokens.keys().next().value!);
      const token = randomUUID();
      tokens.set(token, { threadId, created: Date.now(), context: context.fingerprint, identity, seed, locks, glyphProfile: context.current.glyphProfile ?? 'unicode' });
      results.push({ token, face: renderFace(identity, { glyphProfile: context.current.glyphProfile }), generated: identity });
    }
    return { candidates: results, locks, ...(results.length < count ? { notice: 'Only these distinct choices fit your locks. Relax Outline, Eyes, Mouth, or Accessories for more choices.' } : {}) };
  }
  async function applyCandidateUnlocked(threadId: string, token: string) {
    pruneTokens();
    const entry = tokens.get(token);
    if (!entry || entry.threadId !== threadId) throw new Error('PREVIEW_EXPIRED: Refresh previews before saving.');
    let context: Awaited<ReturnType<typeof candidateContext>>;
    try { context = await candidateContext(threadId); }
    catch { tokens.delete(token); throw new Error('PREVIEW_EXPIRED: Character context changed. Refresh previews.'); }
    if (context.fingerprint !== entry.context) { tokens.delete(token); throw new Error('PREVIEW_EXPIRED: Character or inherited defaults changed. Refresh previews.'); }
    const result = await saveGenerated(threadId, entry.identity, entry.seed, entry.glyphProfile);
    tokens.delete(token);
    return result;
  }
  // Read authoritative state instead of retaining ephemeral activity across reloads.
  async function activity(threadId: string) {
    const [thread, interactions] = await Promise.all([
      bb.sdk.threads.get({ threadId }), bb.sdk.threads.interactions.list({ threadId }),
    ]);
    const state = interactions.some(interaction => interaction.status === 'pending') ? 'waiting'
      : thread.status === 'error' ? 'error'
      : ['active', 'starting', 'stopping'].includes(thread.status) ? 'running' : 'idle';
    return { threadId, state: stateSchema.parse(state) };
  }
  for (const event of ['thread.active', 'thread.idle', 'thread.failed', 'interaction.pending', 'experimental_thread.events'] as const) {
    bb.events.on(event, ({ thread }) => bb.realtime.publish('activity', { threadId: thread.id }));
  }
  bb.rpc.register(rpcContract, {
    candidates: ({ threadId, locks, resemblance, count }) => mutate(threadId, () => candidatesUnlocked(threadId, locks, resemblance, count)),
    applyCandidate: ({ threadId, token }) => mutate(threadId, () => applyCandidateUnlocked(threadId, token)),
    vary: ({ threadId, locks, resemblance }) => vary(threadId, locks, resemblance),
    previews: async ({ threadId, glyphProfile }) => Promise.all(FAMILY_IDS.map(async family => ({ family, face: renderFace(await buildIdentity(threadId, family, 0, new Set(), glyphProfile), { glyphProfile }) }))),
    getLibrary: () => readLibrary(),
    favoriteCharacter: async ({ threadId, saved }) => {
      const value = await get(threadId);
      if (!value.generated) throw new Error('CHARACTER_UNAVAILABLE: Generate a character before saving it.');
      return libraryCall(() => library.favoriteCharacter(value.generated!, saved, value.glyphProfile));
    },
    removeLibraryEntry: ({ entry }) => libraryCall(() => library.remove(entry)),
    applyLibraryCharacter: ({ threadId, snapshotId }) => mutate(threadId, async () => {
      const snapshot = await libraryCall(() => library.resolve(snapshotId));
      return saveGenerated(threadId, snapshot.identity, 0, snapshot.glyphProfile);
    }),
    reviewLibrary: () => readLibrary(),
    reconcileLibrary: request => libraryCall(() => library.reconcile(request)),
    favorite: ({ face, expressions, saved }) => favorite(savedFaceSchema.parse({ face, ...(expressions ? { expressions } : {}) }), saved),
    generate: ({ threadId, family, glyphProfile }) => generate(threadId, family, glyphProfile),
    getGenerationDefaults: ({ threadId }) => getGenerationDefaults(threadId),
    setGenerationDefaults: ({ threadId, ...request }) => setGenerationDefaults(threadId, request),
    getProjectDefault: ({ threadId }) => getProjectDefault(threadId),
    setProjectDefault: ({ threadId, family }) => setProjectDefault(threadId, family),
    activity: async ({ threadIds }) => {
      const results = await Promise.allSettled([...new Set(threadIds)].map(activity));
      return results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    },
    get: ({ threadId }) => get(threadId),
    getMany: async ({ threadIds }) => {
      const results = await Promise.allSettled([...new Set(threadIds)].map(id => get(id)));
      return results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    },
    set: ({ threadId, face, expressions }) => set(threadId, face, expressions),
    shuffle: ({ threadId }) => shuffle(threadId),
    reset: ({ threadId }) => reset(threadId),
  });
  bb.events.on('thread.deleted', async ({ thread }) => {
    deletedThreads.add(thread.id);
    clearTokens(thread.id);
    await (mutationQueues.get(thread.id) ?? Promise.resolve()).catch(() => undefined);
    await bb.storage.kv.delete(key(thread.id));
    deletedThreads.delete(thread.id);
  });
  bb.onDispose(() => { disposed = true; tokens.clear(); deletedThreads.clear(); mutationQueues.clear(); });
  const options = {
    thread: { type: 'string', description: 'Thread id; defaults to the current thread' },
    json: { type: 'boolean', description: 'Emit JSON' },
  } as const;
  const target = (value: string | undefined, current: string | undefined) => {
    if (!value && !current) throw new Error('Supply --thread thr_... when running outside a BB thread.');
    return threadIdSchema.parse(value ?? current);
  };
  const reply = (value: Awaited<ReturnType<typeof get>>, json: boolean | undefined) => ({
    exitCode: 0, stdout: json ? JSON.stringify(value) : `${value.face}  ${value.threadId}`,
  });
  bb.cli.register(defineCli({
    name: 'asciimoji', summary: 'Personalize threads with a persistent asciimoji',
    commands: {
      get: cliCommand({ summary: 'Show a thread’s face', options, async run(input, ctx) {
        return reply(await get(target(input.options.thread, ctx.threadId)), input.options.json);
      } }),
      set: cliCommand({ summary: 'Save a custom face and optional activity expressions',
        options: { ...options, running: { type: 'string', description: 'Face while running' }, waiting: { type: 'string', description: 'Face while waiting' }, error: { type: 'string', description: 'Face on error' } },
        positionals: [{ name: 'face', description: 'Quoted asciimoji', required: true }],
        async run(input, ctx) {
          const expressions = expressionsSchema.parse({
            ...(input.options.running !== undefined ? { running: input.options.running } : {}),
            ...(input.options.waiting !== undefined ? { waiting: input.options.waiting } : {}),
            ...(input.options.error !== undefined ? { error: input.options.error } : {}),
          });
          return reply(await set(target(input.options.thread, ctx.threadId), input.positionals.face, expressions), input.options.json);
        } }),
      shuffle: cliCommand({ summary: 'Choose a different preset', options, async run(input, ctx) {
        return reply(await shuffle(target(input.options.thread, ctx.threadId)), input.options.json);
      } }),
      generate: cliCommand({ summary: 'Save a deterministic generated face', options: { ...options, family: { type: 'string', description: 'classic, bear, robot, cat, or minimal' }, 'glyph-profile': { type: 'string', description: 'unicode or ascii (default unicode)' } }, async run(input, ctx) {
        return reply(await generate(target(input.options.thread, ctx.threadId), input.options.family === undefined ? undefined : familySchema.parse(input.options.family), input.options['glyph-profile'] === undefined ? undefined : glyphProfileSchema.parse(input.options['glyph-profile'])), input.options.json);
      } }),
      vary: cliCommand({ summary: 'Save another variation in the current family', options: { ...options, 'lock-outline': { type: 'boolean', description: 'Preserve the outline' }, 'lock-eyes': { type: 'boolean', description: 'Preserve the whole eye pair' }, 'unlock-eyes': { type: 'boolean', description: 'Allow a new eye pair' }, 'lock-mouth': { type: 'boolean', description: 'Preserve the mouth' }, 'lock-accessory': { type: 'boolean', description: 'Preserve all accessories and layers' }, resemblance: { type: 'string', description: 'close or wide' } }, async run(input, ctx) {
        return reply(await vary(target(input.options.thread, ctx.threadId), { outline: input.options['lock-outline'], eyes: input.options['unlock-eyes'] ? false : input.options['lock-eyes'], mouth: input.options['lock-mouth'], accessory: input.options['lock-accessory'] }, input.options.resemblance === undefined ? undefined : resemblanceSchema.parse(input.options.resemblance)), input.options.json);
      } }),
      library: cliCommand({ summary: 'List favorite and recent faces', options: { json: options.json }, async run(input) {
        const library = await readLibrary();
        return { exitCode: 0, stdout: input.options.json ? JSON.stringify(library)
          : 'Favorites:\n' + library.favorites.map(item => item.face).join('\n') + '\nRecent:\n' + library.recent.map(item => item.face).join('\n') };
      } }),
      favorite: cliCommand({ summary: 'Save or remove the current face in favorites', options: { ...options, character: { type: 'boolean', description: 'Save the complete generated character' }, remove: { type: 'boolean', description: 'Remove this favorite' } }, async run(input, ctx) {
        const identity = await get(target(input.options.thread, ctx.threadId));
        if (input.options.character && !identity.generated) throw new Error('CHARACTER_UNAVAILABLE: Generate a character before saving it.');
        const value = input.options.character && identity.generated
          ? await libraryCall(() => library.favoriteCharacter(identity.generated!, !input.options.remove, identity.glyphProfile))
          : await favorite({ face: identity.face, ...(identity.expressions ? { expressions: identity.expressions } : {}) }, !input.options.remove);
        return { exitCode: 0, stdout: input.options.json ? JSON.stringify(value) : input.options.remove ? 'Favorite removed' : 'Favorite saved' };
      } }),
      'project-default': cliCommand({ summary: 'Show or set this thread’s project face family', options,
        positionals: [{ name: 'family', description: 'classic, bear, robot, cat, minimal, or inherit', required: false }],
        async run(input, ctx) {
          const threadId = target(input.options.thread, ctx.threadId);
          const raw = input.positionals.family;
          const value = raw === undefined ? await getProjectDefault(threadId)
            : raw === 'inherit' ? await setProjectDefault(threadId, null)
            : await setProjectDefault(threadId, familySchema.parse(raw));
          return { exitCode: 0, stdout: input.options.json ? JSON.stringify(value) : value.family };
        } }),
      reset: cliCommand({ summary: 'Restore the automatic face', options, async run(input, ctx) {
        return reply(await reset(target(input.options.thread, ctx.threadId)), input.options.json);
      } }),
    },
  }));
}
