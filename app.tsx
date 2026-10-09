import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import './app.css';
import { enableSidebar, getTargets, mountSidebar, subscribeTargets } from './sidebar.js';
import { useSettings, definePluginApp, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract, Identity, LibraryFace } from './server.js';
import type { LibraryEntry, LibraryView, TextEntry } from './library.js';
import { libraryEntryKey } from './library-shared.js';
import { FACES, FACE_FAMILIES, UnsupportedFaceProfileError, countFaceCharacters, faceValidationError, renderFace, resolveFaceDisplay, type ActivityStyle, type FaceExpressions, type FaceFamily, type GeneratedFace, type GeneratedFaceV3, type FaceState, type SidebarWidth } from './faces.js';
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
export function Face({ face, generated, expressions, state, animation, useThemeColor, sidebar = false, activityStyle = 'expressions', sidebarWidth = 'standard', glyphProfile = 'unicode' }: {
  face: string; generated?: GeneratedFace; expressions?: FaceExpressions; state?: FaceState; animation: string; useThemeColor: boolean; sidebar?: boolean;
  activityStyle?: ActivityStyle; sidebarWidth?: SidebarWidth; glyphProfile?: 'unicode' | 'ascii';
}) {
  const isWorking = state === 'running';
  const elapsed = useFaceClock(!!generated && isWorking && animation !== 'off' && activityStyle === 'expressions');
  let display;
  try {
    display = resolveFaceDisplay(face, { generated, expressions, state, activityStyle, elapsed,
      profile: sidebar ? 'compact' : 'expressive', glyphProfile,
      animation: isWorking && animation !== 'off' && elapsed > 0 });
  } catch (cause) {
    if (!(cause instanceof UnsupportedFaceProfileError)) throw cause;
    return <span className="asciimoji-face text-muted-foreground" title={cause.message} aria-label={cause.message}>Profile unavailable</span>;
  }
  const { displayed, marker } = display;
  return <span key={face + activityStyle + (state ?? 'none')} className={`asciimoji-face${useThemeColor ? ' text-primary' : ''}${sidebar ? ' asciimoji-sidebar-face' : ''}`}
    data-motion={animation} data-activity={state ?? 'none'} data-generated-version={generated?.version} {...(sidebar ? { 'data-sidebar-width': sidebarWidth } : {})}
    title={face + (state && state !== 'idle' ? ` (Activity: ${state})` : '')} aria-label={face + (state && state !== 'idle' ? `, ${state}` : '')}>
    {displayed}{marker && <span className="asciimoji-activity" aria-hidden="true">{marker}</span>}
  </span>;
}

export interface ProjectDefaultInfo { family: FaceFamily; origin: 'global' | 'project'; override: FaceFamily | null; }
interface GenerationDefaultsInfo {
  glyphProfile: 'unicode' | 'ascii';
  glyphProfileOrigin: 'global' | 'project';
  glyphProfileOverride: 'unicode' | 'ascii' | null;
}
function GenerationDefaults({ threadId, disabled }: { threadId: string; disabled: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const { values } = useSettings();
  const [info, setInfo] = useState<GenerationDefaultsInfo | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const load = useCallback(() => {
    const version = ++revision.current;
    void rpc.call('getGenerationDefaults', { threadId }).then(value => {
      if (version === revision.current) { setInfo(value); setError(null); }
    }, cause => { if (version === revision.current) setError(cause instanceof Error ? cause.message : 'Could not load generation defaults.'); });
  }, [rpc, threadId]);
  useEffect(() => { load(); return () => { revision.current++; }; }, [load, connection, values?.defaultGlyphProfile]);
  useRealtime('changed', payload => { if (payload && typeof payload === 'object' && ('projectId' in payload || 'globalDefault' in payload)) load(); });
  async function save(changes: { glyphProfile?: 'unicode' | 'ascii' | null }) {
    if (pending) return;
    setPending(true); setError(null);
    const version = ++revision.current;
    try {
      const value = await rpc.call('setGenerationDefaults', { threadId, ...changes });
      if (version === revision.current) setInfo(value);
    } catch (cause) { if (version === revision.current) setError(cause instanceof Error ? cause.message : 'Could not update generation defaults.'); }
    finally { setPending(false); }
  }
  return <div className="mt-3 space-y-2">
    <label className="flex items-center justify-between gap-2 text-sm">Project character glyphs
      <select aria-label="Project default glyph profile" value={info ? info.glyphProfileOverride ?? 'global' : ''} disabled={disabled || pending || !info}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm" onChange={event => {
          const glyphProfile = event.target.value;
          void save(glyphProfile === 'global' ? { glyphProfile: null } : { glyphProfile: glyphProfile as 'unicode' | 'ascii' });
        }}>
        {!info && <option value="">Loading…</option>}
        <option value="global">Use global default ({values?.defaultGlyphProfile === 'ascii' ? 'ASCII' : 'Unicode'})</option>
        <option value="unicode">Unicode</option><option value="ascii">ASCII only</option>
      </select>
    </label>
    <p className="text-xs text-muted-foreground">Changes affect following automatic faces and future threads. Saved thread choices keep their characters.</p>
    {info && <p className="text-xs text-muted-foreground">Glyphs: {info.glyphProfile === 'ascii' ? 'ASCII' : 'Unicode'} ({info.glyphProfileOrigin}).</p>}
    {error && <div><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" disabled={pending} onClick={load}>Retry generation defaults</Button></div>}
  </div>;
}
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

