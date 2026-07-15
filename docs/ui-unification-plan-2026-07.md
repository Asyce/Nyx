# Nyx UI Unification Plan

Date: 2026-07-15  
Queue task: `nyx-0079`  
Audit: `docs/ui-unification-audit-2026-07.md`  
Baseline: live production commit `856c8ee90f5c43ee2e025eb03da7599d9a59123e`

## Definition of done

The disposable `codex/ui-unification` branch is complete when every page consumes one token system, ordinary controls and surfaces follow one shared behavior/visual contract, the six duplicated game-shell style blocks are gone, static JSX styling is class-based, documented exceptions keep their useful identity, every requested test/build gate passes, and 21 local after-screenshots match the live before-shot set without functional or responsive regressions.

This is a unification pass. It preserves the live page structure, imagery, copy, data, routes, game-specific content, and Nyx/Pengo identity.

## Design thesis

Subject: Nyx is a multi-game companion for players checking live schedules, progress, materials, pulls, and reference data.  
Audience: players who need dense information to remain quick to scan.  
Single job: make every Nyx tool feel learned after the user learns one tool.

### Base palette

The compact identity palette uses six existing live colors:

| Name | Value | Job |
|---|---|---|
| Abyss | `#05040b` | canvas and deepest scrim |
| Ledger | `#0c0922` | primary surface |
| Raised violet | `#191333` | controls and elevated surfaces |
| Pearl | `#f3f0ff` | main text |
| Orbit | `#8b7bff` | brand/selected state |
| Moonlit violet | `#b7aaff` | focus, strong edge, and glow source |

Heading and muted text aliases use the existing `#efeaff`, `#a99fd6`, `#cfc6f5`, and `#8d82bd`. Existing success, warning, danger, and info colors remain semantic state tokens; they are not alternate brand palettes.

### Type

- GI is the restrained display face for brand, page, and section headings.
- HSR with Segoe UI/system fallbacks is the interface and body face.
- Cascadia/ui-monospace is used only where exact character alignment matters, such as redemption codes and command text.

The type scale is the existing `9 / 10 / 12 / 14 / 16 / 22 / 30px` ladder, with `40 / 50px` reserved for true display moments. Ordinary controls use the readable 12px step rather than feature-specific 8-13px variations.

### Layout and signature

The left rail, circular game medallions, living eye, painted night background, and ledger section rules remain the signature. The shared component rule is a quiet dark interior with one moonlit violet edge. This deliberately spends the visual emphasis on Nyx's eye/orbit language and game art instead of giving every nested card a different glow.

This direction does not read as a generic dark dashboard because it retains the exact Nyx art, display type, circular navigation, orbit dividers, clipped branded CTA, and ledger hierarchy. The one deliberate visual risk is reducing ordinary component glow recipes to a single restrained edge/elevation family. That choice comes directly from the refined live gacha panels rather than a new aesthetic.

## Token architecture

Create `Site/src/styles/tokens.css` and link it before page styles on all seven pages. Raw design values live here; other styles consume semantic or compatibility tokens.

### Layer 1: primitives

- the six base colors and the existing semantic state colors
- RGB channel tokens for controlled alpha variants
- font families, weights, and the agreed type scale
- spacing: `2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32px`
- radii: `5px` small, `8px` control, `10px` card, `14px` panel/modal, pill, circle
- border alpha steps: `.10`, `.14`, `.18`, `.22`, `.35`
- shadow recipes: subtle edge, strong edge, active edge, interactive lift, panel, modal, accent, focus
- semantic layers: base, content, sticky, popover, modal, tooltip

### Layer 2: semantic roles

Planned top-level names include:

```css
--nyx-color-canvas
--nyx-color-surface
--nyx-color-surface-raised
--nyx-color-surface-nested
--nyx-color-text
--nyx-color-heading
--nyx-color-text-muted
--nyx-color-text-faint
--nyx-color-accent
--nyx-color-accent-bright
--nyx-color-border-subtle
--nyx-color-border
--nyx-color-border-strong
--nyx-font-display
--nyx-font-ui
--nyx-font-mono
--nyx-type-caption
--nyx-type-label
--nyx-type-small
--nyx-type-body
--nyx-type-lead
--nyx-type-section
--nyx-type-title
--nyx-radius-control
--nyx-radius-card
--nyx-radius-panel
--nyx-shadow-interactive
--nyx-shadow-panel
--nyx-shadow-modal
--nyx-focus-ring
```

