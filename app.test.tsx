// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { loadPluginApp, mountPluginContentScripts, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import appDefinition, { Face } from './app.js';
import type { rpcContract } from './server.js';
import { useFaceClock } from './hooks/useFaceClock.js';
import { generateFace, renderFace, type FaceFamily } from './faces.js';
import { generateFaceV3 } from './family-definitions.js';
import { libraryEntryKey } from './library-shared.js';
import type { LibraryView } from './library.js';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';

Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: vi.fn().mockImplementation(() => ({
  matches: false, addEventListener() {}, removeEventListener() {},
})) });
afterEach(cleanup);

async function mount(settings: Record<string, string | boolean> = {}) {
  const app = await loadPluginApp(appDefinition);
  let face = ':-)';
  let projectOverride: FaceFamily | null = null;
  const effectiveFamily = () => projectOverride ?? 'classic';
  const slot = renderSlot<PluginThreadHeaderActionProps, typeof rpcContract>(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { showActivity: false, ...settings },
    rpc: {
      getProjectDefault: () => ({ family: effectiveFamily(), origin: (projectOverride ? 'project' : 'global') as 'project' | 'global', override: projectOverride }),
      getGenerationDefaults: () => ({ glyphProfile: 'unicode', glyphProfileOrigin: 'global', glyphProfileOverride: null }),
      setGenerationDefaults: () => ({ glyphProfile: 'unicode', glyphProfileOrigin: 'global', glyphProfileOverride: null }),
      previews: ({ threadId }) => ['classic', 'bear', 'robot', 'cat', 'minimal'].map(family => ({ family: family as FaceFamily, face: renderFace(generateFace(threadId, family as FaceFamily)) })),
      getLibrary: () => ({ favorites: [], recent: [] }),
      candidates: () => ({ candidates: [], locks: { outline: false, eyes: false, mouth: false, accessory: false } }),
      applyCandidate: ({ threadId }) => ({ threadId, face, projectId: 'proj_personal', source: 'custom' as const }),
      favorite: ({ face, expressions, saved }) => ({ favorites: saved ? [{ kind: 'text' as const, face, ...(expressions ? { expressions } : {}) }] : [], recent: [] }),
      favoriteCharacter: () => ({ favorites: [], recent: [] }),
      removeLibraryEntry: () => ({ favorites: [], recent: [] }),
      applyLibraryCharacter: ({ threadId }) => ({ threadId, face, projectId: 'proj_personal', source: 'custom' as const }),
      reviewLibrary: () => ({ favorites: [], recent: [] }),
      reconcileLibrary: () => ({ favorites: [], recent: [] }),
      vary: ({ threadId }) => { const generated = generateFace(threadId, effectiveFamily()); face = renderFace(generated); return { threadId, face, projectId: 'proj_personal', source: 'generated' as const, generated }; },
      setProjectDefault: ({ family }: { family: FaceFamily | null }) => { projectOverride = family; return { family: effectiveFamily(), origin: (projectOverride ? 'project' : 'global') as 'project' | 'global', override: projectOverride }; },
      generate: ({ threadId, family }) => { const generated = generateFace(threadId, family ?? effectiveFamily()); face = renderFace(generated); return { threadId, face, projectId: 'proj_personal', source: 'custom' as const, generated }; },
      activity: ({ threadIds }) => threadIds.map(threadId => ({ threadId, state: 'running' as const })),
      getMany: ({ threadIds }) => threadIds.map(threadId => ({ threadId, face, projectId: 'proj_personal', source: 'custom' as const })),
      get: ({ threadId }: {threadId:string}) => ({ threadId, face, projectId: 'proj_personal', source: 'custom' as const }),
      set: ({ threadId, face: next }: {threadId:string;face:string}) => { face = next; return { threadId, face, projectId: 'proj_personal', source: 'custom' as const }; },
      reset: ({ threadId }: {threadId:string}) => { face = '[o_o]'; return { threadId, face, projectId: 'proj_personal', source: 'automatic' as const }; },
      shuffle: ({ threadId }: {threadId:string}) => { face = 'ʕ•ᴥ•ʔ'; return { threadId, face, projectId: 'proj_personal', source: 'custom' as const }; },
    },
  });
  await screen.findByRole('button', { name: settings.showActivity ? 'Change thread asciimoji: :-), running' : 'Change thread asciimoji: :-)' });
  return { slot, update: (next: string) => { face = next; } };
}


function selectPickerTab(name: 'Presets' | 'Characters' | 'Custom' | 'Saved') {
  fireEvent.click(screen.getByRole('tab', { name }));
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
    settings: { showHeader: false }, rpc: { get: () => ({ threadId: 'thr_one', face: ':-)', projectId: 'proj_personal', source: 'automatic' as const }) },
  });
  expect(screen.queryByRole('button', { name: /Change thread asciimoji/ })).toBeNull();
  slot.lifecycle.unmount();
});

