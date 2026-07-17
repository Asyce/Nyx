# Nyx UI Unification Audit

Date: 2026-07-15  
Queue task: `nyx-0079`  
Baseline: live production commit `856c8ee90f5c43ee2e025eb03da7599d9a59123e`  
Branch/worktree: `codex/ui-unification` at `C:\Pengo\.worktrees\ui-unification`

## Outcome

Nyx already has a recognizable visual core: an abyss-black canvas, violet ledgers, pearl text, the living eye, orbit medallions, GI display type, and HSR utility type. The inconsistency is not six different game shells. Those shells are currently byte-identical. The drift is inside features: 100+ button/state variants, hundreds of one-off card surfaces, 71 font sizes, 34 radii, 291 box-shadow recipes, and a standalone home page that does not consume the shared styling layer.

The safe unification path is therefore to preserve the live shell and artwork, centralize its existing values as tokens, give ordinary controls and surfaces one shared contract, then keep only meaningful exceptions such as the home-page circles, rarity frames, positioned timeline bands, and achievement paper ledger.

## Scope and method

The audit read:

- `Site/src/styles/game-page-shared.css`
- all seven `Site/pages/*.html` files
- all 43 `Site/src/**/*.{js,jsx,mjs}` files, with 25 authored source files separated from 18 generated/data files
- React inline `style` props, direct style mutations, custom-property writes, class-driven variants, and stylesheet injection patterns

Counts below are static literal occurrences. The six duplicated game-page style blocks are counted six times where noted. Generated game data is excluded from token recommendations because its colors describe game content, not Nyx chrome.

## Styling surfaces

| Surface | Evidence | Finding |
|---|---:|---|
| Shared stylesheet | 7,200 lines; 439,111 bytes; 14,229 declarations; 3,410 rule blocks | It is the visual source for the app, but later feature sections repeatedly redefine controls and surfaces. |
| Unique selectors | 2,772 | 427 exact selectors are redefined, adding 638 later definitions. Achievements reach nine definitions; some gacha selectors reach five. |
| Six game HTML pages | 45-line / 4,009-character style block each; 94 declarations each | `endfield`, `genshin`, `hsr`, `nyx`, `wuwa`, and `zzz` are byte-identical (hash prefix `109E982F4B4E`). This is duplication, not per-page drift. |
| Home page | 235-line / 14,829-character inline block; 398 declarations | `index.html` is a genuine special layout and does not load the shared stylesheet. Its chrome should consume shared tokens while its circular game cards remain unique. |
| React inline styles | 120 props | Most timeline/material styles are data-driven geometry. Static layout and visual styling is concentrated in `pulls-overview.jsx`, shared components, and a few app wrappers. |
| Runtime style injection | none | No injected stylesheet, `insertRule`, adopted stylesheet, or `cssText` path exists. Runtime writes are limited to element geometry/state and custom properties. |

## Color inventory

Across the shared CSS and seven page style blocks there are 3,134 valid numeric color occurrences and 1,327 exact hex/RGB(A) values across 800 RGB families.

| Use | Occurrences | Exact variants | Notes |
|---|---:|---:|---|
| Text | 1,027 | 404 | Many near-white and lavender values represent the same three text tiers. |
| Backgrounds/gradients | 1,170 | 664 | Most are slight variations on abyss, violet surface, and accent glow. |
| Borders/outlines/shadows | 840 | 318 | Bright-violet borders alone use dozens of alpha steps. |
| Other visual color | 180 | 82 | Includes masks, scrollbars, and decorative details. |

Dominant existing families:

