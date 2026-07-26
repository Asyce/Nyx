# Nyx Desktop — master execution specification

Status: implemented and locally verified on 2026-07-26. This document is the single source of truth for the desktop work. It supersedes earlier launcher plans where they conflict.

Finalised 2026-07-21. This revision folds in the two later account handoffs
(`docs/desktop-energy-status-integration-handoff-2026-07-20.md`,
`docs/desktop-daily-checkin-handoff-2026-07-20.md`) and the redemption-code
premium-currency request, and records the authoritative completion status and
remaining work in the final two sections. Where those sections conflict with older
progress notes, this document wins.

## Later approved changes

The user's later visual and account decisions supersede these older parts of this
specification:

- The official-news panel is removed. The left panel is a vertical current/next
  banner cycle with character icons; premium codes live in the bottom deck.
- Google Drive portraits and game logos are removed. Banner character presentation
  uses locally packaged splash art only.
- No manual resource timers are provided.
- Explicit, local-only publisher account connections may show supported resources
  (see **Publisher account resource cards**) and run a user-pressed one-button daily
  check-in (see **One-button daily check-in**). Both are opt-in, default off, and
  local-only. The private personal build is the approved product decision. The
  security boundary and support status live in `docs/desktop-boundary.md` and
  `docs/v1-support-matrix.md`, which must record the narrow account/check-in
  exception before either feature is enabled.
- The redemption-code deck shows the amount of premium currency each code grants
  and that currency's icon, including Endfield's Oroberyl (see **Redemption codes
  deck: premium-currency amounts and icons**).
- The user explicitly approved committing, pushing, and production-deploying the
  launcher code/banner/art feeds and the related Pengo site icon fixes (including
  the pengo.gg Endfield Oroberyl premium icon). That narrow approval supersedes
  older blanket "no production deployment" wording below, but each deploy still
  waits for an explicit go-ahead and passes the pre-deploy gate in
  `Nyx/docs/agent-index.md`.

## Product boundary

Nyx directly discovers, validates, starts, observes, and re-starts games when the user clicks Launch. Different games may run at the same time. Nyx never starts a closed game by itself.

The official publisher launcher owns installation, downloading, updates, pre-downloads, verification, repair, removal, and publisher login. Nyx shows the available evidence and an **Open Official** action. It does not hide, automate, or imitate publisher-maintenance UI.

Required copy: **Nyx launches the game. Updates, repairs and installs happen in the official launcher.**

Nyx remains non-administrator. An exact game executable may show Windows approval when its publisher requires it. A custom game may explicitly opt into Windows approval. Export helpers are split by the least privilege they need; the main launcher never elevates.

One narrow, opt-in exception extends this boundary: with the user's explicit per-publisher consent, Nyx may open a Nyx-owned, isolated official login page to show that publisher's own resource values and to press that publisher's own daily check-in control. This exception never authorizes generic browser automation, background bots, scheduled runs, reading another browser's profile, credential collection, or game automation. Every account feature stays default off and local-only, and public distribution waits for a recorded policy/security review.

## Visual direction

The launcher is a premium, frameless Nyx surface inspired by modern live-service launchers without copying their branding.

Design tokens:

- void `#08060F`, deep plum `#120D1D`, moon `#F5F2FF`, mist `#AAA4B8`, iris `#B8A6FF`, lavender `#DED6FF`;
- no cyan, blue-teal, or gold accent text;
- display type: light, narrow, large; body type: quiet and highly readable;
- one signature element: the bottom glass command deck joins live banner time, local/official state, export arming, and the moon-lavender Launch control.

The default background for every game is the Nyx site artwork. A large transparent current-banner character occupies the right side. The title and current official news occupy the left. The game rail is narrow and quiet. Game icons are large, bare images without card containers; selection uses a restrained iris marker.

The shell must:

- extend content into the title area and visually remove the old title bar;
- retain Windows resize, snap, DPI, minimize, maximize/restore, and close behavior;
- place a Settings action immediately before the native caption controls;
- keep interactive title-area controls out of the drag region;
- animate game/background/art changes with short crossfades, disabled under reduced motion;
- provide keyboard focus, screen-reader names, high contrast, and useful layouts at 390×844, 760×540, 1280×720, 1600×900, and 2560×1080.

