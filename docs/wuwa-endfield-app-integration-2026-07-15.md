# WuWa and Endfield App integration - 2026-07-15

## Outcome

The private Nyx App now connects Wuthering Waves and Arknights: Endfield to the
reviewed protected launch/session engine. Both rows can show local Ready, Starting,
Running, confirmed-close, failure, and relaunch state without weakening the three
existing HoYo rows.

## Discovery

- WuWa receives only one bounded root hint from the exact 32-bit HKLM Wuthering
  Waves uninstall record. Registry values are not launch proof.
- Endfield uses one user-chosen GRYPHLINK root stored under one fixed package-local
  setting key.
- The Endfield setting accepts only one canonical local drive path. Relative,
  remote, device, malformed, non-canonical, and oversized values are rejected and
  cleared.
- Nyx does not scan drives and does not trust Endfield's stale uninstall record or
  shortcuts.

## Folder choice and launch

- Endfield exposes a visible, accessible Choose/Change Folder action.
- The WinUI folder picker is owned by the Nyx window.
- A selected folder passes the complete sealed Endfield identity check before it
  can be saved. Cancellation saves nothing and starts nothing.
- Picker results carry a page generation. Cancellation, page unload, or a newer
  choice makes older work stale before it can save or clear settings.
- A later screen-refresh failure does not relabel an already verified and saved
  folder as invalid.
- The saved value remains only a hint. Periodic observation and every launch
  dispatch repeat the complete protected identity proof.
- All five game rows use the shared coordinator, so one running game does not
  disable another game's Launch. Repeated clicks are suppressed only for the same
  game.

## Honest maintenance and version state

WuWa direct Launch and its existing visible official-launcher maintenance action
remain separate. Endfield plainly says GRYPHLINK handles updates, pre-downloads,
verification, and repairs; this batch adds no Endfield launcher execution. Neither
WuWa's conflicting local labels nor Endfield's unavailable public version becomes
a current/update claim.

## Author verification

- Initial focused locator, settings, picker, UI, and session Release tests: 77/77
  passed. Final broader integration: 78/78. Final focused folder-policy/UI
  review-fix tests: 21/21 passed.
- Full Desktop Release tests: 875/875 passed.
- Core, Infrastructure, read-only Pilot, and App win-x64 Release builds: zero
  warnings and zero errors.
- Targeted format, XAML parse, whitespace, hardcoded-drive, scan, shell/start, and
  forbidden-capability gates: clean.
- Repository-wide formatting reports only pre-existing unrelated formatting in
  `GenshinUpdatePlannerTests.cs`.
- No real app, game, official launcher, UAC prompt, network request, restore,
  deploy, commit, or push occurred.

## Next action

After independent review and verification, rebuild and inspect Nyx, choose the real
GRYPHLINK root, then ask the user to pilot launch, close detection, and relaunch for
WuWa and Endfield. Endfield's visible official maintenance handoff is a separate
reviewed batch.

## Closure

Independent lifecycle/security/UI review is CLEAN after three findings were fixed:
stale picker persistence, refresh-failure truth, and game-specific failure copy.
Independent final verification passes policy/UI 21/21, broader integration 78/78,
full Desktop 875/875, and all four Release builds with zero warnings/errors.
XAML/XML 5/5 and format, public-surface, path/scan/shell/argument/process,
whitespace, diff, queue, and source-stability gates are clean.

## User pilot

USER PILOT PASS 2026-07-15: Wuthering Waves and Arknights: Endfield each opened
from Nyx, closed normally, and were correctly detected as closed. This proves real
direct launch and close detection for both rows. An explicit second launch and the
two official-maintenance start actions were not reported in this pilot.
