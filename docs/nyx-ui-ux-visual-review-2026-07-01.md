# Nyx UI/UX Visual Review

Date: 2026-07-01
Scope: `C:\Pengo\Nyx`
Mode: Review/report only. No product implementation changes.

## 1. Executive Summary

Nyx already has a recognizable visual identity: dark celestial space, luminous violet accents, large character-art moments, and a living-eye brand motif. The main opportunity is not to replace that mood. The opportunity is to make the visual system more deliberate, lighter, and easier to scan by turning the current one-off decorative PNGs into reusable "Fantasy Art Deco" UI primitives.

The strongest current surfaces are the desktop game overview, the character material roster, and the overall topbar/game-rail language. The weakest visual surfaces are the standalone index at edge sizes, the tracker import command layout, the tracker result data panels, the database card grid, the material popout background treatment, and mobile.

The biggest art-direction recommendation is:

- Keep the painted `backgroundnyx.png` mood, but optimize it and use it more calmly.
- Replace linework/ring/frame PNGs with code-built CSS/SVG primitives: deco rails, sigil rings, stepped panel corners, diamond dividers, card frames, and medallions.
- Treat game/character/banner/meta icons as content assets, not replaceable decoration.
- Use ornament to create hierarchy and reading lanes, not to fill every empty area.

## 2. Verification Performed

- Read the handoff and prior review docs listed in `docs/ui-ux-visual-review-handoff-2026-07-01.md`.
- Ran `npm --prefix C:\Pengo\Nyx\Site run build:deploy`.
- Ran `npm --prefix C:\Pengo\Nyx\Site run smoke:deploy`.
- Served `.deploy/pengo` locally on `http://127.0.0.1:8790`.
- Captured desktop and mobile screenshots in `docs/visual-review-screenshots-2026-07-01/`.
- Checked seven main routes for broken `<img>` elements and console errors.

Build/smoke evidence:

- Build passed.
- Deploy artifact: 6,088 files, 707.98 MB.
- Referenced Database assets copied: 5,935.
- Missing referenced Database assets: 0.
- Smoke passed for `/`, `/nyx`, `/genshin`, `/hsr`, `/zzz`, `/wuwa`, `/endfield`, `/sitemap.xml`, `/version.json`.
- Local browser route check found no broken `<img>` elements and no console errors on the seven main routes.

Note: the local Python server does not apply Cloudflare clean-route redirects in-browser, so screenshots used equivalent deploy files such as `/genshin.html`. The deploy smoke script verified the clean slugs.

## 3. Visual Identity Diagnosis

Current identity:

- A painted cosmic/night background gives Nyx a distinctive base.
- The eye motif is memorable and should remain a brand primitive.
- Character/game imagery gives strong product specificity.
- Purple/violet is currently dominant almost everywhere.
- Many decorations are line-heavy circles, frames, and masks that repeat without a single reusable system.

Current issues:

- The global pattern and orbit linework often runs behind dense data, making scanning harder.
- The same background treatment across every game page creates consistency, but not enough page-level hierarchy.
- Static frame assets work visually, but they lock the site into fixed proportions and make responsive states harder.
- Some pages rely on character art for hierarchy and then add equally strong decorative linework behind it.
- Mobile keeps the mood but loses clarity: clipped wordmark, unlabeled index cards, horizontal card overflow, and fixed controls overlapping content.

Recommended "Fantasy Art Deco" direction:

- Deep night base, with violet as atmosphere rather than the only structural color.
- Antique gold for special states and key dividers, pearl/lavender for text, restrained teal for secondary status.
- Symmetric stepped geometry, diamonds, vertical rails, arch/ring motifs, and thin nested borders.
- Magical observatory / tarot ledger / celestial theater feeling.
- Dense data surfaces should use calmer panels and precise dividers, not more ornament.

## 4. Current Image And Decor Inventory

### Keep As Identity Or Content

