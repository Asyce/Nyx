# Nyx launcher, Endfield, and HoYo execution plan

Date: 2026-08-24

Status: approved for execution

Companion tracker: `docs/nyx-launcher-endfield-hoyolab-execution-tracker-2026-08-24.md`

This is the canonical combined execution plan. It incorporates and supersedes the execution ordering of:

- `D:\PengoNyx\Nyx Launcher\launcher-audit-plan.md`
- `docs/endfield-exports-achievements-playtime-plan-2026-08-24.md`
- `docs/hoyolab-data-and-account-plan-2026-08-24.md`

The source documents remain evidence for their locked contracts. Where their old launcher-source instructions differ, this document wins.

## Fixed bases and boundaries

- Launcher implementation repository: `D:\PengoNyx\Nyx Launcher\Repository`, verified at `v1.4` / `5ede520e8d8d86234e5f47442bf0bb29b940b9b9` before execution.
- Website/Worker repository: `C:\Pengo\Nyx`. Its dirty checkout is user-owned and must remain untouched; implementation uses a clean worktree from current `origin/main`.
- Historical `D:\ToBeDeleted\...` launcher trees and `ca2a506` are preservation evidence only.
- HoYo approval is confirmed for the automated static-data, account-reading, encrypted-sync, caching, refresh, public display, and deletion scope below. Record only a sanitized scope summary; never commit private correspondence.
- Endfield imports remain local to the browser profile for this goal. No Endfield login, backend, telemetry, or cross-device sync.
- Endfield V1 supports Windows global Gryphline, not CN/Hypergryph. Playtime has no export or cloud sync.
- This plan adds no HoYo account-achievement capability for Genshin or ZZZ; it preserves the existing separate Genshin achievement export and the separate ZZZ lane's current disabled state. WuWa/ZZZ achievement research, SignPath, and temporary signing are outside this goal.

## Execution and review rules

- Read this plan and its tracker at the start of every execution turn.
- Before work, set the active phase to `in-progress`. After implementation and prescribed checks, set it to `review`. Mark it `complete` only after its STOP evidence is accepted.
- Every STOP reports base and ending commits, changed files, exact tests, sanitized evidence, UI screenshots where applicable, known risks, and the next action.
- Use coherent per-repository commits. A phase is a review bundle, not necessarily one commit.
- Re-fetch before every release. Rebase compatible upstream changes and rerun checks; stop if an upstream change invalidates a locked assumption.
- Synthetic identities are used for screenshots. Real-account verification is observed locally without capture or is redacted.
- Never store cookies, tokens, passwords, signed URLs, authenticated response bodies, raw logs, or real identities in Git, CI, diagnostics, screenshots, handoffs, or the tracker.
- Feature releases increment the latest stable minor; repairs after publication increment the patch. Never reuse a tag/version. Tag, assembly, four-part package version, commit, channel, file tree, manifest, sizes, and SHA-256 hashes must agree.
- Deploy additive Site/Worker receivers before launcher capability flags and retain old contracts.
- Launcher packages are immutable. Before a launcher release, a failed receiver deploy returns to its recorded prior commit. After launcher release, do not roll the receiver below that launcher contract; disable the capability and publish a higher fixed launcher version.
- Rollback never deletes imports, v1 bundles, ciphertext, normalized playtime, or pending deletions.
- Production deployment requires explicit user authorization.

Do not simplify away:

- updater journal, rollback, hashes, safe paths, and reparse protection;
- last-known-good banner/background state and background crossfade/cancellation/generation guards;
- legacy account/profile/settings readers;
- process identity, executable revalidation, and bounded elevation;
- publisher consent, password cleanup, and quarantine;
- fail-closed unsupported capabilities and sanitized crash diagnostics;
- pinned Rust capture dependencies/security tests and bundled redemption codes;
- official-game icon override and custom-game icon/background support.

Do not add dependency injection, plugins, a new logging/telemetry service, silent updating, temporary signing, a localization framework, centralized package management, a chart library, a second process scanner, or another import server.

## Phase 0 - Reproducible bases and execution records

