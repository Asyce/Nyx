# Nyx UI — Round 2 plan (handoff for Codex)

Continuation after commit `f425284` (round 1: rename, index/popout polish, real meta
icons for all 5 games, ascension-level selector — all live on pengo.gg as `ui4`).
This document is the full step-by-step plan for the round-2 changes. Pick up any
unchecked box; each phase is independent.

## Working conventions (read first)
- Repo: `C:\Pengo\Nyx` (GitHub `Asyce/Nyx`, branch `main`). Currently clean at `f425284`.
- Game pages serve JS from `Site/dist/` (so **JSX edits need `npm --prefix Site run build`**)
  but CSS from `Site/src/styles/` (live). `Site/dist/` and `.deploy/` are gitignored.
- **Cache-bust:** every `Site/pages/*.html` references `?v=20260621-ui4`. When you change
  dist/CSS, bump the token across all pages (`sed -i 's/20260621-ui4/20260621-ui5/g' Site/pages/*.html`)
  or returning visitors get a stale bundle. (index.html has no token — it's standalone.)
- Build/verify: `npm --prefix Site run build` (deterministic except `generatedAt` timestamps).
  Preview via launch.json server `nyx-site` (serves `Site/` on :5180). The preview page is
  `visibilityState:hidden`, so **screenshots time out and CSS transitions/rAF stall** — verify
  with `preview_eval` reading computed styles / DOM, not screenshots.
- Deploy (only when asked): `npm --prefix Site run build:deploy` then `npx wrangler deploy`
  from repo root (wrangler is OAuth-authed locally; no CF env needed). pengo.gg 307-redirects
  `*.html` → clean URL, so `curl` needs `-L`. Bump the cache token before deploying.
- Key files:
  - Index: `Site/pages/index.html` (self-contained, own `<style>`).
  - Game-page shells: `Site/pages/{genshin,honkai-star-rail,zenless-zone-zero,wuthering-waves,arknights-endfield,simulacrum}.html`.
  - App shell + topbar: `Site/src/app/nyx-app.jsx` (topbar ~L1221-1234, `GPGameRail`, `GAME_REGISTRY` L220, `NYX_META`).
  - Popout + roster: `Site/src/features/materials/char-materials.jsx`.
  - Shared CSS: `Site/src/styles/game-page-shared.css`.
  - Data generator: `Site/tools/generate-site-data.mjs` → `Site/src/data/generated/cm-data-*.js`.

---

## Phase 1 — Index (`Site/pages/index.html`)

- [ ] **1.1 "Pengo • Nyx" on one line.** The wordmark `.wm` is `display:flex` with the logo
  + text. Make sure it never wraps: add `white-space:nowrap` to `.hd-right .wm` and confirm
  `.hd-right` width (currently `474px`) fits logo+text at the larger logo size; widen if needed.
- [ ] **1.2 Larger Pengo logo.** `.hd-right .wm-logo` is `height:66px`. Increase (~`88–96px`);
  keep `width:auto; flex:none`. Re-check vertical centering of the text vs logo (`align-items:center`).
- [ ] **1.3 (note)** Index has no dark-veil; the "dark for seconds" issue is game-pages only (Phase 2).

Verify: `preview_eval` — `.wm` `white-space` is `nowrap`, `.wm` rect height == one line, logo `naturalWidth` loads.

---

## Phase 2 — Game pages (shells + topbar + bg)

### 2.1 Background brightness
- [ ] In each `Site/pages/*.html` the `.page-bg` has `filter:brightness(1.18) saturate(1.12) contrast(1.05)`.
  Increase brightness (~`1.35–1.45`) on all game-page shells. (simulacrum.html too.) Keep index as-is unless asked.

### 2.2 "Dark for a few seconds" on game-page open  (regression from round-1 veil)
- Root cause: `body::before` veil in `game-page-shared.css` is **solid `#05040b`** until the bundle
  mounts and sets `html.nyx-app-ready`; on a big bundle that's seconds of black.
- [ ] Replace the solid-black approach with a **content fade-in over the (now brighter) background**:
  - Remove/!neutralize the opaque `body::before` veil (or make it transparent immediately).
  - Instead, start the app stage hidden and fade it in: in `game-page-shared.css` add
    `.gp{ opacity:0; transition:opacity .4s ease; } html.nyx-app-ready .gp{ opacity:1; }`
    (the `nyx-app-ready` class is already set on mount in `nyx-app.jsx`'s first `useEffect`).
  - Net: the bright background shows instantly (no black, no jarring bright→dim flash because the
    bg brightness is now the desired final look), and content fades in when ready.
  - Keep a failsafe so content always shows even if JS fails (e.g. `@keyframes` that forces
    `.gp{opacity:1}` after ~5s, or set opacity:1 by default and only fade when a `js`-ready class is present).

### 2.3 Topbar rework  (`nyx-app.jsx` ~L1221-1234, CSS `.gp-topbar`/`.tb-*` in game-page-shared.css)
Current: left `.tb-eye` (links `index.html`), center `GPGameRail`, right `.tb-right` (plate + "Nyx" wm).
Target:
- [ ] **Left cluster** = the living **eye behind the "Nyx" text**, both on the top-left, text pulled
  close to the edge of the plate it sits on. Resize the eye to ≈ the Nyx text height (slightly larger).
  Move the `.tb-eye` (`#tbBall` layers) to sit *behind* the wordmark (z-index/stacking), grouped with it.
- [ ] **Right** = the **Pengo icon** (`Site/assets/icon/pengo.png`).
- [ ] **Back-to-index click targets:** the Nyx text, the eye, AND the Pengo icon all link to
  `index.html` (wrap each in an `<a href="index.html">` or one shared handler). **The game rail
  cards in the center must NOT navigate to index** — keep `GPGameRail`'s per-game switching.
- [ ] Keep the center `GPGameRail` as-is.
- CSS: rework `.gp-topbar` grid so left = eye+wordmark, right = pengo icon; update `.tb-eye`,
  `.tb-right`, add a `.tb-pengo`. The eye uses the `.elayer` mask layers (ball/lid/drips).

### 2.4 Mockups (produce, don't implement yet — user chooses)
- [ ] **Redemption-code panel: 6 mockups.** (3 were shown round-1: compact rows / reward cards /
  voucher stubs. Add 3 more, e.g. dense table, copy-on-click chips, expandable list.) Implement the
  chosen one in `CodeCardRow`/`CodesPanel` (`nyx-app.jsx` ~L652-734) + `.gp-code` CSS.
- [ ] **Banner panel: 6 mockups.** Current banners render via `GPBanner`/`bannerPhaseCards`
  (`nyx-app.jsx`, `OverviewAside`). Mock 6 layouts (e.g. hero card, split 5★/4★, timeline, compact
  list, dual-banner, art-forward). Implement chosen one in `GPBanner` + `.gp-ban*`/`.sim-ban*` CSS.

---

## Phase 3 — Character popout (`char-materials.jsx`, CSS `cm-*`)

- [ ] **3.1 Remove the empty box below talents.** Investigate the talent ledger row: the
  `.cm-talent-triplet` container (gi) or an empty `.cm-mats`/placeholder renders an empty box when a
  section has no mats. Find the stray empty element under the talents row and conditionally omit it
  (render only when it has content).
- [ ] **3.2 Broken "obtaining" text + icon-vs-text.** In `MatTile` (~L248-280) the hover `.src-tip`
  renders `.src-row`s as `{detail.icon && <img/>}<em>{detail.name}</em>`. Change so **when a row has
  an icon, do not render the `<em>` text** (icon only). Also fix the broken source strings (see
  attached screenshot from user — likely malformed multi-source concatenation; tighten
  `cmCleanSourceName`/`cmMatSourceInfo` so junk/duplicated/overlong blurbs are dropped).
- [ ] **3.3 Genshin talent source = "[Region] Talent Domain".** For talent-book materials (gi),
  the obtaining text should just read e.g. `Mondstadt Talent Domain`. Derive the region from the
  character's talent-domain data (`cfg.talentDomains[].name`/region, used at ~L1013, L1243). Map the
  talent-book material → its domain region and render `"<Region> Talent Domain"` instead of scraped text.
- [ ] **3.4 Remove "Source details pending." everywhere.** In `cmMatSourceInfo` change the final
  `return 'Source details pending.'` to `return ''`; in `MatTile`/`cmMatSourceDetails` don't render
  the `.src-tip` (or the `<em>`) when the cleaned source is empty.
- [ ] **3.5 Character icon + inline element/type/weapon in the header (no container).** In the popout
  header (`.cm-ledger-title` / `.cm-pop-name` ~L1340s) put the character's **circle icon behind the
  name**, then the element/type/weapon icons **inline after the name** — remove the `.cm-pop-chip
  icon-only` disc containers (render bare `CMMetaIcon` imgs in a row, no circular chip bg). Use
  `cmArtFor(view)` / `view.icon`/`circle` for the circle icon.
- [ ] **3.6 Signature disclaimer copy.** At ~L1531 (`.cm-sig-disclaimer`) change to two lines:
  line 1 `Signature is an automated educated guess and could be incorrect.` with **"automated"
  underlined** (`<u>automated</u>`); line 2 `Please double check other sources before making decisions.`
- [ ] **3.7 HSR Traces input (like GI talents).** HSR currently shows talents as "all to max". Add,
  for `gk==='hsr'`, a **"Max"** toggle (default on → all traces maxed) plus a Genshin-style
  **Basic / Skill / Ultimate / Talent** typeable input row (mirror `giTargets`/`cm-talent-triplet`
  but 4 entries). Recompute trace mats from the chosen levels (needs HSR trace-stage data analogous
  to gi `talentStages`; if not present, compute proportionally or add to generator). Use **Nanoka
  trace icons** if not already available (`Nanoka/hsr/live/...` skill icons; see `view.skillIcons`).
- [ ] **3.8 Levels writable, not click-to-cycle; make editability obvious.** The ascension Lv chip
  (`.cm-asc-level`, ~L1427-1429, `giAscLevel`/`cmNextAscLevel`) is click-to-cycle → convert to a
  **typeable input** (like the talent triplet `<input type=number>`), clamped to valid ascension
  breakpoints, with the purple "editable" box + a hint (placeholder/caret/tiny "edit" affordance).
  Apply the same writable treatment to talent/trace level inputs. Add a small visible cue (e.g. a
  pencil icon or "type to edit" microcopy) so users know the numbers are editable.
- [ ] **3.9 Weapon name auto-shrink.** `.cm-weapon-pick span` (the weapon/light-cone name) should
  shrink font-size when it can't fit. Add CSS clamp / `text-overflow` is already there — instead
  reduce font-size for long names (JS measure, or CSS `clamp()` + allow 2 lines, or a
  fit-to-width). Goal: full name visible.
- [ ] **3.10 Per-game level caps (verify + fix).** There is **no per-game max-level config** today;
  ascension shows "Lv.90" for all non-gi and the gi selector goes to 90. Add a per-game config:
  GI 90, **HSR 80**, ZZZ 60, WuWa 90, Endfield (verify — likely 80). Wire it into the ascension label
  (`<span>Lv.90</span>` ~L1429 → per-game cap) and the level selector breakpoints. The gi ascension
  phase pattern (`CM_GI_ASC_PATTERN`, 6 phases→90) is GI-specific; for other games either add their
  own phase pattern (HSR 6 promotions→80, ZZZ 5→60, WuWa→90) or, until then, just show the correct
  capped "Lv X" label and keep mats at full. **Double-check every game's level/ascension numbers.**

---

## Phase 4 — Data accuracy

- [ ] **4.1 Stale character info (e.g. Himeko, Nova, Gilgamesh).** Data comes from the Nanoka +
  Prydwen scrapes → `generate-site-data.mjs`. Re-run the relevant scrapers / refresh `Database/`
  inputs and regenerate. Audit these named characters for outdated element/path/weapon/material data;
  trace where each field originates (Nanoka `live/characters.json` vs Prydwen) and fix the stale source.
- [ ] **4.2 ZZZ: drop Prydwen-only placeholder agents; only show Nanoka-backed ones.** ZZZ roster
  is missing icons/info for entries that exist only in Prydwen (placeholders). In the generator's
  ZZZ roster build, **filter the roster to agents present in `Nanoka/zzz/live/...`** (i.e. require a
  Nanoka record / real icon); drop Prydwen-only placeholders so they don't render. Confirm the
  remaining ZZZ agents all have icons + meta. (Mirror for other games only if asked.)

---

## Final steps
- [ ] `npm --prefix Site run build`; bump cache token `ui4 → ui5` across `Site/pages/*.html`.
- [ ] Verify in preview (`preview_eval`, not screenshots) per item.
- [ ] Commit per phase (or one commit) with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; push `main`.
- [ ] If asked to deploy: `npm --prefix Site run build:deploy` + `npx wrangler deploy`; verify live with `curl -L https://pengo.gg/...`.

## Open questions / needs from user
- The "broken obtaining text" screenshot (3.2) was referenced but not attached — get it to pin the exact malformation.
- Which of the 6 code mockups and 6 banner mockups to implement (3 code variants already exist; new ones below).
- Endfield max level confirmation (3.10).
