# design-sync notes — Nyxarium (nyxarium-site)

Synced to claude.ai/design project **"Nyx Design System"** (`ad9ae6a5-c60b-46e6-98af-dee5d68e5371`).

## Scope decision (2026-07-16, user-directed)

- Only components the LIVE pengo.gg pages actually render are synced: **GPRoot, GPSec,
  GPSectionNavButton, GPMedallion, GPMedSim, GPGameRail** (6). The other 9-10 exports in
  game-page-components.jsx (GPHex, GPBack, GPLogoBack, GPSwitcher, GPWorldRows, GPFnRows,
  GPFnTabs, GPFav, GPMoreFavs, GPCodes) are the old "Genshin placeholder" set — verified
  absent from every live page (class census via browser). User chose to REMOVE them from
  the design project. Their authored previews stay in `.design-sync/previews/` for easy
  re-add.
- `GPSectionNavButton` (the real sidebar nav) was added to the source file's
  `Object.assign(window, …)` list — a deliberate one-line source change, user-approved.
- The real page skeleton (gp-topbar/gp-layout/gp-side-nav/gp-main-pane/gp-overview-*/
  gp-reset-*/gp-codes-table) is inline JSX in `nyx-app.jsx`, not components — taught as
  class vocabulary in conventions.md instead. If those ever get extracted into real
  components, sync them and slim the conventions skeleton section.
- Live codes UI is `gp-codes-table`/`gp-code-row` (nyx-app.jsx), NOT the placeholder
  GPCodes (`gp-codes-stack`). Live GPRoot pages render their background via `nyx-bgwrap`
  (app shell), not GPRoot's own `.gp-bg` — GPRoot still ships as the frame component.

## Repo shape gotchas

- This is an app repo, not a component library. The shared components live in
  `Site/src/components/game-page-components.jsx` and publish themselves onto `window`
  (no ES exports). `Site/ds-entry.jsx` is the design-sync shim entry that imports that
  file and re-exports the live GP* components — pass it as `--entry Site/ds-entry.jsx`.
- The entry must live inside `Site/` (next to a `package.json`) — the `.d.ts` extractor
  walks up from the entry to find the package.
- All props contracts are hand-written in `cfg.dtsPropsFor` (no TypeScript in the repo).
  If a component's props change in source, update the config too.
- `cfg.tokensPkg` is `".."` — a deliberate trick: tokens.css lives in the same package,
  and copyTokens only reads relative to `node_modules/<tokensPkg>`, so `..` resolves back
  to `Site/`.
- `@types/react` must be present in `Site/node_modules` for prop extraction; it is
  installed with `npm i --no-save @types/react` (NOT in package.json — rerun after a
  fresh `npm ci`).

## Asset handling (the big one)

- Site CSS/JSX reference images at site-relative paths (`../assets/…`) that don't exist
  in the design environment. Three mechanisms fix this:
  1. `.design-sync/overrides/css.mjs` fork — inlines CSS image url()s as data URIs,
     preferring compressed stand-ins from `.design-sync/assets/` (same basename),
     cap 350KB. `backgroundnyx.png` there is a 1600px JPEG re-encode of the 12MB original.
  2. `.design-sync/ds-assets.mjs` (generated, committed) — base64 96px copies of the six
     game icons + nyx_logo + a 420px skirk.jpg. The shim entry patches
     `window.GP_GAMES[].icon` with these and CSS-replaces GPLogoBack's `<img>`.
  3. The shim adds `nyx-app-ready` to `<html>` — without it `.gp` (GPRoot) is invisible
     for 5s (the site's reveal-animation fallback).
- If site art changes, regenerate `.design-sync/assets/` + `ds-assets.mjs`
  (System.Drawing resize via PowerShell; see git history of this sync).

## Known render warns (triaged, expected on every sync)

- `[TOKENS_MISSING] 25 CSS custom properties … --pct, --x, --size, --dur, --delay, --alpha,
  --static-y, --cmf-fill, …` — all runtime-set animation/JS vars, not real tokens.
- `[FONT_MISSING] "Cascadia Mono", "Arial Narrow"` — deliberate system-font references in
  fallback stacks (`--nyx-font-mono`, and the compat family hashes). No font files exist to
  ship; designs render with the next fallback on non-Windows. User informed 2026-07-16.

## Preview conventions

- Every authored preview wraps stories in a dark panel (`var(--nyx-color-canvas)`)
  because the components are designed for dark pages. Panels for text-bearing
  components that don't set their own font (GPFnRows, GPWorldRows) must also set
  `fontFamily: var(--nyx-font-ui)` — on the site `.gp` provides it.
- GPMedallion/GPMoreFavs previews pull game objects/icons from `window.GP_GAMES`
  (already icon-patched by the shim).
- GPFav preview imports `SKIRK_ART` from `../ds-assets.mjs` — always pass `art`.
- Hover/mouse-follow states (GPMedSim gaze, hex hover glow) can't render statically — skipped.
- cardMode column overrides: GPRoot, GPSec, GPSectionNavButton
  (wide stories crop in the grid otherwise).

## Re-sync risks

- `ds-assets.mjs` + `.design-sync/assets/` are frozen copies of site art — they silently
  go stale if icons/backgrounds/skirk art change upstream.
- `dtsPropsFor` is a hand-maintained duplicate of the component props — drifts silently
  when `game-page-components.jsx` changes.
- The css.mjs fork hardcodes `Site/src/styles` as the url() resolution base and must be
  re-diffed against the bundled `lib/css.mjs` on converter updates.
- GP_CODES (redemption codes) are baked into the bundle at build time — a re-sync
  refreshes them, but between syncs the design project shows the codes from the last sync.
- Build assumed node 20.18, playwright@1.56.0 (matches cached chromium-1194 in
  %LOCALAPPDATA%\ms-playwright).
- Verified on 2026-07-16; render check was full (6/6), all cells graded good.
- If new components get added to the live pages, add them to the source file's
  Object.assign + the shim exports + componentSrcMap + dtsPropsFor, then re-sync.

## Re-sync command

```sh
# from C:\Pengo\Nyx (re-stage .ds-sync scripts + deps first if missing)
node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules Site/node_modules \
  --entry Site/ds-entry.jsx --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json
```
