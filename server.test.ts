import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from './server.ts';
import { defaultFace, FACES } from './faces.ts';

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
    assert.deepEqual(initial, { threadId: first, face: defaultFace(first), custom: false });
    await harness.behavior.callRpc('set', { threadId: first, face: 'ʕ•ᴥ•ʔ' });
    harness = (await harness.lifecycle.reload(plugin)).harness;
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: first }), { threadId: first, face: 'ʕ•ᴥ•ʔ', custom: true });
    assert.deepEqual(await harness.behavior.callRpc('get', { threadId: second }), { threadId: second, face: defaultFace(second), custom: false });
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
      { threadId: first, face: defaultFace(first), custom: false },
      { threadId: second, face: defaultFace(second), custom: false },
    ]);
    await assert.rejects(harness.behavior.callRpc('getMany', { threadIds: Array(201).fill(first) }));
  } finally { await harness.lifecycle.dispose(); }
});
