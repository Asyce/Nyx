# UI Changes Plan — 2026-07-09 (from "UI Changes Proposal.docx")

Status: EXPANDING — workstreams A–K approved and self-reviewed 2026-07-09 (Codex
review waived); workstreams L–P added 2026-07-10 (favourites/Characters tab,
banner timeline, events pipeline, kit profile stats, birthday calendar). Pending:
user confirms scope is complete → final self-review pass over L–P → mark FINAL.
Do not start implementation until the plan is marked final.
Source: user proposal doc (12 items, workstreams A–G) + scope additions H–P from
follow-up sessions 2026-07-09/10. All items grounded against HEAD (branch `main`).
Reviewed: self-review of A–K 2026-07-09; full-plan review of A–P 2026-07-10
(5 findings fixed inline, marked "review finding" / decision-wording updates).

Shared context: every game page renders materials through
`Site/src/features/materials/char-materials.jsx` (one component, per-game `CM_CFG`
from generated `Site/src/data/generated/cm-data-*.js`), styled by
`Site/src/styles/game-page-shared.css`. The app shell / database / TCG / Pot / Beta
tabs live in `Site/src/app/nyx-app.jsx`. Generated data comes from
`Site/tools/generate-site-data.mjs` (regen required for data-side changes).
So "apply across all games" (item 4) is mostly free: fix the shared component once,
then verify per game (gi, hsr, zzz, wuwa, ae).

## Workstream A — Materials layout polish (items 1, 2, 3, 4)

**A1. Talents section spacing (item 1)**
- Cause: `.cm-mrow{ grid-template-columns:minmax(108px, 176px) 1fr; }`
  (game-page-shared.css:5440) reserves up to 176px for the material token column;
  with one token this leaves dead space before the character grid.
- Fix: shrink the token column to content (`grid-template-columns:auto 1fr` with a
  `max-width` on `.cm-mtokens`, or a smaller minmax), and re-check `gap`.
- Verify on: GI talent domains (`cm-domain-row`), HSR/ZZZ/WuWa `midGroups` rows,
  multi-token rows (regions with 2–3 materials), compact/mobile breakpoint
  (css:5572 already collapses to one column — keep that).

**A2. Remove redundant day labels (item 2)**
- Cause: not in the data — the UI re-prints the selected day per domain block:
  char-materials.jsx:2845 `<span className="sub">{qq ? 'search results' : day === 6 ? 'Sunday - all books' : CM_DAYS[day]}</span>`.
  The day is already selected in the `.cm-days` picker above (char-materials.jsx:2802).
- Fix: drop the plain day name from each block header, and drop `Sunday - all books`
  too (user decision 2026-07-09). Keep only the `search results` label (it explains
  why blocks ignore the selected day).

**A3. Trounce Domain layout (item 3)**
- Cause: game-page-shared.css:5478 `.cm-trounce-grid .cm-brow{ grid-template-columns:1fr; }`
  forces the item token onto its own row with characters below, inside the GI
  weekly-boss 2-column grid (`.cm-trounce-grid`, css:5477).
- Fix: put characters beside the item: `grid-template-columns:auto 1fr` (token
  column back to `flex-direction:column`-friendly sizing). Then reassess the outer
  2-column grid — side-by-side rows are wider, so the outer grid may need to drop
  to 1 column on narrower widths (media query) or entirely; decide by look.
- Other games' weekly bosses (HSR Echo of War, ZZZ Notorious Hunt, WuWa) use the
  default `.cm-brow` two-column path already — only GI (`cfg.weeklyBosses`) is affected,
  but verify all boss tabs after the CSS change since `.cm-brow` is shared.

**A4. Cross-game application (item 4)** — no extra code; per-game visual verification
checklist is part of the gate (all 5 game pages, mats/mid/boss tabs, live + beta channel).

## Workstream B — ZZZ character icons (item 5)

- Cause: `Site/tools/generate-site-data.mjs:1054` `zzzAgentAvatarIcon()` maps every
  agent to `Nanoka/zzz/assets/items/CardDailyUse${id}.webp` (daily-use card art,
  not the agent icon) and takes priority at both use sites (lines ~1517 and ~2936)
  over `ch.assets.partnerIcon || ch.assets.icon`. Real icons exist:
  `Database/Nanoka/zzz/assets/agents/icons/IconRole*.webp` and
  `agents/partner-icons/IconRoleCircle*.webp`.
- Fix: prefer `assets.partnerIcon` (circle) / `assets.icon`, demote CardDailyUse to
  fallback-only (or remove). Remove/revisit the `iconZoom: 1.24` compensation if it
  was tuned for the card images. Check git blame first — if CardDailyUse was a
  deliberate earlier decision, note why before reverting.
- Regenerate `cm-data-zzz*.js` via the site data generator; confirm beta roster too.

## Workstream C — Numeric field editing (item 6)

- Where: material calculator inputs in char-materials.jsx (`type="number"` at ~3089
  level input, ~3156 talent inputs).
