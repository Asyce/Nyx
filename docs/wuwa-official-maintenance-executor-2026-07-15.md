# WuWa official-maintenance executor boundary

Date: 2026-07-15

Status: complete; independent security/concurrency review and verification passed;
no App/UI locator or live launcher start is wired

## Outcome

Nyx can now admit exactly one visible Wuthering Waves official-launcher handoff after
a complete production identity proof. This is not a WuWa game launch and it is not
an updater. Kuro's launcher remains responsible for install, update, pre-download,
verify, repair, and removal.

The public executor accepts only the existing sealed
`OfficialMaintenanceHandoffRequest`. External callers cannot supply a game ID,
root, executable path, argument, command, URL, protocol, shell option, elevation
verb, window mode, or fallback. Endfield handoffs are rejected as unsupported.

## Fresh admission

The handoff's first proof is only a locator and comparison input. Every `Check` or
`Open` immediately runs the complete production `WuWaIdentityAdapter` again against
that exact canonical root. Admission requires all of the following to match the
first proof:

- exact `wuwa` game identity;
- canonical root;
- root `launcher.exe` path;
- strict four-part Kuro launcher version;
- fixed maintenance instructions;
- empty argument collection and every maintenance-only denial flag.

The repeated validation still requires the root and versioned signed Kuro launchers,
byte equality, signed bootstrap and runtime, both strict matching configs, one exact
resource-manifest runtime record, local fixed NTFS storage, and the existing
no-reparse/path/file-identity checks. `Ready/None` and
`NeedsReview/VersionConflict` are the only accepted full-proof states. Version
conflict permits only the official maintenance handoff; direct WuWa game launch and
direct update remain false.

Missing, partial, ambiguous, unsafe, changed, or inaccessible roots cannot mint or
refresh an executable request. A first/fresh root, launcher path, launcher version,
game, instruction, or argument mismatch fails closed.

## Protected lifetime

The adapter's normal read-only `Inspect` still disposes all handles before returning.
The executor uses an internal disposable inspection lease instead. It retains the
root and versioned launcher, bootstrap, runtime, and ancestor-directory bindings
through strict process observation, a final complete stability pass, and the exact
starter call. The final pass repeats executable metadata/file identity and bounded
configuration/resource fingerprints before process admission.

This lifetime is internal and cannot be turned into a durable public token. Tests
prove that write opens against the protected launcher, bootstrap, and runtime are
blocked inside the starter admission callback and become possible only after the
executor returns.

## Process and concurrency boundary

The executor observes only process name `launcher` plus the exact freshly validated
root launcher path. Exact-path presence returns `Running`. A different-path
same-name process, inaccessible path, ambiguous process inspection, or inspection
exception returns `NeedsReview`; no start occurs.

The production starter creates exactly one `ProcessStartInfo`:

- file: the freshly validated root `launcher.exe`;
- working directory: the same validated root;
- arguments: none;
- `UseShellExecute=false`;
- `CreateNoWindow=false`;
- normal visible window style;
- no verb, protocol, URL, elevation, update command, direct-game target, or fallback.

Kuro uses one process-wide production family admission shared by every executor
instance. A concurrent same-family `Open`, including one from a separately created
executor object, returns `Busy`. An observing caller may wait for the current family
action and then re-check without dispatching. Cancellation while waiting or before
dispatch never starts a process and releases the admission exactly once. Internal
constructors retain an injectable admission for isolated deterministic tests. The
production admission is independent from HoYoPlay; GRYPHLINK/Endfield execution
remains absent.

## Verification

- Focused executor, identity, and handoff Release tests: 95/95 passed.
- Full Desktop Release tests: 685/685 passed with zero skipped.
- Core, Infrastructure, Pilot, and App win-x64 Release builds: zero warnings and
  errors.
- Scoped formatter verification passed; the solution loader emitted its existing
  non-failing workspace warning.
- Capability/privacy/path/public-surface, queue JSON, docs, handoff, and
  diff-whitespace gates passed.

All tests use disposable fake roots and fake process boundaries. No real game,
official launcher, UAC prompt, network, registry, personal install root, restore,
or UI automation was touched.

## Deliberately unresolved

- App/UI discovery and button wiring;
- a separate explicit live visible-start pilot;
- Endfield execution;
- WuWa direct game launch, session observation, or direct update;
- hidden/headless behavior, automation, packaging, commit, push, or deployment.
