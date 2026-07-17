# Nyx Desktop multi-game launcher plan

Date: 2026-07-14

Status: approved for staged implementation

## Outcome

Build a private Windows 11 launcher for five existing Global installations:

- Genshin Impact (`gi`)
- Honkai: Star Rail (`hsr`)
- Zenless Zone Zero (`zzz`)
- Wuthering Waves (`wuwa`)
- Arknights: Endfield (`ae`)

Nyx launches and watches games. Official launchers install, update, pre-download,
verify, repair, and sign in. The interface must keep those responsibilities visible.

## Product behavior

Each game has two independent rows:

1. **Local game** — discovery, launch readiness, starting, running, ended, or failed.
2. **Publisher maintenance** — current, update offered, pre-download offered,
   check failed, or check in the official launcher.

A failed remote check never disables a valid local Launch. A publisher offer never
means Nyx downloaded or installed anything.

The app maintains five simultaneous session state machines. Different games can
run together. The same game cannot be dispatched twice. When an observed game is
confirmed closed, its Launch action becomes available again; Nyx does not restart
it automatically.

## Architecture

```text
WinUI shell
  -> application coordinator
     -> local discovery and validated targets
     -> five-game session coordinator (pure Core)
        -> one exact-evidence adapter per game
     -> publisher maintenance coordinator
        -> reviewed public publisher signal, when supported
        -> official-launcher family handoff
```

Rules:

- UI receives state and commands, not raw process, registry, or network APIs.
- Game IDs are exactly `gi`, `hsr`, `zzz`, `wuwa`, and `ae`.
- Exact executable identity comes from each game adapter; names alone never count.
- Same-game locks are independent from other games and from publisher-family locks.
- No maintenance action occurs during direct game launch.
- Core contains no concrete Windows, network, filesystem, updater, automation, or
  elevation implementation.

## Session foundation

The shared Core coordinator is the first implementation batch.

```text
Ready -> Starting -> Running -> Ready
           |            |
           v            +-- two exact Absent samples after observed Present
      LaunchFailed
```

- Initial state is `NeedsReview`; explicit adapter readiness evidence is required
  before local state becomes `Ready` or `NotFound`.
- An explicit Launch request first checks readiness and an already-running exact process.
- Dispatch is committed to `Starting` before adapter entry. Accepted dispatch stays
  `Starting`; canceled, timed-out, or internally canceled dispatch stays locked for
  reconciliation instead of pretending no launch occurred.
- Bootstrap and runtime `Present` samples are tracked separately. Bootstrap-only
  absence is tolerated as a handoff gap until the startup timeout.
- `Uncertain` is fail-closed and resets close confirmation.
- Runtime closure needs two observation-generation and time-separated absences.
- A bounded startup timeout becomes `LaunchFailed` if runtime never appears, unless
  a non-cooperative dispatch is still outstanding; that remains locked.
- External exact processes are recognized at startup or refresh.
- Resume discards pre-sleep absence samples but retains prior exact runtime proof,
  allowing two new spaced absences to detect a close during sleep.
- Resume requests are durable and observable through requested/applied generations.
  They return immediately, wait behind in-flight per-game work in the background,
  and are also applied by the next foreground operation if it arrives first.
- Observation results are generation-stamped. A result that began before a newly
  requested resume reset is discarded atomically, so only fresh post-resume absence
  samples can close a session.
- Per-adapter waits are bounded, so aggregate refresh returns partial honest states.
- Shutdown marks state stopped and requests cooperative cancellation. It permits no
  later action but does not claim to terminate adapter code or undo entered dispatch.
- Shutdown and dispatch admission are one atomic decision: shutdown-first means no
  adapter entry; admission-first means `Starting` and adapter entry are already
  committed before shutdown proceeds.
- Resume generation ordering shares the same admission boundary. Readiness evidence
  captured before resume cannot authorize a later dispatch: resume-first rejects it
  with zero adapter entries, while admission-first is fully committed before the
  reset is requested.

## Publisher maintenance plan

### HoYo games

Genshin, HSR, and ZZZ may use separately tested HoYo public branch signals for
live-version and pre-download availability. Each adapter must reject malformed,
conflicting, downgraded, or stale responses. Package data is not trusted merely
because it exists.

HoYoPlay remains responsible for the actual work. An explicit maintenance action
opens the exact tested game page. Nyx does not hide HoYoPlay or click its controls.

### WuWa and Endfield

Until a stable, reviewed public Kuro or GRYPHLINK signal is proven, Nyx shows
`CheckInOfficialLauncher`. It must not infer currency from local version alone.
The explicit action opens the separately validated official launcher.

### Pre-download wording

Nyx distinguishes:

1. publisher offers a pre-download;
2. staged data exists locally;
3. every staged file is verified complete.

Only independently proven facts are shown. HSR's known 4.3-to-4.4 offer becomes a
frozen parser fixture, not a permanent product assumption.

## Multi-game and launcher-family concurrency

- One lock per canonical game serializes discovery, launch, and its state change.
- Every different-game pair may start and run together.
- A slow or failing adapter cannot hold a global lock.
- HoYoPlay handoffs share one family lock across `gi`, `hsr`, and `zzz`.
- WuWa and GRYPHLINK handoffs have independent locks.
- Nyx avoids duplicate official-launcher windows.
- Related maintenance is blocked while a game is running unless later publisher
  evidence proves a specific safe exception.

## Interface direction: The Iris

