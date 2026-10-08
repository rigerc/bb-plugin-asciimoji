# Asciimoji for bb

Give each thread a persistent asciimoji with presets, custom faces, optional sidebar faces, and activity feedback.

Give every thread a familiar face: `ʕ•ᴥ•ʔ`, `(⌐■_■)`, or your own.

Each thread automatically gets a stable generated face. Click it in the header,
or enable sidebar faces and click one there, to choose a family, preset, favorite,
recent choice, or custom face. Saved choices sync between connected windows and
persist across sessions. Titles and agent prompts are unaffected.

## Install

Requires bb >=0.45 <1 with Plugin SDK >=0.6.15 <1, plus Node.js and npm.

```sh
cd bb-plugin-asciimoji
npm install --include=dev
bb plugin build
bb plugin install .
```

## Choose a face

The picker shows whether a thread is **Following project** or **Saved for this thread**.

- **Keep a family** saves the displayed preview as this thread's generated choice.
- **Try another variation** saves a visibly different face in the current generated
  family. For presets/custom faces, it uses the project's family.
- **Follow project default** removes the thread override. The automatic face follows
  future project-family changes.
- **Surprise me** chooses a different one of the 12 named presets.
- **Custom face** previews your draft as you type, including at header and sidebar
  sizes. Save applies the draft; closing the picker discards unsaved edits.

Custom faces allow up to 40 Unicode code points on one visible line. Controls,
invisible formatting characters, and entirely invisible faces are rejected.
The character counter and validation match the server.

### Families and project defaults

Families are **Classic**, **Bears**, **Robots**, **Cats**, and **Minimal**.
New generated faces include varied mouths and accessories so siblings remain
distinguishable. Family previews are computed by the backend with the same
parent information used when saving.

Automatic children in the same generated family use their parent's actual eyes,
including across multiple generations. A parent with a custom/preset face or a
different generated family does not supply eyes. Saved generated faces retain
the eyes they had when saved, even if the parent later changes.

Expand **Project defaults** in the picker to change the family for all automatic
faces in that project, including new threads. Saved choices remain as they are.

Generated faces use one version-2 generator. Version-1 saved recipes are migrated
on first read to version-2 snapshots **without changing their face or five-character
width**. New generated identities normally have six codepoints including an
accessory; existing snapshots retain their saved geometry.

### Favorites and recent faces

**Favorite current face** keeps reusable text and any custom activity expressions
in the face library. Click a favorite to use it in another thread; remove it with
the adjacent × control. Expand **Recent faces** to reuse previous choices.

The plugin stores up to 50 favorites and the 20 most recent distinct choices.
The library syncs across windows and survives reloads. Favoriting a generated
face keeps its static text; reusing it creates a saved text choice with activity
markers rather than a generated identity.

### Custom activity expressions

Expand **Custom activity expressions** to supply optional Running, Waiting,
and Error faces. Choose **Preview activity** to inspect each state before saving.

Blank states keep the base face and its activity marker. Expressions use the
same validation as the base face. They persist with the thread and are preserved
when saving or reusing a favorite. Clear all three and Save to return to markers.

## Settings

Open **Settings → Plugins → Asciimoji** to configure:

- **Show face in thread header** — enabled by default.
- **Show faces beside threads in sidebar** — disabled by default. Faces open the same picker even
  with the header disabled.
- **Show activity state** — enabled by default.
- **Activity presentation** — Expressions (default) or Markers.
- **Use theme accent color** — disabled by default. Follows the theme's primary color.
- **Animation style** — Off, Subtle (default), or Playful.
- **Sidebar face width** — Compact (6ch), Standard (default, 10ch), or Expanded (16ch).
- **Default face family** — Classic (default), Bears, Robots, Cats, or Minimal. Global fallback
  for projects without an explicit override.

Configuration precedence is Thread override → Project override → Global default.
Thread overrides are saved custom, preset, or generated choices. Project overrides are set in
the picker or with `project-default`. Missing project keys inherit the global family;
an explicit Classic override stays Classic when the global default changes. Choose
**Use global default** in the picker (or `project-default inherit`) to delete the
project override. **Use automatic face** removes the thread override.

The **Appearance preview** section below the native settings shows header and sidebar faces
for idle, running, waiting, and error states, plus sidebar truncation. Family and width
preview controls are local and never modify saved settings. It works without a selected
project or thread, respects the active theme and reduced-motion preferences, supports
keyboard navigation, and makes no backend RPC calls.

