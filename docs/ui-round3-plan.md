# Nyx UI — Round 3 plan + handoff (pengo.gg)

Full review by user (2026-06-22) of the **pengo.gg game pages** (not asivehoarded). This
doc is the in-depth plan for all 40 review items + a full scraper refresh, AND the living
handoff: the **Progress / Handoff log** at the bottom is updated at every execution step.

> Recon note: the round-3 recon was meant to fan out via a Workflow but the subagent pool
> hit a session usage limit (resets ~22:40 Europe/Paris 2026-06-22), so the codebase map
> below was produced **inline** by reading the four core source files end-to-end
> (`index.html`, `nyx-app.jsx`, `char-materials.jsx`, `game-page-components.jsx`), the codes
> scraper, and the generated data shapes. All file:line refs verified against the current tree.

---

## Working conventions (read first)
- Repo: `C:\Pengo\Nyx` (GitHub `Asyce/Nyx`, branch `main`). Live at pengo.gg via the `nyx` Cloudflare Worker.
- **Game pages are React shells.** Visible text/UI comes from `Site/src/**` JSX + `Site/src/data/generated/**`, NOT the `.html`. Only `index.html` has real inline content + its own `<style>`.
- **Build:** `npm --prefix Site run build` = `generate:data` (`tools/generate-site-data.mjs` → `cm-data-*.js`, `nyx-data.js`) → `generate:weapons` → `build-site.mjs` (esbuild bundle to `Site/dist/`). **JSX/data edits need a build.** CSS (`Site/src/styles/game-page-shared.css`) is served live (no build), but is cache-busted.
- **Cache-bust:** every `Site/pages/*.html` references `?v=20260621-uiN`. After changing dist/CSS, bump the token across all pages (`sed -i 's/20260621-uiN/20260621-uiM/g' Site/pages/*.html`). `index.html` has no token (standalone).
- **Deploy (only when asked):** `npm --prefix Site run build:deploy` then `npx wrangler deploy` from repo root (wrangler OAuth-authed locally). Verify with `curl -L https://pengo.gg/<page>`.
- **Preview gotcha (from round 2):** the preview browser aggressively caches; verify via `curl` of the preview server or post-deploy, not just computed styles.

### Key files & line anchors (verified 2026-06-22)
| Area | File | Anchors |
|---|---|---|
| Index page (self-contained) | `Site/pages/index.html` | eye `.hd` L62; wordmark `.hd-right`/`.wm`/`.wm-logo` L75-86; cards `.grid`/`.card` L106-114 |
| App shell, topbar, corner toggle | `Site/src/app/nyx-app.jsx` | topbar `.gp-topbar` L1286-1301; corner toggle+pengo `.gp-corner` L1303-1308; `NyxChannelToggle` L1188-1203; page nav `.gp-side-nav` L1093-1106 |
| Codes + banners render | `Site/src/app/nyx-app.jsx` | `RewardChips` L207-217; `premiumCodeMeta`/`PREMIUM_CODE_META` L219-232; `CodeCardRow` L680-707; `CodesPanel` L709-777; `OverviewAside` L780-799; `bannerPhaseCards` L385-412 |
| Banner card component | `Site/src/components/game-page-components.jsx` | `GPBanner` L242-274; `GPCodeRow`/`GPCodes` L276-303 (placeholder set, NOT live) |
| Roster / popout / talents / ascension / weapon | `Site/src/features/materials/char-materials.jsx` | header L1246-1314; tabs L1316-1322; days L1324-1331; roster+recent L1110-1351; mid/talents L1353-1417; boss/trounce L1419-1459; popout L1463-1729; ascension calc `cmGiAscensionForLevel` L62-82; talent triplet L1592-1613; weapon row+disclaimer L1621-1689; beta merge `cmMergeBetaCfg` L854-864 |
| Shared CSS | `Site/src/styles/game-page-shared.css` | `.gp-topbar`/`.tb-*`/`.cm-chan`; `.gp-code*`/`.cc-*`/`.codes-group*`; `.gp-ban*`; `.cm-*` |
| Data generator | `Site/tools/generate-site-data.mjs` | `giSkillIcons` L1147; `buildBannersData` L2591-2596; `subBanners` L2580; CM_BETA wiring L2807 |
| Scrapers | `Scraper/**`, `Site/tools/scrape-*.mjs` | see Scraper Run Plan below |

---

## Diagnostics (the "find out why" items)

### G1 — Why expired codes (MARIONETTE / TEAPARTYTIME / TOTHEMOON) still show; would a live scraper catch them?
- **Pipeline:** `Scraper/codes/scrape.cjs` → `Database/Codes/codes.json` → `generate-site-data.mjs` embeds into `nyx-data.js` (`NYX_DB.codes`) → `dbCodes()` (nyx-app.jsx L319-335) feeds `CodesPanel`. The hardcoded `GAME_REGISTRY.*.codes` are only a fallback when `NYX_DB.codes` is empty.
- **Root cause:** `Database/Codes/codes.json` was generated **2026-06-21**; today is 2026-06-22. `MARIONETTE` is present there as `hoyoVerified`. **There is no scheduler — no `.github/workflows`, no cron.** The scraper only runs when a human runs it, so once codes expire the published snapshot goes stale until the next manual run + rebuild + deploy. That is the entire reason they linger.
- **Would a live (hourly) scraper prune them?** Mostly **yes**, by three independent mechanisms already in `scrape.cjs`: (1) the fandom/game8 **expired tables** (`EXPIRED_CONFIG`, `fetchExpiredAll`) drop any code that appears on an "Expired" list; (2) the **crimsonwitch-absence authority** rule — a code ever seen on crimsonwitch that disappears is treated as expired; (3) `MAX_AGE_DAYS=28` recency cutoff and `PREMIUM100_TTL` (72h) for livestream 100-currency codes. **Caveat:** `hoyoVerified` codes are stamped "today" each run and exempt from the burst guard, so they persist *as long as hoyo-codes.seria.moe still returns them*; expiry then relies on the expired-table / crimsonwitch-absence prune. **Net:** the fix is operational (run the scraper on a schedule + rebuild/deploy), not a code-logic bug. **Action:** wire a scheduled refresh (separate task — see Scraper Run Plan / Automation). For now, a manual scraper run + rebuild will drop the three expired codes.

