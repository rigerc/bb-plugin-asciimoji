# Changelog

## 1.0.0 — unreleased

Breaking changes from 0.3.x:

- RPC/CLI identities no longer include the redundant `custom: boolean`.
  Use `source !== 'automatic'` to detect an explicit thread choice. Consumers
  expecting `.custom` must update before installing this major version.
- `defaultFace(threadId, parentThreadId)` is replaced with
  `defaultFace(threadId, family?)`. The old parent-id argument is **not**
  interpreted as a family.
- `generateFaceV2(threadId, family?, options?)` is renamed to
  `generateFace(threadId, family?, options?)`; the old v1
  `generateFace(threadId, parentThreadId?, family?)` signature is removed.
  Saved version-2 identities retain `version: 2`; all new generation uses
  `version: 3`. RPC `generated` is now a versioned union.
- The legacy v2 generator is removed: `generate`, `previews`, and automatic faces
  always produce version-3 characters. The `edition` RPC/CLI option, the
  `defaultEdition` setting, and per-project `edition` overrides are gone; stale
  per-project `edition` keys are deleted lazily. Previously saved version-1
  recipes still migrate, and saved version-2 snapshots keep rendering unchanged.
  Vary on a saved v2 identity now produces a v3 character instead of staying v2.
- Library JSON includes `kind: text` and `kind: generated` references. Character
  references resolve immutable snapshot blobs rather than returning inline glyph
  snapshots. Existing CLI favorite behavior saves text; `--character` opts in.

Saved data and visual geometry:

- Previously saved **version-1 generated recipes** are converted *on first
  read* to version-2 identity snapshots using a migration-only frozen recipe.
  Their visible text, parent-id-derived eyes, and five-codepoint width are
  preserved. There is no bulk migration step, opt-out, or user-visible change
  from the migration itself.
- Previously saved version-2 snapshots keep their original glyphs. New
  generated identities use an accessory and normally render six codepoints.
  Rendering uses a single implementation and honors absent accessories in
  migrated snapshots, including activity expressions.
- Thread overrides, preset/custom choices, and library entries remain stored.
- Expanded characters add paired eyes, capability-filtered layers, fixed
  personality, saved compact/expressive geometry, and explicit ASCII generation.
  Activity preserves their eyes and uses staggered saved frames.
- A bounded preview gallery supports trait locks and exact snapshot saves.
  Five-minute memory tokens expire cleanly after reload/context changes.
- Generated favorites and recents retain complete snapshots. A separate canonical
  library index, immutable blobs, and compatible legacy projection prevent older
  builds from wiping character data. Older text edits prompt explicit review.
- Per-thread queues serialize saves/deletion; Reset/deletion clear preview tokens
  and embedded variation history. Queues/tokens assume one active server factory.
- Typed paginated descendant invalidation includes hidden/archived children and
  falls back to project refresh on traversal errors or bounds.

Host integration and publishing:

- Manifest engines require `bb >=0.45 <1` and Plugin SDK
  `>=0.6.15 <1`. Experimental slots are feature-detected; missing slots
  do not block CLI or plugin settings.
- Sidebar decoration prefers host shortcut attributes and falls back to an
  id-bearing, recognized title row. Title links receive *adjacent* plugin
  controls, not nested buttons; unknown layouts are skipped. The interactive
  sidebar picker still requires the experimental overlay slot.
- CI validates metadata parity, typechecks, and runs tests.
  `npm run check:publish` additionally requires three authentic BB captures;
  a live host build and screenshots are manual blockers before release.

See [publishing requirements](docs/PUBLISHING.md).