| Existing family | Uses | Existing variants | Canonical role |
|---|---:|---:|---|
| Bright violet `#b7aaff` | 422 | 47 alpha levels | Bright accent, keyboard focus, strong edge |
| White | 270 | several near-white spellings | Maximum contrast only |
| Brand violet `#8b7bff` | 214 | about 43 alpha levels | Brand accent and selected state |
| Black | 184 | many opacity levels | Scrim and elevation |
| Canvas `#05040b` | 64 | small near-black family | Page canvas |
| Vivid violet `#7c35ff` | 62 | feature-specific | Decorative/rare accent, not ordinary controls |
| Muted lavender `#a99fd6` | 40 | near-duplicates nearby | Secondary text |
| Heading pearl `#efeaff` | 36 | near-whites nearby | Heading text |
| Faint lavender `#8d82bd` | 28 | near-duplicates nearby | Muted labels |

### Canonical existing palette

These values already form the `.gp` root at `game-page-shared.css:24-32` and agree with the home page. No new aesthetic is needed.

| Token role | Existing value | Source/use |
|---|---|---|
| Canvas | `#05040b` | `.gp`, page background |
| Surface 1 | `#0c0922` | primary dark panel |
| Surface 2 | `#191333` | raised/control surface |
| Nested translucent surface | `rgba(10,7,23,.68)` | refined gacha nested surfaces around line 4120 |
| Brand | `#8b7bff` | existing `--accent` |
| Bright/focus | `#b7aaff` | existing `--accent-bright` |
| Main text | `#f3f0ff` | existing `--tx` |
| Heading | `#efeaff` | established section headings |
| Secondary text | `#a99fd6` | most-used muted lavender |
| Soft text | `#cfc6f5` | existing soft detail copy |
| Faint text | `#8d82bd` | quiet labels |
| Success | `#79d8b8` | existing state color around lines 4118-4119 |
| Danger | `#de7892` | existing state color around lines 4118-4119 |
| Warning | `#e6b450` | existing notice color around lines 310-317 |
| Info | `#57cbff` | existing timeline/info color around line 3874 |

The current border opacity ladder contains at least `.10`, `.12`, `.13`, `.14`, `.16`, `.18`, `.20`, `.22`, `.25`, `.28`, `.30`, `.35`, `.40`, `.45`, `.50`, and `.60`. Ordinary chrome can use the existing `.10`, `.14`, `.18`, `.22`, and `.35` steps; stronger values remain for focus and selected states.

## Typography inventory

| Category | Inventory | Canonical existing choice |
|---|---|---|
| Font families | 261 declarations, 17 exact variants | GI for display/section titles; HSR + Segoe UI/system fallback for interface/body; Cascadia/ui-monospace for codes/data. |
| Font sizes | 734 declarations, 71 exact variants | `9` caption, `10` label, `12` small body, `14` body, `16` lead, `22` section, `30` page title; `40/50` only for true display. |
| Weights | 185 declarations, 8 variants | Keep `400`, `600`, `700`, `800`, `900`; collapse isolated `500`, `750`, and `850`. |
| Letter spacing | 26 values | Keep `0`, `.04em`, `.08em`, `.10em`, `.12em`, `.14em`, `.16em`; preserve `.3em` only for the established kicker. |

Most-used font sizes are `10px` (103), `9px` (78), `11px` (71), `12px` (69), `10.5px` (54), `13px` (35), `8px` (34), and `14px` (30). This density is intentional, but the number of one-off half steps is not.

The canonical section heading is the live `.gp-sec .t` treatment at `game-page-shared.css:70-76`: GI display type, 22px, pearl text, restrained violet glow, and a reading rule.

## Buttons and interactive controls

The authored markup contains 240 buttons, 65 inputs, 16 selects, and 2 textareas. CSS heuristics find at least 106 literal button/state class tokens, 77 unclassed buttons, 211 clickable declaration blocks, and 47 base input blocks.

