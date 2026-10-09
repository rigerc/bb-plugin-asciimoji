import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFaceLibrary, libraryEntryKey } from './library.ts';
import { generateFace } from './faces.ts';
import { generateFaceV3 } from './family-definitions.ts';

function store() {
  const values = new Map<string, unknown>();
  const writes: string[] = [];
  const kv = { get: async (key: string) => structuredClone(values.get(key)),
    set: async (key: string, value: unknown) => { writes.push(key); values.set(key, structuredClone(value)); },
    delete: async (key: string) => { values.delete(key); },
    list: async (prefix = '') => [...values.keys()].filter(key => key.startsWith(prefix)) };
  return { kv, values, writes, library: createFaceLibrary(kv) };
}

test('legacy read is non-migrating; character snapshots commit before canonical and compatible text projection', async () => {
  const { kv, values, writes, library } = store();
  await kv.set('library', { favorites: [{ face: ':)' }], recent: [{ face: ':?' }] });
  const read = await library.read();
  assert.equal(read.favorites[0].kind, 'text'); assert.equal(values.has('library:v2'), false);
  writes.length = 0;
  const character = generateFaceV3('thr_saved', 'cat');
  const saved = await library.favoriteCharacter(character, true);
  const entry = saved.favorites[0]; assert.equal(entry.kind, 'generated');
  assert.ok(writes[0].startsWith('library:snapshot:')); assert.equal(writes[1], 'library:v2'); assert.equal(writes[2], 'library');
  if (entry.kind !== 'generated') throw new Error('Expected character');
  assert.deepEqual((await library.resolve(entry.snapshotId)).identity, character);
  const reload = createFaceLibrary(kv);
  assert.deepEqual(await reload.resolve(entry.snapshotId), { identity: character });
  const legacy = values.get('library') as { favorites: { face: string }[] };
  assert.equal(legacy.favorites[0].face, entry.face); assert.equal('kind' in legacy.favorites[0], false);
});

test('old reader deletion raises persistent review; characters survive imports and paused projection writes', async () => {
  const { kv, values, library } = store();
  let saved = await library.favoriteCharacter(generateFace('thr_character'), true);
  const original = saved.favorites[0];
  saved = await library.favoriteText({ face: ':)' }, true);
  // An existing old build sees its valid unversioned schema, removes its projected character text, adds text.
  await kv.set('library', { favorites: [{ face: ':)' }, { face: ':D' }], recent: [] });
  const mismatch = await library.read(); assert.ok(mismatch.legacyChanges);
  assert.equal(values.has('library:legacy-pending'), true);
  const continued = await library.favoriteCharacter(generateFace('thr_another'), true);
  assert.ok(continued.legacyChanges);
  assert.deepEqual(values.get('library'), { favorites: [{ face: ':)' }, { face: ':D' }], recent: [] });
  const review = (await library.review()).legacyChanges!;
  const result = await library.reconcile({ fingerprint: review.fingerprint,
    add: review.added.map(libraryEntryKey), remove: review.removed.map(libraryEntryKey) });
  assert.ok(result.favorites.some(entry => libraryEntryKey(entry) === libraryEntryKey(original)));
  assert.ok(result.favorites.some(entry => entry.kind === 'text' && entry.face === ':D'));
  assert.equal(result.legacyChanges, undefined); assert.equal(values.has('library:legacy-pending'), false);
});

test('stale reviews and full-library imports fail without replacing canonical data', async () => {
  const { kv, values, library } = store();
  for (let index = 0; index < 50; index++) await library.favoriteText({ face: `(${index})` }, true);
  await kv.set('library', { favorites: [{ face: ':D' }], recent: [] });
  const changes = (await library.read()).legacyChanges!;
  const before = structuredClone(values.get('library:v2'));
  await assert.rejects(library.reconcile({ fingerprint: changes.fingerprint, add: changes.added.map(libraryEntryKey) }), /50 favorites/);
  assert.deepEqual(values.get('library:v2'), before);
  await kv.set('library', { favorites: [{ face: ':O' }], recent: [] });
  await assert.rejects(library.reconcile({ fingerprint: changes.fingerprint, keepCurrent: true }), /Refresh the review/);
  const refreshed = (await library.read()).legacyChanges!;
  assert.equal((await library.reconcile({ fingerprint: refreshed.fingerprint, keepCurrent: true })).favorites.length, 50);
});

test('future/corrupt canonical data and missing blobs never become empty libraries or trigger cleanup', async () => {
  const { kv, values, library } = store();
  const saved = await library.favoriteCharacter(generateFace('thr_character'), true);
  const entry = saved.favorites[0]; if (entry.kind !== 'generated') throw new Error('Expected character');
  const index = structuredClone(values.get('library:v2'));
  await kv.delete('library:snapshot:' + entry.snapshotId);
  await assert.rejects(library.resolve(entry.snapshotId), /missing or unreadable/);
  assert.deepEqual(values.get('library:v2'), index);
  await kv.set('library:v2', { version: 999, favorites: [] });
  await kv.set('library:snapshot:orphan', { valuable: true });
  await assert.rejects(library.favoriteText({ face: ':)' }, true), /newer version/);
  await assert.rejects(library.cleanup(), /unreadable/);
  assert.deepEqual(values.get('library:v2'), { version: 999, favorites: [] });
  assert.equal(values.has('library:snapshot:orphan'), true);
});