### G22 — GI ascension shows large gemstones at every level / no low-level info
- `cmGiAscensionForLevel` (L62-82) rebuilds per-level costs by **inferring slots from `m.kind` (`'gem'`/`'specialty'`) and `m.rar`**, then summing `CM_GI_ASC_PATTERN` up to the phase count. If the generated `req.ascension` items **lack `kind`/`rar`** (or use different field names), `slotOf` mis-maps and items fall through to `out.push(m)` **unchanged = full to-90 quantity** → exactly "keeps showing the large gemstone, no scaling for low levels."
- **First execution step:** introspect the real shape — `node -e "global.window={};require('./Site/src/data/generated/cm-data-gi.js'); const a=window.CM_CFG.gi.roster.find(c=>c.req&&c.req.ascension).req.ascension; console.log(JSON.stringify(a,null,1))"` (shim window). Confirm whether `kind`/`rar` exist. **Fix path:** if missing, have `generate-site-data.mjs` emit `kind` + `rar` on GI ascension items (Nanoka carries the per-phase costs), OR make `cmGiAscensionForLevel` infer slots from name/rarity already present. dataDependency: generator + Nanoka gi ascension data.

### G34 — HSR "Beta" tag clearly wrong
- `cmMergeBetaCfg` (L854-864) maps **every** char in the beta pack by id with `__beta:true`, then replaces matching live chars. `CMCell` (L835) + popout (L1480) show the tag on any `ch.__beta`. If the HSR beta pack contains already-released characters (the file is ~14.7k lines, far more than the 1-3 sanctioned beta units Himeko Nova / Gilgamesh / Sandrone), every one of them shows "Beta" when the Beta channel is on. `__betaNew` (genuinely new) is computed but the tag doesn't use it.
- **Fix:** (a) tag only truly-new/changed units — gate the visible "Beta" chip on `__betaNew` (or a `betaStatus==='new'|'changed'`) not bare `__beta`; AND (b) ensure the generator only ships ACTUAL beta deltas into `cm-data-hsr-beta.js` (the per-game beta delta should be small). dataDependency: generator beta-delta build. Verify pack contents during execution.

### G35 — HSR not showing skill/trace icons
- The talent triplet reads `view.skillIcons[index]` (L1594) and falls back to `<em>short</em>`. The generator has **`giSkillIcons()` (L1147) but no HSR equivalent**, so HSR chars never get `skillIcons` → always the text fallback.
- **Fix:** add HSR skill/trace-icon extraction in `generate-site-data.mjs` from `Database/Nanoka/hsr` (has `characters.json` skill trees + skill assets) → emit `skillIcons` (Basic/Skill/Ult/Talent order to match `CM_TALENT_CFG.hsr`). dataDependency: generator + Nanoka hsr. Same pattern then extends to other games for G37.

### Banners (G31/G32/G33/G40) — stale single source
- All banner data is one file `Database/Banners/banners.json`, **last updated 2026-06-13** (stale). `buildBannersData` (L2591) → `NYX_DB.banners.games[key]` → `bannerPhaseCards`/`GPBanner`. Characters carry only avatar `image`/`imageFallback` (no namecard → G31 needs sourcing). `next`/`upcoming`/`subBanners` plumbing exists (L2580) → G33 feasible. Re-scraping `Scraper/banners` refreshes current/next; the UI items below then reshape the card.

---

## Per-item plan

Legend: **effort** trivial/small/medium/large · **dep** = data/scraper dependency.

### Index page
- **INDEX1 — bigger cards; Pengo•Nyx top-left larger; Eye top-right.** `index.html`. Eye `.hd` is already top-right (L62, 336px); wordmark `.hd-right` already top-left (L75). Do: (a) grow `.grid` columns + `.card` from 270 → ~300-312px (keep within the fixed 1600×900 `.stage`; 3-wide row at 312 + 44 gap = 980 < ~1040 budget; recheck the 2-row height) ; (b) enlarge `.wm` font 62→~74px and `.wm-logo` 94→~116px, widen `.hd-right` if needed and keep `white-space:nowrap`; (c) ensure eye + wordmark stay pinned to their corners at the new sizes. **effort:** small. **dep:** none. **risk:** stage is letterbox-scaled — verify nothing overflows 1600×900 and the `.lk` chain `offset-path` (hard-coded to a 126px-radius circle, L130) still matches the new card radius — if cards grow, that path + `.artwrap inset` + ring masks must scale too, else the sigil chain detaches. *(This coupling makes "bigger cards" medium, not trivial.)*

### Game-page masthead / Live-Beta toggle
- **G7 — pengo.png above the Live/Beta buttons.** `.gp-corner` (L1303-1308) currently renders toggle then pengo. Reorder so the Pengo sits above the toggle; set `.gp-corner{flex-direction:column}` ordering in CSS. **effort:** trivial. **dep:** none.
- **G8 — Live/Beta = tight, flat toggle; Beta not gold.** `NyxChannelToggle` `.cm-chan` (L1188-1202) + CSS `.cm-chan`/`.cm-chan.beta`. Make a single flat segmented control (no gap, shared border, flat bg); remove the gold treatment on `.cm-chan.beta`/`.beta .on`. **effort:** small (CSS). **dep:** none.
- **G9 — move "Nyx" text right ≈ one cap-N width.** `.gp-topbar .wm`/`.brand-mark` CSS — add left offset (~0.6em) so the wordmark clears the plate edge. **effort:** trivial.
- **G10 — eye behind the Nyx text + larger, moves with text.** `.tb-eye` (L1291-1295) is already after `.wm` in `.brand-mark`. Make it `position:absolute` behind the wordmark (z-index below `.wm`), size ≈ wordmark height (slightly larger), anchored to `.brand-mark` so it shifts with the text from G9. **effort:** small (CSS). **risk:** the wander animation targets `#tbBall` — keep the id.
- **G38 — Live/Beta on every game except Endfield; ZZZ SHOULD have it but currently doesn't show.** `NyxChannelToggle` self-hides via `cmHasBeta(gk)` → renders only where a `cm-data-<g>-beta.js` exists (`CM_BETA_FILES`). Generated beta files today: `gi`, `hsr`, `wuwa` — **no `cm-data-zzz-beta.js`**, so ZZZ's toggle is hidden. **RESOLVED (user 2026-06-22): ZZZ should have the toggle.** Fix = have `generate-site-data.mjs` emit a ZZZ beta delta so `CM_BETA_FILES.zzz` exists; set = GI/HSR/ZZZ/WuWa with toggle, Endfield without. Reaffirm ZZZ in the `project_nyx_beta_toggle` memory. **effort:** small-medium (generator). **dep:** ZZZ beta delta generation + a ZZZ beta source (Nanoka zzz beta material).

