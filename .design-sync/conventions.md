# Nyx (pengo.gg) — build conventions

Nyx is a dark, game-page UI. Every screen sits on the site's canvas art with glowing violet accents. Build inside the frame, use the tokens, and never leave content on a white background.

## Page setup

- **Start every screen with `GPRoot`** — the page frame (canvas art, rotating pattern, vignette). It fills its nearest **positioned** ancestor: give the parent `position: relative` and a height (or `100vh` for a full page), then put your content inside `GPRoot`.
- `GPRoot` sets the UI font and the accent variables for everything inside it. If you build a fragment *outside* `GPRoot`, set `background: var(--nyx-color-canvas)` and `font-family: var(--nyx-font-ui)` on your own container or text renders in browser-default fonts on white.
- No provider components are needed. The bundle bootstraps itself (fonts, icons, app-ready state).

## Styling idiom

Components carry their own `gp-*` classes — don't restyle them. Style your own layout glue with **inline styles or small custom CSS using the `--nyx-*` tokens** (defined in `tokens/tokens.css`, loaded via `styles.css`):

| Purpose | Tokens |
|---|---|
| Surfaces | `--nyx-color-canvas` (page), `--nyx-color-surface`, `--nyx-color-surface-raised` (panels) |
| Text | `--nyx-color-text`, `--nyx-color-text-dim`, `--nyx-color-heading` |
| Accent (violet glow) | `--nyx-color-accent`, `--nyx-color-accent-bright`, `--nyx-color-accent-glow` |
| Fonts | `--nyx-font-display` (headings, 'GI'), `--nyx-font-ui` (body, 'HSR'), `--nyx-font-mono` (codes) |
| Type scale | `--nyx-type-section`, `--nyx-type-body`, `--nyx-type-label` |

Spacing tokens exist as `--nyx-space-*` (e.g. `--nyx-space-2`). Read `tokens/tokens.css` before inventing a value — nearly every color/size used on the site has a token.

## Component gotchas

- **`GPHex`** (hex button) children idiom: `<GPHex on><span className="dia"></span><span>Label</span></GPHex>`. `on` = active, `small`, `disabled`, `fixw` are the states.
- **`GPSec`** is the section header — pass `title`; it renders the diamond, display font, and rule line itself.
- **`GPMedallion`** needs a `game` object `{ key, name, icon }`. Reuse the shipped list: `window.GP_GAMES` (icons are embedded data URIs — never point `icon` at a site path).
- **`GPFav`** (favourite character card): **always pass `art`** (an image URL you control) plus `w`/`h` in pixels — its default art path only exists on the live site.
- **`GPGameRail`** (vertical game switcher) and **`GPMedSim`** (the living Nyx eye) are self-contained; `active` takes a game key like `'gi'` or `'nyx'`.
- Site data ships on `window`: `GP_GAMES` (games list), `GP_FNS` (function names), `GP_CODES` (redemption codes).

## Idiomatic example

```jsx
import { GPRoot, GPSec, GPHex, GPCodes } from 'nyxarium-site';

export default function Page() {
  return (
    <div style={{ position: 'relative', height: '100vh' }}>
      <GPRoot>
        <div style={{ padding: '48px 56px', display: 'grid', gap: '26px', maxWidth: '720px' }}>
          <GPSec title="Redemption Codes" />
          <GPCodes />
          <div style={{ display: 'flex', gap: '14px' }}>
            <GPHex on><span className="dia"></span><span>Character Materials</span></GPHex>
            <GPHex><span className="dia"></span><span>Database</span></GPHex>
          </div>
        </div>
      </GPRoot>
    </div>
  );
}
```