test('optional sidebar faces follow updates and clean up on disposal', async () => {
  const app = await loadPluginApp(appDefinition);
  const row = document.createElement('div');
  row.dataset.sidebarThreadShortcutTarget = '';
  row.dataset.sidebarThreadId = 'thr_one';
  row.textContent = 'Original title';
  document.body.append(row);
  const scripts = await mountPluginContentScripts(app, { pluginId: 'asciimoji' });
  let face = ':-)';
  const slot = renderSlot(app.appOverlays[0]!, {}, {
    settings: { showSidebar: true, animation: 'playful', useThemeColor: true },
    rpc: { getMany: () => [{ threadId: 'thr_one', face, projectId: 'proj_personal', source: 'custom' as const }] },
  });
  await waitFor(() => expect(row.textContent).toBe(':-)Original title'));
  expect(row.querySelector('[data-motion="playful"]')).toBeTruthy();
  expect(row.querySelector('.text-primary')).toBeTruthy();
  face = '[o_o]';
  await slot.behavior.emitRealtime('changed', { projectId: 'proj_personal' });
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

test('sidebar falls back to an id-bearing title row when the shortcut attribute is missing', async () => {
  const app = await loadPluginApp(appDefinition);
  const row = document.createElement('div');
  row.dataset.sidebarThreadId = 'thr_one';
  row.innerHTML = '<span class="bb-thread-title">Fallback title</span>';
  document.body.append(row);
  const scripts = await mountPluginContentScripts(app, { pluginId: 'asciimoji' });
  const slot = renderSlot(app.appOverlays[0]!, {}, {
    settings: { showSidebar: true, showActivity: false },
    rpc: { getMany: () => [{ threadId: 'thr_one', face: 'ʕ•ᴥ•ʔ', projectId: 'proj_personal', source: 'preset' as const }] },
  });
  try {
    await waitFor(() => expect(row.textContent).toBe('ʕ•ᴥ•ʔFallback title'));
    const title = row.querySelector('.bb-thread-title')!;
    expect(row.querySelector('[data-asciimoji-slot]')?.nextSibling).toBe(title);
  } finally {
    slot.lifecycle.unmount();
    await scripts.lifecycle.dispose();
    expect(row.querySelector('[data-asciimoji-slot]')).toBeNull();
    row.remove();
  }
});

test('fallback title wrapped by a host link is decorated outside the link', async () => {
  const app = await loadPluginApp(appDefinition);
  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.innerHTML = '<a href="/threads/thr_one" data-sidebar-thread-id="thr_one"><span class="bb-thread-title">Linked title</span></a>';
  document.body.append(wrapper);
  const link = wrapper.querySelector('a')!;
  const scripts = await mountPluginContentScripts(app, { pluginId: 'asciimoji' });
  const slot = renderSlot(app.appOverlays[0]!, {}, {
    settings: { showSidebar: true, showActivity: false },
    rpc: { getMany: () => [{ threadId: 'thr_one', face: ':-)', projectId: 'proj_personal', source: 'preset' as const }] },
  });
  try {
    const face = await screen.findByRole('button', { name: 'Change sidebar asciimoji :-) for thr_one' });
    expect(link.contains(face)).toBe(false);
    expect(face.closest('[data-asciimoji-slot]')?.nextSibling).toBe(link);
    expect(wrapper.textContent).toBe(':-)Linked title');
  } finally { slot.lifecycle.unmount(); await scripts.lifecycle.dispose(); wrapper.remove(); }
});

test('nested fallback and shortcut rows decorate the shortcut only once', async () => {
  const app = await loadPluginApp(appDefinition);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = '<div data-sidebar-thread-id="thr_one"><a data-sidebar-thread-id="thr_one" data-sidebar-thread-shortcut-target href="/threads/thr_one"><span class="bb-thread-title">Nested title</span></a></div>';
  document.body.append(wrapper);
  const scripts = await mountPluginContentScripts(app, { pluginId: 'asciimoji' });
  const slot = renderSlot(app.appOverlays[0]!, {}, {
    settings: { showSidebar: true, showActivity: false },
    rpc: { getMany: () => [{ threadId: 'thr_one', face: ':)', projectId: 'proj_personal', source: 'preset' as const }] },
  });
  try {
    await screen.findByRole('button', { name: 'Change sidebar asciimoji :) for thr_one' });
    expect(wrapper.querySelectorAll('[data-asciimoji-slot]')).toHaveLength(1);
  } finally { slot.lifecycle.unmount(); await scripts.lifecycle.dispose(); wrapper.remove(); }
});

test('unknown sidebar layouts are ignored instead of inserting unsafe controls', async () => {
  const app = await loadPluginApp(appDefinition);
  const row = document.createElement('a');
  row.href = '/threads/thr_one';
  row.dataset.sidebarThreadId = 'thr_one';
  row.textContent = 'Unknown host layout';
  document.body.append(row);
  const scripts = await mountPluginContentScripts(app, { pluginId: 'asciimoji' });
  const slot = renderSlot(app.appOverlays[0]!, {}, {
    settings: { showSidebar: true },
    rpc: { getMany: () => { throw new Error('Unknown rows must not be queried'); } },
  });
  try {
    expect(row.querySelector('[data-asciimoji-slot]')).toBeNull();
    expect(row.textContent).toBe('Unknown host layout');
  } finally { slot.lifecycle.unmount(); await scripts.lifecycle.dispose(); row.remove(); }
});

test('sidebar is off by default', async () => {
  const app = await loadPluginApp(appDefinition);
  const row = document.createElement('div');
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
    rpc: { getMany: () => [{ threadId: 'thr_one', face: ':-)', projectId: 'proj_personal', source: 'custom' as const }] },
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


test('generated picker choice renders activity without changing the saved base face', async () => {
  const { slot } = await mount({ showActivity: true, animation: 'off' });
  fireEvent.click(await screen.findByRole('button', { name: 'Change thread asciimoji: :-), running' }));
  selectPickerTab('Characters');
  fireEvent.click(await screen.findByRole('button', { name: 'Keep Classic family' }));
  const generated = generateFace('thr_one');
  const button = await screen.findByRole('button', { name: `Change thread asciimoji: ${renderFace(generated)}, running` });
  expect(button.textContent).toBe(renderFace(generated, { state: 'running' }));
  expect(slot.inspection.rpcCalls.some(call => call.method === 'generate')).toBe(true);
  slot.lifecycle.unmount();
});

test('activity follows host notifications without changing custom text', async () => {
  const app = await loadPluginApp(appDefinition);
  let state: 'running' | 'waiting' | 'idle' = 'running';
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { showActivity: true, animation: 'off' }, rpc: {
      get: () => ({ threadId: 'thr_one', face: ':-)', projectId: 'proj_personal', source: 'custom' as const }),
      activity: () => [{ threadId: 'thr_one', state }],
    },
  });
  const button = await screen.findByRole('button', { name: 'Change thread asciimoji: :-), running' });
  expect(button.textContent).toBe(':-)·');
  state = 'waiting';
  await slot.behavior.emitRealtime('activity', { threadId: 'thr_one' });
  await screen.findByRole('button', { name: 'Change thread asciimoji: :-), waiting' });
  expect(button.textContent).toBe(':-)?');
  state = 'idle';
  await slot.behavior.emitRealtime('activity', { threadId: 'thr_one' });
  await screen.findByRole('button', { name: 'Change thread asciimoji: :-), idle' });
  expect(button.textContent).toBe(':-)');
  slot.lifecycle.unmount();
});

test('one animation clock pauses for hidden windows and reduced motion and disposes on unmount', () => {
  vi.useFakeTimers();
  const originalMedia = window.matchMedia;
  let reduced = false;
  let changed: (() => void) | undefined;
  const remove = vi.fn();
  window.matchMedia = vi.fn(() => ({
    get matches() { return reduced; },
    media: '(prefers-reduced-motion: reduce)', onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => true,
    addEventListener: (_: string, callback: EventListenerOrEventListenerObject) => { changed = callback as () => void; },
    removeEventListener: remove,
  } as MediaQueryList));
  function Probe() { return <span>{useFaceClock(true)}</span>; }
  const view = render(<><Probe /><Probe /></>);
  try {
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(500));
    expect(view.container.textContent).not.toBe('00');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(vi.getTimerCount()).toBe(0);
    expect(view.container.textContent).toBe('00');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(vi.getTimerCount()).toBe(1);
    reduced = true;
    act(() => changed?.());
    expect(vi.getTimerCount()).toBe(0);
    reduced = false;
    act(() => changed?.());
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalled();
  } finally {
    view.unmount();
    delete (document as unknown as { hidden?: boolean }).hidden;
    window.matchMedia = originalMedia;
    vi.useRealTimers();
  }
});

test('generated identities and activity are automatic without opt-in settings', async () => {
  const app = await loadPluginApp(appDefinition);
  const generated = generateFace('thr_one');
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    rpc: {
      get: () => ({ threadId: 'thr_one', face: renderFace(generated), projectId: 'proj_personal', source: 'automatic' as const, generated }),
      activity: () => [{ threadId: 'thr_one', state: 'waiting' }],
    },
  });
  try {
    const button = await screen.findByRole('button', { name: `Change thread asciimoji: ${renderFace(generated)}, waiting` });
    expect(button.textContent).toBe(renderFace(generated, { state: 'waiting' }));
    fireEvent.click(button);
    const reset = await screen.findByRole('button', { name: 'Use automatic face' });
    expect((reset as HTMLButtonElement).disabled).toBe(true);
  } finally { slot.lifecycle.unmount(); }
});


