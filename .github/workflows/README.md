# Scheduled workflows

Two scheduled jobs keep pengo.gg fresh and deploy automatically.

| Workflow | Cadence | What it does |
|---|---|---|
| `data-refresh.yml` | every 6h | scrape banners + codes → unit tests → validate → build → deploy → commit `Database/` |
| `roster-sync.yml` | daily | scrape rosters/materials/titles (`--skip-assets`) + banners + codes → build → deploy → commit `Database/` |

Both:
- Run `Scraper` unit tests (`npm test`) and the structural data gate (`npm run validate`) **before** building. A failure stops the run, so the already-live last-known-good is preserved.
- Skip the deploy step automatically when no Cloudflare token is configured.

## Required repository secret

- **`CLOUDFLARE_API_TOKEN`** — a Cloudflare API token with *Workers Scripts: Edit* (and *Account Settings: Read*) for account `84fb7e02642dd00a09839f38eb4d7e83`. Used by `wrangler deploy`.

Set it under **Settings → Secrets and variables → Actions**. Without it, the workflows still scrape, validate, build, and commit data — they just skip the live deploy.

Image/asset syncs are intentionally **not** automated (they would bloat git history); run them manually when new character art is needed:

```
cd Scraper && node ./nanoka/scrape.mjs --game all
```
