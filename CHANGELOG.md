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
  Runtime-generated identities always have `version: 2`.

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
