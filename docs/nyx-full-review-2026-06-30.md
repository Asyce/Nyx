# Nyx Full Review and Implementation Plan

Date: 2026-06-30

Current product-direction updates after user feedback are in `docs/report-feedback-decisions-2026-06-30.md`. That file supersedes earlier wording where it differs, especially around keeping both quick PowerShell and safer verified import paths.

Scope: `C:\Pengo\Nyx` only. The old `AI\As-I-ve-Hoarded` project was not reviewed as a target, except where Nyx still contains direct legacy references or inherited code paths.

This is a planning and review document. No application code was changed as part of this review.

## Executive summary

Nyx is already a visually distinctive, usable cross-game companion site. The strongest parts are the art direction, the live/beta material concept, the game-specific gacha trackers, the local-first pull storage, and the scheduled scraper/deploy pipeline. It feels like a real product, not a placeholder.

The main problems are not small styling details. The highest-risk work is about trust, data correctness, deployment size, mobile ergonomics, and maintainability:

1. The pull-history helper still promotes remote `iex (irm ...)` commands from the old `asyce.com/asivepulled` project, while the safer Pengo-hosted script is hidden behind a disclosure.
2. `npm run validate` passes even when banner data is currently `stale`, `invalid`, or `unavailable`; the workflows then build and deploy anyway.
3. The deploy artifact is very large: 6,090 files and about 708 MB for `.deploy/pengo`.
4. Mobile game pages are still a desktop stage squeezed into a phone: the Nyx wordmark clips, the Pengo menu and Live/Beta switch are hidden, rails are horizontally scrollable without much affordance, and several touch targets are small.
5. The wish/gacha tracker can surface old sample/demo data as if it were real history, and the result-state header says only `Import`, which weakens user trust.
6. The workflows deploy before committing refreshed data, use `npm install` instead of `npm ci`, and have limited test coverage outside scraper normalization/filtering.
7. The Worker origin allowlist still includes old Asyce/Nyxarium domains and allows requests with no `Origin`, expanding the allowed API surface.
8. The frontend is concentrated in a few very large files and custom global bundles, with no lint, no type checks, no component tests, no source maps, and no real local clean-route dev server.

The recommended implementation order is: fix trust and data freshness first, then mobile shell, then CI/deploy reliability, then asset performance, then architecture/tooling, then larger feature expansion.

## What I checked

### Tooling and automated checks

- Installed and authenticated CodeRabbit CLI in WSL.
- Confirmed `coderabbit doctor` passes in `C:\Pengo\Nyx`: 9 passed, 0 warnings, 0 failed.
- Tried CodeRabbit local review on the clean repo. The CLI is optimized for local Git diffs/PR-style review, and the clean whole-repo run did not produce useful output in the allotted run. Manual review and local verification are the basis of this report.
- Ran `Scraper` tests: 37 tests passed.
- Ran data validation: it passed, but diagnostics reported stale/invalid/unavailable banner states.
- Ran `Site` build and deploy packaging.
- Ran `npm audit` for `Scraper` and `Site`: 0 known vulnerabilities reported.
- Ran `npm outdated`: `Site` has React 18.3.1 while React 19.2.7 is latest; `Scraper` had no outdated package output.
- Started a local static server and verified major pages/assets return 200.
- Used browser inspection across desktop and mobile viewports for homepage, game pages, materials, the material popout, wish tracker, and database library.

### Key local results

- `Scraper npm test`: pass, 37 tests.
- `Scraper npm run validate`: pass, but banner diagnostics:
  - `hsr`: stale
  - `genshin`: stale
  - `wuwa`: invalid
  - `zzz`: stale
  - `endfield`: unavailable
- `Site build-deploy`: produced `.deploy/pengo` with 6,090 files and about 707.95 MB.
- `.deploy/pengo` asset-reference copy: 5,935 referenced Database assets copied, 0 missing references.
- `inject-seo`: injected SEO into 7 pages and wrote a 7-route sitemap.
- Local clean route check:
  - `http://127.0.0.1:5173/Site/pages/genshin.html`: 200
  - `http://127.0.0.1:5173/genshin`: 404 under the current Python static server

### Repository scale

- Git-tracked files: 23,693.
- Tracked extension profile:
  - `.webp`: 16,636
  - `.json`: 5,368
  - `.png`: 1,270
  - `.html`: 278
  - `.jpg`: 54
  - `.mjs`: 26
  - `.js`: 21
  - `.cjs`: 12
  - `.jsx`: 5
  - `.css`: 3
- Active repo size excluding `.git`, `node_modules`, `.wrangler`, and `.deploy`: about 1.69 GB.
- Largest non-generated/site assets inspected:
  - `Site/assets/bg/page_bg.jpg`: 15.32 MB
  - `Site/assets/bg/backgroundnyx.png`: 11.82 MB
  - `Site/assets/fonts/HSR.ttf`: 11.53 MB
  - `Site/assets/fonts/GI.ttf`: 6.90 MB
- Largest generated data:
  - `Site/src/data/generated/cm-data-gi.js`: 12.37 MB, 308,970 lines
  - `Site/src/data/generated/cm-data-hsr.js`: 2.70 MB, 87,272 lines
  - `Site/src/data/generated/nyx-data.js`: 0.99 MB, 22,305 lines

## Current architecture map

### Top-level project

- `Site/`: static React-powered frontend, custom esbuild transform, static pages, assets, generated data, SEO injection, deploy packaging.
- `Scraper/`: scheduled data ingestion for codes, banners, Nanoka, Prydwen, Endfield wiki, wiki titles, and tests.
- `Database/`: source-of-truth scraped data and large image asset store.
- `worker/`: Cloudflare Worker for `/api/gacha/*` proxy endpoints and future account endpoints.
- `.github/workflows/`: scheduled data/code/roster refreshes and deploys.
- `.deploy/pengo`: generated deploy artifact.

### Frontend build model

`Site/package.json` uses a custom build:

- `generate:data`: generates `cm-data-*.js` and `nyx-data.js`.
- `generate:weapons`: generates pull-weapon metadata.
- `build-site.mjs`: copies React UMD builds, copies generated data, and concatenates JSX-transformed source files into `game-page.bundle.js`.
- `build-deploy.mjs`: copies pages/assets/dist/styles/public and scans built text for `Database/...` asset references.
- `inject-seo.mjs`: modifies deploy HTML and writes sitemap.

This is simple and works, but it limits code splitting, source maps, typed boundaries, dependency hygiene, and testability.

### Runtime pages

- `Site/pages/index.html`: standalone landing/game selector page with inline CSS and JS.
- `Site/pages/nyx.html`: Nyx hub.
- `Site/pages/genshin.html`, `hsr.html`, `zzz.html`, `wuwa.html`, `endfield.html`: game pages. These are mostly shells that load generated data and `game-page.bundle.js`.
- Clean production slugs map through Cloudflare/static asset behavior and `_redirects`.

### Main frontend files

- `Site/src/app/nyx-app.jsx`: main shell, game registry, overview, codes, banners, database library, nav, settings, hub tabs.
- `Site/src/features/materials/char-materials.jsx`: character material roster and popout.
- `Site/src/features/gacha/gacha-tracker.jsx`: import flow, tracker UI, results rendering.
- `Site/src/features/gacha/pulls-engine.js`: parser/import adapters for Genshin, HSR, ZZZ, Wuthering Waves.
- `Site/src/features/gacha/pulls-storage.js`: IndexedDB local-first storage.
- `Site/src/features/gacha/pulls-overview.jsx`: cross-game pull summary on the Nyx hub.
- `Site/src/components/game-page-components.jsx`: shared visual components.
- `Site/src/styles/game-page-shared.css`: the shared page/theme CSS.

