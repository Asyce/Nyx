# Dead-Code Triage — 2026-07-07 (nyx-0013)

Source: `repowise dead-code` at HEAD (152 findings; graph: 6,723 symbols, 8,980 edges).
Full raw table: regenerate anytime with `repowise dead-code` inside `C:\Pengo\Nyx`.
Nothing was deleted — this is the classification + the plan for a cleanup session.

## Classification

| Bucket | Count | Verdict |
|---|---|---|
| `unused_export` (tool-marked ✓ safe) | 95 | **Actionable.** Exported symbols nothing imports. Cleanup session: remove export keyword or the symbol; build + smoke after each batch of ~10. |
| `unreachable_file` (40% confidence, ✗ not safe) | 55 | **Mostly false positives.** Nearly all are `Scraper/**` files with "no importers" — but Scraper scripts are CLI *entrypoints* run by npm scripts and GitHub workflows, invisible to the import graph. Rule: cross-reference each against `Scraper/package.json` scripts and `.github/workflows/*.yml` before believing it; only files matched by neither are candidates. |
| `zombie_package` | 2 | **Check first.** Likely unused npm dependencies; confirm with a grep for the package name before removing from package.json. |

## How to run the cleanup (any session, Sonnet-grade)

1. `repowise dead-code` fresh (data drifts with commits).
2. Do the 95 unused exports in batches; after each batch: `npm --prefix Site run build`
   + `npm --prefix Scraper test`.
3. For the 55 unreachable files apply the entrypoint rule above; expect to delete few.
4. The 2 zombie packages last (smallest risk of merge pain).
5. One commit per bucket; no deletions of anything under `Database/` (data, not code).

## Why not now

Deleting 95 symbols is mechanical but touches many files — it deserves a dedicated
session with fresh context and the full gate run, not the tail of a review day.