1. Fetch both repositories and record base commits, current production website commit, distributed launcher state, package metadata, prior deploy commits, and rollback points.
2. Create clean `codex/` worktrees without altering the dirty website checkout.
3. Save this plan, create its tracker, and add both to `docs/agent-index.md`.
4. Compare source with the distributed v1.4 launcher. Inventory the known development-channel and obsolete v1.0 metadata; Phase 1 repairs them, so they do not fail STOP 0.
5. Make a preservation ledger for relevant historical launcher changes. Do not reconstruct source from binaries.
6. Record the approved HoYo scope without private correspondence.
7. Run unchanged launcher, Site, Worker, package, and security baselines. Separate inherited failures from regressions.

### STOP 0

- Clean reproducible worktrees exist.
- Plan, tracker, agent-index links, bases, deploy state, preservation ledger, approval scope, and baseline evidence are recorded.
- Phase 1 is the tracker’s next action.

## Phase 1 - Trustworthy launcher releases

1. Replace most source-wording/XAML tests with one native Windows UI Automation smoke script. Retain behavioral, parser, security, migration, updater, process-validation, accessibility-name, and essential security-pattern checks.
2. The smoke script launches the package, rejects empty/black frames, switches all five games, opens Settings/account surfaces, and checks retry, collapse, launch, screenshots, focus, tab order, and keyboard use.
3. Run native UI smoke on the interactive `PENGO` workstation. Do not add a visual-testing framework or self-hosted CI infrastructure.
4. Add one GitHub-hosted Windows workflow for restore, Release build, .NET tests, `cargo test --locked`, vulnerability checks, and package verification. Enable formatting only in Phase 5 after the baseline is fixed.
5. Make stable packaging tag-driven, repair v1.4 metadata, retain a development-package command, update packaging documentation, and publish only a sealed verified package.
6. Keep releases transparently unsigned with published hashes. SignPath remains deferred with no placeholders.

### STOP 1

- Hosted checks pass.
- The package passes native smoke on `PENGO`.
- Tag, assembly, package, channel, manifest, commit, files, sizes, and hashes agree.

## Phase 2 - Requested launcher behavior

### Concurrent games

- Remove only the cross-HoYo UI guard that prevents a second different game.
- Keep per-game launch-in-flight, active-process, executable identity, and bounded-elevation gates.
- Permit every pair of different games; continue blocking a second instance of the same game.

### Account identity

- Reuse the shared identity line below `Account`.
- Keep Genshin, HSR, ZZZ, and Endfield name/UID/region rendering.
- Add optional validated identity to `WuWaAccountStatusResult` with constructor compatibility.
- Show name, full UID, and readable region where available; omit unavailable parts instead of guessing.
- Retain WuWa identity with a stale same-account snapshot. Clear only after disable, account/credential mismatch, identity rejection, or disposal.

### Banner layout

- Remove fixed widths and 390-DIP heights from XAML and code; keep only an 848-DIP maximum that fits five 160-DIP tiles.
- Make the translucent surface hug its content in width and height.
- Use 160-DIP tiles, 38-DIP icon backing, 34-DIP portraits, and 15-DIP names.
- Use `Enumerable.Chunk(5)` with native horizontal row stacks inside one vertical list; do not add a custom panel.
- Remove calculated widths that spread small groups across the panel.
- Use wrapping text with a 20-DIP block line height and no ellipsis, shrinking, or line limit. Every name remains visible.
- Keep small banner bodies naturally sized. If valid multi-phase content exceeds 330 DIP, use the native vertical scroll viewer; never add horizontal scrolling or hide names.

### Pre-install warning

- Reuse existing HoYo pre-download signals.
- Accept WuWa `isPreDownload: true` only as advisory state; never treat preload files as the installed main version.
- Keep Endfield detection off until an exact official GRYPHLINK signal is proven.
- Above energy show `Pre-install available — open Official Launcher` or `Update and pre-install available — open Official Launcher`.
- Make the text red, bold, keyboard accessible, screen-reader announced only on transition, and wired to the existing Official Launcher action.
- Enable the notice only while that existing Official Launcher action is available and not already busy; direct game launch remains independent.
- Give Official Launcher a static 2-DIP red border and faint tint only during pre-install. Do not animate or block direct launch; ordinary updates are not highlighted.