### Data currently surfaced

Generated character material payload counts:

- Arknights: Endfield: 28 roster entries, 0 weapons, 59 boss groups.
- Genshin Impact: 116 roster entries, 237 weapons, 7 talent domains, 40 boss groups, 14 weekly bosses.
- Honkai: Star Rail: 86 roster entries, 162 weapons, 7 boss groups, 8 weekly bosses.
- Wuthering Waves: 57 roster entries.
- Zenless Zone Zero: 53 roster entries, 10 boss groups, 10 weekly bosses.

Beta payload counts:

- Genshin: 1 roster entry.
- HSR: 15 roster entries.
- Wuthering Waves: 12 roster entries.
- ZZZ: 1 roster entry.

Generated `NYX_DB` summary:

- Generated at `2026-06-29T20:26:08.883Z`.
- Providers: `Prydwen`, `Nanoka`, `EndfieldWiki`.
- UI code counts in generated payload: GI 4, HSR 8, ZZZ 6, Wuwa 0, Endfield 3.
- Banner freshness in generated payload: HSR stale, GI stale, Wuwa invalid, ZZZ stale, Endfield unavailable.

## Prioritized findings

### P0 - Trust: default pull helper uses old remote execution commands

Evidence:

- `Site/src/features/gacha/pulls-engine.js` registers helper commands like:
  - `iex (irm 'https://asyce.com/asivepulled/scripts/genshin.ps1')`
  - `iex (irm 'https://asyce.com/asivepulled/scripts/hsr.ps1')`
  - `iex (irm 'https://asyce.com/asivepulled/scripts/zzz.ps1')`
  - `iex (irm 'https://asyce.com/asivepulled/scripts/wuwa.ps1')`
- The safer local script is present at `Site/public/scripts/pengo-pulls.ps1`, and its SHA-256 in `pulls-engine.js` matches the actual file.
- The UI shows the remote helper command first, while the safer download-and-verify flow is behind a `details` disclosure.
- `pengo-pulls.ps1` still contains user-facing Asyce/As I've Pulled wording and tells users to paste into the old Asyce URL.

Impact:

- This is the biggest user-trust issue in the project.
- Even if the old domain is controlled by the same owner, a new Pengo/Nyx product should not ask users to run old-brand remote scripts as the main path.
- `iex (irm ...)` is the exact pattern security-conscious users are trained to distrust.
- It weakens the privacy claim beside the import flow.

Recommended fix:

1. Remove the `helperCommand` remote one-liners from each adapter.
2. Promote the versioned local `pengo-pulls.ps1` download/verify/run flow as the primary path.
3. Update all script comments and output to Pengo/Nyx URLs and language.
4. Keep the SHA-256 visible, but also add a build-time check that fails if the hardcoded hash does not match the file.
5. Add a plain "What this script reads" disclosure in the UI before the run command.
6. Add a non-PowerShell import path where possible: file upload/import should be visible at the same level as URL import, not hidden behind secondary text.

Acceptance criteria:

- No `asyce.com/asivepulled/scripts` command appears in the generated app.
- `pengo-pulls.ps1` output references `pengo.gg`, not `asyce.com`.
- A user can import by downloading a local script, verifying it, running it, and pasting the copied URL.
- The default UI no longer encourages `iex (irm ...)`.

### P0 - Data gate passes stale, invalid, and unavailable banners

Evidence:

- `Scraper/validate-data.cjs` comments explicitly say it does not fail merely because a game is unavailable.
- The current validation run passed while showing:
  - HSR stale
  - Genshin stale
  - Wuwa invalid
  - ZZZ stale
  - Endfield unavailable
- `data-refresh.yml` and `roster-sync.yml` run validation, build, deploy, then commit.
- The UI does render banner freshness warnings, which is good, but the deploy pipeline still treats these states as acceptable.

Impact:

- The site can deploy a fresh build that knowingly contains stale or invalid banner data.
- Users may see polished banner cards and only a warning line; the visual hierarchy still makes the card feel authoritative.
- Scheduled automation can make the live site look updated while core time-sensitive data is not updated.

Recommended fix:

Split validation into two gates:

1. Structural validation:
   - JSON parseable.
   - Expected game keys present.
   - No empty global collapse.
   - No nameless characters.
   - No code entries without code.
   - This should remain permissive and preserve last-known-good behavior.

2. Freshness/deploy validation:
   - Fail or block deploy on `invalid`.
   - Fail or require explicit override when a normally-supported game is `stale`.
   - Allow `unavailable` only for games with a declared policy, such as Endfield pre-release, and surface that policy in data.

Implementation detail:

- Add a `--strict-freshness` flag to `validate-data.cjs`.
- Workflows should run `npm run validate` after scrape, then `npm run validate -- --strict-freshness` before deploy.
- If freshness fails, commit scraper diagnostics if useful, but skip live deploy.

Acceptance criteria:

- Wuwa `invalid` blocks deploy.
- Genshin/HSR/ZZZ stale states block deploy unless a workflow input explicitly overrides.
- Endfield `unavailable` is allowed only when a policy field marks it as expected.
- UI warnings remain for non-fatal degraded states.

### P0 - Deploy artifact is too large for frequent scheduled deploys

Evidence:

- `.deploy/pengo`: 6,090 files, about 707.95 MB.
- `build-deploy.mjs` copies all `Site/assets`, all `Site/dist`, all `src/styles`, `public`, then scans built text for referenced `Database/...` assets and copies thousands more.
- The deploy step reported 5,935 referenced Database assets copied.
- `cm-data-gi.js` alone is 12.37 MB and 308,970 lines.
- Large fonts and backgrounds are shipped without visible subsetting/variant strategy.

Impact:

- Every scheduled refresh can create and deploy a huge payload.
- Build/deploy time increases.
- Cloudflare deployment failures become more likely as assets grow.
- Users may pay the cost of large data even when they only need a small feature.
- The codebase becomes harder to clone, review, and cache efficiently.

Recommended fix:

1. Set budgets:
   - Deploy artifact max size.
   - JS payload max size per route.
   - Initial page transfer max size.
   - Image/font max size.
2. Move generated game data from monolithic JS globals to lazy JSON chunks or route/feature chunks.
3. Load materials data only when the materials tab opens.
4. Load pull weapon metadata only when the tracker opens.
5. Use hashed immutable assets instead of manual `?v=...` cache busting.
6. Avoid copying the whole `Site/assets` tree if only a subset is referenced.
7. Consider putting large stable Database assets behind a static asset/CDN strategy separate from frequent Worker asset deploys.
8. Convert oversized PNG/JPG backgrounds to responsive WebP/AVIF variants.
9. Subset fonts or ship smaller WOFF2 builds.

Acceptance criteria:

- Opening a game overview does not load all material data for that game.
- Deploy artifact size is tracked and fails CI when above budget.
- A code-only data refresh does not require republishing hundreds of MB of unchanged art.

### P0 - Mobile game pages hide important controls and clip the brand

Evidence:

- Browser mobile verification at 390x844 showed the top-left wordmark clipped as `-Nyx`.
- `game-page-shared.css` compact rules set `.gp-topbar .tb-brand` very narrow while `.tb-center` starts at `margin-left:128px`.
- Compact stage rules explicitly hide `.gp-topbar .tb-pengo` and `.gp-corner`.
- The hidden `.gp-corner` contains the Pengo menu, Ko-fi link, and Live/Beta toggle.
- The mobile rail is horizontally scrollable and some game medallions are offscreen.
- Code controls and rows become dense on mobile.

Impact:

- Mobile users lose access to Pengo settings and Live/Beta selection.
- The brand treatment looks broken on small screens.
- Discoverability suffers because horizontal scroll is not obvious.
- Dense code rows can be hard to tap.