| Asset group | Current role | Recommendation |
|---|---|---|
| `Site/assets/bg/backgroundnyx.png` | Primary painted night/cosmic mood | Keep the concept. Optimize into responsive WebP/AVIF variants and use CSS overlays for art-deco structure. Do not replace with generic procedural stars. |
| Game card/background art such as `gibg2.png`, `hsrbg.png`, `zzzbg3.png`, `wuwabg2.png`, `aebg.png`, banner art, character art | Product/content imagery | Keep. Improve framing, masks, dimming, and crop rules. |
| `nyx_logo.png`, `pengo.png`, `kofi-logo.png`, game icons | Brand/platform icons | Keep. Put them in consistent medallions/containers. |
| `Site/assets/meta/**` | Game metadata icons | Keep. Standardize size, contrast, and framing. |
| `eye_ball.png`, `eye_lid.png`, `eye_drips.png` | Brand eye masks | Keep as a motif, but consider converting to inline SVG/mask symbols so size/color states are easier. |

### Replace Or Rebuild With Site Tools

| Asset | Current issue | Proposed replacement | Type | Risk/effort |
|---|---|---|---|---|
| `decor/pattern.png` | Large global ring/linework competes with text and data panels. | Reusable `DecoOrbitField` SVG/CSS layer with opacity, blur, density, and breakpoint controls. | CSS/SVG | Medium |
| `decor/patternv1.png` | Used as a mask; fixed shape and difficult to tune per component. | CSS mask or inline SVG symbol for "sigil veil" with theme variables. | CSS/SVG | Small-medium |
| `decor/achievement_cycle.png` | Index/topbar medallion frame is an image with fixed proportions. | CSS conic/radial ring plus repeated diamond ticks via SVG symbol. | CSS/SVG | Medium |
| `decor/BgRogueCommonPatternRogue1.png` | Circular ornament, currently purple-heavy and pixel-bound. | `deco-sigil-ring` component using SVG strokes and CSS variables. | SVG/CSS | Medium |
| `decor/orbit_burst.png`, `decor/toast_dia.png`, `decor/alchemypengobg.png` | Small decorative marks are easy to generate and theme. | Inline SVG diamond, burst, and crest symbols. | SVG/CSS | Small |
| `cards/principal_frame.png` | Tech-like purple frame does not fully match fantasy art deco; fixed raster frame. | `deco-panel` CSS with stepped corners, nested borders, subtle dotted/triangle fill. | CSS | Medium |
| `cards/fav_frame*.png` | Strong shape, but raster frame/mask makes responsive card states harder. | `deco-character-frame` using `clip-path`, pseudo-elements, and optional CSS mask. | CSS/SVG | Medium-large |
| `cards/sumeru_circle_1.png`, `cards/abyss_circle.png` | Nice circular ornament, but one-off raster mask. | SVG ring library: `sigil-ring`, `gold-orbit`, `abyss-ring`. | SVG/CSS | Medium |

## 5. Page-By-Page UI/UX Review

### `/` Index

Current issue:

- Desktop screenshot at 1600x900 shows the Pengo icon clipped at the left edge and the large eye clipped at top/right.
- Mobile index shows six circular cards but no visible game labels. This preserves the mood but hurts recognition and accessibility for sighted users.
- The circular ring visuals are strong but not yet systematized. They read more like one-off magic circles than a reusable UI language.

Proposed change:

- Keep the immersive first screen, but rebuild the card rings as a reusable art-deco medallion component.
- Add visible compact labels on mobile, either beneath medallions or as bottom arc labels.
- Move oversized brand/eye decoration inside responsive safe areas so it can intentionally crop only at very large editorial breakpoints.

Why it helps:

- Preserves the current identity while making mobile game selection understandable.
- Prevents accidental clipping from reading as broken layout.
- Gives the index a component that can also be reused for game crests.

Likely files:

- `Site/pages/index.html`
- `Site/assets/decor/*`
- `Site/assets/cards/*`

Type: CSS/SVG/component work.
Risk/effort: Medium.

### Game Overview Pages

Current issue:

- Desktop overview pages are visually strong, but every game uses nearly the same stage language.
- Character cards are the visual anchor; background orbit lines and vertical glyph columns sometimes compete with them.
- Right-side banner/codes panels are useful but sit on the same busy celestial layer.

Proposed change:

- Add a calmer "content well" treatment behind data panels: faint stepped border, 10-18% solid night fill, thin top rail, and fewer background lines through text.
- Use game-specific accent tokens beyond active game icon: small teal/gold/lavender status colors, not only purple.
- Turn the large vertical pattern/glyph columns into optional `deco-rail` primitives that can be suppressed behind dense panels.

Why it helps:

- Keeps the theatrical desktop overview while reducing background competition.
- Makes codes, banners, and data-health states easier to read.

Likely files:

- `Site/src/styles/game-page-shared.css`
- `Site/src/app/nyx-app.jsx`
- `Site/src/components/game-page-components.jsx`

Type: CSS/component work.
Risk/effort: Medium.

### Character Materials Roster

Current issue:

- The roster is dense and functional, but page-level ornament is not helping the roster scan.
- Circular character icons already provide enough visual energy; the background pattern should be quieter here.
- The section tabs/tools are compact but could use stronger art-deco grouping.

Proposed change:

- Use a subtle ledger surface behind the roster: low-opacity solid fill, a vertical left rail, and section labels as small deco tabs.
- Keep character icons unchanged as content.
- Replace image-based decorative diamonds with CSS/SVG diamonds for tabs and section markers.

Why it helps:

- Dense rosters need lower-noise surroundings.
- The site keeps its visual identity through dividers and rails instead of background clutter.

Likely files:

- `Site/src/features/materials/char-materials.jsx`
- `Site/src/styles/game-page-shared.css`

Type: CSS/component work.
Risk/effort: Small-medium.

### Character Material Popout

Current issue:

- The popout is visually rich, but the bright splash art sits directly behind material rows and competes with the icons and quantities.
- The left labels are clear; the right material grid needs stronger lanes and calmer contrast.
- The current panel feels more like a transparent overlay on art than a ledger.

Proposed change:

- Turn the popout into a "deco ledger": fixed left index rail, horizontal section dividers, and a masked/scrimmed artwork well.
- Keep splash/birthday art, but confine it to a controlled art layer with stronger scrim behind material tiles.
- Use CSS-generated lane dividers between Ascension, Talents, Weapon, and Total.

Why it helps:

- Users compare quantities; the art should support mood, not compete with numbers.
- A ledger treatment fits the "tarot ledger / celestial theater" direction.

Likely files:

- `Site/src/features/materials/char-materials.jsx`
- `Site/src/styles/game-page-shared.css`

Type: CSS/component work.
Risk/effort: Medium.

### Codes Panel

Current issue:

- The desktop code rows are compact and usable.
- The visual hierarchy is mostly text and small icons, which is appropriate.
- The small decorative/status diamond should become a generated primitive rather than `toast_dia.png`.

Proposed change:

- Keep the dense table behavior.
- Use a reusable `deco-status-dot`/diamond for premium currency and banner freshness.
- Ensure hover reward popouts have a stronger opaque backdrop on busy backgrounds.

Why it helps:

- Avoids adding unnecessary ornament to an already dense utility surface.
- Makes status colors and icons consistent across panels.

Likely files:

- `Site/src/app/nyx-app.jsx`
- `Site/src/styles/game-page-shared.css`

Type: CSS/component work.
Risk/effort: Small.

### Banners Panel

Current issue:

- Banner cards correctly use game art as content.
- Some banner cards crop strongly, and labels can sit over high-contrast art.
- Endfield degraded/unavailable state is visible, which is good, but the warning sits inside the same decorative language as normal data.

Proposed change:

- Keep banner art; do not replace it.
- Add a code-built `deco-banner-stage` frame with a consistent lower text rail and optional dim gradient.
- Use distinct state treatments: fresh, transition, stale, invalid, unavailable. Invalid/unavailable should use clearer, quieter danger panels rather than only color/glow.