Existing `.gp`, gacha, timeline, material, database, library, calendar, and achievement custom properties become aliases to these roles first. This protects current selectors while the markup migrates.

### Compatibility layer

Some exact live values are intentionally special: rarity frames, game/content status colors, the achievement paper ledger, the timeline's schedule bands, artwork masks, and decorative gradients. They receive clearly scoped compatibility tokens in `tokens.css` instead of leaving raw color/type/spacing/radius/shadow values scattered through feature CSS.

The final static coverage rule is:

- raw chrome colors, font sizes, spacing values, radii, and shadows belong in `tokens.css` only;
- media-query breakpoints, runtime geometry, keyframe coordinates, clip paths, image crop positions, and content/user colors are not design tokens;
- generated data and persisted timer colors remain untouched.

## Shared component contract

Add shared classes and compatibility selector groups to `game-page-shared.css`:

| Class/role | Contract |
|---|---|
| `.nyx-btn` | 38px minimum height, control radius, 12px UI type, consistent padding, hover, active, disabled, and focus-visible states |
| `.nyx-btn--primary` | existing refined violet selection gradient |
| `.nyx-btn--icon` | 34px square icon/close control |
| `.nyx-input` | 38px minimum height, raised surface, standard border/placeholder, bright focus ring |
| `.nyx-panel` | radius 14 raised panel with one violet edge and panel elevation |
| `.nyx-card` | radius 10 nested surface with subtle edge |
| `.nyx-card--interactive` | shared hover lift and focus ring |
| `.nyx-chip` | compact radius-5 badge with semantic state modifiers |
| `.nyx-section-title` | established `.gp-sec` GI heading/rule treatment |
| `.nyx-u-fill`, `.nyx-u-stack`, `.nyx-u-hidden` | small static layout/state helpers that replace repeated JSX style objects |

`.gp-hex` remains the branded CTA for major navigation/hero actions and gains the common focus-visible rule. Timeline blocks, game circles, art pickers, rarity tiles, and ledger rows keep their structural styling while inheriting focus/disabled behavior.

## Migration order and commits

1. `docs(ui): audit live styling variants` (complete)
   - Record source counts, variants, candidates, exclusions, and live before evidence.
2. `docs(ui): plan shared visual language`
   - Record tokens, component choices, visible changes, gates, and judgment calls.
3. `refactor(ui): add shared design tokens`
   - Add `tokens.css`, link every page, map existing root/feature variables, add unused shared classes, and centralize exact compatibility values. This is intended to be a visual no-op.
4. `refactor(ui): centralize page shell styles`
   - Move the six identical boot/backdrop blocks into shared CSS; move the standalone home layout to `index-page.css`; remove page inline style blocks; add the missing home/hex focus visibility.
5. `refactor(ui): unify controls and surfaces`
   - Apply the shared ordinary button, input, panel, card, chip, focus, disabled, and layer contracts across the shell, gacha, materials, timeline, database, library, calendar, and achievements while preserving exceptions.
6. `refactor(ui): replace static inline styles`
   - Rebuild `pulls-overview.jsx` with classes; class repeated app/component wrappers and hidden states; retain only runtime geometry/art/custom properties.
7. `refactor(ui): consolidate feature chrome`
   - Remove superseded duplicate definitions from the final effective selector outward, alias remaining feature chrome to tokens, and run a literal/static coverage audit.
8. `fix(ui): resolve visual qa findings` (only if needed)
   - Focused responsive/focus/overflow corrections found by the independent visual gate.

Writers that touch the shared stylesheet run serially. Mechanical value migration is deterministic and reviewed by diff; feature behavior remains unchanged.

## Intentional visual changes

