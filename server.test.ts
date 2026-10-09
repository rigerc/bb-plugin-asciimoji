import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin, { identitySchema } from './server.ts';
import { FACES, FAMILY_IDS, generateFace, renderFace, generatedFaceV3Schema, namedTraitHash, orderedWeightedSelect } from './faces.ts';
import { generateFaceV3 } from './family-definitions.ts';

const first = 'thr_first';
const second = 'thr_second';
const automatic = (threadId: string, family: (typeof FAMILY_IDS)[number] = 'classic') => generateFaceV3(threadId, family);
const automaticFace = (threadId: string) => renderFace(automatic(threadId));
async function host() {
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: {
    threads: { get: async ({ threadId }) => {
      if (threadId === 'thr_missing') throw new Error('Thread not found');
      return makeThreadResponse({ id: threadId });
    } },
  } });
  await plugin(result.bb);
  return result;
}

test('stable defaults, per-thread storage, reload persistence and reset', async () => {
  let { harness } = await host();
  try {
    const initial = await harness.behavior.callRpc('get', { threadId: first });
    assert.deepEqual(initial, { threadId: first, projectId: 'project-1', source: 'automatic', face: automaticFace(first), generated: automatic(first), glyphProfile: 'unicode' });
    await harness.behavior.callRpc('set', { threadId: first, face: 'ʕ•ᴥ•ʔ' });
    harness = (await harness.lifecycle.reload(plugin)).harness;
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), { threadId: first, projectId: 'project-1', source: 'preset', face: 'ʕ•ᴥ•ʔ' });
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: second }), { threadId: second, projectId: 'project-1', source: 'automatic', face: automaticFace(second), generated: automatic(second), glyphProfile: 'unicode' });
    assert.deepEqual(await harness.behavior.callRpc('reset', { threadId: first }), initial);
  } finally { await harness.lifecycle.dispose(); }
});

test('rejects invalid input and missing threads before persisting', async () => {
  const { harness } = await host();
  try {
    for (const face of ['', '   ', 'a\nb', 'x\u202Ey', 'x'.repeat(41)]) {
      await assert.rejects(harness.behavior.callRpc('set', { threadId: first, face }));
    }
    await assert.rejects(harness.behavior.callRpc('set', { threadId: 'thr_missing', face: ':-)' }));
    await assert.rejects(harness.behavior.callRpc('get', { threadId: '../bad' }));
    assert.equal((await harness.behavior.callRpc('get', { threadId: first }) as {source:string}).source, 'automatic');
  } finally { await harness.lifecycle.dispose(); }
});

test('shuffle changes face, CLI updates and deletion clears saved face', async () => {
  const { harness } = await host();
  try {
    const before = await harness.behavior.callRpc('get', { threadId: first }) as {face:string};
    const after = await harness.behavior.callRpc('shuffle', { threadId: first }) as {face:string};
    assert.notEqual(before.face, after.face);
    assert.ok(FACES.some(item => item.face === after.face));
    const result = await harness.behavior.runCli(['set', '[o_o]', '--thread', first, '--json']);
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.stdout!).face, '[o_o]');
    await harness.behavior.emitThreadEvent('thread.deleted', { thread: makeThreadResponse({ id: first }) });
    assert.equal((await harness.behavior.callRpc('get', { threadId: first }) as {source:string}).source, 'automatic');
    assert.ok(harness.inspection.realtimeSignals.length > 0);
    assert.notEqual((await harness.behavior.runCli(['get', '--nonsense'])).exitCode, 0);
  } finally { await harness.lifecycle.dispose(); }
});

test('settings persist across reload and bulk lookup is bounded', async () => {
  let { harness } = await host();
  try {
    await harness.behavior.setSettings({ showHeader: false, showSidebar: true, useThemeColor: true, animation: 'playful', sidebarWidth: 'expanded', activityStyle: 'markers', defaultFamily: 'bear' });
    harness = (await harness.lifecycle.reload(plugin)).harness;
    await harness.behavior.setSettings({ animation: 'off', sidebarWidth: 'compact', activityStyle: 'expressions', defaultFamily: 'classic' });
    await assert.rejects(harness.behavior.setSettings({ animation: 'invalid' }));
    await assert.rejects(harness.behavior.setSettings({ sidebarWidth: 'wide' }));
    await assert.rejects(harness.behavior.setSettings({ activityStyle: 'blink' }));
    await assert.rejects(harness.behavior.setSettings({ defaultFamily: 'invalid' }));
    const result = await harness.behavior.callRpc('getMany', { threadIds: [first, first, second, 'thr_missing'] });
    assert.deepEqual(result, [
      { threadId: first, projectId: 'project-1', source: 'automatic', face: automaticFace(first), generated: automatic(first), glyphProfile: 'unicode' },
      { threadId: second, projectId: 'project-1', source: 'automatic', face: automaticFace(second), generated: automatic(second), glyphProfile: 'unicode' },
    ]);
    await assert.rejects(harness.behavior.callRpc('getMany', { threadIds: Array(201).fill(first) }));
  } finally { await harness.lifecycle.dispose(); }
});


test('generated choices survive reload, inherit parent eyes, and reset to the generated default', async () => {
  let { harness } = await host();
  try {
    const generated = await harness.behavior.callRpc('generate', { threadId: first });
    assert.deepEqual(generated, { threadId: first, projectId: 'project-1', source: 'generated', face: renderFace(automatic(first)), generated: automatic(first), glyphProfile: 'unicode' });
    harness = (await harness.lifecycle.reload(plugin)).harness;
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), generated);
    harness.inspection.sdk.stub('threads.get', ({ threadId }) => makeThreadResponse({ id: threadId, parentThreadId: threadId === first ? null : first }));
    const child = await harness.behavior.callRpc('generate', { threadId: second }) as { generated: { eyePair: [string, string] } };
    assert.deepEqual(child.generated.eyePair, automatic(first).eyePair);
    const cli = await harness.behavior.runCli(['generate', '--thread', second, '--json']);
    assert.equal(cli.exitCode, 0);
    assert.equal(JSON.parse(cli.stdout!).generated.version, 3);
    await harness.behavior.callRpc('set', { threadId: first, face: ':-)' });
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), { threadId: first, projectId: 'project-1', source: 'preset', face: ':-)' });
    const reset = await harness.behavior.callRpc('reset', { threadId: second });
    const expected = automatic(second);
    assert.deepEqual(reset, { threadId: second, projectId: 'project-1', source: 'automatic', face: renderFace(expected), generated: expected, glyphProfile: 'unicode' });
    await assert.rejects(harness.behavior.callRpc('generate', { threadId: '../bad' }));
  } finally { await harness.lifecycle.dispose(); }
});

