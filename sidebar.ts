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
  // Layout adapter v1: only decorate rows with a recognizable, safe title layout.
  // Unknown host layouts deliberately fall back to the thread-header face.
  const rowSelector = '[data-sidebar-thread-id]';
  const shortcutSelector = '[data-sidebar-thread-shortcut-target][data-sidebar-thread-id]';
  function supportedRow(row: HTMLElement): boolean {
    if (row.matches(shortcutSelector)) return true;
    // Fallback for hosts that expose a row id and title but no shortcut anchor.
    return !!row.querySelector('.bb-thread-title');
  }
  let containers: HTMLElement[] = [];
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  const visibility = () => { document.documentElement.dataset.asciimojiHidden = String(document.hidden); };
  visibility();
  document.addEventListener('visibilitychange', visibility);
  function clear() {
    for (const target of owned.values()) target.element.remove();
    owned.clear();
    containers = [];
    if (targets.length) publish([]);
  }
  function placement(row: HTMLElement) {
    // BB's shortcut anchor is an absolute click target, not the title layout.
    const title = row.querySelector<HTMLElement>('.bb-thread-title')
      ?? row.parentElement?.querySelector<HTMLElement>('.bb-thread-title');
    if (title?.parentElement && (row.contains(title) || row.parentElement?.contains(title))) {
      // A title may itself be inside a host link. Insert beside that link,
      // never inside it (including the fallback layout without shortcut attrs).
      const control = title.closest<HTMLElement>('a, button');
      const before = control ?? title;
      const parent = before.parentElement;
      if (parent && !parent.closest('a, button')) return { parent, before };
    }
    // Leave BB's inline rename editor undecorated.
    if (row.hasAttribute('data-sidebar-rename-anchor') || getComputedStyle(row).position === 'absolute') return null;
    // A picker button must never be nested inside the host's link/button.
    if (row.matches('a, button')) {
      if (row.parentElement && !row.parentElement.closest('a, button')) {
        return { parent: row.parentElement, before: row };
      }
      return null;
    }
    return row.closest('a, button') ? null : { parent: row, before: null };
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
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(rowSelector));
    // Prefer the host's dedicated shortcut target over a wrapping fallback row.
    // One descendant query per row avoids comparing every row to every other row.
    const rows = candidates.filter(row => supportedRow(row) && !row.querySelector(shortcutSelector));
    containers = [...new Set(rows.flatMap(row => {
      const parent = row.parentElement;
      return parent && parent !== document.body ? [parent] : [];
    }))];
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
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      if (record.type === 'attributes') return true;
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest('[data-asciimoji-slot]')) return false;
      const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
      if (nodes.some(node => node instanceof Element && (node.matches(rowSelector) || node.querySelector(rowSelector)))) return true;
      if (target && containers.some(container => container.contains(target))) return true;
      return [...owned].some(([row, slot]) => row === target || (target && row.contains(target)) ||
        (slot.element.parentElement !== document.body && !!target && !!slot.element.parentElement?.contains(target)) ||
        nodes.some(node => node === row || node.contains(row)));
    });
    if (relevant && !scheduled) scheduled = setTimeout(() => { scheduled = undefined; scan(); }, 16);
  });
  configure = value => {
    observer.disconnect();
    if (scheduled) clearTimeout(scheduled);
    scheduled = undefined;
    if (value && !signal.aborted) {
      scan();
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-sidebar-thread-id', 'data-sidebar-thread-shortcut-target', 'data-sidebar-rename-anchor'] });
    } else clear();
  };
  configure(enabled);
  const dispose = () => {
    observer.disconnect();
    if (scheduled) clearTimeout(scheduled);
    scheduled = undefined;
    configure = undefined;
    document.removeEventListener('visibilitychange', visibility);
    delete document.documentElement.dataset.asciimojiHidden;
    clear();
  };
  signal.addEventListener('abort', dispose, { once: true });
  return () => { signal.removeEventListener('abort', dispose); dispose(); };
}
