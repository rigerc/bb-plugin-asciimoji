## A familiar face for every thread

Give each thread a persistent asciimoji with presets, custom faces, optional sidebar faces, and activity feedback.

Recognize your workspace’s conversations with small text faces like `ʕ•ᴥ•ʔ`
and `(⌐■_■)`. Each thread starts with a stable generated face in its header,
so returning to a conversation feels familiar across sessions.

## Make it yours

Click the face to open a picker with 12 named presets. Choose a favorite,
write your own custom asciimoji, or use Surprise me for a different preset.
Every thread automatically gets a stable generated face. Automatic children in the same generated family share their parent's actual eyes across generations. Use automatic face removes a saved thread override.

Choose a generated face family: Classic, Bears, Robots, Cats, or Minimal.
Precedence is Thread override → Project override → Global default. Set **Project default**
in the picker to give existing and new automatic faces
in that project a shared style, or choose **Use global default** to inherit the global
**Default face family** from plugin settings. Thread family selections, presets, and custom
faces are saved overrides; Use automatic face follows the current global and project defaults. New automatic faces have varied mouths and accessories. Old version-1 generated recipes migrate on first read to version-2 snapshots without changing visible text or their five-character width. New generated faces normally have six codepoints with an accessory; saved identities remain stable across parent or project changes.

Choices are saved in bb and updates sync between connected windows. Each
visible thread has its own control, including in split views. Custom faces can contain up to 40 Unicode code points on a single visible line. The editor previews drafts, counts characters, and rejects invisible faces. Retry controls recover failed loads. Sidebar faces also open the picker when the header is hidden.

## Display and animation

In Settings → Plugins → Asciimoji, toggle the header face and optionally show
faces beside threads in the sidebar. Sidebar faces are off by default and
follow your saved choices without changing titles. Sidebar width is Compact (6ch),
Standard (10ch), or Expanded (16ch); long faces truncate with full text in tooltips
and assistive labels.

Enable Use theme accent color to color faces with your theme’s primary color in the
header, picker, and sidebar. This optional setting is off by default and follows
theme changes automatically.

Choose Off, Subtle, or Playful animation. Subtle adds a small entrance and hover
wave on working threads; Playful adds a gentle bob while a thread is working. Idle,
waiting, and error faces stay still. System reduced-motion preferences disable
these animations. Changes to settings take effect immediately.

Enable Show activity state to see running, waiting, and error feedback.
With Expressions, generated faces change their eyes and presets/custom faces use optional
saved Running, Waiting, and Error expressions with marker fallback; with Markers, all faces
keep static text plus a status marker (·, ?, !). The picker previews these states before saving.
An Appearance preview section shows all states and sidebar truncation without changing settings.
Generated running faces animate. Each identity keeps the same glyph count across expressions. A shared clock and CSS motion pause in hidden windows and honor reduced motion. Header and sidebar share activity reads, refreshing only threads that change.
Activity is on by default and follows BB's reported state.

## Shell controls

Use `bb asciimoji get`, `bb asciimoji set '<face>'`, `bb asciimoji shuffle`,
`bb asciimoji generate --family bear`, `bb asciimoji vary`, `bb asciimoji favorite`, `bb asciimoji library --json`, `bb asciimoji project-default robot`, `bb asciimoji project-default inherit`, and `bb asciimoji reset`. Optional `set --running`, `--waiting`, and `--error` flags save custom activity expressions. Use `project-default` without a family to read the effective family with origin and override details. Commands target the current thread, with an optional
`--thread` for another conversation and `--json` for structured output.

## Requirements

Requires bb >=0.45 <1 and Plugin SDK >=0.6.15 <1. Experimental slots are
feature-detected; sidebar content scripts decorate recognized thread rows
and skip unknown layouts. Sidebar pickers need the overlay slot; where the
host lacks it, the header (if available) and CLI remain usable. No external service, account, or API key is
needed. Faces do not change conversation titles or agent prompts.

## Reuse and vary your favorites

Try another variation saves a different generated face in the current family. Keep a family saves an override; Use automatic face lets the thread track future global and project defaults. The picker labels automatic choices as Following global/project default and overrides as Saved for this thread, and family previews match what will be saved.

Favorite current face saves reusable text and custom expressions across threads. The face library holds 50 favorites and the 20 most recent distinct choices, syncs across windows, and persists across reloads. Generated favorites reuse their static text with activity markers.
