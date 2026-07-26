# Nyx Desktop boundary

Date: 2026-07-21

Status: revised multi-game, export, and publisher-account contract

## Product promise

Nyx finds and launches installed games. The official publisher launcher installs,
updates, pre-downloads, verifies, repairs, and removes them.

Nyx may report a publisher maintenance offer when a tested public publisher signal
proves it. Nyx does not perform or disguise the maintenance work.

## Supported identity

Desktop code and stored data use exactly these canonical IDs:

| ID | Game |
|---|---|
| `gi` | Genshin Impact |
| `hsr` | Honkai: Star Rail |
| `zzz` | Zenless Zone Zero |
| `wuwa` | Wuthering Waves |
| `ae` | Arknights: Endfield |

Aliases such as `genshin` and `endfield` do not cross the Desktop Core boundary.
Version one targets existing Global publisher-managed installations on Windows 11
x64. Other stores, regions, unofficial copies, and multiple managed installations
per game remain outside the boundary.

## Ownership

| Owner | Owns | Does not own |
|---|---|---|
| Nyx Desktop | Read-only discovery, local validation, explicit direct launch, session observation, publisher-offer display, official-launcher handoff, GI/HSR export jobs, app-owned isolated publisher sessions, explicit daily check-in, and selected-game resource display | Game maintenance, unattended check-in, generic browser automation, external-browser profiles, publisher passwords, or remote secret handling |
| Official launcher | Install, update, pre-download, verify, repair, login, and publisher preparation | Nyx settings or Nyx website data |
| Nyx website and Worker | Existing browser tools, pull history, and browser-facing services | Local process control or desktop-launcher authentication |

The interface must say plainly: **Nyx launches the game. Updates, repairs, and
installs happen in the official launcher.**

## Two independent status tracks

A local launch result and a publisher maintenance result are separate facts. One
must never overwrite or imply the other.

### Local game status

| Status | Meaning | Launch action |
|---|---|---|
| `NotFound` | No trustworthy installation was found. | Disabled |
| `NeedsReview` | Local readiness has not been checked, or identity/process evidence is inaccessible, stale, conflicting, or explicitly rejected. | Disabled |
| `Ready` | The chosen local launch target passed its checks and no exact game process is confirmed running. | Enabled |
| `Starting` | Dispatch was entered, but the result still needs exact process reconciliation. This includes accepted and cancellation-uncertain dispatches. | Disabled |
| `Running` | An adapter matched an exact bootstrap or runtime executable identity. Bootstrap-only state remains transitional until runtime appears. | Disabled |
| `LaunchFailed` | Dispatch failed or the game was never observed before the startup timeout. | Explicit retry allowed |

`Ready` never means current or updated. After a confirmed session ends, local
status returns to `Ready`; the UI may explain this as **Session ended — Launch
again** without creating a new status or restarting automatically.

### Publisher maintenance status

| Status | Meaning |
|---|---|
| `NotChecked` | Nyx has not checked a supported publisher signal. |
| `Checking` | A bounded publisher check is in progress. |
| `Current` | A tested publisher signal and the installed version agree. |
| `UpdateAvailable` | A tested publisher signal offers a newer live version. |
| `PreDownloadAvailable` | A tested publisher signal offers pre-download data. |
| `UpdateAndPreDownloadAvailable` | Both facts were independently observed. |
| `CheckInOfficialLauncher` | Nyx has no trustworthy remote signal for this game. |
| `CouldNotCheck` | The check failed, conflicted, was malformed, or became stale. |

Publisher failure never disables a locally validated `Launch`. A pre-download
offer, local staged data, and a completely verified staged download are three
different facts; Nyx must not collapse them into one claim.

## Session rules

The app-lifetime coordinator owns one independent state machine per canonical game
ID.

- Same-game requests serialize. Repeated clicks cannot dispatch a second copy.
- Different games have different locks and may start or run at the same time.
- A slow or failed game adapter cannot block another game's state or action.
- Initial state is `NeedsReview`; an adapter must explicitly report local
  `Ready`, `NotFound`, or `NeedsReview` evidence before Launch can be enabled.
- Each observation reports that local readiness beside `Present`, `Absent`, or
  `Uncertain` after checking its
  adapter-owned exact bootstrap and runtime executable identities. A process-name
  match is not enough.
- `Present` on either exact identity locks the game as `Running`. Bootstrap and
  runtime observations are remembered separately. A bootstrap-only absence is a
  handoff gap, not a closed game; runtime must appear before the handoff timeout.