test('family selection saves a generated thread override', async () => {
  const { slot } = await mount();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' }));
    selectPickerTab('Characters');
    fireEvent.click(await screen.findByRole('button', { name: 'Keep Bears family' }));
    const expected = renderFace(generateFace('thr_one', 'bear'));
    await screen.findByRole('button', { name: `Change thread asciimoji: ${expected}` });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(slot.inspection.rpcCalls.some(call => call.method === 'generate' && (call.input as {family:string}).family === 'bear')).toBe(true);
  } finally { slot.lifecycle.unmount(); }
});

test('project default can be changed in the picker and project signals refresh faces', async () => {
  const { slot, update } = await mount();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' }));
    fireEvent.click(await screen.findByText('Project defaults'));
    const select = await screen.findByRole('combobox', { name: 'Project default face family' });
    await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(select, { target: { value: 'robot' } });
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('robot'));
    expect(slot.inspection.rpcCalls.some(call => call.method === 'setProjectDefault' && (call.input as {family:string}).family === 'robot')).toBe(true);
    update('[•_•]');
    await slot.behavior.emitRealtime('changed', { projectId: 'proj_personal' });
    await screen.findByRole('button', { name: 'Change thread asciimoji: [•_•]', hidden: true });
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('robot'));
  } finally { slot.lifecycle.unmount(); }
});


test('a rejected project default save keeps the previous selection and shows an error', async () => {
  const app = await loadPluginApp(appDefinition);
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { showActivity: false },
    rpc: {
      get: () => ({ threadId: 'thr_one', face: ':-)', projectId: 'proj_personal', source: 'automatic' as const }),
      getProjectDefault: () => ({ family: 'bear' as const, origin: 'project' as const, override: 'bear' as const }),
      setProjectDefault: () => { throw new Error('Save failed'); },
    },
  });
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Change thread asciimoji: :-)' }));
    fireEvent.click(await screen.findByText('Project defaults'));
    const select = await screen.findByRole('combobox', { name: 'Project default face family' });
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('bear'));
    fireEvent.change(select, { target: { value: 'cat' } });
    expect(await screen.findByText(/Could not update the project default.*Save failed/)).toBeTruthy();
    expect((select as HTMLSelectElement).value).toBe('bear');
    expect((select as HTMLSelectElement).disabled).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});