Why it helps:

- Banner art remains the draw.
- Users understand whether the banner is content, forecast, or degraded data.

Likely files:

- `Site/src/app/nyx-app.jsx`
- `Site/src/components/game-page-components.jsx`
- `Site/src/styles/game-page-shared.css`

Type: CSS/component work plus data-state mapping.
Risk/effort: Medium.

### Wish/Gacha Tracker Import State

Current issue:

- Import steps are clear, but command fields show horizontal scrollbars that visually dominate the panel.
- The background pattern remains visible through explanatory text.
- On mobile, the fixed Live/Beta/Pengo controls overlap the bottom of the tracker content.

Proposed change:

- Use stacked command blocks with soft wrapping, a visible "copy" icon button, and optional expand for full command.
- Treat the import flow as a wizard/ledger with a left vertical deco rail and numbered Art Deco medallions.
- On mobile, move fixed controls away from content-heavy flows or collapse them behind a single top icon.

Why it helps:

- Trust and readability matter more than ornament in import flows.
- Reducing scrollbar noise makes the safer flow easier to understand.

Likely files:

- `Site/src/features/gacha/gacha-tracker.jsx`
- `Site/src/styles/game-page-shared.css`

Type: JSX/CSS.
Risk/effort: Medium.

### Wish/Gacha Tracker Result State

Current issue:

- The result view has a good dashboard structure, but background ornament runs through the panels.
- The account/source strip is small relative to its trust importance.
- The page title becomes "Manage import", which reads like an action rather than the current history context.

Proposed change:

- Replace "Manage import" as the dominant title with account/game/history context; keep "Manage import" as a secondary action.
- Promote source/provenance into a clear `deco-provenance` strip.
- Give panels more solid night fill and subtle stepped borders so pity, banner, and 5-star rows scan cleanly.

Why it helps:

- Pull-history data is trust-sensitive.
- Users need to know source, account, UID, and freshness before reading calculations.

Likely files:

- `Site/src/features/gacha/gacha-tracker.jsx`
- `Site/src/styles/game-page-shared.css`

Type: JSX/CSS.
Risk/effort: Medium.

### Database/Library View

Current issue:

- The current grid clips long descriptions heavily.
- The repeated translucent cards blur into the global background.
- "Artifact Sorter" currently opens a database/library surface, which is a naming/product clarity issue.

Proposed change:

- Use a denser list/table mode by default for database entries, with cards reserved for featured or visual browsing.
- Add filter rails and a stronger search header.
- Use art-deco separators and category tabs instead of many equal cards.

Why it helps:

- Database browsing is a scanning/comparison workflow.
- A list layout will handle long item names/effects better than clipped cards.

Likely files:

- `Site/src/app/nyx-app.jsx`
- `Site/src/styles/game-page-shared.css`

Type: JSX/CSS/product copy.
Risk/effort: Medium-large if changing layout; small if only visual polish.

### Pengo/Settings Menu

Current issue:

- The menu has personality and useful controls, but it is dense and uses many small button styles.
- The decorative background inside the menu competes with controls.
- On mobile/fixed layouts, the persistent Pengo/Live controls can overlap content.

Proposed change:

- Split menu content into clearer groups or tabs: Pengo, Interface, Identity.
- Use icon buttons/segmented controls for binary and option settings.
- Replace the internal raster/ornament background with a subtle generated crest watermark.

Why it helps:

- Keeps the charm while making settings easier to scan and tap.
- Reduces visual noise in a control-heavy panel.

Likely files:

- `Site/src/app/nyx-app.jsx`
- `Site/src/styles/game-page-shared.css`

Type: JSX/CSS.
Risk/effort: Medium.

## 6. Fantasy Art Deco Design System Proposal

Add a small visual primitive layer before changing individual surfaces:

| Primitive | Purpose | Build method |
|---|---|---|
| `deco-panel` | General content panel with stepped corners and nested border | CSS pseudo-elements, `clip-path`, gradients |
| `deco-rail` | Vertical/horizontal navigation and section dividers | CSS gradients + SVG diamond ticks |
| `deco-sigil-ring` | Game crest/index card medallion | Inline SVG symbol + CSS variables |
| `deco-divider` | Section heading line with diamond/sunburst | CSS + inline SVG |
| `deco-status` | Fresh/stale/invalid/sync/import status badges | CSS variables, small SVG glyphs |
| `deco-card-frame` | Favourites/cards without raster frame dependency | `clip-path`, pseudo-elements, layered shadows |
| `deco-provenance` | Tracker account/source/freshness strip | JSX component + CSS |
| `game-crest` | Game icon medallion across index, topbar, mobile | JSX/CSS wrapper around existing game icons |

Recommended tokens:

- Base: `#05040b`, `#0b0820`, `#15102e`
- Text: pearl `#f5f0ff`, lavender `#cfc6ff`, muted `#8f86b2`
- Accents: antique gold `#d8b56b`, violet `#8b7bff`, soft teal `#7ed8cf`, danger rose `#d95577`
- Use gold sparingly: selected/rare/important, not every border.

## 7. Responsive And Mobile Recommendations

Current mobile findings:

- Index mobile has no visible labels for game cards.
- Genshin mobile shows clipped `Nyx` wordmark at the left edge.
- Game overview relies on horizontal overflow for primary card content.
- Live/Beta/Pengo controls can overlap content near the bottom.
- Tracker import is reachable, but dense and vertically long; bottom fixed controls overlap.

Recommended changes:

| Current issue | Proposed change | Files likely affected | Type | Risk/effort |
|---|---|---|---|---|
| Clipped mobile wordmark | Use compact mobile brand: eye icon + `Nyx`, safe-area padding, no offscreen crop | `game-page-shared.css`, `nyx-app.jsx` | CSS/JSX | Small-medium |
| Index cards unlabeled | Add visible mobile labels and selected/focus state | `index.html` | CSS/HTML | Small |
| Horizontal stage overflow | Add explicit scroll affordance or switch to stacked two-card carousel with dots | `game-page-shared.css`, `game-page-components.jsx` | CSS/JSX | Medium |
| Fixed Pengo/Live overlap | Move into compact top/bottom control bar or floating menu with collision rules | `nyx-app.jsx`, CSS | JSX/CSS | Medium |
| Tracker command blocks too wide | Mobile-specific wrapped command layout and copy icon | `gacha-tracker.jsx`, CSS | JSX/CSS | Small-medium |

Do not over-perfect mobile web if a dedicated app is planned, but fix these baseline issues: no clipped brand, visible index labels, core controls reachable, and no fixed-control overlap over import/tracker content.

## 8. Accessibility And Readability Notes

- The hidden SEO "About this page" region appears first in the accessibility snapshot before the app. If it is intended only for crawlers, it should not be exposed ahead of the real UI to assistive tech.
- Background orbit lines pass through text in the tracker, database, and material screens. Dense data areas need stronger contrast backplates.
- Icon-only controls generally have labels, but visual tooltips/focus-visible states should be verified after any deco refactor.
- Mobile touch targets need a pass for tracker commands, Pengo menu pills, code copy/checkbox controls, and game rail icons.
- Avoid using color alone for data states such as transition/unavailable/invalid banners; pair state color with icon/label language.

Likely files:

- `Site/pages/*.html`
- `Site/src/app/nyx-app.jsx`
- `Site/src/features/gacha/gacha-tracker.jsx`
- `Site/src/styles/game-page-shared.css`

## 9. Performance And Asset-Weight Notes

Key asset weights observed:

- `Site/assets/bg/page_bg.jpg`: 15.3 MB.
- `Site/assets/bg/backgroundnyx.png`: 11.8 MB.
- `Site/assets/bg/wuwabg2.png`: 4.1 MB.
- `Site/assets/decor/pattern.png`: 309 KB.
- `Site/assets/decor/achievement_cycle.png`: 145 KB.
- `Site/assets/cards/principal_frame.png`: 135 KB.

