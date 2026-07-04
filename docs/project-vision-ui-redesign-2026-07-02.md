# Nyx UI Redesign Vision

Date: 2026-07-02
Branch: `ui-redesign`
Production policy: preview branch only; `main` and production stay untouched until explicitly approved.

## Project Vision

Nyx is a dark celestial game-companion interface under the Pengo brand. It should feel like a magical observatory, tarot ledger, and fantasy Art Deco control room for live-service game tools. The site must keep its existing painted night mood, game imagery, character art, violet/cosmic atmosphere, and living-eye identity. The redesign should make those elements more deliberate, readable, and responsive without flattening the app into a generic dashboard.

Nyx users should be able to choose a game, inspect banners/codes, manage character material planning, import/read pull history, and browse database entries without fighting clipped art, noisy backgrounds, horizontal overflow, or dense translucent panels. Decoration should guide attention and create hierarchy. It should not compete with numbers, commands, material quantities, or trust-sensitive account/source details.

## Non-Negotiables

- Do not use AI-generated images.
- Use existing game/site assets, CSS, SVG, and code-built primitives.
- Keep character, item, banner, and splash PNG assets as the default quality source.
- Add WebP only as an optional display mode where alternate assets exist.
- Do not change game data, scraper outputs, material counts, gacha logic, or route/content metadata unless a small UI structural change requires it.
- Keep production on `main` untouched. Use branch preview for review.

## Visual Direction

The redesign should use a Fantasy Art Deco system rather than disconnected decorative PNGs:

- Deep night and violet atmosphere as the base.
- Antique gold for selected/important moments, not every border.
- Pearl/lavender text and soft teal secondary status accents.
- Stepped geometry, diamonds, rails, sigil rings, nested borders, and controlled linework.
- Calm, opaque-enough ledger surfaces for dense data.
- Existing game/character/banner/meta icons remain content assets and should be framed, not replaced.

## Artwork Quality Setting

Add an `Artwork quality` setting to the bottom-left Pengo menu:

- `Original` means PNG/default assets.
- `Faster` means WebP alternate assets where available.
- Scope is character, item, banner, and splash art only.
- The setting must save locally for guests.
- The setting must sync to the account/preference layer when available.
- Account value wins after login or sync; local value is the fallback.

## Technical Decisions

Frontend:

- Keep the existing React/esbuild frontend and shared CSS architecture.
- Add small internal helpers/classes for reusable visual primitives.
- Avoid a new design library unless a specific implementation need appears.

Backend/account:

- Reuse the existing Worker/KV account sync pattern where possible.
- Add a small preference sync endpoint or payload path for `artworkQuality`.
- Keep credentials and test account data out of the repo.

Database/data:

- Store only the user preference if needed.
- Do not modify generated game data for visual polish.

Hosting/deploy:

- Use Cloudflare/Wrangler preview deployment if supported.
- If preview config is missing, add preview-safe config without production routes.

Verification:

- Run deploy build and smoke tests.
- Capture desktop and mobile screenshots for the affected surfaces.
- Check no broken images, no console errors, no clipped controls, and no fixed-control overlap over content.
