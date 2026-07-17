# HSR and ZZZ live desktop sessions

## Result

Nyx now gives Honkai: Star Rail and Zenless Zone Zero the same app-lifetime
session behavior already used for Genshin Impact. The shared coordinator can
observe, start, and later recognize closure for each game independently.

This work does not make Nyx an updater. HoYoPlay remains responsible for install,
update, pre-download, verify, and repair.

## Exact launch boundary

Only two fixed profiles exist:

| Game | Registry identity | Executable | Process identity |
| --- | --- | --- | --- |
| HSR | `hkrpg_global` | `StarRail.exe` | exact executable path |
| ZZZ | `nap_global` | `ZenlessZoneZero.exe` | exact executable path |

The existing current-user discovery reads only each exact public HoYo install
record. That record proposes a folder but never proves it. The existing sealed
identity adapter then requires the expected local fixed-drive layout, config,
version evidence, signed publisher, product identity, and stable non-reparse
target.

At Launch, Nyx repeats discovery and validates the selected profile twice across
the process-admission boundary. The final specification is fixed to the expected
executable in the validated game root, with that root as the working directory,
no arguments, and `UseShellExecute=false`.

There is no URL/protocol start, command shell, arbitrary executable name, generic
path start, HoYoPlay fallback, update action, or elevation fallback in this path.
If identity, path, process evidence, or Windows start behavior is unexpected,
the game fails closed.

The adapter also retains the exact canonical root it was observing. If HoYoPlay's
current record changes from root A to another valid root B, Nyx keeps checking the
old exact process at A. A running or uncertain A blocks B. A transition to B needs
two separate exact absence observations of A, and a running or uncertain
interruption resets that confirmation. A root change after coordinator observation
is rejected at dispatch and cannot seed the transition. This prevents a second
same-game copy from starting at B while A remains active.

This also survives a Nyx restart. HSR/ZZZ use the strict Windows game-process
observer, which treats every same-named process at a different or inaccessible
executable path as uncertain, not absent. Therefore a fresh adapter pointed at B
cannot declare B ready while an accessible `StarRail` or `ZenlessZoneZero` process
still runs from A. Only an empty same-name process set is `NotRunning`; an exact
expected path is `Running`. The ordinary observer retains its previous behavior
for generic publisher names such as `launcher.exe`, so an unrelated accessible
launcher does not disable Genshin's HoYoPlay action; an inaccessible one remains
uncertain.

## Lifetime and concurrency

HSR and ZZZ are registered as production `IGameSessionAdapter` instances in the
same five-game coordinator as Genshin. WuWa and Endfield remain capability-free
fail-closed rows.

The coordinator blocks a duplicate start of the same game. Separate per-game
gates and the UI's per-game in-flight set allow two different games to start or
run together. Periodic exact-path observations recognize a running game and use
the established two-sample close confirmation. Closure only restores the Launch
button; it never restarts a game automatically.

## UI behavior

The single primary button always targets the currently selected game. HSR and ZZZ
show Checking, Ready, Starting, Running, Launch failed, Needs review, or Not found
from their own coordinator snapshot and version. Their maintenance line continues
to state that updates use HoYoPlay; this task does not open HoYoPlay from a game
Launch failure.

## Verification

- Focused service/session/UI/process tests: 39/39.
- Full Desktop tests: 592/592.
- The focused tests cover fixed profiles, exact specifications, repeated
  validation, identity/root drift, exact running/uncertain evidence, bounded
  start failure, cancellation, closure then explicit relaunch, same-game
  duplicate suppression, simultaneous HSR/ZZZ dispatch, valid cross-observation
  root drift, interrupted root transition, missing-record continuity, and a root
  change between coordinator observation and dispatch. Process tests cover no
  same-name process, exact-path precedence, different-path uncertainty, and
  inaccessible-path uncertainty; a fresh-adapter restart regression proves no
  second dispatch after a moved record. A separate ordinary-observer regression
  proves an unrelated accessible `launcher.exe` is still ignored while an
  inaccessible same-name process remains uncertain.
- Read-only local reality check: the exact HSR public record exists; its declared
  game identity is `hkrpg_global`; required public files exist; and the game
  executable has a valid COGNOSPHERE signature and `Star Rail` product identity.
  No personal installation path is recorded here.
- No game, HoYoPlay, UAC prompt, network request, registry write, game-folder
  mutation, UI automation, deploy, commit, or push occurred.

Independent review found both the in-lifetime and restart forms of root drift, then
the generic-launcher side effect. The final separate strict/ordinary process policy
closes all three findings. Independent review and verification are CLEAN: broad
Launching/Hoyo/Sessions/UI tests pass 255/255 and all three Release builds have zero
warnings and zero errors.
