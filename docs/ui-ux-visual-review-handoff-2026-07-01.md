# Nyx UI/UX Visual Review Handoff

Date: 2026-07-01

Use this when starting the next session for the requested visual/UI review:

> Do another full review, but this time for UI/UX. Review places where Nyx uses images, excluding character/game character assets, and suggest how those visuals can be replaced with things we can build with site tools while sticking to a "Fantasy Art Deco" style. Also suggest how to incorporate that style to improve the site's UI/UX. This is a full visual review and report, not an implementation pass unless the user explicitly asks for changes.

## Project Scope

- Real project: `C:\Pengo\Nyx`
- GitHub repo: `Asyce/Nyx`
- Main branch: `main`
- Live site: `https://pengo.gg`
- Historical prototype/reference only: `C:\Pengo\AI\As-I-ve-Hoarded`
- Do not review or modify the old prototype unless the user explicitly asks. It can be referenced only if Nyx has a direct comparison need.

Current repo state at handoff time:

- Working tree was clean on `main...origin/main`.
- Latest known commit/deploy after the index-background restore: `efa51ba2 fix(index): restore pre-video background`
- Live `version.json` was verified against `efa51ba2`.

## Important Recent Context

The index page background went through a short experiment:

1. A local `.webm` from `unused\2026-06-23 21-21-55.webm` was tried as the index background.
2. A procedural star/cosmic background was tried afterward.
3. The user disliked the procedural result: too line-like, not enough of the original feel.
4. The index page was restored to its pre-video background.

The current index page should therefore still use:

- `Site/assets/bg/backgroundnyx.png`
- `Site/assets/decor/pattern.png`
- `.page-bg`
- `.page-pattern`
- `.page-vignette`

Do not assume the user wants the video/procedural background back. For this new review, treat that history as useful evidence: the user likes the older visual direction more than generic star lines, but wants a more deliberate visual system.

## Existing Review Docs To Read First

Start with:

- `C:\Pengo\Nyx\docs\agent-index.md`
- `C:\Pengo\Nyx\docs\nyx-full-review-2026-06-30.md`
- `C:\Pengo\Nyx\docs\nyx-review-execution-addendum-2026-06-30.md`
- `C:\Pengo\Nyx\docs\report-feedback-decisions-2026-06-30.md`
- `C:\Pengo\Nyx\docs\wish-history-import-options-plan-2026-06-30.md`

Older UI work:

- `C:\Pengo\Nyx\docs\ui-round2-plan.md`
- `C:\Pengo\Nyx\docs\ui-round3-plan.md`

These older UI docs include useful file maps and prior visual decisions, but this new pass should be broader and more art-direction focused.

## Main Files For Visual Review

### Standalone Index

- `C:\Pengo\Nyx\Site\pages\index.html`
  - Fully standalone page with inline CSS and JS.
  - Current image/decor usage includes:
    - `../assets/bg/backgroundnyx.png`
    - `../assets/decor/pattern.png`
    - `../assets/icon/eye_ball.png`
    - `../assets/icon/eye_lid.png`
    - `../assets/icon/eye_drips.png`
    - `../assets/decor/achievement_cycle.png`
    - `../assets/cards/principal_frame.png`
    - `../assets/decor/patternv1.png`
    - `../assets/decor/BgRogueCommonPatternRogue1.png`
    - `../assets/cards/sumeru_circle_1.png`
    - `../assets/cards/abyss_circle.png`
    - `../assets/icon/pengo.png`
    - game card icons/backgrounds such as `noxbg.png`, `giicon.png`, `gibg2.png`, `hsricon.png`, `hsrbg.png`, `zzzicon.png`, `zzzbg3.png`, `wuwaicon.png`, `wuwabg2.png`, `aeicon.png`, `aebg.png`

### Game Pages

- `C:\Pengo\Nyx\Site\pages\nyx.html`
- `C:\Pengo\Nyx\Site\pages\genshin.html`
- `C:\Pengo\Nyx\Site\pages\hsr.html`
- `C:\Pengo\Nyx\Site\pages\zzz.html`
- `C:\Pengo\Nyx\Site\pages\wuwa.html`
- `C:\Pengo\Nyx\Site\pages\endfield.html`

These are mostly shells. They share:

- `../assets/bg/backgroundnyx.png`
- `../assets/decor/pattern.png`
- `../assets/icon/eye_ball.png`
- `../assets/icon/eye_lid.png`
- `../assets/icon/eye_drips.png`
- a game-specific hero art value in `GAME` config, such as `../assets/bg/hsrbg.png` or `../assets/bg/aebg.png`

### React App And Shared CSS

- `C:\Pengo\Nyx\Site\src\app\nyx-app.jsx`
  - Main shell, tabs, overview, banners, codes, tracker, database, Pengo menu.