- Normal closure requires a runtime `Present`, followed by two successful `Absent`
  samples from different observation generations and at least one configured
  confirmation interval apart.
- `Uncertain` resets an absence sequence and keeps `Starting` or `Running` locked.
- An externally started exact game process is detected as `Running` without Nyx
  dispatching another launch.
- Windows sleep/resume starts a new observation generation and clears pre-sleep
  absence samples. Prior exact runtime proof is retained, so two new time-separated
  absences can honestly detect a game that closed while Windows slept.
- Each resume event records a requested generation immediately. Requested and
  applied generations remain visible in the snapshot. A background worker waits
  behind in-flight same-game work and applies every pending generation; foreground
  work also applies a pending reset before observing or launching. The caller never
  waits indefinitely and a gate timeout cannot silently discard the reset.
- Every observation captures the requested resume generation before it awaits its
  adapter. Comparing that generation and applying the result is one atomic state
  operation. If resume was requested while the adapter was running, the old result
  is discarded and the reset is applied first; a pre-resume absence can never count
  toward post-resume closure.
- Dispatch is committed to `Starting` before entering adapter code. If cancellation,
  timeout, or an internal exception makes its result uncertain, the game stays
  locked for process reconciliation. A late non-cooperative dispatch can never
  authorize a second dispatch.
- Shutdown and dispatch admission share one atomic lock. If shutdown wins, an
  uncommitted dispatch cannot enter adapter code. If admission wins, `Starting` is
  committed and adapter entry occurs before shutdown can mark the coordinator
  stopped; that already-admitted dispatch remains subject to reconciliation.
- Resume requests use that same admission lock. Dispatch admission atomically
  rechecks the resume generation captured by its readiness/process observation.
  Resume-first rejects the stale launch evidence, enters no adapter, and applies the
  reset. Admission-first commits `Starting` and enters the adapter before the resume
  generation is ordered afterward.
- A definitive adapter `NeedsReview` result remains sticky; absence alone cannot
  silently turn it back into `Ready`.
- Adapter and same-game gate waits are bounded. Aggregate refresh returns other
  game results even when one asynchronous adapter never completes, and a timed-out
  observation is not overlapped by another observation for that game.
- Coordinator shutdown marks state stopped immediately, requests cooperative
  cancellation, ignores faulty cancellation callbacks, and rejects later actions.
  It cannot forcibly terminate adapter code or revoke a dispatch already entered.
- Only another explicit user Launch action may start a closed or failed game.

Crash reporters, publisher launchers, persistent anti-cheat helpers, and same-name
executables at other paths do not count as the game.

## Official-launcher handoff

Opening an official launcher is a separate, explicit user action. Nyx may select a
tested game page with fixed adapter-owned arguments, but must not click publisher
buttons, automate login, hide update work, or claim publisher progress as its own.

HoYoPlay is shared by `gi`, `hsr`, and `zzz`; its handoffs serialize as one launcher
family. WuWa and GRYPHLINK use separate family locks. Duplicate official-launcher
windows are avoided. Maintenance is conservatively blocked while its related game
is running unless later publisher evidence proves a narrower action safe.

## Read, write, process, and elevation rules

Allowed game-side reads are limited to installation records, existence and small
identity metadata, adapter-owned exact process identity, version records, and a
folder the user explicitly selects.

Nyx may write only its own settings, redacted diagnostics, validated pull and
achievement exports, generated content/cache files, its own package files, and
publisher-managed browser data inside Nyx-owned isolated WebView2 profiles. It
must not write game files, official-launcher files/settings, external browser
profiles, website account data, or Worker account data.

GI and HSR expose independent, persistent **Pull Tracker** and **Achievements**
arming controls. An armed job starts only after the user's Launch click. The
launcher uses fixed bundled providers, fixed Downloads subfolders, atomic output,
bounded in-memory capture, and redacted status events. ZZZ and WuWa retain sealed
provider slots but expose no working export action until their reviewed providers
are supplied. Export failure never changes launch or maintenance readiness.

Core session code has no Windows process, network, filesystem, updater, UI
automation, or elevation implementation. Real adapters remain separate and must
pass their own review.

The three enabled HoYo games have sealed Windows UAC fallbacks for their exact,
revalidated executables: `GenshinImpact.exe`, `StarRail.exe`, and
`ZenlessZoneZero.exe`. HSR/ZZZ enter that boundary only after a normal start
returns Windows error 740 and a third complete identity/path/process check passes.
These exceptions expose no generic game, path, argument, command, or launcher
elevation and are unavailable to official launchers and every other executable.