Remove `GAME 01 / 05`, the rail game count, the fan-made disclaimer, development text, and “Nyx is ready to start the game.” Ready copy is **Official files verified.**

## Brand and rail actions

- Pengo · Nyx and the Nyx logo open `https://pengo.gg`.
- The bottom-left Ko-fi control uses the live Pengo-site appearance and opens `https://ko-fi.com/asyce`.
- Both are fixed, allowlisted HTTPS destinations.
- The rail contains all official and custom games in stored order.
- **Add Game** appears directly after the last game. Ko-fi remains pinned at the rail bottom.
- The rail scrolls when necessary and never displays a game count.
- Settings can reorder every entry. **Reset order** restores GI, HSR, ZZZ, WuWa, Endfield, then custom games in their creation order.

## Custom games

Custom games are separate from the protected official catalog and official validators. A custom entry requires:

- stable generated ID;
- display name;
- exact local `.exe` path;
- locally copied icon.

It may also store a locally copied background, exact runtime executable for launchers that hand off to a child process, raw argument text, and an explicit “request administrator approval” switch.

Paths must be absolute local-drive paths. Reject directories, missing executables, UNC/device paths, reparse-point escapes, duplicate canonical paths, and shell command syntax. Start the executable directly without a shell. Arguments are passed as an argument list, never interpreted by PowerShell or `cmd`.

Custom sessions support direct launch, optional approval, exact-path observation, launcher-to-runtime handoff when configured, duplicate suppression, two-sample close confirmation, manual re-launch, concurrent operation with other games, edit, delete, reorder, and repair of a moved executable. Unsupported official/news/banner/export panels disappear and the layout reflows.

## Settings and durable state

Settings opens for the selected game and supports:

- icon;
- background;
- automatic banner art on/off;
- art scale from 50% to 250%;
- art X/Y position;
- **Try another** variant;
- **Keep art** pin;
- reset selected-game appearance;
- custom-game fields when the selection is custom.

Global settings support:

- drag/reorder game list and reset official order;
- refresh content and art;
- show cache size, clear downloaded cache, and open Nyx data folder;
- copy redacted diagnostics;
- safe notifications;
- stay visible or minimize after launch, with **stay visible** the local-test default;
- reset launcher state;
- rediscover official installs.

Changes preview live. **Save** commits them; **Cancel** restores the pre-dialog snapshot.

Durable state is a per-Windows-user, versioned JSON document written through same-volume temporary files, flush, atomic replace, and a last-known-good backup. Migration is pure and tested. It preserves custom entries, creation order, rail order, appearance, selected game, export arming, and export paths. Malformed or future-version data fails closed and offers backup recovery. Automated cache cleanup never deletes user-selected art.

## Official news

Nyx displays the same current public items/categories exposed by each official launcher where a stable official feed exists. It loads in this order:

1. validated fresh network snapshot;
2. validated last-known-good snapshot;
3. bundled snapshot.

One game’s failure cannot blank or block another. Refresh occurs at startup, periodically, after network reactivation, and manually.

News remains visible when a link is unsafe, but the item is not clickable. Clickable links must be HTTPS, default-port, without user information, and on a game-specific publisher allowlist. The game association is validated before opening.

## Banner and character-art manifest

The runtime contract is `launcher-banners-v1.json`, built and tested locally/through preview before any production publishing. It contains:

- schema version, revision, generated time, and health;
- game and region semantics;
- unambiguous current phase and banner start/end instants;
- remaining-time inputs;
- character identity, rarity, debut ordering, selection reason, and variants;
- asset URL/path, MIME type, byte size, dimensions, SHA-256, transparent bounds, and suggested placement.

Current means `start <= now < end`. Expired, overlapping, or uncertain phases are not current. The launcher uses the same banner region/countdown semantics as Pengo Nyx, without a second region setting.