function FaceLibrary({ identity, disabled, onApply, onCharacterApply }: {
  identity: Identity; disabled: boolean; onApply: (entry: LibraryFace) => void; onCharacterApply: (identity: Identity) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [library, setLibrary] = useState<LibraryView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selectedAdds, setSelectedAdds] = useState<string[]>([]);
  const [selectedRemoves, setSelectedRemoves] = useState<string[]>([]);
  const [selectedRecentAdds, setSelectedRecentAdds] = useState<string[]>([]);
  const [selectedRecentRemoves, setSelectedRecentRemoves] = useState<string[]>([]);
  const revision = useRef(0);
  const libraryRevision = useRef(0);
  const reviewTrigger = useRef<HTMLButtonElement>(null);
  // Older test fixtures/windows may still return plain text entries.
  const normalize = (value: LibraryView): LibraryView => ({ ...value,
    favorites: value.favorites.map(entry => ({ ...entry, kind: entry.kind ?? 'text' }) as LibraryEntry),
    recent: value.recent.map(entry => ({ ...entry, kind: entry.kind ?? 'text' }) as LibraryEntry) });
  const load = useCallback(() => {
    const version = ++revision.current;
    const mutation = libraryRevision.current;
    void rpc.call('getLibrary', {}).then(value => {
      if (version === revision.current && mutation === libraryRevision.current) { setLibrary(normalize(value)); setError(null); }
    }, cause => { if (version === revision.current) setError(cause instanceof Error ? cause.message : 'Could not load your face library.'); });
  }, [rpc]);
  useEffect(() => { load(); return () => { revision.current++; }; }, [load, connection]);
  useRealtime('library', load);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden && !pending) load(); }, 5000);
    const visible = () => { if (!document.hidden && !pending) load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [load, pending]);
  useEffect(() => { setSelectedAdds([]); setSelectedRemoves([]); setSelectedRecentAdds([]); setSelectedRecentRemoves([]); }, [library?.legacyChanges?.fingerprint]);
  const describeExpressions = (entry: LibraryEntry) => entry.kind === 'text' ?
    (['running', 'waiting', 'error'] as const).flatMap(state => entry.expressions?.[state] ? [state + ' ' + entry.expressions[state]] : []).join(', ') : '';
  const entryLabel = (entry: LibraryEntry) => {
    const detail = describeExpressions(entry);
    return entry.face + (entry.kind === 'generated' ? ' (character)' : detail ? ' (' + detail + ')' : '');
  };
  const current: TextEntry = { kind: 'text', face: identity.face, ...(identity.expressions ? { expressions: identity.expressions } : {}) };
  const saved = !!library?.favorites.some(entry => libraryEntryKey(entry) === libraryEntryKey(current));
  async function update(action: () => Promise<LibraryView>, review = false) {
    if (pending) return;
    setPending(true); setError(null); libraryRevision.current++;
    const version = ++revision.current;
    try {
      const value = await action();
      if (version === revision.current) {
        setLibrary(normalize(value));
        if (review) { setReviewOpen(false); requestAnimationFrame(() => reviewTrigger.current?.focus()); }
      }
    } catch (cause) {
      if (version === revision.current) {
        const message = cause instanceof Error ? cause.message : 'Could not update your face library.';
        setError(message);
        if (message.includes('LEGACY_REVIEW_STALE')) load();
      }
    } finally { setPending(false); }
  }
  async function apply(entry: LibraryEntry) {
    if (entry.kind === 'text') { onApply({ face: entry.face, ...(entry.expressions ? { expressions: entry.expressions } : {}) }); return; }
    if (pending) return;
    setPending(true); setError(null);
    const version = ++revision.current;
    try {
      const value = await rpc.call('applyLibraryCharacter', { threadId: identity.threadId, snapshotId: entry.snapshotId });
      if (version === revision.current) onCharacterApply(value);
    } catch (cause) { if (version === revision.current) setError(cause instanceof Error ? cause.message : 'Could not reuse this character.'); }
    finally { setPending(false); }
  }
  const changes = library?.legacyChanges;
  const toggle = (key: string, checked: boolean, setter: (value: (current: string[]) => string[]) => void) => setter(current => checked ? [...current, key] : current.filter(item => item !== key));
  return <div className="asciimoji-picker-library">
    <div className="asciimoji-picker-section-heading">
      <div><h3>Your face library</h3><p>Quickly reuse the characters you love.</p></div>
      <span className="asciimoji-picker-section-number">03</span>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={disabled || pending || !library} onClick={() => void update(() => rpc.call('favorite', { face: current.face, ...(current.expressions ? { expressions: current.expressions } : {}), saved: !saved }))}>
        {saved ? 'Remove saved text' : 'Save text'}
      </Button>
      {identity.generated && <Button variant="outline" disabled={disabled || pending || !library}
        onClick={() => void update(() => rpc.call('favoriteCharacter', { threadId: identity.threadId, saved: true }))}>Save character</Button>}
    </div>
    <p className="text-xs text-muted-foreground">Saved text keeps its expressions. Saved characters retain their paired traits, personality, and activity.</p>
    {changes && <div className="space-y-2 rounded-md border p-3" role="status">
      <p className="text-sm">An older Asciimoji window changed the face library. Your saved characters are preserved.</p>
      <div className="flex flex-wrap gap-2">
        <Button ref={reviewTrigger} variant="outline" disabled={pending} onClick={() => {
          setReviewOpen(true); void update(() => rpc.call('reviewLibrary', {}));
        }}>Review text changes</Button>
        <Button variant="outline" disabled={pending} onClick={() => void update(() => rpc.call('reconcileLibrary', { fingerprint: changes.fingerprint, keepCurrent: true }), true)}>Keep current library</Button>
      </div>
      {reviewOpen && <div className="space-y-2" aria-label="Review older text changes">
        <p className="text-xs text-muted-foreground">Select text changes to import. Character favorites stay saved. Reload older windows to load the current Asciimoji UI.</p>
        {(['added', 'removed'] as const).map(kind => <fieldset key={kind} disabled={pending}>
          <legend className="text-sm">{kind === 'added' ? 'Add text favorites' : 'Remove text favorites'}</legend>
          {changes[kind].map(entry => <label key={libraryEntryKey(entry)} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={(kind === 'added' ? selectedAdds : selectedRemoves).includes(libraryEntryKey(entry))}
              onChange={event => toggle(libraryEntryKey(entry), event.target.checked, kind === 'added' ? setSelectedAdds : setSelectedRemoves)} />
            <span className="font-mono">{entryLabel(entry)}</span>
          </label>)}
          {!changes[kind].length && <p className="text-xs text-muted-foreground">No text changes.</p>}
        </fieldset>)}
        {(changes.recentAdded || changes.recentRemoved) && <>
          {(['recentAdded', 'recentRemoved'] as const).map(kind => <fieldset key={kind} disabled={pending}>
            <legend className="text-sm">{kind === 'recentAdded' ? 'Add recent text faces' : 'Remove recent text faces'}</legend>
            {(changes[kind] ?? []).map(entry => <label key={libraryEntryKey(entry)} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={(kind === 'recentAdded' ? selectedRecentAdds : selectedRecentRemoves).includes(libraryEntryKey(entry))}
                onChange={event => toggle(libraryEntryKey(entry), event.target.checked, kind === 'recentAdded' ? setSelectedRecentAdds : setSelectedRecentRemoves)} />
              <span className="font-mono">{entryLabel(entry)}</span>
            </label>)}
            {!(changes[kind] ?? []).length && <p className="text-xs text-muted-foreground">No recent text changes.</p>}
          </fieldset>)}
        </>}
        <Button disabled={pending} onClick={() => void update(() => rpc.call('reconcileLibrary', { fingerprint: changes.fingerprint, add: selectedAdds, remove: selectedRemoves,
          ...(changes.recentAdded || changes.recentRemoved ? { recentAdd: selectedRecentAdds, recentRemove: selectedRecentRemoves } : {}) }), true)}>Import selected text changes</Button>
        <Button variant="ghost" disabled={pending} onClick={() => { setReviewOpen(false); setSelectedAdds([]); setSelectedRemoves([]); setSelectedRecentAdds([]); setSelectedRecentRemoves([]); reviewTrigger.current?.focus(); }}>Cancel review</Button>
      </div>}
    </div>}
    {library?.projectionPending && <p role="status" className="text-xs text-muted-foreground">Your saved characters are preserved. Updating the older text library is pending.</p>}
    {!library && !error && <p className="text-xs text-muted-foreground">Loading library…</p>}
    {library && <>
      <div className="asciimoji-picker-library-grid">
        {library.favorites.map(entry => <div className="flex min-w-0 gap-1" key={libraryEntryKey(entry)}>
          <Button variant="outline" className="asciimoji-picker-saved-face min-w-0 flex-1 truncate font-mono text-xs" disabled={disabled || pending}
            aria-label={'Reuse favorite: ' + entryLabel(entry)} onClick={() => void apply(entry)}>
            <span className="truncate" title={entryLabel(entry)}>{entry.face}{entry.kind === 'generated' && <span className="ml-1 text-[10px] text-muted-foreground">character</span>}</span>
          </Button>
          <Button variant="ghost" disabled={disabled || pending} aria-label={'Remove favorite: ' + entryLabel(entry)}
            onClick={() => void update(() => rpc.call('removeLibraryEntry', { entry }))}>×</Button>
        </div>)}
      </div>
      {!library.favorites.length && <p className="text-xs text-muted-foreground">Save text or a character to keep it here.</p>}
      {!!library.recent.length && <details><summary className="cursor-pointer text-sm">Recent faces</summary>
        <div className="mt-2 grid max-h-40 grid-cols-3 gap-2 overflow-y-auto">
          {library.recent.map(entry => <Button key={libraryEntryKey(entry)} variant="outline" className="truncate font-mono text-xs" disabled={disabled || pending}
            aria-label={'Reuse recent: ' + entryLabel(entry)} onClick={() => void apply(entry)}><span className="truncate" title={entryLabel(entry)}>{entry.face}</span></Button>)}
        </div>
      </details>}
    </>}
    {error && <div><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" disabled={pending} onClick={load}>Retry library</Button></div>}
  </div>;
}

