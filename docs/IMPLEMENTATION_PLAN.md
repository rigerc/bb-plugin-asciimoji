# Asciimoji generation implementation plan

> Superseded in part: the legacy v2 generator was removed after this plan shipped.
> Generation is now v3-only with no edition selector; saved v1/v2 data still reads
> unchanged. The phase structure below remains an accurate build history.

Build an opt-in expanded generator that keeps characters recognizable during
activity, supports controlled variation, and preserves generated favorites.
Ship those capabilities with compact sidebar rendering first; add full expressive
and ASCII profiles and project defaults afterward.

This document is a proposed implementation sequence. No runtime changes are
included with the plan.

## Starting point

- [`faces.ts`](../faces.ts) supplies five families, deterministic v2 snapshots,
  a shared renderer, and shared face validation.
- [`server.ts`](../server.ts) resolves inherited eyes, stores snapshots, provides
  previews and variation commands, and maintains the face library.
- [`app.tsx`](../app.tsx) provides the picker, favorites, custom expressions,
  header faces, and sidebar faces.
- [`migration.ts`](../migration.ts) freezes old v1 recipes as v2 identities.
- [`hooks/useFaceClock.ts`](../hooks/useFaceClock.ts) supplies one clock per window
  and already handles hidden windows and reduced motion.

A sample of 10,000 IDs reached 768 distinct Classic faces and 192 in each other
family. With inherited eyes, those counts became 192 and 48 respectively. The
current state renderer replaces identifying eyes; `blinkOffset` is stored but
unused. Generated favorites currently retain text rather than generated behavior.

## Adopted kaomoji design ideas

