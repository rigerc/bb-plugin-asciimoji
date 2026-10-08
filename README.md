# Asciimoji for bb

Give every thread a familiar face: `ʕ•ᴥ•ʔ`, `(⌐■_■)`, or your own.

Each thread automatically gets a stable generated face. Click it in the header,
or enable sidebar faces and click one there, to choose a family, preset, favorite,
recent choice, or custom face. Saved choices sync between connected windows and
persist across sessions. Titles and agent prompts are unaffected.

## Install

Requires bb 0.45 or later with Plugin SDK 0.6.15 or later, plus Node.js and npm.

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

Existing version-1 saved generated choices keep their original generator and
appearance. New saved generated choices store a version-2 identity and seed.
Automatic faces use version 2; no migration overwrites existing saved choices.

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
- **Show faces in sidebar** — disabled by default. Faces open the same picker even
  with the header disabled.
- **Use theme color** — disabled by default. Follows the theme's primary color.
- **Show activity expressions** — enabled by default.
- **Animation style** — Off, Subtle (default), or Playful.

Subtle animates face changes and hover; Playful adds a gentle bob. Motion pauses
in hidden windows and respects system reduced-motion preferences. Settings
update live. Long sidebar faces truncate; hover to see their complete saved text.

```sh
bb plugin config asciimoji set showSidebar true
bb plugin config asciimoji set animation playful
bb plugin config asciimoji set useThemeColor true
bb plugin config asciimoji set showActivity true
```

Activity expresses idle, running, waiting for input, and error. Generated faces
change eyes; text choices use markers unless custom state expressions are saved.
Off keeps activity expressions static. Running does not distinguish thinking
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
bb asciimoji reset
bb asciimoji get --thread thr_example --json
```

Thread commands default to the current BB thread. Outside a thread, supply
`--thread`. Add `--json` for structured output. Family IDs are `classic`,
`bear`, `robot`, `cat`, and `minimal`.

Generate without `--family` saves the current project family; Vary uses the
current generated family, falling back to the project family for text choices.
Reset follows the project default. Project-default without a family reads the
target thread's project family. Library needs no thread context.

Set replaces the base face and expression map; omitted expression options clear
previous mappings. Favorite saves the current static face and custom mappings;
`--remove` removes that exact combination. JSON identities include a `source`
of `automatic`, `generated`, `preset`, or `custom`, plus `projectId`.
The compatibility `custom` field continues to mean any explicit thread override.

Faces and the library live in plugin-owned BB storage. Deleting a thread removes
its saved choice while reusable library entries remain. No external service,
account, model call, or API key is required.

## Development

```sh
npm run typecheck
npm test
npm run build
bb plugin dev
```

The plugin uses the experimental thread-header and app-overlay slots. Sidebar
faces use a content script and BB's thread-row shortcut attributes and title
layout. Rows without those extension points cannot be decorated. Sidebar
mutations are filtered and scans are coalesced; controls sit outside host links.
Compatibility depends on these host extension points remaining available.

Backend RPC validates inputs and outputs. The frontend uses BB's shared React
runtime and vendored BB controls. Tests cover legacy compatibility, exact
previews, multigeneration inheritance, library bounds, expressions, retries,
sidebar access, and shared targeted activity reads.