## Network and privacy

Desktop Core makes no network request. Infrastructure may use only fixed reviewed
publisher endpoints for maintenance signals, pull retrieval, WuWa resource status,
and app-owned publisher sessions. Transports use bounded timeouts and response
sizes, reject redirects and malformed data, and fail closed.

Desktop still makes no call to `/api/gacha/*` or `/api/account/sync/*`, does not
fake a browser `Origin`, and does not weaken the Worker allowlist.

Nyx embeds WebView2 only for a narrow publisher-account exception. HoYoLAB and
SKPORT use separate Nyx-owned profiles under the current user's Nyx data folder.
Each publisher is independently off by default. Ordinary launcher state stores
only its `true`/`false` consent bit and a non-sensitive cleanup-pending bit;
every connect, refresh, daily, disconnect, and official account-page action is
also checked inside the account service.
The user completes login, CAPTCHA, and account choice on the official page. Nyx
never attaches to Chrome/Edge profiles, asks for a password/cookie/token, or sends
publisher secrets to Pengo. Disconnect deletes only the selected publisher's Nyx
profile. Turning access off closes the in-memory gate first. Nyx then saves a
zero-byte, provider-only revocation marker before cleanup. The marker remains
until profile cleanup succeeds and the off state is durably saved, so a failed
settings write, interrupted deletion, or restart cannot silently reopen access.
Startup and a later opt-in retry pending cleanup before enabling the account
lane. A named cross-process lease prevents two Nyx processes from sharing or
deleting the same profile.

When one HoYo game exposes several roles, Nyx does not choose one. It opens a
transient picker with only a masked UID and plain region label, with no choice
preselected. The confirmed game/UID/server binding is stored only as
current-Windows-user DPAPI ciphertext under Nyx's publisher-profile root. It is
not written to launcher settings or logs, and it is cleared on reconnect,
profile/account replacement, disconnect, or account-access deletion.

The explicit **Daily** action may drive only the four compiled official check-in
pages for GI, HSR, ZZZ, and Endfield. WuWa has no guessed route. No scheduled or
startup check-in exists. Hidden page work is bounded, cancelable, publisher-gated,
and reports only honest claimed/already-claimed/login-needed/unavailable/failure
states. Resource cards are advisory and never alter local game readiness.

Nyx keeps pull authentication material, publisher cookies, and WuWa launcher
session material only in bounded memory while the fixed operation needs it. It
does not log, copy to clipboard, synchronize, or persist those values outside the
publisher-managed profile exception. It sends no automatic telemetry.

## Explicitly deferred

- Nyx-owned game download, patch, verification, repair, rollback, install, or uninstall
- Generic or caller-directed hidden publisher UI automation
- `Update All`
- Automatic game restart
- Background service or start-with-Windows behavior
- Scheduled/background daily check-in or automatic account switching
- WuWa daily check-in or Endfield numeric resource scraping
- ZZZ/WuWa/Endfield export providers until their reviewed slots are filled
- Desktop cloud sync of publisher sessions or secrets
- Public plugins, additional stores, regions, or installations
- Generic administrator or privileged-helper capability
- Production deployment

The isolated Genshin updater-v2 dry-run planner remains a non-mutating research
boundary. It does not relax this product contract or authorize real updates.

## Boundary gate

Before integration can be called complete, tests must prove:

1. Only the five canonical IDs exist in the coordinator.
2. Same-game double-click dispatches once; every different-game pair can overlap.
3. Exact bootstrap/runtime handoff, startup timeout, external running,
   time/generation-separated closure, durable sleep/resume, cancellation
   reconciliation, and atomic shutdown/resume/dispatch admission are deterministic.
4. One slow or failed adapter does not delay another game.
5. Initial readiness/`NotFound`, sticky launch review, bounded partial refresh, and
   faulty/non-cooperative adapter behavior fail closed.
6. No observation or status refresh starts a process or automatically restarts a game.
7. Publisher failure never changes a valid local launch state.
8. Core has no concrete process, network, filesystem, UI automation, updater, or
   elevation dependency.
9. Real adapters pass independent evidence and real-install gates one game at a time.
10. Website, Worker, legacy prototype, and production files remain unchanged.
11. GI/HSR export combinations are independent, atomic, importable, and secret-free.
12. Publisher profiles are isolated, single-process owned, publisher-scoped on clear,
    and cannot change Launch or maintenance state.
13. Daily check-in admits only the compiled exact-page catalog and repeated clicks
    create one bounded operation.