| Variant | Existing source | Decision |
|---|---|---|
| Behavior contract | Achievement controls, `game-page-shared.css:6645-6647,6673-6676` | Canonical minimum size, hover, `:focus-visible`, active, and disabled behavior. This is the most complete accessible contract. |
| Branded hero/navigation CTA | `.gp-hex`, lines 79-104 | Preserve for major branded actions only; add the missing visible focus state. |
| Standard primary/secondary control | Refined gacha controls, lines 4135-4145 | Canonical translucent violet control surface and bright hover, combined with the achievement behavior contract. |
| Segmented tabs | Final `.gt-mode-tabs`, lines 4380-4405 | Canonical grouped tabs: dark group, radius 9, selected gradient/glow. |
| Icon/close button | `.gt-x`, lines 4108-4114 | Canonical 34px icon control; migrate materials and timeline close buttons. |
| Search/input | Achievement focus contract plus the calmer gacha/timeline surface | One shared height, radius, border, placeholder, and focus state. The clipped `.gp-search` and rounded `.cm-search` are visual duplicates today. |

Interactive timeline blocks, game cards, rarity tiles, and artwork pickers are not ordinary buttons. They keep their structural form while inheriting the shared focus and disabled rules.

## Containers, cards, and badges

There are 684 rules that combine a surface with border/radius/shadow/padding, producing 623 unique signatures. Nearly every card is bespoke.

| Pattern | Existing source | Canonical use |
|---|---|---|
| Raised panel/modal | `.gt-panel`, lines 4098-4102 | Radius 14, dark gradient, violet inset edge, elevated shadow. |
| Nested card | `.gt-panel-box`, lines 4176-4182 | Radius 9, 12px internal padding, subtle inset edge. |
| Interactive card | `.gt-limited-card`, lines 4207-4218 | Radius 8, dark translucent surface, clear hover lift. |
| Compact badge | Final gacha status badges, lines 4262-4276 | Small radius, low-alpha fill/edge, semantic state modifiers. |
| Pill state | Gacha hero state, lines 4544-4550 | Reserved for short high-salience status. |
| Full notice | `.gp-banner-fresh`, lines 307-317 | Reserved for source-health and full-width notices. |

The achievement light paper palette around lines 6914-7050 is a deliberate ledger mode. It should become a semantic `ledger-paper` theme rather than the global default.

## Spacing, radii, shadows, and layers

| Category | Inventory | Canonical existing scale |
|---|---|---|
| Spacing | 2,372 scalar uses, 71 values | `2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32px` |
| Radii | 580 uses, 34 values | `5px` small, `8px` control, `10px` card, `14px` panel/modal, `999px` pill, `50%` circle |
| Box shadows | 540 uses, 291 exact variants | subtle/strong inset edge, interactive lift, panel elevation, modal elevation, accent glow |
| Text shadows | 50 uses, 37 variants | display glow only; ordinary text should be unshadowed |
| Filter recipes | 121 uses, 89 variants | preserve artwork/brand exceptions; converge ordinary control glows |
| z-index | 183 uses, 32 values | semantic base, content, sticky, popover, modal, tooltip layers |

Existing shadow candidates:

- subtle edge: `inset 0 0 0 1px rgba(183,170,255,.14)`
- strong edge: the same bright-violet family at `.22`
- active edge: the same family at `.35`
- interactive lift: `0 10px 26px rgba(0,0,0,.24)` (`game-page-shared.css:4217`)
- modal: `0 18px 45px rgba(0,0,0,.45)` (around line 6648)
- panel: `0 22px 58px rgba(0,0,0,.48)` (around line 4102)
- accent: `0 0 14px var(--accent-glow)` (line 4405)

## HTML page drift

| Page | Inline style result | Migration |
|---|---|---|
| `genshin.html` | Identical to the other five game/hub shells | Remove common block; shared shell CSS owns it. |
| `hsr.html` | Identical | Same. |
| `zzz.html` | Identical | Same. |
| `wuwa.html` | Identical | Same. |
| `endfield.html` | Identical | Same. |
| `nyx.html` | Identical | Same. |
| `index.html` | Unique circular selector layout and standalone chrome | Move page layout to `index-page.css`; consume shared tokens; keep circular structure. |

