// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { loadPluginApp, mountPluginContentScripts, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import appDefinition from './app.js';
import type { rpcContract } from './server.js';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';

Object.defineProperty(window, 'matchMedia', { value: vi.fn().mockImplementation(() => ({
  matches: false, addEventListener() {}, removeEventListener() {},
})) });
afterEach(cleanup);

async function mount(settings: Record<string, string | boolean> = {}) {
  const app = await loadPluginApp(appDefinition);
  let face = ':-)';
  const slot = renderSlot<PluginThreadHeaderActionProps, typeof rpcContract>(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings,
    rpc: {
      getMany: ({ threadIds }) => threadIds.map(threadId => ({ threadId, face, custom: true })),
      get: ({ threadId }: {threadId:string}) => ({ threadId, face, custom: true }),
      set: ({ threadId, face: next }: {threadId:string;face:string}) => { face = next; return { threadId, face, custom: true }; },
      reset: ({ threadId }: {threadId:string}) => { face = '[o_o]'; return { threadId, face, custom: false }; },
      shuffle: ({ threadId }: {threadId:string}) => { face = 'ʕ•ᴥ•ʔ'; return { threadId, face, custom: true }; },
    },
  });
  await screen.findByRole('button', { name: 'Change thread asciimoji: :-)' });
  return { slot, update: (next: string) => { face = next; } };
}

test('opens picker, saves a preset and closes', async () => {
  const { slot } = await mount();
  expect(screen.getByText(':-)').classList.contains('text-primary')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Choose Bear: ʕ•ᴥ•ʔ' }));
  await screen.findByRole('button', { name: 'Change thread asciimoji: ʕ•ᴥ•ʔ' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(slot.inspection.rpcCalls.some(call => call.method === 'set' && (call.input as {threadId:string}).threadId === 'thr_one')).toBe(true);
  slot.lifecycle.unmount();
});

test('updates only for this thread and refetches after reconnection', async () => {
  const { slot, update } = await mount();
  update('[o_o]');
  await slot.behavior.emitRealtime('changed', { threadId: 'thr_other' });
  expect(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' })).toBeTruthy();
  await slot.behavior.emitRealtime('changed', { threadId: 'thr_one' });
  await screen.findByRole('button', { name: 'Change thread asciimoji: [o_o]' });
  await slot.behavior.setRealtimeConnectionState('reconnecting');
  update('ʕ•ᴥ•ʔ');
  await slot.behavior.setRealtimeConnectionState('connected');
  await screen.findByRole('button', { name: 'Change thread asciimoji: ʕ•ᴥ•ʔ' });
  slot.lifecycle.unmount();
});

test('display preferences are applied to the header and picker faces', async () => {
  const { slot } = await mount({ animation: 'off', useThemeColor: true });
  expect(screen.getByText(':-)').getAttribute('data-motion')).toBe('off');
  expect(screen.getByText(':-)').classList.contains('text-primary')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' }));
  await screen.findByRole('dialog');
  expect(screen.getByRole('button', { name: 'Choose Bear: ʕ•ᴥ•ʔ' }).querySelector('.text-primary')).toBeTruthy();
  slot.lifecycle.unmount();
});

test('header visibility is configurable', async () => {
  const app = await loadPluginApp(appDefinition);
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { showHeader: false }, rpc: { get: () => ({ threadId: 'thr_one', face: ':-)', custom: false }) },
  });
  expect(screen.queryByRole('button', { name: /Change thread asciimoji/ })).toBeNull();
  slot.lifecycle.unmount();
});

test('optional sidebar faces follow updates and clean up on disposal', async () => {
  const app = await loadPluginApp(appDefinition);
  const row = document.createElement('a');
  row.dataset.sidebarThreadShortcutTarget = '';
  row.dataset.sidebarThreadId = 'thr_one';
  row.textContent = 'Original title';
  document.body.append(row);
  const scripts = await mountPluginContentScripts(app, { pluginId: 'asciimoji' });
  let face = ':-)';
  const slot = renderSlot(app.appOverlays[0]!, {}, {
    settings: { showSidebar: true, animation: 'playful', useThemeColor: true },
    rpc: { getMany: () => [{ threadId: 'thr_one', face, custom: true }] },
  });
  await waitFor(() => expect(row.textContent).toBe(':-)Original title'));
  expect(row.querySelector('[data-motion="playful"]')).toBeTruthy();
  expect(row.querySelector('.text-primary')).toBeTruthy();
  face = '[o_o]';
  await slot.behavior.emitRealtime('changed', { threadId: 'thr_one' });
  await waitFor(() => expect(row.textContent).toBe('[o_o]Original title'));
  const addedRow = row.cloneNode(false) as HTMLElement;
  addedRow.dataset.sidebarThreadId = 'thr_two';
  addedRow.textContent = 'Second title';
  document.body.append(addedRow);
  await waitFor(() => expect(addedRow.querySelector('[data-asciimoji-slot]')).toBeTruthy());
  slot.lifecycle.unmount();
  await scripts.lifecycle.dispose();
  expect(row.textContent).toBe('Original title');
  expect(document.querySelector('[data-asciimoji-slot]')).toBeNull();
  row.remove(); addedRow.remove();
});

test('sidebar is off by default', async () => {
  const app = await loadPluginApp(appDefinition);
  const row = document.createElement('a');
  row.dataset.sidebarThreadShortcutTarget = '';
  row.dataset.sidebarThreadId = 'thr_one';
  document.body.append(row);
  const scripts = await mountPluginContentScripts(app, { pluginId: 'asciimoji' });
  const slot = renderSlot(app.appOverlays[0]!, {}, {});
  expect(row.querySelector('[data-asciimoji-slot]')).toBeNull();
  slot.lifecycle.unmount();
  await scripts.lifecycle.dispose();
  row.remove();
});

test('sidebar face reserves space beside the visible title instead of inside BB’s overlay link', async () => {
  const app = await loadPluginApp(appDefinition);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = '<a data-sidebar-thread-shortcut-target="" data-sidebar-thread-id="thr_one" data-sidebar-rename-anchor="" style="position:absolute;inset:0"></a><span style="display:flex"><span class="bb-thread-title">Original title</span></span>';
  document.body.append(wrapper);
  const anchor = wrapper.querySelector('a')!;
  const title = wrapper.querySelector('.bb-thread-title')!;
  const scripts = await mountPluginContentScripts(app, { pluginId: 'asciimoji' });
  const slot = renderSlot(app.appOverlays[0]!, {}, {
    settings: { showSidebar: true, animation: 'off' },
    rpc: { getMany: () => [{ threadId: 'thr_one', face: ':-)', custom: true }] },
  });
  try {
    await waitFor(() => expect(wrapper.textContent).toBe(':-)Original title'));
    const faceSlot = wrapper.querySelector<HTMLElement>('[data-asciimoji-slot]')!;
    expect(anchor.childNodes.length).toBe(0);
    expect(faceSlot.parentElement).toBe(title.parentElement);
    expect(faceSlot.nextSibling).toBe(title);
    expect(faceSlot.style.flexShrink).toBe('0');
    const parent = title.parentElement!;
    title.remove();
    await waitFor(() => expect(wrapper.querySelector('[data-asciimoji-slot]')).toBeNull());
    parent.append(title);
    await waitFor(() => expect(wrapper.textContent).toBe(':-)Original title'));
  } finally {
    slot.lifecycle.unmount();
    await scripts.lifecycle.dispose();
    wrapper.remove();
  }
});