test('activity reads current state, bounds bulk requests and publishes refresh signals', async () => {
  const { harness } = await host();
  try {
    harness.inspection.sdk.stub('threads.interactions.list', () => []);
    harness.inspection.sdk.stub('threads.get', ({ threadId }) => makeThreadResponse({ id: threadId, status: 'active' }));
    assert.deepEqual(await harness.behavior.callRpc('activity', { threadIds: [first, first] }), [{ threadId: first, state: 'running' }]);
    harness.inspection.sdk.stub('threads.get', ({ threadId }) => makeThreadResponse({ id: threadId, status: 'error' }));
    assert.deepEqual(await harness.behavior.callRpc('activity', { threadIds: [first] }), [{ threadId: first, state: 'error' }]);
    harness.inspection.sdk.stub('threads.get', ({ threadId }) => makeThreadResponse({ id: threadId, status: 'idle' }));
    assert.deepEqual(await harness.behavior.callRpc('activity', { threadIds: [first] }), [{ threadId: first, state: 'idle' }]);
    harness.inspection.sdk.stub('threads.interactions.list', () => [{
      createdAt: 0, id: 'approval_test', threadId: first, turnId: 'turn_test',
      providerId: 'codex', providerRequestId: 'request_test', providerThreadId: 'provider_test',
      payload: { kind: 'approval', availableDecisions: ['allow_once'], reason: null,
        subject: { kind: 'plan', itemId: 'item_test', plan: 'Run checks', planFilePath: null } },
      resolution: null, resolvedAt: null, status: 'pending', statusReason: null,
    }]);
    assert.deepEqual(await harness.behavior.callRpc('activity', { threadIds: [first] }), [{ threadId: first, state: 'waiting' }]);
    harness.inspection.sdk.stub('threads.interactions.list', () => []);
    assert.deepEqual(await harness.behavior.callRpc('activity', { threadIds: [first] }), [{ threadId: first, state: 'idle' }]);
    await harness.behavior.emitThreadEvent('thread.active', { thread: makeThreadResponse({ id: first, status: 'active' }) });
    assert.ok(harness.inspection.realtimeSignals.some(signal => signal.channel === 'activity'));
    await assert.rejects(harness.behavior.callRpc('activity', { threadIds: Array(201).fill(first) }));
  } finally { await harness.lifecycle.dispose(); }
});

test('generated expressions keep their geometry and never alter the static identity', () => {
  for (let index = 0; index < 200; index++) {
    const identity = generateFace(`thr_${index}`);
    const initial = renderFace(identity);
    for (const state of ['idle', 'running', 'waiting', 'error'] as const) {
      for (const elapsed of [0, 250, 750, 6000, 100000]) {
        const frame = renderFace(identity, { state, elapsed, animation: true });
        assert.equal([...frame].length, 6);
        assert.equal(frame[0], initial[0]);
        assert.equal(frame[2], initial[2]);
        assert.equal(frame[4], initial[4]);
        assert.equal(frame[5], initial[5]);
      }
      assert.equal(renderFace(identity, { state, elapsed: 1000 }), renderFace(identity, { state }));
    }
    assert.equal(renderFace(identity), initial);
    assert.deepEqual(generateFace(`thr_${index}`), identity);
  }
});


test('each family is deterministic, varied, related, and supports every activity expression', () => {
  for (const family of FAMILY_IDS) {
    const parent = generateFace(first, family);
    const child = generateFace(second, family, { inheritedEyes: parent.eyes });
    assert.deepEqual(generateFace(first, family), parent);
    assert.equal(child.eyes, parent.eyes);
    const variants = new Set(Array.from({ length: 40 }, (_, i) => renderFace(generateFace(`thr_${i}`, family))));
    assert.ok(variants.size > 1, family);
    for (const state of ['idle', 'running', 'waiting', 'error'] as const) {
      assert.equal([...renderFace(child, { state, animation: true, elapsed: 800 })].length, 6);
    }
  }
  assert.deepEqual(generateFace(first), generateFace(first, 'classic'));
});

test('project defaults respect saved generated snapshots and migrated choices', async () => {
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: {
    threads: { get: async ({ threadId }) => {
      if (threadId === 'thr_missing') throw new Error('Thread not found');
      return makeThreadResponse({ id: threadId, projectId: threadId === 'thr_other_project' ? 'proj_other' : 'proj_one' });
    } },
  } });
  await plugin(result.bb);
  let { harness } = result;
  const read = (threadId: string) => harness.behavior.callRpc('get', { threadId }) as Promise<{face:string; source:string; generated:ReturnType<typeof generateFaceV3>}>;
  try {
    await result.bb.storage.kv.set(`thread:${first}`, { version: 1, kind: 'generated' });
    await harness.behavior.callRpc('set', { threadId: 'thr_custom', face: ':-)' });
    await harness.behavior.callRpc('generate', { threadId: 'thr_pinned', family: 'cat' });
    await harness.behavior.callRpc('setProjectDefault', { threadId: second, family: 'bear' });
    assert.deepEqual(await harness.behavior.callRpc('getProjectDefault', { threadId: second }), { family: 'bear', origin: 'project', override: 'bear' });
    assert.deepEqual((await read(second)).generated, automatic(second, 'bear'));
    assert.equal((await read(second)).source, 'automatic');
    assert.equal((await read(first)).face, '(¬‿¬)'); // v1 appearance preserved
    assert.equal((await read('thr_custom')).face, ':-)');
    assert.equal((await read('thr_pinned')).generated.family, 'cat');
    assert.equal((await read('thr_other_project')).face, automaticFace('thr_other_project'));
    assert.ok(harness.inspection.realtimeSignals.some(signal => signal.channel === 'changed' && (signal.payload as {projectId?:string}).projectId === 'proj_one'));
    harness = (await harness.lifecycle.reload(plugin)).harness;
    assert.equal((await read(second)).generated.family, 'bear');
    assert.equal((await read('thr_new')).generated.family, 'bear');
    await harness.behavior.callRpc('reset', { threadId: 'thr_pinned' });
    assert.equal((await read('thr_pinned')).generated.family, 'bear');
    assert.equal((await read('thr_pinned')).source, 'automatic');
    await harness.behavior.callRpc('generate', { threadId: 'thr_generated' });
    await harness.behavior.callRpc('setProjectDefault', { threadId: second, family: 'robot' });
    assert.equal((await read('thr_generated')).generated.family, 'bear');
    assert.equal((await read(second)).generated.family, 'robot');
    await assert.rejects(harness.behavior.callRpc('setProjectDefault', { threadId: second, family: 'invalid' }));
    await assert.rejects(harness.behavior.callRpc('generate', { threadId: second, family: 'invalid' }));
    await assert.rejects(harness.behavior.callRpc('setProjectDefault', { threadId: 'thr_missing', family: 'cat' }));
    await assert.rejects(harness.behavior.callRpc('setProjectDefault', { threadId: second, family: 'cat', projectId: 'proj_other' }));
    await harness.behavior.callRpc('setProjectDefault', { threadId: second, family: 'classic' });
    assert.equal((await read(second)).face, automaticFace(second));
    assert.deepEqual(await harness.behavior.callRpc('getProjectDefault', { threadId: second }), { family: 'classic', origin: 'project', override: 'classic' });
    // Explicit Classic survives a global change; inherited projects follow it.
    await harness.behavior.setSettings({ defaultFamily: 'robot' });
    assert.deepEqual(await harness.behavior.callRpc('getProjectDefault', { threadId: second }), { family: 'classic', origin: 'project', override: 'classic' });
    assert.equal((await read(second)).generated.family, 'classic');
    assert.deepEqual(await harness.behavior.callRpc('getProjectDefault', { threadId: 'thr_other_project' }), { family: 'robot', origin: 'global', override: null });
    assert.equal((await read('thr_other_project')).generated.family, 'robot');
    // Inheriting deletes the override and follows the global default.
    assert.deepEqual(await harness.behavior.callRpc('setProjectDefault', { threadId: second, family: null }), { family: 'robot', origin: 'global', override: null });
    assert.equal((await read(second)).generated.family, 'robot');
    await harness.behavior.setSettings({ defaultFamily: 'classic' });
  } finally { await harness.lifecycle.dispose(); }
});

