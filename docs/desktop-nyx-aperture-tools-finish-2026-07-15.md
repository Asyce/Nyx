# Nyx desktop aperture and Pengo tools finish pass

Date: 2026-07-15
Task: `nyx-0081`

## Delivered

### One-click Pengo tools

The selected game now exposes `PULL HISTORY` for all five games and
`ACHIEVEMENTS` only for Genshin Impact and Honkai: Star Rail. Each click opens
the exact Pengo page in the user's default browser.

The catalog contains exactly these immutable destinations:

- `https://pengo.gg/genshin/tracker`
- `https://pengo.gg/genshin/achievements`
- `https://pengo.gg/hsr/tracker`
- `https://pengo.gg/hsr/achievements`
- `https://pengo.gg/zzz/tracker`
- `https://pengo.gg/wuwa/tracker`
- `https://pengo.gg/endfield/tracker`

Unsupported pairs fail closed. Canonical game IDs are case-sensitive. The public
surface accepts only a game ID and the two-value tool kind; it accepts no URL,
route, query, fragment, port, credentials, path, command, script, shell, or
arguments. The WinUI handler can launch only the immutable catalog destination.
Duplicate clicks are suppressed per selected game/tool pair. Browser feedback is
kept per game, and only the newest tool invocation for a game may update it, so a
late browser completion cannot erase another game's error. Feedback stays local
to the tools row and never changes game or maintenance state.

This is one-click access, not a false claim of automatic extraction. The website
continues to explain and run each supported import method in the browser storage
the user already uses.

### Nyx Aperture visual finish

- The selected-game art now fills one much larger asymmetric aperture.
- Competing foreground eye/logo layers were removed from the hero composition;
  two quiet orbit lines retain the Nyx identity.
- The Pengo background remains ambient texture under the selected-game focal art.
- Game icons are larger and remain bare. The rounded aura/container was removed
  and replaced by a thin crescent selection marker.
- The palette moved to void, deep plum, moon, mist, and soft iris roles with no
  cyan, teal, or gold accent.
- Utility type moved from Consolas to Segoe UI Variable Small; display type is
  lighter and less dashboard-like.
- `NYXARIUM / FAN LAUNCHER` replaces the provisional development-style lockup.
- The launch action is moon-light with void text, an 8 px radius, and a quieter
  hover state.
- Latest content is a vertical three-row editorial ledger. The first headline has
  stronger weight; the other two recede. It remains display-only and contains no
  dynamic click or remote-image surface.
- Long game titles may use two lines. Quiet and tool actions are at least 44 px
  high, utility text is at least 12 px, and existing system focus/high-contrast
  behavior remains.
- At compact phone-like widths, official-maintenance status wraps on its own row
  and the folder/official-launcher actions reflow below it instead of clipping it.
- Compact, horizontal, wide, and expanded profiles now use larger icon/rail
  geometry while preserving bounded scrolling on the rail's main axis.

### Faster, safer startup

Optional Endfield sibling discovery no longer runs before the window exists. The
window activates and normal refresh starts first; bounded discovery then runs on a
background task.

Discovery observes window-close cancellation before inspections, between
candidates, before the final recheck, and before save. Its new atomic
`TrySaveIfEmpty` store operation means a late automatic result cannot replace a
valid manual folder choice. A successful save asks the normal session refresh pump
to repaint Endfield, invalidates the earlier maintenance result, and reruns the
read-only GRYPHLINK maintenance check; refresh failure remains advisory.

## Verification

- Focused catalog/startup/store tests: pass.
- Full Desktop Release tests: **962/962 passed**.
- Core x64 Release build: zero warnings/errors.
- Infrastructure x64 Release build: zero warnings/errors.
- ReadOnlyPilot x64 Release build: zero warnings/errors.
- App x64 Release build, including WinUI XAML compilation: zero warnings/errors.
- Modified C# format gate: clean. The solution-wide format gate still reports only
  the pre-existing unrelated whitespace in `GenshinUpdatePlannerTests.cs`.
- `MainPage.xaml`, palette, typography, and controls parse as XML.
- Source gates: no generic tool URL, script, PowerShell, Process.Start, WebView,
  clipboard, web-cache, game-file write, or Pengo API capability; no cyan/teal,
  rounded icon aura, Consolas, provisional brand copy, or personal install path.

## Manual checks still required

Automated work deliberately does not start games, official launchers, or browser
imports. The smallest final pilot is:

1. Start Nyx normally with `Desktop/scripts/start-nyx.ps1` or `Desktop/Start Nyx.cmd`.
2. At 1280x720, switch across all five games and check that the aperture, two-line
   Endfield title, tools row, Latest rows, and launch action do not overlap.
3. Click Genshin `PULL HISTORY`, Genshin `ACHIEVEMENTS`, and Endfield `PULL HISTORY`;
   confirm the exact routes above open in the default browser. Do not run an import
   merely to test the handoff.
4. Run WuWa and Endfield together once, close/relaunch each while the other stays
   Running, then open Kuro and GRYPHLINK once from the maintenance row.

The five individual first-launch/close pilots and Endfield bounded discovery pilot
do not need to be repeated.

## Deliberately deferred

- automatic native pull or achievement extraction;
- public Genshin packet capture;
- browser storage synchronization or WebView embedding;
- dynamic Latest links or remote artwork;
- website changes/deployment;
- generic URL or command execution; and
- commit, push, or production deployment.