- Problems: clamp-on-every-keystroke mangles intermediate values (typing "1" then
  intending "7" can end at 10 via clamping/concat), no select-on-focus, no steppers.
- Fix: one shared `CMNumberInput` component:
  - focus/click → select all text;
  - while typing, hold the raw string in local state (allow empty), no clamping;
  - commit + clamp on blur / Enter; Escape reverts;
  - small −/+ stepper buttons beside the field (hold-to-repeat optional);
  - `inputMode="numeric"` retained for mobile.
- Use it for all level/talent/rank numeric fields in the calculator popup; check the
  wheel-handler (~1530) still cooperates.

## Workstream D — Character visuals (items 7, 8)

**D1. Default background = splash art (item 7)**
- Today: popup art = `view.customBackground || cmPopupArtFor(...)` (char-materials.jsx:2608);
  `cmPopupArtFor` prefers birthday/holiday art pools (GI/HSR), else `cmArtFor(view)`.
- Splash art defined per game (user-provided examples, all VERIFIED live and mapped
  to existing data fields 2026-07-10):
  - GI: `assets.gacha` (`UI_Gacha_AvatarImg_*.webp`) — already mirrored locally.
  - HSR: `assets.drawCard` (`draw-card/*.webp`) — already mirrored locally.
  - ZZZ: `assets.roleIcon` (`IconRole*.webp`) — already mirrored locally.
  - WuWa: the PixActivity full-body art (`T_ActivityRole*.webp`) — present in the
    raw data (extract the field; `assets.stand` half-body art is the fallback).
  - Endfield: `Splash` is already in the wiki scraper's Cargo field list.
  Generator: emit these as `art` per game; regen. Note the fallback chain `cmArtFor`
  = art → card → icon (char-materials.jsx:1254–1255) stays for entries that
  genuinely lack splash art.
- Custom override stays (prefs → `customBackground`).
- User decision 2026-07-09: stop the birthday/holiday art rotation on character pages —
  default is always the character's splash art. The ONLY place special/rotating art
  remains is the pinned favourite CARDS (Card mode) — wherever that component
  renders: originally the overview, after Workstream L1 the Characters tab (and the
  hub Characters tab). Implementation: restrict `cmSpecialArtPool`/`cmPopupArtFor`
  special-art usage to the favourites Card surface; the character visual page/popup
  uses splash art unless customized.

**D2. Custom visual preview (item 8)**
- Where: `NyxImageChoiceControl` (char-materials.jsx:1626) — thumbnail buttons apply
  instantly on click (`onPick(row.src)`); thumbnails are small and backgrounds are
  wide images crushed into small buttons.
- Fix: add a dedicated preview pane below the choice row: clicking a choice selects
  it into the preview (large, correct aspect: circle for icons, 16:9 for backgrounds)
  with an explicit "Apply" button; Reset/Upload flows unchanged. Same control serves
  both Icon and Background, so item 8's "apply to icons too" is automatic.

## Workstream E — Bare image detail views (item 9)

- TCG card detail: nyx-app.jsx ~1945–1990 (`tcg-detail-panel` / `tcg-detail-art`) wraps
  the card image in a panel with chrome. Change: remove ONLY the container box around
  the image — the image renders bare; all existing text/stats (name, HP, cost, skills)
  stay exactly as they are (user decision 2026-07-09).
- Serenitea Pot furniture detail: same treatment — nyx-app.jsx:2144–2199
  (`pot-detail-panel` / `pot-detail-art`); keep the effect/recipe/source text blocks.
- CSS: new lightweight rules in game-page-shared.css; make sure the image scales to
  viewport (max-height) instead of the old fixed panel size.

## Workstream F — Beta change tracking (items 10, 11)

**F1. Inspectable changes (item 10)** — the big one.
- Today the generator only labels entries `betaStatus: 'new' | 'changed'`
  (generate-site-data.mjs:4284) — no diff payload exists, so the UI cannot show what
  changed.
