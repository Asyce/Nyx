# Timeline, Characters, Database, and Library Correction Plan

Status: approved for implementation by the user on 2026-07-14.

Branch/worktree: `codex/genshin-timeline-redesign` in
`C:\Pengo\Nyx-timeline-redesign`.

This plan supersedes the completed 2026-07-13 follow-up plan for the items below.
It preserves that work and does not deploy, push, or modify the legacy prototype.

## What the code and data currently show

- The Genshin timeline already has partial patch/phase/week structure, but the
  other four games and Nyx use an older layout.
- Timeline weeks currently begin at UTC Monday, not the selected server's
  Monday 04:00 weekly reset.
- Region controls are duplicated and default to NA. Reset Timers and Personal
  already share safe local storage, so timer/timeline linking does not need a
  second data store.
- Banner history is deep for all five games. Event feeds are much shallower
  because official feeds are rolling feeds, not complete archives.
- Characters, Database, and Library have concrete UI and data defects rather
  than needing a redesign from scratch. Existing saved favourites and Library
  annotations must remain compatible.
- Mavuika's shipped icon is a valid local 256x256 file. The fix is runtime
  fallback/cache/custom-override hardening, not an unverified replacement.
- Pyrois is released. Sigrid is officially announced but not yet proven live;
  she remains Beta until release is confirmed.

## Product decisions

1. Six-week patches and three-week phases are expectations, not forced math.
   Bands use actual sourced banner boundaries and may be shorter, longer, or
   contain a different number of phases.
2. Weeks follow a sourced per-game, per-region weekly reset definition. They are
   Monday 04:00 only where that game's source proves it. A custom display
   timezone changes how dates are shown; it does not secretly change the game
   server schedule. An unknown schedule stays unknown instead of inheriting GI.
3. Exact official dates always beat predictions. A predictable future cycle may
   be shown only as visibly `Expected`; official data replaces it automatically.
   No unsupported past dates are extrapolated.
4. Official feeds are canonical for current/future data. Historical gaps may be
   backfilled from maintained public references only with per-record provenance
   and cross-checking; unavailable history is reported as a gap, never invented.
5. Existing local data stays local: time preferences, favourites, timers, and
   Library annotations do not move into account sync.
6. Small local portraits are allowed only for released or officially announced
   characters, with provenance. No Nanoka hotlinks or raw asset collections.

## Visual direction

The subject is a live-service schedule used to plan weekly play. Its single job
is to make patch, phase, and weekly boundaries obvious at a glance.

- Palette: Abyss `#05040B`, Ledger `#0C0922`, Orbit Violet `#8B7BFF`,
  Hover Violet `#A978FF`, Star Mist `#B7AAFF`, Ink `#F3F0FF`, Muted
  `#9C93C4`.
- Type: restrained `GI` for section names, `HSR` for controls/body copy, and
  tabular system/monospace numerals for dates and countdowns.
- Shape: clean square or lightly rounded controls. Orbit/hex silhouettes remain
  for brand/navigation only, not every utility button.
- Signature: one stacked temporal ruler—Patch, Phase, Week—shared by every
  game's timeline and both Nyx combined timelines.

```text
[ game icons ................................ EU | NA | Asia | Custom ]
[ Patch 5.8                         ][ Patch 6.0                 ]
[ Phase 1            ][ Phase 2    ][ Phase 1        ][ Phase 2 ]
[ W1 ][ W2 ][ W3 ][ W4 ][ W5 ][ W6 ][ W1 ][ W2 ][ W3 ][ W4 ... ]
[ banner / event / activity lanes; compact cards, unchanged icon + text size ]
[ Personal lane                                                       ]
[ quiet exact date ruler at the bottom                                ]
[ Display ] [ Add to Personal ]
```

This stays recognisably Nyx: the eye/orbit game rail and ledger surfaces remain.
The deliberate visual risk is putting the strongest structure at the top and the
exact date ruler at the bottom—the schedule reads like a release ruler instead
of a conventional calendar. Decoration elsewhere is reduced to keep it clear.

## Dependency-ordered batches

### `nyx-0039` — shared time preference and Personal timer contract

Paths:

- `Site/src/features/timeline/time-preferences.js` (new)
- `Site/src/features/timeline/custom-timer-storage.js`
- `Site/src/app/nyx-app.jsx`
- `Site/src/styles/game-page-shared.css`
- `Site/tools/build-site.mjs`
- `Site/tools/tests/time-preferences.test.mjs` (new)
- `Site/tools/tests/custom-timer-storage.test.mjs`

Work:

- Store separate `serverRegion`, `displayMode`, and IANA `timeZone` values. Add
  one shared `EU / NA / Asia / Custom` control to the top-right of the game
  icon row on every game Overview and Nyx Overview/Banners/Events page.
