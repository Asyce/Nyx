# Mockup prompt — Banner Timeline

Paste everything below the line into Claude (design mode) or Codex to get a static
HTML mockup. It should produce ONE self-contained .html file you can open in a
browser and judge. No project code — throwaway visuals only.

---

Build a single self-contained HTML file (all CSS and JS inline, no external
libraries, no network requests) that mocks up a **gacha-game banner timeline**
component for a dark-themed fan site. Use realistic fake data.

## Canvas

- Dark page (near-black purple, e.g. #0a0714 background), one full-width panel
  with rounded corners and a soft border, like a premium game dashboard card.
- Accent color: electric violet (#b7aaff) — used for the "now" line, active
  glows, and highlights. Everything else stays muted.
- Desktop-first, 1280px wide viewport target; it may scroll horizontally inside
  the panel.

## Layout, top to bottom

1. **Toolbar** (one row): a search input ("Search banners…"), four small lane
   toggle chips (Characters, Weapons, Activities, Custom), zoom − / + buttons,
   a "Today" button, and an "+ Add marker" button. Compact, quiet styling.
2. **Version ribbon**: a thin horizontal strip showing game versions as labeled
   segments ("5.6", "5.7", "6.0") aligned to the time axis.
3. **Time axis**: horizontal, spanning roughly 8 weeks in the past to 6 weeks in
   the future. Light date ticks (e.g. "Jun 10", "Jun 24", …). A vertical accent
   line marks NOW, positioned about 38% from the left edge.
4. **Lanes** (stacked rows, labeled on the left edge):
   - **Characters** — banner blocks. Each block spans its date range and shows
     1–2 circular character portrait placeholders (colored circles with initials
     are fine) + the character name + a thin rarity-gold left edge.
   - **Weapons** — same anatomy, square icon placeholders.
   - **Activities** — repeating slimmer spans: "Spiral Abyss" every two weeks,
     "Imaginarium Theater" monthly. Lighter, more transparent styling.
   - **Custom** — one point pin ("Maintenance") and one range block ("My farming
     week"), in a user-picked color (teal).
5. Blocks left of the now-line are slightly desaturated (past). The block
   crossing the now-line glows subtly and carries a live countdown chip
   ("ends in 4d 12h"). Blocks right of it are normal.
6. One upcoming block at the far right has a **dashed border** and an
   "Expected" tag; hovering it shows a tooltip: "Educated guess — dates not
   officially confirmed yet."

## Interactions to fake (small inline JS is fine)

- Typing in search dims all blocks except matches (match on the fake names).
- Lane chips toggle their lane's visibility.
- Hovering any block lifts it slightly and shows a tooltip with name + dates.
- Clicking a block opens a small anchored card: featured character list (three
  fake entries with colored circles), date range, duration, a "View character"
  link (dead link is fine).
- The zoom and Today buttons can be non-functional; style them as active UI.

## Fake data (use these names)

- Character banners past→future: "Venti" (rerun, past), "Furina" + "Nahida"
  (double, past), "Columbina" (current, crosses now-line), "Escoffier" (next),
  "???" (Expected, dashed).
- Weapons: "Elegy for the End", "Splendor of Tranquil Waters" (current),
  "Vivid Notions" (next).
- Versions: 5.6 (past), 5.7 (current), 6.0 (future).

Aim for the feel of a polished game-official schedule board: quiet, readable,
information-dense but airy. Deliver ONLY the single HTML file.

---

# Mockup prompt — Database tiles + detail popup (optional second mock)

Build a second self-contained HTML file mocking a **game database grid**: a dark
panel (same palette as above) with a row of collection tabs ("Weapons",
"Artifacts", "Monsters", "Items"), a search field, and a grid of square tiles —
each tile is an icon placeholder on top with the item name below, nothing else.
Hovering a tile lifts it with a violet glow. Clicking any tile opens a centered
modal: big icon left; name, rarity stars, 3 short stat rows, and a two-line
description right; dimmed backdrop; Escape or × closes. 24 fake items with
varied names. Deliver ONLY the single HTML file.