- Approach SIMPLIFIED after investigating the upstream site (2026-07-10): the data
  source's own beta payloads carry only changed/unchanged hash flags
  (`liveComparison` = two hashes — no old→new values), so even the source site can
  only diff client-side. We do the same — and we already ship both datasets:
  1. NO generator diff payload. The existing `betaStatus: 'changed'` flag
     (generate-site-data.mjs:4284, derived from the scraper's hash diffs) marks
     which entries are clickable. Zero payload growth.
  2. UI (`BetaDataPanel`, nyx-app.jsx:2258): clicking a changed card opens a modal
     that diffs the live record (already-loaded `CM_CFG`) against the beta record
     (beta pack) in the browser, over a bounded whitelist of fields (stats,
     materials, skills/talents text, rarity, name/title).
     Default view: full before/after side-by-side. "Compact" toggle: per-field
     change list ("Field: old → new"), long text collapses. (User decision
     2026-07-09.)
- Risks: live and beta records may differ in shape/formatting → normalize before
  comparing (trim, number rounding, array order) or the diff shows noise. Start
  with a small trusted field set and expand.

**F2. Click-through to character (item 11)**
- From a beta card, clicking the character opens their materials popup: switch the
  page to the mats tab with beta channel active and preselect the character
  (existing events: `nyx:cm-channel-changed`; add a select-character event or reuse
  the popout mechanism in char-materials.jsx). Weapons/light cones: no target page —
  characters only for now.

## Workstream G — Database item display (item 12)

- Today: `CollectionCard` (nyx-app.jsx:1729) renders art + name + up to 4 fields +
  text — dense and messy.
- Fix:
  1. Grid card → icon-first tile: icon on top, name below, nothing else.
  2. Card click → detail modal: name, icon, description/text, all `fields`, and
     type-specific extras (e.g. Bangboo skill sets). Audit generated db payloads for
     Bangboo skills — if the generator drops them, extend it (data change + regen).
  3. CSS: new `.db-card` tile + `.db-modal` styles in game-page-shared.css; keyboard
     accessible (Enter/Escape), same modal conventions as cm popup.

## Workstream H — Miliastra Wonderland (items 13: new scrape + section, added 2026-07-09)

- Source: the GI data site's `/beyond/` SPA. Confirmed live data endpoints (embedded
  as SvelteKit fetch payloads in the page HTML, same discovery pattern as
  `Site/tools/scrape-nanoka-furniture.mjs:106`):
  - `/beyond/` → `costume.json` (avatar costumes: name, rank, icon `UI_Beyd_*`,
    body, color, slot) + `lang_map.json` (canonical filter label map: slots, colors, …)
  - `/beyond/inventory` → `item.json` (~1,513 items: name, rank, icon, type)
  - `/beyond/set` → `costume_suit.json` (costume sets)
  - The static base is versioned (e.g. `…/gi/6.7.51/en/beyond/…`) — must be discovered
    from the page at scrape time, never hardcoded.
  - Icon URL pattern verified 2026-07-10: flat `static.nanoka.cc/assets/gi/<icon>.webp`
    (works for both `UI_Beyd_*` costume icons and `UI_ItemIcon_*` inventory icons).
- New scraper following the furniture/gcg pattern; output
  `Database/<renamed>/gi/beyond/{costumes,items,suits}.json` + localized icon assets
  (webp, like the existing icon-localize flow). NOTE: this batch runs AFTER the
  source-name full rename (Batch 7), so the scraper file, output folder, and all
  paths use the new neutral names from the start — do not create anything named
  after the source site.
- Automation: wire into `.github/workflows/side-data-sync.yml` (it already runs the
  TCG + furniture scrapers) and asset sync — fully scheduled, no manual steps.
- Generator: emit a `wonderland` payload for GI next to `tcg`/`furniture`
  (generate-site-data.mjs:4373–4374).
- UI: "Miliastra Wonderland" browser with filters driven by `lang_map.json`
  (slot, color, body type, rank; sets view; inventory view). Detail view = bare image
  per Workstream E. Lands under the Database tab per Workstream J.

## Workstream I — Database "Monsters" & "Items" sections (added 2026-07-09)

- Good news: the data already exists — the roster scraper ingests `monsters.json`
  and `items.json` per game (Scraper/nanoka/games/genshin.mjs:50–60 and equivalents
  for hsr/zzz/ww; generator already references monsters at generate-site-data.mjs:697–701).
  This is generator + UI work, not new scraping.
- Add Monsters and Items collections per game in `buildCollections()`
  (generate-site-data.mjs:3918) via the existing `normalizeNanokaItems` helper,
  keeping type/rarity/element fields for filtering.
- Filters: the db UI today has only search + collection tabs (nyx-app.jsx:1704–1726).
  Add filter chips per collection, driven by the fields present (e.g. item type,
  monster family, rarity).
- Payload risk: items can be thousands of entries × 4 games. Measure; if the main
  `nyx-data.js` bundle grows too much, split database collections into lazy-loaded
  per-game files (same on-demand pattern as the beta packs / `loadNyxCmBeta`).
- Endfield has no source on this site — Monsters/Items ship for gi/hsr/zzz/wuwa only.
- "Rip the entire page": inventory each game's scrape config vs what the source site
  exposes, and surface every sensible collection in the Database tab.

## Workstream J — Database restructure (added 2026-07-09)

- Always visible: remove the `showDatabase` gating (nyx-app.jsx:2318, default at
  2668, settings toggle at 3032–3034 — remove the toggle).
- Rename: "Database Library" → "Database" everywhere user-facing (nyx-app.jsx:1698,
  1707, nav labels, search placeholder).
- Move TCG, Serenitea Pot, and Miliastra Wonderland inside the Database tab as
  collections/sub-views (today they are separate GI nav sections appended at
  nyx-app.jsx:2355). Update tab lists / deep links (nyx-app.jsx:2627) so old
  `#tcg` / `#pot` routes still land correctly (redirect into Database).
- Route-name collision (found in self-review): the database tab's internal key/label
  is `library` (nyx-app.jsx:2622, 2627–2628), which clashes with the new "The Library"
  page (Workstream K). Resolution: database tab key becomes `database` with old
  `library` hashes redirecting to it; The Library page gets its own distinct key
  (e.g. `books`), so no old bookmark changes meaning silently.
