# Database artwork: zero-loss R2 migration

Git remains the source of truth. Every tracked PNG, JPEG, and WebP below
`Database/` stays in Git. The migration never deletes a Git file or an R2
object.

## Fixed storage contract

- Bucket: `nyx-database-assets`
- Public origin: `https://assets.pengo.gg`
- Worker binding: `DATABASE_ASSETS`
- Immutable object:
  `objects/sha256/<first-two-hash-characters>/<sha256>.<sniffed-extension>`
- Exact old-path alias: `legacy/Database/<original-path>`
- Immutable release manifest: `_manifests/releases/<git-commit>.json`
- Current manifest: `_manifests/latest.json`

Every upload and every existing object is checked by byte count, SHA-256,
`Content-Type`, and `Cache-Control` before latest can be published:

| Object | Content-Type | Cache-Control |
| --- | --- | --- |
| Canonical | Sniffed image MIME | `public, max-age=31536000, immutable` |
| Legacy alias | Sniffed image MIME | `public, max-age=300, must-revalidate` |
| Release manifest | `application/json; charset=utf-8` | `public, max-age=31536000, immutable` |
| Latest manifest | `application/json; charset=utf-8` | `public, max-age=60, must-revalidate` |

The inventory is made from NUL-separated Git-index paths. It reads the resolved
working bytes only after rejecting non-file index entries such as symlinks and
proving `Database/` matches the exact checked-out
commit. MIME type, dimensions, byte count, and SHA-256 come from file bytes,
not file names. A case-insensitive or Unicode-normalized path collision fails
unless both files have the same SHA-256.

## Trust boundaries and failure behavior

- GitHub passes repository variable `CLOUDFLARE_ACCOUNT_ID` and two R2 S3
  secrets only to the sync process: `R2_ACCESS_KEY_ID` and
  `R2_SECRET_ACCESS_KEY`.
- Use an R2 token limited to object read/write for only
  `nyx-database-assets`. Delete permission is not needed.
- Canonical objects are immutable. Existing bytes or metadata that disagree
  with the expected SHA-256 make the job stop. They are never overwritten.
- Exact legacy aliases may be replaced when the Git path has new bytes. The old
  bytes remain reachable through their immutable canonical key and old release
  manifests.
- Both manifests are written only after every object and alias is verified.
- Scheduled refreshes push their exact verified commit before R2 sync may
  update `_manifests/latest.json`; an unpushed commit can never become latest.
- Missing credentials, unresolved LFS pointers, source changes after inventory,
  unsafe paths, hash mismatches, build failures, and smoke failures all stop the
  live deploy.
- No sync code lists or deletes objects. There is no mirror-delete mode.

## Rollout and rollback

`PENGO_DATABASE_ASSET_MODE=dual` rewrites production URLs to R2 but keeps the
referenced local copies in the deploy artifact. `r2-only` performs the same
rewrite and omits those local copies. Scheduled live deploys read repository
variable `DATABASE_ASSET_MODE` and default to `local`; keep it pinned to
`local` until the staged cutover passes. Set it to `r2-only` manually only
after the entire cutover workflow succeeds. An R2-only file count must stay
below 5,000 and should stay below 2,000.

In effective `local` mode, scheduled jobs do not contact R2 and do not require
R2 credentials; a storage outage cannot block a pre-cutover local deployment.
In `dual` or `r2-only`, a successful additive sync remains mandatory before
Wrangler may deploy.

For initial backfill and cutover, run **Stage and cut over Database assets to
R2** manually. It tests the exact `main` commit, builds dual, performs the
additive sync, GETs and hashes every canonical object and every alias, deploys
dual, then GETs and SHA-256 verifies every unique canonical public URL, every
direct `assets.pengo.gg/legacy/Database/*` alias, and all legacy
`pengo.gg/Database/*` URLs with bounded concurrency and retries. The old paths
must serve the local static bytes when present and redirect to the exact alias
when absent. The crawl also checks the sniffed `Content-Type` and expected
cache rules for canonical objects, direct aliases, and old paths that redirect
to R2. Retained static old paths are byte/hash checked only because their
historic filename-derived MIME can differ. No static copy can be removed
unless all public checks pass. If its cutover input
is enabled, it then builds, smokes, and deploys R2-only and runs a smaller
second full live check over the same URLs. The workflow never changes repository variables.
An unsuccessful initial dual deployment/check rebuilds, smokes, and redeploys
the exact local artifact; a later R2-only failure restores the already-verified
dual artifact. Recovery steps leave the workflow red so the original failure
cannot be mistaken for success.

Legacy routing is static-first: local and dual serve a retained file from the
Worker `ASSETS` binding; R2-only redirects only when that file is absent.
`DATABASE_ASSET_LEGACY_REDIRECT=true` remains an explicit force-redirect
override, and emergency binding mode still takes precedence.

Rollback keeps all user data:

1. Build the last-known-good Git commit with
   `PENGO_DATABASE_ASSET_MODE=local`.
2. Deploy that verified artifact. Existing `/Database/*` files are served
   locally automatically, with no mutable Worker variable required.

For an origin outage when R2 itself is healthy, set
`DATABASE_ASSETS_EMERGENCY=true`. The Worker then reads the exact legacy key
through the private `DATABASE_ASSETS` binding. Remove the variable after the
public origin recovers. Cloudflare bucket/domain/token creation and live
variable changes are intentionally outside this repository change.

## Local verification

From `Site/`:

```powershell
npm run test:database-assets
npm run inventory:database-assets
$env:PENGO_DATABASE_ASSET_MODE = 'dual'; npm run build:deploy
$env:PENGO_DATABASE_ASSET_MODE = 'r2-only'; npm run build:deploy
npm run smoke:deploy
```

Without `--apply`, `npm run sync:database-assets:r2` is a read-only local plan.
