import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from './server.ts';
import { defaultFace, FACES, generateFace, renderFace } from './faces.ts';

const first = 'thr_first';
const second = 'thr_second';
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
    assert.deepEqual(initial, { threadId: first, face: defaultFace(first), custom: false, generated: generateFace(first) });
    await harness.behavior.callRpc('set', { threadId: first, face: 'ʕ•ᴥ•ʔ' });
    harness = (await harness.lifecycle.reload(plugin)).harness;
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), { threadId: first, face: 'ʕ•ᴥ•ʔ', custom: true });
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: second }), { threadId: second, face: defaultFace(second), custom: false, generated: generateFace(second) });
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
    await harness.behavior.setSettings({ showHeader: false, showSidebar: true, useThemeColor: true, animation: 'playful' });
    harness = (await harness.lifecycle.reload(plugin)).harness;
    await harness.behavior.setSettings({ animation: 'off' });
    await assert.rejects(harness.behavior.setSettings({ animation: 'invalid' }));
    const result = await harness.behavior.callRpc('getMany', { threadIds: [first, first, second, 'thr_missing'] });
    assert.deepEqual(result, [
      { threadId: first, face: defaultFace(first), custom: false, generated: generateFace(first) },
      { threadId: second, face: defaultFace(second), custom: false, generated: generateFace(second) },
    ]);
    await assert.rejects(harness.behavior.callRpc('getMany', { threadIds: Array(201).fill(first) }));
  } finally { await harness.lifecycle.dispose(); }
});


test('generated choices survive reload, inherit parent eyes, and reset to the generated default', async () => {
  let { harness } = await host();
  try {
    const generated = await harness.behavior.callRpc('generate', { threadId: first });
    assert.deepEqual(generated, { threadId: first, face: renderFace(generateFace(first)), custom: true, generated: generateFace(first) });
    harness = (await harness.lifecycle.reload(plugin)).harness;
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), generated);
    harness.inspection.sdk.stub('threads.get', ({ threadId }) => makeThreadResponse({ id: threadId, parentThreadId: first }));
    const child = await harness.behavior.callRpc('generate', { threadId: second }) as { generated: { eyes: string } };
    assert.equal(child.generated.eyes, generateFace(first).eyes);
    const cli = await harness.behavior.runCli(['generate', '--thread', second, '--json']);
    assert.equal(cli.exitCode, 0);
    assert.equal(JSON.parse(cli.stdout!).generated.version, 1);
    await harness.behavior.callRpc('set', { threadId: first, face: ':-)' });
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), { threadId: first, face: ':-)', custom: true });
    const reset = await harness.behavior.callRpc('reset', { threadId: second });
    assert.deepEqual(reset, { threadId: second, face: defaultFace(second, first), custom: false, generated: generateFace(second, first) });
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
