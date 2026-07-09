# UI Changes Plan — 2026-07-09 (from "UI Changes Proposal.docx")

Status: EXPANDING — workstreams A–K approved and self-reviewed 2026-07-09 (Codex
review waived); user is adding further scope. Do not start implementation until
the plan is marked final again.
Source: user proposal doc with 12 items. All items grounded against HEAD (branch `main`).

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
- Task: audit what `art` resolves to per game in generated data; where it is not the
  character's splash art (e.g. cards/screenshots), fix the generator to emit splash
  art as `art` (source-site/wiki per game). UI default then follows. Note the fallback
  chain `cmArtFor` = art → card → icon (char-materials.jsx:1254–1255): splash-default
  means guaranteeing `art` is the splash for every roster entry; the fallback stays
  for entries that genuinely lack one.
- Custom override stays (prefs → `customBackground`).
- User decision 2026-07-09: stop the birthday/holiday art rotation on character pages —
  default is always the character's splash art. The ONLY place special/rotating art
  remains is the overview tab's pinned favourite cards. Implementation: restrict
  `cmSpecialArtPool`/`cmPopupArtFor` special-art usage to the overview favourites
  surface; the character visual page/popup uses splash art unless customized.

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
- Plan:
  1. Generator: when live and beta entries share an id, compute a field-level diff
     (stats, materials, talents/skills, rarity, name/title — bounded whitelist of
     fields, not deep-diff-everything) and emit `changes: [{ field, before, after }]`
     into the beta pack. Cap size (payload budget) and count.
  2. UI (`BetaDataPanel`, nyx-app.jsx:2258): changed cards become clickable → modal.
     Default view: full before/after side-by-side (live vs beta). A "Compact" toggle
     switches to a per-field change list ("Field: old → new"); long text fields
     collapse in compact mode. (User decision 2026-07-09.)
     Note: side-by-side as default means the beta pack must carry the relevant live
     snapshot values too (or the UI reads them from the already-loaded live CM_CFG —
     preferred, keeps the beta payload small).
- Risks: beta data source may not align field-by-field with live (different scrape
  shapes) → diff must normalize before comparing or it will report noise. Start with
  a small trusted field set and expand.

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
- New scraper `Site/tools/scrape-nanoka-beyond.mjs` following the furniture/gcg
  pattern; output `Database/Nanoka/gi/beyond/{costumes,items,suits}.json` + localized
  icon assets (webp, like `localize-nanoka-icons.mjs` flow).
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

## Sequencing (suggested batches, mostly independent)

1. **Batch 1 (cheap CSS/JSX polish):** A1, A2, A3 — one pass over char-materials.jsx + css.
2. **Batch 2 (data regen):** B (ZZZ icons) — generator change + regen + visual check.
3. **Batch 3:** C (number inputs).
4. **Batch 4:** D1 + D2 (visuals defaults + preview).
5. **Batch 5:** E + G (bare detail views; db tiles + modal — both "image-first detail" work).
6. **Batch 6:** F1 + F2 (beta diffing — largest of the original 12, generator + UI).
7. **Batch 7:** source-name full rename (J's rename half) — isolated, repo-wide,
   full build + smoke test, nothing else mixed in.
8. **Batch 8:** I + J-restructure (db Monsters/Items collections + Database
   always-on/rename-to-"Database"/absorb TCG+Pot — both reshape the Database tab).
9. **Batch 9:** H (Wonderland scraper → data → UI under Database; after Batch 8).
10. **Batch 10:** K (The Library tab on GI/HSR — independent, new scraper + reader).

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

No open questions remain. Reviewed twice: self-review 2026-07-09 (Codex review
skipped — quota; user waived it). Sequencing note: the full rename (J) runs as its
own batch BEFORE Wonderland (H) and The Library (K) so new code is born with the
neutral paths.
