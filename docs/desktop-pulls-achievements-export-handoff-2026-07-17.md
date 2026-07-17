# Desktop pulls + achievements export handoff

Date: 2026-07-17

Status: user direction for the active launcher session

## Task

- **From:** Nyx achievement tracker work
- **To:** Nyx Desktop launcher session
- **Goal:** Make the launcher the primary Genshin Impact and Honkai: Star Rail exporter for pulls and achievements.

## User decisions

1. Add two independent per-game launch toggles:
   - **Export pulls when launching**
   - **Export achievements when launching**
2. Remember the toggles separately for Genshin and HSR. Default them off on a new installation so launching never starts extraction unexpectedly.
3. The enabled toggle is the user's instruction. Do not show the extractor's current typed `I UNDERSTAND` warning or another blocking warning dialog.
4. Export JSON files by default to the Windows Downloads known folder under:

   `%USERPROFILE%\Downloads\Pengo Exports\<Game>\`

5. Use timestamped, no-overwrite names so a new export never destroys an older one, for example:
   - `pengo-genshin-achievements-20260717-143012.json`
   - `pengo-genshin-pulls-20260717-143012.uigf.json`
   - `pengo-hsr-achievements-20260717-143012.json`
   - `pengo-hsr-pulls-20260717-143012.uigf.json`
6. HoYoLAB is a secondary HSR achievement option, not the primary launcher flow.

## Launch behavior

Treat pulls and achievements as two independent jobs. Either can succeed or fail without hiding the other result or blocking a valid game launch.

```text
User presses Launch
  -> if achievement toggle is on, prepare capture first
  -> launch the already-validated game target
  -> achievement job waits for the complete login/world-entry snapshot
  -> pull job waits until Wish History / Warp History has been opened
  -> write each completed export atomically
  -> show success/failure and an Open export folder action
```

Important timing:

- Achievement capture must be ready **before** the game starts. The complete list is normally seen while entering the world.
- Pull extraction can finish only after the player has opened Wish History or Warp History at least once for that session/cache.
- Do not delay launching just because an optional exporter could not initialize. Report that exporter as failed and continue the validated launch.
- A game closing, timeout, unsupported version, missing capture backend, or incomplete list must produce no partial JSON.

## Launcher-facing helper contract

Convert the current achievement CLI into a launcher mode instead of automating its console UI.

- No interactive stdin prompt in launcher mode.
- Emit newline-delimited status objects on stdout. Never emit packet contents, pull authentication URLs, cookies, or other secrets.
- Suggested events: `preparing`, `ready`, `waiting_for_game`, `waiting_for_history`, `exported`, `failed`, and `cancelled`.
- Include only safe fields such as game ID, export kind, item count, error code, and final file path.
- Cancellation must be cooperative when the launcher closes or the toggle/job is cancelled.
- Keep pulls and achievements independently cancellable.
- Resolve Downloads with the Windows known-folder API and append the fixed `Pengo Exports` subtree. Do not accept arbitrary output paths from the UI or command line.

The current Desktop boundary says the launcher does not own native pull/achievement extraction. Update `docs/desktop-boundary.md` before implementation so the new responsibility is explicit and narrowly scoped.

## Output formats Nyx already accepts

Achievements must remain the small existing formats:

```json
{"gi_achievements":[1001,1002]}
```

```json
{"hsr_achievements":[4010101,4010201]}
```

Pulls should be a standard UIGF 4.x JSON containing the appropriate `hk4e` (Genshin) or `hkrpg` (HSR) account section. Nyx already imports these formats.

## Existing code to reuse

Achievement capture/parser:

- `C:\Pengo\Nyx\Extractor\Achievements\src\capture.rs`
- `C:\Pengo\Nyx\Extractor\Achievements\src\decoder.rs`
- `C:\Pengo\Nyx\Extractor\Achievements\src\npcap.rs`
- `C:\Pengo\Nyx\Extractor\Achievements\src\output.rs`
- Current executable entry point: `C:\Pengo\Nyx\Extractor\Achievements\src\main.rs`

Pull URL discovery reference:

- `C:\Pengo\Nyx\Site\public\scripts\pengo-pulls.ps1`
- Current script copies a sensitive history URL to the clipboard. Launcher mode must not do that. Keep the URL in memory, use it to retrieve the full history, write UIGF, then discard it.

Website import contracts:

- `C:\Pengo\Nyx\Site\src\features\achievements\achievement-import.js`
- `C:\Pengo\Nyx\Site\src\features\gacha\pulls-engine.js`

HSR fallback:

- `C:\Pengo\Nyx\Site\public\scripts\pengo-hsr-hoyolab-achievements.js`

## Capture constraints to preserve

- No game injection, process-memory reads, input control, packet files, or raw packet logging.
- Keep packet data bounded and in memory only.
- Unknown game versions or missing dispatch keys fail closed without a partial export.
- Genshin currently uses the reviewed Npcap fallback on Windows versions without the independent realtime Packet Monitor API. That fallback refuses Administrator mode.
- HSR Packet Monitor capture is still experimental and may require an elevated helper. Elevate only the small helper when the selected backend actually requires it; do not elevate the launcher.
- Removing the warning prompt does not remove the existing public-release work: the native helper still needs the documented real-account validation, buffer cleanup, signing, and packaging review before it is bundled for users.

## UI expectations

Place the two toggles close to the selected game's Launch action, but keep Launch visually primary. Suggested supporting copy:

> Export selected game data after launch

While running, show separate short statuses, for example:

- `Achievements: waiting for world entry`
- `Achievements: exported 1,642`
- `Pulls: open Wish History in game`
- `Pulls: exported 376`

After success, provide **Open export folder**. Website/account auto-sync can be added later; local JSON output is the first required integration.

## Verification required

- All four toggle combinations per game: neither, pulls only, achievements only, both.
- Toggle state persists separately for GI and HSR.
- Export initialization happens before game dispatch only when achievements are enabled.
- Exporter failure never creates a second launch or blocks a valid launch.
- Different games can export concurrently without sharing state or files.
- Existing files are never overwritten.
- No pull auth URL or packet content reaches clipboard, logs, stdout, crash text, or telemetry.
- Wrong-game, incomplete, duplicate, unknown-version, timeout, cancellation, and game-close cases write no partial file.
- Output files import successfully into the current Nyx pull and achievement pages.

## Changed paths

- Added only this handoff document. No launcher source files were changed.

## Legacy impact

- Supersedes the `desktop-boundary.md` statement that Nyx Desktop never owns native pull/achievement extraction, once the implementation updates that boundary and passes review.
- HoYoLAB remains available as an HSR fallback.
- The website's manual file import remains supported.

## Next action

The launcher session should first update its boundary/contracts and add pure per-game export settings and orchestration states. Then adapt the existing Rust achievement core and replace the pull helper's clipboard flow with a launcher-safe UIGF export.
