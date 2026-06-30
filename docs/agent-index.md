# Nyx Agent Index

Use this as the first reference when Codex, Claude, or another coding agent works on Nyx.

## Scope

- Real project: `C:\Pengo\Nyx`
- Historical prototype/reference only: `C:\Pengo\AI\As-I-ve-Hoarded`
- Do not review or modify the old prototype unless the user explicitly asks.

## Current decision docs

Read these before implementing review-driven work:

1. `docs/report-feedback-decisions-2026-06-30.md`
   - Supersedes parts of the earlier review after user feedback.
   - Current decisions on quick PowerShell vs verified script, banner accuracy, deploy artifact meaning, mobile scope, sample data, account direction, Worker allowlist/no-Origin, React, and GitHub assets.
2. `docs/nyx-full-review-2026-06-30.md`
   - Full review and broad implementation plan.
3. `docs/nyx-review-execution-addendum-2026-06-30.md`
   - Workstreams, gates, rollout controls, and acceptance criteria.
4. `docs/wish-history-import-options-plan-2026-06-30.md`
   - Import-history research and implementation strategy.

If these disagree, follow `report-feedback-decisions-2026-06-30.md` first.

## Main code map

### Frontend app

- `Site/src/app/nyx-app.jsx`
  - Main game shell, routes/tabs, overview, codes, banners, database library, Pengo settings.
- `Site/src/components/game-page-components.jsx`
  - Shared visual components such as game rail, cards, banner card, old shared rows.
- `Site/src/styles/game-page-shared.css`
  - Shared styling for game pages, tracker, materials, database, responsive behavior.
- `Site/pages/*.html`
  - Static page shells. Game pages load generated data and `game-page.bundle.js`.
- `Site/pages/index.html`
  - Standalone homepage/game selector.

### Character materials

- `Site/src/features/materials/char-materials.jsx`
  - Character materials roster, filters, live/beta merge, popout, material calculator.
- `Site/src/data/generated/cm-data*.js`
  - Generated material payloads.

### Pull history / gacha tracker

- `Site/src/features/gacha/gacha-tracker.jsx`
  - Import UI, file/live import flow, tracker result dashboards.
- `Site/src/features/gacha/pulls-engine.js`
  - Game adapters, live URL import, UIGF/JSON/CSV parsers, Wuwa/Endfield import normalization.
- `Site/src/features/gacha/pulls-storage.js`
  - IndexedDB local storage and future sync seam.
- `Site/src/features/gacha/pulls-overview.jsx`
  - Cross-game pull overview on the Nyx hub.
- `Site/public/scripts/pengo-pulls.ps1`
  - User-facing local helper script for PC history URL extraction.

### Data and scrapers

- `Scraper/validate-data.cjs`
  - Structural data validation. Needs future strict freshness gate.
- `Scraper/banners/*`
  - Banner scraping, normalization, and tests.
- `Scraper/codes/*`
  - Redemption code scraping, livestream checks, semantic diff, tests.
- `Scraper/nanoka/*`, `Scraper/prydwen/*`, `Scraper/wiki-titles/*`, `Scraper/endfield-wiki/*`
  - Roster/material/library data ingestion.
- `Database/`
  - Tracked data and asset source tree.

### Build/deploy

- `Site/package.json`
  - Build and deploy scripts.
- `Site/tools/generate-site-data.mjs`
  - Large generated data builder.
- `Site/tools/build-site.mjs`
  - Custom React UMD/global bundle build.
- `Site/tools/build-deploy.mjs`
  - Builds `.deploy/pengo`.
- `Site/tools/inject-seo.mjs`
  - Injects SEO and sitemap into deploy output.
- `wrangler.jsonc`
  - Cloudflare Worker/assets deploy config.
- `.github/workflows/*.yml`
  - Scheduled data refresh, roster sync, and code watch deploys.

### Worker/API

- `worker/worker.js`
  - `/api/gacha/genshin`, `/api/gacha/hsr`, `/api/gacha/zzz`, `/api/gacha/wuwa`.
  - Account endpoints are stubbed with 501.

## Current implementation direction

### Imports

- Keep both quick command and verified script paths.
- Quick command must use Pengo-hosted script.
- Safer path should show download, source view, SHA-256 verify, then run.
- Keep live URL import for HoYo/Wuwa.
- Add/keep file imports: UIGF/JSON/CSV/XLSX where supported.
- Endfield should start with file/manual import, not token proxy by default.
- No old sample/demo data should appear in real tracker results.

### React

- Do not update React just because a newer version exists.
- Current build depends on React UMD files.
- React 19 upgrade belongs with a future build-system migration.

### Assets/deploy artifact

- "Deploy artifact" means `.deploy/pengo`, not waste.
- Assets do need to live somewhere.
- Current recommendation: measure/report size first, later separate stable heavy assets if needed.
- Do not commit `.deploy`.

### Mobile

- Fix obvious mobile breakage and reachability.
- Do not over-perfect mobile web because a dedicated mobile app is planned.

## Common commands

```powershell
npm test
npm run validate
npm run build:deploy
npm run smoke:deploy
```

Run from:

- `Scraper` for scraper tests/validation.
- `Site` for site build/deploy package and deploy smoke tests.

Repository backup made before the 2026-06-30 implementation pass:

- `C:\Pengo\BACKUP\30.06.2026\Nyx`

## Before pushing/deploying

1. Confirm backup exists.
2. `git status --short`
3. Run `npm test` in `Scraper`.
4. Run `npm run validate` in `Scraper`.
5. Run `npm run build:deploy` in `Site`.
6. Run `npm run smoke:deploy` in `Site`.
7. Commit intentionally.
8. Push to GitHub.
9. Deploy with Wrangler only after build passes.