### STOP 2

- All ten different-game pairs and same-game exclusion pass.
- A second simultaneous launcher still redirects to the existing window, while close followed by immediate reopen releases the old instance cleanly.
- All five account identity surfaces pass, including WuWa stale/mismatch cases.
- Banner cases 1/2/5/10, a five-phase maximum-content fixture, every current name, `Hongshan Imperial Guard`, and an unbroken 80-character name pass at 100-200% scaling. Small fixtures remain natural-sized; the maximum fixture exposes every name through native vertical scrolling.
- All pre-install transitions and accessibility checks pass.

## Phase 3 - Static and animated background lifecycle

1. Reuse `LauncherVisualsCache` and `OfficialVideo.Fallback`.
2. Accept HoYo static/image-only art, WuWa `firstFrameImage`, and Endfield `url` when animation is absent.
3. Keep current visible, bundled, or last-known-good art while video starts. If video is absent or fails, show official static art rather than black. Continue accepting valid video-only responses.
4. Stage, validate, and atomically promote new art before deleting superseded cache files.
5. On failure retain working art and delete only failed temporary files.
6. Restrict deletion to Nyx-owned caches with safe-path and junction protection. Remove obsolete sealed art only through the updater’s exact file tree.

### STOP 3

- Image-only, video-only, combined, failure, cancellation, transition, cleanup, junction, and black-frame cases pass for all games.

## Phase 4 - Confirmed cleanup and existing lifecycle features

1. Move the two used achievement catalogs and five currency icons out of the launcher Database mirror; delete the confirmed-unused remainder and stale LFS rules.
2. Delete the dormant MSIX-only route while retaining ZIP installation/updating, app manifest, icon, rollback, and verification.
3. Stop writing no-op banner/art settings while retaining legacy readers until old settings are safely rewritten.
4. Remove retired splash/pinned state while preserving official icon overrides and custom-game art.
5. Remove banner collection UI/state/models. Schema v1 still requires exactly `collections: []`, rejects non-empty arrays, and discards the empty value.
6. Check the stable update manifest after the first frame, require user confirmation before download, and pass the package to the existing updater.
7. Keep only the latest export job per game and dispose jobs, cancellation sources, coordinators, semaphores, HTTP clients, and required shutdown work.

### STOP 4

- Clean-checkout build, migrations, updater tamper/interruption/confirmation/rollback, package verification, repeated-export, and shutdown-resource tests pass.

## Phase 5 - Account speed, structure, and maintenance

1. Render cached account data within one second when present. Refresh the selected game first, skip fresh entries, keep WuWa/SKPORT isolated, and reuse one serial HoYo WebView profile.
2. Add sanitized local timings for rendering, backgrounds, banners, account restoration/refresh, launch, and process-close detection.
3. Add provider/check-in/120-FPS/pulls/achievements/screenshots/background capabilities to the existing game catalog. Custom games default unsupported for account/export features.
4. Split touched `MainPage` responsibilities with concrete partials or existing services only. Keep shell wiring in `MainPage`; add no interfaces or factories.
5. Move `.NET 10.0.100` pin to the root, add one small `.editorconfig`, format once, then enable formatting verification.
6. Update dependencies one at a time. Test the compatible Windows SDK BuildTools patch first and WinUI 2.3.6 separately. Avoid unnecessary major test-framework upgrades; add pinned Rust vulnerability validation.
7. Try the trimmed self-contained updater. Keep it only if at least 25% smaller and verify/install/update/confirm/rollback all pass; otherwise retain the current updater.
8. Make achievement catalogs the sole version source for C#, Rust, packaging, and tests; review contents before stable releases.

### STOP 5

- Build, formatting, tests, package, native smoke, dependency checks, account timing, updater safety, and catalog agreement pass.

## Phase 6 - Official tools and static-data simplification

