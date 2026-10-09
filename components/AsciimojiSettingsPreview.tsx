import { useMemo, useState } from 'react';
import { useSettings } from '@get-bb/plugin-sdk/app';
import { FACE_FAMILIES, renderFace, type FaceFamily, type FaceState, type SidebarWidth } from '../faces.js';
import { generateFaceV3 } from '../family-definitions.js';
import { Face, usePreferences } from '../app.js';

const STATES: FaceState[] = ['idle', 'running', 'waiting', 'error'];
const WIDTHS: SidebarWidth[] = ['compact', 'standard', 'expanded'];
const LONG_FACE = '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧';

export default function AsciimojiSettingsPreview() {
  const preferences = usePreferences();
  const { values } = useSettings();
  const [family, setFamily] = useState<FaceFamily | null>(null);
  const [width, setWidth] = useState<SidebarWidth | null>(null);
  const [glyphProfile, setGlyphProfile] = useState<'unicode' | 'ascii' | null>(null);
  const effectiveGlyphProfile = glyphProfile ?? (values?.defaultGlyphProfile === 'ascii' ? 'ascii' : 'unicode');
  const effectiveFamily: FaceFamily = family ?? preferences.defaultFamily;
  const effectiveWidth: SidebarWidth = width ?? preferences.sidebarWidth;
  const sample = useMemo(() => generateFaceV3('preview', effectiveFamily, { glyphProfile: effectiveGlyphProfile }), [effectiveFamily, effectiveGlyphProfile]);
  const base = renderFace(sample, { glyphProfile: effectiveGlyphProfile });
  const globalName = FACE_FAMILIES.find(item => item.id === preferences.defaultFamily)?.name ?? 'Classic';

  return (
    <div className="asciimoji-settings-preview" aria-label="Asciimoji appearance preview">
      <div className="asciimoji-settings-preview-controls">
        <label>Preview glyphs
          <select aria-label="Preview glyph profile" value={effectiveGlyphProfile}
            onChange={event => { setGlyphProfile(event.target.value as 'unicode' | 'ascii'); }}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm">
            <option value="unicode">Unicode</option><option value="ascii">ASCII only</option>
          </select>
        </label>
        <label>Preview family
          <select
            aria-label="Preview face family"
            value={effectiveFamily}
            onChange={event => setFamily(event.target.value as FaceFamily)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          >
            {FACE_FAMILIES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Preview sidebar width
          <select
            aria-label="Preview sidebar width"
            value={effectiveWidth}
            onChange={event => setWidth(event.target.value as SidebarWidth)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          >
            {WIDTHS.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Live preview only — changing these controls never modifies saved settings.
        Global default: {globalName}. Activity: {preferences.showActivity ? preferences.activityStyle : 'off'}.
        {values === undefined ? ' Loading settings…' : ''}
      </p>
      <div className="asciimoji-settings-preview-grid">
        {STATES.map(state => (
          <div key={state} className="asciimoji-settings-preview-row">
            <span className="text-xs capitalize text-muted-foreground">{state}</span>
            <span title={base} className="font-mono text-sm">
              <Face
                face={base}
                generated={sample}
                glyphProfile={effectiveGlyphProfile}
                state={preferences.showActivity ? state : undefined}
                animation={preferences.animation}
                useThemeColor={preferences.useThemeColor}
                activityStyle={preferences.activityStyle}
              />
            </span>
            <span aria-label={state + ' sidebar preview'}>
              <Face face={base} generated={sample} glyphProfile={effectiveGlyphProfile} state={preferences.showActivity ? state : undefined}
                animation={preferences.animation} useThemeColor={preferences.useThemeColor}
                activityStyle={preferences.activityStyle} sidebar sidebarWidth={effectiveWidth} />
            </span>
          </div>
        ))}
      </div>
      <div className="asciimoji-settings-preview-row">
        <span className="text-xs text-muted-foreground">Sidebar truncation ({effectiveWidth})</span>
        <span title={LONG_FACE} className="font-mono text-xs">
          <Face
            face={LONG_FACE}
            animation="off"
            useThemeColor={preferences.useThemeColor}
            activityStyle={preferences.activityStyle}
            sidebar
            sidebarWidth={effectiveWidth}
          />
        </span>
      </div>
    </div>
  );
}
