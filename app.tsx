import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import './app.css';
import { enableSidebar, getTargets, mountSidebar, subscribeTargets } from './sidebar.js';
import { useSettings, definePluginApp, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server.js';
import { defaultFace, generateFace, FACES, renderFace, type GeneratedFace, type FaceState } from './faces.js';
import { useFaceClock } from './hooks/useFaceClock.js';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './components/ui/dialog.js';

function usePreferences() {
  const { values } = useSettings();
  return { showActivity: values?.showActivity !== false, showHeader: values?.showHeader !== false, showSidebar: values?.showSidebar === true, useThemeColor: values?.useThemeColor === true,
    animation: values?.animation === 'off' || values?.animation === 'playful' ? values.animation : 'subtle' };
}
type Identity = { threadId: string; face: string; custom: boolean; generated?: GeneratedFace };
function Face({ face, generated, state, animation, useThemeColor, sidebar = false }: {
  face: string; generated?: GeneratedFace; state?: FaceState; animation: string; useThemeColor: boolean; sidebar?: boolean;
}) {
  const elapsed = useFaceClock(!!generated && state !== undefined && animation !== 'off');
  const displayed = generated && state !== undefined
    ? renderFace(generated, { state, elapsed, animation: animation !== 'off' && elapsed > 0 }) : face;
  return <span key={face} className={`asciimoji-face${useThemeColor ? ' text-primary' : ''}${sidebar ? ' asciimoji-sidebar-face' : ''}`}
    data-motion={animation} title={state ? `Activity: ${state}` : undefined}>
    {displayed}{!generated && state && <span className="asciimoji-activity" aria-label={`Activity: ${state}`}>
      {state === 'running' ? '·' : state === 'waiting' ? '?' : state === 'error' ? '!' : ''}
    </span>}
  </span>;
}

// Reconnection and host events refresh authoritative snapshots; revisions reject stale reads.
function useActivity(threadIds: string[], enabled: boolean): Record<string, FaceState> {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [states, setStates] = useState<Record<string, FaceState>>({});
  const ids = JSON.stringify(threadIds);
  const revision = useRef(0);
  const load = useCallback(() => {
    const version = ++revision.current;
    if (!enabled) { setStates({}); return; }
    const targets: string[] = JSON.parse(ids);
    const batches = [];
    for (let index = 0; index < targets.length; index += 200) {
      batches.push(rpc.call('activity', { threadIds: targets.slice(index, index + 200) }));
    }
    void Promise.all(batches).then(results => {
      if (version === revision.current) setStates(Object.fromEntries(results.flat().map(item => [item.threadId, item.state])));
    }, () => { if (version === revision.current) setStates({}); });
  }, [rpc, ids, enabled]);
  useEffect(() => { load(); return () => { revision.current++; }; }, [load, connection]);
  useRealtime('activity', payload => {
    if (payload && typeof payload === 'object' && 'threadId' in payload && threadIds.includes(String(payload.threadId))) load();
  });
  return enabled ? states : {};
}
function ThreadFace({ threadId }: { threadId: string }) {
  const preferences = usePreferences();
  const states = useActivity([threadId], preferences.showActivity && preferences.showHeader);
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [identity, setIdentity] = useState<Identity>({ threadId, face: defaultFace(threadId), custom: false, generated: generateFace(threadId) });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const revision = useRef(0);
  const alive = useRef(true);
  const report = useCallback((cause: unknown) => {
    if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const load = useCallback(() => {
    const version = ++revision.current;
    void rpc.call('get', { threadId }).then(value => {
      if (alive.current && version === revision.current) { setIdentity(value); setError(null); }
    }, report);
  }, [rpc, threadId, report]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; revision.current++; };
  }, []);
  useEffect(() => { load(); }, [load, connection]);
  useRealtime('changed', payload => {
    if (payload && typeof payload === 'object' && 'threadId' in payload && payload.threadId === threadId) load();
  });
  async function save(action: 'set' | 'shuffle' | 'reset' | 'generate', face?: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    ++revision.current;
    try {
      const value = action === 'set'
        ? await rpc.call('set', { threadId, face: face ?? draft })
        : await rpc.call(action, { threadId });
      if (alive.current) { setIdentity(value); setOpen(false); }
    } catch (cause) { report(cause); }
    finally { if (alive.current) setPending(false); }
  }
  if (!preferences.showHeader) return null;
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (value) setDraft(identity.face); }}>
    <DialogTrigger asChild>
      <Button variant="ghost" className="h-7 max-w-40 truncate px-2 font-mono text-xs"
        aria-label={`Change thread asciimoji: ${identity.face}${states[threadId] ? `, ${states[threadId]}` : ''}`}>
        <Face face={identity.face} generated={identity.generated} state={states[threadId]} animation={preferences.animation} useThemeColor={preferences.useThemeColor} />
      </Button>
    </DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Your thread’s asciimoji</DialogTitle>
        <DialogDescription>Pick a face to make this thread yours. Your choice is saved across sessions.</DialogDescription>
      </DialogHeader>
      <div className="rounded-lg bg-muted p-5 text-center font-mono text-2xl" aria-label="Current asciimoji"><Face face={identity.face} generated={identity.generated} state={states[threadId]} animation={preferences.animation} useThemeColor={preferences.useThemeColor} /></div>
      <div className="grid grid-cols-3 gap-2">
        {FACES.map(item => <Button key={item.name} variant={!identity.generated && identity.face === item.face ? 'secondary' : 'outline'}
          className="h-auto flex-col gap-1 px-1 py-3" disabled={pending} aria-pressed={!identity.generated && identity.face === item.face}
          aria-label={`Choose ${item.name}: ${item.face}`} onClick={() => void save('set', item.face)}>
          <span className="font-mono text-xs"><Face face={item.face} animation={preferences.animation} useThemeColor={preferences.useThemeColor} /></span><span className="text-xs text-muted-foreground">{item.name}</span>
        </Button>)}
      </div>
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void save('set'); }}>
        <Input aria-label="Custom asciimoji" maxLength={40} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Your own face" disabled={pending} />
        <Button type="submit" disabled={pending || !draft.trim()}>Save</Button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button variant="outline" disabled={pending} onClick={() => void save('generate')}>Use generated face</Button>
      <p className="text-xs text-muted-foreground">Every thread starts with a generated face. Child faces share their parent’s eyes.</p>
      <div className="flex justify-between gap-2">
        <Button variant="outline" disabled={pending} onClick={() => void save('shuffle')}>Surprise me</Button>
        <Button variant="ghost" disabled={pending || !identity.custom} onClick={() => void save('reset')}>Reset to default</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
