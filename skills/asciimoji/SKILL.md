---
name: asciimoji
description: Show or change the persistent asciimoji for a bb thread when the user asks to personalize its face.
---

Use `bb asciimoji get`, `set '<face>'`, `shuffle`, or `reset`.
Commands use the current thread by default; add `--thread thr_...` to select another thread.
Add `--json` for structured output. Quote custom faces in the shell.

The same controls are available by clicking the asciimoji in the thread header.
Faces are limited to 40 characters on a single visible line. Choices sync across
windows and survive plugin reloads and session restarts. Reset restores a stable
face derived from the thread id. Titles and agent prompts are unaffected.

Settings are under Settings → Plugins → Asciimoji. `showHeader` defaults to true,
`showSidebar` and `useThemeColor` to false, and `animation` to `subtle` (also `off` and `playful`).
Use `bb plugin config asciimoji set showSidebar true` to enable sidebar faces.
Use `bb plugin config asciimoji set animation playful` to change animation style.
Use `bb plugin config asciimoji set useThemeColor true` to color faces with the
user’s theme primary color in the header, picker, and sidebar. Colors follow
theme changes automatically. Animations honor system reduced-motion preferences. Settings update live.