### Redemption codes UI
- **G2 — copy stays neutral; symbol only + "Copy" hover.** `CodeCardRow` `.cc-copy` (L701-704) already a bare `<button>` with `i-copy` glyph + `title`. Remove the `' ok'` gold state (drop the class add at L701 or neutralize `.cc-copy.ok` in CSS) and strip any container bg/border on `.cc-copy`; ensure `title="Copy"`. Also check the row's `st-copied` class doesn't tint the row. **effort:** small (mostly CSS).
- **G3 — less vertical space between codes.** CSS `.gp-codes-table`/`.gp-code-row` row gap/padding. **effort:** trivial.
- **G4 — rewards popup BELOW the cursor, show ALL items, no "…".** `.cc-reward-pop` (L699) renders `<RewardChips>` (default `limit=2`, plus `rewardParts` caps at 6 with a `.more "…"`, L204/L209-214). For the popup: render the full list (raise/remove `limit`, remove the 6-cap + `.more`), and flip the tooltip CSS from above (`bottom:100%`) to below (`top:100%`). **effort:** small. **risk:** keep the inline 2-chip preview elsewhere if it's reused — add a `full` variant to `RewardChips` rather than changing the default.
- **G5 — dynamic "N more below" while scrolling.** `CodesPanel` (L770-774) shows a static `moreCount = rows.length - 3`. Replace with a scroll-position-derived count on `.overview-codes-scroll` (onScroll → count rows below the fold via offsets). **effort:** medium.
- **G6 — no number after the premium-currency text.** `.codes-group-hd` (L750-751) shows `currency.name` + `<span class="gn">{list.length}</span>` → "Primogem 6". Remove the `.gn` count. (Also consider the `AllCodesView` `<small>{visibleCount}/{n}</small>` L868 for consistency.) **effort:** trivial.

### CharMaterials header / nav (cohesive refactor)
- **G11 — remove "Art of Khemia · <game>" subtitle.** char-materials L1248 `.cm-ttl .s`. Delete the subtitle node. **effort:** trivial.
- **G13 — drop the "Character Materials" heading text; turn its icon into a section selector (Overview / Character Materials / Artifact Sorter / Tracker).** Today those four are the left `.gp-side-nav` in `GameContent` (nyx-app L1093-1106) and CharMaterials can't switch them. Plan: replace `.cm-ttl` text with the `.cm-dia` icon as a dropdown; lift section switching so the dropdown calls `setTab('overview'|'mats'|'library'|'tracker')`. Cleanest wiring: pass an `onSection`/current-tab prop into `CharMaterials` from `GameContent` (it already renders `<CharMaterials inline game=.../>` at L1115); keep `.gp-side-nav` working too or hide it on the mats tab. **effort:** medium-large. **risk:** cross-component state; keep deep-link `selectedName` + modal usage intact.
- **G12 — move search / filter / hide next to the Roster/Talents/Trounce tabs.** Move `.cm-tools` (L1249-1312) out of `.cm-head` into the `.cm-controls`/`.cm-tabs` row (L1316-1322), same flex line, right-aligned. **effort:** medium (markup move + CSS).

### Roster
- **G14 — beta characters first in Recent.** `recent = cfg.roster.filter(ch=>ch.recent)` (L1112) preserves roster order; new beta units are appended (last). Sort recent so `__betaNew`/`__beta` come first. **effort:** trivial. **dep:** beta channel.
- **G16 — bigger character icons (front-of-name ≥ name font; behind-name icons larger).** Popout header: `.cm-name-circle` (the circle behind the name, L1478) and the inline meta icons `.cm-meta-symbol` (L1484-1487) — enlarge both in CSS so the leading icon ≥ the name font-size and the trailing meta icons scale up. (If the user also meant roster cells, bump `.cm-av`/`.cm-cell .cn` too — confirm on screenshot.) **effort:** small (CSS).
- **G24 — Recent units must ALSO stay under their 5★/4★ category.** Currently `rarityGroups` excludes `recentIds` (L1114) so a recent unit is removed from its rarity block. Drop that exclusion so recent is an *additional* quick-access row, not a move. **effort:** trivial.