test('family and project default CLI commands validate, read and save choices', async () => {
  const { harness } = await host();
  try {
    const run = (args: string[]) => harness.behavior.runCli([...args, '--thread', first, '--json']);
    assert.deepEqual(JSON.parse((await run(['project-default'])).stdout!), { family: 'classic', origin: 'global', override: null });
    assert.deepEqual(JSON.parse((await run(['project-default', 'robot'])).stdout!), { family: 'robot', origin: 'project', override: 'robot' });
    const generated = JSON.parse((await run(['generate', '--family', 'cat'])).stdout!);
    assert.equal(generated.generated.family, 'cat');
    assert.equal(JSON.parse((await run(['reset'])).stdout!).generated.family, 'robot');
    assert.deepEqual(JSON.parse((await run(['project-default', 'classic'])).stdout!), { family: 'classic', origin: 'project', override: 'classic' });
    assert.deepEqual(JSON.parse((await run(['project-default', 'inherit'])).stdout!), { family: 'classic', origin: 'global', override: null });
    assert.notEqual((await run(['project-default', 'bad'])).exitCode, 0);
    assert.notEqual((await run(['generate', '--family', 'bad'])).exitCode, 0);
  } finally { await harness.lifecycle.dispose(); }
});


test('authoritative previews match saved children, and eyes follow three generations', async () => {
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: { threads: {
    get: ({ threadId }) => makeThreadResponse({ id: threadId, parentThreadId:
      threadId === 'thr_root' ? null : threadId === 'thr_child' ? 'thr_root' : 'thr_child' }),
  } } });
  await plugin(result.bb);
  const { harness } = result;
  const read = (threadId: string) => harness.behavior.callRpc('get', { threadId }) as Promise<import('./server.ts').Identity>;
  try {
    await harness.behavior.callRpc('setProjectDefault', { threadId: 'thr_root', family: 'cat' });
    const root = await read('thr_root'), child = await read('thr_child'), grandchild = await read('thr_grandchild');
    assert.equal((root.generated as import('./faces.ts').GeneratedFaceV2).eyes, (child.generated as import('./faces.ts').GeneratedFaceV2).eyes);
    assert.equal((child.generated as import('./faces.ts').GeneratedFaceV2).eyes, (grandchild.generated as import('./faces.ts').GeneratedFaceV2).eyes);
    const previews = await harness.behavior.callRpc('previews', { threadId: 'thr_grandchild' }) as { family: string; face: string }[];
    for (const preview of previews) {
      const saved = await harness.behavior.callRpc('generate', { threadId: 'thr_grandchild', family: preview.family }) as { face: string };
      assert.equal(saved.face, preview.face);
    }
    const siblings = await Promise.all(Array.from({ length: 60 }, (_, index) => read('thr_sibling_' + index)));
    assert.ok(new Set(siblings.map(item => item.face)).size > 20, 'siblings remain visually distinct');
    assert.ok(siblings.every(item => (item.generated as import('./faces.ts').GeneratedFaceV2).eyes === (child.generated as import('./faces.ts').GeneratedFaceV2).eyes));
  } finally { await harness.lifecycle.dispose(); }
});

test('legacy recipes migrate once to v2 snapshots and new variations persist', async () => {
  const result = await host();
  let { harness } = result;
  try {
    const originalFaces: Record<(typeof FAMILY_IDS)[number], string> = {
      classic: '(¬‿¬)', bear: 'ʕ˘ω˘ʔ', robot: '[¬=¬]', cat: '(=ω=)', minimal: '(·ᴗ·)',
    };
    for (const family of FAMILY_IDS) {
      await result.bb.storage.kv.set('thread:' + first, { version: 1, kind: 'generated', family });
      const migrated = await harness.behavior.callRpc('get', { threadId: first }) as import('./server.ts').Identity;
      assert.equal(migrated.face, originalFaces[family], 'migration preserves v1 text');
      assert.equal([...migrated.face].length, 5);
      assert.equal(migrated.generated!.version, 2);
      assert.equal(migrated.generated!.family, family);
      assert.equal(migrated.generated!.accessory, undefined);
      const stored = await result.bb.storage.kv.get('thread:' + first) as { version: number; identity: unknown };
      assert.equal(stored.version, 2);
      assert.deepEqual(stored.identity, migrated.generated);
      assert.equal((await harness.behavior.callRpc('get', { threadId: first }) as import('./server.ts').Identity).face, migrated.face);
      assert.equal([...renderFace(migrated.generated!, { state: 'running' })].length, 5);
    }
    const before = await harness.behavior.callRpc('generate', { threadId: first, family: 'cat' }) as { face: string };
    const varied = await harness.behavior.callRpc('vary', { threadId: first }) as import('./server.ts').Identity;
    assert.notEqual(before.face, varied.face);
    assert.equal(varied.generated!.family, 'cat');
    assert.equal(varied.source, 'generated');
    await harness.behavior.callRpc('setProjectDefault', { threadId: first, family: 'robot' });
    harness = (await harness.lifecycle.reload(plugin)).harness;
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), varied);
    const reset = await harness.behavior.callRpc('reset', { threadId: first }) as import('./server.ts').Identity;
    assert.equal(reset.source, 'automatic');
    assert.equal(reset.generated!.family, 'robot');
  } finally { await harness.lifecycle.dispose(); }
});

test('v1 child migration uses its stored parent-id eye hash and stays pinned', async () => {
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: {
    threads: { get: ({ threadId }: { threadId: string }) =>
      makeThreadResponse({ id: threadId, parentThreadId: threadId === 'thr_child' ? first : null }) },
  } });
  await plugin(result.bb);
  try {
    await result.bb.storage.kv.set('thread:thr_child', { version: 1, kind: 'generated', family: 'classic' });
    const read = () => result.harness.behavior.callRpc('get', { threadId: 'thr_child' }) as Promise<import('./server.ts').Identity>;
    const migrated = await read();
    assert.equal(migrated.face, '(¬ᴥ¬)');
    assert.equal(migrated.generated?.accessory, undefined);
    await result.harness.behavior.callRpc('generate', { threadId: first, family: 'cat' });
    assert.deepEqual(await read(), migrated, 'migrated child remains a stable snapshot');
  } finally { await result.harness.lifecycle.dispose(); }
});

test('a concurrent edit wins a migration read without recursion or accidental reset', async () => {
  const result = await host();
  const kv = result.bb.storage.kv;
  const originalGet = kv.get.bind(kv);
  try {
    await kv.set('thread:' + first, { version: 1, kind: 'generated', family: 'cat' });
    let reads = 0;
    kv.get = (async (name: string) => {
      const value = await originalGet(name);
      if (name === 'thread:' + first && ++reads === 2) {
        await kv.set(name, ':-)');
        return ':-)';
      }
      return value;
    }) as typeof kv.get;
    const resolved = await result.harness.behavior.callRpc('get', { threadId: first }) as import('./server.ts').Identity;
    assert.equal(resolved.face, ':-)');
    assert.equal(resolved.source, 'preset');
    assert.equal(await originalGet('thread:' + first), ':-)');
  } finally {
    kv.get = originalGet;
    await result.harness.lifecycle.dispose();
  }
});

