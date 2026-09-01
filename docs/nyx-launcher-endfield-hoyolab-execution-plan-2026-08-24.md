# Nyx launcher, gear exports, Endfield, and HoYo execution plan

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
- Launcher preservation floor: `D:\PengoNyx\Nyx Launcher\Worktrees\combined-execution-20260824` at `2de115e4068fbf2ffc5ef9f9b2673a711276fca8`, preserving the accepted execution history, `9173350edc2514caafd3bea05191a26f3c80cf3e` (Genshin 7.0 achievement export), `273dfb57e06e5bf5ef79f74028ca7640a28b6f35` (one Documents export root), and the reviewed Endfield pull exporter. Continue from the latest verified descendant recorded in the tracker, after checking for newer work under `D:\PengoNyx`; this historical floor is not an instruction to return to the older tree. Never reset, overwrite, or reconstruct around user-added fixes.
- Website/Worker repository: `C:\Pengo\Nyx`. Its dirty checkout is user-owned and must remain untouched; implementation uses a clean worktree from current `origin/main`.
- Historical `D:\ToBeDeleted\...` launcher trees and `ca2a506` are preservation evidence only.
- HoYo approval is confirmed for the automated static-data, account-reading, encrypted-sync, caching, refresh, public display, and deletion scope below. Record only a sanitized scope summary; never commit private correspondence.
- Endfield imports remain local to the browser profile for this goal. No Endfield login, backend, telemetry, or cross-device sync.
- Endfield V1 supports Windows global Gryphline, not CN/Hypergryph. Playtime has no export or cloud sync.
- This plan adds no HoYo account-achievement capability for Genshin or ZZZ; it preserves the existing separate Genshin achievement export and the separate ZZZ lane's current disabled state. WuWa/ZZZ achievement research, SignPath, and temporary signing are outside this goal.
- The added gear lane exports only HSR relics and Genshin artifacts to local optimizer-compatible JSON. It does not add a Pengo gear database, website receiver, cloud sync, live optimizer stream, character/weapon/material inventory export, or ZZZ/WuWa/Endfield gear support.
- Nyx never installs or bundles Npcap/libpcap. A built-in Windows Packet Monitor path may ship only after the Phase 6A non-interference and no-trace-file proof; otherwise the existing separately installed, hash/signature-checked Npcap path may remain a visible fallback only after its remaining public-release hardening passes.
- Gear and achievement capture is always visibly armed by the user. Never persist raw packets, `.pcap`, `.pcapng`, `.etl`, decrypted payloads, session keys, credential URLs, or third-party account cookies.

## Execution and review rules

- Read this plan and its tracker at the start of every execution turn.
- Before every launcher implementation phase, inventory the launcher worktrees and local refs under `D:\PengoNyx`. If a newer clean tested descendant exists, advance the canonical execution worktree by fast-forward only and record it. If the newest work is dirty or divergent, preserve it and stop for explicit reconciliation instead of copying files, rebasing it away, or choosing an older checkout.
- Before work, set the active phase to `in-progress`. After implementation and prescribed checks, set it to `review`. Mark it `complete` only after its STOP evidence is accepted.
- A user-action, approval, or private-data gate blocks only its dependent path. Before pausing, scan the tracker and complete every safe independent phase, evidence refresh, review, test, and preparation step that is already unlocked; never bypass the blocked STOP.
- Every STOP reports base and ending commits, changed files, exact tests, sanitized evidence, UI screenshots where applicable, known risks, and the next action.
- Use coherent per-repository commits. A phase is a review bundle, not necessarily one commit.
- Re-fetch before every push and release. Reconcile compatible upstream changes without rewriting published history and rerun affected checks; never force-push. Stop if an upstream change invalidates a locked assumption.
- Synthetic identities are used for screenshots. Real-account verification is observed locally without capture or is redacted.
- Treat a HoYoLAB failure inside Nyx as a Nyx integration defect first. Reproduce the exact official page in a normal browser before classifying an official outage; only the same independent failure supports that classification.
- Never store cookies, tokens, passwords, signed URLs, authenticated response bodies, raw logs, or real identities in Git, CI, diagnostics, screenshots, handoffs, or the tracker.
- Feature releases increment the latest stable minor; repairs after publication increment the patch. Never reuse a tag/version. Tag, assembly, four-part package version, commit, channel, file tree, manifest, sizes, and SHA-256 hashes must agree.
- Deploy additive Site/Worker receivers before launcher capability flags and retain old contracts.
- Launcher packages are immutable. Before a launcher release, a failed receiver deploy restores the recorded prior public behavior. When the first Durable Object class creation prevents an old-version rollback, forward-deploy a checked correction or temporarily reject only HoYo requests in the existing kind dispatcher; retain `HoyoSyncObject`, its binding, migration history and stored ciphertext. Never delete/recreate the namespace to enable rollback. After launcher release, do not roll the receiver below that launcher contract; disable the capability and publish a higher fixed launcher version.
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

Do not add dependency injection, plugins, a new logging/telemetry service, silent updating, temporary signing, a localization framework, centralized package management, a chart library, a second process scanner, another import server, a second export coordinator/helper, automatic third-party upload, or a raw-packet file path.

## Locked external exporter source decisions

