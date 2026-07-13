# Timeline redesign mockup — 2026-07-13

Interactive design target for the Nyx banner **timeline** (per-game overview tab).
Built by Claude (Opus) with the user; **revised by Fable 2026-07-13** (see
"Fable revision" below).

## What to open

- **`timeline-redesign.html`** — self-contained (all art inlined as base64). Just open
  it in a browser. No server, no build. This is the thing to look at.
- `gen-mockup.mjs` — the Node generator that produced the HTML. Re-run with
  `node gen-mockup.mjs` **only** if you edit the design; it reads the PNGs in
  `banners/` and rewrites the HTML in place (paths are now relative to the
  script, so it regenerates anywhere).
- `banners/` — the real art the mockup uses (`f_*.png` = wiki 16:9 banner art;
  `b1/b2.jpg` = HoYo 1200×675 originals for Sandrone/Citlali).

## Design decisions captured in the mockup

- **No zoom.** Fixed scale (0.1 day/px) so a standard **3-week banner = perfect 16:9**.
  You navigate by scrolling, the **overview minimap** (drag), Today, Jump-to-month,
  ← → keys, or search (which jumps to the match). Rationale: user prefers one
  readable zoom + scroll over +/- controls.
- **Banner tiles use official 16:9 wish art.** Art rule: one image = a 3-week tile;
  **longer banners repeat** the art (`repeat-x`), **shorter clip from the left**
  (right-anchored, so the character/name survive).
- **Art sourcing** (agreed strategy): **historical → Genshin fandom wiki**
  (`Wish/History` embeds every banner's art at a predictable URL); **going forward
  → scrape HoYo** news "Event Wishes Notice" pages (1200×675, `fastcdn.hoyoverse.com`).
  Featured 4★s are also pulled from the wiki rows.
- Lanes shown: character banners, events, activities (Spiral Abyss / Imaginarium
  Theater), and a private "my planning" lane. Honesty signals preserved: unconfirmed
  banners are dashed-gold **Expected**, never a fake date.

## Fable revision (2026-07-13)

The original tiles were unreadable at a glance — the only text on a card was a
loud status chip ("ENDED" ×6), and illustrative dates made two phases overlap in
the same lane. Changes:

- **Every tile now carries its own name + date range** over a bottom scrim
  (serif name, small caps dates). Scanning the timeline no longer requires the
  detail panel.
- **Past tiles drop the chip entirely** and desaturate instead (hover restores
  the art). Chips remain only where they carry news: Live (with countdown days
  + a progress bar along the tile's bottom edge), Upcoming, Expected.
- **Phases retimed to be contiguous** — no more stacked/overlapping tiles.
  `NOW` moved to Jul 13.
- **Structure**: sticky lane labels (visible at any scroll position),
  full-height alternating version bands + boundary lines, stronger month ruler
  with weekly ticks, version ribbon labels visible.
- **Events** are compact bars: title, date range, status chip — no more giant
  empty teal boxes.
- **Minimap** gained month labels, a dimmed outside-the-window overlay, and
  grab handles.
- **Detail panel** shows the selected banner's art as a 16:9 thumbnail.
- Dead "+ Marker" / "Layers" buttons replaced with **working layer toggles**
  (Events / Activities / My planning show-hide).

### Round 2 — Nyx theme alignment (same day)

- **Palette matched to the site** (`game-page-shared.css`): everything is now
  the violet family (`#8b7bff` accent on `#05040b`). Teal event/activity colors
  and the gold "Expected" treatment are gone — Expected is a dashed-violet
  outline tile, events are violet bars with a light accent chip when ongoing.
- **Real site fonts**: `fonts/` holds latin subsets of the site's `GI.ttf` and
  `HSR.ttf` (pyftsubset → woff2, ~17KB total) which the generator inlines.
  Titles, tile names, month labels and event titles render in GI; all UI text
  in HSR. Georgia fallback only.
- **Less chrome**: the hint paragraph and the 5-item legend are removed
  (states are self-labelled on the tiles); search placeholder shortened;
  toolbar collapsed to a single row with Layers on the right.
- **Nyx hex accents**: lane labels, Today, layer toggles and "+ Add to
  planning" use the site's hexagon clip (`--hclip`).

### Round 3 — polish pass

- **Version labels stick**: Luna V–VIII ribbon labels pin to the left edge of
  the viewport while their band is in view (no more scrolling away mid-band).
- **In-art marketing text muted** by a diagonal top-left scrim layer.
- **Past events added** (Ley Line Overflow, Marvelous Merchandise) so the
  events lane demonstrates the full past/ongoing/upcoming range; past events
  and ended activity/planning chips are dimmed, chipless.
- Timeline range tightened to Apr 1 – Aug 18; region label unified to "NA".

### Round 4 — missing data types (desktop visuals only)

- **Weapon banner strip**: one slim "⚔ Epitome Invocation" strip per phase
  under the two character rows (dimmed when past, dashed when expected);
  exact dates on hover.
- **Phase tags**: date lines read "Jul 1 – Jul 22 · Phase 1" whenever a
  version has more than one phase; also shown in the detail panel kicker.
- **Hover card**: hovering any tile shows a floating card (name, banner,
  dates + length, 4★ rate-ups) — no click needed to browse.
- **Short event tiles** drop to a smaller title size and hide the status chip
  so names like "Ley Line Overflow" fit without truncating.

## Caveats (it's a mockup)

- Dates/versions and the paired-weapon note are **illustrative**; character names,
  banner names, art, and 4★ lineups are **real** (from the wiki). The `GI`/`HSR`
  fonts are real but subset to latin glyphs only.
- 4★s for Emilie & Mizuki are omitted (their wiki rows merged with the weapon banner).
- Region toggle is cosmetic; phases-within-a-version and mobile depth are not solved.

## The actual code changes (separate from this mockup)

A first pass already landed in the working tree (uncommitted), implementing the
no-zoom + date-ruler + richer cards direction — but **not** the 16:9-art tiles,
minimap, or 4★/weapon fields (those are still only in this mockup):

- `Site/src/features/timeline/timeline-view.jsx`
- `Site/src/features/timeline/timeline-data.js`
- `Site/src/styles/game-page-shared.css`