test('custom expressions validate, persist, clear, and work through the CLI', async () => {
  let { harness } = await host();
  try {
    for (const face of ['\u2800', '\u3164', '\u0301', '😀'.repeat(41), '(x)\n', 'x\u200by']) {
      await assert.rejects(harness.behavior.callRpc('set', { threadId: first, face }));
    }
    const unicode = '😀'.repeat(40);
    assert.equal((await harness.behavior.callRpc('set', { threadId: first, face: unicode }) as {face:string}).face, unicode);
    await assert.rejects(harness.behavior.callRpc('set', { threadId: first, face: ':-)', expressions: { waiting: '\u2800' } }));
    await assert.rejects(harness.behavior.callRpc('set', { threadId: first, face: ':-)', expressions: { idle: 'bad' } }));
    const result = await harness.behavior.runCli(['set', ':-)', '--running', ':D', '--waiting', ':?', '--error', ':(', '--thread', first, '--json']);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout!).expressions, { running: ':D', waiting: ':?', error: ':(' });
    harness = (await harness.lifecycle.reload(plugin)).harness;
    assert.deepEqual((await harness.behavior.callRpc('get', { threadId: first }) as {expressions:unknown}).expressions, { running: ':D', waiting: ':?', error: ':(' });
    const cleared = await harness.behavior.callRpc('set', { threadId: first, face: ':-)', expressions: {} }) as {expressions?:unknown};
    assert.equal(cleared.expressions, undefined);
    const outside = await harness.behavior.runCli(['get']);
    assert.notEqual(outside.exitCode, 0);
    assert.match(outside.stderr ?? '', /Supply --thread/);
  } finally { await harness.lifecycle.dispose(); }
});

test('favorite and recent libraries are bounded, deduplicated, synced, and survive reload', async () => {
  let { harness } = await host();
  const library = () => harness.behavior.callRpc('getLibrary', {}) as Promise<{favorites: import('./server.ts').LibraryFace[]; recent: import('./server.ts').LibraryFace[]}>;
  try {
    await Promise.all([
      harness.behavior.callRpc('favorite', { face: ':)', saved: true }),
      harness.behavior.callRpc('favorite', { face: ':)', expressions: { waiting: ':?' }, saved: true }),
    ]);
    assert.equal((await library()).favorites.length, 2, 'activity maps distinguish reusable choices');
    for (let index = 0; index < 25; index++) await harness.behavior.callRpc('set', { threadId: first, face: '(' + index + ')' });
    await harness.behavior.callRpc('set', { threadId: first, face: '(24)' });
    assert.equal((await library()).recent.length, 20);
    assert.equal((await library()).recent[0]!.face, '(24)');
    for (let index = 0; index < 48; index++) await harness.behavior.callRpc('favorite', { face: '(' + index + ')', saved: true });
    await assert.rejects(harness.behavior.callRpc('favorite', { face: 'extra', saved: true }));
    await harness.behavior.callRpc('favorite', { face: ':)', saved: false });
    await harness.behavior.callRpc('favorite', { face: 'extra', saved: true });
    assert.equal((await library()).favorites.length, 50);
    const before = await library();
    assert.ok(harness.inspection.realtimeSignals.some(signal => signal.channel === 'library'));
    harness = (await harness.lifecycle.reload(plugin)).harness;
    assert.deepEqual(await library(), before);
    const result = await harness.behavior.runCli(['library', '--json']);
    assert.deepEqual(JSON.parse(result.stdout!), before);
    await harness.behavior.callRpc('favorite', { face: 'extra', saved: false });
    assert.equal((await library()).favorites.length, 49);
  } finally { await harness.lifecycle.dispose(); }
});

test('generated expression frames keep their geometry while increasing family variety', () => {
  for (const family of FAMILY_IDS) {
    const siblings = new Set<string>();
    for (let index = 0; index < 200; index++) {
      const identity = generateFace('thr_' + index, family, { inheritedEyes: '^' });
      siblings.add(renderFace(identity));
      for (const state of ['idle', 'running', 'waiting', 'error'] as const) {
        assert.equal([...renderFace(identity, { state, animation: true, elapsed: 800 })].length, [...renderFace(identity)].length);
      }
    }
    assert.ok(siblings.size >= 40, family + ' has enough sibling variations');
  }
});

test('parent changes invalidate automatic children but stop at pinned threads', async () => {
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: {
    threads: {
      get: ({ threadId }: { threadId: string }) => makeThreadResponse({
        id: threadId,
        parentThreadId: threadId === 'thr_child' ? 'thr_parent' : threadId === 'thr_grandchild' ? 'thr_child' : null,
      }),
      list: (args?: { parentThreadId?: string }) => {
        if (args?.parentThreadId === 'thr_parent') return [makeThreadResponse({ id: 'thr_child', parentThreadId: 'thr_parent' })];
        if (args?.parentThreadId === 'thr_child') return [makeThreadResponse({ id: 'thr_grandchild', parentThreadId: 'thr_child' })];
        return [];
      },
    },
  } });
  await plugin(result.bb);
  const { harness } = result;
  try {
    const changedSignals = () => harness.inspection.realtimeSignals.filter(signal => signal.channel === 'changed');
    // Both child and grandchild start automatic, so a parent save must list them.
    await harness.behavior.callRpc('generate', { threadId: 'thr_parent', family: 'cat' });
    const first = changedSignals().at(-1)?.payload as { threadId?: string; affectedThreadIds?: string[] };
    assert.equal(first?.threadId, 'thr_parent');
    assert.ok(first?.affectedThreadIds?.includes('thr_child'), 'automatic child is invalidated');
    assert.ok(first?.affectedThreadIds?.includes('thr_grandchild'), 'transitive automatic grandchild is invalidated');
    // Pinning the child freezes its face and blocks propagation to its own children.
    await harness.behavior.callRpc('set', { threadId: 'thr_child', face: ':-)' });
    await harness.behavior.callRpc('generate', { threadId: 'thr_parent', family: 'bear' });
    const second = changedSignals().at(-1)?.payload as { threadId?: string; affectedThreadIds?: string[] };
    assert.equal(second?.threadId, 'thr_parent');
    assert.deepEqual(second?.affectedThreadIds ?? [], [], 'pinned child blocks descendant invalidation');
  } finally { await harness.lifecycle.dispose(); }
});

test('global defaults apply only to inherited projects and publish realtime invalidation', async () => {
  const { harness } = await host();
  try {
    assert.deepEqual(await harness.behavior.callRpc('getProjectDefault', { threadId: first }), { family: 'classic', origin: 'global', override: null });
    await harness.behavior.setSettings({ defaultFamily: 'cat' });
    assert.ok(harness.inspection.realtimeSignals.some(signal => signal.channel === 'changed' && (signal.payload as {globalDefault?:string}).globalDefault === 'cat'));
    assert.deepEqual(await harness.behavior.callRpc('getProjectDefault', { threadId: first }), { family: 'cat', origin: 'global', override: null });
    assert.equal(((await harness.behavior.callRpc('get', { threadId: first })) as {generated:{family:string}}).generated.family, 'cat');
    await harness.behavior.callRpc('setProjectDefault', { threadId: first, family: 'classic' });
    await harness.behavior.setSettings({ defaultFamily: 'robot' });
    assert.equal(((await harness.behavior.callRpc('get', { threadId: first })) as {generated:{family:string}}).generated.family, 'classic');
    await harness.behavior.setSettings({ defaultFamily: 'classic' });
  } finally { await harness.lifecycle.dispose(); }
});