Recommended fix:

1. Create a real mobile topbar instead of shrinking the desktop topbar.
2. Use a compact brand lockup: Pengo icon + `Nyx`, or just `Nyx` plus active game chip.
3. Move the game rail into a second row with visible fade/scroll indicators or a menu.
4. Keep Pengo settings accessible on mobile via a top-right icon button.
5. Keep Live/Beta accessible in the materials tab header or mobile bottom bar.
6. Increase touch targets for copy buttons, code links, checkboxes, and nav rows to at least 40-44 CSS px.
7. Reduce nested scroll panes on mobile where possible. Prefer normal page flow for long content.

Acceptance criteria:

- 390x844 and 430x932 screenshots show no clipped brand text.
- Pengo menu can be opened on mobile.
- Live/Beta can be changed on mobile for games with beta data.
- Top rail has a clear scroll or menu affordance.

### P1 - Wish tracker sample/legacy data can look real

Evidence:

- `GachaTracker` loads real IndexedDB data first, then falls back to old localStorage sample data (`nyx-tracker-<game>`).
- `runSample()` writes simulated data to the same old localStorage key.
- If no adapter/store is available, `runImport()` calls `runSample()`.
- Browser verification showed result-state data on first inspection in the local browser; that can happen from stored import or sample history, and the UI did not visibly identify sample state.
- In result state, the title area becomes a button labeled `Import`, which does not describe the current view.

Impact:

- Users can mistake demo data for imported account history.
- Trust in pity/50:50 calculations depends heavily on clear provenance.
- Unsupported/future games should not silently show sample histories as if import succeeded.

Recommended fix:

1. Store sample data with an explicit `{ sample: true }` metadata marker.
2. Never auto-load sample history into the main result state without a visible "Sample data" banner.
3. Migrate old localStorage demo keys to a separate sample namespace or clear them on first real app load.
4. If an adapter is missing, show "Import not available for this game yet", not sample results.
5. Rename the result header from `Import` to the account/game context, and provide a distinct `Import / Manage Data` action.
6. Add a visible data provenance strip:
   - source: live URL import, file import, sample
   - imported at
   - UID/account nickname
   - local-only storage note
7. Add a "Delete this local history" and "Export" action near the same area.

Acceptance criteria:

- Sample data is always visibly labeled.
- Unsupported games cannot silently generate sample data through the main import button.
- Result-state header tells the user which game/account/history is being viewed.

### P1 - CI deploys before committing refreshed data

Evidence:

- `data-refresh.yml` builds and deploys before `Commit refreshed data`.
- `roster-sync.yml` also builds and deploys before committing.
- `code-watch.yml` deploys before committing refreshed codes.
- If deploy succeeds and the subsequent push fails, live data can differ from the repository.

Impact:

- The repository may not match what is live.
- Debugging live data can be harder.
- A failed push after deploy can leave operators with no committed audit trail.

Recommended fix:

1. Scrape and validate.
2. Commit data changes.
3. Pull/rebase or use a bot branch/PR flow.
4. Build from the committed tree.
5. Deploy only after commit/push succeeds.
6. Record the commit SHA in the deployed HTML or a small `/version.json`.

Acceptance criteria:

- Every scheduled deploy maps to a committed SHA.
- If push fails, deploy is skipped.
- Live site exposes the source commit.

### P1 - Workflows use `npm install` instead of `npm ci`

Evidence:

- `data-refresh.yml`, `roster-sync.yml`, and `code-watch.yml` run `npm install --no-audit --no-fund`.
- Both `Site` and `Scraper` have lockfiles.

Impact:

- CI dependency resolution is less reproducible.
- Scheduled jobs can change dependency trees without a lockfile update.
- Debugging scraper/build failures becomes harder.

Recommended fix:

- Replace CI `npm install` with `npm ci --no-audit --no-fund`.
- Keep `npm install` for local dependency updates only.

Acceptance criteria:

- CI uses lockfiles exactly.
- Dependency update PRs are the only place package versions change.

### P1 - Worker allowlist includes old origins and no-Origin requests

Evidence:

- `worker/worker.js` trusts `asyce.com`, `nyxarium.com`, and Pages preview origins.
- `originAllowed(origin, env)` returns true for missing `Origin`.
- Trusted preview regex permits `*.asyce.pages.dev` and `*.nyxarium.pages.dev`.
- Worker comments and upstream User-Agent still mention Nyxarium.

Impact:

- API access surface is broader than the current Pengo product needs.
- Browser CORS is controlled, but direct server-to-server requests with no Origin are accepted.
- Old domains can keep using the proxy if they are still reachable.

Recommended fix:

1. Replace the hardcoded legacy origins with Pengo production and explicit environment-configured preview origins.
2. Decide whether no-Origin requests are allowed:
   - If yes, document that this is intentional server-side API access and rely on rate limits.
   - If no, reject no-Origin for `/api/gacha/*` except local/dev or signed internal probes.
3. Update comments and User-Agent to Pengo/Nyx.
4. Add Worker tests for CORS, body caps, param filtering, rate limiting behavior, OPTIONS, 405, and no-Origin policy.

Acceptance criteria:

- Old origins are not trusted by default.
- No-Origin policy is explicit and tested.
- Worker tests run in CI.

### P1 - Local dev server does not support clean app routes

Evidence:

- Homepage links point to clean routes like `/genshin`, `/hsr`, `/nyx`.
- Current `npm run serve` uses `python -m http.server 5173 --directory ..`.
- Under that server, `/Site/pages/genshin.html` works but `/genshin` returns 404.
- Production likely works through Cloudflare asset HTML handling and redirects.

Impact:

- Local browser testing of the normal user path fails.
- It is easy to miss navigation regressions.
- QA differs from production routing.

Recommended fix:

1. Replace the Python dev server with a tiny Node static server that rewrites:
   - `/` to `Site/pages/index.html`
   - `/genshin` to `Site/pages/genshin.html`
   - `/hsr` to `Site/pages/hsr.html`
   - `/zzz` to `Site/pages/zzz.html`
   - `/wuwa` to `Site/pages/wuwa.html`
   - `/endfield` to `Site/pages/endfield.html`
   - `/nyx` to `Site/pages/nyx.html`
2. Alternatively, add a `serve:deploy` script that serves `.deploy/pengo` after `build:deploy`.
3. Add a route smoke test that checks all clean routes return 200 locally.

Acceptance criteria:

- `npm run serve` supports the same clean URLs users click.
- Local route smoke tests are in CI or a pre-deploy check.

### P1 - Main frontend code is too concentrated

Evidence:

- `Site/src/app/nyx-app.jsx`: 1,625 lines.
- `Site/src/features/materials/char-materials.jsx`: 1,970 lines.
- `Site/src/styles/game-page-shared.css`: 2,605 lines.
- `Site/tools/generate-site-data.mjs`: 2,831 lines.
- `Scraper/codes/scrape.cjs`: 1,366 lines.
- `Scraper/banners/scrape.cjs`: 1,098 lines.

Impact:

- Small changes have high regression risk.
- It is hard to test behavior in isolation.
- CSS cascade changes are hard to reason about.
- Feature work tends to accumulate in the same files.

Recommended fix:

Frontend splits:

- `app/shell`: topbar, game rail, side nav, stage/layout.
- `app/overview`: favorites, codes summary, banners summary.
- `app/codes`: code rows, rewards, copy behavior.
- `app/banners`: freshness, phase cards, banner timeline.
- `features/materials`: roster grid, filters, calculator, popout, weapon picker.
- `features/gacha`: import flow, account/data management, results overview, archive/history.
- `features/database`: collection tabs, search, cards, filters.
- `settings`: Pengo menu, identity settings, display settings.

CSS splits:

- `tokens.css`
- `shell.css`
- `overview.css`
- `codes.css`
- `banners.css`
- `materials.css`
- `gacha-tracker.css`
- `database.css`
- `mobile.css`

Data generator splits:

- source loaders
- game-specific normalizers
- asset/path resolver
- beta diff builder
- generated JS/JSON writer
- validation/snapshot tests

Acceptance criteria:

- Most new feature work happens in files below 500-800 lines.
- Shared contracts are documented and tested.
- CSS modules/sections map clearly to UI surfaces.

### P1 - No frontend lint/type/test layer

Evidence:

- `Site/package.json` has scripts for data generation, build, and serve only.
- No `lint`, `test`, `typecheck`, or format scripts.
- `Scraper` has useful Node tests; `Site` does not have equivalent component/unit tests.

Impact:

- UI regressions are mostly caught manually.
- Data-shape mistakes can reach runtime.
- Refactors across giant files are risky.

Recommended fix:

1. Add ESLint with React rules and a project-specific globals config for `window.*` globals if the current bundle model stays.
2. Add Prettier or a very small formatting policy.
3. Add TypeScript incrementally or JSDoc `// @ts-check` for high-risk files.
4. Add Vitest for pure functions:
   - `dbCodes`
   - `bannerFreshness`
   - `bannerPhaseCards`
   - gacha parser/normalizer functions
   - storage merge/dedupe logic
5. Add Playwright smoke tests:
   - all clean routes load
   - no console errors
   - no broken images above the fold
   - mobile topbar not clipped
   - Pengo menu accessible
   - Live/Beta visible where expected
   - material popout opens
   - tracker import view renders

Acceptance criteria:

- CI fails on lint/test/build failures.
- At least one desktop and one mobile Playwright screenshot pass is run before deploy.

### P2 - Manual cache-busting is brittle

Evidence:

- Pages reference assets with a manual token like `?v=20260630-wish01`.
- Historical docs mention bumping the token after changing dist/CSS.

Impact:

- Easy to forget cache-bust updates.
- Unchanged assets can still get new query tokens.
- Browser cache behavior becomes hard to reason about.

Recommended fix:

1. Generate content-hashed filenames for `game-page.bundle.js`, data chunks, and CSS.
2. Inject the generated manifest into HTML at build time.
3. Remove manual query tokens.

Acceptance criteria:

- Changing CSS or JS automatically changes the referenced filename.
- Unchanged assets keep stable URLs.

### P2 - SEO sitemap `lastmod` changes on every build

Evidence:

- `Site/tools/inject-seo.mjs` sets sitemap `lastmod` to `new Date().toISOString().slice(0, 10)` for every route.

Impact:

- Search engines receive "everything changed today" signals after every scheduled build.
- Sitemap churn is not tied to content changes.

Recommended fix:

- Use the newest relevant data timestamp per route:
  - codes generated/updated timestamp
  - banners updated timestamp
  - materials generated timestamp
  - page template change timestamp if available
- Or omit `lastmod` until route-level content timestamps are reliable.

Acceptance criteria:

- Sitemap `lastmod` changes only when route-relevant content changes.

### P2 - CSP still allows inline scripts and styles

Evidence:

- `_headers` includes `script-src 'self' 'unsafe-inline'` and `style-src 'self' 'unsafe-inline'`.
- Pages include inline scripts/styles.

Impact:

- CSP is useful but still weaker than it could be.
- This may be acceptable for a static site, but it should be an explicit tradeoff.

Recommended fix:

1. Move inline scripts/styles into built files where practical.
2. Or generate CSP hashes/nonces during build.
3. Keep `unsafe-inline` only where required and document why.

Acceptance criteria:

- CSP no longer requires `unsafe-inline` for scripts, or the exception is documented and tested.

### P2 - Product naming mismatch: sorter tabs are mostly database browsers

Evidence:

- Game registry names the second tool as `Artifact Sorter`, `Relic Sorter`, `Drive Disc Sorter`, `Echo Sorter`, or `Gear Sorter`.
- The rendered panel title is `Database Library`.
- The UI is primarily a searchable item database, not a sorter/recommender.

Impact:

- Users may expect build optimization or artifact scoring and instead get a library.
- Current feature is useful, but the label over-promises.

Recommended fix:

Choose one direction:

1. Rename the feature:
   - `Database Library`
   - `Inventory Library`
   - `Artifacts and Weapons`
   - `Gear Database`

2. Or make it a true sorter:
   - filter by set, main stat, substat, role, element, path/class
   - recommended sets per character
   - stat priority by character/role
   - save/load candidate builds
   - compare pieces
   - import inventory later if supported

Acceptance criteria:

- Tool names match actual user outcomes.
- If "Sorter" remains, the UI includes real sorting/recommendation controls.

### P2 - Homepage visual labels are hidden on mobile

Evidence:

- Homepage cards use `aria-label` and `.sr-only` text.
- CSS comment explicitly says cards stay imagery-only for sighted users.
- Mobile screenshot showed six circular icon cards with no visible game labels.

Impact:

- Sighted mobile users must recognize icons/art to pick a game.
- This is manageable for fans, but hurts clarity and first-time use.

Recommended fix:

- On mobile, show compact visible labels below each card:
  - `Nyx`
  - `Genshin`
  - `HSR`
  - `ZZZ`
  - `Wuwa`
  - `Endfield`
- Keep desktop imagery-only if that is the desired aesthetic.

Acceptance criteria:

- Mobile game selection is understandable without icon knowledge.

### P2 - Nav rows use div role=button

Evidence:

- `GameContent` and `SimContent` render nav rows as `div` with `role="button"`, `tabIndex`, and keyboard handlers.

Impact:

- The current code handles keyboard activation, which is good.
- Native `button` elements would still be simpler and more robust for accessibility and form semantics.

Recommended fix:

- Convert nav row elements to `<button type="button">`.
- Keep the same visual class names.
- Use `aria-current` or `aria-pressed` consistently.

Acceptance criteria:

- Keyboard behavior remains.
- Semantics are native.

### P2 - Docs and comments have drifted from the current system

Evidence:

- Historical docs still mention old scheduler limitations and old stale banner snapshots.
- `pulls-engine.js` header says only Genshin is wired, while registry includes HSR, ZZZ, and Wuwa adapters.
- Worker comments and User-Agent still say Nyxarium/As-I've-Hoarded.
- `pengo-pulls.ps1` comments and output mention Asyce/As I've Pulled and old URLs.

Impact:

- New work can be guided by stale assumptions.
- Reviewers may waste time re-diagnosing fixed issues.
- Product brand boundaries are unclear.

Recommended fix:

1. Add a current `docs/architecture.md`.
2. Add a current `docs/operations.md`.
3. Move old round plans under `docs/archive/` or mark them clearly as historical.
4. Update comments only where they can mislead implementation.

Acceptance criteria:

- A new contributor can understand current build, deploy, data, and feature architecture from current docs.

## Feature-by-feature review and suggestions

## Homepage / game selector

What works:

- Strong first impression.
- Distinctive Nyx/Pengo identity.
- Keyboard/crawler labels exist through real anchors and `aria-label`.
- Reduced-motion handling exists.
- The page is standalone and does not depend on the React app.

Issues:

- Mobile visible labels are absent.
- Clean links 404 under the current local server.
- The homepage has a lot of inline CSS/JS, so shared tokens and global style changes do not naturally propagate.
- The page uses large image/font assets immediately.

Suggestions:

1. Add visible mobile labels under cards.
2. Keep desktop hover art but make touch behavior deterministic: one tap navigates, long-press/hover effects should not be required.
3. Add a tiny active/focus visible state for keyboard users beyond only hover-like effects.
4. Share core tokens with game pages, even if the homepage remains standalone.
5. Create a `home.css` file and use build-time injection or direct stylesheet loading instead of a huge inline style block.
6. Add local route smoke tests for the six homepage links.
7. Consider a first-load asset strategy:
   - initial icon art only
   - key art lazy-loaded after interaction or idle
   - font preloads only if needed

## Shared game shell

What works:

- Desktop layout is visually strong.
- Game rail and side nav are clear at desktop sizes.
- Background and medallion treatments create a coherent brand.
- `nyx-app-ready` boot handling avoids long blank states.

Issues:

- Mobile compact mode hides important controls.
- Topbar is fragile due fixed offsets and overflow.
- The stage model uses fixed 1600x900 design dimensions, then scales. This helps desktop composition, but it fights natural mobile content flow.
- Top rail overflow lacks a clear mobile affordance.
- Game switching updates app state/history but local route behavior differs from production route behavior.

Suggestions:

1. Treat desktop and mobile shells as related but separate layouts.
2. On mobile:
   - fixed compact header
   - active game chip/dropdown
   - visible Pengo settings icon
   - secondary nav as tabs
   - no hidden Live/Beta
3. Reduce nested scroll regions on mobile.
4. Add a route-aware dev server.
5. Add Playwright visual checks for 1600x900, 1366x768, 390x844, and 430x932.
6. Use native buttons for nav rows.
7. Add a small `version`/build marker in Pengo settings for debugging live issues.

## Overview page

What works:

- Strong desktop composition.
- Pinned favorites create a personalized-feeling starting point.
- Codes and banners are immediately visible.
- Banner freshness warning exists and is visible.

Issues:

- Pinned favorites take a lot of vertical space on mobile.
- Overview can push practical tasks below the fold.
- Some cards read as demo/presentation rather than task-first utilities.
- If banner data is stale/invalid, the banner card can still look too authoritative.

Suggestions:

1. Make overview modular and reorderable by user intent:
   - Today
   - Codes expiring soon
   - Current banners
   - Favorites
   - Materials today
2. On mobile, collapse favorites into a horizontal carousel with a clear label and progress/scroll cue.
3. For stale/invalid banner data, reduce card confidence:
   - visible degraded badge on the card itself
   - "last successful fetch" and "last checked" separated
   - do not show countdown as primary if dates are carried forward
4. Add "today's material domains" summary for games where it applies.
5. Add a "copy all active codes" action per game where redeem URLs are not enough.
6. Add per-game last-updated metadata in a small but accessible spot.

## Codes

What works:

- Code rows render cleanly.
- Copy buttons exist.
- Code scraper has meaningful tests and guards.
- The UI correctly avoids fabricated fallback codes when real code data exists but a game has zero current codes.
- The code watch workflow is thoughtful: livestream windows, active-only mode, semantic diff gating, and Reddit fallback.

Issues:

- Wuwa currently has zero codes. That may be accurate, but the empty state should explain the source/freshness.
- Copy/tap targets are small on mobile.
- The redemption flow could be more direct for games with official redeem URLs.
- Code source confidence is not visible to users.

Suggestions:

1. Add code freshness metadata per game:
   - last checked
   - source count
   - held/reviewed count if relevant
2. Add "No active codes found" with last checked and source summary.
3. Add a per-game "copy all" where practical.
4. Add direct redeem links where available.
5. Add expiry/soon labels when dates are known.
6. Add a settings option for compact/detailed code rows.
7. For scheduled code watch, expose last successful run in a JSON status artifact.

## Banners

What works:

- Banner cards are visually strong.
- Current, next, and upcoming plumbing exists.
- Stale/invalid/unavailable status is surfaced in UI.
- `reflowBannerGroup` gives a central normalization path.

Issues:

- The data gate does not block stale/invalid deploys.
- Wuwa is currently invalid.
- Endfield unavailable may be expected, but the policy is not encoded clearly enough for the pipeline.
- Banner cards can still visually overstate confidence.
- The current model should keep evolving for games with multiple simultaneous banners and game-specific banner mechanics.

Suggestions:

1. Introduce explicit data confidence:
   - `fresh`
   - `carried_forward`
   - `stale`
   - `invalid`
   - `expected_unavailable`
   - `source_down`
2. Use confidence in both UI and CI.
3. Add banner source details to the Pengo menu or a diagnostics drawer.
4. Add a banner timeline view:
   - current
   - next
   - known upcoming
   - historical
5. Add "last successful scrape" vs "last checked" separation.
6. Add test fixtures for each game's banner source shape.
7. Add a screenshot test for each game when status is stale/invalid so the degraded state remains visible.

## Character materials

What works:

- This is one of the strongest features.
- Roster grid and popout are polished.
- Current source uses actual `button` elements for character cells.
- Popout inputs have useful `aria-label`s.
- Live/Beta model is a strong differentiator.
- Material counts, weapon/signature selection, and daily/domain organization are high-value.

Issues:

- The file is large and owns too many responsibilities.
- Mobile popout and nested controls need ongoing viewport verification.
- Live/Beta control is hidden in compact page mode because its container is hidden.
- Source/freshness for material data is not prominent.
- Some games have incomplete domains/weapons relative to GI/HSR.

Suggestions:

1. Split the materials feature:
   - roster
   - filters/search
   - beta merge
   - calculator
   - popout shell
   - weapon picker
   - source badges
2. Put Live/Beta inside the materials panel header on mobile.
3. Add "data source" badges:
   - Nanoka
   - Prydwen
   - Endfield Wiki
   - local fallback/manual
4. Add "last updated" per game/channel.
5. Add "changed in beta" diff view:
   - new character
   - changed material requirements
   - changed icons/art
6. Add export/share for a material plan.
7. Add multi-character farming plan:
   - selected characters
   - targets
   - aggregate materials
   - today/weekly checklist
8. Add saved favorite material plans.
9. Add tests for level/talent requirement calculations, especially low-level edge cases.
10. Add image fallback audits for all roster entries.

## Database Library / gear sorter

What works:

- The rendered database library looks clean and searchable.
- Tabs and counts are easy to scan.
- It provides a natural place for artifacts/weapons/gear metadata.

Issues:

- It is labeled as a sorter in navigation but behaves as a library.
- Search appears basic.
- It does not yet answer build/planning questions.

Suggestions if keeping "library":

1. Rename nav labels to `Database Library` or game-specific library names.
2. Add filters:
   - rarity
   - type
   - source
   - stat
   - set
   - weapon type/path/specialty
3. Add detail drawer/cards.
4. Add sort options:
   - name
   - rarity
   - release/version
   - source
5. Add empty-state guidance and last updated metadata.

Suggestions if making it a true sorter:

1. Add character build recommendations.
2. Add role presets.
3. Add stat priority tables.
4. Add artifact/relic/drive/echo set recommendations.
5. Add comparison mode.
6. Later: inventory import if a safe source exists.

## Wish / Warp / Signal / Convene tracker

What works:

- Ambitious and high-value.
- Local-first IndexedDB storage is the right default.
- Data model supports multiple games.
- Hoyo and Wuwa adapter structure is a strong foundation.
- File import exists for some formats.
- Worker privacy comments and body caps are thoughtful.

Issues:

- Default helper command trust issue.
- Sample data provenance issue.
- Result header says `Import` even when showing results.
- `pulls-engine.js` comments are stale about supported adapters.
- Account sync is stubbed (`/api/account/*` returns 501), but storage comments already discuss cloud sync.
- There is no Worker test suite.
- Data deletion/export controls should be more central.

Suggestions:

1. Rework import screen around trust:
   - "Local-only by default"
   - "Download script"
   - "Verify hash"
   - "Run locally"
   - "Paste URL"
   - "Import file instead"