| Page/surface | Element | Live look | Unified look | Reason |
|---|---|---|---|---|
| All game pages and Nyx hub | Ordinary buttons | 34-38px heights, radii 5-10, different focus/disabled coverage | 38px shared control, radius 8, complete common states | Best existing achievement behavior plus refined gacha visual |
| All game pages and Nyx hub | Inputs/selects/search | Several heights, clipped vs rounded shapes, different placeholder/focus colors | 38px raised input, shared border, placeholder, and focus ring | Users learn one form language |
| All pages | Keyboard focus | Missing or inconsistent on some home, hex, icon, and feature controls | 2px moonlit-violet ring with clear offset | Preserve and complete keyboard reachability |
| All feature pages | Ordinary nested cards | Many subtly different dark fills, radii, and inset edges | Shared nested-card and raised-panel tiers | Reduce cards-inside-cards noise without changing layout |
| All feature pages | Status badges | Radius 4-999 and inconsistent state colors | Compact badge for ordinary state; pill only for high-salience state | Clearer hierarchy |
| Six game/hub shells | Boot/backdrop chrome | Same inline block copied six times | Same rendering from shared CSS | No intended visual change; removes future drift |
| Home/index | Page chrome | Standalone hardcoded palette and missing banner focus state | Same circles/art/layout, shared palette/type/radius/shadow tokens, visible focus | Join the visual system without redesigning the selector |
| Pull overview | Whole module | Twenty static inline style objects and bespoke cards/type | Shared section title, card, text, badge, and spacing classes | Largest authored static outlier |
| Gacha tracker | Tabs, inputs, panels, close | Most polished but locally named | Becomes canonical shared source | Use the best existing variant |
| Timeline | Toolbar controls | 33-34px compact controls and local radii | 38px shared controls; schedule geometry unchanged | Readability and consistency |
| Materials | Search/filter/action controls, close | Multiple local shapes and a separate close style | Shared input/control/icon contract; rarity/art frames unchanged | Ordinary controls should match tracker/database |
| Database/library/calendar | Filters, tabs, popouts | Similar purposes with different borders/radii/glows | Shared controls/panels and semantic layers | One learned interaction language |
| Achievements | Dark tracker controls | Complete behavior but its own values | Serves the shared behavior contract | Best current accessible variant |
| Achievement paper ledger | Paper/card treatment | Light paper-style detail surface | Preserved as `ledger-paper` semantic theme | Intentional content metaphor, not accidental drift |

## Judgment calls

1. The user's steer overrides the handoff's generic `origin/main` baseline instruction. The branch starts at the exact live commit. `origin/main` is one scheduled data-refresh commit ahead and is not part of this presentation branch.
2. The handoff's React 18/UMD line is stale. Repository instructions and live code show React 19.2.7 bundled by esbuild. The build stays unchanged.
3. Six game pages have no real style drift now. Their identical block is centralized instead of pretending they need six separate reconciliations.
4. The home page's circular selector is a signature structure, not an outlier to flatten into rectangular cards.
5. Dynamic inline geometry remains inline. Converting timeline coordinates or art crop transforms into classes would hide behavior and add risk without improving the design system.
6. The paper achievement ledger, game rarity colors, and user marker colors remain meaningful exceptions, but their surrounding chrome uses the shared system.
7. Ordinary controls use the achievement behavior contract and gacha visual contract because together they are the most complete, polished existing option.
8. Mobile receives baseline fit/reachability and no obvious breakage; this pass does not restructure the fixed-stage architecture or overbuild a future mobile app surface.

## Per-commit verification

After each implementation commit, from `Site`:

```powershell
npm run build
npm run test:favourites
npm run test:runtime-publisher
npm run test:custom-timers
npm run test:timeline
npm run test:calendar
npm run test:characters
npm run test:database-ui
npm run test:library
npm run test:library-annotations
npm run test:achievements
npm run test:achievement-extractor
npm run test:achievement-hoyolab
```

Because the branch is deliberately pinned to the live commit while local source data is newer, `npm run build` may regenerate tracked data/report files. Only build-created files outside this presentation scope may be restored, after exact path and content/diff verification. No unrelated change is discarded.

## Final gate

1. Run the external Nyx verification script in full mode against this worktree.
2. Run scraper tests and strict validation from `Scraper`.
3. Run `npm run build:deploy` and `npm run smoke:deploy` from `Site`; inspect and do not commit `.deploy`.
4. Serve the local deploy artifact and check `/`, `/nyx`, `/genshin`, `/hsr`, `/zzz`, `/wuwa`, and `/endfield`.
5. At `390x844`, `1600x900`, and `2560x1080`, verify non-blank primary UI, no horizontal overflow, no clipped/overlapping controls, readable labels, modal fit, keyboard focus, hover/disabled states, scroll behavior, and no console errors.
6. Save the matching 21 after-screenshots under `C:\Pengo\AI\.agents\handoffs\evidence\ui-unification\after\`.
7. Send the complete diff and evidence to an independent reviewer; fix every material finding.
8. Update `nyx-0079` to `done` and write the durable user handoff with commits, actual command results, evidence paths, risks, adoption, and discard instructions.

No production deploy, PR, merge, push, dependency addition, UMD script, data/worker/scraper change, or frozen legacy change is authorized.
