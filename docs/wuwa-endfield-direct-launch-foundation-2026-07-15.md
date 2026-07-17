# WuWa and Endfield direct-launch foundation - 2026-07-15

## Outcome

Nyx now has a sealed direct-launch and session boundary for Wuthering Waves and
Arknights: Endfield. This batch does not expose the boundary in the App yet and
does not start either real game.

## Live-install facts represented

- Wuthering Waves uses the exact signed `Wuthering Waves.exe` bootstrap and the
  exact `Client-Win64-Shipping.exe` runtime.
- Its two public local version labels disagree. Nyx may use the separately proven
  executable identity for Launch, but it does not call the installation current.
- Endfield's signed GRYPHLINK launcher reports four-part product version
  `1.5.0.1507`, while the official version folder is the exact three-part prefix
  `1.5.0`.
- Endfield starts and observes only the exact signed `Endfield.exe`. The
  `PlatformProcess.exe` and anti-cheat helpers are not game-lifetime evidence.

## Boundary

- Complete protected installation validation is repeated for every observation
  and start. Protected file handles remain alive through the process check or
  dispatch.
- The protected validator and injectable service constructor are internal. The
  App can obtain only the fixed production service from a zero-parameter factory.
- Only full WuWa proof with the honest `VersionConflict` reason, or full Endfield
  proof with the honest `VersionUnavailable` reason, can enter direct launch.
- Both launch specifications are fixed, argument-free, non-shell, and use the
  executable's exact game directory.
- Nyx tries a normal start first. Windows error 740 alone can trigger a third full
  protected validation and then a sealed game-specific administrator request.
- Missing, inaccessible, changed, same-name/different-path, reparse, race, root
  drift, or uncertain evidence stays locked.
- The shared coordinator retains independent per-game Starting, Running,
  confirmed-close, relaunch, same-game suppression, and different-game
  concurrency behavior.

## Author verification

- Focused identity, direct-launch, and session Release tests: 146/146 passed.
- Full Desktop Release tests: 847/847 passed.
- Core, Infrastructure, read-only Pilot, and App win-x64 Release builds: zero
  warnings and zero errors.
- Scoped format, forbidden-capability, diff, and whitespace checks: clean.
- No real game, official launcher, UAC prompt, network request, registry write,
  game-folder mutation, UI automation, restore, deploy, commit, or push occurred.

## Next action

After independent review and verification, the App will connect these adapters to
WuWa's exact registry locator and to one user-chosen, locally saved Endfield root.
Real launch, close, and relaunch proof remains a user pilot.

## Closure

Independent security/concurrency review is CLEAN after four findings were fixed:
Endfield launcher byte identity, exact Launcher.exe identity, the public protected
validation seam, and replacement-root promotion. Independent final verification
passes focused 146/146, full Desktop 847/847, static/public-surface gates 30/30,
and all four Release builds with zero warnings/errors. Format, whitespace, diff,
queue, and source-stability checks are clean.
