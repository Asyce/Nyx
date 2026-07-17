# Nyx (pengo.gg) — build conventions

Nyx is a dark, game-page UI: canvas art, glowing violet accents, uppercase labels. Six imported components cover the branded chrome; **everything else on a live page is plain markup styled with the shipped `gp-*` classes and `--nyx-*` tokens** — use those, never invent your own vocabulary, never leave content on a white background.

## Page setup

- **Start every screen with `GPRoot`** — the page frame (canvas art, pattern, vignette). It fills its nearest **positioned** ancestor: give the parent `position: relative` and a height (`100vh` for a full page), then build inside.
- `GPRoot` provides the UI font and accent variables. For a fragment outside it, set `background: var(--nyx-color-canvas)` and `font-family: var(--nyx-font-ui)` on your container yourself.
- No providers needed — the bundle bootstraps itself (fonts, icons, app-ready state).

## The real page skeleton (how pengo.gg composes a screen)

Live pages are: a fixed top bar, a left tools nav, and a main pane. Reproduce it with these shipped classes (all defined in `_ds_bundle.css` — read it before styling):

- `gp-topbar` — top bar; contains `GPGameRail` (the game switcher with the living Nyx eye).
- `gp-layout` — the content row below the top bar.
- `gp-side-nav` — left column; fill it with **`GPSectionNavButton`** rows (`label`, `active`) — this is the site's actual tools nav (Overview / Characters / Database / Wish Tracker / Achievements / Library / Settings).
- `gp-main-pane` — the content column; overview screens split it into `gp-overview-main` + `gp-overview-aside`.
- Panels in the aside: `gp-reset-panel` with `gp-reset-head`, `gp-reset-grid`, `gp-reset-tile` (k/v timer tiles), `gp-aside-time`.
- Redemption codes: a `gp-codes-table` of `gp-code-row` items — each row is a checkbox (`cc-check`), the code link (`cc`), and rewards (`cc-reward`). Status modifiers: `st-new`, `premium`.
- Section headings inside panes: **`GPSec`** (`title`) — diamond + display font + rule.

## Styling idiom

Components carry their own classes — don't restyle them. Style layout glue with inline styles or small CSS using the `--nyx-*` tokens (`tokens/tokens.css`):

| Purpose | Tokens |
|---|---|
| Surfaces | `--nyx-color-canvas` (page), `--nyx-color-surface`, `--nyx-color-surface-raised` (panels) |
| Text | `--nyx-color-text`, `--nyx-color-text-dim`, `--nyx-color-heading` |
| Accent (violet glow) | `--nyx-color-accent`, `--nyx-color-accent-bright`, `--nyx-color-accent-glow` |
| Fonts | `--nyx-font-display` (headings, 'GI'), `--nyx-font-ui` (body, 'HSR'), `--nyx-font-mono` (codes) |
| Type scale | `--nyx-type-section`, `--nyx-type-body`, `--nyx-type-label` |

Spacing tokens exist as `--nyx-space-*`. Nearly every color/size on the site has a token — check `tokens/tokens.css` before hardcoding.

## Component gotchas

- **`GPSectionNavButton`**: `label` + `active`; renders its own diamond and `›` arrow (`diamond={false}` / `arrow={false}` to suppress).
- **`GPMedallion`** needs a `game` object `{ key, name, icon }` — reuse `window.GP_GAMES` (icons are embedded; never point `icon` at a site path).
- **`GPGameRail`** / **`GPMedSim`**: `active` takes a game key (`'gi'`, `'hsr'`, `'zzz'`, `'wuwa'`, `'ae'`, `'nyx'`).
- Site data ships on `window`: `GP_GAMES` (games list), `GP_FNS`, `GP_CODES`.

## Idiomatic example

```jsx
import { GPRoot, GPSec, GPSectionNavButton } from 'nyxarium-site';

export default function Page() {
  return (
    <div style={{ position: 'relative', height: '100vh' }}>
      <GPRoot>
        <div style={{ display: 'flex', gap: '40px', padding: '48px 56px' }}>
          <nav style={{ width: '220px', flex: 'none' }}>
            <GPSectionNavButton label="Overview" active />
            <GPSectionNavButton label="Database" />
            <GPSectionNavButton label="Settings" />
          </nav>
          <main style={{ flex: 1, display: 'grid', gap: '26px', alignContent: 'start' }}>
            <GPSec title="Today's Farmable" />
            <p style={{ margin: 0, color: 'var(--nyx-color-text-dim)' }}>
              Talent books and weapon materials for the current server day.
            </p>
          </main>
        </div>
      </GPRoot>
    </div>
  );
}
```
