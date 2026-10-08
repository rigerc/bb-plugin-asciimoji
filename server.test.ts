import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from './server.ts';
import { defaultFace, FACES, FAMILY_IDS, generateFace, generateFaceV2, renderFace } from './faces.ts';

const first = 'thr_first';
const second = 'thr_second';
const automatic = (threadId: string, family: Parameters<typeof generateFaceV2>[1] = 'classic') => generateFaceV2(threadId, family);
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
    assert.deepEqual(initial, { threadId: first, projectId: 'project-1', source: 'automatic', face: automaticFace(first), custom: false, generated: automatic(first) });
    await harness.behavior.callRpc('set', { threadId: first, face: 'ʕ•ᴥ•ʔ' });
    harness = (await harness.lifecycle.reload(plugin)).harness;
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), { threadId: first, projectId: 'project-1', source: 'preset', face: 'ʕ•ᴥ•ʔ', custom: true });
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: second }), { threadId: second, projectId: 'project-1', source: 'automatic', face: automaticFace(second), custom: false, generated: automatic(second) });
    assert.deepEqual(await harness.behavior.callRpc('reset', { threadId: first }), initial);
  } finally { await harness.lifecycle.dispose(); }
});

test('parent metadata identifies child threads across automatic and saved face choices', async () => {
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: {
    threads: { get: ({ threadId }) => makeThreadResponse({
      id: threadId, parentThreadId: threadId === 'thr_root' ? null : 'thr_root',
    }) },
  } });
  await plugin(result.bb);
  const { harness } = result;
  const get = (threadId: string) => harness.behavior.callRpc('get', { threadId }) as Promise<import('./server.ts').Identity>;
  try {
    assert.equal((await get('thr_root')).parentThreadId, undefined);
    assert.equal((await get('thr_child')).parentThreadId, 'thr_root');
    await harness.behavior.callRpc('set', { threadId: 'thr_child', face: ':-)' });
    assert.equal((await get('thr_child')).parentThreadId, 'thr_root', 'custom faces still mark child threads');
    await harness.behavior.callRpc('generate', { threadId: 'thr_child', family: 'bear' });
    assert.equal((await get('thr_child')).parentThreadId, 'thr_root', 'saved generated faces still mark child threads');
    const many = await harness.behavior.callRpc('getMany', { threadIds: ['thr_root', 'thr_child'] }) as import('./server.ts').Identity[];
    assert.deepEqual(many.map(identity => identity.parentThreadId), [undefined, 'thr_root']);
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
    assert.equal((await harness.behavior.callRpc('get', { threadId: first }) as {custom:boolean}).custom, false);
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
    assert.equal((await harness.behavior.callRpc('get', { threadId: first }) as {custom:boolean}).custom, false);
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
      { threadId: first, projectId: 'project-1', source: 'automatic', face: automaticFace(first), custom: false, generated: automatic(first) },
      { threadId: second, projectId: 'project-1', source: 'automatic', face: automaticFace(second), custom: false, generated: automatic(second) },
    ]);
    await assert.rejects(harness.behavior.callRpc('getMany', { threadIds: Array(201).fill(first) }));
  } finally { await harness.lifecycle.dispose(); }
});


test('generated choices survive reload, inherit parent eyes, and reset to the generated default', async () => {
  let { harness } = await host();
  try {
    const generated = await harness.behavior.callRpc('generate', { threadId: first });
    assert.deepEqual(generated, { threadId: first, projectId: 'project-1', source: 'generated', face: renderFace(automatic(first)), custom: true, generated: automatic(first) });
    harness = (await harness.lifecycle.reload(plugin)).harness;
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), generated);
    harness.inspection.sdk.stub('threads.get', ({ threadId }) => makeThreadResponse({ id: threadId, parentThreadId: threadId === first ? null : first }));
    const child = await harness.behavior.callRpc('generate', { threadId: second }) as { generated: { eyes: string } };
    assert.equal(child.generated.eyes, automatic(first).eyes);
    const cli = await harness.behavior.runCli(['generate', '--thread', second, '--json']);
    assert.equal(cli.exitCode, 0);
    assert.equal(JSON.parse(cli.stdout!).generated.version, 2);
    await harness.behavior.callRpc('set', { threadId: first, face: ':-)' });
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), { threadId: first, projectId: 'project-1', source: 'preset', face: ':-)', custom: true });
    const reset = await harness.behavior.callRpc('reset', { threadId: second });
    const expected = generateFaceV2(second);
    assert.deepEqual(reset, { threadId: second, projectId: 'project-1', source: 'automatic', face: renderFace(expected), custom: false, generated: expected });
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
        assert.equal([...frame].length, 5);
        assert.equal(frame[0], initial[0]);
        assert.equal(frame[2], initial[2]);
        assert.equal(frame[4], initial[4]);
      }
      assert.equal(renderFace(identity, { state, elapsed: 1000 }), renderFace(identity, { state }));
    }
    assert.equal(renderFace(identity), initial);
    assert.deepEqual(generateFace(`thr_${index}`), identity);
  }
});


