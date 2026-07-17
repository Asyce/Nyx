# Endfield bounded auto-discovery - 2026-07-15

## Why the original locator failed

GRYPHLINK's public 32-bit uninstall record, Start Menu shortcut, and Public Desktop
shortcut all still point to the old `D:\GRYPHLINK` root. A read-only Windows Shell
link-tracking resolve also returns that same missing target.

The launcher does store game information in `eld_Games.db`, but that database is
encrypted and lives inside GRYPHLINK's own version folder. It therefore cannot
locate the GRYPHLINK root from outside, and Nyx does not reverse-engineer or read
private publisher databases, logs, caches, or account state.

## Bounded automatic route

When Endfield has no saved root, Nyx now uses only already bounded game roots:

- a WuWa root that first passes the complete WuWa direct-launch check;
- the existing fully validated Genshin discovery result.

Only exact known suffixes are accepted: `Wuthering Waves` and
`Genshin Impact\Genshin Impact Game`. Nyx derives only their exact `GRYPHLINK`
sibling, deduplicates candidates, and never enumerates a directory or searches a
drive.

Every candidate receives a complete Endfield check. Exactly one Ready or Running
candidate is rechecked immediately for drift and then saved. Zero matches, multiple
matches, uncertainty, changed identity, or storage failure saves nothing and leaves
the visible Choose Folder fallback available.

The saved path remains only a hint. Session observation, game Launch, and visible
GRYPHLINK maintenance still repeat their existing protected validation.

## Author verification

- Focused sibling/startup Release tests: 20/20 passed.
- Full Desktop Release tests: 922/922 passed.
- Core, Infrastructure, read-only Pilot, and App win-x64 Release builds: zero
  warnings and zero errors.
- Format, csproj/XAML XML, whitespace, personal/hardcoded-path, recursive/search/
  process/registry enumeration, private database/log/cache/account, start/shell/
  network, diff, and source-hash gates: clean.
- No live executable, UAC, network, deploy, commit, or push action occurred.

## Next action

After independent review and verification, run the read-only production check on
the derived current root, reopen Nyx, and passively confirm Endfield is Ready with
both Launch and Open GRYPHLINK available. Neither executable will be started.

## Closure and live proof

Independent security/lifecycle review is CLEAN. Independent verification passes
focused 20/20, broader related coverage 25/25, full Desktop 922/922, and all four
x64 Release builds with zero warnings/errors. Format, XAML/XML, diff, whitespace,
queue, path/search/private-data/capability, and hash-stability gates are clean.

The derived real `D:\Gaming\GRYPHLINK` root passed the production read-only pilot
with full-install maintenance proof and the honest `VersionUnavailable` state.
After restart, the rebuilt Nyx App automatically admitted and saved that unique
fully verified sibling. Passive accessibility inspection reported Arknights:
Endfield as **Ready to launch**. No folder picker, game, official launcher, UAC,
network request, or game-folder mutation occurred.
