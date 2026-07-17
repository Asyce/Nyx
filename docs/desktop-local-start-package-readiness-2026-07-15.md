# Desktop local start and package-readiness gate

Date: 2026-07-15

Status: implemented, independently reviewed and verified; no app or package operation performed

## Outcome

The repository now has one normal-user developer start path and a separate read-only package-configuration gate. The start path uses the packaged-app support already pinned in the project. It never runs the raw executable. The configuration gate correctly says the current project is not configured for a later release-package test.

## Developer start boundary

`Desktop/scripts/start-nyx.ps1` derives every project path from its own repository location. Before any real start it checks:

- Windows build 22621 or newer;
- an x64 operating system and x64 PowerShell process;
- the exact SDK pinned by `Desktop/global.json`;
- the expected project and manifest files;
- the reviewed `Microsoft.Windows.SDK.BuildTools.WinApp` package reference;
- existing restore assets for WinApp run support;
- the read-only `WinAppRunSupportInfo` MSBuild target reporting `_WinAppRunSupportActive: true`;
- Developer Mode enabled; and
- a non-elevated process.

`-CheckOnly` performs those checks but never restores, builds, registers, or starts the app. `-CheckOnly -Restore` is explicitly rejected. The non-elevated and Developer Mode gates run before the optional restore branch, so an administrator or Developer-Mode-off invocation cannot restore first. A real start also defaults to `--no-restore`; `-Restore` is an explicit opt-in used only when restore assets are absent. No tool is downloaded directly.

The only start command is the repository-relative app project through `dotnet run` for Release, `win-x64`, `Platform=x64`, and `--no-restore`. WinApp run support gives the development build its package identity. The script contains no raw AppX executable path, `Start-Process`, shell dispatch, self-elevation, hidden window, protocol, URL, game, or official-launcher capability.

`Desktop/Start Nyx.cmd` is a fixed-path double-click wrapper. It uses a process-scoped PowerShell execution-policy bypass only for the reviewed local script, forwards no user-controlled command text, remains visible, and preserves the script's exit code.

## Package configuration boundary

`Desktop/scripts/test-package-readiness.ps1` first accepts only an existing local-drive root. It walks each drive segment in order and stops at any missing, malformed, oversized, UNC/device, relative, or reparse segment before touching descendants. It applies the same contained non-reparse checks to the App root, project, manifest, profile directory, every profile, and any selected signing key before bounded XML or profile I/O.

It reads only bounded copies of:

- `src/Nyx.Desktop.App/Nyx.Desktop.App.csproj`;
- `src/Nyx.Desktop.App/Package.appxmanifest`; and
- at most 32 `Properties/PublishProfiles/*.pubxml` files.

XML DTDs and external resolution are disabled. Missing, malformed, oversized, or ambiguous inputs fail closed. The configuration reports ready only when all of these facts are unique, unconditional, and internally consistent:

- a non-placeholder, valid publisher distinguished name;
- one syntactically valid signing thumbprint of exactly 40 or 64 hexadecimal characters, or one contained existing non-empty bounded `.pfx` key-file setting;
- exactly one allowed `NyxDistributionChannel` value (`private-sideload`, `website`, or `store`); and
- exactly one x64/win-x64 profile explicitly sets both `GenerateAppxPackageOnBuild=true` and `AppxPackageSigningEnabled=true` without disabling `WindowsPackageType`.

A different `PublishProtocol` alone is never accepted. Duplicate, conflicting, conditional, true-then-false, disabled, missing, or reparse-backed inputs fail closed. Output is limited to `NYX_PACKAGE_CONFIGURATION=READY|NOT_READY` plus sorted sanitized blocker categories and returns exit code `0` or `3`. It never prints inspected paths or XML values.

Exit `0` proves only that explicit configuration is ready for a later build/sign/install test. It does not prove a thumbprint exists in a certificate store, a package can build or sign, dependencies are distributable, or an output is installable.

The gate has no build, restore, process-start, network, certificate, sign, pack, register, install, publish, or write operation.

## Current real result

The real check-only developer preflight succeeds without restore or launch. The real package-configuration gate returns exit code `3` with exactly these current blockers:

- `DistributionChannelUnresolved`;
- `InstallablePackageProfileMissing`;
- `PublisherPlaceholder`;
- `SigningIdentityMissing`.

This is expected. The app can be developed locally, but it must not be described as installable.

## Owner decision still required

Before release packaging, the owner must choose private sideload, signed website distribution, or Microsoft Store distribution. That decision controls the real publisher identity, certificate ownership, signing and secret handling, dependency delivery, and update channel. None of those choices are inferred here.

Nyx stays a normal-user app. Only the sealed, repeatedly revalidated direct launch of Genshin, HSR, or ZZZ may request UAC when that exact game requires it; official launchers and arbitrary paths cannot.

## Verification

- Focused package/start Release tests: 48/48 passed.
- Full Desktop Release tests: 775/775 passed with zero skipped.
- Core, Infrastructure, Pilot, and App x64 Release builds: zero warnings and errors.
- Real `-CheckOnly` preflight: exit `0`; no restore or start text.
- Real package-configuration gate: expected exit `3`; four exact sanitized blockers.
- Root/path fixtures reject relative, UNC/device, missing, malformed, oversized, direct-reparse, reparse-parent, App-root-reparse, and file-reparse inputs with only `RootInvalid`; property fixtures reject duplicate, conflicting, conditional, disabled, nonexistent, empty, oversized, and true-then-false inputs.
- Production-gate thumbprint fixtures accept exactly 40 and 64 hexadecimal characters and reject 39, 41, 63, and 65.
- PowerShell parser: both scripts have zero parse errors.
- Deterministic source-order gate confirms administrator/Developer Mode refusal precedes both the restore branch and restore call; isolated `-CheckOnly -Restore` exits `14` without restore.
- Scoped format, batch/capability/privacy/path, queue JSON, docs, handoff, and whitespace gates passed.

Independent usability/security review and separate verification are CLEAN.
