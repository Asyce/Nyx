# Elevated HoYo launch and session fix — 2026-07-15

## Live-test findings

- Genshin launched, but Nyx did not prove the later close.
- HSR and ZZZ did not launch.
- Both local HSR and ZZZ records, roots, required files, versions, and Authenticode publisher evidence passed the existing read-only identity gate.
- The installed `StarRail.exe` and `ZenlessZoneZero.exe` manifests require administrator execution.
- Windows error 740 was therefore the HSR/ZZZ blocker. Genshin already had a sealed revalidated elevation retry.
- Nyx used `Process.MainModule` for exact-path observation. A normal launcher cannot reliably use that API against an elevated game, so evidence became uncertain instead of Running.
- Ordinary window activation incorrectly used the system-resume reset path, erasing close-confirmation samples when the user returned to Nyx.

## Fix

- Exact process-path observation now requests only Windows `PROCESS_QUERY_LIMITED_INFORMATION` and calls `QueryFullProcessImageName`.
- Failed, inaccessible, exited, or different-path same-name candidates remain uncertain and cannot be treated as absence.
- HSR and ZZZ retry through Windows `runas` only after a normal start returns error 740.
- The complete game identity, root, process absence, and fixed zero-argument specification are checked a third time immediately before a sealed HSR/ZZZ-only elevation request.
- The Windows boundary accepts only `StarRail.exe` for `hsr` or `ZenlessZoneZero.exe` for `zzz`, with the executable's exact directory as the working directory and no arguments.
- Ordinary window activation performs a normal refresh. The existing system-resume reset remains separate for a future real resume signal.

Nyx itself remains a normal-user app. This adds no generic administrator, path, argument, shell, launcher, URL, update, or command capability.

## Verification

- Author focused adversarial tests: 57/57 passed.
- Author Launching + Sessions + UI tests: 236/236 passed.
- Author full Desktop Release tests: 794/794 passed.
- Core, Infrastructure, read-only Pilot, and App win-x64 Release builds: zero warnings and zero errors.
- Independent security/lifecycle review: CLEAN.
- Independent final-snapshot verification: focused 57/57 and full Desktop 794/794; four builds with zero warnings/errors; format, queue, XML, whitespace, public-capability, and Win32 access gates clean.

## Live proof

The user completed the real pilot on 2026-07-15. Genshin, HSR, and ZZZ each launched, closed, were detected as closed, and returned to working Launch availability. Automated verification itself did not start a game, official launcher, or UAC prompt.