test('centralized activity presentation keeps geometry across modes', async () => {
  const { resolveFaceDisplay } = await import('./faces.ts');
  const generated = generateFace('thr_demo', 'classic');
  const base = renderFace(generated);
  assert.deepEqual(resolveFaceDisplay(base, { generated }), { displayed: base, marker: '' });
  assert.deepEqual(resolveFaceDisplay(base, { generated, state: 'running', activityStyle: 'markers' }), { displayed: base, marker: '·' });
  assert.deepEqual(resolveFaceDisplay(base, { generated, state: 'waiting', activityStyle: 'markers' }), { displayed: base, marker: '?' });
  assert.deepEqual(resolveFaceDisplay(base, { generated, state: 'error', activityStyle: 'markers' }), { displayed: base, marker: '!' });
  const running = resolveFaceDisplay(base, { generated, state: 'running' });
  assert.equal([...running.displayed].length, [...base].length);
  assert.deepEqual(resolveFaceDisplay(':)', { state: 'running' }), { displayed: ':)', marker: '·' });
  assert.deepEqual(resolveFaceDisplay(':)', { state: 'waiting', expressions: { waiting: ':?' } }), { displayed: ':?', marker: '' });
  assert.deepEqual(resolveFaceDisplay(':)', { state: 'waiting', expressions: { waiting: ':?' }, activityStyle: 'markers' }), { displayed: ':)', marker: '?' });
});


test('v3 bounded snapshots and schema-valid maximum RPC payload', async () => {
  const glyph = '𐀓';
  const rendering = (length: number, ascii = false) => ({
    idle: (ascii ? '\\' : glyph).repeat(length), running: (ascii ? '\\' : glyph).repeat(length),
    waiting: (ascii ? '\\' : glyph).repeat(length), error: (ascii ? '\\' : glyph).repeat(length),
    runningFrames: Array(4).fill((ascii ? '\\' : glyph).repeat(length)),
  });
  const pair: [string, string] = [glyph.repeat(4), glyph.repeat(4)];
  const snapshot = generatedFaceV3Schema.parse({ version: 3, family: 'classic', templateId: 'x'.repeat(64), personality: 'cheerful',
    outline: pair, eyePair: pair, mouth: glyph.repeat(4), accessory: glyph.repeat(4),
    layers: { gesture: pair, facialMarks: pair, surroundings: pair }, capabilities: { builtInAppendages: false, allowedLayers: ['gesture', 'facialMarks', 'surroundings'] },
    blinkOffset: 3999, base: rendering(40), renderings: { compact: rendering(6), expressive: rendering(40), ascii: { compact: rendering(6, true), expressive: rendering(40, true) } } });
  for (const invalid of [{ ...snapshot, templateId: 'x'.repeat(65) }, { ...snapshot, personality: 'unknown' },
    { ...snapshot, eyePair: [glyph.repeat(5), glyph] }, { ...snapshot, base: { ...snapshot.base, runningFrames: Array(5).fill(glyph) } },
    { ...snapshot, renderings: { ...snapshot.renderings, ascii: { compact: rendering(6) } } }]) assert.equal(generatedFaceV3Schema.safeParse(invalid).success, false);
  const identity = identitySchema.parse({ threadId: 'thr_'.padEnd(128, 'x'), projectId: 'x'.repeat(128), face: snapshot.base.idle, source: 'generated', generated: snapshot, glyphProfile: 'unicode' });
  const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
  assert.ok(size(Array(200).fill(identity)) <= 1024 * 1024);
  console.log('Schema-valid maximum sizes:', { snapshot: size(snapshot), getMany200: size(Array(200).fill(identity)), snapshotKV: size({ identity: snapshot }), libraryIndex70: size({ version: 2, favorites: Array(50).fill({ kind: 'generated', face: snapshot.base.idle, snapshotId: 'f'.repeat(64) }), recent: Array(20).fill({ kind: 'generated', face: snapshot.base.idle, snapshotId: 'f'.repeat(64) }), legacyProjectionFingerprint: 'f'.repeat(64) }) });
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: { threads: { get: ({ threadId }) => makeThreadResponse({ id: threadId, projectId: 'x'.repeat(128) }) } } });
  await plugin(result.bb);
  try {
    const threadIds = Array.from({ length: 200 }, (_, index) => `thr_${index}_`.padEnd(128, 'x'));
    for (const threadId of threadIds) await result.bb.storage.kv.set(`thread:${threadId}`, { version: 3, kind: 'generated', seed: 0, identity: snapshot, glyphProfile: 'unicode' });
    const response = await result.harness.behavior.callRpc('getMany', { threadIds });
    assert.equal((response as unknown[]).length, 200);
    assert.equal(size(response), size(Array(200).fill(identity)));
    assert.ok(size(response) <= 1024 * 1024);
  } finally { await result.harness.lifecycle.dispose(); }

});

test('named hashing and ordered weighted selection are stable and bounded', () => {
  assert.equal(namedTraitHash('thr_first', 0, 'mouth'), 4189087906);
  assert.notEqual(namedTraitHash('thr_first', 0, 'gesture:include'), namedTraitHash('thr_first', 0, 'gesture:choice'));
  const entries = [{ value: 'a', weight: 1 }, { value: 'skip', weight: 0 }, { value: 'b', weight: 3 }];
  assert.equal(orderedWeightedSelect(entries, 0), 'a');
  assert.equal(orderedWeightedSelect(entries, 0x3fffffff), 'a');
  assert.equal(orderedWeightedSelect(entries, 0x40000000), 'b');
  assert.equal(orderedWeightedSelect(entries, 0xffffffff), 'b');
  assert.throws(() => orderedWeightedSelect([], 0));
  assert.throws(() => orderedWeightedSelect([{ value: 'bad', weight: -1 }], 0));
});


test('v1 migration and v2 generation retain exact frozen outputs', async () => {
  const { migrateGeneratedV1 } = await import('./migration.ts');
  const v2 = generateFace('thr_fixture');
  assert.deepEqual(v2, { version: 2, family: 'classic', ears: ['ʕ', 'ʔ'], eyes: 'o', mouth: 'ω', accessory: '☆', blinkOffset: 3977 });
  assert.deepEqual(['idle', 'running', 'waiting', 'error'].map(state => renderFace(v2, { state: state as import('./faces.ts').FaceState })), ['ʕoωoʔ☆', 'ʕ<ω<ʔ☆', 'ʕ?ω?ʔ☆', 'ʕxωxʔ☆']);
  assert.equal(renderFace(v2, { state: 'running', elapsed: 750, animation: true }), 'ʕ>ω>ʔ☆');
  const migrated = migrateGeneratedV1('thr_fixture', 'thr_parent');
  assert.deepEqual(migrated, { version: 2, family: 'classic', ears: ['{', '}'], eyes: 'o', mouth: 'ᴥ', blinkOffset: 510 });
  assert.equal(renderFace(migrated), '{oᴥo}');
  assert.equal(namedTraitHash('thr_🦊', 123, 'mouth'), 56130995);
});