1. Do not add unknown fields to `launcher-banners-v1.json`.
2. Generate separate strict `launcher-tools-v1.json` through the existing Site workflow with only schema version, generation time, game, and stable tool ID/label/HTTPS URL.
3. Add official Wiki, Material Calculator, Battle Records, and Upgrade Guides where available. Validate exact first-party HTTPS allowlists before publishing and opening.
4. Cache the last valid tools feed; invalid/absent data merely hides tools.
5. Audit HSR Light Cones/relics and ZZZ W-Engines/Drive Discs against GameData. Replace factual Prydwen collections only with complete released rows, fields, assets, localization, and beta isolation.
6. Keep Prydwen recommendations and Library, lore, banners, events, codes, WuWa, and Endfield pipelines. Resolve conflicts through extracted official game data or an official release notice plus manual review.

### Release A

- Deploy tools first, then the immutable launcher package.
- Verify update discovery, package metadata/hashes, five-game smoke, concurrent launch, identities, banners, backgrounds, pre-install warning, and live official links.

## Locked Endfield pull contract

`pengo-pulls` v1 contains `kind`, `version`, `game: "ae"`, UTC `exportedAt`, account `uid`/`roleId`/`serverId`/`serverName`, and records with `id`, `recordType`, `seqId`, `poolId`, `poolName`, `poolType`, `itemId`, `name`, `itemType`, `rarity`, UTC `obtainedAt`, `isNew`, `isFree`, and weapon `batchId`.

- Maximum 10,000 records and 5 MiB.
- Profile key is exactly `ae:<serverId>:<roleId>`.
- Imports are additive and idempotent; the export contains only history the official service still retains.

### Locked launcher-to-Pengo handoff

- Atomically write the final JSON to `Downloads\Pengo Exports`, then serve those exact bytes once from loopback.
- Open `https://pengo.gg/endfield#nyx-import=v2&type=pulls|achievements&port=<port>&nonce=<nonce>`.
- Use a 256-bit random nonce, 15-second expiry, 5-MiB cap, JSON content type, no redirects, and an exact production-origin CORS allowlist. Permit an exact local origin only in development builds.
- Pengo removes the fragment immediately, fetches with credentials omitted and no referrer, shows a preview, and never auto-saves.
- Keep manual file import available whenever the one-use handoff fails.

## Phase 7 - Prove Endfield pulls

1. Read only the last 8 MiB of `%LOCALAPPDATA%\PlatformProcess\Cache\data_1` and `%USERPROFILE%\AppData\LocalLow\Gryphline\Endfield\sdklogs\HGWebview.log`. Select the newest valid history URL without printing/persisting it; keep `u8_token` in memory.
2. Call only:
   - `POST https://u8.gryphline.com/game/role/v1/query_role_list`
   - `GET https://ef-webview.gryphline.com/api/record/char`
   - `GET https://ef-webview.gryphline.com/api/record/weapon/pool`
   - `GET https://ef-webview.gryphline.com/api/record/weapon`
3. Prove identity, `seq_id`, pagination, timestamps, pool codes, ordering, and weapon grouping through consented local observation; refresh maintained Endfield banner IDs.
4. Lock rules:
   - Basic: 6-star hard 80, soft pity from 66, 5-star hard 10, selector 300 separate.
   - Beginner: maximum 40, 6-star by 40, 5-star hard 10.
   - Chartered: paid 80 carries; per-banner featured 120 is separate.
   - Fest/Joint: independent 80; selection reward 120 separate; no carry.
   - Arsenal: ten weapons per issue; 6-star by issue 4; first featured by issue 8; no carry.
   - Free Urgent Recruitment stays visible but never alters paid counters.
5. Enforce 250-ms pacing, 1-MiB responses, 2,000 pages, 10,000 records, 15-minute timeout, cancellation, no redirects, and no partial file.

### STOP 7

- Official identity/counts/pools/timestamps match, every field is explained, and secret scanning is clean.

## Phase 8 - Endfield pull exporter

1. Reuse the existing export coordinator/provider contract with one small provider dispatcher.
2. Add disabled-by-default `EndfieldPulls` and `Export pulls on next launch`.
3. Prepare locally, launch normally, then export in the background. If history is unavailable, tell the user to open the official history screen once.
4. Validate all responses and identifiers, write atomically without overwrite, serve identical bytes through the existing one-use bridge, open Pengo, and show progress/cancel/count/filename/sanitized errors.
5. Preserve exact loopback Host/Origin/nonce, GET/OPTIONS, Private Network Access preflight, no-store, one-delivery, 15-second expiry, 5-MiB cap, and zeroing protections. Invalid requests cannot reveal or consume the payload.