Character selection is deterministic: current phase only, then highest rarity, newer limited debut, then stable identity tie-break. A variant is randomly selected only when the game is reselected or the banner revision changes, and stays stable while selected. **Try another** advances variants; **Keep art** pins the choice until the user releases it.

Source rules:

- Genshin: mirror the approved public Google Drive portraits; include every usable variant; fall back to official/default gacha splash art when absent. Initial sync is anonymous/public and may use the installed Drive mirror, but runtime never needs the user’s Drive credentials.
- HSR: use draw-card art by character ID. If a released outfit has a structured Fandom portrait, use outfit portrait variants; fall back to draw-card art.
- ZZZ: use all `IconRole` variants, including suffixed variants.
- WuWa: use `T_ActivityRole` assets and source-name mappings.
- Endfield: use splash art.

Upstream Nanoka data may inform build-time discovery, but its name, host names, URLs, and IDs must not appear in the shipped launcher or manifest.

Image processing trims transparent margins, strips metadata, emits transparent WebP, caps the long side near 2048px, calculates placement, and records hashes/dimensions. Runtime validates host/path/MIME/size/dimensions/hash, downloads atomically, retains last-known-good assets, rolls back bad revisions, and prunes expired generated art. The generated cache is capped at 150 MB. User-selected files are outside that cache and are never pruned.

Refresh occurs at startup, every six hours, after network reactivation, at banner expiry, and manually.

## Export arming and jobs

The old Pengo website buttons are replaced by persistent, per-game arming switches:

- **EXPORT PULLS**
- **EXPORT ACHIEVEMENTS**

Both default off. They arm the next user Launch click, including when the game is already running. Genshin and HSR expose both in the first release. ZZZ and WuWa have dormant, bundled-provider slots with the same status/cancel/output/error contract, but their controls stay hidden until verified providers are added behind feature flags. Endfield remains future work.

For one Launch admission:

1. snapshot the two arming switches;
2. prepare the achievement capture path with a strict bound;
3. launch through the existing validated game coordinator even if preparation failed;
4. cancel jobs if launch was not admitted;
5. wait for world entry separately for each armed job;
6. for pulls, ask the user to open the in-game pull history, then collect through a fixed provider;
7. finish only complete, validated exports and offer **Open folder**.

Pull and achievement jobs have independent state and cancellation. Closing Nyx cancels unfinished jobs and removes temporary files; it never closes a game. A failed export never blocks launch or its sibling export.

Output uses the Windows Downloads known folder:

`Downloads\Pengo Exports\<Game>\<UTC timestamp>-<nonce>.<ext>`

Files never overwrite. A helper writes an exclusive temporary file, validates it, flushes it, atomically renames it, and removes temporary files on failure/cancel/crash. Pulls use valid UIGF 4.x for GI/HSR. Achievements use exactly the existing import shape: `gi_achievements` or `hsr_achievements`, containing completed IDs only.

## Export helper security contract

The Rust helper gains a launcher mode. Launcher mode has no console, interactive confirmation, clipboard, telemetry, arbitrary command, arbitrary provider, arbitrary output location, or free-form URL argument.

The launcher invokes a fixed bundled/verified helper using an allowlisted argument set. The helper emits newline-delimited JSON status only:

`{schemaVersion, jobId, game, kind, state, itemCount?, errorCode?, outputFile?}`

Allowed states are `preparing`, `ready`, `waiting_for_game`, `waiting_for_history`, `exported`, `failed`, and `cancelled`. Errors are allowlisted codes. Raw packets, authentication URLs, cookies, tokens, headers, account data, paths containing account identifiers, provider stderr, and crash internals never enter logs, stdout/stderr, process arguments, clipboard, diagnostics, notifications, or Pengo servers. Pull authentication material remains in memory, is sent only to the official endpoint, and is discarded.

The helper enforces bounded memory and record counts and never writes packet captures. Cancellation is launcher-controlled, bounded, and cleans up capture before success/cancel acknowledgement.

Privilege split:

- launcher: normal user;
- GI Npcap path: normal user only;
- HSR Packet Monitor path: a separate, narrow capture helper may request approval if required;
- no generic elevated process launcher is exposed to export providers.

