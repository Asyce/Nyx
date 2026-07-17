# HSR and ZZZ desktop adapter evidence

Date: 2026-07-14

Status: fake read-only evidence passed; real discovery and launch remain disabled pending separate user-approved pilots

## What this batch adds

Nyx can now judge fake Honkai: Star Rail and Zenless Zone Zero installations without
starting either game. It can also judge a fake HoYoPlay Global installation and make
an immutable request for the correct official launcher page.

This is an identity boundary, not a launcher implementation. No process-start,
update, download, elevation, network, registry-write, or game-write capability was
added.

## Current-record discovery boundary

Discovery is limited to the two current per-user HoYoPlay Global records:

- HSR: `Software\Cognosphere\HYP\1_0\hkrpg_global`
- ZZZ: `Software\Cognosphere\HYP\1_0\nap_global`

Only `GameInstallPath` and `GameBiz` are read. The reader does not enumerate keys or
values and does not inspect legacy standalone-launcher records. Missing, duplicate,
wrong-family, malformed, and stale current records fail closed. There is no legacy
fallback. After filesystem inspection, both exact values are read again. Any change,
removal, duplication, or read failure becomes `TargetChangedDuringInspection`.

Private device, account, token, login, cache, log, telemetry, and raw record values
are outside the adapter contract and are never returned, stored, or logged.

## Shared path boundary

Every proposed root must be an already-existing canonical absolute path on a local
fixed drive. UNC, device, drive-relative, traversing, removable, network, and
non-canonical paths are rejected. The root and every identity-bearing child are
checked for links, junctions, and other reparse points.

The root and watched targets are checked again before `Ready`. Changed configuration
text, version text, executable metadata, executable file facts, path identity, or
required structure produces `TargetChangedDuringInspection`.

## HSR identity

HSR becomes `Ready` only when all of these agree:

1. The exact top-level `StarRail.exe` has a valid Windows signature from
   `COGNOSPHERE PTE. LTD.` and product name `Star Rail`.
2. The exact `StarRail_Data` directory and exact `pkg_version` file exist.
3. No alternate package-manifest lookalike conflicts with `pkg_version`.
4. A bounded top-level `config.ini` scan retains only `channel`, `sub_channel`,
   `cps`, and `game_version`.
5. The retained values are exactly `channel=1`, `sub_channel=1`,
   `cps=hoyoverse_PC`, plus a strict dotted numeric game version.

The parser reads within fixed byte, line, and line-length ceilings. It classifies a
key before handling its value. Unknown value bytes are discarded without decoding.
Only the four allowlisted values and a one-way SHA-256 drift fingerprint survive the
streaming pass; the full payload and unknown values are never decoded, retained,
exposed, persisted, or logged. A second streaming pass must have the same fingerprint
before `Ready`.

## ZZZ identity

ZZZ uses the same fail-closed path, signature, publisher, structure, bounded-config,
and drift checks with these exact facts:

- `ZenlessZoneZero.exe`
- `ZenlessZoneZero_Data`
- `channel=1`
- `sub_channel=0`
- `cps=mihoyo`

The executable product name may be blank because that is a known PE metadata shape.
If it is nonblank, it must be exactly `Zenless Zone Zero`.

The top-level `version_info` file is read with a 128-byte ceiling. It must contain
only `OSPRODWin` followed by a strict dotted numeric version, with no byte-order
mark, newline, JSON, or extra content. Its version must equal `config.ini`'s
`game_version`.

## HoYoPlay and handoff boundary

The shared HoYoPlay Global validator independently requires:

1. A canonical fixed-drive root with no reparse component.
2. A signed root `launcher.exe` whose publisher is official and whose product name
   and description are exactly `HoYoPlay`.
3. A strict dotted numeric product version.
4. An exact same-version subfolder containing another signed, exact-identity
   `launcher.exe` with the same product version.
5. A stable second read of both launcher targets and the root path.

The public validator has only a parameterless Windows production constructor. It is
bound to the concrete offline Windows Authenticode reader and fixed-drive reader;
fake-reader injection and registry candidate contracts are internal and test-only.
External callers cannot forge the immutable installation proof consumed by the
handoff factory. The factory has two mappings:

- HSR -> one argument: `--game=hkrpg_global`
- ZZZ -> one argument: `--game=nap_global`

The arguments collection is read-only. Extra arguments, arbitrary game IDs, URLs,
scripts, shells, and paths cannot be represented. The request explicitly says that
the official launcher needs user interaction and that Nyx does not directly update
the game.

The immutable proof is only a short-lived inspection result, not durable launch
authorization. Any future executor must rerun the production HoYoPlay validator
immediately before process admission, require the same canonical launcher path and
version, and fail closed if anything changed. The handoff object alone must never
authorize execution.

## Verification

- Focused fake Hoyo tests: `79/79` passed.
- Full Desktop tests: `289/289` passed.
- Core, Infrastructure, and App win-x64 Release builds: zero warnings and zero
  errors.
- Scoped formatter verification passed. The solution loader emitted its existing
  non-failing workspace warning and reported no formatting change.
- Capability, private-value/enumeration, config non-retention, personal-path, queue
  JSON, and `git diff --check` gates passed.
- Production Hoyo source contains no process, shell, network, HTTP, elevation,
  registry-write, or file-write implementation.
- All filesystem mutations are confined to disposable fake test folders.
- No real game, official launcher, personal installation path, UAC prompt, network,
  or registry write was touched.

## Deliberately unresolved

Direct HSR and ZZZ launch stays disabled. A later user-approved real pilot must prove
the exact elevated/bootstrap/runtime process family, handoff timeout, crash behavior,
normal-close detection, sleep/resume behavior, and safe explicit relaunch.

Real current-record discovery and real HoYoPlay page handoff also need an independent
review before App wiring. Updating remains an official-launcher action that must be
clearly shown to the user; hidden or headless updating is not claimed.