test('descendant traversal pages children, includes hidden/archived and retains pinned boundaries', async () => {
  const calls: Array<{ offset?: number; archived?: boolean; includeHidden?: boolean }> = [];
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: { threads: {
    get: ({ threadId }) => makeThreadResponse({ id: threadId }),
    list: args => {
      if (args?.parentThreadId !== 'thr_root') return [];
      calls.push(args);
      if (args.archived) return [makeThreadResponse({ id: 'thr_archived', archivedAt: 123, visibility: 'hidden' })];
      return Array.from({ length: 150 }, (_, i) => makeThreadResponse({ id: `thr_child_${i}` })).slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 0));
    },
  } } });
  await plugin(result.bb);
  try {
    await result.bb.storage.kv.set('thread:thr_child_10', '[o_o]');
    await result.harness.behavior.callRpc('set', { threadId: 'thr_root', face: ':-)' });
    const payload = result.harness.inspection.realtimeSignals.filter(s => s.channel === 'changed').at(-1)!.payload as { affectedThreadIds: string[] };
    assert.equal(payload.affectedThreadIds.length, 150);
    assert.ok(payload.affectedThreadIds.includes('thr_archived'));
    assert.ok(!payload.affectedThreadIds.includes('thr_child_10'));
    assert.ok(calls.every(call => call.includeHidden === true));
    assert.ok(calls.some(call => call.offset === 100));
  } finally { await result.harness.lifecycle.dispose(); }
});

for (const scenario of ['failure', 'wide', 'deep'] as const) test(`descendant ${scenario} uses project invalidation instead of partial results`, async () => {
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: { threads: {
    get: ({ threadId }) => makeThreadResponse({ id: threadId }),
    list: args => {
      if (scenario === 'failure') throw new Error('Failed listing');
      if (args?.archived) return [];
      if (scenario === 'wide') return args?.parentThreadId === 'thr_root'
        ? Array.from({ length: 201 }, (_, i) => makeThreadResponse({ id: `thr_child_${i}` })).slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 0)) : [];
      const depth = args?.parentThreadId === 'thr_root' ? 0 : Number(args?.parentThreadId?.slice(10));
      return depth < 65 ? [makeThreadResponse({ id: `thr_depth_${depth + 1}` })] : [];
    },
  } } });
  await plugin(result.bb);
  try {
    await result.harness.behavior.callRpc('set', { threadId: 'thr_root', face: ':-)' });
    assert.deepEqual(result.harness.inspection.realtimeSignals.filter(s => s.channel === 'changed').at(-1)!.payload, { projectId: 'project-1' });
  } finally { await result.harness.lifecycle.dispose(); }
});


test('v3 saved envelope and RPC read validate snapshots independently of generator version', async () => {
  const { harness, bb } = await host();
  try {
    const identity = generatedFaceV3Schema.parse({ version: 3, family: 'robot', templateId: 'robot-basic', personality: 'calm',
      outline: ['[', ']'], eyePair: ['o', 'o'], mouth: '_', layers: {}, capabilities: { builtInAppendages: false, allowedLayers: [] },
      blinkOffset: 0, base: { idle: '[o_o]', running: '[o-o]', waiting: '[o?o]', error: '[oxo]' } });
    await bb.storage.kv.set(`thread:${first}`, { version: 3, kind: 'generated', seed: 0, identity });
    const value = await harness.behavior.callRpc('get', { threadId: first }) as import('./server.ts').Identity;
    assert.deepEqual(value.generated, identity);
    assert.equal(value.face, '[o_o]');
    await bb.storage.kv.set(`thread:${first}`, { version: 3, kind: 'generated', seed: 0, identity: { ...identity, templateId: 'x'.repeat(65) } });
    assert.equal((await harness.behavior.callRpc('get', { threadId: first }) as import('./server.ts').Identity).generated?.version, 3);
  } finally { await harness.lifecycle.dispose(); }
});

test('generation and previews are frozen and inherit complete same-family eyes', async () => {
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: { threads: { get: ({ threadId }) => makeThreadResponse({ id: threadId, parentThreadId: threadId === 'thr_child' ? 'thr_parent' : null }) } } });
  await plugin(result.bb);
  const { harness } = result;
  try {
    // A saved version-2 parent contributes its single eyes value as a symmetric pair.
    const parentV2 = generateFace('thr_parent', 'robot');
    await result.bb.storage.kv.set('thread:thr_parent', { version: 2, kind: 'generated', seed: 0, identity: parentV2 });
    const previews = await harness.behavior.callRpc('previews', { threadId: 'thr_child' }) as { family: string; face: string }[];
    assert.equal((await harness.behavior.callRpc('get', { threadId: 'thr_child' }) as import('./server.ts').Identity).generated?.version, 3);
    const child = await harness.behavior.callRpc('generate', { threadId: 'thr_child', family: 'robot' }) as import('./server.ts').Identity;
    assert.equal(child.generated?.version, 3);
    if (child.generated?.version !== 3) throw new Error('Wrong version');
    assert.deepEqual(child.generated.eyePair, [parentV2.eyes, parentV2.eyes]);
    assert.equal(child.face, previews.find(p => p.family === 'robot')!.face);
    const reloaded = (await harness.lifecycle.reload(plugin)).harness;
    assert.deepEqual(await reloaded.behavior.callRpc('get', { threadId: 'thr_child' }), child);
    const command = await reloaded.behavior.runCli(['generate', '--thread', 'thr_child', '--json']);
    assert.equal(JSON.parse(command.stdout!).generated.version, 3);
    const again = await reloaded.behavior.runCli(['generate', '--thread', 'thr_child', '--json']);
    assert.equal(JSON.parse(again.stdout!).generated.version, 3);
  } finally { await harness.lifecycle.dispose(); }
});

type CandidateBatch = { candidates: { token: string; face: string; generated: import('./faces.ts').GeneratedFaceV3 }[]; locks: { outline: boolean; eyes: boolean; mouth: boolean; accessory: boolean }; notice?: string };

test('variation drafts do not persist and exact Save preserves locked traits and embedded history', async () => {
  const { harness, bb } = await host();
  try {
    const original = await harness.behavior.callRpc('generate', { threadId: first }) as import('./server.ts').Identity;
    const stored = await bb.storage.kv.get(`thread:${first}`);
    const library = await harness.behavior.callRpc('getLibrary', {});
    const batch = await harness.behavior.callRpc('candidates', { threadId: first, locks: { eyes: true, accessory: true }, resemblance: 'wide' }) as CandidateBatch;
    assert.ok(batch.candidates.length > 0);
    assert.deepEqual(await bb.storage.kv.get(`thread:${first}`), stored);
    assert.deepEqual(await harness.behavior.callRpc('getLibrary', {}), library);
    const selected = batch.candidates[0]!;
    const applied = await harness.behavior.callRpc('applyCandidate', { threadId: first, token: selected.token }) as import('./server.ts').Identity;
    assert.deepEqual(applied.generated, selected.generated);
    assert.equal(applied.face, selected.face);
    if (original.generated?.version !== 3 || applied.generated?.version !== 3) throw new Error('Expected v3');
    assert.deepEqual(applied.generated.eyePair, original.generated.eyePair);
    assert.deepEqual(applied.generated.layers, original.generated.layers);
    assert.equal(applied.generated.accessory, original.generated.accessory);
    assert.equal(applied.generated.personality, original.generated.personality);
    assert.equal((await bb.storage.kv.get(`thread:${first}`) as { history: string[] }).history.length, 1);
    assert.ok(!('history' in applied));
    await assert.rejects(harness.behavior.callRpc('applyCandidate', { threadId: first, token: selected.token }), /PREVIEW_EXPIRED/);
    const varied = await harness.behavior.callRpc('vary', { threadId: first }) as import('./server.ts').Identity;
    assert.equal(varied.generated?.version, 3);
    assert.notEqual(varied.face, applied.face);
    const exhausted = await harness.behavior.callRpc('candidates', { threadId: first, locks: { outline: true, eyes: true, mouth: true, accessory: true } }) as CandidateBatch;
    assert.equal(exhausted.candidates.length, 0);
    assert.ok(exhausted.notice);
  } finally { await harness.lifecycle.dispose(); }
});

