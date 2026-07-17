# WuWa maintenance locator and UI wiring

Date: 2026-07-15

Status: private Windows App integration implemented, independently reviewed and verified; no live start pilot performed

## Outcome

Nyx now performs one read-only Wuthering Waves maintenance check when the launcher
page starts. If and only if the exact uninstall hint leads to a complete production
WuWa proof, the WuWa page exposes **Open Official**. Wuthering Waves direct game
launch remains disabled.

The user-facing rule is unchanged: Nyx may open the visible official launcher, but
Kuro's launcher installs, updates, pre-downloads, verifies, repairs, and removes the
game. Nyx does not perform those operations.

## Exact registry locator

The production reader opens only:

- hive: `HKEY_LOCAL_MACHINE`;
- view: 32-bit registry view;
- key: `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\KRInstall Wuthering Waves Overseas`;
- values: `DisplayName`, `InstallPath`, and `LauncherPath`.

It opens the key read-only, does not expand environment values, does not enumerate
uninstall records or value names, and does not read HKCU, publisher caches, logs,
accounts, credentials, or private data. Registry data is never identity proof.

`DisplayName` must be the exact bounded string `Wuthering Waves`. Path values must be
bounded strings with no surrounding whitespace and must normalize to exact,
fully-qualified local drive paths. UNC, device, relative, malformed, non-string, and
oversized values are rejected. `LauncherPath` may name the exact `launcher.exe` or
its canonical root. Duplicate roots collapse, and at most two hints reach the
candidate resolver.

## Proof and service boundary

Every hint runs through the complete production `WuWaIdentityAdapter`. Missing,
partial, unsafe, drifted, or two-valid-root evidence produces no request. The
version-conflict state is maintenance-ready only when the full launcher, bootstrap,
runtime, configuration, and resource proof remains present.

The service then routes the sealed request through the reviewed nyx-0070 executor's
read-only `Check`. This repeats the entire proof and checks the exact Kuro launcher
process without starting anything. The service exposes no public registry, root,
path, game-ID, argument, protocol, shell, elevation, or update input.

## App and lifecycle behavior

Startup runs the HoYo and WuWa checks as two independent background lanes and stores
their results separately. Both lanes start before either is awaited, catch and apply
their own failure state, and use independent generations so an older delayed result
cannot overwrite a newer activation check. A deterministic runner proves one lane
can finish while the other is delayed and still runs when the other fails. Startup
never calls `Open` during discovery, selection, rendering, or refresh.

The WuWa maintenance row behaves as follows:

| State | Text | Open Official |
|---|---|---:|
| Checking | Checking official maintenance | Hidden |
| Ready | Official maintenance ready; version conflict is stated plainly | Visible and enabled |
| Opened | Official launcher start requested | Hidden |
| Running | Official launcher open after exact-process evidence | Visible and disabled |
| Not found | Official launcher not found | Hidden |
| Needs review | Official maintenance needs review | Hidden |
| Failed | Official launcher failed to open | Hidden |

The action has an explicit accessibility name in every state. A click passes only
the stored request to `OpenOrObserveCurrentAsync`. `Opened` means only that the exact
visible start was requested; it is never presented as process evidence. During a
bounded observation window the App runs up to six fresh read-only exact-process
checks at 500-millisecond intervals. Exact presence becomes `Running` as soon as it
appears. Only six consecutive absent samples return the action to `Ready`, which
keeps a slowly appearing launcher from being mistaken for an immediate exit. Every
app reactivation independently rechecks both publisher lanes, so a launcher that
closes later returns to `Ready` and can be explicitly opened again.

If activation occurs while the click-owned observation window is active, the WuWa
activation refresh is skipped. It cannot advance the WuWa generation, publish an
early `Ready`, or discard delayed exact `Running` evidence. The HoYo activation
refresh remains independent and unchanged.

A per-WuWa in-flight guard blocks repeated page clicks, while the executor's
process-wide Kuro admission blocks cross-instance duplicates. Page unload cancels
waiting work, and page-lease plus per-lane generation checks reject stale results.
Switching games does not rewrite or redirect the stored request.

Endfield never enters this locator, service, Kuro admission, executor, or action.
Its official action remains hidden. Genshin, HSR, and ZZZ retain their existing game
Launch and HoYoPlay maintenance paths.

## Verification

- Focused lifecycle, locator, executor, and UI Release tests: 75/75 passed.
- Full Desktop Release tests: 727/727 passed with zero skipped.
- Core, Infrastructure, Pilot, and App win-x64 Release builds: zero warnings and
  errors.
- Scoped format, capability/privacy/path/registry-surface/accessibility, queue JSON,
  docs, handoff, and whitespace gates passed.

All process starts, registry records, roots, and lifecycle races are fakes or static
source gates. No real registry read, game, official launcher, process start, UAC
prompt, network, personal install path, restore, or UI automation was used.

## Deliberately unresolved

- live visible Kuro-launcher start pilot;
- direct WuWa game launch, session/close observation, or direct update;
- Endfield locator or execution;
- hidden/headless behavior, publisher UI automation, packaging, shortcuts,
  publication, or deployment.
