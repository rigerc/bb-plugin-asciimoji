import { randomInt } from 'node:crypto';
import { cliCommand, defineCli, defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { FACES, FAMILY_IDS, faceValidationError, generateFace, generateFaceV2, renderFace, type FaceFamily, type GeneratedFace } from './faces.js';

const threadIdSchema = z.string().regex(/^thr_[a-zA-Z0-9_-]+$/).max(128);
export const faceSchema = z.string().refine(value => faceValidationError(value) === null,
  'Use a visible face of at most 40 characters on one line, without control or formatting characters.').transform(value => value.trim());
export const familySchema = z.enum(FAMILY_IDS);
const originSchema = z.enum(['global', 'project']);
const projectDefaultSchema = z.object({ family: familySchema, origin: originSchema, override: familySchema.nullable() });
const generatedSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), family: familySchema.optional(), ears: z.tuple([z.string().length(1), z.string().length(1)]),
  eyes: z.string().length(1), mouth: z.string().length(1), blinkOffset: z.number().int().min(0).max(3999), accessory: z.string().length(1).optional(),
});
const legacyChoice = z.object({ version: z.literal(1), kind: z.literal('generated'), family: familySchema.optional() }).strict();
const generatedChoice = z.object({ version: z.literal(2), kind: z.literal('generated'), seed: z.number().int().min(0).max(2147483647),
  identity: generatedSchema.extend({ version: z.literal(2), family: familySchema }) }).strict();
export const expressionsSchema = z.object({ running: faceSchema.optional(), waiting: faceSchema.optional(), error: faceSchema.optional() }).strict();
const savedFaceSchema = z.object({ face: faceSchema, expressions: expressionsSchema.optional() }).strict();
const customChoice = savedFaceSchema.extend({ version: z.literal(2), kind: z.literal('custom') }).strict();
const librarySchema = z.object({ favorites: z.array(savedFaceSchema).max(50), recent: z.array(savedFaceSchema).max(20) });
const stateSchema = z.enum(['idle', 'running', 'waiting', 'error']);
const identitySchema = z.object({ threadId: threadIdSchema, projectId: z.string(), face: faceSchema, custom: z.boolean(),
  source: z.enum(['automatic', 'generated', 'preset', 'custom']), generated: generatedSchema.optional(), expressions: expressionsSchema.optional() });