test('draft validation and activity previews agree with the saved custom expression map', async () => {
  const { slot } = await mount({ animation: 'off' });
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' }));
    selectPickerTab('Custom');
    const input = await screen.findByRole('textbox', { name: 'Custom asciimoji' });
    fireEvent.change(input, { target: { value: '\u2800' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Enter a visible face/)).toBeTruthy();
    fireEvent.change(input, { target: { value: '😀'.repeat(40) } });
    expect(screen.getByText('40/40 characters')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(input, { target: { value: '😀'.repeat(41) } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: ':)' } });
    fireEvent.click(screen.getByText('Custom activity expressions'));
    fireEvent.change(screen.getByRole('textbox', { name: 'waiting expression' }), { target: { value: ':?' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Preview activity' }), { target: { value: 'waiting' } });
    expect(screen.getByLabelText('Draft asciimoji preview').textContent).toBe(':?');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const call = slot.inspection.rpcCalls.find(call => call.method === 'set')!;
    expect(call.input).toEqual({ threadId: 'thr_one', face: ':)', expressions: { waiting: ':?' } });
  } finally { slot.lifecycle.unmount(); }
});

test('custom activity mappings render in the header and fall back to markers for unmapped states', async () => {
  const app = await loadPluginApp(appDefinition);
  let state: 'running' | 'waiting' = 'waiting';
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { animation: 'off' }, rpc: {
      get: () => ({ threadId: 'thr_one', projectId: 'proj_personal', source: 'custom', face: ':)', expressions: { waiting: ':?' } }),
      activity: () => [{ threadId: 'thr_one', state }],
    },
  });
  try {
    const button = await screen.findByRole('button', { name: 'Change thread asciimoji: :), waiting' });
    expect(button.textContent).toBe(':?');
    state = 'running';
    await slot.behavior.emitRealtime('activity', { threadId: 'thr_one' });
    await screen.findByRole('button', { name: 'Change thread asciimoji: :), running' });
    expect(button.textContent).toBe(':)·');
  } finally { slot.lifecycle.unmount(); }
});

test('favorites update live and reuse their activity expressions', async () => {
  const app = await loadPluginApp(appDefinition);
  let favorites = [{ face: ':)', expressions: { waiting: ':?' } }];
  let applied: unknown;
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { showActivity: false }, rpc: {
      get: () => ({ threadId: 'thr_one', projectId: 'proj_personal', source: 'custom', face: ':D' }),
      getLibrary: () => ({ favorites, recent: [{ face: ':-)' }] }),
      favorite: (input: unknown) => {
        const { face, saved } = input as {face:string;saved:boolean};
        favorites = saved ? [...favorites, { face, expressions: { waiting: ':?' } }] : favorites.filter(item => item.face !== face);
        return { favorites, recent: [] };
      },
      set: (input: unknown) => { applied = input; return { threadId: 'thr_one', projectId: 'proj_personal', source: 'custom', ...input as {face:string} }; },
      getProjectDefault: () => ({ family: 'classic' as const, origin: 'global' as const, override: null }),
      previews: () => [],
    },
  });
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Change thread asciimoji: :D' }));
    selectPickerTab('Saved');
    fireEvent.click(await screen.findByRole('button', { name: 'Save text' }));
    await screen.findByRole('button', { name: 'Reuse favorite: :D (waiting :?)' });
    favorites = [{ face: ':-)', expressions: { waiting: ':?' } }];
    await slot.behavior.emitRealtime('library', {});
    expect(await screen.findByRole('button', { name: 'Reuse favorite: :-) (waiting :?)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reuse favorite: :D (waiting :?)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reuse favorite: :-) (waiting :?)' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(applied).toEqual({ threadId: 'thr_one', face: ':-)', expressions: { waiting: ':?' } });
  } finally { slot.lifecycle.unmount(); }
});

test('failed loading exposes retry without displaying an invented identity', async () => {
  const app = await loadPluginApp(appDefinition);
  let failed = true;
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { showActivity: false }, rpc: {
      get: () => { if (failed) throw new Error('Offline'); return { threadId: 'thr_one', projectId: 'proj_personal', source: 'preset', face: ':-)' }; },
    },
  });
  try {
    const retry = await screen.findByRole('button', { name: 'Retry thread asciimoji' });
    expect(screen.queryByRole('button', { name: /Change thread asciimoji/ })).toBeNull();
    failed = false;
    fireEvent.click(retry);
    await screen.findByRole('button', { name: 'Change thread asciimoji: :-)' });
  } finally { slot.lifecycle.unmount(); }
});

test('sidebar opens the shared picker with a hidden header, outside the host link', async () => {
  const app = await loadPluginApp(appDefinition);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = '<a href="/threads/thr_one" data-sidebar-thread-shortcut-target data-sidebar-thread-id="thr_one">Original title</a>';
  document.body.append(wrapper);
  const row = wrapper.querySelector('a')!;
  const navigate = vi.fn();
  row.addEventListener('click', navigate);
  const scripts = await mountPluginContentScripts(app, { pluginId: 'asciimoji' });
  const identity = { threadId: 'thr_one', projectId: 'proj_personal', source: 'preset', face: ':-)' };
  const slot = renderSlot(app.appOverlays[0]!, {}, {
    settings: { showSidebar: true, showHeader: false, showActivity: false, animation: 'off' },
    rpc: {
      getMany: () => [identity], get: () => identity,
      previews: () => [], getLibrary: () => ({ favorites: [], recent: [] }), getProjectDefault: () => ({ family: 'classic' as const, origin: 'global' as const, override: null }),
    },
  });
  try {
    const button = await screen.findByRole('button', { name: 'Change sidebar asciimoji :-) for thr_one' });
    expect(row.contains(button)).toBe(false);
    fireEvent.click(button);
    expect(navigate).not.toHaveBeenCalled();
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Change thread asciimoji: :-)' })).toBeNull();
    expect(screen.getByLabelText('Current asciimoji').textContent).toBe(':-)');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
  } finally { slot.lifecycle.unmount(); await scripts.lifecycle.dispose(); wrapper.remove(); }
});