The six shells also repeat the same six stage-size style mutations. They are functional stage geometry and should remain until the fixed 1600x900 stage architecture is replaced by a separate layout project.

## JSX inline-style inventory

| File | Props | Classification/action |
|---|---:|---|
| `features/timeline/timeline-view.jsx` | 42 | Mostly live positions, widths, lane heights, marker colors, and art. Keep dynamic geometry; tokenize chrome. |
| `features/gacha/pulls-overview.jsx` | 20 | Highest-priority static outlier. Convert the full layout to classes and shared tokens. |
| `app/nyx-app.jsx` | 19 | Class repeated flex wrappers and `GPSec` sizing; keep art, progress, popover position, item rarity, and root geometry. Replace the hardcoded `--el:#9a72e8`. |
| `features/materials/char-materials.jsx` | 16 | Mostly rarity/art/transform/object-position custom values. Class the close-button hide state and tokenize visual fallbacks. |
| `components/game-page-components.jsx` | 12 | Class static flex/gap wrappers; keep public style passthrough, card geometry, and art position. |
| `features/gacha/gacha-tracker.jsx` | 7 | Keep pity/art geometry; class hidden file input and inline close state. |
| `features/achievements/achievement-view.jsx` | 4 | Dynamic progress values only; retain. |

`features/timeline/custom-timer-storage.js` stores a default user marker color. That is persisted user data used by a color input, not site chrome, so it remains a literal data value.

## Existing custom properties

The shared stylesheet defines 94 custom properties across 56 names and uses `var()` 429 times. It already points toward a token system, but the properties are local feature islands. Twelve definitions appear unused: `--ach-muted`, `--ach-nav`, `--ach-nav-2`, `--ach-panel`, `--ach-panel-2`, `--ach-panel-3`, `--gt-gold-soft`, `--gt-muted`, `--gt-panel-line-strong`, `--gt-text`, `--panel`, and `--panel2`. Their removal or aliasing must be verified after migration rather than assumed safe.

## Canonical shortlist

| Category | Canonical candidate | Reason |
|---|---|---|
| Palette | Existing `.gp` root plus existing success/danger/warning/info colors | Already shared by the live shell and home page; no rebranding. |
| Typography | `.gp` HSR UI + `.gp-sec` GI display + existing monospace | The established Nyx pairing; keeps game-tool readability and identity. |
| Control behavior | Achievement state/focus contract | Most complete keyboard, hover, active, and disabled treatment. |
| Control visual | Refined gacha primary/secondary controls | Most polished existing ordinary control, without spending the branded hex treatment everywhere. |
| Panels/cards | Refined gacha raised/nested/interactive hierarchy | Clear three-level depth system already live. |
| Spacing/radii | Existing majority scales above | Collapses nearby values without inventing a new rhythm. |
| Signature | Living eye, orbit medallions, left rail, ledger section rule | Nyx-specific identity; prevents a generic dashboard result. |

## Baseline evidence

Live production screenshots are stored outside the branch so the branch can be discarded independently:

`C:\Pengo\AI\.agents\handoffs\evidence\ui-unification\before\`

The folder contains 21 viewport screenshots: index, Nyx hub, and five game pages at `390x844`, `1600x900`, and `2560x1080`. All routes returned their expected title and non-empty primary UI. The live marker was verified from `https://pengo.gg/version.json` before capture.

## Audit exclusions and constraints

- Generated data, game-content `<color=#...>` markup, rarity/element data palettes, and persisted user marker colors are semantic data, not Nyx design chrome.
- Dynamic timeline coordinates, art URLs, progress widths, crop transforms, and measured popover positions remain inline because they express runtime geometry, not reusable styling.
- No UMD scripts, dependency changes, data/scraper/worker edits, production deploy, or legacy-prototype work belongs in this branch.