2. Add account/data management:
   - active UID selector
   - delete local data
   - export
   - import file
   - source/provenance
3. Add result-state header:
   - game
   - UID/nickname
   - imported at
   - local/sample/file/live badge
4. Add sample mode as a separate demo entry point.
5. Add a privacy page or modal explaining exactly what the Worker sees and stores.
6. Add tests:
   - parse URL for each game
   - reject missing auth fields
   - normalize pull rows
   - dedupe IndexedDB records
   - build pity views
   - Wuwa POST payload generation
7. Add Worker integration tests with mock upstreams.
8. Do not ship account sync UI until `/api/account/*` has real behavior.

## Nyx hub

What works:

- Pull Overview concept is good.
- All Codes and All Banners are useful cross-game surfaces.
- Hub can become the user's daily dashboard.

Issues:

- It is currently less feature-rich than the game pages.
- Cross-game overview depends on local import history only.
- The hub should be the place that answers "what should I do today?"

Suggestions:

1. Turn Nyx hub into a true dashboard:
   - all active codes
   - all current banners
   - expiring soon
   - today's material domains
   - selected favorites across games
   - pull pity summary
   - data freshness summary
2. Add global search/command palette:
   - character
   - code
   - material
   - banner
   - game
3. Add user-customizable dashboard sections.
4. Add "data health" section for stale/invalid sources.
5. Add notifications/reminders later:
   - code expiry
   - banner ending
   - material day

## Pengo menu and personalization

What works:

- Pengo menu gives the site personality.
- Identity preferences are fun and domain-aware.
- Display game toggles are useful.
- Reduced motion/pattern controls are good.

Issues:

- Menu is hidden on mobile compact stage.
- Some labels and jokes may not be obvious to first-time users.
- Settings are local only with no import/export.

Suggestions:

1. Make Pengo menu accessible on mobile.
2. Add settings import/export.
3. Add "reset appearance settings".
4. Add a build/version/status panel:
   - app version/commit
   - data generated at
   - last code scrape
   - last banner scrape
5. Consider a more utilitarian "Settings" label in addition to icon-only Pengo affordance on mobile.

## Worker and API

What works:

- Body cap is stream-enforced.
- CORS is explicit.
- Rate limiting binding exists.
- Upstream timeout exists.
- Request bodies are not logged.
- Error envelope is stable.
- `/api/account/*` returns 501 rather than pretending to work.

Issues:

- Old origins are trusted.
- No-Origin requests are allowed.
- No automated Worker tests were found.
- Account endpoints are stubbed but roadmap comments are present.
- Worker comments/User-Agent still use old names.

Suggestions:

1. Add a `worker/tests` suite using Miniflare/workerd-compatible tooling.
2. Test:
   - OPTIONS
   - CORS allow/deny
   - missing Origin policy
   - body too large
   - bad JSON
   - authkey required
   - param whitelist
   - upstream timeout
   - rate limit branch
   - account endpoint 501
3. Move trusted origins to environment config, with Pengo production defaults only.
4. Add structured logs that never include auth/body data:
   - route
   - status
   - requestId
   - duration
   - upstream status
5. Add `/api/health` if operationally useful.

## Scrapers and data pipeline

What works:

- Scraper tests exist and pass.
- Code scraper has meaningful safety gates for suspicious codes.
- Banner normalization has tests.
- Workflows separate fast code watch, data refresh, and roster sync.
- Carry-forward logic avoids wiping live data on transient upstream failure.

Issues:

- Carry-forward plus permissive validation can deploy stale data.
- Scraper files are large.
- Data source health is not exposed enough in UI or deploy status.
- CI uses install instead of ci.
- Workflows deploy before commit.

Suggestions:

1. Add source-health JSON:
   - source
   - last attempted
   - last successful
   - current status
   - error category
   - affected games
2. Add freshness gate.
3. Split big scrapers:
   - source clients
   - parsers
   - normalizers
   - carry-forward writer
   - diagnostics
4. Add fixture-based tests for source HTML/JSON shapes.
5. Add a weekly/dependency update job.
6. Add a dry-run workflow mode that scrapes/validates but does not deploy.
7. Add an asset sync report and keep asset sync intentionally manual unless budgets are fixed.

## SEO and static deployment

What works:

- SEO injection exists for game pages.
- Sitemap is generated.
- Security headers exist.
- Redirects preserve old route names.
- Hidden SEO sections are restrained and not visible clutter.

Issues:

- Sitemap `lastmod` changes every build.
- CSP still allows inline scripts/styles.
- Local dev does not match clean route behavior.
- SEO data can summarize stale banners if freshness is not gated.

Suggestions:

1. Route-level content timestamps.
2. Remove or hash inline scripts/styles over time.
3. Add a generated route manifest.
4. Add an SEO smoke test:
   - title
   - description
   - canonical
   - Open Graph
   - JSON-LD parse
   - sitemap route count
5. Add stale-data awareness to SEO copy if banners/codes are degraded.

## Accessibility review

Positive findings:

- Homepage links are real anchors with `aria-label`.
- Material roster cells are buttons in source.
- Material popout has dialog semantics.
- Several inputs have useful labels.
- Reduced-motion handling exists.
- Side nav has keyboard handlers despite not using native buttons.

Issues and suggestions:

1. Convert nav `div role=button` rows to native buttons.
2. Add visible mobile labels to homepage cards.
3. Increase mobile touch targets.
4. Ensure icon-only buttons have `aria-label`, not only `title`.
5. Add focus-visible styles for every interactive element.
6. Test with keyboard only:
   - homepage card selection
   - game rail
   - side nav
   - material filters
   - popout close
   - weapon picker
   - tracker import controls
   - Pengo menu
7. Add Playwright accessibility smoke checks or axe checks for major pages.

## Performance review

Main risks:

- Huge deploy artifact.
- Large generated JS payloads.
- Fonts and backgrounds are large.
- Custom global bundle limits code splitting.
- All pages share broad CSS and large data references.

Recommendations:

1. Add performance budgets.
2. Split route/feature data.
3. Use lazy loading for materials/tracker/database.
4. Use compressed static assets and verify Brotli/gzip behavior in production.
5. Convert images to responsive WebP/AVIF variants.
6. Subset fonts and use WOFF2.
7. Add bundle-size reporting to CI.
8. Add Lighthouse or WebPageTest-style checks for key pages after deploy.
9. Build a `manifest.json` of referenced assets per route, then copy only those assets.

## Security and privacy review

Positive findings:

- Worker does not log bodies.
- API responses are no-store.
- CORS exists.
- Body cap exists.
- Rate limiting binding exists.
- File hash for the safe script matches.
- Local-first IndexedDB design is privacy-friendly.

Concerns:

- Default remote PowerShell commands.
- Old domains in Worker allowlist.
- No-Origin API acceptance.
- Inline scripts allowed by CSP.
- Lack of Worker tests.
- User-facing script still contains old project language.

Recommendations:

1. Fix helper script flow first.
2. Add a privacy modal/page.
3. Tighten Worker origins.
4. Add Worker tests.
5. Remove `unsafe-inline` where practical.
6. Add data deletion/export UX.
7. Add a simple threat model document:
   - what tokens are handled
   - what is stored
   - what is proxied
   - what is never logged
   - abuse controls

## Implementation roadmap

### Phase 0 - Baseline and branch discipline

Goal: make future changes measurable and reversible.

Steps:

1. Create a review implementation branch.
2. Record baseline:
   - `npm --prefix Scraper test`
   - `npm --prefix Scraper run validate`
   - `npm --prefix Site run build:deploy`
   - deploy artifact file count/size
   - route smoke results
   - desktop/mobile screenshots