### Character popout
- **G15 — popout slightly larger + scrollable.** `.cm-pop`/`.cm-pop-wrap` CSS: bump max-width/height and add `overflow:auto` (cap to viewport, e.g. `max-height:92vh; overflow-y:auto`) so it never clips. **effort:** small (CSS).
- **G17 — preset underline purple not red.** `.cm-presets-ledger button.on` (presets L1494-1506) underline/accent color → use `--accent`/purple. **effort:** trivial (CSS).
- **G18 — popout background = splash art (birthday art for GI if we have it).** `.cm-pop-bg` uses `selArt = cmPopupArtFor()` (L1195/L1468) which already prefers birthday pool → else `cmArtFor(view)` = `art||card||icon||circle`. The reason it looks wrong: birthday pool is empty AND/OR `view.art` (splash) isn't populated, so it falls to the small `icon`. **Fix:** ensure the generator populates GI `birthdayArtPool` (from `Database/GenshinWiki/birthday-art`) and a real splash `art` per character; confirm `cmArtFor` resolves splash, not icon. **effort:** small UI / medium data. **dep:** GenshinWiki/birthday-art + generator splash field.
- **G19 — no box around talent numbers/skills; just [icon][number], number boxed to show editable. Same for ascension level.** Talent triplet `.cm-talent-control` (L1598-1610) wraps icon+input in a boxed label; ascension `.cm-asc-level` (L1554-1562) similar. CSS: strip the wrapper box/border/bg; keep the box only on `.cm-talent-num` / the asc `<input>`. **effort:** small (CSS).
- **G20 — weapon disclaimer spans the WHOLE weapon row (incl. under the numbers).** `.cm-sig-disclaimer` (L1676-1681) lives inside the left `.cm-weapon-label` column, so it only spans the label. Move it to a full-row element (the weapon `.cm-ledger-row.weapon` is `label | mats` grid) — render the disclaimer as a row-spanning footer (`grid-column:1/-1`) below both columns. **effort:** small-medium.
- **G21 — currency amount never wider than its icon background.** `MatTile` `.qt` (L376) for `kind:'currency'` (e.g. "120,000" Mora). CSS: constrain `.cm-mat .qt` width to the tile/rarity-bg width with font auto-shrink (clamp / `max-width` + smaller font for currency). **effort:** small (CSS).
- **G22 — GI ascension correctness.** See Diagnostics. Generator emits `kind`+`rar` on GI ascension items OR adjust `cmGiAscensionForLevel` slot inference. **effort:** medium. **dep:** generator + Nanoka.
- **G23 — all-zero/min values must NOT make Ascension/Talents vanish.** Sections are gated on `ascReq.length>0` (L1550) / `talentReq.length>0` (L1568); at the minimum the computed lists go empty → sections disappear. Keep the rows rendered (show label + an empty/"—" state) regardless of length, or floor the computation so a section is never empty while a character has that progression. **effort:** small-medium.

### Talent materials / weekly
- **G25 — too much space between the talent material and the character icons.** `.cm-mrow.cm-domain-row` / `.cm-mtokens` → `.cm-grid` gap (L1364-1376). Reduce CSS gap. **effort:** trivial.
- **G26 — Mon/Tue/etc. day buttons too wide.** `.cm-days` buttons (L1326-1330) CSS — shrink min-width/padding to compact pills. **effort:** trivial.
- **G27 — drop the trailing day after each talent material.** `CMToken meta={(row.trio.days||[]).join(' / ')}` (L1369) adds "… / Mon". Remove the `meta` days. **effort:** trivial.
- **G28 — auto-select the current day.** `day` already inits to today (`new Date().getDay()` → Mon=0, L886). Verify it actually lands on today on load and the talent list filters to it; if it already works, mark verified. Possibly the ask is to also re-sync on midnight / show today highlighted. **effort:** trivial-small. **dep:** none.
- **G29 — talent-book + weekly-mat card backgrounds = the popout backgrounds (splash/birthday art).** Today `.cm-domain`/`.cm-weekly` rows have no art bg. Add the same per-character art pool as bg (faint). **effort:** medium. **dep:** same art as G18.

### Trounce / weekly boss (GI only)
- **G30 — GI trounce in 2 columns × 2 rows by recency (1st/2nd, 3rd/4th), each cell fits up to 5 icons.** Boss tab renders `giWeeklyBlocks` stacked (L1423-1439). For GI: order by recency and lay the 4 most-recent bosses in a 2×2 grid; size cells for ≥5 character icons. **effort:** medium. **dep:** boss "recency" ordering must exist in the data (verify `cfg.weeklyBosses` order/dates; may need generator to sort by release).

### Banners
- **G31 — GI ongoing banner art = character namecard, else splash.** Banner chars carry only avatar `image` (no namecard). Source namecards (Nanoka/GenshinWiki) into banner/char data; `bannerPhaseCards` art (L405) then prefers `namecard || art`. **effort:** medium. **dep:** namecard assets + generator.
- **G32 — show ALL ongoing banners (GI: Lohen AND Mavuika); name top-left; end-date bottom-right; no "Ongoing"; 4★ icons bottom-left.** Two concurrent 5★ banners means the data model (single `current` phase with one lead 5★ + chips) must split into one card per featured 5★. Rework `bannerPhaseCards` + `GPBanner` (L242-274): remove the `.status` "Ongoing" text, move `.bt` name to a top-left overlay, the date to a bottom-right overlay, 4★ `.four-icons` to bottom-left. **effort:** large. **dep:** banners.json must encode both concurrent featured banners (re-scrape + maybe model change).
- **G33 — compact sub-banner row of NEXT banners (e.g. Sandrone).** `group.next`/`upcoming`/`subBanners` plumbing exists (L2580); render them as a small compact strip below the main banners (smaller `GPBanner compact`). **effort:** medium. **dep:** next/upcoming present in banners.json.
- **G39 — kill the "weird shape"; plain square cards.** `GPBanner` `.gp-ban.f`/`.ban-art-card` CSS — make the art card a plain square/rounded-rect (drop the angled/odd masking). **effort:** small (CSS).
- **G40 — ZZZ banners look completely broken.** Likely the ZZZ entry in stale `banners.json` is missing/malformed → `bannerPhaseCards` returns nothing usable or `GPBanner` gets bad art. Diagnose after re-scrape; confirm ZZZ has a valid `current` with char `image`s, fix the generator/card if shape differs. **effort:** small-medium (post-scrape). **dep:** banners scrape.

### HSR + cross-game traces
- **G34 — fix the HSR Beta tag.** See Diagnostics. Gate the chip on truly-new/changed, shrink the beta delta. **effort:** medium. **dep:** generator.
- **G35 — HSR skill icons.** See Diagnostics. Generate `skillIcons` for HSR from Nanoka. **effort:** medium. **dep:** generator + Nanoka.
- **G36 — HSR "Max" control top-right, like the GI preset.** The HSR `Max` button sits inside the talent label before the triplet (L1588-1591); move it to the `.cm-ledger-top` top-right slot mirroring `.cm-presets-ledger` (L1494). **effort:** small-medium.
- **G37 — trace numbers + skill icons match the GI format, for ALL games.** The `[icon][number]` triplet (`CM_TALENT_CFG`) is GI/HSR only; ZZZ/WuWa/AE show "all to max". Extend `CM_TALENT_CFG` + `skillIcons` + per-game stage data so every game uses the same `[skill icon][editable number]` layout. **effort:** large. **dep:** per-game skill icons + talent-stage data from Nanoka.

