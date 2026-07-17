# Desktop Genshin session integration

Date: 2026-07-15  
Task: `nyx-0060`

## Result

The desktop app now owns one five-game `GameSessionCoordinator` for the whole
window lifetime. Genshin uses the production adapter. HSR, ZZZ, WuWa, and
Endfield use capability-free fail-closed adapters until their direct-launch
batches pass their own pilots.

The practical behavior is:

1. Nyx checks the official Genshin install and exact signed executable through
   the existing discovery and inspection boundaries.
2. Nyx reports `Running` only when `WindowsRunningProcessInspector` finds the
   exact expected executable path. A name-only or unreadable process is
   uncertain and keeps Launch locked.
3. An explicit Launch click enters the shared coordinator. The adapter repeats
   official discovery and inspection, then calls the existing
   `GenshinLaunchService`.
4. `GenshinLaunchService` still owns the exact argument-free direct start and
   its narrow Genshin-only `runas` fallback. This batch added no generic process
   or elevation path.
5. A two-second, non-overlapping observer watches session state. After exact
   runtime proof, closure still needs the coordinator's two time-separated
   absence samples. Closure changes the button back to Launch; it never starts
   the game automatically.
6. Window activation requests a resume reset before a fresh observation. This
   discards stale pre-resume absence evidence.
7. Window close first stops refresh and shuts down the coordinator, so no new
   launch can be admitted.

An unavailable discovery record is not proof that the executable stopped.
When the registry candidate disappears or a not-yet-enabled game cannot inspect
its exact process, the adapter reports process evidence as `Uncertain`, never
`Absent`. Therefore a previously proven running game stays locked instead of
being falsely treated as closed.

Refresh shutdown is also a publication barrier. `Stop` waits for any event
publication already admitted and prevents every later publication. Disposal
drains periodic, manual, and activation refresh calls before releasing its
lifetime resources. MainPage continuations and queued dispatcher callbacks use
generation-bound UI leases; page unload or window close invalidates the lease
and waits for any already-admitted mutation.

Page invalidation is lease-scoped. If page B activates before a delayed unload
from page A, A can cancel only A's lease and cannot invalidate B. Refresh event
handlers and queued callbacks keep their own page instance lease rather than
borrowing whichever lease is globally current. Window close uses a separate
terminal invalidation that cancels the current lease and permanently rejects a
new one.

Every public refresh call is counted atomically before its first stopped check
or gate wait. Stop closes that admission point. Concurrent, repeated disposal
shares one disposal task and waits until the admitted-call count reaches zero,
including a caller paused before the refresh gate. Only then is the cancellation
lifetime disposed.

## Game and maintenance separation

The game Launch button uses only `RequestLaunchAsync("gi")`.

The HoYoPlay row remains a different, explicit action. It still validates and
opens the official launcher through `LaunchUpdater`. A game launch failure does
not call that action and cannot silently open HoYoPlay.

The former page-wide `actionInFlight` flag is gone. Game launch and official
maintenance have separate in-flight state. Same-game repeat clicks are still
serialized by the coordinator, while the coordinator retains independent locks
for all five canonical game IDs.

## Failure mapping

| Existing Genshin result | Coordinator dispatch result | UI effect |
|---|---|---|
| `Running` | `Accepted` | Starting until exact runtime is observed |
| `LaunchFailed` | `Failed` | Launch failed; explicit retry remains possible |
| UAC cancelled (`1223`) | `Failed` + preserved reason | Approval cancelled; explicit retry only |
| Identity/process ambiguity | `NeedsReview` | Launch locked |
| Missing current discovery at dispatch | `NeedsReview` | Launch locked; stale path is not used |

## Boundaries

- No game or official launcher was started during implementation or tests.
- No UAC prompt was shown.
- No network request was made.
- No registry, game-folder, or user-data write was made.
- The periodic observer has no launch method and never calls
  `RequestLaunchAsync`.
- Unsupported game adapters inspect nothing, start nothing, and never claim
  exact process absence.
- Publisher update/pre-download signals remain independent of local session
  state.

## Verification

Author checks completed before review:

- New adapter, refresh-pump, and UI-lifetime tests: 28 passed.
- Genshin plus shared Sessions focus: 190 passed.
- Full Desktop suite: 470 passed.
- Core, Infrastructure, and App win-x64 Release builds: 0 warnings, 0 errors.
  The App gate uses `-p:PublishTrimmed=false` because this unpackaged build is
  not self-contained.
- Formatting for every `nyx-0060` source/test file: clean.
- Capability scan found no direct process, elevation, registry, network, or
  updater execution API in the new Sessions adapter/pump paths.
- Personal-path scan: clean.
- Queue JSON: valid, with `nyx-0060` in `needs-review`.
- Whole-solution format currently reports an unrelated pre-existing whitespace
  finding in `Updating/GenshinUpdatePlannerTests.cs`; this task did not edit it.
