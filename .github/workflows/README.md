# Scheduled workflows

Three scheduled jobs keep pengo.gg fresh and deploy automatically.

| Workflow | Cadence | What it does |
|---|---|---|
| `code-watch.yml` | hourly, plus half-hour checks during detected livestream windows | detect official livestream windows -> active-code-only scrape -> semantic diff -> validate/build/deploy/commit only when codes changed |
| `data-refresh.yml` | every 6h | scrape banners + codes -> unit tests -> validate -> build -> deploy -> commit `Database/` |
| `roster-sync.yml` | daily | scrape rosters/materials/titles (`--skip-assets`) + banners + codes -> build -> deploy -> commit `Database/` |

Before any deploy:
- `data-refresh.yml` runs `Scraper` unit tests (`npm test`) and the structural data gate (`npm run validate`).
- `roster-sync.yml` and `code-watch.yml` run the structural data gate (`npm run validate`).
- A failure stops the run, so the already-live last-known-good is preserved.
- The deploy step is skipped automatically when no Cloudflare token is configured.

`code-watch.yml` is intentionally lighter than the full refresh:
- Before deciding its mode, it runs `npm run codes:livestreams`, which scans official YouTube feeds for version livestreams across Genshin, HSR, ZZZ, and WuWa, then updates `Scraper/codes/livestream-windows.json` only when the effective windows changed.
- Normal mode runs `npm run codes:watch`, which skips expired-table sweeps and Reddit.
- During active windows listed in `Scraper/codes/livestream-windows.json`, it runs `npm run codes:watch:deep`, which adds Reddit back for the detected game(s) and also enables the half-hour schedule.
- `--change-gated` ignores timestamp-only changes (`generatedAt`, `lastSuccessfulFetch`, existing `firstSeen`) and leaves `Database/Codes/codes.json` untouched when the actual code set did not change.

## Required repository secrets

- **`CLOUDFLARE_API_TOKEN`** - a Cloudflare API token with *Workers Scripts: Edit* (and *Account Settings: Read*) for account `84fb7e02642dd00a09839f38eb4d7e83`. Used by `wrangler deploy`.
- **`REDDIT_PROXY_BASE`** - the Contabo proxy base URL used by code-watch deep mode when GitHub runner IPs are rate-limited by Reddit RSS.
- **`REDDIT_PROXY_SECRET`** - shared secret sent as `X-Proxy-Secret` to the Contabo proxy. Keep this value synchronized with `/opt/asyce-reddit-proxy/.env` on the VPS.

Set these under **Settings -> Secrets and variables -> Actions**. Without the Cloudflare token, the workflows still scrape, validate, build, and commit data; they just skip the live deploy.

The Reddit proxy secrets are only needed for Reddit-backed deep code checks. Without them, normal hourly code-watch still runs, but livestream Reddit fallback is weaker when Reddit rate-limits GitHub Actions.

Image/asset syncs are intentionally **not** automated (they would bloat git history); run them manually when new character art is needed:

```bash
cd Scraper && node ./nanoka/scrape.mjs --game all
```