---

## Scraper Run Plan (the explicit "run all scrapers" request)

**Inventory (each writes under `Database/`):**
| Scraper | Command | Writes | Source / notes |
|---|---|---|---|
| Codes | `node Scraper/codes/scrape.cjs` | `Database/Codes/codes.json` | nexus, crimsonwitch, hoyo-codes, reddit(RSS/proxy), fandom+game8 expired. Network-heavy; Reddit may need `REDDIT_PROXY_BASE` in CI but works direct locally. |
| Banners | `node Scraper/banners/scrape.cjs` | `Database/Banners/banners.json` | game8/nanoka; currently STALE (Jun 13). |
| Nanoka (materials/assets) | `node Scraper/nanoka/scrape.mjs` (per-game flags) | `Database/Nanoka/<game>/...` | Big. **Do NOT pull `beta/`** (gitignored, policy). Source of ascension/skill data (G22/G35). |
| Prydwen | `node Scraper/prydwen/scrape.mjs` | `Database/Prydwen/<game>/...` | meta/roles. |
| Endfield wiki | `node Scraper/endfield-wiki/scrape.mjs` | `Database/EndfieldWiki/...` | AE. |
| Banner history | `node Scraper/banner-history/gi.mjs` | `Database/BannerHistory/gi.json` | GI 50/50, paimon. |
| Wiki titles | `node Scraper/wiki-titles/scrape.mjs` | `Database/WikiTitles/...` | helper. |
| GI birthday art | `npm --prefix Site run scrape:gi-birthdays` | `Database/GenshinWiki/birthday-art` | G18/G29 background art. |
| GI signatures | `npm --prefix Site run scrape:gi-signatures` | (signature weapon map) | weapon disclaimer data. |
| HSR holiday art | `npm --prefix Site run scrape:hsr-holidays` | `Database/HsrWiki/holiday-art` | HSR popout art. |
| HSR signatures | `npm --prefix Site run scrape:hsr-signatures` | `Database/HsrWiki/signature-lightcones` | LC disclaimer data. |
| Nanoka GCG | `npm --prefix Site run scrape:gcg` | — | card game. |

**End-to-end refresh:**
1. Run the scrapers above (codes + banners + nanoka + prydwen + art scrapers at minimum). Keep `Scraper/beta/` out of git.
2. `npm --prefix Site run build` (regenerate `cm-data-*` + `nyx-data` + bundle).
3. Bump the `?v=` cache token across `Site/pages/*.html`.
4. Verify locally (`curl` preview), then deploy when asked (`build:deploy` + `wrangler deploy`).

**Automation (answers G1):** there is **no scheduler** today. Recommend a scheduled refresh (GitHub Actions cron or a Cloudflare Cron Trigger) that runs at least the **codes** scraper hourly and **banners** daily, regenerates, and deploys — that is what makes expired codes auto-prune. Track as a separate task; needs the Reddit proxy env + CF deploy creds handled out-of-repo (no secrets in files).

---

## Execution order (each step = its own handoff-log entry + verify)
0. **Scrapers + rebuild** (refreshes codes→drops MARIONETTE etc.; refreshes banners; provides data for G22/G34/G35). Verify codes.json no longer lists the 3 expired codes.
1. **Data/generator fixes:** G22 (ascension kind/rar), G34 (HSR beta gating + delta size), G35 (HSR skill icons), G18/G29 art population, G31/G33 banner data, G40 ZZZ banner data. Rebuild between.
2. **Index page** INDEX1 (CSS only, no build).
3. **Masthead/toggle** G7,G8,G9,G10,G38.
4. **Codes UI** G2,G3,G4,G5,G6.
5. **CharMaterials header/nav** G11,G12,G13.
6. **Roster** G14,G16,G24.
7. **Popout** G15,G17,G19,G20,G21,G23 (+ G22/G34 UI side).
8. **Talent/weekly** G25,G26,G27,G28,G29.
9. **Trounce** G30.
10. **Banners UI** G31,G32,G33,G39,G40.
11. **HSR/cross-game traces** G36,G37.
12. **Build, cache-bust, verify, deploy (on request).**

> Many items are CSS-only (live, no rebuild): INDEX1, G3, G6, G7, G8, G9, G10, G17, G19, G21, G25, G26, G39, and the CSS halves of G2/G15/G16. Group these to minimize rebuilds.

---

## SESSION SUMMARY (2026-06-22) — done vs deferred

**Build: clean (exit 0). Cache token bumped `ui7 → ui8` across `Site/pages/*.html`. NOT deployed yet (awaiting go-ahead / remaining items).**