Re-fetch and re-review every source immediately before adoption. The audit pins below are evidence, not floating dependencies. The 2026-08-31 refresh found current HSR 4.5 candidate protocol sources; it does not establish installed-game compatibility or a complete account-bound bag.

| Source and audited pin | License/permission | Accepted use |
|---|---|---|
| [`hashblen/auto-artifactarium`](https://github.com/hashblen/auto-artifactarium/tree/04421c4f8a7ed7e7b65bb5e6e59231d4e98405cf) `04421c4f8a7ed7e7b65bb5e6e59231d4e98405cf` | MIT | Already vendored at the same pin with Pengo bounds and logging removal. It is the Genshin achievement/transport parser despite its name; it does not prove artifact-inventory export. Reuse it rather than adding another Genshin transport stack. |
| [`hashblen/auto-reliquary`](https://github.com/hashblen/auto-reliquary/tree/bc23b48cb3b1b994a5d4405cefea42eb0e1d3735) `bc23b48cb3b1b994a5d4405cefea42eb0e1d3735` | MIT | Already vendored at the same pin with Pengo bounds and logging removal. It is the HSR achievement/transport parser; it does not export relic inventory. Reuse its transport path. |
| [`IceDynamix/reliquary`](https://github.com/IceDynamix/reliquary/tree/d5cf3b7e7e66470d2d8efff6676aa18762b21d3b) `d5cf3b7e7e66470d2d8efff6676aa18762b21d3b` (`23.0.0`, HSR 4.5) | MIT | Current candidate source for the smallest HSR token/login/bag protobuf and resource mapping slice. The 2026-08-29 update replaces the earlier 4.4-only reference; it changes command IDs and field numbers, so stale values must not be reused. Independently qualify the exact needed fields and transport assumptions before a non-shipping observer; no code or mapping ships until STOP 6B passes. Do not import its full generated protocol surface. |
| [`Mar-7th/StarRailRes`](https://github.com/Mar-7th/StarRailRes/tree/f1b643637554019f6d611ac9240410bbe9698da8) `f1b643637554019f6d611ac9240410bbe9698da8` | AGPL-3.0 | Current HSR 4.5 static relic/set/main-affix/sub-affix coverage evidence only. It proves no command ID, protobuf field number, packet magic, standard key, account binding, or complete bag. Copy/package only the four minimal resource files if the launcher can meet the license/source/notice obligations; otherwise use an independently permitted pinned source with the same coverage. |
| [`juliuskreutz/stardb-exporter`](https://github.com/juliuskreutz/stardb-exporter/tree/50c04597d37cf366290de6e316aaca98dd57acfc) `50c04597d37cf366290de6e316aaca98dd57acfc` (`v2.21.0`) | No repository license at the audited pin. Existing `Extractor/Achievements/PROVENANCE.md` records direct permission for the public key maps and extractor behavior. | The update adds one public HSR key (29 to 30), preserves every old pair, and leaves the GI map and export/capture behavior unchanged. Adopt only that additive map refresh after immutable-source hashes, preservation regression and independent tests/review pass; this is not live HSR 4.5 proof. Treat other implementation details as reference-only unless permission is recorded. Do not copy stored auth cookies, clipboard credential URLs, raw `latest.pcapng`, third-party sync/delete, trace logging, auto-update, or auto-elevation. |
| [`IceDynamix/reliquary-archiver`](https://github.com/IceDynamix/reliquary-archiver/tree/cb109f17a4a15b7604cfe9d078a8735e7735cd25) `cb109f17a4a15b7604cfe9d078a8735e7735cd25` (`v0.18.0`) | MIT | Current HSR 4.5 consumer of Reliquary 23; adapt only the proven login/bag completion idea and relic-field mappings after current-patch proof. Its new RAW/IPv4/IPv6 normalization is for offline packet files, not an owned no-install live backend; Packet Monitor stays at 0.6.2. Reject its GUI, full-inventory scope, raw capture-file import, websocket/live stream, logs, self-update, build-time resource downloads, silent missing-map drops, and partial export behavior. |
| [`konkers/irminsul`](https://github.com/konkers/irminsul/tree/781006e82d76b29b10b21125aa3bc1b79ddf7b3c) `781006e82d76b29b10b21125aa3bc1b79ddf7b3c` | MIT | Current Genshin 7.0 reference for the `PlayerStoreNotify` full-item candidate, artifact fields, and GOOD-v3 conversion only. It does not bind the snapshot to an account, prove completion, pin its downloaded mapping snapshot, or reset stored inventory on a new connection. Reject its Packet Monitor/pcap capture, Administrator path, GUI, updater, logs, packet files, clipboard, broad inventory export, arbitrary ten-item minimum, silent mapping drops, and direct file writer. |
| [`konkers/auto-artifactarium`](https://github.com/konkers/auto-artifactarium/tree/4ba25fac64b88970143af6bc2a2ef51338e620d0) `4ba25fac64b88970143af6bc2a2ef51338e620d0` | MIT | Current Genshin 7.0 candidate evidence for command `8132`, the minimal item protobuf, and its login/session-key heuristic. Adapt only the smallest independently bounded decoder into Pengo's already-vendored transport; do not add a second transport/key stack or copy its unchecked frame, connection, crypto, or KCP parsing. |
| [`konkers/anime-game-data`](https://github.com/konkers/anime-game-data/tree/dfc03cdb5e27807a876b8d4dff17b3f67a320f5c) `dfc03cdb5e27807a876b8d4dff17b3f67a320f5c` | MIT | Candidate artifact/set/slot/property/affix mapping code only. Its caller downloads the latest external resource snapshot during each build, so Nyx must separately pin and hash one current-patch snapshot, generate Pengo-generated offline mappings, and fail on every missing row; never call its updater at build or runtime. |
| [`Dimbreath/animegamedata2`](https://gitlab.com/Dimbreath/animegamedata2/-/tree/26df1dfbdf05a82bbb1d97506859f3e1c40718d8) `26df1dfbdf05a82bbb1d97506859f3e1c40718d8` (`CNRELWin7.0.0_R47482070_S47579390_D47579390`) | No repository license at the audited pin; the user records approval for this HoYo data use. | Exact current Genshin 7.0 raw mapping snapshot only, within the recorded approval. Pin and hash only the relic, main-property, and affix inputs needed to generate Pengo-generated offline mappings, credit the source, and fail on missing rows. Copy no code and perform no floating build/runtime download. |
| [`emmachase/pktmon`](https://github.com/emmachase/pktmon/tree/33d1c0c421ed8610540bae3e34da3c1182cf28a2) `33d1c0c421ed8610540bae3e34da3c1182cf28a2` (`0.6.2`) | MIT | Design reference for a no-install Windows Packet Monitor capture backend only. Do not adopt its machine-wide stop/filter-reset behavior; Nyx must prove owned-session coexistence and cleanup on supported Windows builds first. |
| [`fribbels/hsr-optimizer`](https://github.com/fribbels/hsr-optimizer/tree/99790f5514159655eb9865de612c7cdec01ae097) `99790f5514159655eb9865de612c7cdec01ae097` | MIT | HSR manual-import consumer and de facto Reliquary/HSR-Scanner v4 format authority. Pin its accepted source/version/relic fields and import behavior in fixtures. Do not add its websocket path or export unrelated character, light-cone, material, or currency data. |

The Genshin format authority is the exact MIT [`frzyc/genshin-optimizer`](https://github.com/frzyc/genshin-optimizer/tree/984d82cda1e37a3a634ab14d2059b6ad91b90a4a) pin `984d82cda1e37a3a634ab14d2059b6ad91b90a4a`: artifact-only GOOD v3. Its committed normalized set/property/character mappings validate standard GOOD output, but its item map leaves 207 IDs unresolved and does not supply the raw item-to-slot/rarity, property-ID, or affix-ID decoder tables; it is a consumer/validation authority, not the raw decoder source. The first HSR release deliberately targets Fribbels' richer Reliquary-compatible v4 manual import instead of SROD v1 because SROD drops the unique-ID, roll-step, discard, reroll, and preview data already present in the proven bag model. Pin both consumers in tests; ship one format per game and do not create a Nyx-only gear schema.

## Phase 0 - Reproducible bases and execution records

1. Fetch both repositories; inventory local launcher worktrees/refs under `D:\PengoNyx`; and record base commits, current production website commit, distributed launcher state, package metadata, prior deploy commits, and rollback points.
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

## Independent gear-export lane

This lane may execute after Release A while STOP 7 waits for manual Endfield UI navigation. Run Phase 6A first, then the two independent branches `6B -> 6C -> Release D` and `6D -> 6E -> Release E` in either order. A failed real-account completeness proof blocks only its game and never weakens the other branch or an existing pull/achievement export. The release letters are stable plan identifiers, not guaranteed publication order; this lane does not reorder or bypass Endfield Phases 7-12 or HoYo Phases 13-18.

## Locked local gear export contract

- Extend the existing `ExportKind`, arming state, coordinator, job/status model, atomic writer, bounded native helper, package verifier, and sanitized diagnostics with one `Gear` lane. Do not create another coordinator, helper executable, capture service, handoff server, or generic plugin layer.
- Save only to the latest launcher's existing protected `Documents\Pengo Exports\<game>` boundary with an exclusive temporary file, flush, cancellation check, and no-overwrite atomic rename. Maximum accepted output is 10,000 gear rows and 32 MiB; exceeding either fails without truncation or a final file.
- HSR writes a relic-only Fribbels Reliquary/HSR-Scanner v4 manual-import JSON file; Genshin writes artifact-only GOOD v3 JSON. For HSR, use the consumer's documented compatibility discriminator only after a fixture proves the pinned importer accepts it, identify Nyx truthfully in `build`, and include empty unrelated arrays only where the importer requires them—never fake currency, character, or equipment data. Do not add private fields, UID-bearing filenames, or a custom wrapper.
- Before mapping, require one selected game account/connection, a current supported game-data version, one complete inventory snapshot, unique internal instance IDs, exact static IDs, valid levels/rarities/slots/stats, and no missing lookup. Standard formats may omit internal IDs, but the validator must still use them to reject a mixed or duplicate snapshot.
- HSR maps the pinned v4 relic fields only: stable unique ID, set ID/name, slot, rarity, level, main stat, every substat value plus count/step, reroll/preview substats when present, equipped location, lock, and discard. Genshin maps only current GOOD v3 artifact fields, including supported roll/mark/crafted/unactivated-substat fields when the complete source supplies them. Do not invent values for fields the packet or consumer does not provide.
- Gear export is manual local-file output. Do not open or authenticate to an optimizer, upload automatically, use the clipboard, add a Pengo receiver, or retain a live stream. The launcher shows progress, cancel, count, safe filename, `Open folder`, and sanitized failure guidance.

## Phase 6A - Qualify external exporters and no-install capture

1. Re-fetch the five requested repositories, the indirect MIT `pktmon` 0.6.2 source, and both pinned optimizer consumers. Record exact commits, releases, licenses/permission scope, dependency trees, build downloads, importer contracts, required copyright/license notices, and any drift from the locked table before using code or data. Update provenance and packaged third-party notices for every copied/adapted source or schema.
2. Confirm the existing Pengo `auto-artifactarium`, `auto-reliquary`, Stardb key-map, protocol-key provenance, catalog hashes, and parser hardening against their pins without printing key contents. A missing license or permission never silently broadens an accepted use.
3. Compare Stardb pull discovery with Nyx's existing bounded GI/HSR/ZZZ cache/log discovery, strict HTTPS host/path/query allowlists, paging, identity, atomic writing, and memory-only credential handling. First map the existing tests for newest semantic version/data directory, empty/invalid candidates, exact official endpoint, paging/account isolation, limits, cancellation, redirects, and atomic output. Add code only for a reproduced supported-global gap; otherwise record no functional change and add only the missing regression proving credential URLs never reach disk, logs, diagnostics, clipboard, packet files, or third parties.
4. Compare achievement capture/decoding with the two parser repos and Stardb. First map existing coverage for reordered packets/fields, multiple conversations, short/malformed frames, duplicates, wrong game/version, unknown/unreleased IDs, bounds, timeout, cancellation, and cleanup; add only missing cases. Keep Nyx's complete-catalog/account validation and output/import bytes. Before any public capture release, wipe decrypted/session buffers, refresh current-patch key/protobuf/catalog fixtures, and prove cancel/timeout/parser-failure cleanup.
5. Prototype the smallest in-memory Windows Packet Monitor backend from the pinned MIT source. Probe the required Packet Monitor APIs before elevation and evidence-block the backend immediately when they are absent. Only this backend may start the exact hash-verified helper through `runas` after a clear per-run explanation and explicit UAC confirmation. The Npcap backend must keep using the same helper unelevated and must continue refusing Administrator mode. Use fixed game UDP ports, a bounded queue, existing packet/byte/frame/time caps, verified System32 loading, and no shell or caller-supplied path/filter/command.
6. Packet Monitor must use real-time memory delivery with no `.etl`, `.pcap`, `.pcapng`, trace log, or crash residue. It must refuse rather than stop, unload, clear filters from, or otherwise alter a Packet Monitor session it does not own; it must always stop and remove only its own state after success, cancellation, timeout, crash, or launcher exit.
7. Test supported Windows 11 builds as standard user plus explicit helper elevation, UAC cancel, Ethernet, Wi-Fi, VPN on/off, sleep/resume, game close, launcher close, repeated capture, concurrent pulls, and both GI/HSR ports. If the backend cannot prove non-interference and zero raw-file residue, do not ship it or claim “no install.” The existing separately installed, hash/signature-checked Npcap path may be offered only as an explicit choice after buffer wiping, native-boundary review, cleanup/coverage proof, and package tests pass; never install it automatically or switch to it silently.

### STOP 6A

- The source/permission table is current; accepted and rejected deltas are recorded; existing parser pins and every required packaged notice are accounted for; the exact Fribbels-v4 and GOOD-v3 import fixtures pass; pull discovery has either a reproduced fix or an evidence-backed no-change result; achievement release blockers have exact owners/tests; and the no-install Packet Monitor path is either accepted by the full safety matrix or explicitly evidence-blocked without weakening a separately accepted fallback.

## Phase 6B - Prove current HSR relic completeness

1. Reuse the accepted source-independent, test-only observer and transport/capture boundary. The newly pinned MIT Reliquary 23 / archiver 0.18 sources provide HSR 4.5 candidates; independently qualify only token/login/bag/relic fields and transport assumptions before adding a minimal non-shipping wire observer. Generate no 4.5 protobuf from stale 4.4 values and import neither the archiver application nor its full protocol surface.
2. Independently prove the installed HSR patch's command IDs, protobuf field numbers, packet header/tail magic, and standard key before feeding any live frame. Pin and test the qualified 4.5 source slice, including malformed bounds and legitimate proto3 default/empty-list behavior. A current source release or an added dispatch key alone does not prove installed-game compatibility, account binding or complete inventory; every unproven value fails closed.
3. Pin one current static mapping slice for relics, sets, slots, main affixes, and sub affixes. The audited 4.5 StarRailRes commit proves coverage; if used in a package, include only its four minimal files and satisfy AGPL source/license/notice duties. Do not add its other resources or a build/runtime downloader.
4. Reset state on every new token/connection and bind the bag to exactly one nonzero UID on one flow/generation. Require successful token, login, and bag response codes. Accept one complete bag response, including an empty relic list; reject mixed conversations, duplicate instance IDs, unknown required fields, missing mappings, decoder ambiguity, silent row drops, or a partial snapshot.
5. With explicit local consent, compare sanitized source and serialized counts plus representative equipped/unequipped, locked/unlocked, discarded/kept, planar/cavern, leveled/unleveled, every main/substat type, count/step, reroll/preview, update/delete, duplicate, and unknown-map case with the official inventory and pinned Fribbels importer. Retain only pass/fail booleans, counts needed for the proof, source hashes, and current game-data version—never packets, payloads, item IDs, UID, or screenshots containing account data.

### STOP 6B

- Current-patch account binding, complete bag count, required field/mapping coverage, empty-list behavior, representative official-UI comparisons, limits, cleanup, and secret scan pass. Any failed predicate evidence-blocks HSR gear and Phase 6C does not start.

## Phase 6C - HSR relic export in the launcher

1. If the Genshin branch has not already added the locked shared `Gear` plumbing, add it now as a third flag/task to the existing export coordinator and migration-safe arming state, defaulting off; otherwise reuse it. Add `Export relics on next launch` only for an accepted HSR capability.
2. Extend the existing bounded Rust helper and exact process/pipe/cancel/hash/package boundary. If achievements and gear are both armed, one helper and one packet session feeds both decoders; never run competing captures. After verified cleanup, write each independently complete requested artifact and write nothing for an incomplete one.
3. Add only the proven HSR bag decoder/resource mappings and strict relic-only Fribbels v4 writer. Fail the whole relic file on an unknown required field/key, silently omitted row, duplicate instance, source/serialized/imported count mismatch, mixed account, stale game version, overflow, cancellation, capture cleanup failure, or pinned-consumer rejection.
4. Preserve all existing pull and achievement behavior, output bytes, HoYoLAB achievement selection, feature flags, and manual imports. Gear failure cannot cancel a completed pull export or delete an earlier export.
5. Run synthetic malformed/limit/account/version fixtures, exact current-patch real-account proof, combined achievements+gear capture, pulls+gear concurrency, UAC/fallback cases, package verification, and five-game native smoke.

### Release D

- Publish the next immutable launcher version only after STOP 6A-6C, independent security/minimalism review, full launcher/Rust/package tests, package-verifier confirmation of required third-party notices, clean-install/update verification, and exact public-package HSR relic export into the pinned Fribbels manual importer. Ship the no-install claim only if its own STOP 6A proof passed.

## Phase 6D - Prove current Genshin artifact completeness

1. Start from the accepted Pengo `auto-artifactarium` transport only. Use the newly audited Irminsul sources only as current Genshin 7.0 candidate evidence for `PlayerStoreNotify` command `8132`, its minimal item protobuf, and artifact-to-GOOD fields. Do not import their second transport, capture backends, GUI, updater, logs, packet files, clipboard/file output, or unrelated inventory code.
2. Reuse the shared test-only, protocol-independent observer for common reset, account, limit, duplicate, and count invariants; keep the actual HSR and Genshin wire proofs separate. Bind the first accepted Genshin flow to one token/header account, clear all item state on every handshake/token/flow change, and reject a second account or conversation. Do not accept Irminsul's arbitrary ten-item minimum or one-message replacement as completion evidence; parse a protocol-valid empty snapshot and fail closed until current-patch observation proves the complete-message boundary.
3. Pin the exact installed-patch command/protobuf evidence and verify the approved `animegamedata2` commit plus SHA-256 for only `ReliquaryExcelConfigData.json`, `ReliquaryMainPropExcelConfigData.json`, and `ReliquaryAffixExcelConfigData.json`. Generate one sorted Pengo-generated offline map and validate its set/slot/stat/location keys against the pinned Genshin Optimizer artifact, avatar, and character mappings. Include the exact sorted rarity-1-2 item-ID allowlist needed by the count-only rule so an unknown item still fails closed. `konkers/anime-game-data` remains evidence only; no updater, text map, avatar raw table, set-name table, or obfuscated scheme/wear table is needed.
4. Reject a zero/underflow level, duplicate or zero instance ID, depot mismatch, missing/ambiguous mapping, silently skipped active or unactivated affix, invented default, unsupported field, overflow, or partial row. Map unactivated affix key/value when present, but omit GOOD's optional `initialValue` until packet semantics prove it; never infer initial rolls from list order.
5. Prove that the accepted message covers the full artifact bag, not only equipped/showcased pieces. The pinned Optimizer accepts rarity 3-5 only, so require `observed total = supported 3-5 count + explicit unsupported 1-2 count` and `serialized = imported = supported count`; never silently omit or coerce low-rarity items. Any unknown set, slot, property, affix, character, or unsupported reason outside that exact low-rarity rule fails the export. With explicit local consent, compare only sanitized stable counts plus representative equipped/unequipped, locked/unlocked, rarity/level, every slot/main-stat type, active/unactivated substats, current proven GOOD v3 optional flags, update/delete behavior, repeated relog, and current pinned importer results with the official inventory. Retain no UID, item ID, payload, packet, path, or screenshot containing account data.
6. Do not substitute HoYoLAB equipped-only data, OCR/UI automation, game-memory reads, cache guessing, or invented defaults. The candidate source improves the observer design but does not itself satisfy STOP 6D.

### STOP 6D

- The current-patch full-bag boundary, account binding/reset, stable observed/supported/unsupported/serialized/imported count equation, exact offline mapping snapshot, every required GOOD field, empty-list behavior, representative official-UI comparisons, limits, cleanup, and secret scan pass. If any predicate remains unproven, mark only Genshin gear evidence-blocked and do not ship an equipped-only, silently filtered, partial, or guessed export.

## Phase 6E - Genshin artifact export in the launcher

1. If the HSR branch has already added the locked shared `Gear` task, helper, capture session, arming migration, output boundary, UI, and cleanup, reuse it. Otherwise add that same minimal shared plumbing here. Add no second Genshin exporter stack.
2. Add only the proven artifact decoder/mappings and strict artifact-only GOOD v3 writer. Use exact standard keys and values; fail the whole file on any mixed account, missing mapping, duplicate instance, unsupported current version, invalid field, overflow, cancellation, cleanup failure, or schema rejection.
3. When achievements and artifacts are both armed, capture both through the same helper/session and preserve independently complete outputs exactly as in Phase 6C. Keep pulls independent and unchanged.
4. Run malformed/limit/account/version fixtures, exact current-patch real-account proof, combined achievements+artifacts, pulls+artifacts concurrency, UAC/fallback cases, package verification, and five-game native smoke.

### Release E

- Publish the next immutable launcher version only after STOP 6D, Phase 6E tests/review, package-verifier confirmation of required third-party notices, clean-install/update verification, and exact public-package Genshin artifact export into the current GOOD importer. If STOP 6D is evidence-blocked, Release E remains blocked; Release D and every existing export remain valid.

## Locked Endfield pull contract

`pengo-pulls` v1 contains `kind`, `version`, `game: "ae"`, UTC `exportedAt`, account `uid`/`roleId`/`serverId`/`serverName`, and records with `id`, `recordType`, `seqId`, `poolId`, `poolName`, `poolType`, `itemId`, `name`, `itemType`, `rarity`, UTC `obtainedAt`, `isNew`, `isFree`, and weapon `batchId`.

- Maximum 10,000 records and 5 MiB.
- Profile key is exactly `ae:<serverId>:<roleId>`.
- `recordType` is exactly `character` or `weapon`; `id` is exactly `<recordType>:<poolId>:<seqId>`.
- Official character pool types map exactly as Standard -> `basic`, Beginner -> `beginner`, Special -> `chartered`, and Joint -> `fest-joint`; every weapon pool maps to `arsenal`.
- Character rows use `itemType: "character"`. Weapon rows preserve the official `weaponType` as `itemType` and use their official `poolId` as `batchId`.
- Exact `gift_intel_book` rows count toward source ordering and safety limits but are excluded from exported records and pity; every other unknown row kind fails closed.
- Imports are additive and idempotent; the export contains only history the official service still retains.

### Locked launcher-to-Pengo handoff

- Atomically write the final JSON to `Documents\Pengo Exports`, then serve those exact bytes once from loopback.
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
2. Preview identity, export time, new/duplicate records, pools, and retained-history warning. Label every displayed time with its explicit time-zone offset so an official UTC-05:00 time is never confused with the same instant rendered locally. Default action is Merge.
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

## Phase 12 - Shared local Play Time

1. Treat every supplied Endfield script and retained-log parser as research only. Never execute, bundle, copy, or adapt its broad marker matching.
2. Ship no Endfield historical import. `games*.log` mixes launcher and uncorrelated process markers; `HGEventLog` has no trustworthy paired exit, stable session identity, fixed retention, or safe overlap rule. Do not scan launcher, SDK, Unity, or game logs; remove the Endfield-only stats window, folder picker, historical estimates, and launcher-activity totals.
3. Reuse the existing exact per-game runtime-process evidence and the existing shared session refresh. Count only a runtime process belonging to a launch request accepted by Nyx. A process started outside Nyx is never added, even if Nyx later observes it.
4. Track every official and custom game independently so different games may accrue time concurrently. Continue preventing more than one launch of the same game. For a custom game without a separate runtime path, its selected executable is the runtime; with a runtime path, the selected executable is only the bootstrap.
5. Persist only one nonnegative saturating whole-second total per valid game. Keep the active boundary in memory, retry a failed save without losing the newest total, and finalize only through confirmed process evidence. Do not persist session history, starts, statistics, incomplete counters, or the rejected unpublished v6 Endfield state.
6. Add one small always-visible outlined line in the utility cell below Screenshots: `Play Time: 0m`, `Play Time: 42m`, or `Play Time: 12h 34m`. Give it the same translucent backdrop and border as the energy/resource panel. Update it through the existing refresh path. If saving is pending, say so without exposing internal errors.
7. The tooltip and accessible description must state that this is playtime on this PC counted only after Nyx launched the game while Nyx remained open; earlier sessions, launches outside Nyx, other PCs, consoles, and mobile are excluded.
8. Prove official and custom games, external-launch exclusion, simultaneous different-game isolation, same-game launch prevention, runtime-versus-bootstrap handling, uncertainty/removal/shutdown boundaries, persistence retries and saturation, v5/v6-to-v7 zero-total migration, exact formatting/disclosure, and complete absence of Endfield log/history/statistics controls.

### Release C

- Deploy achievement support only if STOP 10 passed. Package shared local Play Time without changing Site/R2 data. In the same launcher-only release, keep banner names on one line without clipping, place characters beside each other without fixed-width gaps, place the same-sized Official Tools button directly below Official Launcher, place Play Time below Screenshots with the energy panel's translucent backdrop and border, outline the title-bar controls, and lower only the game rail icons to reduce Nyx-logo misclicks. Then run launcher security, five-game, custom-game, concurrent-session, version, package, persistence, and layout verification.
- With Nyx initially closed, launch and close one short game through Nyx, require one plausible increase and restart persistence. Then run two different games concurrently and require each total to increase independently. Starting a game outside Nyx must not increase its total. Endfield uses this same path; historical lifetime playtime is deliberately unavailable.

## Locked HoYo privacy and sync contracts

- The launcher is the only account-snapshot writer; Pengo is read-only.
- Missing sync `kind` continues to mean pulls. HoYo uses `kind: "hoyolab"`, `auth:hoyolab:v1`, `hoyolab:v1`, and envelope `nyx-hoyolab-sync-v1`.
- One encrypted bundle per game supports at most eight roles. Full UID appears only after local decryption.
- Worker metadata contains only pseudonymous sync ID, authentication-token hash, game, ciphertext size, and timestamps.
- The decrypted bundle cap is 3 MiB and fails visibly without truncation. Bound the AES-GCM tag and larger Base64/JSON transport separately without weakening the existing pull-sync request cap.
- Exclude forum/social data, friends, email, purchases, private messages, device fingerprints, raw battle traffic, cookies, tokens, passwords, raw bodies, and unreleased content.

## Phase 13 - Approved HoYo static comparison

Start only after Release C is published and marked complete.

1. Add one small adapter beside the existing GameData scraper with no new dependency/workflow.
2. Run it in the existing scheduled GameData workflow. Shadow output is artifact/summary only; publish no HoYo-derived data.
3. Accept one reviewed healthy hosted baseline for the shadow-only stage. Continue observing normal scheduled runs opportunistically, but do not block account stages while waiting for new content.
4. Promote no fields in this stage. If a field is proposed for promotion or an existing source is proposed for retirement later, require complete coverage plus three genuine upstream changes including a version boundary at that later gate.

### STOP 13

- Items 1-4 and the static-source comparison checks pass; sanitized hosted evidence proves no publication and non-blocking last-known-good failure behavior. No field is promoted, so the shadow stage does not wait for unreleased content and does not block Phase 14. Any later field promotion or source retirement still requires complete coverage and three genuine upstream changes including a version boundary.

## Phase 14 - Local HSR multi-role bundles

1. Reuse one isolated HoYo WebView profile, exact allowlists, per-capability consent, one operation gate, cancellation generation, and stale-result rejection. HSR Connect must open the exact official Account Log In form directly; do not depend on a scripted avatar click or other page-DOM automation.
2. Disable downloads, popups, permissions, autofill, and password saving. Credentials/CAPTCHA stay user-controlled; cookies stay in the profile.
3. Store up to eight roles per game in one Windows-protected v2 file; never put UID in a filename.
4. Keep separate observations for resources, inventory, builds, achievements, exploration, endgame, events, and currency. Missing means not refreshed; deletion requires a timestamped tombstone.
5. Migrate through temporary write, flush, reread, decrypt, validate, then atomic replace. V1 stays authoritative on failure and through the first v2 release. Remove it only in a later stable release after another successful validation; never overwrite newer v2 with v1.
6. For HSR, cover roles, stamina/reserve/check-in, inventory, characters, traces, Light Cones, relics, completed achievements, treasure/exploration, endgame modes, events, and currency reports where the approved source is complete.

### STOP 14

- Items 1-6 and the account-boundary, per-capability, multi-role, migration, privacy, and dedicated test-role checks pass; incomplete capabilities remain disabled, and v1 remains authoritative through the first v2 release.

## Phase 15 - Encrypted HSR sync and My HoYo

1. Freeze one cross-runtime contract/vector set, then extend the existing route additively. Missing `kind` remains pulls; HoYo uses one strongly consistent object per pseudonymous sync ID so compare-and-swap is real rather than a racing KV read/write. Deploy the receiver before enabling launcher sync. Add manual sync only.
2. Offer a generated recovery code. If Pengo phrase words are reused, derive HoYo keys with separate domain labels. Store only protected derived keys after opt-in; never store/upload the raw recovery code.
3. Before upload pull/decrypt and merge by `(game, server, UID, capability)`: newest observation wins; equal-time conflicts stop; tombstone wins only if strictly newer than the observation. Emit deletion timestamps strictly after the removed observation, retry one compare-and-swap failure after a fresh pull, then stop; never force-overwrite automatically.
4. Retain encrypted cloud data until deletion and warn that losing every remembered device and recovery code makes it unrecoverable.
5. `Remove from this PC` deletes the selected account's local session/snapshots only, including its imported legacy copy; migration backups are not a deletion exemption. `Remove everywhere` also removes HoYo cloud roles and never touches pulls or another publisher/account.
6. Failed/offline deletion removes the live session but keeps a minimal protected pending credential and visible state outside the deleted profile/slot tree. Persist whether the request must finish local account removal; rotation cleanup must never imply local removal. Retry next online start and through `Retry deletion`, even without a signed-in account or new account consent; remove the credential only after server confirmation.
7. Add delete-one-role, one-game, all-HoYo, HoYo-only Worker `delete-account`, and separately confirmed entire-Pengo deletion. Recovery-code rotation conditionally retires the old cloud copy only if its revision still matches the copy transferred: check and delete atomically, persist the exact condition for retries, and keep a changed copy visibly pending without rebasing or forcing deletion. An omitted condition means ordinary explicit deletion; an explicit null expects an absent bundle, and already-absent account retries succeed.
8. Add website My HoYo, role/capability status, sync health, deletion, and cards only for complete enabled capabilities. Initially render HSR resources and completed achievements only. Inventory-aware materials, owned builds, and other record cards stay absent until their later capability gate proves complete data.
9. Keep full materials/gear UI on the website; launcher gets quick status, role management, sync, and Open My HoYo. Stale/unsupported data links to the official tool and never shows fake zero progress.
10. For a newly created or v1-migrated HSR bundle, default only the two complete local Remember capabilities - resources and completed achievements - on. Preserve every existing v2 choice, let the user turn either one off, and keep every unsupported capability off. This local default never opts the user into manual or automatic cloud sync.

Deployment recovery note (verified 2026-08-31): Cloudflare blocks old-version rollback across a Durable Object class lifecycle change. Record the last live version before the first `hoyo-sync-v1` migration, but use the storage-preserving forward recovery above if it is needed. See [Cloudflare rollback limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/#bindings). This changes recovery procedure only, not the reviewed receiver or production gates.

### STOP 15

- Items 1-10 and the applicable resource/achievement cards, merge/conflict, cross-runtime encryption, Worker-metadata, pull-compatibility, rotation/deletion-retry, privacy, and dedicated test-role checks pass end to end for manual HSR sync and My HoYo. Native HSR Connect opens the official Account Log In form directly, credentials/CAPTCHA remain user-controlled, and the publisher window uses only the normal Windows caption controls. The two complete local Remember capabilities default on only for new/migrated bundles and remain individually switchable, existing v2 choices are preserved, unsupported inventory/build/calculator/record surfaces remain unrendered, and automatic sync remains off.

## Phase 16 - Genshin account capabilities

Add roles, resin/check-in, inventory, characters, talents, weapons, artifacts, exploration, Spiral Abyss, Imaginarium Theater, events, and currency reports where complete. Do not add a HoYo account-achievement capability; preserve the existing separate Genshin achievement export unchanged.

Reuse the Phase 15 local Remember rule: complete supported capabilities default on for a newly created/migrated bundle and remain individually switchable; existing v2 choices are preserved and incomplete capabilities stay off. Manual and automatic cloud sync remain separate choices.

### STOP 16

- Every listed Genshin capability whose approved source is complete passes account-boundary, calculator, per-capability, multi-role, manual-sync, privacy, and dedicated test-role checks; incomplete capabilities and HoYo account-achievement completion remain disabled, while the existing separate Genshin achievement export remains unchanged.

## Phase 17 - ZZZ account capabilities

Add roles, battery/check-in, inventory, Agents, skills, W-Engines, Drive Discs, Hollow Zero, Shiyu Defense, Deadly Assault, events, and currency reports where complete. Do not add a HoYo account-achievement capability; preserve the separate ZZZ achievement lane's current disabled state.

Reuse the Phase 15 local Remember rule: complete supported capabilities default on for a newly created/migrated bundle and remain individually switchable; existing v2 choices are preserved and incomplete capabilities stay off. Manual and automatic cloud sync remain separate choices.

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
- external-source pin/license/permission and packaged-notice checks; no-install Packet Monitor ownership/non-interference/no-file tests; any Npcap fallback's public-release gates; one-session combined capture; HSR Fribbels-v4 and Genshin GOOD-v3 completeness/schema/current-patch/account/limit/cancellation/cleanup/import cases; and existing pull/achievement byte and behavior regressions;
- Endfield parsing, pagination, limits, cancellation, atomic file, bridge security, duplicate/account/rule, achievement proof, and Playtime boundary cases;
- HoYo source coverage, calculators, allowlists, role limits, migrations, JS/.NET encryption vectors, tampering, game swaps, merges, tombstones, conflicts, rotation, deletion retry, metadata privacy, pull compatibility, and multi-device behavior;
- receiver-first deployment, immutable launcher packages, live production version/package/R2 checks, and rollback proof.

Completion requires every unconditional phase and release marked `complete`, every remaining item explicitly `blocked` or `not-applicable` with evidence, and a final plan/tracker consistency review. Endfield achievements, the no-install capture path, HSR relics, and Genshin artifacts may finish only as proven/released or explicitly evidence-blocked; one blocked optional source/capture lane never authorizes incomplete output or a regression in an existing export.
