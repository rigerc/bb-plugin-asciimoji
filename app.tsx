import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import './app.css';
import { enableSidebar, getTargets, mountSidebar, subscribeTargets } from './sidebar.js';
import { useSettings, definePluginApp, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract, Identity, LibraryFace } from './server.js';
import { FACES, FACE_FAMILIES, countFaceCharacters, faceValidationError, renderFace, resolveFaceDisplay, type ActivityStyle, type FaceExpressions, type FaceFamily, type GeneratedFace, type FaceState, type SidebarWidth } from './faces.js';
import { useFaceClock } from './hooks/useFaceClock.js';
import { useActivity } from './hooks/useActivity.js';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './components/ui/dialog.js';
import AsciimojiSettingsPreview from './components/AsciimojiSettingsPreview.js';

export function usePreferences() {
  const { values } = useSettings();
  const sidebarWidth: SidebarWidth = values?.sidebarWidth === 'compact' || values?.sidebarWidth === 'expanded' ? values.sidebarWidth : 'standard';
  const activityStyle: ActivityStyle = values?.activityStyle === 'markers' ? 'markers' : 'expressions';
  const defaultFamily: FaceFamily = (FACE_FAMILIES.some(item => item.id === values?.defaultFamily) ? values?.defaultFamily : 'classic') as FaceFamily;
  return { showActivity: values?.showActivity !== false, showHeader: values?.showHeader !== false, showSidebar: values?.showSidebar === true, useThemeColor: values?.useThemeColor === true,
    animation: values?.animation === 'off' || values?.animation === 'playful' ? values.animation : 'subtle', sidebarWidth, activityStyle, defaultFamily };
}
export function Face({ face, generated, expressions, state, animation, useThemeColor, sidebar = false, activityStyle = 'expressions', sidebarWidth = 'standard', child = false }: {
  face: string; generated?: GeneratedFace; expressions?: FaceExpressions; state?: FaceState; animation: string; useThemeColor: boolean; sidebar?: boolean;
  activityStyle?: ActivityStyle; sidebarWidth?: SidebarWidth; child?: boolean;
}) {
  const isWorking = state === 'running';
  const elapsed = useFaceClock(!!generated && isWorking && animation !== 'off' && activityStyle === 'expressions');
  const { displayed, marker } = resolveFaceDisplay(face, { generated, expressions, state, activityStyle, elapsed,
    animation: isWorking && animation !== 'off' && elapsed > 0 });
  const glyph = <>{displayed}{marker && <span className="asciimoji-activity" aria-hidden="true">{marker}</span>}</>;
  return <span key={face + activityStyle + (state ?? 'none')} className={`asciimoji-face${useThemeColor ? ' text-primary' : ''}${sidebar ? ' asciimoji-sidebar-face' : ''}${child ? ' asciimoji-child-face' : ''}`}
    data-motion={animation} data-activity={state ?? 'none'} {...(sidebar ? { 'data-sidebar-width': sidebarWidth } : {})}
    title={(child ? 'Child thread: ' : '') + face + (state && state !== 'idle' ? ` (Activity: ${state})` : '')}
    aria-label={(child ? 'Child thread, ' : '') + face + (state && state !== 'idle' ? `, ${state}` : '')}>
    {child ? <>
      <span className="asciimoji-child-marker" aria-hidden="true">↳</span>
      <span className="asciimoji-child-glyph">{glyph}</span>
    </> : glyph}
  </span>;
}