test('header and 100 sidebar faces share a read and refresh only the changed thread', async () => {
  const app = await loadPluginApp(appDefinition);
  const wrapper = document.createElement('div');
  const ids = Array.from({ length: 100 }, (_, index) => index ? 'thr_row_' + index : 'thr_one');
  for (const id of ids) {
    const row = document.createElement('div');
    row.dataset.sidebarThreadShortcutTarget = '';
    row.dataset.sidebarThreadId = id;
    row.textContent = id;
    wrapper.append(row);
  }
  document.body.append(wrapper);
  const scripts = await mountPluginContentScripts(app, { pluginId: 'asciimoji' });
  const activity = vi.fn((input: unknown) => (input as {threadIds:string[]}).threadIds.map(threadId => ({ threadId, state: 'running' })));
  const identity = (threadId: string) => ({ threadId, projectId: 'proj_personal', source: 'preset', face: ':-)' });
  const header = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { animation: 'off' }, rpc: { get: (input: unknown) => identity((input as {threadId:string}).threadId), activity },
  });
  const sidebar = renderSlot(app.appOverlays[0]!, {}, {
    settings: { showSidebar: true, animation: 'off' }, rpc: {
      getMany: (input: unknown) => (input as {threadIds:string[]}).threadIds.map(identity), activity,
    },
  });
  try {
    await screen.findByRole('button', { name: 'Change sidebar asciimoji :-) for thr_row_99, running' });
    expect(activity).toHaveBeenCalledTimes(1);
    expect(new Set((activity.mock.calls[0]![0] as {threadIds:string[]}).threadIds).size).toBe(100);
    await header.behavior.emitRealtime('activity', { threadId: 'thr_one' });
    await sidebar.behavior.emitRealtime('activity', { threadId: 'thr_one' });
    await waitFor(() => expect(activity).toHaveBeenCalledTimes(2));
    expect(activity.mock.calls[1]![0]).toEqual({ threadIds: ['thr_one'] });
    await header.behavior.setRealtimeConnectionState('reconnecting');
    await header.behavior.setRealtimeConnectionState('connected');
    await waitFor(() => expect(activity).toHaveBeenCalledTimes(3));
    expect(activity.mock.calls[2]![0]).toEqual({ threadIds: ['thr_one'] });
  } finally { header.lifecycle.unmount(); sidebar.lifecycle.unmount(); await scripts.lifecycle.dispose(); wrapper.remove(); }
});

test('mounted automatic child refreshes when its parent changes', async () => {
  const app = await loadPluginApp(appDefinition);
  let face = '(•ω•)';
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_child', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { showActivity: false },
    rpc: { get: () => ({ threadId: 'thr_child', face, projectId: 'proj_personal', source: 'automatic' as const }) },
  });
  try {
    await screen.findByRole('button', { name: 'Change thread asciimoji: (•ω•)' });
    face = '(^ω^)';
    await slot.behavior.emitRealtime('changed', { threadId: 'thr_parent', affectedThreadIds: ['thr_child'] });
    await screen.findByRole('button', { name: 'Change thread asciimoji: (^ω^)' });
  } finally { slot.lifecycle.unmount(); }
});

test('sidebar refreshes only the changed thread and ignores other projects', async () => {
  const app = await loadPluginApp(appDefinition);
  const wrapper = document.createElement('div');
  for (const id of ['thr_one', 'thr_two']) {
    const row = document.createElement('div');
    row.dataset.sidebarThreadShortcutTarget = '';
    row.dataset.sidebarThreadId = id;
    row.textContent = id;
    wrapper.append(row);
  }
  document.body.append(wrapper);
  const scripts = await mountPluginContentScripts(app, { pluginId: 'asciimoji' });
  const faces: Record<string, string> = { thr_one: ':-)', thr_two: ':-)' };
  const getMany = vi.fn((input: unknown) => (input as { threadIds: string[] }).threadIds.map(threadId => ({
    threadId, face: faces[threadId]!, projectId: threadId === 'thr_one' ? 'proj_one' : 'proj_two', source: 'custom' as const,
  })));
  const get = vi.fn((input: unknown) => {
    const { threadId } = input as { threadId: string };
    return { threadId, face: faces[threadId]!, projectId: threadId === 'thr_one' ? 'proj_one' : 'proj_two', source: 'custom' as const };
  });
  const slot = renderSlot(app.appOverlays[0]!, {}, {
    settings: { showSidebar: true, showActivity: false, animation: 'off' },
    rpc: { getMany, get, activity: () => [] },
  });
  try {
    await waitFor(() => expect(getMany).toHaveBeenCalledTimes(1));
    faces['thr_one'] = '[o_o]';
    await slot.behavior.emitRealtime('changed', { threadId: 'thr_one' });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith({ threadId: 'thr_one' });
    expect(getMany).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(wrapper.textContent).toContain('[o_o]'));
    // A project-default change for an unrepresented project must not refetch.
    await slot.behavior.emitRealtime('changed', { projectId: 'proj_other' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(getMany).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  } finally { slot.lifecycle.unmount(); await scripts.lifecycle.dispose(); wrapper.remove(); }
});

test('favorites with identical text remain distinguishable', async () => {
  const app = await loadPluginApp(appDefinition);
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { showActivity: false }, rpc: {
      get: () => ({ threadId: 'thr_one', projectId: 'proj_personal', source: 'custom', face: ':D' }),
      getLibrary: () => ({ favorites: [{ face: ':-)' }, { face: ':-)', expressions: { running: ':D' } }], recent: [] }),
      favorite: () => ({ favorites: [], recent: [] }),
      set: (input: unknown) => ({ threadId: 'thr_one', projectId: 'proj_personal', source: 'custom', ...input as { face: string } }),
      getProjectDefault: () => ({ family: 'classic' as const, origin: 'global' as const, override: null }),
      previews: () => [],
    },
  });
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Change thread asciimoji: :D' }));
    selectPickerTab('Saved');
    expect(await screen.findByRole('button', { name: 'Reuse favorite: :-)' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Reuse favorite: :-) (running :D)' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Remove favorite: :-)' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Remove favorite: :-) (running :D)' })).toBeTruthy();
  } finally { slot.lifecycle.unmount(); }
});

test('saved classic identities are not relabeled with the project default family', async () => {
  const app = await loadPluginApp(appDefinition);
  const saved = { version: 2 as const, family: 'classic' as const, ears: ['(', ')'] as [string, string], eyes: '•', mouth: 'ω', blinkOffset: 0 };
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { showActivity: false }, rpc: {
      get: () => ({ threadId: 'thr_one', projectId: 'proj_personal', source: 'generated' as const, face: '(•ω•)', generated: saved }),
      getProjectDefault: () => ({ family: 'robot' as const, origin: 'project' as const, override: 'robot' as const }),
      previews: () => [],
      getLibrary: () => ({ favorites: [], recent: [] }),
    },
  });
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Change thread asciimoji: (•ω•)' }));
    expect(await screen.findByText('Saved for this thread: Classic')).toBeTruthy();
  } finally { slot.lifecycle.unmount(); }
});

