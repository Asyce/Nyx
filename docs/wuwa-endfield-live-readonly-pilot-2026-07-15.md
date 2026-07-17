# WuWa and Endfield live read-only pilot

Date: 2026-07-15

## Outcome

A reusable Windows command-line pilot now runs the production WuWa or Endfield
identity adapter against one explicit local root and emits one bounded JSON result.
It retains no root, launcher path, executable metadata, configuration contents,
account data, cache data, or log data.

The pilot has no process-start, shell, network, registry, write, update, repair,
elevation, or game-file mutation capability. Targeted public uninstall records were
used outside the pilot only as disposable locator hints. They were not accepted as
identity proof and are not persisted here.

## Sanitized live results

| Game | Status | Reason | Version state | Full-install maintenance proof | Direct launch allowed |
| --- | --- | --- | --- | ---: | ---: |
| Wuthering Waves | `NeedsReview` | `VersionConflict` | `Conflict` | Yes | No |
| Arknights: Endfield | `NotFound` | `DirectoryNotFound` | `Unavailable` | No | No |

The WuWa result matches the earlier sanitized adapter evidence: the signed launcher,
bootstrap, runtime, and bounded public configuration/resource evidence form one
validated installation, but the two public version signals disagree. That proof is
sufficient input for a separately reviewed visible official-launcher executor. It
is not direct-game-launch authorization and does not prove the local game is current.

The Endfield uninstall record is stale: its proposed root is absent. Nyx therefore
has no live Endfield installation evidence and must keep both direct launch and
official-launcher execution disabled until a real root is available and passes the
same production adapter.

## Tool boundary

The command accepts exactly:

```text
Nyx.Desktop.ReadOnlyPilot --game <wuwa|ae> --root <install-root>
```

Only exact `wuwa` and `ae` IDs are accepted. Missing, duplicate, unsupported,
unlabelled, blank, or oversized input fails before adapter entry. Successful output
contains only game ID, status, reason, version state, optional strict version,
full-install-maintenance-proof, direct-launch-allowed, and `ReadOnly=true`.

## Verification

- Focused pilot plus WuWa/Endfield identity tests: 106/106 passed.
- Full Desktop Release tests: 636/636 passed.
- Pilot Release build: zero warnings and errors.
- Core, Infrastructure, and App win-x64 Release builds: zero warnings and errors.
- Scoped format, capability, personal-path, and queue JSON checks passed.
- Production live reads produced only the two sanitized rows above.
- No game, official launcher, UAC prompt, network request, registry write,
  game-folder mutation, private cache/log read, UI automation, deploy, commit, or
  push occurred.

Independent security/privacy review and independent verification are CLEAN.