Recommendations:

- Convert large backgrounds to responsive WebP/AVIF variants. Keep a high-quality source, but do not ship the same 11.8 MB background to every viewport.
- Confirm whether `page_bg.jpg` is still used. If not, avoid copying it into deploy output.
- Replace decorative masks/rings/frames with CSS/SVG where possible. The byte savings are not huge individually, but the responsive/control benefits are significant.
- Add route-level asset budgets: initial route image bytes, CSS bytes, JS/data bytes, total deploy artifact size.
- Keep character/game assets in the content pipeline; do not replace them with generated decoration.

## 10. Prioritized Implementation Roadmap

### Phase 1 - Visual Primitives

Build `deco-panel`, `deco-divider`, `deco-rail`, `deco-sigil-ring`, `deco-status`, and `game-crest`. Use them in one low-risk surface first, such as codes/status rows.

Acceptance:

- No visible regression on overview pages.
- At least one image decoration replaced by CSS/SVG.
- Theme tokens documented in a short `docs/ui-guidelines.md` or CSS comment block.

### Phase 2 - Mobile Baseline

Fix mobile index labels, clipped wordmark, Pengo/Live overlap, and tracker command overflow.

Acceptance:

- 390x844 screenshots show no clipped `Nyx`.
- Index mobile shows visible labels.
- Tracker import has no fixed controls covering command/hash content.
- Pengo menu remains reachable.

### Phase 3 - Dense Data Surfaces

Apply calmer `deco-panel`/ledger treatments to tracker results, material popout, and database/library.

Acceptance:

- Background pattern does not run directly through critical numbers/text.
- Tracker provenance is prominent.
- Material popout quantities remain readable over character art.
- Database descriptions no longer feel accidentally clipped in the default view.

### Phase 4 - Index And Game Crest System

Replace one-off index ring/frame imagery with reusable medallion/crest primitives.

Acceptance:

- Desktop index no longer has accidental edge clipping at 1600x900.
- Mobile index keeps the mood and has visible labels.
- Game crest primitive is reusable in index, topbar, and Pengo display-games controls.

### Phase 5 - Asset Optimization

Optimize large backgrounds and remove/avoid unused heavy assets.

Acceptance:

- Responsive background variants exist.
- Deploy artifact size report includes authored UI assets.
- Initial mobile route no longer downloads desktop-scale background assets unnecessarily.

## 11. Acceptance Criteria And Verification Plan

Before shipping any visual-system implementation pass:

- Run `npm --prefix C:\Pengo\Nyx\Site run build:deploy`.
- Run `npm --prefix C:\Pengo\Nyx\Site run smoke:deploy`.
- Capture screenshots:
  - `/`
  - `/nyx`
  - `/genshin`
  - `/hsr`
  - `/zzz`
  - `/wuwa`
  - `/endfield`
  - Genshin materials roster
  - material popout
  - tracker import
  - tracker result with local test data
  - database/library
  - Pengo menu
  - mobile index 390x844
  - mobile game page 390x844
- Check no broken images and no console errors.
- Check text does not overlap or clip in buttons/cards at desktop and mobile widths.
- Check reduced-motion keeps backgrounds and ornaments still/readable.
- Verify decorative SVG/CSS replacements are visually equivalent or better before deleting raster assets.

## 12. Final Assessment

Nyx should not flatten into a generic dashboard. Its identity is already valuable. The right next visual pass is to keep the painted night-world and character art, then replace one-off decorative image assets with a reusable Fantasy Art Deco system that gives panels, cards, rings, rails, and state badges consistent rules.

The highest-impact work is mobile baseline, tracker readability, material popout legibility, and replacing the global pattern/frame PNGs with controlled CSS/SVG primitives. That gives the site a stronger art direction and a better UX without undoing the visual mood the user already prefers.