### STOP 8

- Export validates as `pengo-pulls` v1, saved/served bytes match, and cancellation/failure leaves no final partial file.

## Phase 9 - Pengo Endfield pull receiver

1. Parse strict `pengo-pulls` before legacy heuristics; a wrong present `kind` fails.
2. Preview identity, export time, new/duplicate records, pools, and retained-history warning. Default action is Merge.
3. Store profiles as `ae:<serverId>:<roleId>` and preserve all locked fields through IndexedDB. Suppress only duplicate-key `ConstraintError`.
4. Parameterize the shared tracker for 6/5-star Endfield rarities; do not fork it.
5. Implement Basic, Beginner, Chartered, Fest/Joint, and Arsenal rules exactly. Never show the existing guaranteed-next 50/50 rule for Endfield.
6. Only ten records complete an Arsenal issue; incomplete groups stay visible without changing pity.

### Release B

- Deploy the backward-compatible receiver first, enable pulls, publish the launcher, and verify export -> preview -> merge -> reload, duplicate imports, manual fallback, and two-account isolation.

## Locked Endfield achievement contract

`pengo-achievements` v2 contains kind/version/game, deterministic `catalogVersion`, UTC export time, account binding, and completed entries with canonical `id`, `level`, `plated`, and UTC `obtainedAt`.

- Do not export raw SKPORT IDs/hashes, names, descriptions, categories, unfinished progress, or rare-effect claims.
- Merge keeps highest level, logical-OR plating, and earliest valid date. Replace requires separate confirmation.
- Safely formed unknown IDs stay `catalog update needed` and remain outside totals.

## Phase 10 - Prove Endfield achievement completeness

1. Refresh released catalog chains from current client tables, retain ended events, exclude future rows, honor hidden flags, and derive version from game-data version plus content hash.
2. Precompute MD5-label-to-canonical-ID lookup; do not invent another mapping.
3. Through the isolated SKPORT WebView capture only `GET https://zonai.skport.com/api/v1/game/endfield/card/detail` for the selected role/server. Let the official page sign; never reproduce signing, export cookies, or retain raw responses.
4. Prove selected role/server, official completed count equals medal list length, list equals the complete official UI rather than showcased medals, every ID maps exactly once, and levels/plating/dates are valid.
5. Any failed predicate or unavailable consented evidence keeps `EndfieldAchievements` false for this goal. Reopen only with new official evidence or a documented API.

### STOP 10

- Complete proof passes, or the achievement lane is explicitly evidence-blocked. Pulls and Playtime continue either way.

## Phase 11 - Endfield achievements after proof

1. Extend the existing HSR publisher achievement provider.
2. Add `Export achievements now` with Endfield closed and visible SKPORT consent.
3. Export strict v2, failing the whole export on an unmapped current ID. Reuse atomic files and the typed bridge.
4. Preserve legacy/v1 imports. Offer monotonic Merge and separately confirmed Replace.
5. Show categories, filters, counts, levels, plating, earned dates, local icons, and hidden achievements without invented unfinished progress.
6. Keep the capability false until the round trip passes.

### STOP 11

- Official/export counts, preview, merge, reload, account isolation, levels, plating, dates, and GI/HSR regressions pass.

## Phase 12 - Endfield Playtime Stats

1. Port only useful rules into C#/WinUI; never execute or bundle the reference PowerShell.
2. Default to `%USERPROFILE%\AppData\LocalLow\Gryphline` with a native folder picker.
3. Scan newest-first `games*.log`, skip reparse points, and cap at 32 files, 64 MiB, 1,000,000 lines, or 10 seconds.
4. Parse gameplay (`Create game process ... Endfield.exe` to `Child process exits`) separately from launcher activity (`enter main` to `leave main`).
5. Pair only within a file, warn about unmatched markers, deduplicate rotations, reject ambiguous/non-monotonic dates, and accept positive sessions no longer than seven days.
6. Reuse the exact Endfield session pump for future tracking; persist pending start but commit only after the end. Prefer Nyx boundaries when within 60 seconds of historical boundaries.
7. Calculate verified total, sessions, active days, averages/extremes, streak, duration buckets, hourly launches, weekday/month time, and 22:00-06:00 play, correctly splitting midnight/year/daylight-saving boundaries.
8. Separately show launcher-open time, visits, game-launch visits, and launcher-only visits. Never add launcher time to gameplay.
9. Store normalized intervals only and add an accessible native dialog with normal, empty, scanning, capped, corrupt, and running-game states.