- No source-site mention anywhere — FULL RENAME (user decision 2026-07-09):
  - UI text: scrubber already strips source names from descriptions
    (char-materials.jsx:624); fix the tooltip at char-materials.jsx:2822 and audit
    all db/beta UI strings + collection source labels.
  - Rename `Database/Nanoka/` to a neutral name (proposal: `Database/GameData/`) and
    update every reference: scraper output root (Scraper/nanoka/lib config),
    generator paths (generate-site-data.mjs, dozens of refs), hardcoded UI asset
    paths (nyx-app.jsx:349–352, char-materials.jsx:63–64), then regenerate all
    cm-data files so shipped URLs change too.
  - Rename repo-facing names: `Scraper/nanoka/` dir, `Site/tools/scrape-nanoka-*.mjs`,
    `localize-nanoka-icons.mjs`, `.github/workflows/nanoka-asset-sync.yml` (and its
    workflow name/commit messages).
  - Unavoidable remainder: the actual source URLs (gi.nanoka.cc / static.nanoka.cc)
    must stay inside scraper source code — that's where the data comes from. They
    never reach the browser.
  - Risk: this is a repo-wide rename touching the deploy asset tree — do it as its
    own isolated batch with a full build + smoke test, nothing else mixed in.

## Workstream K — "The Library" page: readable books (added 2026-07-09)

- New top-level page (NOT part of the Database tab) called "The Library",
  for GI and HSR only.
- Sources (fandom wikis, via the MediaWiki API — pattern exists in
  `Scraper/wiki-titles/` and `Site/tools/scrape-character-fandom-metadata.mjs`):
  - GI: `genshin-impact.fandom.com/wiki/Book` → all book collections + their volumes.
  - HSR: `honkai-star-rail.fandom.com/wiki/Readable` → all readables.
