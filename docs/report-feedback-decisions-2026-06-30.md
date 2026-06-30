# Report Feedback Decisions

Date: 2026-06-30

This document supersedes parts of the earlier review wording where the product direction was clarified after the report.

## Executive summary feedback decisions

### 1. Import helper options

Decision: provide both paths.

- Keep a quick PowerShell command for users who want the fastest PC import.
- Also provide the safer download, inspect, hash-verify, then run flow.
- Both paths should use the same Pengo-hosted script, not old Asyce URLs.
- The UI must explain the tradeoff in plain language.

Implementation direction:

- Quick command: downloads and runs the Pengo helper from `https://pengo.gg/scripts/pengo-pulls.ps1`.
- Safer flow: download `pengo-pulls.ps1`, view source, verify SHA-256, run locally.

### 2. Banner accuracy

Decision: make banner accuracy a dedicated data-quality workstream.

Recommended approach:

- Keep using scrapers, but separate structural validation from freshness validation.
- Add source-health output per game.
- Add strict deploy gating for `invalid` data.
- Keep carry-forward for temporary source failures, but label it clearly in UI and data-health output.
- Add tests and fixtures for each banner source.

The goal is not merely to fail builds. The goal is consistent, explainable banner confidence across all games.

Implementation status after the 2026-06-30 pass:

- A fresh banner scrape was run before deploy.
- HSR and ZZZ moved to `fresh`.
- Genshin and Wuthering Waves still report `invalid`; Endfield reports `unavailable`.
- The UI already shows these states instead of presenting them as confirmed live banners.
- The remaining work is better source coverage and stricter deploy gating once the source quality is improved.

### 3. Deploy artifact and assets

Clarification: "artifact" does not imply waste.

In this context, deploy artifact means the folder Cloudflare deploys: `.deploy/pengo`. It includes the site, assets, generated data, styles, scripts, and referenced Database images.

The issue is not that assets are bad or unnecessary. Game files/images do need to live somewhere. The issue is operational:

- a very large deploy package is slower to build and publish
- scheduled data-only updates may republish a lot of unchanged art
- large generated JS/data can affect page load

Recommendation:

- Keep source assets in Git when they are source-of-truth assets the project owns or relies on.
- Use Git LFS for very large stable data/assets where appropriate.
- Avoid deploying unchanged heavy assets every time if they can be separated later.
- Add size reporting first; enforce budgets only after a clear target exists.

### 4. Mobile

Decision: fix practical mobile issues, but do not over-perfect mobile web.

Mobile will later have a dedicated app, so the site only needs baseline usability:

- no clipped brand
- core controls reachable
- import/manage flows usable
- no obvious broken layout

Do not spend large design cycles perfecting mobile-only web interactions if the dedicated app will replace them.

### 5. Sample/demo data and accounts

Decision:

- Remove old sample/demo data from the real tracker flow.
- Keep remembering previous real imports locally.
- Investigate account/sync later so users can keep history across browsers/devices.

Implementation direction:

- Ignore and remove old `nyx-tracker-*` sample localStorage.
- Use IndexedDB as the local source of truth.
- Store import source/provenance in metadata.
- Add account/sync as a separate future workstream, not mixed into the immediate import cleanup.

### 6. CI/deploy order

Decision: do it.

Recommended implementation:

- CI should commit refreshed data before deploy.
- Deploy should map to a committed SHA.
- Use `npm ci` in workflows.
- Add route smoke tests and version metadata.

### 7. Worker allowlist and no-Origin explanation

The Worker has a CORS/origin gate for `/api/gacha/*`.

Current concern:

- Old domains are still trusted.
- Requests without an `Origin` header are accepted.

Plain explanation:

- Browser requests include an `Origin` header, so CORS can block unknown websites from using Pengo's API in a browser.
- Server scripts, curl, and some non-browser clients may send no `Origin`.
- Allowing no-Origin requests means the endpoint can still be used directly outside a browser. Rate limiting helps, but it is a wider access surface.

Recommendation:

- Keep no-Origin only if we intentionally support scripts/non-browser clients.
- Otherwise reject no-Origin for production API requests and allow it only in local/dev or signed internal cases.
- Remove old Asyce/Nyxarium origins unless they are still intentionally supported.
- Move trusted preview origins to environment config.

### 8. Architecture/tooling recommendation

Recommendation: do not start with a big rewrite.

Short term:

- Keep the current React 18 UMD/custom build.
- Add tests, route smoke checks, source maps where practical, and clearer docs.
- Split files only when touching that feature area.

Medium term:

- Move toward a standard Vite/esbuild import-based app with hashed chunks and lazy-loaded data.
- Split materials/tracker/database into feature modules.

Do this after trust, imports, data gates, mobile basics, and deploy provenance are stable.

## React update decision

Recommendation: do not update React yet.

Reason:

- Nyx currently copies React UMD files from `node_modules/react/umd` and `react-dom/umd`.
- React 19 no longer ships the same UMD build layout that this custom build expects.
- The app is not using React 19 features that would create a meaningful user benefit right now.

React upgrade should be paired with the future build-system migration away from UMD globals. Updating React alone is more likely to break the build than improve the product.

## GitHub asset decision

Question: should everything currently on GitHub be on GitHub?

Recommendation:

- Keep source data, generated data needed for reproducible builds, scripts, and app assets in Git for now.
- Keep very large source-of-truth data/assets in Git LFS where needed.
- Do not commit deploy output (`.deploy`) or local build caches.
- Later, consider moving stable heavy image assets to a CDN/static asset bucket if deploy size becomes a blocker.

GitHub is acceptable as the current source of truth. The bigger issue is not GitHub storage by itself; it is repeatedly packaging/deploying a very large asset set for small data changes.