export type Identity = z.infer<typeof identitySchema>;
export type LibraryFace = z.infer<typeof savedFaceSchema>;
const threadInput = z.object({ threadId: threadIdSchema }).strict();
export const rpcContract = defineRpcContract({
  get: { input: threadInput, output: identitySchema },
  getMany: { input: z.object({ threadIds: z.array(threadIdSchema).max(200) }).strict(), output: z.array(identitySchema) },
  set: { input: threadInput.extend({ face: faceSchema, expressions: expressionsSchema.optional() }), output: identitySchema },
  shuffle: { input: threadInput, output: identitySchema },
  generate: { input: threadInput.extend({ family: familySchema.optional() }), output: identitySchema },
  vary: { input: threadInput, output: identitySchema },
  previews: { input: threadInput, output: z.array(z.object({ family: familySchema, face: faceSchema })) },
  getLibrary: { input: z.object({}).strict(), output: librarySchema },
  favorite: { input: savedFaceSchema.extend({ saved: z.boolean() }).strict(), output: librarySchema },
  activity: { input: z.object({ threadIds: z.array(threadIdSchema).max(200) }).strict(),
    output: z.array(z.object({ threadId: threadIdSchema, state: stateSchema })) },
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
    if (after !== before) bb.realtime.publish('changed', { globalDefault: after ?? 'classic' });
  });
  /** Automatic children inherit their parent's eyes, so a parent change can alter
   * their derived faces. Collect automatic descendants for targeted invalidation.
   * Traversal stops at pinned/custom threads: their frozen faces block propagation
   * to deeper generations (legacy v1 children hash the parent id, not its eyes,
   * so they are also unaffected and excluded via their stored value). */
  async function findAutomaticDescendants(rootId: string): Promise<string[]> {
    const seen = new Set<string>([rootId]);
    const queue = [rootId];
    const affected: string[] = [];
    for (let depth = 0; depth < 64 && queue.length > 0; depth++) {
      const parentId = queue.shift()!;
      let children: Array<{ id?: unknown }> = [];
      try {
        const list = await (bb.sdk.threads as { list?: (args: unknown) => Promise<unknown> }).list?.({ parentThreadId: parentId });
        children = Array.isArray(list) ? list as Array<{ id?: unknown }> : [];
      } catch { break; }
      for (const child of children) {
        if (typeof child?.id !== 'string' || seen.has(child.id)) continue;
        seen.add(child.id);
        let stored: unknown;
        try { stored = await bb.storage.kv.get(key(child.id)); }
        catch { continue; }
        // Any stored value (preset text, custom map, pinned v2, legacy v1)
        // freezes the face, so it neither changes nor propagates further.
        if (stored !== null && stored !== undefined) continue;
        affected.push(child.id);
        queue.push(child.id);
        if (affected.length >= 200) return affected;
      }
    }
    return affected;
  }
  async function notifyChanged(threadId: string) {
    let affected: string[] = [];
    try { affected = await findAutomaticDescendants(threadId); }
    catch { affected = []; }
    bb.realtime.publish('changed', affected.length ? { threadId, affectedThreadIds: affected } : { threadId });
  }
  async function buildIdentity(threadId: string, family: FaceFamily, seed = 0, ancestors = new Set<string>()): Promise<GeneratedFace> {
    const thread = await bb.sdk.threads.get({ threadId });
    let inheritedEyes: string | undefined;
    if (thread.parentThreadId && !ancestors.has(thread.parentThreadId) && ancestors.size < 64) {
      try {
        const parent = await get(thread.parentThreadId, new Set([...ancestors, threadId]));
        if (parent.generated && (parent.generated.family ?? 'classic') === family) inheritedEyes = parent.generated.eyes;
      } catch { /* Missing parents do not make the child's face unavailable. */ }
    }
    return generateFaceV2(threadId, family, { seed, inheritedEyes });
  }
  async function get(threadId: string, ancestors = new Set<string>()): Promise<Identity> {
    const thread = await bb.sdk.threads.get({ threadId });
    const value = await bb.storage.kv.get(key(threadId));
    const stored = faceSchema.safeParse(value);
    const custom = customChoice.safeParse(value);
    const base = { threadId, projectId: thread.projectId };
    if (stored.success || custom.success) {
      const face = custom.success ? custom.data.face : stored.data!;
      const expressions = custom.success ? custom.data.expressions : undefined;
      return { ...base, face, custom: true,
        source: !expressions && FACES.some(item => item.face === face) ? 'preset' : 'custom',
        ...(expressions ? { expressions } : {}) };
    }
    const choice = generatedChoice.safeParse(value);
    const legacy = legacyChoice.safeParse(value);
    const generated = choice.success ? choice.data.identity : legacy.success
      ? generateFace(threadId, thread.parentThreadId, legacy.data.family ?? 'classic')
      : await buildIdentity(threadId, await projectFamily(thread.projectId), 0, ancestors);
    return { ...base, face: renderFace(generated), custom: choice.success || legacy.success,
      source: choice.success || legacy.success ? 'generated' : 'automatic', generated };
  }
  let libraryQueue: Promise<unknown> = Promise.resolve();
  const entryKey = (entry: LibraryFace) => JSON.stringify([entry.face, entry.expressions?.running, entry.expressions?.waiting, entry.expressions?.error]);
  async function readLibrary() {
    const stored = librarySchema.safeParse(await bb.storage.kv.get('library'));
    return stored.success ? stored.data : { favorites: [], recent: [] };
  }
  function updateLibrary(update: (library: z.infer<typeof librarySchema>) => void) {
    const operation = libraryQueue.then(async () => {
      const library = await readLibrary();
      update(library);
      await bb.storage.kv.set('library', librarySchema.parse(library));
      bb.realtime.publish('library', {});
      return library;
    });
    libraryQueue = operation.catch(() => {});
    return operation;
  }
  const remember = (entry: LibraryFace) => updateLibrary(library => {
    library.recent = [entry, ...library.recent.filter(item => entryKey(item) !== entryKey(entry))].slice(0, 20);
  });
  const favorite = (entry: LibraryFace, saved: boolean) => updateLibrary(library => {
    const remaining = library.favorites.filter(item => entryKey(item) !== entryKey(entry));
    if (saved && remaining.length >= 50) throw new Error('Your library holds 50 favorites. Remove one before adding another.');
    library.favorites = saved ? [entry, ...remaining] : remaining;
  });
  async function set(threadId: string, value: string, expressions?: z.infer<typeof expressionsSchema>) {
    await bb.sdk.threads.get({ threadId });
    const entry = savedFaceSchema.parse({ face: value, ...(expressions ? { expressions } : {}) });
    const mapped = Object.values(entry.expressions ?? {}).some(Boolean);
    await bb.storage.kv.set(key(threadId), mapped ? { version: 2, kind: 'custom', ...entry } : entry.face);
    await notifyChanged(threadId);
    await remember(mapped ? entry : { face: entry.face });
    return get(threadId);
  }
  async function reset(threadId: string) {
    await bb.sdk.threads.get({ threadId });
    await bb.storage.kv.delete(key(threadId));
    await notifyChanged(threadId);
    return get(threadId);
  }
  async function shuffle(threadId: string) {
    const current = await get(threadId);
    const choices = FACES.filter(item => item.face !== current.face);
    return set(threadId, choices[randomInt(choices.length)]!.face);
  }
  async function generate(threadId: string, family?: FaceFamily) {
    const thread = await bb.sdk.threads.get({ threadId });
    const selected = family ?? await projectFamily(thread.projectId);
    return saveGenerated(threadId, await buildIdentity(threadId, selected), 0);
  }
  async function saveGenerated(threadId: string, identity: GeneratedFace, seed: number) {
    await bb.storage.kv.set(key(threadId), generatedChoice.parse({ version: 2, kind: 'generated', identity, seed }));
    await notifyChanged(threadId);
    await remember({ face: renderFace(identity) });
    return get(threadId);
  }
  async function vary(threadId: string) {
    const current = await get(threadId);
    const family = current.generated?.family ?? (current.generated ? 'classic' : await projectFamily(current.projectId));
    let seed = randomInt(2147483000);
    for (let attempt = 0; attempt < 256; attempt++) {
      seed = (seed + 1) % 2147483648;
      const identity = await buildIdentity(threadId, family, seed);
      if (renderFace(identity) !== current.face) return saveGenerated(threadId, identity, seed);
    }
    throw new Error('Could not find another variation. Try again.');
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
    vary: ({ threadId }) => vary(threadId),
    previews: async ({ threadId }) => Promise.all(FAMILY_IDS.map(async family => ({ family, face: renderFace(await buildIdentity(threadId, family)) }))),
    getLibrary: async () => { await libraryQueue; return readLibrary(); },
    favorite: ({ face, expressions, saved }) => favorite(savedFaceSchema.parse({ face, ...(expressions ? { expressions } : {}) }), saved),
    generate: ({ threadId, family }) => generate(threadId, family),
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
    await bb.storage.kv.delete(key(thread.id));
  });
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
      generate: cliCommand({ summary: 'Save a deterministic generated face', options: { ...options, family: { type: 'string', description: 'classic, bear, robot, cat, or minimal' } }, async run(input, ctx) {
        return reply(await generate(target(input.options.thread, ctx.threadId), input.options.family === undefined ? undefined : familySchema.parse(input.options.family)), input.options.json);
      } }),
      vary: cliCommand({ summary: 'Save another variation in the current family', options, async run(input, ctx) {
        return reply(await vary(target(input.options.thread, ctx.threadId)), input.options.json);
      } }),
      library: cliCommand({ summary: 'List favorite and recent faces', options: { json: options.json }, async run(input) {
        await libraryQueue;
        const library = await readLibrary();
        return { exitCode: 0, stdout: input.options.json ? JSON.stringify(library)
          : 'Favorites:\n' + library.favorites.map(item => item.face).join('\n') + '\nRecent:\n' + library.recent.map(item => item.face).join('\n') };
      } }),
      favorite: cliCommand({ summary: 'Save or remove the current face in favorites', options: { ...options, remove: { type: 'boolean', description: 'Remove this favorite' } }, async run(input, ctx) {
        const identity = await get(target(input.options.thread, ctx.threadId));
        const library = await favorite({ face: identity.face, ...(identity.expressions ? { expressions: identity.expressions } : {}) }, !input.options.remove);
        return { exitCode: 0, stdout: input.options.json ? JSON.stringify(library) : input.options.remove ? 'Favorite removed' : 'Favorite saved' };
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
