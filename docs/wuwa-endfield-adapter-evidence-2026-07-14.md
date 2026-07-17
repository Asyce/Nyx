# WuWa and Endfield desktop adapter evidence

Date: 2026-07-14

Binding revision: 2026-07-15

Status: sanitized fake read-only evidence passed; direct game launch and live official-
launcher execution remain disabled pending separate user-approved pilots

## Boundary added

Nyx now has independent offline identity adapters for Wuthering Waves and Arknights:
Endfield. A proposed install root is only a locator hint. It becomes evidence only
after the adapter proves an existing canonical absolute path on a local fixed NTFS
volume, no reparse component, stable exact files, valid Authenticode signatures, and
the expected publisher and public PE identity.

Every executable observation now uses one held read handle that denies write and
delete sharing. It records the NTFS volume serial and file ID from that handle, and
every path reopen before and after the Authenticode and FileVersionInfo phases must
match both values. The canonical install root and every in-root ancestor directory
are also held without delete sharing, so an ancestor cannot be renamed or replaced
to redirect those path-based Windows APIs. The final executable entry is opened with
Windows no-follow semantics (`FILE_FLAG_OPEN_REPARSE_POINT`), rejected when its own
entry is a reparse point, and retained without delete sharing as the data/hash handle
through the proof. Every launcher/companion stability pass repeats the path-entry
reparse check. The adapter hashes the protected handle before and after metadata reads
and keeps every executable/directory binding alive until the entire install proof
finishes. Hard-linked executable evidence is rejected.
Together these checks prevent same-length/same-timestamp swap-and-restore, ancestor
rebinding, or path/handle mismatch from mixing metadata from one executable with
bytes from another. The older separate-open hash helper was removed.

The adapters do not read registry records, protocol handlers, uninstall entries, or
shortcuts. Those sources may later propose candidates but must never prove identity.
Multiple fully valid roots are ambiguous. A stale missing root is ignored only when
exactly one other root fully validates.

This batch starts no process and contains no process, shell, network, download,
update, elevation, registry-write, or live-file-write capability.

## Wuthering Waves evidence

The official-maintenance target requires:

- signed Kuro `launcher.exe` with product `Wuthering Waves`;
- a signed same-identity launcher under the strict four-part product-version folder;
- root and versioned launchers that are byte-identical and stable across validation;
- signed blank-public-PE `Wuthering Waves Game\Wuthering Waves.exe` and
  `Client\Binaries\Win64\Client-Win64-Shipping.exe` targets from the exact Kuro
  publisher;
- matching root and nested `launcherDownloadConfig.json` files no larger than 4 KiB,
  depth at most two, with exact unique case for `version`, `isPreDownload=false`, and
  string `appId=50004`;
- `LocalGameResources.json` no larger than 1 MiB, depth at most eight, and at most
  10,000 entries, with exactly one exact runtime destination and exactly one strict
  three-part version segment in its `fromFolder` value.

Raw JSON bytes exist only during bounded parsing. Results retain the three allowed
config values, one resource version, file facts, and one-way SHA-256 drift
fingerprints. Unknown JSON values are not returned, persisted, or logged.

The sanitized observed config version is `3.5.0`; the selected runtime resource path
contains `3.5.1`. Nyx reports `NeedsReview`, `VersionConflict`, and no current game-
version claim. The maintenance target remains available only after the launcher,
bootstrap, runtime, both configs, and resource evidence have all validated together;
the version conflict does not weaken executable/install identity. Direct game launch
remains false even when a matching fake version can be proven.

## Arknights: Endfield evidence

The official-maintenance target requires:

- signed GRYPHLINK root `Launcher.exe` with product `GRYPHLINK`;
- signed same-product `Launcher.exe` under its strict four-part product-version
  folder;
- signed exact `Games.exe` in that folder with product and description `GRYPHLINK`,
  original filename `Games.exe`, and company `Gryph Frontier Pte. Ltd.`;
- signed blank-public-PE `games\EndField Game\Endfield.exe` from the exact GRYPH
  publisher;
- signed exact `PlatformProcess.exe` with the observed PlatformProcess PE identity.

