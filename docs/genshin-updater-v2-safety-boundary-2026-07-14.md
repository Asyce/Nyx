# Genshin updater v2: dry-run safety boundary

Date: 2026-07-14  
Scope: `nyx-0054` only

## Decision

The first Nyx-owned updater component is an internal pure planner. It accepts opaque verified artifacts and returns an internal immutable `Ready` or `Blocked` dry run. It has no capability to download, start a process, request administrator access, inspect a live folder, or change a file.

`Ready` means only that the supplied artifacts are internally consistent enough for a later, separately reviewed phase to consider. It is not permission or authorization to update a real installation. There is deliberately no public production validator, planner, plan type, operation type, or consumer in this phase, so Infrastructure cannot manufacture or consume `Ready`.

## Boundary

The boundary lives only in `Nyx.Desktop.Core.Updating`:

- `GenshinUpdateContracts.cs` defines internal evidence, package, result-set, operation, budget, and result types.
- `GenshinUpdatePlanner.cs` validates those values and calculates a dry-run plan.
- Every type in `Nyx.Desktop.Core.Updating` is internal. Test access is granted only to `Nyx.Desktop.Tests` by `UpdaterAssemblyVisibility.cs`.
- `GenshinUpdatePlan` is a sealed non-record with a private constructor and get-only state. Its ready bit and status derive only from an evaluation having zero block reasons; there is no `CreateReady` method. It cannot be copied with `with`, publicly constructed, or publicly read.
- The planner accepts and returns internal data only. It has no injected service, callback, filesystem writer, network client, process starter, elevation helper, or UI automation object.

The existing direct-launch code is not referenced or changed.

## Current publisher-source gate

The read-only publisher-source check is a no-go for downloading or applying a
real update:

- HoYoverse's current branch endpoint reports Global Genshin `6.7.0`, but its
  public package endpoint still reports `5.5.0` for the same launcher catalog.
- The usable public package records expose MD5 rather than a strong signed hash.
- No public, publisher-authenticated complete extracted-file manifest was found.
- No public anti-cheat driver/service update and rollback contract was found.

The checked publisher endpoints were:

- `https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGameBranches?game_ids%5B%5D=gopR6Cufr3&launcher_id=VYTpXlbWo8`
- `https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGamePackages?launcher_id=VYTpXlbWo8&language=en-us`
- `https://sdk-os-static.hoyoverse.com/hk4e_global/mdk/launcher/api/resource?key=gcStgarh&launcher_id=10`

Therefore no downloader, extractor, or apply helper may be added from this
evidence. A later source review must prove current package resolution, strong
publisher authentication, rollback resistance, full-result hashes, voice-pack
semantics, and privileged-component handling before this gate can change.

## Evidence required before `Ready`

All of these must eventually be produced as opaque artifacts by future validators inside Core:

1. The global Genshin game identity and full current managed-file inventory.
2. A trusted, canonical, unambiguous installation path with no reparse point.
3. Trusted evidence that no anti-cheat, Windows service, or driver change is required.
4. Publisher identity, release manifest, and exact target version.
5. Every required package's SHA-256, publisher signature, manifest, target release, and non-negative download size.
6. The complete trusted managed-file result set after the update.
7. Independently measured non-negative staging and rollback capacity.

There are no caller-controlled `Trusted=true` booleans. Installation, release, packages, protected paths, and storage must hold the exact same opaque binding object for one root and release; copied text IDs do not bind evidence. The planner validates package hashes as SHA-256-shaped values, but it does not calculate hashes or verify signatures itself.

No public production validator exists yet. Until separate validators genuinely verify publisher identity, signatures, hashes, complete inventories, path safety, protected paths, and storage, production code has no API that can create these artifacts or receive a plan.

## Package rules

- The target must be newer than the installed version. Same-version plans and downgrades block.
- All packages in one plan must use one package kind and one target release.
- A delta package must exactly name the installed base version.
- Delta replacements and deletions must match the installed base-file hash.
- A full package cannot claim a delta base.
- Every version must use a strict canonical three- or four-part numeric form. Package IDs use a bounded ASCII allowlist.
- Every changed relative path must be canonical, unique, Unicode-normalized, free of Windows device-name aliases, and confined to the logical game root.
- Package data never declares whether its own path is protected. A separate verified protected-path inventory classifies anti-cheat, Windows service, and kernel-driver paths; any package intersection blocks.
- Applying all package changes to the trusted managed inventory must produce exactly the trusted result set, including hashes and sizes.
- An unsupported, incomplete, conflicting, or ambiguous manifest blocks.

## Unknown-file preservation

Files not proven to be publisher-managed are classified as `Unknown`.

- An unknown file omitted by the package is listed in `PreservedUnknownFiles`.
- A package cannot write or delete an unknown path.
- A blocked plan exposes no package IDs and no operations.

This avoids treating user-created files, unrelated tools, or future publisher files as disposable.

## Space and rollback budgets

The planner calculates conservative dry-run budgets:

- Staging bytes = all package download bytes + the complete verified target tree, including unchanged files.
- Rollback bytes = the complete current publisher-managed inventory, including unchanged files.

Arithmetic overflow blocks. Trusted available staging and rollback values must each meet the calculated requirement. These formulas reserve space; they do not allocate it.

## Fail-closed output

The internal sealed `GenshinUpdatePlan` contains:

- `Blocked` or `Ready`;
- current and target versions;
- immutable package IDs and dry-run operations only when ready;
- immutable unknown paths that must be preserved;
- required staging and rollback bytes;
- immutable, machine-readable block codes with plain messages.

Malformed, missing, default-array, unsafe, ambiguous, cross-boundary, inconsistent, or insufficient evidence returns `Blocked`. A blocked plan always has empty package IDs and operations. No exception or fallback is used as an update decision.

## Explicitly not implemented

- Publisher endpoint discovery or reverse engineering
- Network requests or package downloading
- Real path discovery or filesystem reads
- Package extraction, patching, publishing, moving, deleting, or recovery
- Administrator access, services, drivers, or anti-cheat handling
- Process start, game shutdown, launcher control, or UI automation
- Real installation tests or real updates
- Website or launcher UI changes

## Later gates

Before a downloader can be added, a separate reviewed phase must define the authoritative publisher metadata source, signature chain, download resume rules, storage proof, and hostile-package limits. Before any apply helper can be added, another boundary must define same-volume staging, atomic publish behavior, rollback durability, crash recovery, protected-component handling, privilege separation, and real-machine testing.

The main unresolved risk is evidence provenance. This phase intentionally has no production artifact factory. A later phase must add reviewed, non-public validators that bind their outputs only after every real check succeeds; it must not add a public constructor, expose `Ready`, or treat this dry run as an executable authorization.
