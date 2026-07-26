# Nyx Desktop support matrix

Date: 2026-07-21

Status: private-build capability; each action remains enabled only where its evidence
gate has passed

## Shared product rule

Nyx launches games. Official launchers install, update, pre-download, verify,
repair, and remove them.

`Ready` describes only a validated local launch target. Publisher maintenance is a
separate status and may be unavailable without blocking Launch.

## Target matrix

| ID | Game | Direct launch | Exact session/close detection | Run beside other games | Publisher offer detection | Official maintenance handoff | Nyx direct update |
|---|---|---:|---:|---:|---:|---:|---:|
| `gi` | Genshin Impact | Enabled; real launch/relaunch pilot proven | Enabled; real close detection proven | Coordinator proven; real pair not user-piloted | Enabled: guarded HoYo signal | Enabled: validated argument-free HoYoPlay launch | No |
| `hsr` | Honkai: Star Rail | Enabled; real launch/relaunch pilot proven | Enabled; real close detection proven | Coordinator proven; real pair not user-piloted | Enabled: guarded HoYo live and pre-download signal | Enabled: validated HoYoPlay game page | No |
| `zzz` | Zenless Zone Zero | Enabled; real launch/relaunch pilot proven | Enabled; real close detection proven | Coordinator proven; real pair not user-piloted | Enabled: guarded HoYo live and pre-download signal | Enabled: validated HoYoPlay game page | No |
| `wuwa` | Wuthering Waves | Enabled; real launch pilot proven, explicit second-launch pilot not reported | Enabled; real close detection proven | Coordinator proven; real pair not user-piloted | `CheckInOfficialLauncher` | Enabled: exact read-only Registry32 hint, full-proof revalidation, and explicit visible Kuro-launcher action; live maintenance-start pilot pending | No |
| `ae` | Arknights: Endfield | Enabled; bounded auto-discovery and real launch pilot proven, explicit second-launch pilot not reported | Enabled; real close detection proven | Coordinator proven; real pair not user-piloted | `CheckInOfficialLauncher` | Enabled: saved-root full-proof revalidation and explicit visible zero-argument GRYPHLINK action; live maintenance-start pilot pending | No |

The pure Core coordinator is proven for all five IDs and all ten different-game
pairs with fakes. That proves isolation and concurrency logic, not a real
multi-game launch session. The private shell now exposes all five direct-launch
rows behind their independent local proof gates. WuWa and Endfield now have real
initial-launch and close-detection proof; explicit second launches were not reported.

## Account, daily, and export capabilities

| ID | Resource/account surface | Daily check-in | Pull export | Achievement export |
|---|---|---:|---:|---:|
| `gi` | Isolated HoYoLAB session; Original Resin card | Explicit **Daily** action | Enabled, armed on next Launch | Enabled, armed on next Launch |
| `hsr` | Shared isolated HoYoLAB session; Trailblaze Power card | Explicit **Daily** action | Enabled, armed on next Launch | Enabled, armed on next Launch |
| `zzz` | Shared isolated HoYoLAB session; Battery Charge card | Explicit **Daily** action | Provider slot only | Provider slot only |
| `wuwa` | Opt-in local Kuro launcher session; Waveplates/reserve/dailies | No verified page | Provider slot only | Provider slot only |
| `ae` | Isolated SKPORT session; official Protocol Terminal handoff | Explicit **Daily** action | Not supported | Not supported |

HoYoLAB and SKPORT profiles are Nyx-owned and separate from every external browser.
Both publisher account lanes are independently off by default; launcher settings
store only consent and non-sensitive cleanup-pending booleans. Turning one off
immediately blocks new work and cancels its in-flight work. A zero-byte,
provider-only revocation marker keeps it off across a failed settings save or
restart until only that publisher's Nyx profile is deleted. Startup and later
opt-in attempts retry unfinished cleanup before enabling access. Daily work is
user-started only. There are no local manual timers.

If HoYoLAB returns more than one role for the selected game, Nyx requires an
explicit choice. The picker starts with nothing selected and shows only masked UID
plus region. The selected binding is current-user DPAPI-protected outside ordinary
launcher state, and reconnect/disconnect/account or profile replacement clears it.

## Local status and actions

| Local status | Launch | Official maintenance |
|---|---:|---:|
| `NotFound` | Disabled | Enabled only for an independently validated official launcher |
| `NeedsReview` | Disabled | Enabled only when independently validated |
| `Ready` | Enabled | Enabled when independently validated |
| `Starting` | Disabled; accepted or uncertain dispatch is being reconciled | Disabled conservatively |
| `Running` | Disabled; exact bootstrap/runtime evidence is present | Disabled conservatively |
| `LaunchFailed` | Explicit retry | Enabled when independently validated |

After a confirmed close, state returns to `Ready`; UI copy may say **Session ended —
Launch again**. Nyx never automatically restarts a game.

## Publisher status and action

| Publisher status | Meaning | Local Launch effect |
|---|---|---|
| `NotChecked` | No supported check has run. | None |
| `Checking` | A bounded check is running. | None |
| `Current` | Tested publisher signal agrees with installed version. | None |
| `UpdateAvailable` | Tested publisher signal offers a newer live version. | None |
| `PreDownloadAvailable` | Tested publisher signal offers pre-download data. | None |
| `UpdateAndPreDownloadAvailable` | Both offers were observed. | None |
| `CheckInOfficialLauncher` | No trustworthy remote signal exists. | None |
| `CouldNotCheck` | Signal failed, conflicted, was malformed, or stale. | None |

The maintenance action always names the official launcher. It does not say Nyx
will update the game.

## Per-game evidence gate

Every row must independently prove:

| Case | Required result |
|---|---|
| Nothing installed | `NotFound`; no guessed path or error loop |
| Before first evidence | `NeedsReview`; Launch remains disabled |
| Normal fake install | One canonical match and separately validated game/updater targets |
| Moved install | Old location becomes `NeedsReview`; manually chosen location passes the same identity checks |
| Look-alike or same-name executable | Rejected unless exact adapter-owned identity is proven |
| Missing or changed target | `NeedsReview`; Launch disabled |
| Multiple matches | `NeedsReview`; no automatic selection or start |
| External exact runtime | `Running`; no launch dispatch |
| Bootstrap starts, briefly disappears, then runtime takes over | Continuous locked `Running`; gap tolerated until handoff timeout |
| One absent process sample, or two samples at the same time | Remains `Running` |
| Uncertain/inaccessible sample | Remains locked and resets close confirmation |
| Two generation/time-separated absent samples after exact runtime | Returns to readiness-derived idle state |
| Never observed after dispatch | `LaunchFailed` at the startup timeout; no automatic retry |
| Dispatch canceled or times out after adapter entry | `Starting` reconciliation lock; no duplicate dispatch |
| Adapter returns `NeedsReview` | Sticky `NeedsReview`; later absence does not clear it |
| Game closes during sleep | Two fresh spaced post-resume absences close it; no permanent `Running` |
| Resume arrives during an in-flight operation | Requested generation stays visible and pending; it applies after the game gate is released without blocking the caller |
| Pre-resume absence returns after resume was requested | Stale result is discarded atomically; it cannot close or count toward the two fresh post-resume absences |
| Resume arrives after readiness observation but before dispatch admission | Shared ordering lock rejects stale launch evidence; adapter entry count remains zero; reset is applied |
| Dispatch admission wins just before resume | `Starting` and adapter entry are committed first; resume generation is ordered and applied afterward |
| Shutdown overlaps dispatch admission | One atomic winner: shutdown-first enters no adapter; admission-first is already reconciliation-locked |
| Closed game | Explicit Launch is available; no automatic restart |
| Failed adapter | Only that game is affected |
| Official launcher missing | Local game may remain `Ready`; maintenance action disabled |

Calling a new row live-proven additionally requires a user-approved pilot on the
actual installation. Genshin, HSR, and ZZZ passed real launch, close detection, and
relaunch on 2026-07-15. WuWa and Endfield passed real initial launch and close
detection on 2026-07-15; explicit second launches were not reported. Endfield's
bounded automatic sibling discovery also has a real read-only pass and the rebuilt
App reports it Ready without folder selection.

## Concurrency gate

- Same-game repeated requests dispatch exactly once.
- All ten different-game pairs can enter launch concurrently.
- Running one game never disables a different game's Launch.
- A slow or failing probe does not hold a global lock.
- Switching the selected UI game does not discard other session states.
- HoYoPlay, the WuWa Kuro launcher, and Endfield's GRYPHLINK launcher use separate
  family admissions. Folder choice and GRYPHLINK maintenance block each other,
  while direct Endfield game Launch remains independent.
- Aggregate refresh is bounded when an asynchronous adapter hangs; completed game
  states are still returned.
- Resume requested/applied generations are independently observable; pending reset
  cannot be discarded by a same-game gate timeout.
- Coordinator shutdown requests cooperative cancellation and launches nothing
  afterward. It does not promise to stop non-cooperative adapter code or revoke an
  already-entered dispatch.

## Publisher evidence gate

HoYo availability adapters for `gi`, `hsr`, and `zzz` must cover live and
pre-download responses with frozen fixtures. Equal, newer, older, malformed,
missing, timeout, conflicting, and stale cases must fail honestly.

WuWa and Endfield remain `CheckInOfficialLauncher` until stable public publisher
signals and fixtures pass the same review. WuWa's executor repeats the entire
production validation and admits only the visible exact Kuro launcher. Endfield's
executor accepts only the saved-root service, repeats full protected validation,
and admits only the exact visible root GRYPHLINK Launcher.exe with zero arguments.
Neither visible-start pilot has run. Local version alone cannot prove either game
is current.

Only the sealed account providers may read the minimum session material needed for
their fixed operation, and only from the reviewed Kuro launcher cache or Nyx-owned
isolated WebView2 profiles. No adapter reads external browser profiles, asks for a
password/token, logs account material, or changes local launch readiness.

## Deliberately unsupported

| Area | Result |
|---|---|
| Nyx-owned download, patch, repair, verify, install, uninstall, or rollback | Use official launcher |
| Hidden/headless official-launcher maintenance UI control | Not supported |
| Automatic game restart | Not supported |
| `Update All` | Not supported |
| Scheduled/background daily check-in or automatic account switching | Not supported |
| Steam, Epic, Microsoft Store, China or unofficial editions | Do not guess |
| Multiple managed installations per game | Ask user to choose one later |
| Mods, command editing, public plugins | Not supported |
| ZZZ/WuWa/Endfield native export | Provider slots only; not exposed as working |
| Publisher-session cloud sync | Not supported |
| Generic administrator actions | Not supported |

The enabled Genshin, HSR, and ZZZ rows have sealed per-game UAC fallbacks for only
their exact repeatedly revalidated executables. They do not create a generic
elevation path for other games, arbitrary files, or official launchers.

## Release gate

The private multi-game launcher can be called supported only when:

1. every enabled row passes its full fake and user-approved real-install gate;
2. every different-game pair passes concurrency tests;
3. publisher failures leave local Launch unchanged;
4. accessibility and responsive UI gates pass;
5. tests and builds pass with no concrete process/network capability in Core;
6. no secrets appear in settings or diagnostics;
7. website, Worker, legacy, and production files remain unchanged;
8. no commit, push, package publication, or production deployment occurs without
   explicit approval.