### Release C

- Deploy achievement support only if STOP 10 passed, package Playtime, and run full Endfield security, five-game, live `/endfield`, version, package, R2, and persistence verification.

## Locked HoYo privacy and sync contracts

- The launcher is the only account-snapshot writer; Pengo is read-only.
- Missing sync `kind` continues to mean pulls. HoYo uses `kind: "hoyolab"`, `auth:hoyolab:v1`, `hoyolab:v1`, and envelope `nyx-hoyolab-sync-v1`.
- One encrypted bundle per game supports at most eight roles. Full UID appears only after local decryption.
- Worker metadata contains only pseudonymous sync ID, authentication-token hash, game, ciphertext size, and timestamps.
- The 3-MiB cap fails visibly without truncation.
- Exclude forum/social data, friends, email, purchases, private messages, device fingerprints, raw battle traffic, cookies, tokens, passwords, raw bodies, and unreleased content.

## Phase 13 - Approved HoYo static comparison

1. Add one small adapter beside the existing GameData scraper with no new dependency/workflow.
2. Run it in the existing scheduled GameData workflow. Shadow output is artifact/summary only; publish no HoYo-derived data.
3. Observe three genuine upstream changes including a version boundary. Failures remain non-blocking and existing data stays last-known-good.
4. Promote fields individually only after complete coverage.

### STOP 13

- Items 1-4 and the static-source comparison checks pass; sanitized evidence proves no publication, non-blocking last-known-good failure behavior, three genuine upstream changes including a version boundary, and complete coverage for every promoted field.

## Phase 14 - Local HSR multi-role bundles

1. Reuse one isolated HoYo WebView profile, exact allowlists, per-capability consent, one operation gate, cancellation generation, and stale-result rejection.
2. Disable downloads, popups, permissions, autofill, and password saving. Credentials/CAPTCHA stay user-controlled; cookies stay in the profile.
3. Store up to eight roles per game in one Windows-protected v2 file; never put UID in a filename.
4. Keep separate observations for resources, inventory, builds, achievements, exploration, endgame, events, and currency. Missing means not refreshed; deletion requires a timestamped tombstone.
5. Migrate through temporary write, flush, reread, decrypt, validate, then atomic replace. V1 stays authoritative on failure and through the first v2 release. Remove it only in a later stable release after another successful validation; never overwrite newer v2 with v1.
6. For HSR, cover roles, stamina/reserve/check-in, inventory, characters, traces, Light Cones, relics, completed achievements, treasure/exploration, endgame modes, events, and currency reports where the approved source is complete.

### STOP 14

- Items 1-6 and the account-boundary, per-capability, multi-role, migration, privacy, and dedicated test-role checks pass; incomplete capabilities remain disabled, and v1 remains authoritative through the first v2 release.

## Phase 15 - Encrypted HSR sync and My HoYo

1. Reuse existing Worker/browser encryption, logically separate from pulls. Add manual sync first.
2. Offer a generated recovery code. If Pengo phrase words are reused, derive HoYo keys with separate domain labels. Store only protected derived keys after opt-in; never store/upload the raw recovery code.
3. Before upload pull/decrypt and merge by `(game, server, UID, capability)`: newest observation wins; equal-time conflicts stop; tombstone wins only if newer than the observation; retry one stale write then stop; never force-overwrite automatically.
4. Retain encrypted cloud data until deletion and warn that losing every remembered device and recovery code makes it unrecoverable.
5. `Remove from this PC` deletes local session/snapshot only. `Remove everywhere` also removes HoYo cloud roles and never touches pulls.
6. Failed/offline deletion removes the live session but keeps a minimal protected pending credential and visible state. Retry next online start and through `Retry deletion`; remove the credential only after server confirmation.
7. Add delete-one-role, one-game, all-HoYo, HoYo-only Worker `delete-account`, and separately confirmed entire-Pengo deletion.
8. Add website My HoYo, role/capability status, sync health, deletion, inventory-aware materials, owned builds, and complete approved record cards.
9. Keep full materials/gear UI on the website; launcher gets quick status, role management, sync, and Open My HoYo. Stale/unsupported data links to the official tool and never shows fake zero progress.

