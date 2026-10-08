# Asciimoji for bb

Give every thread a familiar face: `ʕ•ᴥ•ʔ`, `(⌐■_■)`, or your own.

Each thread automatically gets a stable generated asciimoji in its header. Click it to choose
from 12 presets, write a custom face, pick a surprise, choose a generated face family, or restore the project default.
Saved choices persist across sessions and sync between connected windows.

## Install

Requires bb 0.45 or later with Plugin SDK 0.6.15 or later, plus Node.js and npm.

```sh
cd bb-plugin-asciimoji
npm install --include=dev
bb plugin build
bb plugin install .
```

## Settings

Open **Settings → Plugins → Asciimoji** to configure:

- **Show face in thread header** — enabled by default.
- **Show faces in sidebar** — optional, disabled by default.
- **Use theme color** — optional, disabled by default. Colors faces with your theme’s primary color.
- **Show activity expressions** — enabled by default. Generated faces change expression with activity; presets and custom faces show a small activity marker.
- **Animation style** — Off, Subtle (default), or Playful.

Subtle animates face changes and hover; Playful adds a gentle idle bob.
Animations respect your system’s reduced-motion preference. Settings update
live without reloading. Sidebar faces decorate the existing thread rows and
sync with the header. Theme color applies to the header, picker, and sidebar
and follows theme changes automatically. Hover a sidebar face to see the full text.

You can also configure them from the shell:

```sh
bb plugin config asciimoji set showActivity true
bb plugin config asciimoji set showSidebar true
bb plugin config asciimoji set animation playful
bb plugin config asciimoji set useThemeColor true
```

## Commands

```sh
bb asciimoji get
bb asciimoji set 'ʕ•ᴥ•ʔ'
bb asciimoji shuffle
bb asciimoji generate
bb asciimoji generate --family bear
bb asciimoji project-default
bb asciimoji project-default robot
bb asciimoji reset
bb asciimoji get --thread thr_example --json
```

Commands default to the current bb thread. Outside a thread, supply `--thread`.
Custom faces support Unicode and are limited to 40 characters on one visible
line. Control characters are rejected. Presets can repeat across threads.

### Face families and project defaults

Choose **Classic**, **Bears**, **Robots**, **Cats**, or **Minimal** in the thread
picker. Each family generates stable variations from the thread ID and supports
activity expressions. Child threads in the same family share their parent's eyes.
Classic keeps the original mixed-style generator.

The picker's **Project default** selector sets the family for all automatic faces
in that project, including existing threads and newly created ones. It defaults
to Classic. Changes persist across reloads and sync to headers, sidebars, and
pickers in connected windows.

Selecting a family for a thread saves an override. Presets, custom text, and saved
generated faces keep their identity when the project default changes. **Reset to
default** removes the override so the thread follows its project's family again.
Previously saved generated choices retain their Classic identity.

From the shell, use `generate --family bear` for a thread override, or
`project-default robot` to set its project's family. Family IDs are `classic`,
`bear`, `robot`, `cat`, and `minimal`. `project-default` without a family reports
the current default; `project-default classic` restores the original generator.
These commands accept `--thread` and `--json` like the other commands. A project
is resolved from the target thread.

### Generated faces and activity

Every thread automatically uses a generated face. The thread ID selects curated
delimiters, eyes, and a mouth without model calls.
Child threads in the same family inherit their parent's hash-selected eyes. Explicit generated selections are
saved as a versioned choice. Automatic faces need no stored selection. Both share the same renderer in the header, picker,
and sidebar. Saved presets and custom faces remain explicit overrides. Choose
**Use generated face** or run `bb asciimoji generate` to replace an override;
Reset restores the automatic generated face in the current project family. Generate without `--family` saves a face in the current project family.

**Show activity expressions** is enabled by default and displays idle, running,
waiting for user input, and error states. Running faces glance sideways; waiting faces use `?`
eyes and errors use `x`. Idle faces blink when animation is enabled. Presets and
custom text stay as saved and use a separate `·`, `?`, or `!` marker. These
states reflect BB's reported thread activity; running does not distinguish
thinking from tool execution, and idle does not imply successful completion.

Expression frames retain five glyphs. A shared animation clock pauses in hidden
windows and for reduced motion; **Off** keeps state expressions static. Activity
refreshes on host events and reconnection. CLI reports return the static saved
identity, while activity is ephemeral. The activity integration also uses BB's
experimental thread-events listener to refresh after interaction resolution.

Faces live in plugin-owned bb storage. Deleting a thread removes its saved
face. Thread titles and agent prompts remain as you wrote them. No external
service or account is required.

## Development

```sh
npm run typecheck
npm test
npm run build
bb plugin dev
```

The plugin uses the experimental thread-header and app-overlay slots. Sidebar
faces use a content script and bb’s thread-row shortcut DOM attributes; rows
without those attributes cannot be decorated. Compatibility depends on these
extension points remaining available in bb. Backend RPC validates inputs and
outputs; the frontend uses bb’s shared React runtime and vendored bb controls.