function SidebarFaces() {
  const preferences = usePreferences();
  const targets = useSyncExternalStore(subscribeTargets, getTargets);
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [faces, setFaces] = useState<Record<string, Identity>>({});
  const states = useActivity([...new Set(targets.map(target => target.threadId))], preferences.showActivity && preferences.showSidebar);
  const ids = JSON.stringify([...new Set(targets.map(target => target.threadId))]);
  const revision = useRef(0);
  useEffect(() => { enableSidebar(preferences.showSidebar); return () => enableSidebar(false); }, [preferences.showSidebar]);
  const load = useCallback(() => {
    const version = ++revision.current;
    if (!preferences.showSidebar) return;
    const threadIds: string[] = JSON.parse(ids);
    const batches = [];
    for (let index = 0; index < threadIds.length; index += 200) {
      batches.push(rpc.call('getMany', { threadIds: threadIds.slice(index, index + 200) }));
    }
    void Promise.all(batches).then(results => {
      if (version === revision.current) setFaces(Object.fromEntries(results.flat().map(item => [item.threadId, item])));
    }, () => { /* Keep existing faces if a connection is temporarily unavailable. */ });
  }, [rpc, ids, preferences.showSidebar]);
  useEffect(() => { load(); return () => { revision.current++; }; }, [load, connection]);
  useRealtime('changed', payload => {
    if (payload && typeof payload === 'object' && 'threadId' in payload && targets.some(target => target.threadId === payload.threadId)) load();
  });
  if (!preferences.showSidebar) return null;
  return <>{targets.map(({ threadId, element }, index) => createPortal(
    <span title={`Thread asciimoji: ${faces[threadId]?.face ?? defaultFace(threadId)}`} aria-hidden="true">
      <Face face={faces[threadId]?.face ?? defaultFace(threadId)} generated={faces[threadId] ? faces[threadId].generated : generateFace(threadId)} state={states[threadId]} animation={preferences.animation} useThemeColor={preferences.useThemeColor} sidebar />
    </span>, element, `${threadId}:${index}`))}</>;
}

export default definePluginApp(app => {
  app.contentScripts.register({ id: 'sidebar-faces', mount: mountSidebar });
  app.slots.experimental_appOverlay({ id: 'sidebar-faces', component: SidebarFaces });
  app.slots.experimental_threadHeaderAction({
    id: 'face', title: 'Thread asciimoji',
    component: ({ threadId }) => <ThreadFace key={threadId} threadId={threadId} />,
  });
});
