import { useSyncExternalStore } from 'react';

// One clock per window, regardless of the number of visible faces.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let elapsed = 0;
let removeGuards: (() => void) | undefined;
const snapshot = () => elapsed;
const staticSnapshot = () => 0;
const noSubscribe = () => () => {};
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reconcile = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      elapsed = 0;
      if (!document.hidden && !reduced.matches) {
        timer = setInterval(() => {
          elapsed = performance.now();
          for (const notify of listeners) notify();
        }, 250);
      }
      for (const notify of listeners) notify();
    };
    document.addEventListener('visibilitychange', reconcile);
    reduced.addEventListener('change', reconcile);
    removeGuards = () => {
      document.removeEventListener('visibilitychange', reconcile);
      reduced.removeEventListener('change', reconcile);
    };
    reconcile();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      if (timer) clearInterval(timer);
      timer = undefined;
      elapsed = 0;
      removeGuards?.();
      removeGuards = undefined;
    }
  };
}
export function useFaceClock(enabled: boolean) {
  return useSyncExternalStore(enabled ? subscribe : noSubscribe, enabled ? snapshot : staticSnapshot, staticSnapshot);
}
