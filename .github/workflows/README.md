# Scheduled workflows

Six scheduled jobs keep pengo.gg fresh and deploy automatically.

| Workflow | Cadence | What it does |
|---|---|---|
| `gamedata-watch.yml` | every 15 min | compare Nanoka's manifest -> when a supported game changed, sync its live/beta JSON and assets -> GameData-only validate -> build -> smoke -> commit -> rebuild with exact commit metadata -> deploy |
| `code-watch.yml` | hourly, plus half-hour checks during detected livestream windows | detect official livestream windows -> active-code-only scrape -> semantic diff -> validate -> commit -> build -> smoke -> deploy only when codes changed |
| `data-refresh.yml` | every 6h | scrape banners + codes -> unit tests -> strict validate -> commit `Database/` -> build -> smoke -> deploy |
| `roster-sync.yml` | daily | scrape secondary rosters/materials/titles + banners + codes -> strict validate -> commit `Database/` -> build -> smoke -> deploy |
| `side-data-sync.yml` | daily | scrape birthdays/namecards/signatures/holidays/TCG/furniture/Endfield skill icons/Genshin banner history -> strict validate -> commit `Database/` and Genshin banner helper -> build -> smoke -> deploy |
| `gamedata-asset-sync.yml` | daily | download missing local GameData assets -> commit only `Database/GameData/*/assets` -> build -> smoke -> deploy |

Before any deploy:
- `gamedata-watch.yml` takes the expensive path only when Nanoka's supported manifest sections differ from the tracked manifest. Its collapse guard and GameData-only validator cover both live and beta output without letting unrelated banner or Endfield failures block the refresh. It downloads new assets in the same run.
- `data-refresh.yml` runs `Scraper` unit tests (`npm test`) and the strict data gate (`npm run validate:strict`), which fails deploys when required banner data is stale, invalid, or unavailable.
- `roster-sync.yml` runs the same strict data gate (`npm run validate:strict`).
- `side-data-sync.yml` runs the same strict data gate (`npm run validate:strict`) after the secondary scrapers finish. It installs Crawl4AI and Chromium, but each Crawl4AI-backed fetch has a plain HTTP fallback.
- `gamedata-asset-sync.yml` runs scraper unit tests and restores scraper-generated JSON churn before committing, so the deploy maps to an asset-only commit.
- `code-watch.yml` runs the structural data gate (`npm run validate`) because it is a fast codes-only deploy path and does not refresh banners.
- A failure stops the run, so the already-live last-known-good is preserved.
- Refreshed data is committed before the deploy step, so the deployed site maps back to a Git commit.
- `Site` runs `npm run smoke:deploy` after `build:deploy` and before Wrangler deploy. It checks clean routes, key assets, import-helper copy, encrypted sync UI, bundled React output, script checksum, and `version.json`.
- The deploy step is skipped automatically when no Cloudflare token is configured.

`code-watch.yml` is intentionally lighter than the full refresh:
- Before deciding its mode, it runs `npm run codes:livestreams`, which scans official YouTube feeds for version livestreams across Genshin, HSR, ZZZ, WuWa, and Arknights: Endfield, then updates `Scraper/codes/livestream-windows.json` only when the effective windows changed.
- Normal mode runs `npm run codes:watch`, which skips expired-table sweeps and Reddit.
- During active windows listed in `Scraper/codes/livestream-windows.json`, it runs `npm run codes:watch:deep`, which adds Reddit back for the detected game(s) and also enables the half-hour schedule.
- `--change-gated` ignores timestamp-only changes (`generatedAt`, `lastSuccessfulFetch`, existing `firstSeen`) and leaves `Database/Codes/codes.json` untouched when the actual code set did not change.

## Required repository secrets

- **`CLOUDFLARE_API_TOKEN`** - a Cloudflare API token with *Workers Scripts: Edit* (and *Account Settings: Read*) for account `84fb7e02642dd00a09839f38eb4d7e83`. Used by `wrangler deploy`.
- **`REDDIT_PROXY_BASE`** - the Contabo proxy base URL used by code-watch deep mode when GitHub runner IPs are rate-limited by Reddit RSS.
- **`REDDIT_PROXY_SECRET`** - shared secret sent as `X-Proxy-Secret` to the Contabo proxy. Keep this value synchronized with `/opt/asyce-reddit-proxy/.env` on the VPS.

Set these under **Settings -> Secrets and variables -> Actions**. Without the Cloudflare token, the workflows still scrape, validate, build, and commit data; they just skip the live deploy.

The Reddit proxy secrets are only needed for Reddit-backed deep code checks. Without them, normal hourly code-watch still runs, but livestream Reddit fallback is weaker when Reddit rate-limits GitHub Actions.

GameData asset syncs are automated without `--force-assets`, so existing local images are not re-downloaded. Use a manual run only when you intentionally need to re-fetch existing images:

```bash
cd Scraper && node ./gamedata/scrape.mjs --game all --force-assets
```