test('preview tokens expire on context changes, TTL, perthread cap, reset and reload', async () => {
  const { harness } = await host();
  try {
    await harness.behavior.callRpc('generate', { threadId: first });
    const draft = async () => (await harness.behavior.callRpc('candidates', { threadId: first, resemblance: 'wide' }) as CandidateBatch).candidates[0]!.token;
    const contextToken = await draft();
    await harness.behavior.callRpc('setProjectDefault', { threadId: first, family: 'cat' });
    await assert.rejects(harness.behavior.callRpc('applyCandidate', { threadId: first, token: contextToken }), /PREVIEW_EXPIRED/);
    const ttlToken = await draft();
    const originalNow = Date.now;
    try {
      Date.now = () => originalNow() + 300001;
      await assert.rejects(harness.behavior.callRpc('applyCandidate', { threadId: first, token: ttlToken }), /PREVIEW_EXPIRED/);
    } finally { Date.now = originalNow; }
    const capped = await draft();
    await draft(); await draft();
    await assert.rejects(harness.behavior.callRpc('applyCandidate', { threadId: first, token: capped }), /PREVIEW_EXPIRED/);
    const reloadToken = await draft();
    const otherWorker = await host();
    try { await assert.rejects(otherWorker.harness.behavior.callRpc('applyCandidate', { threadId: first, token: reloadToken }), /PREVIEW_EXPIRED/); }
    finally { await otherWorker.harness.lifecycle.dispose(); }
    const next = (await harness.lifecycle.reload(plugin)).harness;
    await assert.rejects(next.behavior.callRpc('applyCandidate', { threadId: first, token: reloadToken }), /PREVIEW_EXPIRED/);
    const resetToken = (await next.behavior.callRpc('candidates', { threadId: first }) as CandidateBatch).candidates[0]!.token;
    await next.behavior.callRpc('reset', { threadId: first });
    await assert.rejects(next.behavior.callRpc('applyCandidate', { threadId: first, token: resetToken }), /PREVIEW_EXPIRED/);
  } finally { await harness.lifecycle.dispose(); }
});

test('thread deletion cancels a pending save and queued save before cleanup', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const block = new Promise<void>(resolve => { release = resolve; });
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: { threads: { get: async ({ threadId }) => { entered(); await block; return makeThreadResponse({ id: threadId }); } } } });
  await plugin(result.bb);
  try {
    const pending = result.harness.behavior.callRpc('set', { threadId: first, face: ':-)' });
    const rejected = assert.rejects(pending, /THREAD_DELETED/);
    await started;
    const queued = result.harness.behavior.callRpc('set', { threadId: first, face: '[o_o]' });
    const queuedRejected = assert.rejects(queued, /THREAD_DELETED/);
    const deletion = result.harness.behavior.emitThreadEvent('thread.deleted', { thread: makeThreadResponse({ id: first }) });
    release();
    await Promise.all([rejected, queuedRejected, deletion]);
    assert.ok((await result.bb.storage.kv.get(`thread:${first}`)) == null);
  } finally { await result.harness.lifecycle.dispose(); }
});

test('generation defaults inherit fields, preserve pinned snapshots and reset cleanly', async () => {
  const { harness, bb } = await host();
  try {
    await harness.behavior.setSettings({ defaultGlyphProfile: 'ascii' });
    const defaults = await harness.behavior.callRpc('getGenerationDefaults', { threadId: first }) as { glyphProfile: string; glyphProfileOrigin: string; glyphProfileOverride: null };
    assert.equal(defaults.glyphProfile, 'ascii'); assert.equal(defaults.glyphProfileOrigin, 'global'); assert.equal(defaults.glyphProfileOverride, null);
    const automatic = await harness.behavior.callRpc('get', { threadId: first }) as import('./server.ts').Identity;
    assert.equal(automatic.generated?.version, 3); assert.equal(automatic.glyphProfile, 'ascii'); assert.match(automatic.face, /^[ -~]+$/);
    const pinned = await harness.behavior.callRpc('generate', { threadId: first, glyphProfile: 'ascii' }) as import('./server.ts').Identity;
    const preview = await harness.behavior.callRpc('candidates', { threadId: first }) as CandidateBatch;
    assert.ok(preview.candidates.every(candidate => /^[ -~]+$/.test(candidate.face)));
    const varied = await harness.behavior.callRpc('vary', { threadId: first }) as import('./server.ts').Identity;
    assert.equal(varied.glyphProfile, 'ascii'); assert.match(varied.face, /^[ -~]+$/);
    await harness.behavior.callRpc('setGenerationDefaults', { threadId: first, glyphProfile: 'unicode' });
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), varied);
    const reset = await harness.behavior.callRpc('reset', { threadId: first }) as import('./server.ts').Identity;
    assert.equal(reset.generated?.version, 3); assert.equal(reset.glyphProfile, 'unicode');
    await harness.behavior.callRpc('setGenerationDefaults', { threadId: first, glyphProfile: null });
    assert.equal((await harness.behavior.callRpc('get', { threadId: first }) as import('./server.ts').Identity).glyphProfile, 'ascii');
    assert.equal((await harness.behavior.callRpc('generate', { threadId: first }) as import('./server.ts').Identity).generated?.version, 3);
    // A stale per-project edition key from an older build is ignored and cleaned up.
    await bb.storage.kv.set('project:project-1:edition', 'legacy');
    assert.equal((await harness.behavior.callRpc('getGenerationDefaults', { threadId: first }) as { glyphProfile: string }).glyphProfile, 'ascii');
    assert.equal(await bb.storage.kv.get('project:project-1:edition'), undefined);
    assert.equal(pinned.glyphProfile, 'ascii');
  } finally { await harness.lifecycle.dispose(); }
});