The bundled private decoder material is never logged or surfaced. Public distribution requires a separate legal/security/publisher-rule review even though license text is not being treated as authoritative for this local build.

## Publisher account resource cards

Full detail: `docs/desktop-energy-status-integration-handoff-2026-07-20.md`. This section records the approved decision and the completion-relevant contract.

Product decision: the private personal build is approved. Narrowly sealed, local-only account-status providers are permitted behind per-publisher opt-in flags that default off. `docs/desktop-boundary.md` and `docs/v1-support-matrix.md` are updated to record this exception before the feature is enabled.

One shared resource strip sits immediately above the selected game's Launch button and renders only the selected game:

- `gi` Original Resin, `hsr` Trailblaze Power and reserve, `zzz` Battery Charge, `wuwa` Waveplates and reserve — experimental local providers, each labelled **Unofficial local connection · may stop working**;
- `ae` Endfield Sanity — Phase 1 is an **Open Protocol Terminal** official-page handoff only; no private numeric card, no scraping.

Provider rules: `CONNECT`/`START` is an explicit opt-in; `REFRESH` is manual and never overlaps an in-flight request; `DISCONNECT` cancels work and clears Nyx-owned secrets and cached account data first. GI/HSR/ZZZ share one isolated HoYoLAB WebView2 session but keep one independent result each; Kuro (WuWa) and Gryphline stay separate and cannot block HoYo or each other. When a game has more than one UID/server, the user makes an explicit choice shown as a transient masked UID/region — no first-entry or highest-level fallback. Account, UID, server, or role-list changes clear the old snapshot and require selection again. Countdowns run locally between accepted snapshots. Account state never alters Ready/Running, publisher maintenance, or the Launch action. No cookie, token, UID, or response body enters logs, launcher state JSON, process arguments, clipboard, or crash reports; Nyx-owned secrets use DPAPI/Windows Credential Manager and are deleted on disconnect. Feature flags default off; a remote kill switch may only disable a provider, never add endpoints, signing values, or permissions.

The existing WuWa account-status vertical slice is preserved and audited before migration to the shared contract. Fix its known gaps first: the `WuWaLauncherCredentialReader` `distinct[0]` fallback when several unselected cache accounts exist, the observer-vs-shared-provider cancellation behavior, and the un-awaited shutdown disposal in `App.xaml.cs`.

## One-button daily check-in

Full detail: `docs/desktop-daily-checkin-handoff-2026-07-20.md`.

The launcher provides **Connect HoYoLAB**, **Connect SKPORT**, and **CHECK IN ALL**, producing one honest result per game: `Claimed`, `Already claimed`, `Login needed`, `Unavailable`, or `Could not check`. Supported: `gi`, `hsr`, `zzz` through the shared isolated HoYoLAB WebView2 profile; `ae` through a separate SKPORT profile; `wuwa` has no persistent official web check-in and is skipped until one is proven.

First version: explicit button press only — no scheduling and no start-with-Windows. Initial login, CAPTCHA, two-factor, and character selection happen in the visible official page; automated claiming performs top-level navigation only to the fixed, fully normalized canonical check-in URL per game. One operation lock prevents overlapping clicks; each run owns a generation token and its WebView until all work stops, and a run that cannot be proven stopped quarantines that profile for the session. Credential-free health checks validate each canonical page and reject the known false positives: the stale GI event id, the fake SKPORT shell, the WuWa homepage redirect, and a ZZZ probe missing the `x-rpc-signgame: zzz` header. Publisher-policy risk is recorded — HoYoLAB and Gryphline terms restrict unauthorized automation, so the feature is never described as officially supported, is not enabled by default, and is not publicly distributed without a recorded policy/security decision.

## Redemption codes deck: premium-currency amounts and icons

Each redemption code in the bottom deck shows the amount of premium currency it grants and that currency's icon. Premium currency per game: Genshin Primogems, Honkai: Star Rail Stellar Jade, Zenless Zone Zero Polychrome, Wuthering Waves Astrite, and Arknights: Endfield **Oroberyl** (`Database/EndfieldWiki/endfield/material-icons/Oroberyl.png`).