Adapt the template-and-palette approach from
[`keithdowd/kaomoji`](https://github.com/keithdowd/kaomoji/tree/f74ddf8bc903ab177a7d8724cf925ea873e7abda)
in the native TypeScript catalog. Adopt these three ideas within the existing
milestone, rather than importing the Python package or its entire emotion catalog:

- **Paired traits:** select compatible left/right eyes and gestures as complete
  pairs. Symmetry is the default; curated asymmetric pairs are deliberate designs.
- **Optional decorations:** expressive templates can include arms, hearts, or
  other flourishes; compact templates retain the character's core traits and
  omit or simplify decorations to fit the existing sidebar slot.
- **Personality separate from activity:** bounded catalog tags such as calm,
  cheerful, and curious guide appearance. They are saved character metadata;
  BB's idle/running/waiting/error state remains authoritative and independent.

Use ordered, curated definitions and the planned deterministic trait hashing.
Keep family, personality, and runtime state distinct: for example, a curious
Robot can be idle, running, waiting, or in error without changing its personality.
No new emotion picker or automatic emotion inference is included in this milestone.
Source ideas: [`config.py`](https://github.com/keithdowd/kaomoji/blob/f74ddf8bc903ab177a7d8724cf925ea873e7abda/kaomoji/config.py).

For any copied/adapted code or substantial palette content, record the source
commit and affected definitions and retain Keith Dowd's MIT copyright and
permission notice in distributed third-party notices. Include this provenance
check when curating the phase-1b catalog.
[`Upstream license`](https://github.com/keithdowd/kaomoji/blob/f74ddf8bc903ab177a7d8724cf925ea873e7abda/LICENSE).

Also adopt three architectural ideas from
[`xxist/kmoji-plugin`](https://github.com/xxist/kmoji-plugin/blob/03017e9389837e8a080fc5f0e2911bd4a4367d27/plugins/kmoji/skills/kmoji/scripts/generate.py):

- **Template capabilities:** describe built-in appendages and allowed decoration
  slots in template metadata. Composition uses capabilities, not species-name
  exclusion lists, to prevent additional hands on an already complete frame.
- **Decoration layers:** model gestures, facial marks, and surrounding flourishes
  separately, with explicit paired placement and compact rendering rules.
- **Selection weights:** define optional-layer probabilities and trait weights
  explicitly. Use deterministic weighted selection instead of repeated `NONE`
  entries or implicit bias from duplicate glyphs.

Implement these concepts with independently curated TypeScript definitions.
Do not vendor or port KMOJI's code or trait catalog in this plan: its
[`license`](https://github.com/xxist/kmoji-plugin/blob/03017e9389837e8a080fc5f0e2911bd4a4367d27/LICENSE)
is Apache 2.0 with Commons Clause. Copying its material would be a separate reuse
decision. These concepts require no new families, dependencies, or picker controls.

Both license files were downloaded directly over HTTPS at the pinned commits and
checked during this plan revision, before copying any definitions. Keith Dowd's
file is MIT, names Keith William Dowd, and requires retention of its copyright
and permission notice. KMOJI's file identifies Apache 2.0 plus Commons Clause
and adds a restriction on selling offerings whose value derives substantially
from the software, including specified hosting/support arrangements. This verifies
the repository license text; any palette copied later still needs its provenance
and applicable notices checked. Independently curated KMOJI-inspired definitions
remain the chosen approach.

Verification hashes (SHA-256 of the downloaded LICENSE bytes):

- Keith Dowd: `c4e5195d3da30411085b3e366839878fa3f6b00b1f7b2e02a2001c04bcfda4c6`.
- KMOJI: `3b256e537fea4520d67fcc133d3beefd8e17aa9d27f0ab1ee8d1e8a15136d279`.

## Compatibility decisions

1. Preserve existing v1 migration, v2 generation, saved base faces, and v2 rendering.
   Capture fixed expected outputs before refactoring.
2. Introduce a v3 generated identity and a v3 saved-choice envelope. Keep storage
   schema versioning separate from generator versioning in the implementation.
3. Expanded generation is initially an explicit thread choice. Existing automatic
   faces continue to use v2. Later, changing a project/global generation default
   deliberately changes following automatic faces, just as family changes do today.
4. Preserve the current family IDs, source values, custom-face validation,
   expression/marker preferences, and default command behavior. New options are
   additive; document that consumers of generated identities must handle v3.
5. Saved v3 identities contain their actual glyphs and expression variants.
   Catalog edits must not change a saved character's appearance.
6. Keep plugin state in BB storage and use the installed SDK. No host SDK
   extensions, model calls, or external services are needed.
7. An older plugin cannot interpret a v3 thread choice and displays an automatic
   v2 face instead. Reading alone leaves the stored choice intact; old Set,
   Generate, Vary, and Reset commands can replace/remove it. Document this
   downgrade behavior and verify it with the existing reader.
8. Target phases 1a, 1b, and 2–4 for the currently unreleased 1.0.0, whose
   [`CHANGELOG.md`](../CHANGELOG.md) currently promises only v2 runtime identities.
   Before release, update that promise and the library JSON contract to include
   these changes. Verify release/tag history before treating 1.0.0 as unpublished;
   if it has shipped, reassess the next major version for incompatible contracts.

## 1a. Establish schemas, deterministic primitives, and infrastructure

**Files:** `faces.ts`, `server.ts`, `migration.ts`, `server.test.ts`; frontend
changes only where needed to handle the identity union safely. No catalog or
expanded-generation picker controls ship in this step.

- Define a discriminated `GeneratedFaceV2 | GeneratedFaceV3` union and validate
  both forms at storage and RPC boundaries. Keep the v1 migration and v2 behavior
  frozen, with exact expected-output fixtures before refactoring.
- Reserve v3 fields for family, template ID, personality, resolved outline,
  `eyePair: [left, right]`, paired gesture/facial-mark/surrounding layers,
  capabilities, mouth, accessory, state expressions, and animation phase.
  Reserve optional compact, expressive, and ASCII renderings from the start;
  ASCII may contain compact and expressive variants. Save actual glyphs, not
  only catalog references. Keep v2's `eyes: string` field unchanged.
- Bound field lengths, profile counts, and running-frame counts in the proposed
  schema, then derive byte limits from that representation. Use up to four
  running frames per rendering for the provisional sizing fixture. Idle,
  waiting, and error are static. Do not treat the fixture as the final schema.
- Add deterministic hashing and ordered weighted-selection primitives. Use
  independent names such as `threadId:seed:v3:mouth`, `:gesture:include`, and
  `:gesture:choice`. Freeze v2's existing hash and selection behavior.
- Replace descendant listing's untyped cast with the installed SDK's
  `threads.list({ parentThreadId, limit, offset, ... })` contract. Decide hidden
  and archived inclusion explicitly, page children, track actual traversal
  depth separately from visited-node/work limits, and retain pinned boundaries.
  Log failures and invalidate project-wide when traversal fails or reaches a
  bound; do not publish a partial result as if traversal completed.
- Remove the proposed 2 KiB snapshot ceiling. Keep a provisional 1 MiB target
  for a 200-identity `getMany` response and 192 KiB for each canonical library
  index key, below the SDK's 256KB KV limit. Keep variation history and token
  metadata out of returned identities. Set final snapshot/profile bounds only
  after measuring schema-valid worst-case fixtures; if the full response grows
  beyond its target, revise batching/representation before enabling profiles.
- Phase 4 stores generated library snapshots at separate immutable keys and
  keeps references in the canonical index. A single inline library envelope
  cannot meet the storage target with the measured representation.

Schema-validated sizing is reproducible with
`npx tsx docs/v3-payload-sizing.mjs` ([fixture](v3-payload-sizing.mjs)). It includes
five complete rendering sets: base, Unicode compact/expressive, and ASCII
compact/expressive, each with four states and four running frames. Full faces
use 40 codepoints, compact faces six, Unicode strings four-byte scalars,
template IDs 64 characters, actual personality enums, and RPC IDs 128
characters. ASCII uses escaped backslashes, not one-byte placeholder letters.
Every snapshot and the full response pass the actual shipped schemas. These are
serialization stress inputs; compact font fit remains a separate live check.

| Schema-valid maximum fixture | UTF-8 JSON bytes |
| --- | ---: |
| Generated snapshot | 4,545 |
| Full RPC identity, including selected glyph profile | 5,060 |
| 200 full identities | 1,012,201 |
| 64 full identities | 323,905 |
| 70 inline generated library entries | 339,845 |
| 70 generated references in a library index | 20,855 |
| One separate snapshot KV value, including profile | 4,595 |

**Acceptance:** exact v1/v2 fixtures still match; v3 schemas reject invalid or
unbounded values; hashing and weighted-selection helpers have exact fixtures
and boundary checks on a small ordered test palette. Verify paginated, wide/deep
descendant trees, pinned boundaries, and failure/limit fallback against the typed
SDK. Rebuild the sizing fixture against the actual schema before fixing byte
ceilings, and record snapshot, 200-identity response, and library-index sizes.
This step creates no new v3 identities for users.

## 1b. Implement the catalog, layered composition, and compact rendering

**Files:** `faces.ts`, `server.ts`, `app.tsx`, `app.css`, settings preview,
`server.test.ts`, `app.test.tsx`. Add `family-definitions.ts` if it keeps the pure
catalog/generator code manageable. Depends on 1a; preserve existing v2 palettes.

- Define compatible templates and legal combinations for the existing five
  families. Give Cats whiskers, Robots distinctive outlines/antennae, and Bears
  ears and gestures; keep Minimal restrained. Complete provenance review before
  including any upstream-derived definitions.
- Curate eyes and gestures as atomic left/right pairs. Symmetry is the default;
  asymmetric variants are explicit designs. Save resolved pairs and personality
  tags, which select compatible palettes and expressions independently of status.
- Declare capabilities for built-in appendages and allowed decoration slots.
  Filter incompatible layers before selection; an already complete frame gets
  no duplicate gesture hands. Snapshot the relevant capabilities. Catalog edits
  must not invalidate or redraw an existing saved character on read.
- Compose layers in a declared order: surroundings, gesture, outline, facial
  marks, eyes/mouth, then matching right-side parts. Cap part lengths and layer
  counts using 1a's validated schema and measured budgets.
- Give optional layers explicit inclusion probabilities and candidates finite
  positive weights. Represent absence once; merge duplicate glyph patterns/tags
  and use weights for deliberate bias. Validate probabilities in [0, 1], unique
  IDs, finite weight totals, and nonempty compatible required-trait pools.
  Zero inclusion probability disables a layer. If required filters leave a pool
  empty, return a recoverable error rather than selecting incompatible traits.
- Retain same-family parent-eye inheritance. Convert a v2 parent's eyes to
  `[eyes, eyes]` for a v3 candidate. Inherit an entire supported pair, never one
  half; otherwise select the child's deterministic pair. Personality/gestures
  remain the child's traits. Custom/preset parents supply no generated traits.
- Generate and save compact geometry with every v3 template that needs it.
  Sidebar uses compact; header/picker use expressive if available, otherwise
  base. Missing compact may use base only for approved templates that fit the
  compact slot; reject other incomplete snapshots. Do not synthesize missing
  renderings from a mutable catalog after saving. Missing ASCII is unsupported;
  phase 5 offers explicit new ASCII generation rather than a Unicode fallback.
- Snapshot compact omission/simplification of optional decorations. Identity,
  state/frame variants, and marker presentation must fit the existing 6ch slot;
  reserve marker space while preserving core traits. Review actual BB font widths,
  since six codepoints do not guarantee 6ch. Keep the 40-codepoint visible-line
  validation for every full face; do not reuse v2's UTF-16 `.length(1)` part checks.
- Add an explicit generation edition option in the picker and CLI. Omitted
  options retain current `generate --family ...` behavior. Stage expanded state
  variants in the snapshot for phase 2 to activate in the display resolver.

**Acceptance:** exact fixed-seed snapshots cover every family, pair inheritance,
asymmetry, personality, layer placement, and compact decoration rules. Check
catalog weights/probabilities, required pools, duplicate IDs, and capability-based
suppression directly. Golden outputs are updated only with deliberate reviewed
catalog changes; no frequency thresholds or tolerance-based distribution tests
are release gates. Measure catalog variety separately, targeting at least 192
inherited-eye faces per enhanced family with meaningful differences. All selected
palettes pass shared validation and compact displays fit live BB. Saved glyphs
remain unchanged after catalog edits, provenance is recorded, and 1a's schema-based
byte checks still pass.

## 2. Add recognizable activity expressions and staggered motion

**Files:** `faces.ts`, `hooks/useFaceClock.ts`, `app.tsx`, `app.css`,
`components/AsciimojiSettingsPreview.tsx`, existing test files.

- For v3, keep outlines, inherited eyes, and primary accessories recognizable.
  Express activity through curated mouth/gesture changes. Keep v2 expressions
  unchanged for compatibility.
- Keep personality fixed across idle/running/waiting/error. Resolve activity using
  the saved personality-compatible expression set; do not map Running to joy,
  Error to sadness, or otherwise infer emotion from operational status. Activity
  labels and any fallback markers communicate status independently of personality.
  Gesture animation selects complete compatible pairs, not independent halves.
- State/frame variants obey saved template capabilities and layer placement.
  A template with built-in appendages uses mouth/other allowed changes for activity
  instead of adding gesture hands that would duplicate its anatomy.
- Give each family its own running, waiting, and error vocabulary. If an
  expression is visually ambiguous, use the existing explicit activity marker
  as a fallback rather than relying on appearance alone.
- Separate static state expressions from optional movement. Animation Off
  still conveys activity; idle remains neutral and does not imply success.
- Use the saved phase offset for brief, staggered running animations on the
  existing shared clock. Reduced motion and hidden windows remain static.
- Use the shared display resolver for header, sidebar, picker, and settings.
  Render each surface's saved geometry, including compact state variants from
  phase 1b. Keep status labels stable during animation; do not announce every frame.

**Acceptance:** activity never modifies saved identity; state expressions retain
recognizable traits; markers and animation settings behave consistently;
different phase offsets produce staggered frames. Check actual font rendering,
clipping, and layout movement in BB, since codepoint counts do not prove width.
The same saved personality supports every activity state without changing its
metadata or asserting success. State transitions preserve the identity's eye pair.

## 3. Build trait locks and a preview gallery

**Files:** `server.ts`, `app.tsx`, `server.test.ts`, `app.test.tsx`.
Extract `components/FaceVariationPicker.tsx` if needed to keep the picker readable.

- Add a bounded candidate RPC returning up to six distinct v3 previews, with
  outline, eyes, mouth, and accessory locks and an explicit resemblance control.
- The Eyes lock covers the whole eye pair. The accessory lock covers the saved
  accessory and all three decoration layers, including their absence, as one unit.
  Vary preserves personality by default;
  this milestone does not add separate left/right or personality controls.
- Filter outline candidates against locked layers and template capabilities.
  If a requested lock conflicts with a new outline, omit that candidate and
  explain the constraint; never silently discard a locked gesture or decoration.
- Locks preserve the current snapshot's traits. Inherited eyes stay locked by
  default. Unlocking them creates an explicit saved override; its generated
  children can inherit the newly saved eyes.
- Keep previews as local drafts. Choosing a candidate and pressing Save applies
  it; Cancel, closing, and requesting another batch do not write identities,
  favorites, or recent choices.
- Store candidate snapshots behind opaque tokens in a server-memory cache, never
  KV: five-minute TTL, at most 12 candidates per thread and 1,200 total, with
  expired/oldest entries evicted at generation/access. No cleanup timer is needed.
  Bind tokens to thread, locks, and relevant context; consume on successful save
  and clear all entries on plugin disposal. Applying
  a token saves the exact preview, rather than regenerating against a changed
  parent. Expire previews if their relevant identity/parent/default context has
  changed, and offer a refresh. Revalidate that context at apply time even when
  realtime invalidation was missed. Expired tokens after reload refresh cleanly.
- Deployment assumption: one active plugin server process writes this plugin's
  KV namespace, and preview/apply requests reach that same factory instance.
  Memory tokens and mutation queues are process-local, not distributed locks.
  A restart/reload loses previews; routing Apply to a different worker returns
  `PREVIEW_EXPIRED` and offers Refresh previews without changing the saved face.
  Verify this assumption against BB's lifecycle and live deployment before
  enabling the feature. Non-sticky multi-worker deployments require shared
  token storage and coordinated mutation/transaction handling first; they are
  outside the initial memory-token implementation's supported deployment model.
- Serialize mutations per thread. Reuse ancestor/default reads within candidate
  batches and run generation attempts locally after resolving that context.
- Keep the last 20 saved variation signatures inside the v3 saved-choice envelope,
  rather than separate per-thread keys. Exclude the current face, recent
  variations, and duplicates within the batch. This history is separate from
  the user's global Recent faces library.
- On `thread.deleted`, serialize cleanup with pending saves, remove the existing
  `thread:<id>` key (including embedded history), evict its tokens/context caches,
  and reject queued saves for a deleted thread. Reset also clears its history and
  tokens; plugin disposal clears memory caches. Reusable favorites/recents remain.
- Bound attempts. If locks leave too few candidates, return the available set
  and explain which locks can be relaxed; do not silently unlock traits.
- Keep the existing one-click Vary path. Add optional CLI lock arguments for
  expanded identities. Vary on v3 stays v3 and preserves edition/profile selections
  and locks; Vary on v2 stays v2. Custom/preset choices retain their current v2
  project-family fallback unless the user explicitly selects expanded generation.

**Acceptance:** locked traits remain identical; every preview saves exactly;
candidate generation performs no persistent writes; exhaustion and stale-token
cases are recoverable; overlapping requests do not overwrite newer saves.
Verify keyboard selection, focus restoration, loading, Retry, and cancellation.
Verify TTL/cap eviction, deletion during a pending save, Reset/reload cleanup,
missed invalidations, v3-preserving Vary, and memory/payload bounds. No per-thread
history or token state is orphaned after deletion.
Exercise worker restart and preview-on-worker-A/apply-on-worker-B using separate
caches: Apply fails recoverably and saves nothing. Record confirmation of the
single-active-writer assumption; do not claim cross-worker serialization.

## 4. Preserve generated characters in favorites

**Files:** `server.ts`, `app.tsx`, `server.test.ts`, `app.test.tsx`.

- Introduce a versioned library envelope with text and generated entry variants.
  Keep a `face` display field and optional custom expressions for text entries.
  Generated entries reference complete immutable v2/v3 snapshots stored at
  `library:snapshot:<content-hash>` keys. Share identical snapshots across
  favorites/recents. Validate fetched snapshots before applying and preserve
  the index on missing/invalid data, showing a recoverable error.
  Library list RPC/CLI returns bounded reference entries and display text;
  an apply/detail RPC resolves the selected character server-side. Document the
  reference entry format in the new 1.0.0 library JSON contract.
- Store that envelope at a new canonical `library:v2` key, not `library`. Keep
  `library` in the old schema as a text-only compatibility projection, so old
  builds can read/mutate it without touching canonical character data. Generated
  entries project to their base text; projection deduplication uses legacy rules.
  Within the serialized library mutation queue, persist immutable snapshot keys
  first, then the canonical reference index, then the legacy projection. A failed
  index write may leave an unreferenced snapshot, which bounded cleanup removes.
  A failed projection write
  never rolls back or discards canonical data. Record the last projected content
  fingerprint in the canonical envelope to detect later legacy mutations.
- Read the existing unversioned library as text entries, preserving ordering,
  expressions, the 50-favorite limit, and the 20-recent limit. Save the new
  canonical envelope on a library mutation, not merely when opening the picker.
  Once canonical data exists, it is authoritative. Unknown or malformed canonical
  data produces a recoverable error and blocks mutation; never reinterpret it as
  an empty library. If downgrade use changed the legacy projection, report that
  discrepancy and provide explicit import of legacy text changes. Do not silently
  replace canonical entries or infer character deletions from text deletions.
- Surface a persistent banner in the new picker/library: “An older Asciimoji
  window changed the face library. Your saved characters are preserved.” Offer
  Review text changes and Keep current library. Review lists added/removed text
  entries and lets the user explicitly select text changes to import; projected
  character deletions never delete characters. Resolve capacity conflicts in
  that review rather than silently dropping favorites.
- Refresh mismatch detection on every library event (including legacy events
  with empty payloads), picker open, and reconnect. While the library is open
  and visible, use a bounded five-second fallback poll for missed notifications;
  dispose it on close/unmount. Other new windows see the same persisted pending
  mismatch. Old windows cannot display the new banner; explain in the review
  that reloading them loads the current plugin UI.
- While a mismatch is unresolved, preserve the latest observed legacy text
  snapshot at `library:legacy-pending` and pause projection writes. Canonical
  character changes may continue without erasing the pending legacy state.
  Recheck the legacy fingerprint when opening/committing Review or Keep current
  library; if it changed, refresh the review instead of applying a stale diff.
  Clear the pending state only after the selected resolution and projection
  write succeed. New events can legitimately show the banner again if an old
  window continues to edit the projection.
- Both Favorites and Recent faces use the text/generated entry union. Applying
  or saving a generated identity remembers a character; Set/preset/custom remembers
  text with its expressions. Recent faces stays at 20 distinct entries using the
  same kind-aware keys as Favorites. Preview-only choices never enter Recent.
- Offer explicit “Save text” and “Save character” actions. Keep current CLI
  favorite behavior; add an explicit character option.
- Reuse a character exactly, with its generated activity behavior, as a pinned
  choice, including its personality, complete eye pair, and paired decorations.
  Do not re-resolve parent eyes when applying it to another thread.
- Use entry kinds and canonical snapshot content in deduplication/removal keys;
  text and character favorites with the same idle face remain distinct.
- Let users open a character in the variation gallery to create related faces.
  Template favorites containing reusable lock rules can follow later.
- Sweep unreferenced `library:snapshot:` keys in bounded batches under the
  library queue after mutations/reload. Read and validate the canonical index
  before cleanup; unknown/corrupt index data blocks deletion. Thread choices
  store their own snapshots, so library cleanup cannot change a pinned thread.

**Acceptance:** old libraries retain all entries; character favorites round-trip
across reloads/windows and support activity; text/custom expression favorites
retain existing behavior; removing one kind does not remove the other.
Data safety: create canonical data, run the existing old reader and a legacy
mutation, then restore the new reader; character entries must still be intact.
Test migration/projection write failures, malformed/future canonical envelopes,
legacy-change detection/import, mixed recent entries, and the full KV byte budget.
Test old/new windows concurrently: an old text deletion produces the new-window
banner/review while preserving canonical characters. Verify live/reconnect/poll
updates, stale-review refresh, paused projection writes, explicit text import,
capacity handling, Keep current library, missing snapshot errors, and orphan
snapshot cleanup. Each index/snapshot/pending KV value stays within its bound;
the library never returns to one oversized inline snapshot envelope.

**First release milestone:** phases 1a, 1b, and 2–4 deliver expanded per-thread characters,
recognizable activity, controlled previews, and reusable generated favorites.
It also includes compact rendering, deletion cleanup, and downgrade-safe library
storage; these are release requirements rather than phase-5 follow-ups.

## 5. Add display profiles and inherited generation defaults

**Files:** `faces.ts`, family catalog, `server.ts`, `app.tsx`, `app.css`,
settings preview, existing tests.

- Extend the compact rendering delivered in phase 1b with full expressive
  geometry profiles plus a Unicode/ASCII glyph
  profile. ASCII-only means all generated base/state/frame glyphs are printable
  ASCII, including any activity markers supplied by that profile.
- Store matched compact/expressive renderings of one character in its snapshot:
  sidebar uses compact; header/picker may show expressive. Preserve recognizable
  eyes and mouth across both. User-entered custom faces remain their exact text.
  Populate the reserved v3 fields; existing incomplete profile sets keep the
  phase-1b fallback rules and are not rebuilt from the current catalog on read.
- Add global generation defaults and separate project override keys for edition
  and profiles. Preserve the existing `project:<id>:family` key and family API.
- Apply field-level precedence: saved thread snapshot, explicit project option,
  global option. Missing keys retain the original v2 generation behavior.
- Extend default readouts and realtime invalidation for the new fields. Reset
  removes the thread snapshot and follows the current defaults. Saved choices
  stay fixed when defaults change.
- Make default changes describe their scope: existing following automatic faces
  and future automatic threads change; pinned choices retain their identity.

**Acceptance:** ASCII output is printable ASCII in every state; profiles remain
recognizably the same character; defaults inherit/reset correctly; old project
family overrides survive. Verify compact/standard/expanded sidebar widths,
theme changes, connected windows, and header-disabled sidebar access in live BB.
Rerun the snapshot/library/200-identity payload checks with all profiles populated.

## Delivery and verification

Implement in order: 1a → 1b → 2 → 3 → 4 → 5. Keep each phase reviewable and update command,
schema, and operating documentation alongside its behavior. Defer additional
animal families and template-favorite rules until the five enhanced families
have been visually reviewed.

- Extend the existing `server.test.ts` and `app.test.tsx` harnesses. Use fixed
  expected snapshots for compatibility and deliberate fixed-seed catalog fixtures,
  and boundary/workflow tests for tokens, locks, library migration, and defaults.
- Validate catalog weight/probability rules directly and verify exact cumulative
  selection boundaries on small test palettes. Frequency sampling is optional
  exploration, not a tolerance-based acceptance gate. Profile additions rerun
  schema-valid byte measurements and check individual KV values and RPC batches.
- Run `npm run typecheck`, `npm test`, and `npm run build` after each completed
  phase. Check affected workflows in a running BB client for the first milestone
  and the profile/default phase; mocked DOM tests cannot verify font geometry.
- Update `README.md`, `skills/asciimoji/SKILL.md`, `PLUGIN_OVERVIEW.md`, and
  `CHANGELOG.md` as implemented features become available. Document v3 identities
  and the versioned library JSON for external consumers in the unreleased 1.0.0
  notes, subject to the release-history check above. Include old-reader thread
  behavior, canonical/legacy library keys, and downgrade mutation/import behavior.
- Before publication, follow [`PUBLISHING.md`](PUBLISHING.md), capture authentic
  screenshots of the implemented UI, and run both metadata and full publish
  checks. Publishing is a separate action from implementing this plan.

Completion means each shipped phase has its acceptance checks passing and live
verification recorded, while the compatibility fixtures still match.
