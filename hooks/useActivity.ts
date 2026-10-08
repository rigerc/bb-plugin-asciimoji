import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useRealtime, useRealtimeConnectionState, useRpc, type PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../server.js';
import type { FaceState } from '../faces.js';

// One cache per app window. Header, sidebar and open pickers share reads.
const owners = new Map<symbol, { ids: string[]; rpc: PluginRpcClient<typeof rpcContract> }>();
const listeners = new Set<() => void>();
const queued = new Set<string>();
const versions = new Map<string, number>();
let states: Record<string, FaceState> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let epoch = 0;
const snapshot = () => states;
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const interested = (id: string) => [...owners.values()].some(owner => owner.ids.includes(id));
function publish(next: Record<string, FaceState>) {
  states = next;
  for (const notify of listeners) notify();
}
function request(ids: string[]) {
  for (const id of ids) {
    if (!interested(id)) continue;
    queued.add(id);
    versions.set(id, (versions.get(id) ?? 0) + 1);
  }
  if (!queued.size || timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    const ids = [...queued];
    queued.clear();
    const rpc = owners.values().next().value?.rpc;
    if (!rpc) return;
    const generation = epoch;
    const reads = new Map(ids.map(id => [id, versions.get(id)]));
    for (let index = 0; index < ids.length; index += 200) {
      const batch = ids.slice(index, index + 200);
      void rpc.call('activity', { threadIds: batch }).then(result => {
        if (generation !== epoch) return;
        const next = { ...states };
        const values = new Map(result.map(item => [item.threadId, item.state]));
        for (const id of batch) {
          if (!interested(id) || reads.get(id) !== versions.get(id)) continue;
          const state = values.get(id);
          if (state) next[id] = state;
          else delete next[id];
        }
        publish(next);
      }, () => { /* Keep the last snapshot during an outage; reconnect refreshes it. */ });
    }
  }, 25);
}
export function useActivity(threadIds: string[], enabled: boolean): Record<string, FaceState> {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const ownerId = useRef(Symbol('activity'));
  const ids = JSON.stringify([...new Set(threadIds)].sort());
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!enabled) return;
    const targets: string[] = JSON.parse(ids);
    const token = ownerId.current;
    owners.set(token, { ids: targets, rpc });
    request(targets.filter(id => !(id in states)));
    return () => {
      owners.delete(token);
      if (!owners.size) {
        epoch++;
        if (timer) clearTimeout(timer);
        timer = undefined;
        queued.clear();
        versions.clear();
        publish({});
      } else {
        const next = { ...states };
        for (const id of Object.keys(next)) if (!interested(id)) { delete next[id]; versions.delete(id); }
        publish(next);
      }
    };
  }, [rpc, ids, enabled]);
  useEffect(() => {
    if (enabled && connection === 'connected') request(JSON.parse(ids));
  }, [connection, ids, enabled]);
  useRealtime('activity', payload => {
    if (enabled && payload && typeof payload === 'object' && 'threadId' in payload) {
      const id = String(payload.threadId);
      if (threadIds.includes(id)) request([id]);
    }
  });
  return enabled ? current : {};
}