Subtle animates face changes and hover on working threads; Playful adds a gentle
bob while a thread is working. Idle, waiting, and error faces stay still. Motion pauses
in hidden windows and respects system reduced-motion preferences. Settings
update live and synchronize across windows. Long sidebar faces truncate according to
the configured width; hover or assistive labels expose their complete saved text.

```sh
bb plugin config asciimoji set showSidebar true
bb plugin config asciimoji set animation playful
bb plugin config asciimoji set useThemeColor true
bb plugin config asciimoji set showActivity true
bb plugin config asciimoji set activityStyle markers
bb plugin config asciimoji set sidebarWidth expanded
bb plugin config asciimoji set defaultFamily bear
```

Activity expresses idle, running, waiting for input, and error. With Expressions,
generated faces change eyes and text choices use custom expressions with marker fallback;
with Markers, all faces keep their static text plus a status marker (·, ?, !).
Activity off shows only static base faces. Animation Off keeps static activity feedback.
Running does not distinguish thinking
from tool execution, and idle does not imply successful completion.

Header, sidebar, and open pickers share activity reads in each window.
Notifications refresh only affected threads and coalesce into bounded batches;
reconnection restores authoritative snapshots. CLI output always reports the
saved base identity, not live activity.

## Commands

```sh
bb asciimoji get
bb asciimoji set 'ʕ•ᴥ•ʔ'
bb asciimoji set ':-)' --running ':D' --waiting ':?' --error ':('
bb asciimoji shuffle
bb asciimoji generate
bb asciimoji generate --family bear
bb asciimoji vary
bb asciimoji favorite
bb asciimoji favorite --remove
bb asciimoji library --json
bb asciimoji project-default
bb asciimoji project-default robot
bb asciimoji project-default inherit
bb asciimoji project-default --json
bb asciimoji reset
bb asciimoji get --thread thr_example --json
```

Thread commands default to the current BB thread. Outside a thread, supply
`--thread`. Add `--json` for structured output. Family IDs are `classic`,
`bear`, `robot`, `cat`, and `minimal`.

Generate without `--family` saves the current project family; Vary uses the
current generated family, falling back to the project family for text choices.
Reset (Use automatic face) removes the thread override and follows global/project defaults.
Project-default without a family reads the target thread's effective family with origin
and override details. `project-default inherit` deletes the project override.
`project-default classic` stores an explicit Classic override. JSON results retain the
effective `family` field plus `origin` (global/project) and `override` (family or null).
Library needs no thread context.

Set replaces the base face and expression map; omitted expression options clear
previous mappings. Favorite saves the current static face and custom mappings;
`--remove` removes that exact combination. JSON identities include a `source`
of `automatic`, `generated`, `preset`, or `custom`, plus `projectId`.
The `source` field identifies automatic, generated, preset, or custom choices.
The `custom` boolean is removed in version 1.0.0; consult [CHANGELOG.md](CHANGELOG.md)
for migration of external consumers and generator API changes.

Faces and the library live in plugin-owned BB storage. Deleting a thread removes
its saved choice while reusable library entries remain. No external service,
account, model call, or API key is required.

## Publish readiness

Run `npm run check:publish:metadata` in CI and `npm run check:publish` before release.
The full check verifies description parity and
requires three **real BB screenshots** in `assets/screenshots/`. See
[the release checklist](docs/PUBLISHING.md) for the exact captures and checks.
Screenshots must come from a running BB client; none are fabricated by this repository.

## Development

```sh
npm run typecheck
npm test
npm run build
bb plugin dev
```

The plugin requires bb >=0.45 <1 and Plugin SDK >=0.6.15 <1. Experimental
thread-header and app-overlay slots are feature-detected: unavailable slots
are skipped without preventing CLI or settings use. Content-script registration
is independent of the overlay slot; the interactive sidebar picker still needs
the overlay to render. Sidebar faces first use
BB's thread-row shortcut attributes; rows with a thread id and recognized
title structure are a fallback. Unknown host layouts are left untouched and
header faces remain available. Sidebar scans are coalesced, and controls are
never inserted into host links or buttons.

Backend RPC validates inputs and outputs. The frontend uses BB's shared React
runtime and vendored BB controls. Tests cover one-time v1 migration, exact
previews, multigeneration inheritance, library bounds, expressions, retries,
sidebar access, and shared targeted activity reads.
