---
name: asciimoji
description: Show or change the persistent asciimoji for a bb thread when the user asks to personalize its face.
---

Use `bb asciimoji get`, `set '<face>'`, `shuffle`, `generate`, `vary`, `favorite [--remove]`, `library`, `project-default [family|inherit]`, or `reset`.
Commands use the current thread by default; add `--thread thr_...` to select another thread.
Add `--json` for structured output. Quote custom faces in the shell.

The same controls are available by clicking the asciimoji in the thread header or sidebar (when enabled), including with the header disabled.
Faces are limited to 40 Unicode code points on a single visible line. Controls, invisible formatting characters, and entirely invisible faces are rejected. The editor previews drafts, counts characters, and offers Retry when loading fails. Choices sync across
windows and survive plugin reloads and session restarts. Reset (Use automatic face) restores a stable
face derived from the thread id in the effective global/project family. Titles and agent prompts are unaffected.

Settings are under Settings → Plugins → Asciimoji. `showHeader` defaults to true,
`showSidebar` and `useThemeColor` to false, `animation` to `subtle` (also `off` and `playful`),
`sidebarWidth` to `standard` (also `compact` 6ch and `expanded` 16ch), `activityStyle` to
`expressions` (also `markers`), and `defaultFamily` to `classic`.
Use `bb plugin config asciimoji set showSidebar true` to enable sidebar faces.
Use `bb plugin config asciimoji set animation playful` to change animation style.
Use `bb plugin config asciimoji set useThemeColor true` to color faces with the
user’s theme primary color in the header, picker, and sidebar. Colors follow
theme changes automatically. Animations honor system reduced-motion preferences. Settings update live
and sync across windows. An Appearance preview section shows header/sidebar faces, activity states,
and truncation without modifying saved settings.

`bb asciimoji generate` saves a deterministic face assembled from the thread ID.
New automatic children in the same generated family use their parent's actual eyes across generations. New saved generated faces store their identity and seed; their eyes stay as saved if the parent later changes. Legacy version-1 saved choices retain the old generator. Generated faces are automatic
for every thread; saved presets and custom
choices remain explicit overrides. Generate replaces an override; reset restores
the automatic generated face.
`showActivity` is enabled by default; configure it in plugin settings or with
`bb plugin config asciimoji set showActivity true`. `activityStyle` defaults to `expressions`;
`markers` keeps static text plus ·, ?, ! markers. Generated faces express idle,
running, waiting, and error; custom faces and presets keep their text and show a small marker unless a custom activity expression is saved. Only running threads animate; Animation Off keeps static expressions. Motion pauses in hidden
windows and for reduced motion. CLI output is the static saved identity, not
live activity. Running does not distinguish thinking from tools; idle does not
assert successful completion.


Face families are `classic`, `bear`, `robot`, `cat`, and `minimal`. Use
`bb asciimoji generate --family bear` to save a thread family override. Generate
without `--family` saves the current project family. Existing version-1 saved generated choices retain their original identity and family.
Use `bb asciimoji project-default` to read the target thread's effective family (JSON adds `origin` and `override`),
or `bb asciimoji project-default robot` to set a project override. `classic` stores an explicit Classic override.
`inherit` deletes the override. Classic selects a mixed-style family. Automatic faces use the varied version-2 generator. Precedence is thread → project → global default. Project defaults apply to existing and new automatic
faces; saved thread overrides stay as they are. Reset removes a thread override
and follows the current global/project defaults. These controls also appear in the
thread picker (Use global default, Use automatic face) and sync across windows, including sidebar faces.

The picker labels automatic choices as Following global/project default and overrides as Saved for this thread. Keep a family saves an override; Use automatic face is Reset. Authoritative family previews match the saved result.

Use `bb asciimoji vary` or Try another variation to save a visibly different face in the current generated family; text choices use the project family. The choice persists across reloads.

Use `bb asciimoji favorite` to favorite the current static face and any custom expressions; `--remove` removes that exact combination. `bb asciimoji library --json` lists favorites and recent faces without requiring a thread. The library stores up to 50 favorites and 20 distinct recent choices, syncs across windows, and survives reloads. Reusing a generated favorite saves its static text with activity markers, not its generated identity.

Set optional custom activity faces with `bb asciimoji set ':-)' --running ':D' --waiting ':?' --error ':('`. Set replaces the expression map; omitted states use markers. The picker has the same three inputs and an activity preview. Favorites preserve mappings. Controls use the same face validation for every state. JSON identities report `source` (automatic, generated, preset, custom) and `projectId`; `custom` remains the compatibility flag for any explicit override.

Header, sidebar, and open pickers share activity reads per window. Notifications refresh only affected threads; requests coalesce and reconnects restore authoritative state.