### STOP 15

- Items 1-9 and the calculator, merge/conflict, cross-runtime encryption, Worker-metadata, pull-compatibility, rotation/deletion-retry, privacy, and dedicated test-role checks pass end to end for manual HSR sync and My HoYo; automatic sync remains off.

## Phase 16 - Genshin account capabilities

Add roles, resin/check-in, inventory, characters, talents, weapons, artifacts, exploration, Spiral Abyss, Imaginarium Theater, events, and currency reports where complete. Do not add a HoYo account-achievement capability; preserve the existing separate Genshin achievement export unchanged.

### STOP 16

- Every listed Genshin capability whose approved source is complete passes account-boundary, calculator, per-capability, multi-role, manual-sync, privacy, and dedicated test-role checks; incomplete capabilities and HoYo account-achievement completion remain disabled, while the existing separate Genshin achievement export remains unchanged.

## Phase 17 - ZZZ account capabilities

Add roles, battery/check-in, inventory, Agents, skills, W-Engines, Drive Discs, Hollow Zero, Shiyu Defense, Deadly Assault, events, and currency reports where complete. Do not add a HoYo account-achievement capability; preserve the separate ZZZ achievement lane's current disabled state.

### STOP 17

- Every listed ZZZ capability whose approved source is complete passes account-boundary, calculator, per-capability, multi-role, manual-sync, privacy, and dedicated test-role checks; incomplete capabilities and HoYo account-achievement completion remain disabled, and the separate ZZZ achievement lane remains unchanged.

## Phase 18 - Automatic sync and source retirement

1. Enable automatic sync only after explicit user opt-in and successful manual-sync, merge/conflict, migration, deletion, privacy, backward-compatibility, and multi-device tests.
2. Skip byte-identical state, limit resource-only uploads to hourly, and upload full refreshes or Sync now immediately.
3. Warn after two hours for website resource estimates and after 24 hours for other snapshots.
4. Retire the injected HSR reader only after launcher sync and local/file fallbacks are accepted.
5. Retire factual third-party data only after complete coverage, three-change shadow evidence including a version boundary, successful builds, and tested fallback.
6. Keep Nyx recommendations, Library/lore, banners/events/codes, WuWa, and Endfield sources unchanged.

### STOP 18

- Items 1-6 pass; automatic sync is enabled only after every item 1 test passes, the injected HSR reader has accepted launcher-sync and local/file-fallback evidence, and each retired factual source has complete-coverage, three-change/version-boundary, build, and tested-fallback evidence.

## Completion audit

Run and record:

- launcher .NET/Rust/build/package/security checks and native five-game smoke on `PENGO`;
- every different-game pair, same-game rapid launch, process exit, identity, banner size/name/scaling, preload, background, keyboard, screen-reader, high-contrast, and black-frame case;
- Endfield parsing, pagination, limits, cancellation, atomic file, bridge security, duplicate/account/rule, achievement proof, and Playtime boundary cases;
- HoYo source coverage, calculators, allowlists, role limits, migrations, JS/.NET encryption vectors, tampering, game swaps, merges, tombstones, conflicts, rotation, deletion retry, metadata privacy, pull compatibility, and multi-device behavior;
- receiver-first deployment, immutable launcher packages, live production version/package/R2 checks, and rollback proof.

Completion requires every unconditional phase and release marked `complete`, every remaining item explicitly `blocked` or `not-applicable` with evidence, and a final plan/tracker consistency review. Endfield achievements may finish only as proven/released or explicitly evidence-blocked.