test('sidebar width applies via data attributes and truncates long faces', async () => {
  const app = await loadPluginApp(appDefinition);
  const row = document.createElement('div');
  row.dataset.sidebarThreadShortcutTarget = '';
  row.dataset.sidebarThreadId = 'thr_one';
  row.textContent = 'Title';
  document.body.append(row);
  const scripts = await mountPluginContentScripts(app, { pluginId: 'asciimoji' });
  for (const width of ['compact', 'standard', 'expanded'] as const) {
    const slot = renderSlot(app.appOverlays[0]!, {}, {
      settings: { showSidebar: true, showActivity: false, animation: 'off', sidebarWidth: width },
      rpc: { getMany: () => [{ threadId: 'thr_one', face: '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', projectId: 'proj_personal', source: 'custom' as const }] },
    });
    try {
      await waitFor(() => expect(row.querySelector(`[data-sidebar-width="${width}"]`)).toBeTruthy());
      const face = row.querySelector('[data-sidebar-width]')!;
      expect(face.getAttribute('title')).toBe('(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧');
      expect(face.getAttribute('aria-label')).toBe('(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧');
    } finally { slot.lifecycle.unmount(); }
  }
  await scripts.lifecycle.dispose();
  row.remove();
});

test('activity markers mode keeps static faces with status symbols', async () => {
  const app = await loadPluginApp(appDefinition);
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { showActivity: true, activityStyle: 'markers', animation: 'off' }, rpc: {
      get: () => ({ threadId: 'thr_one', projectId: 'proj_personal', source: 'custom', face: ':)', expressions: { waiting: ':?' } }),
      activity: () => [{ threadId: 'thr_one', state: 'waiting' }],
    },
  });
  try {
    const button = await screen.findByRole('button', { name: 'Change thread asciimoji: :), waiting' });
    expect(button.textContent).toBe(':)?');
  } finally { slot.lifecycle.unmount(); }
});

test('project picker offers global default and labels automatic scope', async () => {
  const { slot } = await mount();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' }));
    fireEvent.click(await screen.findByText('Project defaults'));
    const select = await screen.findByRole('combobox', { name: 'Project default face family' });
    await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
    expect(within(select).getByRole('option', { name: /Use global default/ })).toBeTruthy();
    fireEvent.change(select, { target: { value: 'global' } });
    await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === 'setProjectDefault' && (call.input as {family:string|null}).family === null)).toBe(true));
    expect(await screen.findByRole('button', { name: 'Use automatic face' })).toBeTruthy();
  } finally { slot.lifecycle.unmount(); }
});

test('settings preview renders states without backend RPC', async () => {
  const app = await loadPluginApp(appDefinition);
  const rpc = vi.fn(() => { throw new Error('preview must not call RPC'); });
  const slot = renderSlot(app.settingsSections[0]!, {}, {
    settings: { showActivity: true, activityStyle: 'expressions', sidebarWidth: 'compact', animation: 'off', defaultFamily: 'bear' },
    rpc: {},
  });
  try {
    const preview = await screen.findByLabelText('Asciimoji appearance preview');
    expect(preview.textContent).toContain('idle');
    expect(preview.textContent).toContain('running');
    expect(preview.textContent).toContain('Sidebar truncation');
    const family = screen.getByRole('combobox', { name: 'Preview face family' });
    fireEvent.change(family, { target: { value: 'cat' } });
    expect((family as HTMLSelectElement).value).toBe('cat');
    expect(rpc).not.toHaveBeenCalled(); // preview uses local generation only
    expect(preview.querySelectorAll('[data-generated-version="3"]').length).toBe(8);
    const width = screen.getByRole('combobox', { name: 'Preview sidebar width' });
    fireEvent.change(width, { target: { value: 'expanded' } });
    await waitFor(() => expect(document.querySelector('[data-sidebar-width="expanded"]')).toBeTruthy());
  } finally { slot.lifecycle.unmount(); }
});

test('expanded faces use saved compact geometry and reserve marker space', () => {
  const generated = generateFaceV3('compact-preview', 'cat');
  const face = renderFace(generated);
  const { container, rerender } = render(<Face face={face} generated={generated} state="waiting" animation="off" useThemeColor={false} sidebar activityStyle="markers" />);
  expect(container.textContent).toBe(generated.renderings!.compact!.idle + '?');
  expect(container.querySelector('.asciimoji-face')?.getAttribute('aria-label')).toBe(face + ', waiting');
  rerender(<Face face={face} generated={generated} state="error" animation="off" useThemeColor={false} sidebar />);
  expect(container.textContent).toBe(generated.renderings!.compact!.error + '!');
  rerender(<Face face={face} generated={generated} state="running" animation="off" useThemeColor={false} />);
  expect(container.textContent).toBe((generated.renderings?.expressive?.running ?? generated.base.running) + '·');
});

test('family previews load drafts and only generate after choosing a family', async () => {
  const { slot } = await mount();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' }));
    await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === 'previews')).toBe(true));
    expect(slot.inspection.rpcCalls.some(call => call.method === 'generate')).toBe(false);
    selectPickerTab('Characters');
    fireEvent.click(await screen.findByRole('button', { name: 'Keep Cats family' }));
    await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === 'generate' && JSON.stringify(call.input) === JSON.stringify({ threadId: 'thr_one', family: 'cat' }))).toBe(true));
  } finally { slot.lifecycle.unmount(); }
});

