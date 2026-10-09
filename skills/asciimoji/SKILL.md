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
New automatic children in the same generated family use their parent's actual eyes across generations. New saved generated faces store their identity and seed; their eyes stay as saved if the parent later changes. Stored version-1 generated recipes migrate on first read into version-2 snapshots without changing their five-codepoint face. Generated faces are automatic
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
without `--family` saves the current project family. Older saved generated recipes migrate without visual churn and remain stable as saved snapshots.
Use `bb asciimoji project-default` to read the target thread's effective family (JSON adds `origin` and `override`),
or `bb asciimoji project-default robot` to set a project override. `classic` stores an explicit Classic override.
`inherit` deletes the override. Classic selects a mixed-style family. Automatic faces use the varied version-2 generator. Precedence is thread → project → global default. Project defaults apply to existing and new automatic
faces; saved thread overrides stay as they are. Reset removes a thread override
and follows the current global/project defaults. These controls also appear in the
thread picker (Use global default, Use automatic face) and sync across windows, including sidebar faces.

The picker labels automatic choices as Following global/project default and overrides as Saved for this thread. Keep a family saves an override; Use automatic face is Reset. Authoritative family previews match the saved result.

Use `bb asciimoji vary` or Try another variation to save a visibly different face in the current generated family; text choices use the project family. The choice persists across reloads.

Use `bb asciimoji favorite` to save current text and custom expressions; add
`--character` to preserve a complete generated character, or `--remove` to remove
that exact kind. Text and character favorites remain distinct even with the same
face. `bb asciimoji library --json` returns text entries and generated snapshot
references. The library holds 50 favorites and 20 distinct recent choices.
Reusing a character pins its exact glyph snapshot and activity behavior.

Use `bb asciimoji generate --family cat` for a character, or add `--glyph-profile ascii` for printable ASCII.
Characters have paired eyes, layered decorations, a fixed personality, and
saved compact geometry. Their activity preserves identifying eyes. Vary keeps the glyph profile. Optional `--lock-outline`, `--lock-eyes`, `--unlock-eyes`,
`--lock-mouth`, `--lock-accessory`, and `--resemblance close|wide` control variation.
Accessories lock includes every decoration layer and its absence.

The gallery previews local drafts: choose a candidate then Save. Cancel
and Refresh do not save. Previews expire after five minutes, reload, or relevant
context changes; `PREVIEW_EXPIRED` offers Refresh and writes nothing. Global
`defaultGlyphProfile` and project overrides affect
following automatic faces; saved choices remain pinned.

The canonical library uses `library:v2` with immutable `library:snapshot:` blobs;
the old `library` key remains a text projection. Older text changes produce a
persistent Review text changes/Keep current library banner. Import only selected
text changes; projected text deletion never removes a character. Corrupt/future
canonical data blocks mutation instead of becoming empty. Reload old windows
before editing v3 choices: old builds display them as automatic v2, and old
mutating commands overwrite them.

Preview tokens and queues assume one active plugin server factory; reload or
cross-worker Apply expires previews. They do not coordinate distributed writers.

Set optional custom activity faces with `bb asciimoji set ':-)' --running ':D' --waiting ':?' --error ':('`. Set replaces the expression map; omitted states use markers. The picker has the same three inputs and an activity preview. Favorites preserve mappings. Controls use the same face validation for every state. JSON identities report `source` (automatic, generated, preset, custom) and `projectId`; the `custom` boolean was removed in the 1.0.0 breaking API (use `source`).

Header, sidebar, and open pickers share activity reads per window. Notifications refresh only affected threads; requests coalesce and reconnects restore authoritative state.
