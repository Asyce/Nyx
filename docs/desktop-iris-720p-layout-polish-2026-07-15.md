# Desktop Iris 720p layout polish — 2026-07-15

## Result

The native Iris launcher now keeps its Latest feed fully above the fixed Launch action in a real 1266×713 client area (the current 1280×720-class window).

## Changes

- Short windows below 760 px use tighter title, status, responsibility, and Latest spacing.
- The existing 112 px desktop and 98 px horizontal Launch clearances remain intact.
- Latest metadata is one compact line: source plus `FRESH`, `LOCAL`, or `N/A`.
- The full timestamp/freshness label remains available to accessibility automation.
- Game icons, Nyx eye artwork, lavender/void palette, custom title treatment, scrolling, and launch/maintenance behavior are unchanged.

## Visual evidence

- Rebuilt packaged development start inspected through Windows UI control.
- Client area: 1266×713.
- Latest heading, `OFFICIAL HOYOPLAY`, freshness, two complete visible card bodies including dates, and the Launch action were simultaneously visible.
- No game, official launcher, or UAC prompt was started.

## Verification

- Focused Iris/latest UI Release tests: 35/35 passed during implementation.
- Full Desktop Release tests: 776/776 passed in independent verification.
- App win-x64 Release build: zero warnings and zero errors on the stable final snapshot.
- XML, scoped diff, whitespace, and queue checks passed.
- Independent review is recorded in the nyx-0073 handoff and queue entry.