The engine-looking `Endfield.exe` file/product versions and the PlatformProcess
version are not accepted as game versions. No trustworthy readable game/channel
marker has been proven, so a valid identity reports `NeedsReview`,
`VersionUnavailable`, and no version claim.

ACE executables are not targets and are never inspected. No exact Endfield protocol
URL, game-page argument, or direct launch contract is claimed. Registry and shortcut
records observed during research included stale missing roots and remain locator
hints only.

## Sealed official-maintenance handoff

External callers cannot construct a validation token, inspection result, or handoff
request. Production adapters expose only their parameterless Windows-bound
constructors. A token means one full-install proof, not launcher-only proof: no token
is minted for missing game evidence, inspection failure, root/path/metadata drift, or
any target change. The candidate resolver therefore counts only complete installs;
launcher-only candidates cannot create ambiguity or outrank a complete install. The
factory accepts only a short-lived validated token and produces:

- the exact validated dedicated Kuro launcher plus fixed Wuthering Waves maintenance
  instructions; or
- the exact validated generic GRYPHLINK launcher plus fixed instructions telling the
  user to select Arknights: Endfield.

Both requests contain a read-only empty argument collection, require user
interaction, full-install production revalidation, and equivalent protected
executable binding at immediate admission, and explicitly deny direct update and
direct game launch. Arbitrary IDs, paths, arguments, protocol URLs, commands, and
game pages are not representable.

## Verification

- Focused PublisherGames tests: `98` passed, `0` skipped.
- Full Desktop tests: `471` passed, `0` skipped.
- Core Release build: zero warnings and errors.
- Infrastructure Release build: zero warnings and errors.
- App win-x64 Release build with trimming disabled for build-only verification: zero
  warnings and errors.
- Scoped formatter verification passed; the solution loader emitted its existing
  non-failing workspace warning.
- Capability, privacy/non-retention, personal-path, public-surface, no-new-friend-
  assembly, queue JSON, and scoped `git diff --check` gates passed.
- Hostile tests cover stale/missing/two-valid candidates; missing, mismatched, and
  substituted executables; signer, publisher, signature, and public PE failures;
  unsafe drives, filesystems, paths, and reparses; malformed, duplicate, conflicting,
  deep, oversized, and over-count evidence; version conflict/unavailable; target
  drift; blocked same-length/same-time executable swaps; blocked ancestor rename and
  replacement; pre/post metadata NTFS file-ID mismatch; hardlinks and reparses;
  full-versus-partial candidate resolution; immutable handoffs; and repeated
  read-only inspection.

Reparse rejection does not depend on symlink privilege. Deterministic tests inject a
test-only reparse observation for the real WuWa and Endfield game-root paths, execute
both adapters, and prove `ReparsePointFound`, no maintenance target/full-install
proof, and no constructible handoff. Separate live Windows symlink tests are optional
environment checks: they throw xUnit `Skip` when link creation is unavailable and are
not counted as proof. Link creation was available in the recorded run, so the exact
skipped count was zero.

Deterministic entry-opener tests model the root launcher, versioned launcher, and
Endfield `Games.exe` companion becoming reparse entries after the initial path scan
but exactly when the protected entry-open phase runs. Each test asserts the injected
entry opener was reached for the expected ordered paths, rejects with
`ReparsePointFound`, yields no maintenance target/full-install proof, and cannot
create a handoff. Bypassing the production-bound entry opener makes both the reached
and result assertions fail. A separate optional live file-symlink test directly calls
the native no-follow opener; it uses xUnit `Skip` when privilege is unavailable and
is not deterministic proof. Link creation was available in this run.

All filesystem mutations occurred only in random disposable fake-test folders. No
real game, official launcher, personal install path, registry record, network
endpoint, UAC prompt, UI automation, or deployment was touched.

## Deliberately unresolved

Direct WuWa and Endfield launch remains disabled. Separate explicit pilots must prove
the production channel, exact bootstrap/runtime ownership, required arguments, UAC
and ACE behavior, startup timeout, already-running adoption, simultaneous-game
behavior, normal close detection, and safe relaunch. An official-maintenance executor
must rerun the entire production validator immediately before admission, hold the
same no-write/no-delete executable bindings through that decision, and require the
same canonical launcher path and version; the handoff object alone is not execution
authorization.