3. Add `docs/architecture.md` skeleton.
4. Add `docs/operations.md` skeleton.
5. Add a `version.json` generation plan, even if implemented later.

Do not change product behavior in this phase except documentation.

### Phase 1 - Trust and privacy cleanup

Goal: remove the most visible trust problem before deeper product work.

Steps:

1. Remove remote `iex (irm ...)` helper commands from adapters.
2. Promote `pengo-pulls.ps1` local download/verify/run flow.
3. Update `pengo-pulls.ps1` comments/output from Asyce/As I've Pulled to Pengo/Nyx.
4. Add hash verification in build:
   - calculate actual script hash
   - fail build if it differs from the adapter hash
5. Update import UI copy:
   - local-only
   - what the script reads
   - what the Worker proxies
   - what is not stored
6. Separate sample mode from real import mode.
7. Add visible provenance to tracker results.

Tests:

- Build site.
- Verify hash check passes.
- Browser verify import screen for GI/HSR/ZZZ/Wuwa.
- Confirm no `asyce.com/asivepulled/scripts` strings remain in built output.

### Phase 2 - Data correctness gates

Goal: stop deploying known-invalid time-sensitive data.

Steps:

1. Add strict freshness validation mode.
2. Encode expected unavailable policy for Endfield.
3. Add workflow input to override freshness gate manually.
4. Update workflows:
   - run structural validation after scrape
   - run strict freshness validation before deploy
   - skip deploy on invalid/stale unless overridden
5. Add UI confidence mapping improvements:
   - degraded card state
   - last checked vs last successful
6. Investigate current Wuwa invalid banner data.

Tests:

- Unit tests for validation statuses.
- Simulated stale/invalid fixture tests.
- Workflow dry-run or local command equivalents.

### Phase 3 - Mobile shell repair

Goal: make mobile a supported layout, not a compressed desktop.

Steps:

1. Create mobile topbar layout.
2. Fix clipped Nyx wordmark.
3. Add mobile Pengo menu trigger.
4. Move Live/Beta into materials header on compact view.
5. Add scroll affordance or dropdown for game rail.
6. Increase touch targets for nav/codes/tracker controls.
7. Review nested scroll panes and convert key mobile pages to normal vertical flow.
8. Add visible homepage mobile labels.

Tests:

- Playwright screenshots at 390x844, 430x932, 768x1024, 1366x768, 1600x900.
- Verify no topbar clipping.
- Verify Pengo menu opens on mobile.
- Verify Live/Beta reachable on mobile.

### Phase 4 - CI and deploy reliability

Goal: live site should always map to a committed, reproducible tree.

Steps:

1. Switch workflows to `npm ci`.
2. Commit refreshed data before deploy.
3. Deploy from the committed SHA.
4. Rebase/pull consistently before bot pushes.
5. Add `/version.json` or build metadata.
6. Add route smoke test after build and optionally after deploy.
7. Add deploy artifact size reporting.
8. Add concurrency/retry notes for scheduled jobs.

Tests:

- Workflow dry run where no data changes exist.
- Workflow dry run with data changes.
- Simulated push conflict should skip deploy or fail before deploy.

### Phase 5 - Performance and asset budget

Goal: reduce deploy and initial page costs.

Steps:

1. Add artifact size budget to build.
2. Add bundle/data size report.
3. Split generated data:
   - overview data
   - materials data by game
   - tracker data
   - database data
4. Lazy-load materials/tracker/database chunks.
5. Convert large backgrounds to responsive formats.
6. Subset fonts.
7. Replace whole-tree asset copy with manifest-based copy.
8. Explore separating stable Database assets from frequent app deploys.

Tests:

- Bundle size report in CI.
- Route load smoke under throttled network.
- Confirm all referenced assets resolve after manifest copy.

### Phase 6 - Frontend architecture and testability

Goal: make changes safer and faster.

Steps:

1. Add ESLint.
2. Add formatter policy.
3. Add Vitest for pure functions.
4. Add Playwright smoke tests.
5. Split `nyx-app.jsx` by surface.
6. Split `char-materials.jsx` by responsibility.
7. Split `game-page-shared.css`.
8. Add JSDoc/TypeScript types for core data shapes:
   - code entry
   - banner phase
   - material roster entry
   - pull record
   - tracker view
9. Consider moving from custom global bundle to Vite or a more standard esbuild setup with source maps and chunking.

Tests:

- Existing scraper tests continue passing.
- New frontend tests run in CI.
- Build output is functionally equivalent route-by-route.

### Phase 7 - Product feature expansion

Goal: turn strong surfaces into complete user workflows.

Workstreams:

1. Nyx dashboard:
   - all codes
   - banners ending soon
   - today's materials
   - pity summary
   - data health
2. Material planner:
   - multi-character selection
   - aggregate farming list
   - daily/weekly schedule
   - saved plans
3. Database/sorter:
   - decide rename vs true sorter
   - filters/sorts/details
   - build recommendations if sorter remains
4. Gacha tracker:
   - data management
   - export/import
   - sample separation
   - multi-UID selector
5. Notifications/reminders later:
   - code expiry
   - banner ending
   - material days

### Phase 8 - Worker/account future

Goal: prepare account sync without compromising local-first privacy.

Steps:

1. Write a small sync design doc.
2. Decide Google Drive appDataFolder vs first-party account priority.
3. Keep local-first as default.
4. Add explicit user consent screens.
5. Build Worker account endpoints only after auth/storage design is settled.
6. Add D1 schema migrations if choosing first-party account.
7. Add tests before exposing UI.

Acceptance criteria:

- No account UI promises sync until backend exists.
- Users can stay local-only.
- Export/delete always remain available.

### Phase 9 - Documentation and operations

Goal: make Nyx maintainable as a live product.

Docs to add/update:

1. `docs/architecture.md`
2. `docs/data-pipeline.md`
3. `docs/deploy.md`
4. `docs/privacy-and-threat-model.md`
5. `docs/ui-guidelines.md`
6. `docs/testing.md`
7. Archive or mark historical round plans.

Operational additions:

1. Data health report.
2. Deploy version endpoint.
3. Last successful scrape timestamps.
4. Manual runbook for failed scrapes/deploys.
5. Dependency update policy.

## Suggested backlog

### Immediate

- Replace remote PowerShell helper commands with the local Pengo script flow.
- Update `pengo-pulls.ps1` branding and output.
- Add strict banner freshness gate.
- Fix Wuwa invalid banner state or block Wuwa banner deploy confidence.
- Fix mobile topbar clipping.
- Restore Pengo menu and Live/Beta access on mobile.
- Change CI to `npm ci`.
- Commit data before deploy.

### Near term

- Add route-aware dev server.
- Add Playwright smoke tests.
- Add Worker tests.
- Add deploy size budget.
- Add tracker sample provenance.
- Rename or expand "Sorter" feature.
- Add visible mobile homepage labels.
- Add route-level sitemap timestamps.

### Medium term

- Split generated data and lazy-load feature chunks.
- Split large frontend files.
- Split shared CSS.
- Add ESLint/Vitest.
- Add data health UI.
- Add material planner.
- Add real database filters/sorting.

### Long term

- Standardize frontend build around Vite or a stronger esbuild pipeline.
- Separate stable image/database assets from frequent deploy assets.
- Add optional sync.
- Add global dashboard and notification features.
- Add comprehensive accessibility and performance CI.

## What I would not change immediately

- Do not rewrite the visual identity. The site has a strong, recognizable look.
- Do not remove the local-first pull storage model. It is the right privacy default.
- Do not replace all custom build tooling in the first pass. Stabilize trust/data/mobile first.
- Do not automate large asset syncs until deploy size is under control.
- Do not ship account sync UI until the Worker account API is real and tested.

## Final assessment

