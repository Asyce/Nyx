# Nyx Desktop — master execution specification

Status: approved for local implementation and testing. This document is the single source of truth for the desktop work. It supersedes earlier launcher plans where they conflict.

## Product boundary

Nyx directly discovers, validates, starts, observes, and re-starts games when the user clicks Launch. Different games may run at the same time. Nyx never starts a closed game by itself.

The official publisher launcher owns installation, downloading, updates, pre-downloads, verification, repair, removal, and publisher login. Nyx shows the available evidence and an **Open Official** action. It does not hide, automate, or imitate publisher-maintenance UI.

Required copy: **Nyx launches the game. Updates, repairs and installs happen in the official launcher.**

Nyx remains non-administrator. An exact game executable may show Windows approval when its publisher requires it. A custom game may explicitly opt into Windows approval. Export helpers are split by the least privilege they need; the main launcher never elevates.

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
10. Complete all automated, visual, live-install, privilege, security, import, offline, cache, and packaging gates; obtain independent test and code review; fix every actionable finding.

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
- Desktop, Rust, scraper, site, accessibility, reduced-motion, responsive, packaging, migration, updater, and rollback tests pass.
- Independent test-runner and reviewer report no unresolved blocker.
- Nothing is deployed to production.