- Existing saved region wins. On a true first run, deterministically map the
  detected browser timezone to EU/NA/Asia or Custom. The Custom popout exposes
  both reset server and IANA display timezone.
- Add the new module to the site build before timeline/app consumers.
- Migrate existing reset-region preferences without losing them. Unsupported
  zones and corrupted old values fall back safely, and migration is rollback-safe.
- Remove region selectors from Reset Timers and timeline toolbars.
- Keep one Personal timer store and make additions/edits appear in Reset Timers
  and the timeline immediately in both directions.

Acceptance: one universal control, an implementable server/display contract,
deterministic first-run and rollback-safe migration, DST-safe formatting,
backward-compatible preferences, and live Personal sync.

### `nyx-0040` — event provenance, history backfill, and recurring schedules

Paths:

- `Scraper/events/`
- `Scraper/banner-history/`
- `Database/Events/`
- `Database/BannerHistory/`
- `Database/Activities/`
- `Scraper/validate-data.cjs`
- `.github/workflows/data-refresh.yml`
- `.github/workflows/banner-history-refresh.yml`

Work:

- Extend event windows to support server-region dates where the source exposes
  them.
- Paginate official HoYo, Kuro, and Gryphline feeds with bounded cursor/page
  loops, rate limiting, and resumable checkpoints; add a dedicated history lane
  rather than applying the normal short refresh window to a backfill.
- Emit a per-game coverage manifest with sources, earliest/latest record, page
  count, cursor-completion state, known gaps, and last successful refresh.
- Preserve sourced ended records append-only. Current official rows replace
  matching expected rows.
- Store source URL, source kind, fetched time, and exact/expected status.
- Add sourced recurring definitions for Spiral Abyss and Imaginarium Theater.
- Add exact Stygian windows from official notices; allow only forward
  patch-relative `Expected` entries because no permanent cadence is promised.
- Refresh HSR/ZZZ/WuWa predictable modes only where an official rule is proven.
  Leave unsupported gaps empty.

Acceptance: every source run has a measurable coverage manifest; partial failure
preserves the last-known-good dataset; resume/rate/loop guards pass; history gaps
are explicit; no guessed exact date is published; official notices replace
forecasts automatically.

### `nyx-0041` — canonical all-game timeline layout

Depends on `nyx-0039` and `nyx-0040`.

Paths:

- `Site/src/features/timeline/timeline-data.js`
- `Site/src/features/timeline/timeline-view.jsx`
- `Site/src/styles/game-page-shared.css`
- `Site/tools/tests/timeline-data.test.mjs`

Work:

- Build canonical patch, phase, and sourced per-game/per-region reset-aligned
  week bands from actual data for GI, HSR, ZZZ, WuWa, Endfield, Nyx All Banners,
  and Nyx All Events. Unknown schedules do not borrow another game's rule.
- Keep exact dates in a quiet bottom ruler.
- Remove “Banner history” and redundant game/timeline headings.
- Rename `Layers` to `Display`, `My planning` to `Personal`, and `Add marker` to
  `Add to Personal`; use square utility controls.
- Split a multi-word name after its first word. Center recurring-mode labels.
- Compact banner padding/lane pitch without shrinking current icons or text.
- Remove Stygian's popup and render it as a non-modal schedule block.
- Preserve zoom, pan, search, keyboard focus, and all existing deep links.

Acceptance: every timeline shares Patch → Phase → Week, irregular releases stay
accurate, weekly resets align to server time, and all requested copy/layout
changes work at all three required viewports.

### `nyx-0042` — Characters and Nyx hub correction

Paths:

- `Site/src/features/materials/char-materials.jsx`
- `Site/src/app/nyx-app.jsx`
- `Site/src/styles/game-page-shared.css`
- `Site/tools/generate-site-data.mjs`
- relevant GI/ZZZ/WuWa generated data and released local portraits
- focused Site tests

Work:

- Use the more-purple hover for every game and remove persistent favourite glow.
  Favourite stars appear on pointer hover or keyboard focus, not permanently.
- Show Pinned Favourites only on Roster and add a saved Show/Hide preference.
- Reuse the same component, dimensions, active/hover/focus states, and keyboard
  behaviour as Overview/Characters/Database/Wish Tracker for
  Roster/Talents/Trounce, unless a documented structural constraint blocks it.
- Put detail Back visibly farther from Materials/Character Kit at desktop and
  mobile widths, and simplify those controls. Give the Beta badge the same
  violet background and white text as the Live/Beta switch.