test('projection failures retain canonical commits and recover on the next mutation', async () => {
  const { kv, values } = store();
  let failProjection = true;
  const failing = { ...kv, set: async (key: string, value: unknown) => {
    if (key === 'library' && failProjection) throw new Error('Projection unavailable');
    return kv.set(key, value);
  } };
  const library = createFaceLibrary(failing);
  const first = await library.favoriteCharacter(generateFace('thr_a'), true);
  assert.equal(first.favorites.length, 1); assert.equal(first.projectionPending, true);
  assert.equal((await library.read()).legacyChanges, undefined);
  failProjection = false;
  const recovered = await library.favoriteText({ face: ':)' }, true);
  assert.equal(recovered.favorites.length, 2); assert.equal(recovered.projectionPending, undefined);
  assert.ok(values.get('library'));
});

test('text and character kinds deduplicate separately; recent limit and blob cleanup remain bounded', async () => {
  const { values, library } = store();
  const snapshot = generateFace('thr_same');
  const saved = await library.favoriteCharacter(snapshot, true);
  const character = saved.favorites[0];
  let result = await library.favoriteText({ face: character.face }, true);
  assert.equal(result.favorites.length, 2);
  result = await library.remove(character); assert.equal(result.favorites.length, 1); assert.equal(result.favorites[0].kind, 'text');
  assert.equal([...values.keys()].some(key => key.startsWith('library:snapshot:')), false);
  for (let index = 0; index < 25; index++) result = await library.rememberCharacter(generateFace(`thr_${index}`));
  assert.equal(result.recent.length, 20);
  assert.equal([...values.keys()].filter(key => key.startsWith('library:snapshot:')).length, 20);
  for (const value of values.values()) assert.ok(Buffer.byteLength(JSON.stringify(value)) < 192 * 1024);
});

test('legacy recent changes require explicit selection and cannot remove character recents', async () => {
  const { kv, library } = store();
  const first = await library.rememberCharacter(generateFace('thr_recent'));
  const character = first.recent[0];
  await kv.set('library', { favorites: [{ face: ':D' }], recent: [{ face: ':O' }] });
  const changes = (await library.read()).legacyChanges!;
  assert.equal(changes.recentAdded?.[0].face, ':O');
  let result = await library.reconcile({ fingerprint: changes.fingerprint, add: changes.added.map(libraryEntryKey) });
  assert.deepEqual(result.recent, [character]);
  await kv.set('library', { favorites: [{ face: ':D' }], recent: [{ face: ':O' }] });
  const recentReview = (await library.read()).legacyChanges!;
  result = await library.reconcile({ fingerprint: recentReview.fingerprint,
    recentAdd: recentReview.recentAdded!.map(libraryEntryKey), recentRemove: recentReview.recentRemoved!.map(libraryEntryKey) });
  assert.ok(result.recent.some(entry => entry.kind === 'generated'));
  assert.ok(result.recent.some(entry => entry.kind === 'text' && entry.face === ':O'));
});

test('an older-window edit during canonical commit is preserved instead of overwritten by projection', async () => {
  const { kv, values } = store();
  const initial = createFaceLibrary(kv);
  await initial.favoriteText({ face: ':)' }, true);
  const legacyEdit = { favorites: [{ face: ':D' }], recent: [] };
  let inject = true;
  const racingKv = { ...kv, set: async (key: string, value: unknown) => {
    await kv.set(key, value);
    if (key === 'library:v2' && inject) {
      inject = false;
      await kv.set('library', legacyEdit);
    }
  } };
  const library = createFaceLibrary(racingKv);
  const saved = await library.favoriteCharacter(generateFace('concurrent-old-window'), true);
  assert.deepEqual(values.get('library'), legacyEdit);
  assert.ok(saved.favorites.some(entry => entry.kind === 'generated'));
  assert.ok(saved.legacyChanges);
  assert.equal(values.has('library:legacy-pending'), true);
});

test('same-family corrupt blob content fails resolution without changing its canonical reference', async () => {
  const { kv, values, library } = store();
  const result = await library.favoriteCharacter(generateFaceV3('blob-a', 'bear'), true);
  const entry = result.favorites[0]; if (entry.kind !== 'generated') throw new Error('Expected character');
  const before = structuredClone(values.get('library:v2'));
  // This remains a schema-valid snapshot, but differs from its immutable content address.
  await kv.set('library:snapshot:' + entry.snapshotId, { version: 1, identity: generateFaceV3('blob-b', 'bear') });
  await assert.rejects(library.resolve(entry.snapshotId), /missing or unreadable/);
  assert.deepEqual(values.get('library:v2'), before);
});

test('cleanup deletes at most one bounded batch and preserves every referenced blob', async () => {
  const { kv, values, library } = store();
  const result = await library.favoriteCharacter(generateFace('referenced'), true);
  const entry = result.favorites[0]; if (entry.kind !== 'generated') throw new Error('Expected character');
  for (let index = 0; index < 205; index++) await kv.set('library:snapshot:orphan-' + index, { value: index });
  await library.cleanup();
  assert.equal([...values.keys()].filter(key => key.startsWith('library:snapshot:orphan-')).length, 105);
  assert.equal(values.has('library:snapshot:' + entry.snapshotId), true);
  await library.cleanup();
  assert.equal([...values.keys()].filter(key => key.startsWith('library:snapshot:orphan-')).length, 5);
});