The launcher codes feed (`Site/tools/generate-launcher-codes.mjs` → `launcher-codes-v1`) carries the parsed premium amount and the icon reference per code; the desktop deck renders both. Codes with no premium reward, or an amount that cannot be parsed with confidence, render without a fabricated number.

The user also approved updating the live pengo.gg site so Endfield uses the Oroberyl premium icon. That change currently lives on branch `codex/oroberyl-launcher-codes`; it is committed, pushed, and production-deployed only on an explicit go-ahead and after the pre-deploy gate in `Nyx/docs/agent-index.md` passes.

## Diagnostics, recovery, and feature flags

Diagnostics may include launcher version, capability flags, game/export state names, sanitized error codes, manifest revision/health, cache totals, and discovery result categories. They exclude secrets, account identifiers, raw network material, and sensitive full paths.

Recovery actions include rediscover installs, repair a custom path, reset selected appearance, clear generated cache, restore last-known-good settings, retry content/export, and open the output/data folder.

Independent feature flags cover remote banner manifest, official news, automatic art, GI pulls, GI achievements, HSR pulls, HSR achievements, and each future provider. Disabling one lane must not break launch, sessions, or another lane.

## Packaging and update architecture

Local testing uses the unpackaged app and real installed games. No production route is deployed without explicit approval.

The repository must end with a reproducible unsigned or development-signed distribution package, installer/uninstaller behavior, Start menu entry, version/notes metadata, first-run defaults, safe data-retention choice during uninstall, migration coverage, and an update-channel contract with downloaded-file hashing, staged replacement, and rollback. A public signing certificate/account and actual production publishing are explicitly outside this execution.

## Implementation order

1. Preserve the baseline, merge the current Nyx branch, record this specification, and keep `Desktop/` on one branch.
2. Add versioned state/migrations and pure provider contracts.
3. Add custom-game launching/session observation and rail projection without weakening official adapters.
4. Rebuild the frameless shell, Settings, Add Game, Ko-fi, brand links, banner deck, responsive states, accessibility, and reduced motion.
5. Build the validated banner/art pipeline and desktop cache with bundled/last-known-good fallback.
6. Harden official-news links and failure isolation.
7. Convert the Rust achievement helper to launcher mode and add the export coordinator.
8. Implement safe GI/HSR pull collectors and UIGF serialization; add hidden ZZZ/WuWa provider slots.
9. Add diagnostics, recovery, notifications, flags, packaging/update scaffolding, and migration/uninstall behavior.
10. Add publisher account resource cards and one-button daily check-in per the two account handoffs, both opt-in and default off; update `docs/desktop-boundary.md` and `docs/v1-support-matrix.md` first, and audit/migrate the existing WuWa slice rather than rewriting it.
11. Add premium-currency amounts and icons to the redemption-code feed and deck, including the Endfield Oroberyl icon.
12. Complete all automated, visual, live-install, privilege, security, import, offline, cache, and packaging gates; obtain independent test and code review; fix every actionable finding.

## Completion gates

- The old title/header/count/disclaimer/cyan-gold/link-tool UI is absent.
- The shell matches the approved mockup hierarchy and looks intentional at every target size.
- All five official games still discover, launch, detect running/closed, manually relaunch, and run concurrently.
- Custom games persist, reorder, launch, detect close, edit, delete, and recover from moved paths.
- Settings Save/Cancel, migration, backup, and user-art preservation pass.
- News links pass game-specific allowlists and unsafe items cannot open.
- Current banners never select expired/overlapping/uncertain phases; art hashes and 150 MB cleanup pass; offline fallback works.
- Every GI/HSR arming combination passes. Export failure never blocks launch. Outputs import into Pengo. No secret appears in logs, process arguments, clipboard, files, diagnostics, notifications, or crashes.
- GI Npcap is unelevated; only the narrow HSR helper may request approval; the launcher remains unelevated.
- Account resource cards and daily check-in are opt-in and default off; every account action (HoYoLAB, SKPORT, WuWa) is gated behind its own default-off consent flag; multi-role accounts require an explicit masked selection; disconnect clears per publisher; account state never changes Launch or maintenance; no secret appears in logs, state JSON, arguments, clipboard, files, or crashes; and the `docs/desktop-boundary.md`/`docs/v1-support-matrix.md` exception is recorded.
- Each redemption code shows the correct premium-currency amount and icon, and Endfield uses the Oroberyl icon.
- Desktop, Rust, scraper, site, accessibility, reduced-motion, responsive, packaging, migration, updater, and rollback tests pass.
- Independent test-runner and reviewer report no unresolved blocker.
- No production deployment happens without an explicit user go-ahead; the only pre-approved production changes are the launcher code/banner/art feeds and the pengo.gg Endfield Oroberyl premium icon, each still gated on that go-ahead and the pre-deploy gate.

