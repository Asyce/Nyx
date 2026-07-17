# Genshin safe-launch pilot

Date: 2026-07-14

Status: user-approved Genshin-only UAC flow implemented and independently reviewed; real approval remains user-controlled

## User promise

When the person presses Launch, Nyx checks the chosen Genshin folder again and starts only its exact top-level `GenshinImpact.exe`.

Opening HoYoPlay is a separate action. It checks HoYoPlay again and starts only its exact root `launcher.exe`.

## Fixed start rules

- The executable path and working folder come only from a fresh `Ready` adapter result.
- Genshin uses `GenshinImpact.exe`; HoYoPlay uses `launcher.exe`.
- The argument list is empty.
- Windows shell execution is disabled.
- There is no URL protocol, command string, fallback executable, retry executable, elevation verb, or user-supplied argument.
- A same-named running process counts only when its executable path exactly matches the validated target. An unreadable same-named process is uncertain and blocks a second start.
- Missing, moved, linked, changed, stale, or invalid evidence becomes `NeedsReview` and starts nothing.
- A Windows start error becomes `LaunchFailed` and starts nothing else.

## Narrow automatic candidate discovery

The private pilot reads only two exact 64-bit machine uninstall records:

- `Genshin Impact`: `InstallPath`, `GameBiz`, `Channel`, `HoYoPlay`;
- `HYP_1_0_global`: `InstallPath`, `ExeName`, `Region`, `GameBiz`.

It does not enumerate publisher records or read UUID, uninstall commands, protocol handlers, account data, or unrelated values. Registry evidence only proposes a folder. The read-only signed-file adapter must still return `Ready`, and its canonical root must exactly equal the proposed folder.

## Verification before real start

- Focused launch and discovery tests: `26/26` passed.
- Full Nyx Desktop tests: `109/109` passed.
- Infrastructure and Windows 11 x64 app Release builds: zero warnings and zero errors.
- Independent review: clean.
- Source scan: no shell fallback, URL handler, command-line read, registry enumeration, network API, file write, elevation, or background start.

The remaining timing window between final validation and Windows process creation cannot be made atomic by a normal same-user desktop app. It is accepted for this private pilot and documented for later hardening.

## Real start result

The user-approved real folder returned `Ready`, then Windows rejected the exact non-shell, zero-argument start with native error `740`: administrator approval is required.

Nyx now maps this to `LaunchFailed` plus `ElevationRequired`. It performs exactly one start attempt, opens nothing else, leaves Genshin stopped, disables the unusable direct Launch action, explains `Admin approval needed`, and keeps the independently verified HoYoPlay action available.

The second real fail-closed run confirmed the exact mapping and confirmed no Genshin process remained. No UAC prompt, elevation request, shell execution, retry, fallback, updater start, or automatic handoff occurred.

## User-approved direct UAC flow

The user explicitly rejected HoYoPlay as a game-start handoff and chose direct Genshin launch with administrator approval.

Nyx itself remains non-admin. A direct Launch click now:

1. validates the exact game folder and `GenshinImpact.exe`;
2. attempts the normal zero-argument, non-shell start;
3. only after Windows error 740 validates the game and running state again;
4. confirms the target, working folder, arguments, and original launch specification are unchanged;
5. creates one internally sealed Genshin-only elevation request;
6. asks Windows to run that same exact executable with the `runas` verb.

HoYoPlay, Nyx, discovery, URLs, arbitrary paths, arguments, non-740 failures, changed targets, linked targets, and already-running targets cannot reach the elevation path.

Cancelling the Windows prompt becomes `ElevationCancelled`. Other elevated start failures become `ElevatedStartFailed`. Neither result retries or opens a fallback.

Focused UAC tests pass `20/20`; the full Desktop suite passes `116/116`; the Windows 11 x64 Release build has zero warnings and zero errors; and the independent security review is clean. The actual Windows approval prompt remains a user action and is never automated or bypassed.
