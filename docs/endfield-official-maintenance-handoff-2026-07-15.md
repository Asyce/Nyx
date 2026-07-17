# Endfield official maintenance handoff - 2026-07-15

## Outcome

The private Nyx App now has a separate visible `OPEN GRYPHLINK` action for
Arknights: Endfield maintenance. Nyx does not update, pre-download, verify, or
repair the game itself, and it does not hide or automate GRYPHLINK.

## Boundary

- The service accepts only Nyx's fixed Endfield local-root store. It accepts no
  caller path, game ID, executable, arguments, URL, protocol, or command.
- The saved root is only a hint. Check and click repeat the complete Endfield
  identity proof.
- The executor keeps protected file bindings alive, recreates a sealed `ae`
  maintenance handoff, and compares every fixed target field.
- Only the exact signed root `Launcher.exe` and the exact `Launcher` process path
  can be observed or started.
- Start is visible, zero-argument, non-shell, non-elevated, and uses the exact
  launcher directory. There is no error-740 fallback.
- GRYPHLINK has its own admission gate, separate from HoYoPlay, WuWa's launcher,
  and direct game Launch.

## App lifecycle

The action is explicit-click only. Repeated clicks produce at most one dispatch.
Folder choice and GRYPHLINK maintenance are mutually exclusive through one
generation-safe admission gate, while direct game Launch remains independent.
Activation refresh, selection switching, and page unload are generation-bound so
old work cannot publish state or release a newer action. A GRYPHLINK failure does
not change a separately proven local Endfield session.

## Author verification

- Initial focused executor, service, and UI lifecycle Release tests: 41/41 passed.
  Final focused action-gate/UI tests: 33/33 passed.
- Full Desktop Release tests: 902/902 passed.
- Core, Infrastructure, read-only Pilot, and App win-x64 Release builds: zero
  warnings and zero errors.
- Targeted format, XML/XAML, whitespace, precise capability, diff, and source-hash
  gates: clean.
- No live app, game, official launcher, UAC prompt, network request, restore,
  deploy, commit, or push occurred.

## Next action

After independent review and verification, rebuild and inspect Nyx. The user can
then pilot the visible GRYPHLINK action separately from the WuWa/Endfield game
launch, close, and relaunch pilots.

## Closure

Independent security/lifecycle/UI review is CLEAN after the folder-choice versus
maintenance cross-action race was closed with one reciprocal generation-safe gate.
Independent final verification passes focused 33/33, full Desktop 902/902, and all
four x64 Release builds with zero warnings/errors. Exact visible zero-argument
non-shell start, elevation/hidden/URL/protocol/shell/path/scan/argument/public-
surface, format, XAML/XML, diff, whitespace, queue, and hash-stability gates are
clean.
