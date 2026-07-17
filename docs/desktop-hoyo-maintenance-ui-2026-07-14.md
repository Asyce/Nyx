# HoYo maintenance status and visible handoff

## Result

Nyx now connects the already-reviewed official HoYo branch signal to the Desktop
launcher. Genshin Impact, Honkai: Star Rail, and Zenless Zone Zero can show:

- Update + pre-download available
- Update available
- Pre-download available
- Up to date
- Check in HoYoPlay

This is advice, not an updater. HoYoPlay still installs, updates, pre-downloads,
verifies, and repairs the game.

## Automatic status boundary

One app-lifetime `HoyoPublisherStatusSource` starts only after the first local
session refresh, so its update comparison sees the best available local versions.
It immediately runs the existing fixed official branch-status request and repeats
at a one-hour interval. Concurrent refresh calls share one request.

The source owns no process, launcher, package, update, registry, or game-file
capability. It publishes the existing bounded result and preserves independent
update and pre-download states. Network failure, timeout, schema drift, missing
local version, cancellation, or shutdown yields an honest unknown/check-in-official
state. Publisher status never changes a local game session or disables the direct
game Launch button.

## Visible HoYoPlay handoff

All three games use one app-owned visible HoYoPlay executor. Genshin is
argument-free. HSR and ZZZ use the sealed handoff factory:

| Game | Only allowed argument |
| --- | --- |
| Genshin | none |
| HSR | `--game=hkrpg_global` |
| ZZZ | `--game=nap_global` |

The executor validates the exact signed HoYoPlay installation, strictly checks the
whole `launcher.exe` process family against that exact path, creates the sealed
request, then repeats validation and requires the second path, version, game, and
arguments to match before starting anything. One app-lifetime admission gate means
only one Genshin/HSR/ZZZ official-launcher dispatch can be active, including across
page reloads. The Windows start is visible, non-shell, and uses exactly zero or one
internally produced argument. There is no hidden window, headless mode, command
shell, arbitrary path, arbitrary argument, direct update, or elevation fallback.

If any same-name HoYoPlay process is at another path, inaccessible, already
running, ambiguous, changed, unsigned, or missing, Nyx does not start another copy.
The UI shows the official action only for the three HoYo games. WuWa and Endfield
keep their official-provider wording but remain disabled until their locator and
execution work is separately reviewed.

If the official feed advertises a pre-download but Nyx cannot prove the installed
local version, the UI says `Check in HoYoPlay`. It does not turn a remote fact into
a local update or pre-download claim.

If a page reload occurs while an official-launcher attempt is still active, the new
page makes the open-versus-observe choice synchronously, before any background work
can be queued. An observer waits for that admission to finish and performs a fresh
strict process check. It never converts temporary family contention into a permanent
`HoYoPlay open` label, never dispatches the second selected game automatically, and
can be canceled without leaking the family gate.

## UI behavior

The selected HoYo game shows its own update/pre-download label beside one `OPEN
OFFICIAL` button. The button's accessible name includes the selected game. Clicking
it is the user interaction boundary: HoYoPlay appears normally so the user can
review and run the official maintenance control. A failed game Launch never opens
HoYoPlay automatically.

## Verification

- Focused handoff/factory/projection/UI tests: 51/51.
- Full Desktop tests: 623/623.
- Core, Infrastructure, and App win-x64 Release builds: zero warnings/errors.
- Tests cover exact HSR/ZZZ arguments, two validations, metadata drift, exact
  running/uncertain launcher evidence, shared-family concurrent admission, bounded
  start failure, page reload during blocked failing and successful opens, canceled
  replacement observers, unsupported games, startup publication, conservative
  unknown-local projection, update plus pre-download projection, refresh coalescing,
  remote failure, shutdown cancellation, UI selection, normal visible start, and
  absence of hidden/shell/elevation controls.
- Task-scoped format verification passes (workspace-load warning only).
- No real game, HoYoPlay, UAC prompt, live network/package/update request, registry
  write, game-folder mutation, UI automation, deploy, commit, or push occurred.

Independent security/lifecycle/UI review and independent verification are CLEAN.