type TraitLocks = { outline: boolean; eyes: boolean; mouth: boolean; accessory: boolean };
function VariationGallery({ threadId, onSave, onCancel, glyphProfile }: {
  threadId: string; onSave: (identity: Identity) => void; onCancel: () => void; glyphProfile?: 'unicode' | 'ascii';
}) {
  const rpc = useRpc<typeof rpcContract>();
  const preferences = usePreferences();
  const [locks, setLocks] = useState<TraitLocks>({ outline: false, eyes: false, mouth: false, accessory: false });
  const [resemblance, setResemblance] = useState<'close' | 'wide'>('close');
  const [candidates, setCandidates] = useState<{ token: string; face: string; generated: GeneratedFaceV3 }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const initialLoad = useRef(false);
  const load = useCallback(async (nextLocks?: TraitLocks, nextResemblance: 'close' | 'wide' = 'close') => {
    const version = ++revision.current;
    setPending(true); setError(null); setSelected(null); setCandidates([]); setNotice(null);
    try {
      const result = await rpc.call('candidates', { threadId, ...(nextLocks ? { locks: nextLocks } : {}), resemblance: nextResemblance, count: 6 });
      if (version === revision.current) { setCandidates(result.candidates); setLocks(result.locks); setNotice(result.notice ?? null); initialLoad.current = true; }
    } catch (cause) { if (version === revision.current) setError(cause instanceof Error ? cause.message : 'Could not load variations.'); }
    finally { if (version === revision.current) setPending(false); }
  }, [rpc, threadId]);
  useEffect(() => { void load(); return () => { revision.current++; }; }, [load]);
  async function save() {
    if (!selected || pending) return;
    const version = ++revision.current;
    setPending(true); setSaving(true); setError(null);
    try {
      const result = await rpc.call('applyCandidate', { threadId, token: selected });
      if (version === revision.current) onSave(result);
    } catch (cause) {
      if (version === revision.current) {
        const message = cause instanceof Error ? cause.message : 'Could not save this variation.';
        setError(message);
        if (message.includes('PREVIEW_EXPIRED')) { setCandidates([]); setSelected(null); }
      }
    } finally { if (version === revision.current) { setPending(false); setSaving(false); } }
  }
  const clearDrafts = () => { setCandidates([]); setSelected(null); setNotice(null); };
  return <section className="space-y-3 rounded-lg border p-3" aria-label="Variation gallery">
    <p className="text-sm font-medium">Explore related characters</p>
    <p className="text-xs text-muted-foreground">Previews are drafts. Choose a character and Save variation to keep it. Personality stays the same.</p>
    <fieldset disabled={pending} className="space-y-2">
      <legend className="text-sm">Keep these traits</legend>
      <div className="grid grid-cols-2 gap-2">
        {(['outline', 'eyes', 'mouth', 'accessory'] as const).map(trait => <label key={trait} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={locks[trait]} onChange={event => { setLocks(current => ({ ...current, [trait]: event.target.checked })); clearDrafts(); }} />
          {trait === 'accessory' ? 'Accessories and decorations' : trait === 'eyes' ? 'Eye pair' : trait[0]!.toUpperCase() + trait.slice(1)}
        </label>)}
      </div>
      <label className="flex items-center justify-between gap-2 text-sm">Resemblance
        <select aria-label="Variation resemblance" value={resemblance} onChange={event => { setResemblance(event.target.value as 'close' | 'wide'); clearDrafts(); }}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm">
          <option value="close">Close</option><option value="wide">Explore widely</option>
        </select>
      </label>
    </fieldset>
    <div role="radiogroup" aria-label="Variation previews" className="grid grid-cols-2 gap-2">
      {candidates.map((candidate, index) => <Button key={candidate.token} role="radio" aria-checked={selected === candidate.token}
        aria-label={'Variation ' + (index + 1) + ': ' + candidate.face} disabled={pending}
        tabIndex={selected ? selected === candidate.token ? 0 : -1 : index === 0 ? 0 : -1}
        variant={selected === candidate.token ? 'secondary' : 'outline'} onClick={() => setSelected(candidate.token)}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? candidates.length - 1
            : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + candidates.length) % candidates.length;
          setSelected(candidates[next]!.token);
          const group = event.currentTarget.parentElement;
          (group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next])?.focus();
        }}>
        <Face face={candidate.face} generated={candidate.generated} glyphProfile={glyphProfile} animation="off" useThemeColor={preferences.useThemeColor} />
      </Button>)}
    </div>
    {pending && <p role="status" className="text-xs text-muted-foreground">Loading variations…</p>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error.includes('PREVIEW_EXPIRED') ? 'These previews expired. Refresh previews to continue. Your saved character has not changed.' : error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={pending} onClick={() => void load(initialLoad.current ? locks : undefined, resemblance)}>Refresh previews</Button>
      <Button disabled={pending || !selected} onClick={() => void save()}>Save variation</Button>
      <Button variant="ghost" disabled={saving} onClick={onCancel}>Cancel variations</Button>
    </div>
  </section>;
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
  const [glyphProfile, setGlyphProfile] = useState<'unicode' | 'ascii'>('unicode');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [presetQuery, setPresetQuery] = useState('');
  const [pickerTab, setPickerTab] = useState<'presets' | 'characters' | 'custom' | 'saved'>('presets');
  const [projectDefaultsOpen, setProjectDefaultsOpen] = useState(false);
  const galleryTrigger = useRef<HTMLButtonElement>(null);
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
    void rpc.call('previews', { threadId, ...(glyphProfile === 'ascii' ? { glyphProfile } : {}) }).then(values => {
      if (alive.current && version === previewRevision.current) setPreviews(Object.fromEntries(values.map(item => [item.family, item.face])));
    }, () => { if (alive.current && version === previewRevision.current) setPreviewError(true); });
  }, [rpc, threadId, glyphProfile]);
  useEffect(() => { setGlyphProfile(identity?.glyphProfile ?? 'unicode'); }, [identity?.glyphProfile]);
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
    if (value) { setEditing(false); setPreviewState('idle'); setGlyphProfile(identity?.glyphProfile ?? 'unicode'); setPresetQuery(''); setPickerTab('presets'); setError(null); }
    else { setGalleryOpen(false); onClose?.(); }
  };
  async function save(action: 'set' | 'shuffle' | 'reset' | 'generate' | 'vary', entry?: LibraryFace, family?: FaceFamily) {
    if (pending) return;
    setPending(true);
    setError(null);
    const version = ++revision.current;
    try {
      const value = action === 'set' ? await rpc.call('set', { threadId, ...(entry ?? { face: draft, expressions }) })
        : action === 'generate' ? await rpc.call('generate', { threadId, ...(family ? { family } : {}), ...(glyphProfile === 'ascii' ? { glyphProfile } : {}) })
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
  const filteredPresets = FACES.filter(item => {
    const query = presetQuery.trim().toLocaleLowerCase();
    return !query || item.name.toLocaleLowerCase().includes(query) || item.face.toLocaleLowerCase().includes(query);
  });
  if (!visible) return null;
  return <Dialog open={open} onOpenChange={changeOpen}>
    {!pickerOnly && <DialogTrigger asChild>
      <Button variant="ghost" className="h-7 max-w-40 truncate px-2 font-mono text-xs"
        aria-label={identity ? 'Change thread asciimoji: ' + identity.face + (states[threadId] ? ', ' + states[threadId] : '')
          : error ? 'Retry thread asciimoji' : 'Loading thread asciimoji'}
        onClick={event => { if (!identity) { event.preventDefault(); load(); } }}>
        {identity ? <Face face={identity.face} generated={identity.generated} glyphProfile={identity.glyphProfile} expressions={identity.expressions}
          state={states[threadId]} animation={preferences.animation} useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} />
          : error ? <span title={error}>Retry face</span> : 'Loading…'}
      </Button>
    </DialogTrigger>}

    <DialogContent className="asciimoji-picker-dialog max-h-[90dvh] overflow-y-auto"
      onCloseAutoFocus={event => { if (restoreFocus) { event.preventDefault(); restoreFocus(); } }}>
      <DialogHeader className="asciimoji-picker-heading">
        <DialogTitle>Choose an asciimoji</DialogTitle>
        <DialogDescription>Pick a face for this thread. Select a preset or make your own.</DialogDescription>
      </DialogHeader>
      {!identity ? <div className="asciimoji-picker-loading"><p role={error ? 'alert' : 'status'}>{error ?? 'Loading face…'}</p>
        {error && <Button variant="outline" onClick={load}>Retry face</Button>}</div> : <>
        <div className="asciimoji-picker-current-row">
          <div className="asciimoji-preview asciimoji-picker-current" title={preview}
            aria-label={editing ? 'Draft asciimoji preview' : 'Current asciimoji'}>
            <Face face={preview} generated={editing ? undefined : identity.generated} glyphProfile={editing ? 'unicode' : identity.glyphProfile}
              expressions={previewExpressions} state={previewActivity} animation={preferences.animation}
              useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} />
          </div>
          <div className="asciimoji-picker-current-label">
            <span>{editing ? 'Unsaved draft' : 'Current face'}</span>
            <p role="status" title={scopeLabel}>{scopeLabel}</p>
          </div>
        </div>
        <div className="asciimoji-picker-tabs" role="tablist" aria-label="Face picker sections">
          {(['presets', 'characters', 'custom', 'saved'] as const).map((tab, index, tabs) =>
            <Button key={tab} type="button" role="tab" id={'asciimoji-tab-' + tab}
              aria-controls="asciimoji-picker-panel" aria-selected={pickerTab === tab}
              tabIndex={pickerTab === tab ? 0 : -1}
              variant="ghost" onClick={() => setPickerTab(tab)}
              onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                  : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
                setPickerTab(tabs[next]!);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
              }}>
              {tab === 'presets' ? 'Presets' : tab === 'characters' ? 'Characters' : tab === 'custom' ? 'Custom' : 'Saved'}
            </Button>)}
        </div>
        <div id="asciimoji-picker-panel" role="tabpanel" aria-labelledby={'asciimoji-tab-' + pickerTab}
          className="asciimoji-picker-panel" tabIndex={0}>
          {pickerTab === 'presets' && <>
            <Input aria-label="Search preset faces" placeholder="Search faces…" value={presetQuery}
              onChange={event => setPresetQuery(event.target.value)} className="asciimoji-picker-search" />
            <div className="asciimoji-picker-preset-grid">
              {filteredPresets.map(item => <Button key={item.name} variant={!identity.generated && identity.face === item.face ? 'secondary' : 'outline'}
              className="asciimoji-picker-choice h-auto flex-col gap-1 px-1 py-3" disabled={pending}
              aria-pressed={!identity.generated && identity.face === item.face}
              aria-label={'Choose ' + item.name + ': ' + item.face} onClick={() => void save('set', { face: item.face })}>
              <span className="font-mono text-xs"><Face face={item.face} animation={preferences.animation} useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} /></span>
              <span className="text-xs text-muted-foreground">{item.name}</span>
            </Button>)}
            </div>
            {!filteredPresets.length && <p className="asciimoji-picker-no-results" role="status">No faces match “{presetQuery}”.</p>}
          </>}
          {pickerTab === 'characters' && <div className="asciimoji-picker-character-panel">
                      <label className="flex items-center justify-between gap-2 text-sm">Character glyphs
            <select aria-label="Character glyph profile" value={glyphProfile} disabled={pending}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              onChange={event => { setPreviews({}); setGlyphProfile(event.target.value as 'unicode' | 'ascii'); }}>
              <option value="unicode">Unicode</option><option value="ascii">ASCII only</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">Characters have paired traits and personality. Choose a family to save a new character.</p>
          <div className="asciimoji-picker-family-grid">
            {FACE_FAMILIES.map(item => <Button key={item.id}
              variant={identity.generated && (identity.glyphProfile ?? 'unicode') === glyphProfile && (identity.generated.family ?? 'classic') === item.id ? 'secondary' : 'outline'}
              className="asciimoji-picker-choice h-auto flex-col gap-1 px-1 py-2" disabled={pending || !previews[item.id]}
              aria-pressed={!!identity.generated && (identity.glyphProfile ?? 'unicode') === glyphProfile && (identity.generated.family ?? 'classic') === item.id}
              aria-label={'Keep ' + item.name + ' family'} onClick={() => void save('generate', undefined, item.id)}>
              <span className="font-mono text-xs"><Face face={previews[item.id] ?? '…'} animation={preferences.animation} useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} /></span>
              <span className="text-xs text-muted-foreground">{item.name}</span>
            </Button>)}
          </div>
          {previewError && <div><p role="alert" className="text-sm text-destructive">Could not load family previews.</p>
            <Button variant="outline" onClick={loadPreviews}>Retry previews</Button></div>}
          <Button variant="outline" disabled={pending} onClick={() => void save('vary')}>Try another variation</Button>
          {identity.generated?.version === 3 && !galleryOpen && <Button ref={galleryTrigger} variant="outline" disabled={pending}
            onClick={() => setGalleryOpen(true)}>Explore variations</Button>}
          {identity.generated?.version === 3 && galleryOpen && <VariationGallery key={JSON.stringify(identity.generated)} threadId={threadId} glyphProfile={identity.glyphProfile}
            onSave={value => { setIdentity(value); changeOpen(false); }}
            onCancel={() => { setGalleryOpen(false); requestAnimationFrame(() => galleryTrigger.current?.focus()); }} />}
          <p className="text-xs text-muted-foreground">A variation is saved for this thread. Children in the same generated family share their parent’s eyes.</p>
          </div>}
          {pickerTab === 'custom' && <div className="asciimoji-picker-custom-panel">
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
                <Face face={preview} generated={editing ? undefined : identity.generated} glyphProfile={editing ? 'unicode' : identity.glyphProfile} expressions={previewExpressions} state={previewState} animation="off" useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} />
              </span>
              <span aria-label="Sidebar size preview" title={preview}><Face face={preview} generated={editing ? undefined : identity.generated} glyphProfile={editing ? 'unicode' : identity.glyphProfile} expressions={previewExpressions}
                state={previewState} animation="off" useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} sidebar sidebarWidth={preferences.sidebarWidth} /></span>
            </div>
          </details>
              </form>
          </div>}
          {pickerTab === 'saved' && <FaceLibrary identity={identity} disabled={pending}
            onApply={entry => void save('set', entry)}
            onCharacterApply={value => { setIdentity(value); changeOpen(false); }} />}
        </div>
        {error && <div className="asciimoji-picker-error"><p role="alert" className="text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={load} disabled={pending}>Reload face</Button></div>}
        <div className="asciimoji-picker-footer">
          <Button variant="outline" disabled={pending} onClick={() => void save('shuffle')}>Surprise me</Button>
          <Button variant="ghost" disabled={pending || identity.source === 'automatic'}
            onClick={() => void save('reset')}>Use automatic face</Button>
        </div>
        <div className="asciimoji-picker-settings">
          <details onToggle={event => setProjectDefaultsOpen(event.currentTarget.open)}>
                <summary className="cursor-pointer text-sm">Project defaults</summary>
          <div className="mt-2"><ProjectFamily threadId={threadId} disabled={pending} onFamily={setProjectInfo} /></div>
                {projectDefaultsOpen && <GenerationDefaults threadId={threadId} disabled={pending} />}
              </details>
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
    const label = cached ? `Change sidebar asciimoji ${cached.face} for ${threadId}${states[threadId] ? ', ' + states[threadId] : ''}`
      : `Change sidebar asciimoji for ${threadId}${states[threadId] ? ', ' + states[threadId] : ''}`;
    return createPortal(
    <Button variant="ghost" className="asciimoji-sidebar-control h-auto p-0"
      aria-label={label}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { event.preventDefault(); event.stopPropagation(); opener.current = event.currentTarget; setPickerThread(threadId); }}>
      <span title={`Thread asciimoji: ${faces[threadId]?.face ?? 'Loading…'}`}>
        <Face face={faces[threadId]?.face ?? '…'} generated={faces[threadId]?.generated} glyphProfile={faces[threadId]?.glyphProfile} expressions={faces[threadId]?.expressions}
          state={states[threadId]} animation={preferences.animation} useThemeColor={preferences.useThemeColor} activityStyle={preferences.activityStyle} sidebar sidebarWidth={preferences.sidebarWidth} />
      </span>
    </Button>, element, `${threadId}:${index}`); })}
    {pickerThread && <ThreadFace key={pickerThread} threadId={pickerThread} pickerOnly onClose={() => setPickerThread(null)}
      restoreFocus={() => { if (opener.current?.isConnected) opener.current.focus(); }} />}
  </>;
}

export default definePluginApp(app => {
  // Experimental host surfaces are optional at runtime, even on a supported
  // BB engine: a missing slot must not stop settings or CLI functionality.
  // Registration is independent of the overlay capability. On hosts without
  // an overlay this content script remains dormant because nothing enables it.
  if (typeof app.contentScripts?.register === 'function') {
    app.contentScripts.register({ id: 'sidebar-faces', mount: mountSidebar });
  }
  if (typeof app.slots.experimental_appOverlay === 'function' &&
    typeof app.contentScripts?.register === 'function') {
    app.slots.experimental_appOverlay({ id: 'sidebar-faces', component: SidebarFaces });
  }
  if (typeof app.slots.experimental_threadHeaderAction === 'function') {
    app.slots.experimental_threadHeaderAction({
      id: 'face', title: 'Thread asciimoji',
      component: ({ threadId }) => <ThreadFace key={threadId} threadId={threadId} />,
    });
  }
  app.slots.settingsSection({
    id: 'appearance-preview', title: 'Appearance preview',
    description: 'Preview families, activity states, and sidebar widths without changing saved settings.',
    component: AsciimojiSettingsPreview,
  });
});
