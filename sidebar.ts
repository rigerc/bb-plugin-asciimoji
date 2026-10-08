import type { PluginContentScriptContext } from '@get-bb/plugin-sdk';

type Target = { threadId: string; element: HTMLSpanElement };
let targets: readonly Target[] = [];
const listeners = new Set<() => void>();
let configure: ((enabled: boolean) => void) | undefined;
let enabled = false;
export function subscribeTargets(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const getTargets = () => targets;
export function enableSidebar(value: boolean) {
  enabled = value;
  configure?.(value);
}
function publish(next: readonly Target[]) {
  targets = next;
  for (const listener of listeners) listener();
}

export function mountSidebar({ signal }: PluginContentScriptContext) {
  const owned = new Map<HTMLElement, Target>();
  function clear() {
    for (const target of owned.values()) target.element.remove();
    owned.clear();
    if (targets.length) publish([]);
  }
  function placement(row: HTMLElement) {
    // BB's shortcut anchor is an absolute click target, not the title layout.
    const title = row.parentElement?.querySelector<HTMLElement>('.bb-thread-title');
    if (title?.parentElement && !row.contains(title)) return { parent: title.parentElement, before: title };
    // Leave BB's inline rename editor undecorated.
    if (row.hasAttribute('data-sidebar-rename-anchor') || getComputedStyle(row).position === 'absolute') return null;
    return { parent: row, before: null };
  }
  function place(element: HTMLElement, location: NonNullable<ReturnType<typeof placement>>) {
    if (location.before) {
      if (element.parentElement !== location.parent || element.nextSibling !== location.before) {
        location.parent.insertBefore(element, location.before);
      }
    } else if (location.parent.firstChild !== element) location.parent.prepend(element);
  }
  function scan() {
    if (signal.aborted || !enabled) return;
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-sidebar-thread-shortcut-target][data-sidebar-thread-id]'));
    const present = new Set(rows);
    let changed = false;
    for (const [row, target] of owned) {
      const location = placement(row);
      if (!present.has(row) || row.dataset.sidebarThreadId !== target.threadId || !location) {
        target.element.remove(); owned.delete(row); changed = true;
      } else place(target.element, location);
    }
    for (const row of rows) {
      const threadId = row.dataset.sidebarThreadId;
      if (!threadId || !/^thr_[a-zA-Z0-9_-]+$/.test(threadId) || owned.has(row)) continue;
      const location = placement(row);
      if (!location) continue;
      const element = document.createElement('span');
      element.dataset.asciimojiSlot = '';
      element.style.flexShrink = '0';
      element.style.display = 'inline-flex';
      element.style.alignItems = 'center';
      element.style.alignSelf = 'center';
      place(element, location);
      owned.set(row, { threadId, element });
      changed = true;
    }
    if (changed) publish([...owned.values()]);
  }
  const observer = new MutationObserver(scan);
  configure = value => {
    observer.disconnect();
    if (value && !signal.aborted) {
      scan();
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-sidebar-thread-id', 'data-sidebar-thread-shortcut-target'] });
    } else clear();
  };
  configure(enabled);
  const dispose = () => { observer.disconnect(); configure = undefined; clear(); };
  signal.addEventListener('abort', dispose, { once: true });
  return () => { signal.removeEventListener('abort', dispose); dispose(); };
}
