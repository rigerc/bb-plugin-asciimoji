# Asciimoji for bb

Give every thread a familiar face: `ʕ•ᴥ•ʔ`, `(⌐■_■)`, or your own.

Each thread gets a stable default asciimoji in its header. Click it to choose
from 12 presets, write a custom face, pick a surprise, or restore the default.
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
- **Animation style** — Off, Subtle (default), or Playful.

Subtle animates face changes and hover; Playful adds a gentle idle bob.
Animations respect your system’s reduced-motion preference. Settings update
live without reloading. Sidebar faces decorate the existing thread rows and
sync with the header. Theme color applies to the header, picker, and sidebar
and follows theme changes automatically. Hover a sidebar face to see the full text.

You can also configure them from the shell:

```sh
bb plugin config asciimoji set showSidebar true
bb plugin config asciimoji set animation playful
bb plugin config asciimoji set useThemeColor true
```

## Commands

```sh
bb asciimoji get
bb asciimoji set 'ʕ•ᴥ•ʔ'
bb asciimoji shuffle
bb asciimoji reset
bb asciimoji get --thread thr_example --json
```

Commands default to the current bb thread. Outside a thread, supply `--thread`.
Custom faces support Unicode and are limited to 40 characters on one visible
line. Control characters are rejected. Presets can repeat across threads.

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
