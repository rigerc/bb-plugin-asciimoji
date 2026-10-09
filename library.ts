import { createHash } from 'node:crypto';
import { z } from 'zod';
import { faceValidationError, generatedFaceSchema, renderFace, type GeneratedFace } from './faces.js';
import { libraryEntryKey } from './library-shared.js';
export { libraryEntryKey } from './library-shared.js';

const faceText = z.string().refine(value => faceValidationError(value) === null).transform(value => value.trim());
const expressions = z.object({ running: faceText.optional(), waiting: faceText.optional(), error: faceText.optional() }).strict();
export const textEntrySchema = z.object({ kind: z.literal('text'), face: faceText, expressions: expressions.optional() }).strict();
export const characterEntrySchema = z.object({ kind: z.literal('generated'), face: faceText,
  snapshotId: z.string().regex(/^[a-f0-9]{64}$/), glyphProfile: z.enum(['unicode', 'ascii']).optional() }).strict();
export const libraryEntrySchema = z.discriminatedUnion('kind', [textEntrySchema, characterEntrySchema]);
export type LibraryEntry = z.infer<typeof libraryEntrySchema>;
export type TextEntry = z.infer<typeof textEntrySchema>;
export type CharacterEntry = z.infer<typeof characterEntrySchema>;
const legacyEntrySchema = textEntrySchema.omit({ kind: true });
const legacySchema = z.object({ favorites: z.array(legacyEntrySchema).max(50), recent: z.array(legacyEntrySchema).max(20) }).strict();
const entriesShape = { favorites: z.array(libraryEntrySchema).max(50), recent: z.array(libraryEntrySchema).max(20) };
const changesSchema = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), added: z.array(textEntrySchema).max(50), removed: z.array(textEntrySchema).max(50),
  recentAdded: z.array(textEntrySchema).max(20).optional(), recentRemoved: z.array(textEntrySchema).max(20).optional() }).strict();