test('each family is deterministic, varied, related, and supports every activity expression', () => {
  for (const family of FAMILY_IDS) {
    const parent = generateFace(first, null, family);
    const child = generateFace(second, first, family);
    assert.deepEqual(generateFace(first, null, family), parent);
    assert.equal(child.eyes, parent.eyes);
    const variants = new Set(Array.from({ length: 40 }, (_, i) => renderFace(generateFace(`thr_${i}`, null, family))));
    assert.ok(variants.size > 1, family);
    for (const state of ['idle', 'running', 'waiting', 'error'] as const) {
      assert.equal([...renderFace(child, { state, animation: true, elapsed: 800 })].length, 5);
    }
  }
  assert.deepEqual(generateFace(first), generateFace(first, null, 'classic'));
});

test('project defaults follow authoritative project membership; overrides and legacy choices persist', async () => {
  const result = createFakePluginHost({ pluginId: 'asciimoji', sdk: {
    threads: { get: async ({ threadId }) => {
      if (threadId === 'thr_missing') throw new Error('Thread not found');
      return makeThreadResponse({ id: threadId, projectId: threadId === 'thr_other_project' ? 'proj_other' : 'proj_one' });
    } },
  } });
  await plugin(result.bb);
  let { harness } = result;
  const read = (threadId: string) => harness.behavior.callRpc('get', { threadId }) as Promise<{face:string; custom:boolean; generated:ReturnType<typeof generateFace>}>;
  try {
    await result.bb.storage.kv.set(`thread:${first}`, { version: 1, kind: 'generated' });
    await harness.behavior.callRpc('set', { threadId: 'thr_custom', face: ':-)' });
    await harness.behavior.callRpc('generate', { threadId: 'thr_pinned', family: 'cat' });
    await harness.behavior.callRpc('setProjectDefault', { threadId: second, family: 'bear' });
    assert.deepEqual(await harness.behavior.callRpc('getProjectDefault', { threadId: second }), { family: 'bear', origin: 'project', override: 'bear' });
    assert.deepEqual((await read(second)).generated, automatic(second, 'bear'));
    assert.equal((await read(second)).custom, false);
    assert.equal((await read(first)).face, defaultFace(first));
    assert.equal((await read('thr_custom')).face, ':-)');
    assert.equal((await read('thr_pinned')).generated.family, 'cat');
    assert.equal((await read('thr_other_project')).face, automaticFace('thr_other_project'));
    assert.ok(harness.inspection.realtimeSignals.some(signal => signal.channel === 'changed' && (signal.payload as {projectId?:string}).projectId === 'proj_one'));
    harness = (await harness.lifecycle.reload(plugin)).harness;
    assert.equal((await read(second)).generated.family, 'bear');
    assert.equal((await read('thr_new')).generated.family, 'bear');
    await harness.behavior.callRpc('reset', { threadId: 'thr_pinned' });
    assert.equal((await read('thr_pinned')).generated.family, 'bear');
    assert.equal((await read('thr_pinned')).custom, false);
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
    assert.equal(root.generated!.eyes, child.generated!.eyes);
    assert.equal(child.generated!.eyes, grandchild.generated!.eyes);
    const previews = await harness.behavior.callRpc('previews', { threadId: 'thr_grandchild' }) as { family: string; face: string }[];
    for (const preview of previews) {
      const saved = await harness.behavior.callRpc('generate', { threadId: 'thr_grandchild', family: preview.family }) as { face: string };
      assert.equal(saved.face, preview.face);
    }
    const siblings = await Promise.all(Array.from({ length: 60 }, (_, index) => read('thr_sibling_' + index)));
    assert.ok(new Set(siblings.map(item => item.face)).size > 20, 'siblings remain visually distinct');
    assert.ok(siblings.every(item => item.generated!.eyes === child.generated!.eyes));
  } finally { await harness.lifecycle.dispose(); }
});

test('legacy saved identities stay unchanged and new variations persist as snapshots', async () => {
  const result = await host();
  let { harness } = result;
  try {
    for (const family of FAMILY_IDS) {
      await result.bb.storage.kv.set('thread:' + first, { version: 1, kind: 'generated', family });
      const legacy = await harness.behavior.callRpc('get', { threadId: first }) as { face: string };
      assert.equal(legacy.face, renderFace(generateFace(first, null, family)));
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

test('v2 expression frames keep their geometry while increasing family variety', () => {
  for (const family of FAMILY_IDS) {
    const siblings = new Set<string>();
    for (let index = 0; index < 200; index++) {
      const identity = generateFaceV2('thr_' + index, family, { inheritedEyes: '^' });
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
  const generated = generateFaceV2('thr_demo', 'classic');
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