**DONE & in the bundle (38 items):**
INDEX1, G1 (codes pruned + verified), G2, G3, G4, G5, G6, G7, G8, G9, G10, G11, **G12**, **G13**, G14, G16, G17, G18, G19, G20, G21, G22 (data regen + verified scaling), G23, G24, G25, G26, G27, G28 (already auto), **G29**, **G30**, G32, G33, G34 (verified), G35 (verified 78/86), G36, G39, G40 (square fix — the ZZZ "generic" icon is actually the agent's real circle icon, oddly named, so resolved).

Round-3 resume (2026-06-23) added: **G12** (`.cm-tools` moved into `.cm-controls` next to the tabs via two boundary edits), **G13** (`.cm-dia` is now a section dropdown — `GameContent` passes `sections`+`pageTab`+`onPageTab` to `CharMaterials`, which renders `.cm-section-select`/`.cm-section-menu`; falls back to the plain title for modal/Nyx usage), **G29** (`cmNewestChar` helper → faint `.cm-block-bg` newest-character art on `.cm-domain`/`.cm-weekly`), **G30** (GI weekly blocks sorted by newest character + wrapped in `.cm-trounce-grid` 2-column).

**DONE in the finish pass (2026-06-23):**
- **G31** (GI banner namecard): new `Site/tools/scrape-genshin-namecards.mjs` pulls `UI_NameCardPic_<token>_P.png` from enka.network (113/139 chars; 26 fall back to splash exactly per the rule) → `Database/GenshinWiki/namecards/` + manifest. Generator: `GENSHIN_NAMECARD_ART` map → GI roster `namecard` field → `normalizeBannerCharacter` carries it → `bannerPhaseCards` art = `namecard || art || icon`. Verified: Lohen/Mavuika banner art = their namecards.
- **G38** (ZZZ toggle): `buildPrydwenRoster` now, in the BETA channel only, appends Nanoka beta-only ZZZ agents (parsing the clean display name out of `Avatar_..._Sigrid`, mapping rarity 4/5→A/S, attribute/specialty from the agent record) → `zzz=1(+1/~0)` delta → `cm-data-zzz-beta.js` exists → toggle shows. Sigrid renders with materials (icon falls back to initials since the `--skip-assets` run didn't pull her image — re-run `nanoka:zzz` without `--skip-assets` to get it).

**G37 — DONE (finish pass 2, 2026-06-23) using sources the user provided:**
- **WuWa**: `wuwaSkillIcons()` maps the 5 core skills' Unreal icon paths (`raw.skill_trees[].skill.icon`, by `skill.type`) → local `Nanoka/ww/assets/skills/*.webp`; wired via `buildWuwaSkillIconMap()`. 50/57 chars get 5 icons.
- **AE**: new `scrape-endfield-skill-icons.mjs` pulls Basic/Skill/Combo/Ult icons from endfield.wiki.gg per operator (28/29 → 4 icons, 86 files) → `EndfieldWiki/endfield/skill-icons/` + manifest; `ENDFIELD_SKILL_ICONS` map → `buildEndfieldRoster` `skillIcons`.
- **ZZZ**: the 5 skill-type icons are SHARED across all agents — sourced from `static.nanoka.cc/assets/zzz/` (`Icon_Normal` Basic, `Icon_Evade` Dodge, `Icon_Switch` Assist, `IconRoleSkillKeySpecialV2` Special, `Icon_UltimateReady` Chain; found by rendering zzz.nanoka.cc/character/1211 with Playwright). Downloaded to `Database/Nanoka/zzz/assets/skills/`; `ZZZ_SKILL_ICONS` constant attaches them to every ZZZ agent in `buildPrydwenRoster`. (The earlier glyph fallback was removed.)
- **UI**: the popout talent row now shows a read-only `[skill icon]…` row + a "Max" tag for any game without per-level inputs (`.cm-skill-icons`). The per-level **editable recompute** stays GI/HSR-only — the other games still show their (correct) to-max materials, since clean per-skill-level material data isn't available for ZZZ/WuWa/AE. So the *format* (skill icons) now matches everywhere; editable per-skill levels remain a GI/HSR feature.

**Deploy when ready:** `npm --prefix C:/Pengo/Nyx/Site run build:deploy` then `npx wrangler deploy` from `C:/Pengo/Nyx`; verify `curl -L https://pengo.gg/genshin`.

## Decisions (user, 2026-06-22)
- **Execution:** full sequence, phase by phase (Phase 0 → 12), handoff-log entry per step.
- **G38/ZZZ:** ZZZ SHOULD have the Live/Beta toggle (currently hidden — no zzz beta delta file). Generate one.
- **Deploy:** batch at the very end (build + verify per phase; one cache-bump + `wrangler deploy` at the end).

## Still to confirm (non-blocking; proceeding on defaults)
- **G16:** planned for the **popout header** (circle + meta icons); will confirm on screenshot.
- **G32:** assuming Lohen + Mavuika are two concurrent featured GI banners (drives the one-card-per-5★ model); will verify against the re-scraped `banners.json`.

---

## STATUS — ALL 41/41 DONE & DEPLOYED (2026-06-23)
**Every item complete and LIVE on pengo.gg** — worker `nyx`, version `69b8e7ed`, cache token `ui12`. Verified live: GI/HSR/WuWa/AE/**ZZZ** all show real skill icons (ZZZ's 5 shared nanoka type-badges return 200 on the edge). (Earlier: `bbe86e82`/`ui11` had AE+WuWa; `c70be3ed`/`ui10` was the 40/41 milestone.) G37 finished using the user's sources (WuWa in-data icons, AE endfield.wiki.gg scrape via `scrape-endfield-skill-icons.mjs`, ZZZ shared type glyphs) — all games now show skill icons in the consistent format (editable per-skill levels stay GI/HSR-only, a data limitation, but the materials are correct everywhere). New scrapers added to `Site/package.json`: `scrape:gi-namecards`, `scrape:ae-skills`. Earlier milestone below was 40/41 at `ui10`.

### (prior) 40/41 at ui10
**40/41 items done and DEPLOYED to pengo.gg** (worker `nyx`, version `c70be3ed`, cache token `ui10`). Verified live: all game pages serve `ui10`; GI namecards (G31) and `cm-data-zzz-beta.js` (G38) return 200 on the edge. The finish pass added G12, G13, G29, G30 (resume) then G38 + G31. **Only G37-rest remains** — the editable per-skill trace format for ZZZ/WuWa/AE — and it's genuinely data-blocked (no skill icons for ZZZ/AE; no clean per-level material decomposition), needing a separate skill-data pipeline rather than a UI change. Full detail in the SESSION SUMMARY above.

## Progress / Handoff log (updated every step)
- **2026-06-22 — Plan created.** Inline recon of all four core source files + codes scraper + data shapes complete (workflow recon blocked by session limit). All 40 items mapped to file:line with approach/effort/risk/dep above. Diagnostics resolved for G1 (no scheduler → stale snapshot; live scraper would prune), G22 (slot-inference vs data shape), G34 (beta tag uses bare `__beta`), G35 (no HSR skill-icon generation), banners (single stale `banners.json`). **No code changed yet.** Next action: Phase 0 — run scrapers + rebuild, then re-verify codes.json.
- **2026-06-22 — Decisions locked + Phase 0 started.** User chose full phase-by-phase execution, ZZZ keeps a Live/Beta toggle (must add the missing zzz beta delta), deploy batched at the end. Running scrapers (codes first to clear the 3 expired GI codes).
- **2026-06-22 — Phase 0 codes + banners DONE & verified.**
  - **Codes scraper** (`Scraper/codes/scrape.cjs`) re-run → `Database/Codes/codes.json` regenerated (generatedAt 2026-06-22T20:55). **G1 verified:** MARIONETTE / TEAPARTYTIME / TOTHEMOON all pruned (0 occurrences); GI now lists 6 current codes (MAGENICOLESPUZZLE, PFY1S40I88T9, LEGEDILJKSGM, LCXGEA5SX65L, NMI20MAJGIBP, YMYD76U85Z1U). Reddit returned 429s (rate-limited) — non-fatal; other sources + carry-forward cover it. Confirms the diagnosis: expiry detection works; staleness was purely the missing scheduler.
  - **Banners scraper** (`Scraper/banners/scrape.cjs`) re-run → `Database/Banners/banners.json` (updated 2026-06-22T20:55). Data now backs the banner items: **GI current = [Lohen, Mavuika]** (G32 two concurrent banners), **GI next = [Sandrone, Citlali]** (G33 sub-row), **ZZZ current = [Velina, Ye Shunguang] / next = [Norma] / upcoming = [Sunna]** → so **G40's broken ZZZ is a render bug, not missing data.**
  - **Remaining scrapers DONE** (nanoka all-games live+beta `--skip-assets`: 1442 item records changed; prydwen 28 chars/0 errors; endfield-wiki no change; wiki-titles 52/59; banner-history-gi 101 banners; GI birthday + HSR holiday art refreshed → G18/G29; HSR signatures 62/66). All exit 0.
- **2026-06-22 — Build gotcha + rebuild.** First `npm --prefix Site run build` FAILED (ENOENT) — **background Bash commands start at the session default cwd (`As I've Hoarded`), NOT the persisted `cd`**, so `--prefix Site` resolved to the wrong root. Lesson for all later steps: use **absolute paths** (`npm --prefix C:/Pengo/Nyx/Site …`) or `cd /c/Pengo/Nyx &&` every command. Re-running with the absolute prefix. (`nyx-data.js` still had MARIONETTE / no Sandrone until this succeeds.)
- **G34 fix pinned (during Phase 0 read):** generator delta (`cmBetaDeltas`, generate-site-data L2755-2782) already filters to new-or-req-changed and stamps `betaStatus:'new'|'changed'`; `cmMergeBetaCfg` already computes `__betaNew` from `betaStatus==='new'`. The bug is purely UI: `CMCell` (char-materials L835) + popout (L1480) show the chip on bare `__beta`. **Fix = gate the visible "Beta" chip on `__betaNew`** (so released 'changed' chars don't show it). Small.
- **2026-06-22 — Phase 0 COMPLETE + verified; entered Phase 1.**
  - Rebuild succeeded (absolute prefix). `nyx-data.js` now: MARIONETTE absent, current codes present (G1 live in bundle); Lohen/Mavuika/Sandrone/Velina present (G32/G33/G40 data live). Build clean, exit 0.
  - **Beta deltas:** `gi=1(+1/~0), hsr=15(+0/~15), wuwa=10(+0/~10)`, **zzz=none**. Confirms G34 (HSR: 0 new, 15 changed → all 15 were false-positive Beta tags) and exposes **G38 root cause: no ZZZ beta delta is produced** (zzz beta roster has no new/req-changed chars vs live, or `betaChannelAvailable('zzz')` is false) → `cm-data-zzz-beta.js` not emitted → toggle hidden. Investigate `betaChannelAvailable` + `Database/Nanoka/zzz/beta` next.
  - **G34 DONE (code):** `char-materials.jsx` L835 + L1480 now gate the chip on `__betaNew` (was `__beta`). Needs the phase-batched build to verify on the beta channel.
  - **Phase 8 (talent/weekly) DONE — `char-materials.jsx` + CSS:** G25 `.cm-mrow` gap 20→12px + tighter material column; G26 `.cm-days` → compact `inline-flex` pills (`flex:none`, `min-width:44px`) instead of full-width `flex:1`; G27 removed the trailing day meta on each talent token. G28 already auto-selects today (`day` inits from `new Date().getDay()`) — will confirm visually. **G29 DEFERRED** (talent/weekly card backgrounds = popout art): ambiguous which character's splash to use on a multi-character domain row — needs a design decision (representative char vs. montage).
  - **Phase 10 (banners) DONE — `game-page-components.jsx` + `nyx-app.jsx` + CSS:** G39 dropped the hex `.rim` → plain square card; G32 `GPBanner` restructured (name top-left `.ban-name`, 4★ icons bottom-left, end date bottom-right `.ban-date`, no "Ongoing" — only a small "Up next" flag) and `bannerPhaseCards` now splits the current phase into one card per featured 5★ (Lohen AND Mavuika) using `rarity`; G33 `OverviewAside` renders a compact "Next Banners" sub-row (h=84) for the next/upcoming phases (Sandrone). G40: ZZZ assets exist, so the breakage was the hex shape (now fixed) — **note:** ZZZ banner agents resolve to a generic `IconRoleCircle64` icon (roster-data quirk), worth a follow-up. **G31 DEFERRED** (GI namecard art): banner chars only carry gacha-splash `art` + circle `icon`; no namecard assets in the pipeline — needs a namecard scrape/source, then prefer `namecard || art`.
  - **Next (Phase 1 remaining):** G22 (GI ascension kind/rar in generator), G35 (HSR skill-icon generation), G38 (force/justify a ZZZ beta delta), G18/G29 (confirm GI splash + birthday art populate the popout/talent backgrounds). Then build once + verify, then the UI phases.
- **2026-06-22 — Phase 1 data investigation (verified by introspection of the regenerated data):**
  - **G22 RESOLVED by data regen (no generator change).** Live GI ascension now carries correct `kind`/`rar`; simulated `cmGiAscensionForLevel` scales right: Lv90 gemstone×6 → Lv70 chunk×3 (no gemstone) → Lv50 fragment×3 → Lv40 sliver×1 → Lv20 empty. The old "big gemstones at every level" was the stale deployed bundle. Remaining piece is **G23** (don't collapse the section at low/zero levels) — handled in the popout phase. Will visually confirm.
  - **G35 confirmed:** GI roster has `skillIcons` (e.g. Lohen → 3 webp), HSR roster has `skillIcons:null`. Generator has `giSkillIcons()` (L1101) used in the GI build (L1147) but the HSR build (L1237-1279) emits none. Fix = add an `hsrSkillIcons(raw)` from `raw.skill_trees` icons and attach in the HSR build (Basic/Skill/Ult/Talent order).
  - **G38 root cause:** ZZZ beta channel has data (`Nanoka/zzz/beta/agents.json`, 5.2 MB) and the manifest lists **5 NEW beta character ids** (1581,1591,1021,1211,1261), but the build still prints `zzz=none`. So `buildRostersForChannel('beta')`/`buildCmCfg` isn't surfacing the new zzz agents into the beta roster (likely the same "only Nanoka-live-backed agents" filter from round-2 4.2 dropping beta-only agents). Real generator fix needed so the zzz delta (and thus the toggle) is produced.
- **2026-06-22 — G35 DONE (generator); G38 DEFERRED with a precise spec.**
  - **G35 (HSR skill icons) implemented** in `generate-site-data.mjs`: new `hsrSkillIcons(raw)` (reads `skill_trees.point01-04['1'].icon`, swaps upstream `.png`→on-disk `.webp`, resolves under `Nanoka/hsr/assets/skills/`, returns a 4-slot array aligned to Basic/Skill/Ult/Talent) + `buildHsrSkillIconMap()` (name-keyed, mirrors `buildHsrReqMap`); `buildPrydwenRoster` gained a `skillIconsByName` param that attaches `skillIcons` to the char; the HSR call now passes `buildHsrSkillIconMap()`. Rebuilding to verify HSR roster gets `skillIcons`. (G37: the same `skillIcons` attach can later extend to ZZZ/WuWa once their per-skill icon source is mapped.)
  - **G35 VERIFIED:** 78/86 HSR chars now carry `skillIcons` (e.g. Yao Guang → 4 trace icons); asset files exist on disk; build clean. G34 UI fix also baked into the bundle.
- **2026-06-22 — Phase 1 COMPLETE (G1✓ G22✓ G34✓ G35✓; G38 deferred). Phase 2 (Index/INDEX1) DONE.** `index.html` (standalone, no build): cards 270→304px with the sigil-chain `offset-path` updated to match (`M 152 9 A 143 143…`), grid gap 48/40, wordmark 62→78px + logo 94→120px, `.hd-right` widened to 720px. Eye already top-right, Pengo•Nyx already top-left. **Visual verify pending** (consolidated pass at end — the offset-path geometry is the one thing to eyeball).
  - **Phase 3 (masthead) DONE — CSS, `game-page-shared.css`:** G7 `.gp-corner` → `column-reverse` (Pengo now above the toggle); G8 `.cm-chan` → flat tight segmented toggle (gap:0, solid fills, no gradients/shadows, Beta uses the same purple as Live — no gold); G9 `.tb-brand` left 64→96px (wordmark shifted right ~one cap-N); G10 `.tb-eye` → absolute, centered BEHIND the wordmark, 64→92px, moves with the text. (G38 deferred.)
  - **Phase 4 (codes UI) DONE — `nyx-app.jsx` + CSS:** G2 copy is a bare symbol (`title="Copy"`, removed the `ok`/gold state, `.cc-copy` transparent); G3 `.gp-code-row` padding 8→4px; G4 `RewardChips full` (all rewards, no "..."), `.cc-reward-pop` now `top:calc(100%+8px)` (below the cursor) + wraps; G5 "N more below" is now scroll-driven (`belowCount` recomputed on scroll/resize) instead of a static count; G6 removed the `.gn` count after the currency name. *(Caveat: the reward popout can clip at the very bottom row inside the codes scroll container — a portal/fixed follow-up if it matters.)*
  - **Phase 6 (roster) DONE — `char-materials.jsx`:** G11 removed the "Art of Khemia · game" subtitle; G14 Recent strip sorts `__betaNew` first; G24 Recent units now ALSO stay under their 5★/4★ rarity group (dropped the `!recentIds` exclusion).
  - **Phase 7 (popout) DONE — `char-materials.jsx` + CSS:** G15 popout `max-height` 88→92vh (main already scrolls); G16 `.cm-name-circle` 1.05→1.5em + meta icons 30→40px; G17 preset underline now fixed **purple** (was the element colour → red for Pyro); G18 ledger splash-bg opacity .44→.56; G19 stripped the box off `.cm-talent-triplet`/`.cm-talent-control`/`.cm-talent-icon`/`.cm-asc-level` so it's just `[skill icon][boxed number]`; G20 weapon disclaimer moved out of the label to span the full row (`grid-column:1/-1`); G21 currency tiles get a `.cur` class + smaller `.qt` font so big Mora amounts stay within the icon background; G23 Ascension/Talents rows now stay visible at zero (stable `hasAscData`/`hasTalentData` flags + empty-state); G36 HSR "Max" moved to the top-right preset slot (same format as GI). **G37** is satisfied for HSR (skillIcons + same triplet); extending the `[icon][number]` format to ZZZ/WuWa/AE needs their per-skill icons + talent-stage data (deferred note).
  - **G38 (ZZZ toggle) — DEFERRED (handoff spec).** Definitive root cause: the ZZZ roster is `buildPrydwenRoster('zzz', …)` filtered to `overlay.has(name)` (Prydwen ∩ Nanoka, generate-site-data L1569). The 5 new beta agents exist in Nanoka beta but **not in Prydwen**, so they never enter the roster in EITHER channel → beta == live → empty delta → no `cm-data-zzz-beta.js` → `cmHasBeta('zzz')` false → no toggle. **Fix spec (for a careful follow-up):** in `buildPrydwenRoster` (or a post-step) for ZZZ, append Nanoka-overlay agents absent from Prydwen as roster entries built from Nanoka `agents.json` (name/icon/attribute/specialty/req) so beta-only agents appear; guard it so the LIVE roster isn't polluted with incomplete placeholders (only add when the agent has full Nanoka data). This is a real roster-source change shared across games/channels — deferred to avoid risking the whole-site build mid-sweep. Until then ZZZ has no toggle because there is genuinely no surfaced ZZZ beta content.