Nyx is in a promising but fragile stage. The product has real identity and several genuinely useful tools, but it is held together by a custom build, large generated payloads, permissive data gates, and inherited prototype-era trust assumptions.

The fastest way to improve it is not a broad rewrite. The best sequence is:

1. Fix user trust around pull import.
2. Stop deploying known-invalid banner states.
3. Make mobile a first-class layout.
4. Make CI/deploy reproducible and tied to commits.
5. Put budgets and tests around the growing data/assets.
6. Then refactor architecture and expand features.

That order reduces live risk while preserving the strongest parts of the project.

## Evidence appendix

Key source references used while writing this report:

- `Site/src/features/gacha/pulls-engine.js:853-856`: local `pengo-pulls.ps1` script metadata and SHA-256.
- `Site/src/features/gacha/pulls-engine.js:861-900`: adapter registry with old remote `asyce.com/asivepulled` helper commands.
- `Site/src/features/gacha/pulls-engine.js:909-923`: public `adapterFor`, `buildView`, and `buildViews` registry helpers.
- `Site/src/features/gacha/gacha-tracker.jsx:699-721`: real IndexedDB load followed by old localStorage sample cache fallback.
- `Site/src/features/gacha/gacha-tracker.jsx:728-733`: sample simulator writes to localStorage.
- `Site/src/features/gacha/gacha-tracker.jsx:739-748`: import path falls back to sample when adapter/store is missing.
- `Site/src/features/gacha/gacha-tracker.jsx:810-812`: result-state header becomes an `Import` button.
- `Site/src/features/gacha/gacha-tracker.jsx:824-858`: helper command and safer script disclosure UI.
- `Site/public/scripts/pengo-pulls.ps1:1-20`: old Asyce/As I've Pulled comments and output target.
- `Site/public/scripts/pengo-pulls.ps1:292-316`: local cache copy and auth URL extraction behavior.
- `Site/public/scripts/pengo-pulls.ps1:381-386`: Wuwa validation is intentionally skipped by the helper and deferred to website import.
- `Scraper/validate-data.cjs:11-14`: validation explicitly does not fail on unavailable data.
- `Scraper/validate-data.cjs:47-52`: diagnostics include freshness/current/next/upcoming status.
- `Scraper/validate-data.cjs:72-77`: validation passes when structural errors are absent.
- `Site/src/styles/game-page-shared.css:608-640`: desktop topbar brand and corner controls.
- `Site/src/styles/game-page-shared.css:2619-2640`: compact stage hides `.gp-topbar .tb-pengo` and `.gp-corner`.
- `Site/src/styles/game-page-shared.css:2675-2682`: narrow mobile topbar offsets and rail sizing.
- `Site/pages/index.html:200-204`: homepage card labels are screen-reader-only for sighted users.
- `Site/pages/index.html:209-226`: mobile homepage grid/card rules.
- `Site/pages/index.html:279-379`: homepage clean-route links.
- `Site/src/app/nyx-app.jsx:394-414`: code data avoids fabricated fallback codes when real data exists.
- `Site/src/app/nyx-app.jsx:421-440`: banner freshness warning component.
- `Site/src/app/nyx-app.jsx:1188-1222`: actual rendered "Database Library" panel.
- `Site/src/app/nyx-app.jsx:1248-1276`: game side nav rows are `div role="button"`.
- `Site/src/app/nyx-app.jsx:1306-1332`: Nyx hub sections.
- `Site/src/app/nyx-app.jsx:1358-1363`: Live/Beta toggle is described as bottom-left page UI.
- `Site/src/app/nyx-app.jsx:1525-1549`: Live/Beta toggle component.
- `Site/src/app/nyx-app.jsx:1684-1692`: corner Pengo menu trigger.
- `Site/src/components/game-page-components.jsx:16`: static fallback feature labels include `Artifact Sorter`.
- `Site/src/components/game-page-components.jsx:200-221`: shared function rows/tabs still use static labels.
- `Site/src/components/game-page-components.jsx:242-274`: banner card rendering.
- `Site/src/features/materials/char-materials.jsx:1071-1085`: character material cells are native buttons.
- `Site/src/features/gacha/pulls-storage.js:20-46`: IndexedDB store setup.
- `Site/src/features/gacha/pulls-storage.js:81-107`: idempotent pull save and metadata update.
- `Site/src/features/gacha/pulls-storage.js:143-157`: local import deletion.
- `Site/src/features/gacha/pulls-storage.js:168-180`: future sync provider registry.
- `worker/worker.js:26-36`: old trusted origins and preview regex.
- `worker/worker.js:67-73`: missing `Origin` is accepted.
- `worker/worker.js:132-155`: stream-enforced JSON body cap.
- `worker/worker.js:166-175`: rate limit binding behavior.
- `worker/worker.js:260-272`: API routes and stubbed account endpoint.
- `Site/tools/build-site.mjs:41-55`: custom JSX transform concatenation into one bundle.
- `Site/tools/build-site.mjs:71-77`: generated data copied into `dist`.
- `Site/tools/build-deploy.mjs:91-110`: deploy directory is rebuilt and public/runtime files are copied.
- `Site/tools/inject-seo.mjs:151-157`: sitemap `lastmod` uses the current build date.
- `Site/package.json:15-17`: build/deploy/serve scripts.
- `Scraper/package.json:6-15`: scraper/test/validate scripts.
- `.github/workflows/data-refresh.yml:50-56`: CI uses `npm install`.
- `.github/workflows/data-refresh.yml:78-97`: build/deploy happens before commit.
- `.github/workflows/roster-sync.yml:51-57`: CI uses `npm install`.
- `.github/workflows/roster-sync.yml:78-98`: build/deploy happens before commit.
- `.github/workflows/code-watch.yml:118-144`: code-watch build/deploy happens before final codes commit.
- `Site/public/_headers:5-10`: security headers and CSP with `unsafe-inline`.
- `wrangler.jsonc:10-18`: Worker asset binding and `/api/*` worker-first routing.

## Command appendix

Representative commands run:

```powershell
git -C C:\Pengo\Nyx status --short
git -C C:\Pengo\Nyx log -1 --oneline
npm test
npm run validate
node ./tools/build-site.mjs
node ./tools/build-deploy.mjs
node ./tools/inject-seo.mjs
npm audit --omit=dev --json
npm audit --json
npm outdated --json
Invoke-WebRequest -UseBasicParsing -Uri http://127.0.0.1:5173/Site/pages/genshin.html
Invoke-WebRequest -UseBasicParsing -Uri http://127.0.0.1:5173/genshin
```

CodeRabbit/WSL commands:

```bash
curl -fsSL https://cli.coderabbit.ai/install.sh -o /tmp/coderabbit-install.sh
sh /tmp/coderabbit-install.sh
coderabbit --version
coderabbit doctor
coderabbit review --help
```

Browser checks performed:

- Homepage desktop and mobile.
- Genshin, HSR, ZZZ, Wuwa, Endfield, and Nyx page load checks.
- Game overview desktop and mobile.
- Genshin Character Materials tab and character popout.
- Genshin Wish Tracker.
- Genshin Database Library.
- Console and broken-image checks during browser passes.

## Limitations

- I did not deploy to Cloudflare and did not push anything to GitHub.
- I did not review the old `AI\As-I-ve-Hoarded` project as a target.
- CodeRabbit was installed and authenticated successfully, but its local CLI is primarily a Git diff/PR review tool. The repository began clean, and a whole-repo clean-state review did not complete with actionable output, so this report relies on direct source/runtime review.
- I did not run every scraper live, because doing so can modify large Database trees and the user requested a report rather than changes.
- Browser state may contain local IndexedDB/localStorage from previous manual usage. Source inspection was used to separate real behavior from local stored state where relevant.