async function mountGallery(expire = false) {
  const app = await loadPluginApp(appDefinition);
  const generated = generateFaceV3('gallery', 'cat');
  const options = [generated, generateFaceV3('gallery', 'cat', { seed: 1 })];
  const identity = { threadId: 'thr_one', face: renderFace(generated), projectId: 'proj_personal', source: 'generated' as const, generated };
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { showActivity: false, animation: 'off' }, rpc: {
      get: () => identity,
      previews: () => [],
      getProjectDefault: () => ({ family: 'cat', origin: 'global', override: null }),
      getLibrary: () => ({ favorites: [], recent: [] }),
      candidates: () => ({ candidates: options.map((item, index) => ({ token: 'token-' + index, face: renderFace(item), generated: item })), locks: { outline: false, eyes: true, mouth: false, accessory: false } }),
      applyCandidate: (input: unknown) => {
        const { token } = input as { token: string };
        if (expire) throw new Error('PREVIEW_EXPIRED: Refresh previews');
        const item = options[Number(token.slice(-1))]!;
        return { ...identity, face: renderFace(item), generated: item };
      },
    },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Change thread asciimoji: ' + identity.face }));
  selectPickerTab('Characters');
  fireEvent.click(await screen.findByRole('button', { name: 'Explore variations' }));
  await screen.findByRole('radio', { name: 'Variation 1: ' + identity.face });
  return { slot, options };
}

test('variation gallery preserves drafts until explicit save and supports keyboard selection', async () => {
  const { slot, options } = await mountGallery();
  try {
    expect((screen.getByRole('checkbox', { name: 'Eye pair' }) as HTMLInputElement).checked).toBe(true);
    const first = screen.getByRole('radio', { name: 'Variation 1: ' + renderFace(options[0]!) });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Variation 2: ' + renderFace(options[1]!) }).getAttribute('aria-checked')).toBe('true');
    expect(slot.inspection.rpcCalls.some(call => call.method === 'applyCandidate')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save variation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(slot.inspection.rpcCalls.find(call => call.method === 'applyCandidate')?.input).toEqual({ threadId: 'thr_one', token: 'token-1' });
  } finally { slot.lifecycle.unmount(); }
});

test('variation cancellation discards drafts and restores trigger focus', async () => {
  const { slot } = await mountGallery();
  try {
    fireEvent.click(screen.getAllByRole('radio')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel variations' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Explore variations' })));
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(slot.inspection.rpcCalls.some(call => call.method === 'applyCandidate')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});

test('expired variation previews offer refresh without closing picker', async () => {
  const { slot } = await mountGallery(true);
  try {
    fireEvent.click(screen.getAllByRole('radio')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save variation' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Refresh previews');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh previews' }));
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'candidates')).toHaveLength(2);
  } finally { slot.lifecycle.unmount(); }
});

async function mountLibraryReview(stale = false, recents = false) {
  const app = await loadPluginApp(appDefinition);
  const generated = generateFaceV3('saved-character', 'bear');
  const face = renderFace(generated);
  const character = { kind: 'generated' as const, face, snapshotId: 'b'.repeat(64) };
  const added = { kind: 'text' as const, face: ':NEW' };
  const removed = { kind: 'text' as const, face };
  let view: LibraryView = { favorites: [character, { kind: 'text', face }], recent: [], legacyChanges: { fingerprint: 'a'.repeat(64), added: [added], removed: [removed] } };
  if (recents) view.legacyChanges = { fingerprint: 'a'.repeat(64), added: [], removed: [], recentAdded: [{ kind: 'text', face: ':RECENT' }], recentRemoved: [{ kind: 'text', face: ':OLD' }] };
  const identity = { threadId: 'thr_one', projectId: 'proj_personal', source: 'generated' as const, face, generated };
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: 'thr_one', projectId: 'proj_personal', isCompactViewport: false }, {
    settings: { showActivity: false, animation: 'off' }, rpc: {
      get: () => identity,
      getProjectDefault: () => ({ family: 'bear', origin: 'global', override: null }),
      previews: () => [],
      getLibrary: () => view,
      reviewLibrary: () => view,
      favoriteCharacter: () => view,
      applyLibraryCharacter: () => identity,
      removeLibraryEntry: () => view,
      reconcileLibrary: () => {
        if (stale) { view = { ...view, legacyChanges: { fingerprint: 'c'.repeat(64), added: [{ kind: 'text', face: ':LATEST' }], removed: [] } }; throw new Error('LEGACY_REVIEW_STALE: Refresh review.'); }
        view = { favorites: [character], recent: [] }; return view;
      },
    },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Change thread asciimoji: ' + face }));
  selectPickerTab('Saved');
  await screen.findByText('An older Asciimoji window changed the face library. Your saved characters are preserved.');
  return { slot, character, added, removed };
}