- Per entry: icon (scraped from the individual wiki page), name, and full readable
  text (the entry's own page content, cleaned to our styling).
- Storage: `Database/Library/{gi,hsr}/` — index json + per-book content json + icons.
- Payload: book texts are long; keep them OUT of the main bundle — index loads with
  the page, per-book content lazy-loads on open (same pattern as beta packs).
- UI: "The Library" is a tab in the GI and HSR game-page menus (user decision
  2026-07-09), next to the existing sections: grid of icon+name tiles → reader view
  (volume selector for multi-volume books, clean typography). Other games don't get
  the section. Distinct route key (`books`) to avoid the old `library` hash.
- Automation: add to the scheduled side-data sync.
- No user-facing attribution (user decision 2026-07-09 — content is in-game text).
  Source URLs stay inside the scraper data for maintenance purposes only.

## Workstream L — Favourites & Characters tab (items 14–16, added 2026-07-10)

**L1. Move pinned favourites; rename tab (item 14)**
- The `Favourites` component (nyx-app.jsx:1150–1395, rendered on game overview at
  2406) moves from the game Overview to the top of the Character Materials tab.
- Rename that tab "Character Materials" → "Characters" everywhere user-facing:
  `cfg.fns` arrays (nyx-app.jsx:369–425), the tab label map (nyx-app.jsx:2622),
  section labels. Internal route key `mats` stays (old links keep working).
- The "back returns to overview favourites" behavior (nyx-app.jsx:3470) must be
  retargeted to the Characters tab.
- Hub (user decision 2026-07-10): the hub's cross-game Favourites block
  (nyx-app.jsx:2491) moves OFF the hub overview into a NEW hub tab "Characters",
  placed directly below Overview in the hub nav (hub tab list at nyx-app.jsx:2628
  gains `characters` after `overview`).
- Hover glow: character icons (roster cells + favourites in icon mode) get a
  hover glow/highlight — CSS on the cell using the element accent color already
  available as `--el`; keyboard focus gets the same treatment (focus-visible).
- The splash-art exception from decision 2 (overview pinned favourite cards keep
  special art) travels with the component: Card mode keeps special art.

**L2. Favourites display modes (item 15)**
- Toggle in the Favourites header: **Card** (current rich pinned-card look) |
  **Icon** (same compact icon cell as the roster grid).
- Per-game persisted preference (localStorage, alongside the existing pinned
  storage `nyx:pinned-favourites:<game>:v1`).
- Pin cap (user decision 2026-07-10): Icon mode has NO practical limit; Card mode
  keeps the current cap (`isFull` behavior, nyx-app.jsx:1382). If pins exceed the
  card cap while in Card mode, show the first N cards + a "+X more" chip that
  switches to Icon mode.

**L3. Star/favourite on every character icon (item 16)**
- Every roster character cell gets a small star in the top-right corner:
  filled = pinned, empty = not. Click toggles without opening the character.
- Unfavourite shows a confirmation popup with a checkbox
  "Don't show this again" offering **for 24h** / **forever** (stored in
  localStorage with expiry timestamp; forever = no expiry).
- Cross-file wiring (review finding): the star renders inside the roster cells
  (char-materials.jsx `renderCell`) but the pinned store + Favourites component live
  in nyx-app.jsx. There is NO existing pinned-changed event — add one
  (`nyx:pinned-changed`, dispatched by a shared load/save helper both files import;
  same bundle, so a small shared module is enough). Star and Favourites block both
  re-render on it.
- Star must not fight the drag-to-pin flow (nyx-app.jsx:1201) or the cell's
  click-to-open — stopPropagation like the existing Unpin button (1185–1186).

## Workstream M — Banner Timeline (items 17–19, added 2026-07-10)

Replaces the current banner display on each game page. This is the reason
favourites move out of the Overview (L1): the timeline takes that space.

### Data

- **Now/next/upcoming:** already scraped 6-hourly — `Database/Banners/banners.json`
  has `current` / `next` / `upcoming` per game with featured characters + icons and
  end timestamps (source: game8), plus freshness state the UI already understands
  (nyx-app.jsx:466–488).
- **History:** `Database/BannerHistory/gi.json` — 102 entries back to GI 1.0 with
  `{type, version, name, start, end, featured5[], featured4[]}` (Scraper/banner-history/gi.mjs).
  HSR/ZZZ/WuWa have NO history yet → new history scrapers per game
  (`Scraper/banner-history/{hsr,zzz,wuwa}.mjs`, wiki/game8 sources), normalized to
  the same schema. "As far back as we can provide" = GI complete on day one; other
  games fill in as their scrapers land (timeline renders whatever exists).
- Featured slugs resolve to roster icons/names via existing roster data.
- Payload: history stays OUT of the main bundle — lazy-load per game when the user
  first scrolls into the past or searches (same on-demand pattern as beta packs).
- Automation: history refresh joins the scheduled data workflows (weekly is enough;
  the 6-hourly current-banner scrape already exists).

### Function

- **Axis:** horizontal time axis, one per game page. A vertical "now" line sits at
  the viewport's golden-ratio point by default, current banners straddling it,
  next/upcoming to the right, history stretching left.
- **Lanes (rows):**
  1. Character banners (splits into parallel sub-lanes when runs overlap, e.g.
     double banners/phases),
  2. Weapon banners,
  3. Activities (Workstream M3),
  4. Custom markers (Workstream M2).
  Lane toggles in the toolbar show/hide each lane.
- **Blocks:** each banner run is a block spanning start→end showing at minimum the
  featured character icon(s) + name (item requirement), rarity-colored edge.
  Current run: live countdown chip + subtle pulse. Past: slightly desaturated.
  Upcoming without confirmed dates: dashed border + "Expected" tag, positioned at
  the estimated patch window (patch length inferred from history; clearly marked
  unconfirmed — same honesty rule as the existing freshness notes). Hovering an
  "Expected" block shows a tooltip along the lines of "Educated guess — dates not
  officially confirmed yet" (user decision 2026-07-10).
- **Navigation:** drag / wheel to pan; ctrl+wheel or +/- buttons to zoom
  (levels ~ week ↔ phase ↔ patch ↔ year); "Today" button recenters; version
  ribbons ("5.7", "6.0") run along the top edge as a secondary scale; date-jump
  picker.
- **Search (item requirement):** toolbar search matches featured character (and
  weapon) names across the full history: matching blocks stay lit while the rest
  dims, plus a compact result list ("Venti — 6 runs") whose entries scroll the
  timeline to that run (prev/next rerun arrows on the highlight).
- **Click a block** → detail card: full featured 5★/4★ lists with icons, exact
  dates + duration, version, and a link to the character's page. (Bare-image rule
  from Workstream E applies to any art shown.)
- **Clock/timezone:** reuse the existing server-region reset setting and 1s shared
  clock (nyx-app.jsx:506) for countdowns; block edges align to server timestamps.
- **Performance:** virtualize — only blocks within viewport ± buffer render; history
  lazy-loads; the shared 1s clock only drives the visible countdown chips.
- **Mobile:** horizontal touch-pan works as-is; compact density; per project policy,
  don't over-polish mobile.

### Look

- Full-width panel on the game Overview where favourites used to sit; game accent
  color drives the now-line, version ribbons, and current-block glow; dark theme
  consistent with the existing card language (rounded blocks, soft borders).
- Toolbar (one row): search field · lane toggles · zoom −/+ · Today · add-marker.
- Density: blocks ~48–56px tall so a character icon + name fit; lanes stack
  compactly; empty lanes collapse.

### M2 — Custom time markers (item 18)

- "Add marker" in the timeline toolbar. Form fields (kept reasonable):
  - label (short text), color pick,
  - type: **exact moment** (point pin) | **range** (start + end) | **recurring**
    (daily / weekly / every N days / semi-monthly (1st+16th) / monthly, with
    optional server-reset alignment at 04:00 like the built-in cycles),
  - optional end date for recurrences.
- Renders in the Custom lane: points as pins, ranges as blocks, recurrences as
  repeating ghosts; each marker individually toggleable, edit/delete on click.