test('character library RPC reuses exact snapshots and ASCII profile; malformed canonical prevents thread mutations', async () => {
  const { harness, bb } = await host();
  try {
    const original = await harness.behavior.callRpc('generate', { threadId: first, glyphProfile: 'ascii' }) as import('./server.ts').Identity;
    const library = await harness.behavior.callRpc('favoriteCharacter', { threadId: first, saved: true }) as import('./library.ts').LibraryView;
    const entry = library.favorites[0]!;
    assert.equal(entry.kind, 'generated');
    if (entry.kind !== 'generated') throw new Error('Expected character');
    const reused = await harness.behavior.callRpc('applyLibraryCharacter', { threadId: second, snapshotId: entry.snapshotId }) as import('./server.ts').Identity;
    assert.deepEqual(reused.generated, original.generated); assert.equal(reused.glyphProfile, 'ascii'); assert.equal(reused.face, original.face);
    await harness.behavior.callRpc('favorite', { face: original.face, saved: true });
    const both = await harness.behavior.callRpc('getLibrary', {}) as import('./library.ts').LibraryView;
    assert.equal(both.favorites.length, 2);
    await harness.behavior.callRpc('removeLibraryEntry', { entry });
    assert.equal((await harness.behavior.callRpc('getLibrary', {}) as import('./library.ts').LibraryView).favorites[0]!.kind, 'text');
    const stored = await bb.storage.kv.get(`thread:${first}`);
    await bb.storage.kv.set('library:v2', { version: 999 });
    await assert.rejects(harness.behavior.callRpc('set', { threadId: first, face: ':-)' }), /LIBRARY_INVALID/);
    await assert.rejects(harness.behavior.callRpc('generate', { threadId: first }), /LIBRARY_INVALID/);
    assert.deepEqual(await bb.storage.kv.get(`thread:${first}`), stored);
  } finally { await harness.lifecycle.dispose(); }
});

test('global token cap evicts oldest previews without KV token keys', async () => {
  const { harness, bb } = await host();
  try {
    const base = await harness.behavior.callRpc('generate', { threadId: first }) as import('./server.ts').Identity;
    let firstToken = '';
    for (let i = 0; i < 201; i++) {
      const threadId = `thr_cache_${i}`;
      await bb.storage.kv.set(`thread:${threadId}`, { version: 3, kind: 'generated', seed: 0, identity: base.generated });
      const batch = await harness.behavior.callRpc('candidates', { threadId, resemblance: 'wide' }) as CandidateBatch;
      assert.equal(batch.candidates.length, 6);
      if (i === 0) firstToken = batch.candidates[0]!.token;
    }
    await assert.rejects(harness.behavior.callRpc('applyCandidate', { threadId: 'thr_cache_0', token: firstToken }), /PREVIEW_EXPIRED/);
    assert.ok((await bb.storage.kv.list()).every(key => !key.includes('token') && !key.includes('history')));
  } finally { await harness.lifecycle.dispose(); }
});

test('overlapping exact Save consumes once and saved variation history stays at twenty', async () => {
  const { harness, bb } = await host();
  try {
    await harness.behavior.callRpc('generate', { threadId: first });
    const batch = await harness.behavior.callRpc('candidates', { threadId: first }) as CandidateBatch;
    const input = { threadId: first, token: batch.candidates[0]!.token };
    const saved = await Promise.allSettled([harness.behavior.callRpc('applyCandidate', input), harness.behavior.callRpc('applyCandidate', input)]);
    assert.equal(saved.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(saved.filter(result => result.status === 'rejected').length, 1);
    for (let i = 0; i < 25; i++) await harness.behavior.callRpc('vary', { threadId: first, resemblance: 'wide' });
    const choice = await bb.storage.kv.get(`thread:${first}`) as { history: string[] };
    assert.equal(choice.history.length, 20);
    assert.equal(new Set(choice.history).size, 20);
  } finally { await harness.lifecycle.dispose(); }
});

test('separate native settings saves retain visible automatic faces and leave pinned snapshots fixed', async () => {
  const { harness } = await host();
  try {
    const pinned = await harness.behavior.callRpc('generate', { threadId: first });
    await harness.behavior.setSettings({ defaultGlyphProfile: 'ascii' });
    const fallback = await harness.behavior.callRpc('getMany', { threadIds: [first, second] }) as import('./server.ts').Identity[];
    assert.equal(fallback.length, 2); assert.deepEqual(fallback[0], pinned);
    assert.equal(fallback[1]!.generated?.version, 3); assert.equal(fallback[1]!.glyphProfile, 'ascii');
    const defaults = await harness.behavior.callRpc('getGenerationDefaults', { threadId: second }) as { glyphProfile: string; glyphProfileOrigin: string; glyphProfileOverride: null };
    assert.equal(defaults.glyphProfile, 'ascii'); assert.equal(defaults.glyphProfileOrigin, 'global'); assert.equal(defaults.glyphProfileOverride, null);
    await harness.behavior.setSettings({ defaultGlyphProfile: 'unicode' });
    const restored = await harness.behavior.callRpc('get', { threadId: second }) as import('./server.ts').Identity;
    assert.equal(restored.generated?.version, 3); assert.equal(restored.glyphProfile, 'unicode');
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), pinned);
  } finally { await harness.lifecycle.dispose(); }
});

test('a missing parent does not disable saved-character variation previews', async () => {
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: { threads: { get: ({ threadId }) => {
    if (threadId === 'thr_missing_parent') throw new Error('Missing parent');
    return makeThreadResponse({ id: threadId, parentThreadId: 'thr_missing_parent' });
  } } } });
  await plugin(result.bb);
  try {
    await result.harness.behavior.callRpc('generate', { threadId: first });
    const batch = await result.harness.behavior.callRpc('candidates', { threadId: first }) as CandidateBatch;
    assert.ok(batch.candidates.length); assert.equal(batch.locks.eyes, false);
    const applied = await result.harness.behavior.callRpc('applyCandidate', { threadId: first, token: batch.candidates[0]!.token }) as import('./server.ts').Identity;
    assert.deepEqual(applied.generated, batch.candidates[0]!.generated);
  } finally { await result.harness.lifecycle.dispose(); }
});

test('queued deletion prevents a legacy read migration from recreating storage', async () => {
  const { harness, bb } = await host();
  const kv = bb.storage.kv, originalGet = kv.get;
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const block = new Promise<void>(resolve => { release = resolve; });
  try {
    await kv.set(`thread:${first}`, { version: 1, kind: 'generated' });
    let reads = 0;
    kv.get = (async (name: string) => {
      const value = await originalGet(name);
      if (name === `thread:${first}` && ++reads === 3) { entered(); await block; }
      return value;
    }) as typeof kv.get;
    const pending = harness.behavior.callRpc('get', { threadId: first });
    const rejection = assert.rejects(pending, /THREAD_DELETED/);
    await started;
    const deletion = harness.behavior.emitThreadEvent('thread.deleted', { thread: makeThreadResponse({ id: first }) });
    release();
    await Promise.all([rejection, deletion]);
    assert.ok((await originalGet(`thread:${first}`)) == null);
  } finally { kv.get = originalGet; await harness.lifecycle.dispose(); }
});

test('migration while Vary owns the thread mutation queue does not deadlock', { timeout: 2000 }, async () => {
  const { harness, bb } = await host();
  try {
    await bb.storage.kv.set(`thread:${first}`, { version: 1, kind: 'generated' });
    const varied = await harness.behavior.callRpc('vary', { threadId: first }) as import('./server.ts').Identity;
    assert.equal(varied.generated?.version, 3);
  } finally { await harness.lifecycle.dispose(); }
});

test('CLI explicit character favorite rejects text instead of silently saving text', async () => {
  const { harness } = await host();
  try {
    await harness.behavior.callRpc('set', { threadId: first, face: ':-)' });
    const result = await harness.behavior.runCli(['favorite', '--thread', first, '--character']);
    assert.notEqual(result.exitCode, 0); assert.match(result.stderr ?? '', /CHARACTER_UNAVAILABLE/);
    assert.equal((await harness.behavior.callRpc('getLibrary', {}) as import('./library.ts').LibraryView).favorites.length, 0);
  } finally { await harness.lifecycle.dispose(); }
});
