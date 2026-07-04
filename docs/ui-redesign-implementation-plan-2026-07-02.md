# UI Redesign Implementation Plan

Date: 2026-07-02
Branch: `ui-redesign`
Source review: `docs/nyx-ui-ux-visual-review-2026-07-01.md`

## Phase 1 - Foundation And Preferences

1. Add shared design tokens and code-built decorative primitives in `Site/src/styles/game-page-shared.css`.
   - `deco-panel`: calmer content wells with stepped borders.
   - `deco-divider`: CSS/SVG-like diamond section marker.
   - `deco-rail`: vertical or horizontal reading lane.
   - `deco-status`: status dots/diamonds that replace repeated raster diamonds.
   - `game-crest`: consistent medallion framing for game icons.

2. Add the `Artwork quality` control in the Pengo menu.
   - Default: `Original`.
   - Option: `Faster`.
   - Persist in `nyx-pengo-settings`.
   - Expose the current preference through a root class/data attribute so image helpers can choose PNG/WebP.

3. Add account/preference sync.
   - Inspect the existing encrypted account sync flow.
   - Extend Worker storage with a small preference endpoint if no general preference path exists.
   - Keep local preference as fallback and account preference as winner when available.

## Phase 2 - Mobile Baseline

1. Fix index page clipping and mobile labels in `Site/pages/index.html`.
   - Keep `backgroundnyx.png`.
   - Keep game icons and backgrounds.
   - Rebuild ring/card framing with CSS where practical.
   - Add visible labels on mobile.

2. Fix game-page mobile shell issues.
   - Prevent the `Nyx` wordmark from clipping.
   - Prevent fixed bottom-left controls from covering content.
   - Make the game rail and stage respond within the viewport.

## Phase 3 - Dense Data Surfaces

1. Tracker import/result surfaces.
   - Replace command horizontal-scroll dominance with wrapped command blocks and clearer copy actions.
   - Give provenance/account/source details stronger visual weight.
   - Add calmer panel fills so pattern linework does not pass through critical text.

2. Character material roster and popout.
   - Keep character and material images.
   - Add ledger-style rails and stronger section lanes.
   - Scrim/contain splash art behind material quantities.

3. Database/library.
   - Reduce accidental clipping.
   - Prefer flexible grid/list behavior over fixed card-height truncation.
   - Use stronger search/filter and category surfaces.

4. Banners/codes.
   - Keep banner art.
   - Add consistent lower rails/scrims and state treatments.
   - Replace small decorative raster diamonds with CSS primitives.

## Phase 4 - Verification And Preview

1. Build and smoke:
   - `npm --prefix C:\Pengo\Nyx\Site run build:deploy`
   - `npm --prefix C:\Pengo\Nyx\Site run smoke:deploy`

2. Screenshot verification:
   - Desktop: `/`, `/nyx`, `/genshin`, `/hsr`, `/zzz`, `/wuwa`, `/endfield`.
   - Desktop states: materials roster, material popout, tracker import, tracker result, database/library, Pengo menu.
   - Mobile: index and at least one game page at 390x844.

3. Deploy branch preview:
   - Use Wrangler/Cloudflare preview without production routes.
   - Include preview URL and screenshots in a draft PR targeting `main`.

## Acceptance Criteria

- Production `main` is not changed.
- Branch `ui-redesign` contains the work and a draft PR.
- The site keeps its Nyx identity and current background mood.
- Mobile index has visible game labels.
- Game pages avoid clipped brand and fixed-control overlap.
- Tracker, database, and material surfaces are easier to scan.
- `Artwork quality` appears in the bottom-left Pengo menu.
- PNG remains default; WebP is optional and scoped to character/item/banner/splash assets.
- Build, smoke, and screenshot verification are completed before pushing.