test('legacy library review imports selected text changes while preserving character entries', async () => {
  const { slot, character, added } = await mountLibraryReview();
  try {
    expect(screen.getByRole('button', { name: 'Reuse favorite: ' + character.face + ' (character)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reuse favorite: ' + character.face })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review text changes' }));
    const review = await screen.findByLabelText('Review older text changes');
    fireEvent.click(within(review).getByRole('checkbox', { name: ':NEW' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected text changes' }));
    await waitFor(() => expect(screen.queryByText('An older Asciimoji window changed the face library. Your saved characters are preserved.')).toBeNull());
    expect(slot.inspection.rpcCalls.find(call => call.method === 'reconcileLibrary')?.input).toEqual({ fingerprint: 'a'.repeat(64), add: [libraryEntryKey(added)], remove: [] });
    expect(screen.getByRole('button', { name: 'Reuse favorite: ' + character.face + ' (character)' })).toBeTruthy();
    expect(slot.inspection.rpcCalls.some(call => call.method === 'removeLibraryEntry')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});

test('stale library review refreshes text changes and clears selections', async () => {
  const { slot } = await mountLibraryReview(true);
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Review text changes' }));
    const review = await screen.findByLabelText('Review older text changes');
    fireEvent.click(within(review).getByRole('checkbox', { name: ':NEW' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected text changes' }));
    const latest = await screen.findByRole('checkbox', { name: ':LATEST' });
    expect((latest as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('checkbox', { name: ':NEW' })).toBeNull();
  } finally { slot.lifecycle.unmount(); }
});

test('character favorites use snapshot application and explicit saving', async () => {
  const { slot, character } = await mountLibraryReview();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Save character' }));
    await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === 'favoriteCharacter')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Reuse favorite: ' + character.face + ' (character)' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(slot.inspection.rpcCalls.find(call => call.method === 'applyLibraryCharacter')?.input).toEqual({ threadId: 'thr_one', snapshotId: character.snapshotId });
    expect(slot.inspection.rpcCalls.some(call => call.method === 'set')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});

test('ASCII drafts stay printable and settings preview contains printable ASCII', async () => {
  const { slot } = await mount();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Character glyph profile' }), { target: { value: 'ascii' } });
    await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === 'previews' && (call.input as { glyphProfile?: string }).glyphProfile === 'ascii')).toBe(true));
    expect(slot.inspection.rpcCalls.some(call => call.method === 'generate')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
  const app = await loadPluginApp(appDefinition);
  const settings = renderSlot(app.settingsSections[0]!, {}, { settings: { animation: 'off' }, rpc: {} });
  try {
    fireEvent.change(screen.getByRole('combobox', { name: 'Preview glyph profile' }), { target: { value: 'ascii' } });
    for (const element of Array.from(document.querySelectorAll('[data-generated-version="3"]'))) expect(element.textContent).toMatch(/^[ -~]+$/);
    expect(settings.inspection.rpcCalls).toHaveLength(0);
  } finally { settings.lifecycle.unmount(); }
});

test('project glyph override saves and restores', async () => {
  const { slot } = await mount();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' }));
    fireEvent.click(await screen.findByText('Project defaults'));
    const glyphs = await screen.findByRole('combobox', { name: 'Project default glyph profile' });
    await waitFor(() => expect((glyphs as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(glyphs, { target: { value: 'ascii' } });
    await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === 'setGenerationDefaults' && JSON.stringify(call.input) === JSON.stringify({ threadId: 'thr_one', glyphProfile: 'ascii' }))).toBe(true));
    fireEvent.change(glyphs, { target: { value: 'unicode' } });
    await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === 'setGenerationDefaults' && JSON.stringify(call.input) === JSON.stringify({ threadId: 'thr_one', glyphProfile: 'unicode' }))).toBe(true));
  } finally { slot.lifecycle.unmount(); }
});

test('Keep current library resolves older text discrepancy explicitly', async () => {
  const { slot, character } = await mountLibraryReview();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Keep current library' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Keep current library' })).toBeNull());
    expect(slot.inspection.rpcCalls.find(call => call.method === 'reconcileLibrary')?.input).toEqual({ fingerprint: 'a'.repeat(64), keepCurrent: true });
    expect(screen.getByRole('button', { name: 'Reuse favorite: ' + character.face + ' (character)' })).toBeTruthy();
  } finally { slot.lifecycle.unmount(); }
});

test('older recent-text changes require explicit review selection', async () => {
  const { slot } = await mountLibraryReview(false, true);
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Review text changes' }));
    const review = await screen.findByLabelText('Review older text changes');
    expect((within(review).getByRole('checkbox', { name: ':RECENT' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(review).getByRole('checkbox', { name: ':OLD' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected text changes' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Keep current library' })).toBeNull());
    expect(slot.inspection.rpcCalls.find(call => call.method === 'reconcileLibrary')?.input).toEqual({ fingerprint: 'a'.repeat(64), add: [], remove: [], recentAdd: [], recentRemove: [libraryEntryKey({ kind: 'text', face: ':OLD' })] });
  } finally { slot.lifecycle.unmount(); }
});

test('library fallback polls only while visible and stops when picker closes', async () => {
  const { slot } = await mount();
  vi.useFakeTimers();
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' })); });
    const count = () => slot.inspection.rpcCalls.filter(call => call.method === 'getLibrary').length;
    const initial = count();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(count()).toBe(initial + 1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(count()).toBe(initial + 1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })); });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(count()).toBe(initial + 1);
  } finally {
    slot.lifecycle.unmount();
    delete (document as unknown as { hidden?: boolean }).hidden;
    vi.useRealTimers();
  }
});


test('picker preset search filters faces and displays an empty state', async () => {
  const { slot } = await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' }));
  await screen.findByRole('dialog');
  expect(screen.getByLabelText('Current asciimoji')).toBeTruthy();
  const search = screen.getByRole('textbox', { name: 'Search preset faces' });
  fireEvent.change(search, { target: { value: 'bear' } });
  expect(screen.getByRole('button', { name: 'Choose Bear: ʕ•ᴥ•ʔ' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^Choose / })).toHaveLength(1);
  fireEvent.change(search, { target: { value: 'no-such-asciimoji' } });
  expect(screen.queryByRole('button', { name: /^Choose / })).toBeNull();
  expect(screen.getByText(/No faces match/)).toBeTruthy();
  slot.lifecycle.unmount();
});

test('picker tabs reveal only the chosen task and support keyboard navigation', async () => {
  const { slot } = await mount();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Change thread asciimoji: :-)' }));
    const presetsTab = await screen.findByRole('tab', { name: 'Presets' });
    expect(presetsTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Search preset faces' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Custom asciimoji' })).toBeNull();
    fireEvent.keyDown(presetsTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Characters' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('textbox', { name: 'Search preset faces' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Keep Classic family' })).toBeTruthy();
    selectPickerTab('Custom');
    expect(screen.getByRole('textbox', { name: 'Custom asciimoji' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep Classic family' })).toBeNull();
    selectPickerTab('Saved');
    expect(await screen.findByRole('button', { name: 'Save text' })).toBeTruthy();
  } finally { slot.lifecycle.unmount(); }
});