- `C:\Pengo\Nyx\Site\src\components\game-page-components.jsx`
  - Shared game page components and banner/card UI.
- `C:\Pengo\Nyx\Site\src\features\materials\char-materials.jsx`
  - Character material roster, popout, progression UI.
- `C:\Pengo\Nyx\Site\src\features\gacha\gacha-tracker.jsx`
  - Pull import/tracker UI.
- `C:\Pengo\Nyx\Site\src\features\gacha\pulls-overview.jsx`
  - Cross-game pull overview.
- `C:\Pengo\Nyx\Site\src\styles\game-page-shared.css`
  - Main visual system for game pages. This is the biggest visual-review file.

### Mockups

- `C:\Pengo\Nyx\Site\mockups\wish-tracker`
- `C:\Pengo\Nyx\Site\mockups\wish-tracker-v2`

These are not necessarily live product surfaces, but they are useful for visual direction and unresolved tracker layout ideas.

## Authored Site Assets Worth Reviewing

Exclude character and game data assets from the main "replace with site tools" analysis. Focus on authored UI/decor assets such as:

### Backgrounds

- `C:\Pengo\Nyx\Site\assets\bg\backgroundnyx.png` - 11.8 MB
- `C:\Pengo\Nyx\Site\assets\bg\page_bg.jpg` - 15.3 MB
- `C:\Pengo\Nyx\Site\assets\bg\noxbg.png`
- `C:\Pengo\Nyx\Site\assets\bg\gibg2.png`
- `C:\Pengo\Nyx\Site\assets\bg\hsrbg.png`
- `C:\Pengo\Nyx\Site\assets\bg\zzzbg3.png`
- `C:\Pengo\Nyx\Site\assets\bg\wuwabg2.png`
- `C:\Pengo\Nyx\Site\assets\bg\aebg.png`

Some game-specific background art may be better treated as product/game artwork rather than replaceable decoration. Still review how it is framed, masked, dimmed, and used.

### Decorative Motifs

- `C:\Pengo\Nyx\Site\assets\decor\pattern.png`
- `C:\Pengo\Nyx\Site\assets\decor\patternv1.png`
- `C:\Pengo\Nyx\Site\assets\decor\achievement_cycle.png`
- `C:\Pengo\Nyx\Site\assets\decor\BgRogueCommonPatternRogue1.png`
- `C:\Pengo\Nyx\Site\assets\decor\orbit_burst.png`
- `C:\Pengo\Nyx\Site\assets\decor\toast_dia.png`
- `C:\Pengo\Nyx\Site\assets\decor\alchemypengobg.png`

These are the best candidates for replacement by CSS masks, inline SVG, canvas, border-image-like generated geometry, or procedural ornamental components.

### Frames And Cards

- `C:\Pengo\Nyx\Site\assets\cards\principal_frame.png`
- `C:\Pengo\Nyx\Site\assets\cards\fav_frame.png`
- `C:\Pengo\Nyx\Site\assets\cards\fav_frame_mask2.png`
- `C:\Pengo\Nyx\Site\assets\cards\fav_frame_rim2.png`
- `C:\Pengo\Nyx\Site\assets\cards\sumeru_circle_1.png`
- `C:\Pengo\Nyx\Site\assets\cards\abyss_circle.png`

These are strong candidates for "Fantasy Art Deco" redesign using layered borders, clip-path polygons, conic/radial gradients, mask-composite, pseudo-elements, and reusable CSS classes.

### Brand And Utility Icons

- `C:\Pengo\Nyx\Site\assets\icon\nyx_logo.png`
- `C:\Pengo\Nyx\Site\assets\icon\pengo.png`
- `C:\Pengo\Nyx\Site\assets\icon\pengoemote.png`
- `C:\Pengo\Nyx\Site\assets\icon\kofi-logo.png`
- `C:\Pengo\Nyx\Site\assets\icon\eye_ball.png`
- `C:\Pengo\Nyx\Site\assets\icon\eye_lid.png`
- `C:\Pengo\Nyx\Site\assets\icon\eye_drips.png`
- game icons: `giicon.png`, `hsricon.png`, `zzzicon.png`, `wuwaicon.png`, `aeicon.png`, `noxicon.png`

Do not casually replace brand/game icons. Review whether they need better containers, art-deco medallions, hover/focus states, contrast, or sizing.

### Meta Icons

- `C:\Pengo\Nyx\Site\assets\meta\**`

These are element/path/weapon/class icons. Treat them like game/content assets, not generic decoration. Suggestions should focus on consistent framing, sizing, and hierarchy.

## What "Fantasy Art Deco" Should Mean Here

Use the phrase as a visual system, not just gold lines everywhere.

Good fit for Nyx:

- Deep night/violet base with restrained blue-shifted shadows.
- Antique gold, pearl/lavender, and soft teal as accents.
- Symmetric stepped geometry.
- Tall vertical dividers and sunburst/orbit motifs.
- Fine linework, nested borders, angular corners, diamonds, arches, fan shapes.
- Magical observatory / tarot ledger / celestial theater feeling.
- Clear information hierarchy; decoration should frame and guide attention, not compete with data.

Avoid:

- Generic starfield lines that look like straight scratches.
- Heavy one-note purple gradients.
- Too much beige/brown or overly warm old-paper styling.
- Overly ornate card borders around every single small item.
- UI cards inside UI cards.
- Decoration that makes dense tracker/material data slower to scan.

## Site-Tool Replacement Ideas To Evaluate

The review should identify where static images can become reusable code-built primitives:

- CSS pseudo-element frames for cards and panels.
- `clip-path: polygon(...)` art-deco corners and tabs.
- Layered `linear-gradient`, `radial-gradient`, and `conic-gradient` ornamentation.
- Inline SVG symbols for reusable motifs such as diamonds, arches, rays, keys, crescents, and dividers.
- CSS masks for eye/logo-inspired silhouettes when the source is simple enough.
- Canvas backgrounds for slow, subtle procedural particles/orbits, but only if they pass screenshot and performance checks.
- Generated SVG/CSS pattern tiles for `pattern.png`/`patternv1.png` style effects.
- Reusable "medallion", "sigil ring", "deco divider", "deco rail", "deco panel", and "game crest" components/classes.
- Responsive density modes so mobile keeps the mood but loses nonessential ornament.

For each image candidate, ask:

1. Is it content/brand/game art, or purely UI decoration?
2. Does replacing it reduce weight, improve consistency, or improve responsiveness?
3. Can the replacement be made accessible and performant?
4. Does it preserve the specific Nyx identity, or make the site look more generic?

## Required Review Surfaces

Review at least:

- `/`
- `/nyx`
- `/genshin`
- `/hsr`
- `/zzz`
- `/wuwa`
- `/endfield`
- character materials roster
- character material popout
- codes panel
- banners panel
- wish/gacha tracker import state
- wish/gacha tracker result state
- database/library views
- Pengo/settings menu
- mobile widths for index and at least one game page

Use browser screenshots where possible. Check desktop and mobile. The user explicitly asked for UI suggestions, so visual fit matters as much as code correctness.

## Suggested Report Structure

Recommended output for the next session:

1. Executive summary
2. Visual identity diagnosis
3. Current image/decor inventory
4. Page-by-page UI/UX review
5. Image replacement plan
6. Fantasy Art Deco design system proposal
7. Component-by-component improvements
8. Responsive/mobile visual recommendations
9. Accessibility and readability notes
10. Performance and asset-weight notes
11. Prioritized implementation roadmap
12. Acceptance criteria and verification plan

For each recommendation, include:

- Current issue
- Proposed change
- Why it helps
- Files likely affected
- Whether it is CSS-only, JSX/component work, asset-generation work, or data-dependent
- Risk/effort

## Commands And Verification

Useful commands:

```powershell
cd C:\Pengo\Nyx
git status --short --branch
rg -n "backgroundnyx|pattern\.png|<img|url\(|mask-image|page-bg|page-pattern|page-vignette|nyx_logo|pengo|kofi|icon|decor|bg/" Site\pages Site\public Site\mockups -g "*.html" -g "*.css" -g "*.js"
rg -n "backgroundnyx|pattern\.png|url\(|mask-image|gp-bg|gp-pattern|gp-vignette|principal_frame|fav_frame|toast_dia|achievement_cycle|alchemypengobg" Site\src\styles Site\src\app Site\src\components Site\src\features -g "*.css" -g "*.jsx" -g "*.js"
npm --prefix C:\Pengo\Nyx\Site run build:deploy
npm --prefix C:\Pengo\Nyx\Site run smoke:deploy
```

If doing screenshot verification, serve the deploy output:

```powershell
cd C:\Pengo\Nyx\Site\.deploy\pengo
python -m http.server 8790
```

Then inspect:

- `http://127.0.0.1:8790/`
- `http://127.0.0.1:8790/nyx`
- `http://127.0.0.1:8790/genshin`

## Warnings For The Next Session

- Do not push/deploy unless the user explicitly asks. This request is for a review/report.
- Do not reintroduce the video background without explicit approval.
- Do not treat generated `Site/src/data/generated/**` image references as authored UI decoration; they contain thousands of game/character/material assets.
- Do not over-optimize mobile perfection; earlier user direction was to fix obvious mobile problems but a dedicated mobile app may come later.
- Keep character assets, material icons, element/path icons, and official game icons in scope only for framing/sizing/hierarchy, not replacement.
- The site's current mood is already distinctive. The review should improve consistency and usability, not flatten it into a generic dashboard.
