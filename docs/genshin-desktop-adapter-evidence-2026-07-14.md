# Genshin desktop adapter evidence

Date: 2026-07-14

Status: read-only pilot passed; launch remains disabled pending its separate gate

## Pilot result

The user-approved Global Genshin folder and HoYoPlay folder were inspected without starting a program, changing a file, accessing the network, or reading private account areas.

The observed installation contains:

- Genshin `6.7.0`, identified by its small public configuration file;
- a validly signed top-level `GenshinImpact.exe` from `COGNOSPHERE PTE. LTD.`;
- the expected data folder and package metadata names;
- HoYoPlay `1.16.1.364`, identified independently by its validly signed root launcher and matching version-folder launcher;
- Windows installation records that connect the Genshin parent folder and HoYoPlay through the public game identity `hk4e_global`.

The personal installation paths are deliberately not copied into this document or product code.

## Game identity gate

The game is `Ready` only when all required checks agree:

1. The chosen folder is an absolute local-drive path with no link, junction, or other reparse component.
2. A regular top-level file named `GenshinImpact.exe` exists.
3. Windows reports a valid Authenticode signature from an adapter-owned allowlist of official publisher identities.
4. A bounded in-memory scan of `config.ini` retains only the allowlisted facts needed by Nyx: `channel`, `sub_channel`, `cps`, and `game_version`. Other lines are discarded immediately and are never returned, stored, or logged.
5. The values identify the supported Global channel: `channel=1`, `sub_channel=0`, `cps=mihoyo`, and a dotted numeric game version.
6. The expected `GenshinImpact_Data` folder and at least one known package-manifest name exist as supporting structure.

The executable's observed `2017.4.30.0` file version is a Unity engine version. It is not a Genshin version and must never be displayed as one.

Folder names, executable names, sizes, timestamps, hashes, certificate thumbprints, and URL handlers are not sufficient proof by themselves. Sizes, hashes, certificates, and game versions can legitimately change.

## HoYoPlay identity gate

The updater is checked separately from the game. Its absence or failure must not turn a valid game into `NotFound`.

HoYoPlay is `Ready` only when:

1. Its folder passes the same local-path and reparse checks.
2. The regular root `launcher.exe` has a valid official-publisher signature.
3. Its product metadata identifies `HoYoPlay` and exposes a parseable version.
4. The matching version subfolder contains a signed launcher with the same product version.

Signed updater helpers are useful corroboration but are not required to start the game. Old version folders may remain after an update, so Nyx must follow the signed root launcher's version rather than selecting the newest-looking directory name.

## Windows records

Public machine-wide uninstall records provide a supporting chain:

`Genshin parent folder` -> `hk4e_global` -> `HoYoPlay folder`

They can become stale. Nyx may use them to propose a location, but the on-disk identity gate must still pass before `Ready`.

URL protocol handlers are weak hints only. The pilot machine contains a stale handler pointing to a missing older drive, so protocol commands must never be trusted as launch targets.

The adapter must not read UUID-like values or unrelated registry values.

## Privacy exclusions

The pilot and adapter do not read:

- screenshots or other personal media;
- logs, crash dumps, telemetry, caches, blob storage, or web caches;
- account, login, cookie, token, or credential data;
- game data file contents, package contents, plug-in contents, or pull-history data;
- unrelated registry records, environment variables, process command lines, or other drives;
- non-allowlisted configuration values outside the bounded in-memory scan; unknown lines are discarded and never returned, stored, or logged.

The adapter performs no network requests, elevation, repair, update, file write, fallback shell command, or background launch.

## Fail-closed outcomes

- Missing chosen folder or primary executable: `NotFound` when no credible installation remains.
- Conflicting, incomplete, linked, stale, unsigned, or unexpected evidence: `NeedsReview`; Launch stays disabled.
- One fully matching game: `Ready`.
- Valid game with missing or invalid HoYoPlay: game remains `Ready`; Open updater stays disabled with a plain explanation.
- More than one valid candidate: `NeedsReview`; neither starts automatically.

Actual launch testing begins only after the read-only adapter, fake launch simulation, independent safety review, and exact-target display all pass.

## Verification result

- Adapter fake-folder tests: `35/35` passed.
- Full Nyx Desktop tests: `83/83` passed.
- Windows 11 x64 Release build: zero warnings and zero errors.
- Independent review found and closed an incorrect WinTrust offline flag, mapped-network-drive acceptance, an unbounded configuration-read race, saved-path status ambiguity, and silently skipped link tests.
- Real user-approved game inspection: `Ready`, version `6.7.0`.
- Real user-approved HoYoPlay inspection: `Ready`, version `1.16.1.364`.
- Watched identity-file size, last-write time, and attributes were identical before and after the real inspection.
- No game, launcher, updater, network request, registry write, elevation, or game-folder write occurred.

The remaining product-identity limitation is explicit: the observed Genshin executable exposes no useful Windows product-name fields. The combination used here is suitable for this user-approved manual-folder pilot, but broad automatic discovery needs another independently reviewed identity signal.