- Storage: extend the existing custom-timer store
  (`nyx:custom-reset-timers:<game>:v1`, nyx-app.jsx:912–929, already has
  label/target/recur sanitizing) rather than inventing a second store — the
  existing Timers card and the timeline read the same data.

### M3 — Game activities on the timeline (item 19)

- Recurring in-game cycles rendered as spans in the Activities lane, computed from
  cycle rules — the semi-monthly/monthly/weekly reset math already exists
  (nyx-app.jsx:855–899, resetTimerRows: Abyss, Imaginarium, weekly, daily).
- Per-game activity sets (initial): GI Spiral Abyss + Imaginarium Theater;
  HSR Memory of Chaos + Pure Fiction + Apocalyptic Shadow; ZZZ Shiyu Defense +
  Deadly Assault; WuWa Tower of Adversity cycles. Cadences encoded as rules (all
  are fixed-period resets), each toggleable; dated event scraping can layer in
  later without changing the timeline.
- Activities render past + future occurrences generated on the fly from the rules —
  no stored data needed for cycles.

### M4 — Hub cross-game timelines (user decision 2026-07-10)

- The hub's "Banners" tab becomes a cross-game version of the banner timeline
  (all games' banner lanes stacked, same component parameterized).
- A second hub view does the same for EVENTS across all games (see Workstream N).
- Ship after the per-game timeline is proven (sequenced last).

## Workstream N — Events pipeline + events on the timeline (added 2026-07-10)

The timeline must also show in-game events (login events, challenge events, web
events, etc.). Source strategy adapted from the user's research doc
("gacha_event_sources_scraping_plan.docx"), verified 2026-07-10:

### Sources (verified status)

- **Truth layer — official announcement JSON (VERIFIED END-TO-END 2026-07-10).**
  The research doc's `*-api-os.hoyoverse.com` hosts 504 everywhere — the working
  hosts are the `sg-` ones. Confirmed live with real announcement data + exact
  start/end times:
  - GI: `sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnList`
    `?game=hk4e&game_biz=hk4e_global&lang=en&bundle_id=hk4e_global&channel_id=1&level=55&platform=pc&region=os_euro&uid=700000000` → 28 announcements.
  - HSR: `sg-hkrpg-api.hoyoverse.com/common/hkrpg_global/announcement/api/getAnnList`
    with `bundle_id=hkrpg_global` (NOT `hkrpg_os` — that returns an empty list with
    retcode 0, a silent trap) → 10 announcements.
  - ZZZ: `sg-announcement-api.hoyoverse.com/common/nap_global/announcement/api/getAnnList`
    `?game=nap&game_biz=nap_global&bundle_id=nap_global&region=prod_gf_eu…` → 15.
  - `getAnnContent` on the same hosts for notice bodies. Still unsupported
    infrastructure: retry with backoff, cache, poll gently (6-hour cadence), treat
    shapes as changeable, and alert (needs_review) if retcode ≠ 0 or the list is
    unexpectedly empty.
- **Truth layer — WuWa (verified 2026-07-10):** the official site serves its whole
  news/notice feed as JSON —
  `hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en/ArticleMenu.json`
  (verified 200; 644 articles: id, title, type, timestamps, cover). Use it for
  detection/titles/links. Caveat: article BODIES are embedded external docs
  (Feishu), not parseable HTML — so event dates come from:
  1. the in-game notice endpoints (`aki-game.net` — unreachable from a local
     machine, likely geo/CDN-gated; probe from the GitHub Actions runner at
     implementation time), else
  2. the WuWa fandom wiki event pages (structured date tables; we already run
     fandom scrapers), diffed against Game8.
- **Truth layer — Endfield (verified 2026-07-10):** the official news site embeds
  the full article list as structured data in the page payload (id `cid`, `tab`
  news|notices, title, epoch `displayTime`, cover, brief — verified), and article
  pages embed their full text the same way. Deterministic parse of
  `endfield.gryphline.com/en-us/news` + per-article pages; no separate API needed.
  Event/banner durations are stated in notice bodies.
- **Convenience/diff layer (verified):**
  - paimon.moe timeline data is OPEN SOURCE on GitHub
    (`MadeBaruna/paimon-moe`, `src/data/timeline.js`) — clean structured entries
    (name, start, end, image, official post URL). Best GI diff source; fetch the
    raw file, don't scrape their site.
  - Game8 events pages fetch fine (verified 200) and our banner scraper already
    uses Game8 — reuse its fetch/parse infra as fallback + diff check.
  - zzz.rng.moe: candidate diff source, evaluate at implementation time.
  - wuwatracker.com: API is closed (verified 403) — page-scrape only if ever
    needed; prefer the fandom wiki for WuWa instead.
- Never authority-invert: official sources win; third-party only fills gaps and
  flags misses ("needs review"), per the source-priority table in the research doc.

### Pipeline (new `Scraper/events/`)

- Follow the doc's architecture, trimmed to our stack:
  1. Fetch official sources on the scheduled workflow (join data-refresh.yml's
     6-hour cadence); store raw JSON/HTML snapshots (like other scrapers'
     `raw/` convention) so parser fixes never need re-fetching.
  2. Deterministic extraction ONLY: announcement JSON fields, plus regex/date
     parsing of explicit "Event Duration: …" strings in notice HTML. NO AI
     extraction stage — our CI has no LLM step; anything a deterministic parser
     can't date lands in `needs_review` instead of guessing. (The doc's AI-extractor
     layer can be added later as a manual/assisted pass if gaps stay annoying.)
  3. Normalize to one schema (the doc's): game, title, type
     (event/banner/web_event/login/challenge/shop/permanent), start/end ISO,
     timezone/server metadata, source name+url+priority, confidence, permanence.
  4. Dedupe by game + normalized title + overlapping range; official priority wins.
  5. Deterministic classification (current/next/permanent/needs_review) in the
     generator or client — never inside extraction.
  6. Validate in `Scraper/validate-data.cjs` like other datasets.
- Output `Database/Events/<game>.json`; generator ships current+future events with
  the page and lazy-loads the past (same pattern as banner history).

### UI

- Events render as a lane on the per-game timeline (Workstream M lanes list gains
  "Events"), same block anatomy: icon (event image when the source provides one),
  name, span, countdown on active, dashed "Expected" for date-less entries —
  those sit in a needs-review bucket visually separated so guesses never look
  confirmed.
- Double-display guard (review finding): the events pipeline will also extract
  banner notices (`type: banner`) — the banner lanes already cover those from the
  banner scraper. Exclude `type=banner` events from the Events lane; optionally use
  them as a cross-check on banner dates instead.
- Event blocks click through to a detail card (title, dates, description snippet).
  No user-facing source-site names anywhere (consistent with Workstream J); the
  official post link is fine to show.
- Hub cross-game events timeline per M4.

## Workstream O — Character kit info: base stats + profile facts (added 2026-07-10)

Add a "Profile" block to the character kit panel (`CharacterKitPanel`,
char-materials.jsx:2007) showing base stats and identity facts.

### Data (verified on disk 2026-07-10 — NO new scraping needed for GI/HSR/ZZZ/WuWa)

- **GI** (`Database/Nanoka/gi/live/characters.json`): `stats` = baseHp/baseAtk/
  baseDef/critRate/critDmg/elementalMastery + level curves; `profile` = birth
  [month,day], constellation name (e.g. "Animula Choragi"), `title`
  ("Endless Solo of Solitude"), region, native/affiliation, VA.
- **HSR**: `profile.camp` (faction, e.g. "Astral Express"), path; base stats verified
  present in the character record (`hp_base`, `defence_base`, `speed_base`,
  `critical_chance`, `base_aggro`, …) — exact nesting located at implementation
  (`ascensions` holds materials, not stats). No birthdays — HSR characters
  canonically have none.
- **ZZZ**: `stats` (attack/defence/crit/crit_damage + growth values — normalize
  growths to displayed level-1/level-60 numbers), `profile.birthday` ("FEB 20"),
  `camp` (faction), full_name.
- **WuWa**: `stats.stats` level curves (life/atk/def at each level/ascension),
  `profile.charaInfo` birth ("January 20th"), country, influence (affiliation).
- **Endfield** (`Database/EndfieldWiki/endfield/characters.json`, 29 operators):
  `birthDate` ("October 18"), `faction`, class/attributes already scraped from the
  wiki's structured Cargo table (BirthMonth/BirthDay/Faction are already in the
  scraper's field list, Scraper/endfield-wiki/scrape.mjs CARGO_FIELDS). Numeric
  base stats: check the cargo/infobox data at implementation; extend the field
  list if the wiki exposes them.

### Implementation

- Generator: emit `baseStats` (normalized: hp/atk/def/crit rate/crit dmg + any
  game-specific extras, at level 1 and max level where curves exist) and `facts`
  (title, faction/affiliation, constellation name [GI], birthday, region) into
  each cm roster entry. Small payload — fine in the main data files.
- UI: Profile section at the top of the kit panel — stat grid + fact chips.
  Per-game labels ("Constellation" GI-only; "Faction"/"Camp"/"Influence"/"Nation"
  per game's vocabulary). Same panel across all games (item 4 rule).
- Birthday display format: "October 18" style; no year (none exists).
- **Sticky name row (added 2026-07-10):** when scrolling down the character kit,
  the row with the character's name stays pinned at the top of the scroll area
  (CSS `position:sticky` inside the popup's scroll container, solid backdrop so
  content doesn't bleed through). Must work in all three render modes of the
  popup (modal, inline page, popout float — char-materials.jsx:2948–2959) and
  across all games.

## Workstream P — Birthday calendar on the hub (added 2026-07-10)

- New hub tab **Calendar** (below the new Characters tab) — ONE calendar with
  per-game toggles: Genshin, ZZZ, WuWa, Endfield. HSR is excluded (no birthdays
  exist); the toggle row simply doesn't offer it.
- Sources: all four games' birthdays are ALREADY in scraped data (see Workstream O)
  — the user-suggested wiki pages are not needed as scrape targets; the WuWa
  fandom Birthdays page can serve as a one-time cross-check of the data.
- UI: month-grid calendar, navigable by month, today highlighted. Characters
  appear as icon chips on their day (game-colored ring; multiple birthdays stack).
  Clicking a chip opens that character's page on their game. A compact "next
  birthdays" strip above the grid lists the soonest 3–5 across enabled games.
- Toggles persist in localStorage. Data comes from the generated payloads —
  no extra requests.
- Optional later tie-in (not in scope now): birthdays as a toggleable marker lane
  on the game timelines (Workstream M).

## Sequencing (batches clustered by the files they edit — each shippable)

Phase 1 — materials component cluster (char-materials.jsx + game-page-shared.css,
plus generator where noted):

1. **Batch 1:** A1 + A2 + A3 (layout polish — one pass over the file + css).
2. **Batch 2:** C (number inputs — same file).
3. **Batch 3:** B + D1 (generator asset fixes together: ZZZ icons + splash-art
   fields for all games → ONE regen) + D2 (visual preview pane).
4. **Batch 4:** O (kit profile block + sticky name row — generator facts/baseStats
   + kit panel; second small regen).

Phase 2 — app shell cluster (nyx-app.jsx):

5. **Batch 5:** E + G (bare detail views; db tiles + modal — both "image-first detail").
6. **Batch 6:** F1 + F2 (beta inspector — now client-side diff, no generator work).
7. **Batch 7:** L (favourites move + Characters rename + modes + star/unfav flow;
   touches both files but centered here) — must land before the timeline (M).
8. **Batch 8:** P (hub birthday calendar — uses Batch 4's facts data).

Phase 3 — repo-wide:

9. **Batch 9:** source-name full rename — isolated, nothing else mixed in,
   full build + smoke test.

Phase 4 — Database expansion (after the rename so new code is born clean):

10. **Batch 10:** I + J-restructure (Monsters/Items collections + Database
    always-on/renamed/absorbs TCG+Pot).
11. **Batch 11:** H (Wonderland scraper → data → UI under Database).

Phase 5 — new content page:

12. **Batch 12:** K (The Library tab on GI/HSR — new scraper + reader).

Phase 6 — timeline (biggest; mock approved before Batch 13 starts):

13. **Batch 13:** M core (timeline: current/next/upcoming + GI history + search +
    activities + custom markers).
14. **Batch 14:** M history scrapers for HSR/ZZZ/WuWa (each deepens the past view
    as it lands).
15. **Batch 15:** N (events pipeline → events lane).
16. **Batch 16:** M4 (hub cross-game banner + events timelines) — last.

Each batch: implement → build → live-check affected surfaces per game → gate per
`docs/agent-index.md` (Scraper `npm test`, `npm run validate:strict`, Site
`npm run build:deploy`, `npm run smoke:deploy`). No deploy without explicit ask.

## User decisions (2026-07-09)

1. Item 2: remove the "Sunday - all books" label as well — only `search results` remains.
2. Item 7: always splash art by default; no birthday/holiday rotation on character
   pages. Sole exception: overview pinned favourite cards keep special art.
3. Item 9: remove only the container around the image; keep all existing text/stats.
4. Item 10 (diff depth): full before/after side-by-side by default, with a "Compact"
   toggle for the per-field change list.
5. Scope additions (2026-07-09): Miliastra Wonderland scrape + section (H);
   Database Monsters/Items (I); Database always-on, renamed, absorbing
   TCG/Pot/Wonderland (J); "The Library" readable-books page for GI+HSR (K).
   No user-facing mention of the data source site anywhere.

6. The Library (K): tab on the GI & HSR game pages (not a hub page).
7. No attribution/credit line on Library pages.
8. Source-site name: full rename, including the internal `Database/Nanoka/` folder,
   scraper/tool/workflow names — its own isolated batch (see Workstream J).

Sequencing note: the full rename (J) runs as its own batch BEFORE Wonderland (H)
and The Library (K) so new code is born with the neutral paths.

## User decisions (2026-07-10)

9. L2: no practical pin limit in Icon mode; Card mode keeps its cap.
10. L1: hub favourites move into a new hub tab "Characters" directly below Overview.
11. M4: hub Banners tab becomes a cross-game banner timeline; a cross-game EVENTS
    timeline is added as well.
12. N: events on the timeline, sourced per the user's research doc (official
    announcement JSON / news as truth, third-party timelines as diff only,
    deterministic extraction, no AI stage in CI).
13. Splash art defined by user-provided per-game examples (see D1 mapping).
14. F1 uses client-side diffing (mirrors how the source site itself works).
15. "Expected" timeline blocks get an "educated guess" hover tooltip.
16. Endfield IS in the birthday calendar; HSR is not.
17. Batches clustered by edited files (Phases 1–6); timeline mock must be
    approved before Batch 13 (prompt: docs/timeline-mockup-prompt.md).
18. Batches queued as `.agents/queue.json` nyx-0016 … nyx-0031, state `planned`;
    flip to `ready` when this plan is marked FINAL.
