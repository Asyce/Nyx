# Nyx Desktop Iris shell

Status: complete; independent code, accessibility, visual, and verification reviews
passed

## Result

The private Windows launcher now uses one edge-to-edge Nyx composition instead of
dashboard cards. The application title bar is integrated into the background, the
five games use large unboxed artwork, and an off-centre Iris combines the selected
game art with the Nyx eye. The palette is void, nebula, Moon white, Mist
silver-lavender, and Iris ultraviolet. No gold or cyan remains.

There is one primary Launch control. Local-game state and publisher-maintenance
state are separate. The shell permanently states:

> Nyx launches the game. The official launcher downloads, updates, pre-downloads,
> verifies, and repairs it.

The unofficial fan-made disclaimer remains visible and screen-readable. Genshin,
Honkai: Star Rail, and Zenless Zone Zero use independently validated local targets,
session observation, close detection, and explicit relaunch behavior. Wuthering
Waves and Arknights: Endfield remain honest fail-closed entries until their exact
direct-launch gates are proven.

The `Latest` strip consumes the guarded HoYoPlay content surface for supported HoYo
games and automatically falls back to bundled, dated Nyx snapshots. Wuthering Waves
and Endfield currently use bundled Nyx banner snapshots. Source and freshness are
always visible; a feed failure never affects local Launch readiness.

Every unselected game now keeps a live, screen-readable rail mark. Running and
starting states take priority, followed by confirmed update/pre-download offers,
retry state, capability, and local readiness. Unknown publisher evidence never
claims that an offer exists. The primary Launch action is fixed above the bottom
disclaimer instead of disappearing inside the content scroll.

## Responsive contract

`LauncherLayoutState` owns four deterministic layouts:

- Compact: width below 760; horizontal scrolling game rail and faded Iris.
- Horizontal: width 760-1039 or height below 680; horizontal rail and scrollable
  content.
- Wide: width 1040-1599 with sufficient height.
- Expanded: width at least 1600 and height at least 760.

Each profile now consumes its declared icon size. Item chrome adds 8 px and outer
margin adds 4 px, producing cross-axis extents of 100/108/116/116 px inside rails
of 102/110/116/128 px. Fixed 112 px containers are gone. Image, item, selection,
and system-focus bounds therefore resize together, while the five-item main axis
remains scrollable.

Pure tests cover the specified boundary sizes, including 390x844, 760x540,
901x713, 1280x720, 1600x900, 2560x1080, and 3440x1440. Runtime visual inspection
covered the earlier compact, short, default, and maximized layouts. After moving
Launch outside the content scroll, the available 1280x720-class display was checked
again: the action remains fully visible, the title bar does not collide, the rail is
reachable, and no overlap or black rendering artifact remains. Exact dimensions and
scale-independent layout profiles remain enforced by deterministic tests because the
available display cannot reproduce every requested physical size or scale factor.

## Runtime QA and regression fix

The first packaged preview exposed a deterministic startup fail-fast. The selected
game renderer was looking for palette brushes in the empty page-local dictionary.
It now resolves them from `Application.Current.Resources`. A source regression test
locks this boundary.

After the fix, the complete custom rail and Iris art launched successfully. Each of
the five game entries was selected in sequence; title, index, maintenance provider,
latest source, direct-launch state, and disabled-state copy changed correctly.
Genshin, Star Rail, and ZZZ reported ready; Wuthering Waves and Endfield remained
locked. No Launch or official-maintenance action was invoked.

The interrupted Windows-control session was reconnected. The apparent black block
was a stale capture of the browser behind Nyx, not an application render defect.
Foreground recapture of Nyx was clean. Keyboard arrow navigation moved between game
entries, and the final game remained reachable. The accessibility tree exposed all
five dynamic status descriptions and the fixed primary action.

## Accessibility and Windows behavior

- Native minimize, maximize/restore, close, drag region, snap, and system-menu
  behavior remain owned by Windows App SDK.
- Each game exposes its name and current capability/status description.
- Each realized or recycled `ListViewItem` is named by the wired container callback;
  the name includes game, status/capability, and the select action.
- High contrast pairs the primary Highlight background with HighlightText for every
  launch label/detail/mark. Focus and selection use explicit system-safe tokens, and
  Windows owns caption-button colors instead of hard-coded normal-theme values.
- High contrast also raises an opaque `SystemColorWindowColor` surface over the
  backdrop and dark scrim. Background, scrim, and Iris content independently resolve
  to zero opacity in the HighContrast dictionary. The normal Dark dictionary keeps
  decorative opacity at one and the cover at zero, so the Iris composition is
  unchanged outside high contrast.
- No storyboard or animation is used, so reduced-motion behavior is stable.
- Compact game navigation scrolls horizontally; short content scrolls vertically.

## Scope boundary

This change only reshapes the private Desktop shell. It does not automate official
launchers, update games, add hidden/headless behavior, alter adapters, touch game
folders, write the registry, deploy, package, commit, or push.