The current shell needs a stronger launcher composition, not more dashboard cards.
Use the Pengo/Nyx painting as an edge-to-edge environment and the Nyx eye as the
selected game's visual aperture.

- Large 88–104 px game artwork with no icon containers.
- Vertical game rail on wide windows; reachable horizontal scrolling on compact ones.
- Running, update, and pre-download marks remain visible on unselected games.
- Selected game controls the hero artwork and status copy.
- Nyx eye and wordmark are prominent, not small utility marks.
- One clear Launch control; official maintenance is smaller and explicitly labeled.
- Frameless custom title area while preserving Windows-owned caption buttons,
  dragging, snapping, resizing, keyboard controls, and accessibility.
- No gold. Use near-black, moon-white, ultraviolet iris, mist, and restrained teal.
- Motion is restrained and has a reduced-motion equivalent.

Required persistent copy:

> Unofficial Nyx launcher
>
> Nyx launches the game. Updates, repairs, and installs happen in the official launcher.

Responsive review sizes: `390x844`, `760x540`, `901x713`, `1280x720`,
`1600x900`, `2560x1080`, and `3440x1440`, at 100%, 150%, and 200% scaling.

## Execution batches

### 1. Contracts and pure session coordinator

Revise the boundary and support matrix. Add the five-game Core coordinator,
explicit readiness contracts, exact bootstrap/runtime evidence, bounded adapter
calls, timeout, separated close confirmation, resume reset, dispatch reconciliation,
safe shutdown, and focused concurrency/fault tests.

Gate: every canonical ID and different-game pair passes; no integration capability
is introduced.

### 2. Application integration with Genshin

Wrap the existing sealed Genshin validation and launch service behind the new
session adapter. Replace page-global action gating with per-game state. Add an
app-lifetime refresh loop while preserving a normal-user launcher and sealed,
per-game UAC boundaries. The later real pilot extended the same fail-closed shape
to exact HSR/ZZZ executables after both returned Windows error 740.

Gate: current Genshin direct-launch tests stay green; an already-running real
Genshin is recognized; closing it safely re-enables Launch.

### 3. Game evidence adapters

Implement in order: HSR, ZZZ, WuWa, Endfield. For each, document signed targets,
install identity, exact bootstrap/runtime paths, official launcher, and fixed page
arguments before enabling actions.

Gate per game: fake normal/moved/missing/look-alike/ambiguous installs; external
running; bootstrap handoff; close detection; failed launch; user-approved real
read-only pilot.

### 4. Publisher monitoring

Implement bounded, publisher-specific availability adapters. Start with frozen
HoYo response fixtures, then guarded live reads. Keep WuWa and Endfield honest when
no reliable signal exists.

Gate: equal/newer/older/malformed/timeout/conflict/stale cases; remote failure never
changes local Launch; no credentials or private cache reads.

### 5. Official-launcher handoff

Add exact validated publisher targets, tested game-page arguments, family locks,
duplicate-window avoidance, and explicit responsibility wording.

Gate: no hidden UI control, coordinate click, login automation, generic elevation,
or claimed publisher progress.

### 6. Iris shell

Build a static responsive shell with real state fixtures, review it at every target
size and scale, then connect the coordinators. Preserve keyboard order, focus,
screen-reader names, high contrast, and reduced motion.

Gate: no clipped game, unreachable icon, title collision, blank hero, wrapped
primary title, or hidden maintenance responsibility.

### 7. Real-install pilots

With user approval, test each game and every different-game pair. The user owns
publisher login and any UAC approval. A failed row stays unsupported without
affecting proven rows.

## Required verification

- Same-game double-click dispatches once.
- All ten different-game pairs overlap successfully.
- Initial readiness and `NotFound` come from explicit adapter evidence.
- Bootstrap-to-runtime handoff and its temporary absence gap never report a false close.
- Never-observed startup times out without retry.
- One or two same-time absent samples cannot close; uncertainty resets confirmation.
- Closure requires runtime proof plus generation/time-separated absences.
- Startup recognizes an externally running exact path.
- Resume can resolve a game closed during sleep without permanent `Running`.
- A resume event requested during in-flight work remains pending and is eventually
  applied as a fresh, observable generation without blocking the caller.
- A paused pre-resume second absence released afterward is discarded; exactly two
  new spaced post-resume absences are still required to close.
- Cancellation before dispatch is canceled; cancellation after dispatch entry is
  reconciliation-locked. Internal `OperationCanceledException` is not mislabeled.
- A deterministic shutdown/admission overlap proves shutdown-first dispatch count is zero.
- Deterministic resume/admission tests prove resume-first dispatch count is zero and
  admission-first dispatch is committed before its reset generation.
- Hanging asynchronous adapters cannot starve aggregate refresh or duplicate dispatch.
- Throwing cancellation callbacks cannot escape shutdown; shutdown remains advisory.
- Close enables explicit relaunch and never auto-restarts.
- Slow and failing adapters remain isolated.
- Publisher and local statuses cannot overwrite each other.
- No game, launcher, UAC prompt, network, or game folder is touched by Core tests.
- Full tests, Release build, x64 build, diff check, path check, independent verifier,
  and concurrency/security review pass before integration.

## ELI5

Every game gets its own light switch. Genshin can be on while Star Rail is on.
Nyx watches each light separately and makes sure it is really off before enabling
the switch again. The game's real launcher is still the mechanic: it downloads and
fixes the game, and Nyx clearly sends you there when that work is needed.
