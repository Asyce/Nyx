# Nyx launcher, Endfield, and HoYo execution tracker

Date created: 2026-08-24

Canonical plan: [Nyx launcher, Endfield, and HoYo execution plan](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md)

- **Overall status:** `in-progress`
- **Current phase:** [Phase 1 - Trustworthy launcher releases](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-1---trustworthy-launcher-releases) (`in-progress`)
- **Current STOP:** [STOP 1](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#stop-1)
- **Last verified (Europe/Paris):** 2026-08-24 20:10:56 CEST (UTC+02:00)
- **Next action:** Implement Phase 1 release metadata/packaging/CI and native smoke work, fixing its recorded readiness and path-length baselines.
- **Active blockers:** None recorded.

## Status vocabulary

- `not-started`: no work has begun.
- `in-progress`: execution is underway.
- `review`: implementation and prescribed checks are complete; STOP acceptance is pending.
- `complete`: evidence and review are accepted.
- `blocked`: work cannot proceed; the blocker is logged.
- `not-applicable`: the item is intentionally excluded with evidence and an accepted decision.

## Current bases and deploy state

| Component | Branch/state | Commit/version | Recorded state |
|---|---|---|---|
| Nyx Site/Worker | `codex/nyx-combined-execution-20260824` at `C:\Pengo\Nyx-combined-execution-20260824` | `6758c6b2174ca4c0c46606d6c89e5e29ee5f604f` | Clean worktree created from `origin/main`. Baseline-generated timestamp/line-ending changes were verified and restored; only the three Phase 0 documents are pending. |
| Launcher | `codex/nyx-combined-execution-20260824` at `D:\PengoNyx\Nyx Launcher\Worktrees\combined-execution-20260824` | `5ede520e8d8d86234e5f47442bf0bb29b940b9b9` / tag `v1.4` | Clean execution base in the separate launcher repository. |
| Production website | `/version.json` | `6758c6b2174ca4c0c46606d6c89e5e29ee5f604f` | `builtAt: 2026-08-24T17:37:52.662Z`; current pre-release rollback reference. |
| Distributed launcher | GitHub tag/release state | tag `v1.4` exists | Latest-release API returns 404; Phase 1 repairs release metadata, so this is not a STOP 0 blocker. |

Re-fetch and re-verify every base, live state, and rollback point immediately before a release.

## Preservation ledger

| Source/evidence | Disposition | Verification |
|---|---|---|
| Standalone launcher `v1.4` | Authoritative implementation base. | Tag and worktree both resolve to `5ede520e8d8d86234e5f47442bf0bb29b940b9b9`. |
| Historical launcher commit `ca2a50618a35634cd120ef17ff36fa4e7b834ff0` | Preservation evidence only; do not import it over v1.4. | Commit remains readable as `feat(desktop): complete account resources and layout studio`. Historical execution evidence reports a 308-file import with zero blob mismatches; that is not reused as current-build proof. |
| `D:\ToBeDeleted\Nyx-launcher-cleanup-2026-08-20\C-Pengo\Nyx-desktop` | Unavailable historical worktree. Its formerly reported 13 unstaged tracked changes cannot be recovered from the missing directory and are not an implementation input. | `Test-Path` returned false on 2026-08-24; the committed historical ref above remains available. |
| Distributed launcher state | No GitHub `latest` release object exists. The v1.4 source still defaults packaging/manifest text to `1.0.0.0` and `development`; Phase 1 repairs this known mismatch. | GitHub latest-release API returned 404; exact repository matches are in the Phase 0 evidence row. |
| Dirty `C:\Pengo\Nyx` checkout | User-owned and untouched. | All work is in the clean worktree recorded above. |

## Phase tracker

| Phase | Status | Remaining/next | Launcher commit | Nyx commit | Evidence | Review |
|---|---|---|---|---|---|---|
| [Phase 0 - Reproducible bases and execution records](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-0---reproducible-bases-and-execution-records) | `complete` | None. | `5ede520e8d8d86234e5f47442bf0bb29b940b9b9` | `6758c6b2174ca4c0c46606d6c89e5e29ee5f604f` | Bases, live deploy, preservation ledger, approval scope, and baseline rows below. | STOP 0 accepted by main Sol on 2026-08-24. |
| [Phase 1 - Trustworthy launcher releases](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-1---trustworthy-launcher-releases) | `in-progress` | Implement release metadata, stable/development packaging, hosted checks, and native smoke. | `5ede520e8d8d86234e5f47442bf0bb29b940b9b9` | — | Phase 0 launcher baseline below. | Pending. |
| [Phase 2 - Requested launcher behavior](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-2---requested-launcher-behavior) | `not-started` | Start after STOP 1. | — | — | — | — |
| [Phase 3 - Static and animated background lifecycle](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-3---static-and-animated-background-lifecycle) | `not-started` | Start after STOP 2. | — | — | — | — |
| [Phase 4 - Confirmed cleanup and existing lifecycle features](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-4---confirmed-cleanup-and-existing-lifecycle-features) | `not-started` | Start after STOP 3. | — | — | — | — |
| [Phase 5 - Account speed, structure, and maintenance](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-5---account-speed-structure-and-maintenance) | `not-started` | Start after STOP 4. | — | — | — | — |
| [Phase 6 - Official tools and static-data simplification](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-6---official-tools-and-static-data-simplification) | `not-started` | Start after STOP 5; prepare Release A. | — | — | — | — |
| [Phase 7 - Prove Endfield pulls](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-7---prove-endfield-pulls) | `not-started` | Start after Release A. | — | — | — | — |
| [Phase 8 - Endfield pull exporter](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-8---endfield-pull-exporter) | `not-started` | Start after STOP 7. | — | — | — | — |
| [Phase 9 - Pengo Endfield pull receiver](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-9---pengo-endfield-pull-receiver) | `not-started` | Start after STOP 8; prepare Release B. | — | — | — | — |
| [Phase 10 - Prove Endfield achievement completeness](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-10---prove-endfield-achievement-completeness) | `not-started` | Start after Release B. | — | — | — | — |
| [Phase 11 - Endfield achievements after proof](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-11---endfield-achievements-after-proof) | `not-started` | Start only after the linked proof passes. | — | — | — | — |
| [Phase 12 - Endfield Playtime Stats](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-12---endfield-playtime-stats) | `not-started` | Start after the Phase 10 outcome; prepare Release C. | — | — | — | — |
| [Phase 13 - Approved HoYo static comparison](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-13---approved-hoyo-static-comparison) | `not-started` | Start after Release C. | — | — | — | — |
| [Phase 14 - Local HSR multi-role bundles](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-14---local-hsr-multi-role-bundles) | `not-started` | Start after Phase 13 evidence. | — | — | — | — |
| [Phase 15 - Encrypted HSR sync and My HoYo](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-15---encrypted-hsr-sync-and-my-hoyo) | `not-started` | Start after the local HSR bundle is accepted. | — | — | — | — |
| [Phase 16 - Genshin account capabilities](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-16---genshin-account-capabilities) | `not-started` | Start after the HSR manual-sync stage is accepted. | — | — | — | — |
| [Phase 17 - ZZZ account capabilities](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-17---zzz-account-capabilities) | `not-started` | Start after the Genshin stage is accepted. | — | — | — | — |
| [Phase 18 - Automatic sync and source retirement](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-18---automatic-sync-and-source-retirement) | `not-started` | Start after all manual-sync and capability gates pass. | — | — | — | — |

## Release tracker

| Release | Status | Receiver/deploy commit | Launcher version/commit | Live evidence | Rollback point |
|---|---|---|---|---|---|
| [Release A - official tools and launcher foundation](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#release-a) | `not-started` | — | — | — | Re-verify before deploy; current production is `6758c6b2174ca4c0c46606d6c89e5e29ee5f604f`. |
| [Release B - Endfield pulls](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#release-b) | `not-started` | — | — | — | Record immediately before receiver deploy. |
| [Release C - Endfield achievements if proven and Playtime](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#release-c) | `not-started` | — | — | — | Record immediately before receiver/package release. |
| [HoYo stage 0 - static comparison shadow](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-13---approved-hoyo-static-comparison) | `not-started` | — | — | — | Record before any later promotion. |
| [HoYo stage 1 - local HSR multi-role bundle](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-14---local-hsr-multi-role-bundles) | `not-started` | — | — | — | Record before launcher release. |
| [HoYo stage 2 - manual HSR sync and My HoYo](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-15---encrypted-hsr-sync-and-my-hoyo) | `not-started` | — | — | — | Record before receiver deploy. |
| [HoYo stage 3 - Genshin account capabilities](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-16---genshin-account-capabilities) | `not-started` | — | — | — | Record before receiver deploy. |
| [HoYo stage 4 - ZZZ account capabilities](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-17---zzz-account-capabilities) | `not-started` | — | — | — | Record before receiver deploy. |
| [HoYo stage 5 - automatic sync and source retirement](nyx-launcher-endfield-hoyolab-execution-plan-2026-08-24.md#phase-18---automatic-sync-and-source-retirement) | `not-started` | — | — | — | Record before enablement or retirement. |

## Update rules

1. Read the full canonical plan and this tracker at the start of every execution turn.
2. Use `not-started` → `in-progress` → `review` → `complete`. A rejected review returns to `in-progress`; a resolved `blocked` item returns to `in-progress`. Use `blocked` or `not-applicable` only with a dated log entry and evidence.
3. Never mark a phase or release `complete` without its prescribed evidence and accepted review/STOP.
4. Keep inherited baseline failures separate from regressions introduced by this work.
5. Record every Site, Worker, receiver, or launcher deployment immediately with its commit/version, live evidence, and rollback point.
6. Record an accepted decision or deviation before starting work that depends on it; never silently change the plan.
7. Keep every entry sanitized. Never record secrets, private approval correspondence, real identities, credential or signed URLs, authenticated response bodies, or raw logs.

## Evidence log

Append dated rows; do not rewrite or remove accepted evidence.

| Date (Europe/Paris) | Phase/release | Evidence | Command/artifact | Review outcome |
|---|---|---|---|---|
| 2026-08-24 | Phase 0 | Launcher restore/build and Rust baseline pass: Release build has 0 warnings/errors; Rust has 54/54 passing. .NET has 2,167/2,168 passing; the inherited failure is the real readiness check returning 13. | `dotnet restore`; `dotnet build -c Release -r win-x64 --no-restore`; `cargo test --locked`; `dotnet test -c Release` at launcher base `5ede520e`. | Baseline recorded; readiness repair belongs to Phase 1. |
| 2026-08-24 | Phase 0 | Launcher readiness returns 13 because reviewed unpackaged output is incomplete. Formatting reports 19 inherited whitespace errors. Package PE/security gate passes, then the pinned FPS helper checkout fails on Windows path length; no ZIP/hash/manifest is produced. | `start-nyx.ps1 -CheckOnly`; `dotnet format --verify-no-changes`; `build-development-package.ps1 -Version 1.4.0.0`. | Baseline recorded; none is attributed to this plan's changes. |
| 2026-08-24 | Phase 0 | Scraper has 212/212 passing and strict five-game freshness 5/5. Achievement tests have 22/22 passing; launcher-visual tests have 17/17 passing. | `npm test`; `npm run validate:strict`; `npm run test:achievements`; `npm run test:launcher-visuals`. | Passed. |
| 2026-08-24 | Phase 0 | Dependency installation succeeds but Node 20.18 emits engine warnings; npm reports one high advisory in Scraper and five high/one low in Site. No dependency change was made. | `npm ci` in `Scraper` and `Site`. | Inherited environment/dependency baseline; recheck before Release A. |
| 2026-08-24 | Phase 0 | Site deploy build reaches generated output but fails its inherited file ceiling: 20,356 before SEO versus 19,999 allowed. Subsequent smoke fails because `/genshin` was not built. Baseline-generated tracked timestamp/line-ending changes were inspected and restored. | `npm run build:deploy`; `npm run smoke:deploy`; final `git status --short`. | Baseline recorded; must be green before Release A. |
| 2026-08-24 | Phase 0 | Worker database-assets contract has 13/13 passing. Wrangler 4.86 dry-run parses/bundles the Worker and bindings successfully; no deploy occurred. | `node --test tools/tests/worker-database-assets.test.mjs`; `wrangler deploy --dry-run --config wrangler.jsonc`. | Passed. |
| 2026-08-24 | Phase 0 | Production `/version.json` matches Site base `6758c6b2`; previous candidate rollback commits are `b604afa0` and `e9965e57`, subject to re-verification immediately before deployment. | Live `/version.json`; `git log -5 origin/main`. | Current deployment and candidates recorded. |
| 2026-08-24 | STOP 0 | Both clean worktrees, all three linked documents, current/rollback state, preservation and approval decisions, inherited baselines, and Phase 1 next action are present and internally consistent. Required-plan coverage check found 19 phase headers, 19 tracker rows, and zero missing locked phrases. | Main Sol review; `git diff --check`; focused plan/tracker consistency script. | Accepted. |

## Decisions/deviations

Append dated rows before dependent work begins; keep approval records sanitized.

| Date (Europe/Paris) | Phase/release | Decision/deviation | Reason | Acceptance evidence |
|---|---|---|---|---|
| 2026-08-24 | Phase 0 | Use standalone launcher `v1.4` as the only implementation base; preserve `ca2a50618` as evidence and do not reconstruct from binaries or the missing old worktree. | This is the newest verified launcher source and avoids overwriting either repository's unrelated work. | Canonical plan boundary plus verified refs/path state. |
| 2026-08-24 | HoYo stages | Approval covers the plan's automated static comparison, account reading, encrypted sync, caching/refresh, public account display, and deletion for the listed GI/HSR/ZZZ capabilities. No private correspondence is stored. | User confirmed approval; the approved sanitized scope is sufficient for implementation. | User decision recorded in the canonical plan and this tracker. |
| 2026-08-24 | Phase 0 | Treat current package version/channel, readiness, formatting, path-length, and Site file-ceiling failures as inherited baselines, not STOP 0 failures. | Each was reproduced before implementation; later STOPs explicitly require their relevant paths to pass. | Exact evidence rows above. |

## Active blockers

Append dated rows when a status becomes `blocked`; keep resolved rows and note their resolution.

| Date (Europe/Paris) | Phase/release | Blocker | Needed to resume | Resolution |
|---|---|---|---|---|

## Final unresolved items

| Item | Status | Evidence | Resolution needed |
|---|---|---|---|
