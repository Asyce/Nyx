# Desktop multi-game session foundation

Date: 2026-07-14

Task: `nyx-0055`

Status: implementation awaiting independent review

## Delivered boundary

`Nyx.Desktop.Core.Sessions` now contains a pure, app-lifetime coordinator for the
five canonical games. It does not know executable paths and cannot inspect or start
a real process. Every adapter observation atomically reports explicit local
readiness plus exact bootstrap/runtime evidence. Launch dispatch remains a separate
sealed adapter result.

The coordinator requires exactly one adapter for each of `gi`, `hsr`, `zzz`,
`wuwa`, and `ae`. Unknown aliases, missing adapters, and duplicate adapters are
rejected.

## State decisions

- Each game owns one semaphore and one immutable snapshot.
- Different games never share an operation semaphore.
- Initial local readiness is `Unknown`/`NeedsReview`. An explicit adapter observation
  is required to reach `Ready`, `NotFound`, or evidence-backed `NeedsReview`.
- An explicit launch performs a fresh readiness and exact-process observation.
- `Present` prevents a duplicate dispatch and records `Running`.
- `Uncertain` prevents dispatch and records or preserves a fail-closed state.
- Dispatch commits `Starting` before adapter entry. Accepted dispatch remains
  `Starting`; cancellation, timeout, exception, or internal cancellation after entry
  keeps a `LaunchOutcomeUncertain` reconciliation lock.
- Bootstrap and runtime observations are distinct. Bootstrap-only `Running` tolerates
  an absent handoff gap; runtime must appear before the handoff timeout.
- Startup becomes `LaunchFailed` only after the configured timeout is reached and a
  successful `Absent` sample is observed, and only when no non-cooperative dispatch
  remains outstanding.
- Normal closure requires exact runtime proof and two successful absence samples
  from different observation generations separated by the configured time interval.
- `Present` or `Uncertain` resets the absence count.
- Resume resets absence evidence and starts a new generation while retaining prior
  exact runtime proof. Two fresh spaced absences can therefore resolve a game that
  closed during sleep instead of leaving permanent `Running`.
- Resume records requested and applied generations in the public snapshot. Its
  caller returns immediately; a durable per-game worker waits behind in-flight work,
  while any foreground winner applies the pending reset before acting. Multiple
  pending resume events advance the observation generation once per request.
- An observation captures the requested resume generation before entering its
  asynchronous wait. Generation comparison and evidence application share the same
  state lock. A resume request that wins that lock makes the older result stale; it
  is discarded and the pending reset is applied before any later evidence.
- A definitive launch `NeedsReview` is sticky across absence and blocks redispatch.
- Adapter/gate waits are bounded. A timed-out observation is not overlapped, and one
  asynchronous non-cooperative adapter cannot starve `RefreshAllAsync`.
- Refresh, resume, and shutdown contain no launch dispatch. There is no automatic
  restart route.
- Shutdown marks all snapshots stopped, rejects later launch requests, and requests
  cooperative cancellation through a fault-contained asynchronous path. It does not
  forcibly stop adapter code or undo a dispatch that was already entered.
- A single admission lock makes shutdown atomic with the commit-and-enter portion of
  dispatch. Shutdown-first performs zero adapter entries. Admission-first commits
  `Starting`, enters the adapter, and only then allows shutdown to proceed.
- Resume requests also acquire the admission lock. Admission compares the current
  requested resume generation with the generation captured immediately before its
  readiness/process observation. Resume-first makes the evidence stale, produces
  zero adapter entries, and applies the reset under the held game gate.
  Admission-first commits `Starting` and enters adapter code before resume can
  increment the requested generation.

## Separate maintenance contract

`GameOperationalSnapshot` holds a local `GameSessionSnapshot` beside an independent
`PublisherMaintenanceSnapshot`. The session coordinator does not change publisher
state. A future publisher adapter cannot use a network error to make a validated
local game unlaunchable.

## Capability boundary

This batch adds no App or Infrastructure wiring. The Sessions namespace exposes no
concrete Windows process, filesystem, HTTP, updater, UI automation, or elevation
type. The adapter interface is a dependency boundary only; actual adapters remain
future, separately reviewed work.

The existing Genshin launcher, its sealed UAC behavior, updater-v2 planner, UI,
website, Worker, and legacy prototype are unchanged.

## Focused proof

The focused suite covers:

- all five canonical IDs and alias rejection;
- initial `Ready`, `NotFound`, and `NeedsReview` evidence;
- missing and duplicate adapter rejection;
- all ten different-game pairs starting concurrently;
- same-game double-click dispatching once;
- bootstrap-to-runtime handoff with an absent transition gap and handoff timeout;
- never-observed startup timeout;
- generation/time-separated absence confirmation and uncertainty reset;
- external running detection before launch;
- resume plus close-during-sleep resolution;
- close followed by explicit relaunch, with no automatic restart;
- pre-dispatch caller cancellation, post-entry reconciliation, internal cancellation,
  non-cooperative dispatch locking, and coordinator shutdown;
- sticky launch review and throwing cancellation callbacks;
- bounded aggregate refresh with a never-completing observation;
- deterministic shutdown-before-admission overlap with zero launch dispatch;
- durable, observable resume requested during an occupied game gate;
- stale pre-resume second absence discarded, followed by exactly two fresh spaced
  post-resume absences before closure;
- deterministic resume-first and dispatch-admission-first ordering around a paused
  pre-admission boundary;
- slow-probe and failing-probe isolation;
- independent local and publisher status contracts;
- absence of concrete process, network, filesystem, and elevation types from the
  public Sessions boundary.

No test starts a process, requests UAC, calls a network, or reads/writes a game or
publisher folder.

## Integration risks for review

1. Real adapters must prove exact paths across bootstrap handoffs, crash reporters,
   anti-cheat helpers, and launcher-owned child processes.
2. The application refresh loop must avoid overlapping same-game polls and must
   call the resume reset on the real Windows resume event.
3. Cancellation is advisory. A non-cooperative asynchronous call is bounded from
   the coordinator's caller and its late result is ignored, but the underlying code
   may continue. A dispatch that never completes remains locked rather than risking
   a duplicate. Adapter methods must return their `ValueTask` promptly; a method
   that blocks synchronously before returning violates the contract and cannot be
   forcibly stopped by Core.
4. The Genshin integration must wrap, not widen, the existing sealed UAC exception.
5. UI selection state must not become session ownership; unselected games must keep
   refreshing and showing badges.
6. The 32-bit .NET host makes a plain solution build select `win-x86`, while the
   current App restore metadata contains the intended `win-x64` target. This
   pre-existing App-project metadata issue is outside nyx-0055. The verified gate is
   the explicit App command `-r win-x64 -p:Platform=x64`; App packaging should later
   make runtime metadata deterministic.

## Next action

An author-independent verifier must rerun focused and full gates. A separate
reviewer must challenge concurrency, exact-evidence semantics, cancellation,
fail-closed behavior, and the revised product wording before any App or
Infrastructure integration begins.
