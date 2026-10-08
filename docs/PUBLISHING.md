# Publishing checklist

Asciimoji must be reviewed in a **running BB client** before release. There is no
live host session in this repository; do not represent mockups as screenshots.

## Required authentic screenshots

Capture PNGs at 960 × 540 or higher. Use non-sensitive demo threads and ensure
the installed plugin and BB version match the intended release.

1. `assets/screenshots/header-picker.png` — show the header face and open picker
   with the five families, favorites or presets, and a visible selected face.
2. `assets/screenshots/sidebar-and-activity.png` — enable sidebar faces and
   activity feedback; show at least two demo threads and a non-idle state.
3. `assets/screenshots/settings-preview.png` — show the plugin settings and
   Appearance preview including family, animation, and sidebar width controls.

Do not alter captures to suggest unsupported UI. Remove account names, real
thread titles, project information, and tokens before capture, rather than
covering them afterward. Verify that text remains legible at marketplace size.

## Release checks

- Verify the one-line description in `package.json` (`bb.description`) appears
  exactly in both `README.md` and `PLUGIN_OVERVIEW.md`.
- Run `npm ci`, `npm run typecheck`, and `npm test`. CI also runs
  `npm run check:publish:metadata`, which checks description parity without
  needing real screenshots. This is **not** the full publish gate.
- With the matching BB host installed, run `bb plugin types`, `bb plugin build`,
  and `bb plugin dev`. Test the header and picker, sidebar with both shortcut
  rows and fallback title rows, and settings with sidebar disabled.
- Confirm on a host that meets `bb >=0.45 <1` and the stated SDK range.
  Verify linked-title sidebar fallback separately from shortcut-anchor rows.
  Experimental slots are feature-detected; unrecognized sidebar layouts should
  remain untouched with a usable header or CLI.
- Run `npm run check:publish`. It fails until all three genuine PNG captures
  are committed and the short descriptions agree.
- Compare every screenshot and the description with the actual release UI before
  adding the repository to a marketplace or publishing a new version.

**Current state:** screenshot capture is a manual release blocker until the
files above exist. No placeholder or generated images are accepted.