export const libraryViewSchema = z.object({ ...entriesShape, legacyChanges: changesSchema.optional(), projectionPending: z.boolean().optional() }).strict();
export type LibraryView = z.infer<typeof libraryViewSchema>;
const indexSchema = z.object({ version: z.literal(2), ...entriesShape,
  legacyProjectionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  pendingProjectionFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
type Index = z.infer<typeof indexSchema>;
const blobSchema = z.object({ version: z.literal(1), identity: generatedFaceSchema,
  glyphProfile: z.enum(['unicode', 'ascii']).optional() }).strict();
const pendingSchema = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), legacy: legacySchema }).strict();
interface Kv { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown>; delete(key: string): Promise<unknown>; list(prefix?: string): Promise<string[]>; }
export class FaceLibraryError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
/** Content-addressing uses canonical JSON so object insertion order is irrelevant. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
const fingerprint = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const bound = <T>(value: T, max = 192 * 1024): T => {
  if (Buffer.byteLength(JSON.stringify(value)) > max) throw new FaceLibraryError('LIBRARY_TOO_LARGE', 'The face library exceeds its storage budget.');
  return value;
};
const textKey = (entry: z.infer<typeof legacyEntrySchema>) => libraryEntryKey({ kind: 'text', ...entry });
function projection(index: Pick<Index, 'favorites' | 'recent'>): z.infer<typeof legacySchema> {
  const project = (entries: LibraryEntry[]) => {
    const seen = new Set<string>();
    return entries.flatMap(entry => {
      const text = { face: entry.face, ...(entry.kind === 'text' && entry.expressions ? { expressions: entry.expressions } : {}) };
      const key = textKey(text);
      if (seen.has(key)) return [];
      seen.add(key); return [text];
    });
  };
  return legacySchema.parse({ favorites: project(index.favorites), recent: project(index.recent) });
}

/** One active plugin factory owns this queue. It does not provide distributed locks. */
export function createFaceLibrary(kv: Kv, publish: () => void = () => {}) {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work); queue = next.catch(() => {}); return next;
  };
  async function legacy() {
    const raw = await kv.get('library');
    if (raw === null || raw === undefined) return { favorites: [], recent: [] } as z.infer<typeof legacySchema>;
    const parsed = legacySchema.safeParse(raw);
    if (!parsed.success) throw new FaceLibraryError('LEGACY_LIBRARY_INVALID', 'The older text library is unreadable. Its data has been preserved.');
    return parsed.data;
  }
  async function readState() {
    const old = await legacy(); const observed = fingerprint(old);
    const raw = await kv.get('library:v2');
    if (raw === undefined || raw === null) return { index: indexSchema.parse({ version: 2,
      favorites: old.favorites.map(entry => ({ kind: 'text', ...entry })), recent: old.recent.map(entry => ({ kind: 'text', ...entry })),
      legacyProjectionFingerprint: observed }), mismatch: false, old, observed };
    const parsed = indexSchema.safeParse(raw);
    if (!parsed.success) throw new FaceLibraryError('LIBRARY_INVALID', 'The saved character library is unreadable or from a newer version. Its data has been preserved.');
    const index = parsed.data;
    // Recover an interrupted metadata write only if the projection matches the exact intended content.
    if (index.pendingProjectionFingerprint === observed) {
      index.legacyProjectionFingerprint = observed; delete index.pendingProjectionFingerprint;
      await kv.set('library:v2', bound(index));
    }
    const mismatch = observed !== index.legacyProjectionFingerprint;
    if (mismatch) {
      await kv.set('library:legacy-pending', bound(pendingSchema.parse({ fingerprint: observed, legacy: old })));
    }
    return { index, mismatch, old, observed };
  }
  type State = Awaited<ReturnType<typeof readState>>;
  function view(state: State): LibraryView {
    const { index, old, mismatch, observed } = state;
    const result: LibraryView = { favorites: index.favorites, recent: index.recent };
    if (index.pendingProjectionFingerprint) result.projectionPending = true;
    if (mismatch) {
      const projected = projection(index);
      const expected = projected.favorites;
      const actualKeys = new Set(old.favorites.map(textKey));
      const expectedKeys = new Set(expected.map(textKey));
      const actualRecent = new Set(old.recent.map(textKey));
      const expectedRecent = new Set(projected.recent.map(textKey));
      result.legacyChanges = { fingerprint: observed,
        added: old.favorites.filter(entry => !expectedKeys.has(textKey(entry))).map(entry => ({ kind: 'text', ...entry })),
        removed: expected.filter(entry => !actualKeys.has(textKey(entry))).map(entry => ({ kind: 'text', ...entry })),
        recentAdded: old.recent.filter(entry => !expectedRecent.has(textKey(entry))).map(entry => ({ kind: 'text', ...entry })),
        recentRemoved: projected.recent.filter(entry => !actualRecent.has(textKey(entry))).map(entry => ({ kind: 'text', ...entry })) };
    }
    return libraryViewSchema.parse(result);
  }
  async function sweep(index: Index) {
    const referenced = new Set([...index.favorites, ...index.recent].flatMap(entry => entry.kind === 'generated' ? [entry.snapshotId] : []));
    // Read and validate again before deleting: a corrupt/future index must never trigger cleanup.
    const current = indexSchema.safeParse(await kv.get('library:v2'));
    if (!current.success || fingerprint(current.data) !== fingerprint(index)) return;
    let deleted = 0;
    for (const key of await kv.list('library:snapshot:')) {
      if (!referenced.has(key.slice('library:snapshot:'.length)) && deleted < 100) { await kv.delete(key); deleted++; }
    }
  }
  async function persist(state: State, resolving = false) {
    // Observe old windows immediately before each commit, not only when opening the picker.
    const latest = await legacy(); const latestHash = fingerprint(latest);
    if (latestHash !== state.observed) {
      state.old = latest; state.observed = latestHash; state.mismatch = latestHash !== state.index.legacyProjectionFingerprint;
      if (resolving) {
        await kv.set('library:legacy-pending', bound({ fingerprint: latestHash, legacy: latest }));
        throw new FaceLibraryError('LEGACY_REVIEW_STALE', 'The older window changed the library again. Refresh the review.');
      }
    }
    const desired = projection(state.index); const desiredHash = fingerprint(desired);
    const paused = state.mismatch && !resolving;
    if (paused) {
      await kv.set('library:legacy-pending', bound({ fingerprint: state.observed, legacy: state.old }));
      delete state.index.pendingProjectionFingerprint;
      await kv.set('library:v2', bound(indexSchema.parse(state.index)));
    } else {
      state.index.pendingProjectionFingerprint = desiredHash;
      await kv.set('library:v2', bound(indexSchema.parse(state.index)));
      // An older factory may have written while the canonical commit was awaited.
      // Preserve that newer text before touching the compatibility projection.
      const beforeProjection = await legacy();
      const beforeProjectionHash = fingerprint(beforeProjection);
      if (beforeProjectionHash !== state.observed) {
        state.old = beforeProjection; state.observed = beforeProjectionHash; state.mismatch = true;
        await kv.set('library:legacy-pending', bound({ fingerprint: beforeProjectionHash, legacy: beforeProjection }));
        delete state.index.pendingProjectionFingerprint;
        await kv.set('library:v2', bound(indexSchema.parse(state.index)));
        publish(); return view(state);
      }
      // Projection failure keeps the canonical commit and signals a retryable pending projection.
      try {
        await kv.set('library', bound(desired));
      } catch { publish(); return view(state); }
      state.index.legacyProjectionFingerprint = desiredHash; delete state.index.pendingProjectionFingerprint;
      await kv.set('library:v2', bound(indexSchema.parse(state.index)));
      await kv.delete('library:legacy-pending');
      state.old = desired; state.observed = desiredHash; state.mismatch = false;
    }
    await sweep(state.index);
    publish(); return view(state);
  }
  async function character(identity: GeneratedFace, glyphProfile?: 'unicode' | 'ascii'): Promise<CharacterEntry> {
    const blob = blobSchema.parse({ version: 1, identity, ...(glyphProfile ? { glyphProfile } : {}) });
    const snapshotId = fingerprint(blob);
    const key = 'library:snapshot:' + snapshotId;
    const existing = await kv.get(key);
    if (existing !== undefined && existing !== null && canonical(existing) !== canonical(blob)) throw new FaceLibraryError('SNAPSHOT_INVALID', 'This character snapshot is unreadable. Its data has been preserved.');
    if (existing === undefined || existing === null) await kv.set(key, bound(blob, 16 * 1024));
    return characterEntrySchema.parse({ kind: 'generated', face: renderFace(identity, { glyphProfile }), snapshotId, ...(glyphProfile ? { glyphProfile } : {}) });
  }
  function favor(index: Index, entry: LibraryEntry, saved: boolean) {
    const remaining = index.favorites.filter(item => libraryEntryKey(item) !== libraryEntryKey(entry));
    if (saved && remaining.length >= 50) throw new FaceLibraryError('LIBRARY_FULL', 'Your library holds 50 favorites. Remove one before adding another.');
    index.favorites = saved ? [entry, ...remaining] : remaining;
  }
  function remember(index: Index, entry: LibraryEntry) {
    index.recent = [entry, ...index.recent.filter(item => libraryEntryKey(item) !== libraryEntryKey(entry))].slice(0, 20);
  }
  return {
    read: () => serial(async () => view(await readState())),
    review: () => serial(async () => view(await readState())),
    favoriteText: (entry: Omit<TextEntry, 'kind'>, saved: boolean) => serial(async () => {
      const state = await readState(); favor(state.index, textEntrySchema.parse({ kind: 'text', ...entry }), saved); return persist(state);
    }),
    favoriteCharacter: (identity: GeneratedFace, saved: boolean, glyphProfile?: 'unicode' | 'ascii') => serial(async () => {
      const state = await readState(); const entry = await character(identity, glyphProfile); favor(state.index, entry, saved); return persist(state);
    }),
    remove: (entry: LibraryEntry) => serial(async () => {
      const state = await readState(); favor(state.index, libraryEntrySchema.parse(entry), false); return persist(state);
    }),
    rememberText: (entry: Omit<TextEntry, 'kind'>) => serial(async () => {
      const state = await readState(); remember(state.index, textEntrySchema.parse({ kind: 'text', ...entry })); return persist(state);
    }),
    rememberCharacter: (identity: GeneratedFace, glyphProfile?: 'unicode' | 'ascii') => serial(async () => {
      const state = await readState(); remember(state.index, await character(identity, glyphProfile)); return persist(state);
    }),
    resolve: (snapshotId: string) => serial(async () => {
      characterEntrySchema.shape.snapshotId.parse(snapshotId);
      const state = await readState();
      if (![...state.index.favorites, ...state.index.recent].some(entry => entry.kind === 'generated' && entry.snapshotId === snapshotId)) throw new FaceLibraryError('CHARACTER_MISSING', 'This character is no longer in your library. Refresh the library.');
      const raw = await kv.get('library:snapshot:' + snapshotId); const parsed = blobSchema.safeParse(raw);
      if (!parsed.success || fingerprint(parsed.data) !== snapshotId) throw new FaceLibraryError('SNAPSHOT_MISSING', 'This saved character snapshot is missing or unreadable. Your library has been preserved.');
      return { identity: parsed.data.identity, ...(parsed.data.glyphProfile ? { glyphProfile: parsed.data.glyphProfile } : {}) };
    }),
    reconcile: (request: { fingerprint: string; keepCurrent?: boolean; add?: string[]; remove?: string[]; recentAdd?: string[]; recentRemove?: string[] }) => serial(async () => {
      const state = await readState();
      if (state.observed !== request.fingerprint || !state.mismatch) throw new FaceLibraryError('LEGACY_REVIEW_STALE', 'The text library changed. Refresh the review.');
      const changes = view(state).legacyChanges!;
      if (!request.keepCurrent) {
        for (const key of request.remove ?? []) {
          const entry = changes.removed.find(entry => libraryEntryKey(entry) === key);
          if (!entry) throw new FaceLibraryError('LEGACY_REVIEW_STALE', 'Refresh the review before importing changes.');
          favor(state.index, entry, false); // Text removal never deletes a character with the same face.
        }
        for (const key of request.add ?? []) {
          const entry = changes.added.find(entry => libraryEntryKey(entry) === key);
          if (!entry) throw new FaceLibraryError('LEGACY_REVIEW_STALE', 'Refresh the review before importing changes.');
          favor(state.index, entry, true);
        }
        for (const key of request.recentRemove ?? []) {
          const entry = changes.recentRemoved?.find(entry => libraryEntryKey(entry) === key);
          if (!entry) throw new FaceLibraryError('LEGACY_REVIEW_STALE', 'Refresh the review before importing recent text changes.');
          state.index.recent = state.index.recent.filter(item => libraryEntryKey(item) !== libraryEntryKey(entry));
        }
        // Only selected recent changes are imported. A favorites-only review cannot
        // silently push unrelated text into the character recent list.
        for (const key of [...(request.recentAdd ?? [])].reverse()) {
          const entry = changes.recentAdded?.find(entry => libraryEntryKey(entry) === key);
          if (!entry) throw new FaceLibraryError('LEGACY_REVIEW_STALE', 'Refresh the review before importing recent text changes.');
          remember(state.index, entry);
        }
      }
      return persist(state, true);
    }),
    cleanup: () => serial(async () => {
      const raw = await kv.get('library:v2');
      if (raw == null) return;
      const index = indexSchema.safeParse(raw);
      if (!index.success) throw new FaceLibraryError('LIBRARY_INVALID', 'Cannot clean an unreadable character library.');
      await sweep(index.data);
    }),
  };
}