export interface ProjectDefaultInfo { family: FaceFamily; origin: 'global' | 'project'; override: FaceFamily | null; }
function ProjectFamily({ threadId, disabled, onFamily }: { threadId: string; disabled: boolean; onFamily: (info: ProjectDefaultInfo) => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [info, setInfo] = useState<ProjectDefaultInfo | null>(null);
  const [globalFamily, setGlobalFamily] = useState<FaceFamily | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const alive = useRef(true);
  const { values } = useSettings();
  useEffect(() => {
    const parsed = FACE_FAMILIES.some(item => item.id === values?.defaultFamily) ? (values?.defaultFamily as FaceFamily) : 'classic';
    setGlobalFamily(parsed);
  }, [values?.defaultFamily]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(() => {
    const version = ++revision.current;
    void rpc.call('getProjectDefault', { threadId }).then(value => {
      if (version === revision.current) { setInfo({ family: value.family, origin: value.origin, override: value.override }); onFamily({ family: value.family, origin: value.origin, override: value.override }); setError(null); }
    }, cause => { if (version === revision.current) setError(String(cause)); });
  }, [rpc, threadId, onFamily]);
  useEffect(() => { load(); return () => { revision.current++; }; }, [load, connection]);
  useRealtime('changed', payload => {
    if (payload && typeof payload === 'object' && ('projectId' in payload || 'globalDefault' in payload || 'globalFamily' in payload)) load();
  });
  async function save(next: FaceFamily | null) {
    if (pending) return;
    setPending(true);
    setError(null);
    const version = ++revision.current;
    try {
      const value = await rpc.call('setProjectDefault', { threadId, family: next });
      if (version === revision.current) { setInfo({ family: value.family, origin: value.origin, override: value.override }); onFamily({ family: value.family, origin: value.origin, override: value.override }); }
    } catch (cause) { if (version === revision.current) setError(String(cause)); }
    finally { if (alive.current) setPending(false); }
  }
  const selectValue = info === null ? '' : info.override ?? 'global';
  const globalName = FACE_FAMILIES.find(item => item.id === (globalFamily ?? info?.family ?? 'classic'))?.name ?? 'Classic';
  return <div className="space-y-2">
    <label className="flex items-center justify-between gap-2 text-sm">
      Project default
      <select aria-label="Project default face family" value={selectValue} disabled={disabled || pending || info === null}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm"
        onChange={event => void save(event.target.value === 'global' ? null : (event.target.value as FaceFamily))}>
        {info === null && <option value="">Loading…</option>}
        <option value="global">Use global default ({globalName})</option>
        {FACE_FAMILIES.map(item => <option key={item.id} value={item.id}>{item.name}{info?.override === item.id ? ' (override)' : ''}</option>)}
      </select>
    </label>
    <p className="text-xs text-muted-foreground">{
      info === null ? 'Loading project default…'
      : info.origin === 'project'
        ? `Project override: ${FACE_FAMILIES.find(item => item.id === info.family)?.name}. Automatic faces in this project use it. Saved thread choices stay as they are.`
        : `Inheriting global default: ${FACE_FAMILIES.find(item => item.id === info.family)?.name}. Set a project override or change the global default in plugin settings.`
    }</p>
    {error && <div><p role="alert" className="text-sm text-destructive">Could not update the project default. {error}</p><Button variant="outline" onClick={load} disabled={pending}>Retry project default</Button></div>}
  </div>;
}

function FaceLibrary({ identity, disabled, onApply }: {
  identity: Identity; disabled: boolean; onApply: (entry: LibraryFace) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [library, setLibrary] = useState<{ favorites: LibraryFace[]; recent: LibraryFace[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const load = useCallback(() => {
    const version = ++revision.current;
    void rpc.call('getLibrary', {}).then(value => {
      if (version === revision.current) { setLibrary(value); setError(null); }
    }, () => { if (version === revision.current) setError('Could not load your face library.'); });
  }, [rpc]);
  useEffect(() => { load(); return () => { revision.current++; }; }, [load, connection]);
  useRealtime('library', load);
  const entryKey = (entry: LibraryFace) => JSON.stringify([entry.face, entry.expressions?.running, entry.expressions?.waiting, entry.expressions?.error]);
  const describeExpressions = (entry: LibraryFace) => {
    const parts: string[] = [];
    if (entry.expressions?.running) parts.push('running ' + entry.expressions.running);
    if (entry.expressions?.waiting) parts.push('waiting ' + entry.expressions.waiting);
    if (entry.expressions?.error) parts.push('error ' + entry.expressions.error);
    return parts.join(', ');
  };
  const entryLabel = (entry: LibraryFace) => {
    const detail = describeExpressions(entry);
    return detail ? entry.face + ' (' + detail + ')' : entry.face;
  };
  const current: LibraryFace = { face: identity.face, ...(identity.expressions ? { expressions: identity.expressions } : {}) };
  const saved = !!library?.favorites.some(item => entryKey(item) === entryKey(current));
  async function favorite(entry: LibraryFace, saved: boolean) {
    if (pending) return;
    setPending(true);
    setError(null);
    const version = ++revision.current;
    try {
      const value = await rpc.call('favorite', { ...entry, saved });
      if (version === revision.current) setLibrary(value);
    } catch (cause) {
      if (version === revision.current) setError(cause instanceof Error ? cause.message : 'Could not save your favorite.');
    } finally { setPending(false); }
  }
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-medium">Your face library</p>
      <Button variant="outline" disabled={disabled || pending || !library}
        onClick={() => void favorite(current, !saved)}>{saved ? 'Remove current favorite' : 'Favorite current face'}</Button>
    </div>
    <p className="text-xs text-muted-foreground">Reuse favorite text and activity expressions in any thread.</p>
    {!library && !error && <p className="text-xs text-muted-foreground">Loading library…</p>}
    {library && <>
      <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto">
        {library.favorites.map(entry => <div className="flex min-w-0 gap-1" key={entryKey(entry)}>
          <Button variant="outline" className="min-w-0 flex-1 truncate font-mono text-xs"
            disabled={disabled || pending} aria-label={'Reuse favorite: ' + entryLabel(entry)} onClick={() => onApply(entry)}><span className="truncate" title={entryLabel(entry)}>{entry.face}{describeExpressions(entry) ? <span className="ml-1 text-[10px] text-muted-foreground">▸ {entry.expressions?.running ?? entry.expressions?.waiting ?? entry.expressions?.error}</span> : null}</span></Button>
          <Button variant="ghost" disabled={disabled || pending} aria-label={'Remove favorite: ' + entryLabel(entry)}
            onClick={() => void favorite(entry, false)}>×</Button>
        </div>)}
      </div>
      {!library.favorites.length && <p className="text-xs text-muted-foreground">Favorite a face to keep it here.</p>}
      {!!library.recent.length && <details>
        <summary className="cursor-pointer text-sm">Recent faces</summary>
        <div className="mt-2 grid max-h-40 grid-cols-3 gap-2 overflow-y-auto">
          {library.recent.map(entry => <Button key={entryKey(entry)} variant="outline" className="truncate font-mono text-xs"
            disabled={disabled || pending} aria-label={'Reuse recent: ' + entryLabel(entry)}
            onClick={() => onApply(entry)}><span className="truncate" title={entryLabel(entry)}>{entry.face}{describeExpressions(entry) ? <span className="ml-1 text-[10px] text-muted-foreground">▸ {entry.expressions?.running ?? entry.expressions?.waiting ?? entry.expressions?.error}</span> : null}</span></Button>)}
        </div>
      </details>}
    </>}
    {error && <div><p role="alert" className="text-sm text-destructive">{error}</p>
      <Button variant="outline" disabled={pending} onClick={load}>Retry library</Button></div>}
  </div>;
}

function ThreadFace({ threadId, pickerOnly = false, onClose, restoreFocus }: {
  threadId: string; pickerOnly?: boolean; onClose?: () => void; restoreFocus?: () => void;
}) {
  const preferences = usePreferences();
  const visible = preferences.showHeader || pickerOnly;
  const states = useActivity([threadId], preferences.showActivity && visible);
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [open, setOpen] = useState(pickerOnly);
  const [draft, setDraft] = useState('');
  const [expressions, setExpressions] = useState<FaceExpressions>({});
  const [editing, setEditing] = useState(false);
  const [previewState, setPreviewState] = useState<FaceState>('idle');
  const [projectInfo, setProjectInfo] = useState<ProjectDefaultInfo | null>(null);
  const [previews, setPreviews] = useState<Partial<Record<FaceFamily, string>>>({});
  const [previewError, setPreviewError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const revision = useRef(0);
  const previewRevision = useRef(0);
  const alive = useRef(true);
  const load = useCallback(() => {
    const version = ++revision.current;
    void rpc.call('get', { threadId }).then(value => {
      if (alive.current && version === revision.current) { setIdentity(value); setError(null); }
    }, cause => {
      if (alive.current && version === revision.current) setError('Could not load this face. ' + (cause instanceof Error ? cause.message : String(cause)));
    });
  }, [rpc, threadId]);
  const loadPreviews = useCallback(() => {
    const version = ++previewRevision.current;
    setPreviewError(false);
    void rpc.call('previews', { threadId }).then(values => {
      if (alive.current && version === previewRevision.current) setPreviews(Object.fromEntries(values.map(item => [item.family, item.face])));
    }, () => { if (alive.current && version === previewRevision.current) setPreviewError(true); });
  }, [rpc, threadId]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; revision.current++; previewRevision.current++; };
  }, []);
  useEffect(() => { if (visible) load(); }, [load, connection, visible]);
  useEffect(() => {
    if (open) loadPreviews();
    return () => { previewRevision.current++; };
  }, [open, loadPreviews, connection]);
  useEffect(() => {
    if (open && identity && !editing) { setDraft(identity.face); setExpressions(identity.expressions ?? {}); }
  }, [open, identity, editing]);
  useRealtime('changed', payload => {
    if (!visible || !payload || typeof payload !== 'object') return;
    const ids = new Set<string>();
    if ('threadId' in payload && typeof payload.threadId === 'string') ids.add(payload.threadId);
    if ('affectedThreadIds' in payload && Array.isArray(payload.affectedThreadIds)) {
      for (const id of payload.affectedThreadIds) if (typeof id === 'string') ids.add(id);
    }
    if ('threadIds' in payload && Array.isArray(payload.threadIds)) {
      for (const id of payload.threadIds) if (typeof id === 'string') ids.add(id);
    }
    if (ids.has(threadId)) { load(); if (open) loadPreviews(); return; }
    if ('projectId' in payload && typeof payload.projectId === 'string' && payload.projectId === identity?.projectId) load();
    else if (('globalDefault' in payload || 'globalFamily' in payload) && identity?.source === 'automatic') load();
    else if (('globalDefault' in payload || 'globalFamily' in payload) && !identity) load();
    // A parent override can change the authoritative previews without changing a pinned child.
    if (open) loadPreviews();
  });
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (value) { setEditing(false); setPreviewState('idle'); setError(null); }
    else onClose?.();
  };
  async function save(action: 'set' | 'shuffle' | 'reset' | 'generate' | 'vary', entry?: LibraryFace, family?: FaceFamily) {
    if (pending) return;
    setPending(true);
    setError(null);
    const version = ++revision.current;
    try {
      const value = action === 'set' ? await rpc.call('set', { threadId, ...(entry ?? { face: draft, expressions }) })
        : action === 'generate' ? await rpc.call('generate', { threadId, ...(family ? { family } : {}) })
        : await rpc.call(action, { threadId });
      if (alive.current) {
        if (version === revision.current) setIdentity(value);
        changeOpen(false);
      }
    } catch (cause) {
      if (alive.current) setError('Could not save this face. ' + (cause instanceof Error ? cause.message : String(cause)));
    } finally { if (alive.current) setPending(false); }
  }
  const draftError = faceValidationError(draft);
  const expressionError = Object.values(expressions).map(faceValidationError).find(Boolean);
  const preview = editing ? draft : identity?.face ?? '';
  const previewExpressions = editing ? expressions : identity?.expressions;
  const previewActivity = editing ? previewState : states[threadId];
  const selectedFamily = identity?.generated ? (identity.generated.family ?? 'classic') : projectInfo?.family;
  const familyName = FACE_FAMILIES.find(item => item.id === selectedFamily)?.name ?? 'project default';
  const scopeLabel = identity?.source === 'automatic'
    ? projectInfo?.origin === 'project' ? `Following project override: ${familyName}` : `Following global default: ${familyName}`
    : identity?.generated ? 'Saved for this thread: ' + familyName : 'Saved for this thread: ' + (identity?.source === 'preset' ? 'preset' : 'custom face');
  if (!visible) return null;
  return <Dialog open={open} onOpenChange={changeOpen}>
    {!pickerOnly && <DialogTrigger asChild>
      <Button variant="ghost" className="h-7 max-w-40 truncate px-2 font-mono text-xs"
        aria-label={identity ? 'Change ' + (identity.parentThreadId ? 'child thread' : 'thread') + ' asciimoji: ' + identity.face + (states[threadId] ? ', ' + states[threadId] : '')
          : error ? 'Retry thread asciimoji' : 'Loading thread asciimoji'}
        onClick={event => { if (!identity) { event.preventDefault(); load(); } }}>
        {identity ? <Face face={identity.face} generated={identity.generated} expressions={identity.expressions}
          state={states[threadId]} animation={preferences.animation} useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} child={!!identity.parentThreadId} />
          : error ? <span title={error}>Retry face</span> : 'Loading…'}
      </Button>
    </DialogTrigger>}
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md"
      onCloseAutoFocus={event => { if (restoreFocus) { event.preventDefault(); restoreFocus(); } }}>
      <DialogHeader>
        <DialogTitle>Your thread’s asciimoji</DialogTitle>
        <DialogDescription>Choose a face, keep a family, or use the automatic face from your global and project defaults.</DialogDescription>
      </DialogHeader>
      {!identity ? <div><p role={error ? 'alert' : 'status'}>{error ?? 'Loading face…'}</p>
        {error && <Button variant="outline" onClick={load}>Retry face</Button>}</div> : <>
        <div className="space-y-2">
          <div className="asciimoji-preview rounded-lg bg-muted p-5 text-center font-mono text-2xl" title={preview} aria-label={editing ? 'Draft asciimoji preview' : 'Current asciimoji'}>
            <Face face={preview} generated={editing ? undefined : identity.generated} expressions={previewExpressions} state={previewActivity}
              animation={preferences.animation} useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} child={!!identity.parentThreadId} />
          </div>
          {identity.parentThreadId && <p className="text-xs text-muted-foreground" title={`Parent thread: ${identity.parentThreadId}`}>
            <span aria-hidden="true">↳ </span><strong>Child thread.</strong> Generated faces inherit their parent's eyes when the family matches.
          </p>}
          <p className="text-xs text-muted-foreground" role="status">
            {scopeLabel}
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Keep a family for this thread</p>
          <div className="grid grid-cols-3 gap-2">
            {FACE_FAMILIES.map(item => <Button key={item.id}
              variant={identity.generated && (identity.generated.family ?? 'classic') === item.id ? 'secondary' : 'outline'}
              className="h-auto flex-col gap-1 px-1 py-2" disabled={pending || !previews[item.id]}
              aria-pressed={!!identity.generated && (identity.generated.family ?? 'classic') === item.id}
              aria-label={'Keep ' + item.name + ' family'} onClick={() => void save('generate', undefined, item.id)}>
              <span className="font-mono text-xs"><Face face={previews[item.id] ?? '…'} animation={preferences.animation} useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} child={!!identity.parentThreadId} /></span>
              <span className="text-xs text-muted-foreground">{item.name}</span>
            </Button>)}
          </div>
          {previewError && <div><p role="alert" className="text-sm text-destructive">Could not load family previews.</p>
            <Button variant="outline" onClick={loadPreviews}>Retry previews</Button></div>}
          <Button variant="outline" disabled={pending} onClick={() => void save('vary')}>Try another variation</Button>
          <p className="text-xs text-muted-foreground">A variation is saved for this thread. Children in the same generated family share their parent’s eyes.</p>
        </div>
        <details open>
          <summary className="cursor-pointer text-sm font-medium">Presets</summary>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {FACES.map(item => <Button key={item.name} variant={!identity.generated && identity.face === item.face ? 'secondary' : 'outline'}
              className="h-auto flex-col gap-1 px-1 py-3" disabled={pending}
              aria-pressed={!identity.generated && identity.face === item.face}
              aria-label={'Choose ' + item.name + ': ' + item.face} onClick={() => void save('set', { face: item.face })}>
              <span className="font-mono text-xs"><Face face={item.face} animation={preferences.animation} useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} /></span>
              <span className="text-xs text-muted-foreground">{item.name}</span>
            </Button>)}
          </div>
        </details>
        <FaceLibrary identity={identity} disabled={pending} onApply={entry => void save('set', entry)} />
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (!draftError && !expressionError) void save('set'); }}>
          <label htmlFor={'asciimoji-custom-' + threadId} className="text-sm font-medium">Custom face</label>
          <div className="flex gap-2">
            <Input id={'asciimoji-custom-' + threadId} aria-label="Custom asciimoji" value={draft}
              aria-describedby={'asciimoji-validation-' + threadId} aria-invalid={editing && !!draftError}
              onChange={event => { setEditing(true); setDraft(event.target.value); }} disabled={pending} />
            <Button type="submit" disabled={pending || !!draftError || !!expressionError}>Save</Button>
          </div>
          <p id={'asciimoji-validation-' + threadId} className={'text-xs ' + (editing && draftError ? 'text-destructive' : 'text-muted-foreground')}>
            {countFaceCharacters(draft.trim())}/40 characters{editing && draftError ? ' — ' + draftError : ''}
          </p>
          <details>
            <summary className="cursor-pointer text-sm">Custom activity expressions</summary>
            <p className="mt-2 text-xs text-muted-foreground">Leave a state blank to keep your base face and its activity marker.</p>
            {(['running', 'waiting', 'error'] as const).map(state => <label key={state} className="mt-2 flex items-center gap-2 text-sm">
              <span className="w-16 capitalize">{state}</span>
              <Input aria-label={state + ' expression'} value={expressions[state] ?? ''} disabled={pending}
                aria-invalid={!!expressions[state] && !!faceValidationError(expressions[state]!)}
                onChange={event => {
                  setEditing(true);
                  const value = event.target.value;
                  setExpressions(current => {
                    const next = { ...current };
                    if (value) next[state] = value; else delete next[state];
                    return next;
                  });
                }} />
            </label>)}
            {expressionError && <p role="alert" className="text-xs text-destructive">{expressionError}</p>}
            <label className="mt-2 flex items-center justify-between text-sm">Preview activity
              <select aria-label="Preview activity" value={previewState}
                onChange={event => { setEditing(true); setPreviewState(event.target.value as FaceState); }}>
                {(['idle', 'running', 'waiting', 'error'] as const).map(state => <option key={state} value={state}>{state}</option>)}
              </select>
            </label>
          </details>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Preview at header and sidebar size</summary>
            <div className="mt-2 flex items-center gap-3">
              <span className="max-w-40 truncate font-mono text-xs" aria-label="Header size preview" title={preview}>
                <Face face={preview} expressions={previewExpressions} state={previewState} animation="off" useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} child={!!identity.parentThreadId} />
              </span>
              <span aria-label="Sidebar size preview" title={preview}><Face face={preview} expressions={previewExpressions}
                state={previewState} animation="off" useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} sidebar sidebarWidth={preferences.sidebarWidth} child={!!identity.parentThreadId} /></span>
            </div>
          </details>
        </form>
        {error && <div><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={load} disabled={pending}>Reload face</Button></div>}
        <details>
          <summary className="cursor-pointer text-sm">Project defaults</summary>
          <div className="mt-2"><ProjectFamily threadId={threadId} disabled={pending} onFamily={setProjectInfo} /></div>
        </details>
        <div className="flex justify-between gap-2">
          <Button variant="outline" disabled={pending} onClick={() => void save('shuffle')}>Surprise me</Button>
          <Button variant="ghost" disabled={pending || identity.source === 'automatic'} onClick={() => void save('reset')}>Use automatic face</Button>
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
function SidebarFaces() {
  const preferences = usePreferences();
  const targets = useSyncExternalStore(subscribeTargets, getTargets);
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [faces, setFaces] = useState<Record<string, Identity>>({});
  const [pickerThread, setPickerThread] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const states = useActivity([...new Set(targets.map(target => target.threadId))], preferences.showActivity && preferences.showSidebar);
  const ids = JSON.stringify([...new Set(targets.map(target => target.threadId))]);
  const revision = useRef(0);
  const facesRef = useRef(faces);
  useEffect(() => { facesRef.current = faces; }, [faces]);
  // Drop cached faces for sidebar rows that have disappeared so targeted merges cannot leak entries.
  useEffect(() => {
    const valid = new Set(targets.map(target => target.threadId));
    setFaces(previous => {
      if (Object.keys(previous).every(id => valid.has(id))) return previous;
      return Object.fromEntries(Object.entries(previous).filter(([id]) => valid.has(id)));
    });
  }, [targets]);
  useEffect(() => {
    enableSidebar(preferences.showSidebar);
    if (!preferences.showSidebar) setPickerThread(null);
    return () => enableSidebar(false);
  }, [preferences.showSidebar]);
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
  const loadSome = useCallback((threadIds: string[]) => {
    const unique = [...new Set(threadIds)];
    if (!unique.length || !preferences.showSidebar) return;
    const batches = [];
    for (let index = 0; index < unique.length; index += 200) {
      batches.push(rpc.call('getMany', { threadIds: unique.slice(index, index + 200) }));
    }
    void Promise.all(batches).then(results => {
      const items = results.flat();
      setFaces(previous => ({ ...previous, ...Object.fromEntries(items.map(item => [item.threadId, item])) }));
    }, () => { /* Keep existing faces if a connection is temporarily unavailable. */ });
  }, [rpc, preferences.showSidebar]);
  const loadOne = useCallback((threadId: string) => {
    if (!preferences.showSidebar) return;
    void rpc.call('get', { threadId }).then(value => {
      setFaces(previous => ({ ...previous, [threadId]: value }));
    }, () => { /* Keep the existing face if a connection is temporarily unavailable. */ });
  }, [rpc, preferences.showSidebar]);
  useRealtime('changed', payload => {
    if (!payload || typeof payload !== 'object') return;
    const visible = new Set(targets.map(target => target.threadId));
    const ids: string[] = [];
    if ('threadId' in payload && typeof payload.threadId === 'string' && visible.has(payload.threadId)) ids.push(payload.threadId);
    if ('affectedThreadIds' in payload && Array.isArray(payload.affectedThreadIds)) {
      for (const id of payload.affectedThreadIds) if (typeof id === 'string' && visible.has(id)) ids.push(id);
    }
    if ('threadIds' in payload && Array.isArray(payload.threadIds)) {
      for (const id of payload.threadIds) if (typeof id === 'string' && visible.has(id)) ids.push(id);
    }
    if (ids.length) {
      if (ids.length === 1) loadOne(ids[0]!);
      else void loadSome([...new Set(ids)]);
      return;
    }
    if ('globalDefault' in payload || 'globalFamily' in payload) {
      const relevant = [...visible].filter(id => {
        const cached = facesRef.current[id];
        return !cached || cached.source === 'automatic';
      });
      if (!relevant.length) return;
      void loadSome(relevant);
      return;
    }
    if ('projectId' in payload && typeof payload.projectId === 'string') {
      const relevant = [...visible].filter(id => {
        const cached = facesRef.current[id];
        return !cached || cached.projectId === payload.projectId;
      });
      if (!relevant.length) return;
      void loadSome(relevant);
    }
  });
  if (!preferences.showSidebar) return null;
  return <>{targets.map(({ threadId, element }, index) => {
    const cached = faces[threadId];
    const label = cached ? `Change sidebar asciimoji ${cached.face} for ${threadId}${cached.parentThreadId ? ', child thread' : ''}${states[threadId] ? ', ' + states[threadId] : ''}`
      : `Change sidebar asciimoji for ${threadId}${states[threadId] ? ', ' + states[threadId] : ''}`;
    return createPortal(
    <Button variant="ghost" className="asciimoji-sidebar-control h-auto p-0"
      aria-label={label}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { event.preventDefault(); event.stopPropagation(); opener.current = event.currentTarget; setPickerThread(threadId); }}>
      <span title={`Thread asciimoji: ${faces[threadId]?.face ?? 'Loading…'}`}>
        <Face face={faces[threadId]?.face ?? '…'} generated={faces[threadId]?.generated} expressions={faces[threadId]?.expressions}
          state={states[threadId]} animation={preferences.animation} useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} sidebar sidebarWidth={preferences.sidebarWidth} child={!!faces[threadId]?.parentThreadId} />
      </span>
    </Button>, element, `${threadId}:${index}`); })}
    {pickerThread && <ThreadFace key={pickerThread} threadId={pickerThread} pickerOnly onClose={() => setPickerThread(null)}
      restoreFocus={() => { if (opener.current?.isConnected) opener.current.focus(); }} />}
  </>;
}

export default definePluginApp(app => {
  app.contentScripts.register({ id: 'sidebar-faces', mount: mountSidebar });
  app.slots.experimental_appOverlay({ id: 'sidebar-faces', component: SidebarFaces });
  app.slots.experimental_threadHeaderAction({
    id: 'face', title: 'Thread asciimoji',
    component: ({ threadId }) => <ThreadFace key={threadId} threadId={threadId} />,
  });
  app.slots.settingsSection({
    id: 'appearance-preview', title: 'Appearance preview',
    description: 'Preview families, activity states, and sidebar widths without changing saved settings.',
    component: AsciimojiSettingsPreview,
  });
});