- Put Recent and Upcoming side-by-side on desktop and stack on mobile.
- Harden portrait fallback/audit for Mavuika; import only allowed local Pyrois and
  Sigrid portraits with provenance. Move released Pyrois to Live; keep Sigrid
  Beta until release proof exists.
- Show only the highest-quality ZZZ/WuWa skill material in overview rows while
  retaining all grades in calculations. Tighten the material/character grid so
  no empty spacer remains. Correct WuWa weekly classification so Weekly
  Challenge data is non-empty.
- Make Nyx character cards smaller, remove game badges, and preserve a `from:nyx`
  route so Back/Escape/browser Back returns to Nyx.
- Rename Calendar's `Add birthday` action to `Add date` without changing storage.

Acceptance: all five games behave consistently; data calculations remain full;
Nyx routing, favourites, weekly data, badges, portraits, and responsive layout
match the request.

### `nyx-0043` — Database shared filtering, complete text, art audit, rarity frames

Paths:

- `Scraper/prydwen/`
- relevant released Database source/assets
- `Database/Audits/database-missing-art.json`
- `Site/tools/generate-site-data.mjs`
- `Site/src/features/database/database-ui.js`
- `Site/src/app/nyx-app.jsx`
- `Site/src/styles/game-page-shared.css`
- Database tests

Work:

- Put every Database list's facets in the same Filter popout beside Search,
  including Collection, Wonderland, TCG, and Pot. Preserve Clear, active count,
  Escape, focus, touch, and list state.
- Parse compound source fields such as ZZZ `B | Type: Attack` into separate
  values. Normalize source-native numeric, letter, and symbol ranks into a
  documented tier without converting unsupported values to a guessed tier. Add
  useful supported facets without exposing noisy raw stats.
- Remove the intentional 260-character inline-description truncation.
- Re-fetch released rows with broken localized names/media. Quarantine only rows
  with no usable localized display name or rows proven internal/test. Missing
  art or description alone never removes a released row. Record before/after
  counts and one audit reason per excluded row; never invent text or filenames.
- Expand the missing-art audit to inline and lazy collections with an honest
  reason for every missing image.
- Add rarity-tinted art frames only for a valid normalized tier; Unknown stays
  neutral. Ensure long detail text scrolls and never sits under an image.

Acceptance: shared filters cover every category, full text is readable, no local
path is broken, every missing image is accounted for, and valid rarity is visible.

### `nyx-0044` — Library annotation interaction correction

Depends on the Database/UI shared-file pass to avoid CSS conflicts.

Paths:

- `Site/src/features/library/`
- `Site/src/styles/game-page-shared.css`
- Library tests

Work:

- Make Highlight, Underline, and Bold real pressed-state toggles; pressing an
  active style removes only that style.
- Replace the unreadable native colour select with a dark accessible swatch
  palette. Changing colour updates the highlight.
- Move `Clear formatting` into a compact overflow menu and remove the redundant
  Copy button/clipboard path. Native selection and copying stay enabled.
- Show formatting controls only for a safely anchorable single text block; leave
  cross-block selection alone for normal copying.
- Add one-step Undo for the affected annotation IDs only.
- Keep IndexedDB `nyx-library-annotations` v1 and every existing annotation row;
  no migration or account sync.

Acceptance: formatting can be added, changed, toggled off, cleared, or undone in
one obvious action; the palette is readable; existing notes/anchors survive.

### `nyx-0045` — independent integration and visual gate

Depends on all implementation batches.

- Run focused author tests after every batch.
- A different agent verifies each author's diff and tests.
- Run full `Scraper` tests and `validate:strict`.
- Run all relevant `Site` tests, `build:deploy`, and `smoke:deploy`.
- Use a disposable browser session for UI state. Do not launch or change the
  user's real Chrome profile without permission.
- Verify `390x844`, `1600x900`, and `2560x1080`: no blank UI, clipping,
  overlap, horizontal overflow, missing focus, or console errors.
- Capture initial/final status for both worktrees, run `git diff --check`, verify
  every generated asset path resolves, and confirm the main `C:\Pengo\Nyx`
  achievements worktree was not modified.
- Run old favourites, timer, and Library annotation fixtures. Prove Library Undo
  cannot overwrite an unrelated annotation changed in another tab.
- Do not commit, push, or deploy unless the user asks.

## Explicit non-goals and risks

- A custom timezone is not a custom game server. The UI keeps those concepts
  separate so reset calculations remain true.
- Official feeds cannot guarantee a complete launch-to-present event archive.
  The app will show sourced coverage and gaps, not claim impossible completeness.
- Sigrid is not moved to Live until release is officially confirmed.
- Existing Library IndexedDB rows and favourites/timer preferences are preserved.
- The active achievements task overlaps shared source paths in another worktree;
  this plan is isolated on its own branch and will require a normal later merge.