## Completion status (verified 2026-07-26)

The approved launcher scope is implemented in commit `0bac1a794` and has completed
its local release audit.

### Delivered

- The frameless launcher supports Genshin Impact, Honkai: Star Rail, Zenless Zone
  Zero, Wuthering Waves, and Arknights: Endfield, including discovery, manual client
  selection, direct launch, concurrent different-game launches, running/closed
  detection, and relaunch.
- The final shell matches the approved vertical banner-cycle layout. All five game
  views, settings tabs, and Add Game were visually inspected without launching a
  game. Current selections are Columbina, Himeko Nova, Norma Hollowell,
  Yangyang: Xuanling, and Arcane.
- Current and next banners, rotating character art, five newest premium codes,
  currency amounts/icons, Endfield Oroberyl, official/local state, Pull Tracker,
  Achievements, official-launcher access, custom games, game reordering, per-game
  appearance settings, and movable settings are integrated.
- GI/HSR export arming is implemented. ZZZ/WuWa keep deliberate insertion points
  for the later extraction scripts.
- Publisher resource cards, explicit role choice, disconnect/clear behavior, and
  one-button daily check-in are implemented behind independent opt-in flags that
  default off. No live publisher login was used during release verification.
- The banner/code/art pipeline publishes only verified committed bytes. The final
  launcher bundle contains 24 unique current art files (8,165,920 bytes), and the
  deployment smoke selected the five expected current characters.

### Verification evidence

- Desktop tests: 1,305/1,305 passed.
- Focused launcher-shell/UI tests: 73/73 passed.
- Packaging/updater/installer/migration tests: 65/65 passed in isolation.
- Rust achievement helper: 50 tests passed (38 unit, 3 process integration, 9
  security); `cargo check` and `cargo clippy` passed.
- Scraper tests: 160/160 passed.
- Launcher source/build/deploy contract tests: 40/40 passed.
- Full Release solution and x64 app builds completed with zero warnings and zero
  errors.
- Site production build and deploy smoke passed across all routes, 970 runtime data
  files, and the committed launcher feed.
- The `1.0.0.116` development package passed PE hardening and updater verification,
  contains 499 payload files and no PDB or removed legacy content, and reproduced
  the same outer ZIP byte-for-byte on two builds:
  `9a0e8d05cfd42d8753f60267d717c2eed8a81e2f10f63957d2155f1aad6205ba`
  (137,402,667 bytes).

### External release boundaries

- The development ZIP is intentionally unsigned. Public Windows distribution still
  needs a protected signing certificate, timestamping, and production update route.
- Account features remain default off until a real-user pilot is completed with
  ordinary test accounts.
- Endfield's upstream wiki currently lists Liino without sourced growth or
  progression material tables. Strict validation reports that missing source instead
  of inventing values; it does not block the launcher or package.

### Post-v1

Everything in `docs/desktop-post-v1-roadmap-2026-07-21.md` — code signing and release channel, performance and payload budgets, local notifications, taskbar quick-launch, local play history, the migration assistant, and MSIX/differential distribution. None of it is required for completion of this specification.

### Distribution constraint

- Source push and the explicitly requested pengo.gg launcher-feed/Oroberyl production
  update are authorized for this execution.
- Account resource cards and daily check-in stay opt-in, default off, and local-only,
  with no public distribution until a recorded policy and security review.
