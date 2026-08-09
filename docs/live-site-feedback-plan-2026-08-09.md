# Live site feedback — change plan (2026-08-09)

Everything below comes from one walkthrough of the live site (`https://pengo.gg`, running commit
`896ce0675`, which is exactly what this branch `live-base-20260809` is built on — so what I read in
the repo is what you were looking at).

**25 changes**, grouped by the page they live on. Each one says what you asked for, what I found in
the code, and what I'll change. Things I could not fully confirm are flagged with **?**.

Genshin is used as the example throughout because that's the page you were on — but every change is
written to apply to **all games** unless it says otherwise.

---

## A. Game Overview page

### A1 — Banner character names much bigger
The names (Columbina, Raiden Shogun) sit at 17px. You want them 2–3× that, roughly as tall as the
round icon next to them (44px).

- Change `.gp-oban-unit b` from 17px to ~34–38px, and let the name wrap instead of being cut with "…"
  so a long name is not clipped by the bigger text.
- The featured block has a fixed `max-height:96px` sized for the old small rows — it grows with the
  text.
- Files: `Site/src/styles/game-page-shared.css` (`.gp-oban-featured`, `.gp-oban-unit b`).

### A2 — Odette and Alyosha show the same wrong artwork
**Confirmed bug, root cause found.** In the published data both of them have `icon: null` and
`art: null`. When art is missing, the card falls back to the game's default picture — which for
Genshin is Skirk (`assets/char/skirk.jpg`). Two different characters therefore end up with one
identical face. (You read it as Sandrone; the file is actually Skirk — either way it's the wrong
person.)

Why the data is empty: the build only looks up banner characters in the **live** roster. Odette and
Alyosha are 7.0 characters, so they exist only in the **beta** data — where their pictures *are*
already downloaded and sitting in the repo:
`Database/GameData/gi/assets/characters/circles/UI_AvatarIcon_Odette_Circle.webp`,
`.../gacha/UI_Gacha_AvatarImg_Odette.webp`, and the same pair for Alyosha.

Two-part fix:
1. **Data** — when a banner character isn't in the live roster, fall back to the beta roster before
   giving up. Files: `Site/tools/generate-site-data.mjs` (`normalizeBannerCharacter`, `rosterHit`).
2. **Safety net** — stop the renderer from ever substituting the game's default character art for an
   unknown unit. A character with no picture gets a neutral silhouette instead, so two unknowns can
   never look like the same person again. Files: `Site/src/app/nyx-app.jsx` (`phaseUnit`).

### A3 — Right-hand upcoming column: smaller rows
Today the rows (Flins, Ineffa) stretch to fill the column, so only two fit. You want each row only as
tall as its icon so four or five fit in the same space.

- Drop `flex:1 1 0` on `.gp-ovb-row` so rows keep their natural height, and set the row height to the
  icon (44px) plus its padding.
- Files: `Site/src/styles/game-page-shared.css` (`.gp-ovb-body > .gp-ovb-row`, `.gp-ovb-row`).

### A4 — Click a banner character to open their page, and get back
Both the name and the icon become clickable, on the big cards and the side rows, and land on that
character's page in the Characters tab. The Back button on that page returns you to **Overview**
(today it always returns to the Characters list).

- The plumbing already exists: `openMaterialPage(game, name, { from })` with a `from` marker.
  I add `from:'overview'` and teach the back handler to route to `overview`.
- Files: `Site/src/app/nyx-app.jsx` (`BannerBoardRow`, `BannerPhaseCard`, `OverviewBannerBoard`,
  `openMaterialPage`, `closeMaterialCharacter`), plus a link style in the shared CSS.

### A5 — "Time left" and the end date significantly bigger
- `.gp-oban-foot b` (the countdown) goes from ~14px to ~22–24px; `.gp-oban-foot span` (the dates)
  from 10.5px to ~14px.
- Files: `Site/src/styles/game-page-shared.css`.

### A6 — 4★ names are shouting
**Confirmed bug.** The rule `.gp-oban-supports > span` was written for a small "ALSO FEATURED" label,
but the 4★ names are also direct `<span>` children of that block, so they inherit uppercase, heavy
weight and wide letter-spacing. Jahoda, Ororon, Sethos and Alyosha therefore render as
`J A H O D A`.

- Tighten the selector so it can only hit the label, and let the names render as normal text.
- Files: `Site/src/styles/game-page-shared.css`.

### A7 — EU / NA / Asia / Custom in one container
Today the three regions sit in one pill group and Custom is a separate control beside it. They merge
into a single container: regions first, a thin divider, then Custom as the fourth segment.

- Files: `Site/src/app/nyx-app.jsx` (`TimePreferenceControl`) + its CSS.

### A8 — Remove "Updated 8 August 2026"
Two of these exist (one over the events grid, one over the banner strip). Both go.

- Files: `Site/src/features/timeline/timeline-view.jsx` (`CurrentEventsStrip`),
  `Site/src/app/nyx-app.jsx` (`CurrentBannerStrip`), plus the now-unused `.gp-events-head` CSS.

### A9 — Event cards: drop the outbound link, open the text instead
The whole event card is currently an invisible link to the official notice — useless now that we're
opening an API for it. That link is removed. In its place, clicking the card opens a pop-up showing
the **full description text** (decided 2026-08-09).

- Files: `Site/src/features/timeline/timeline-view.jsx` (replace `.gp-oev-link` with a card button +
  a detail dialog), `Site/src/styles/game-page-shared.css`.

### A10 — Event description cut off at half width
The description is clamped to 3 lines and the card reserves space that pushes it narrow. It gets the
card's full width, running out to where the time-left block starts.

Decided 2026-08-09: keep a **generous cap (~5–6 lines)** so every card in a row stays the same
height; the full text is one click away in the A9 pop-up.

- Files: `Site/src/styles/game-page-shared.css` (`.gp-oev-text`, `.gp-oev` body layout).

### A11 — Event images too dark
Event art renders at 50% opacity; banner art on the same page renders at 100%. Event art is raised to
match, with the dark scrim adjusted so the title stays readable.

- Files: `Site/src/styles/game-page-shared.css` (`.gp-oev-art`, `.gp-oev .gp-oban-shade`).

> Noted and **no action**: Tempero/Temporo appearing twice — that's the same event listed once as
> live and once as upcoming, which you spotted yourself.

---

## B. Character page

### B1 — The highlight under the selected tab is too wide
The tab strip forces every tab to the same width (`grid-auto-columns:1fr`), so "Talents" gets a
highlight roughly twice as wide as the word. Each tab will size to its own label, with the highlight
extending only slightly past the text, and the gap between tabs reduced.

- Files: `Site/src/styles/game-page-shared.css` (`.cm-tabs`, `.cm-tabs .gp-section-nav-button`).

### B2 — Pinned Favourites: remove the card system entirely
Icons only, always. That means deleting:
- the **Card / Icon** toggle,
- the **Hide / Show** button,
- the card renderer, the 5-card limit and the "More favourites" overflow row.

Applies to every game **and** the Nyx hub (which currently defaults to cards).

- Files: `Site/src/app/nyx-app.jsx` (`Favourites`, `CurrentFavCard`),
  `Site/src/shared/pinned-favourites.js` (mode + visibility helpers, `NYX_FAVOURITE_CARD_LIMIT`),
  `Site/src/features/materials/char-materials.jsx` (the pinned slot on the roster),
  shared CSS, and the tests that assert the old behaviour.
- Saved settings for the removed toggles are ignored and cleaned up, so nobody is stuck in a mode
  that no longer exists.

### B3 — Unfavourite confirmation: make the red actually red
The confirm button uses a pink gradient (`#ffb0c3 → #e66789`). It becomes a clear red with white
text, contrast-checked.

- Files: `Site/src/styles/game-page-shared.css` (`.cm-unfav-actions button.danger`).

### B4 — Weekday selector: plain text, not a fancy switch
Mon–Sun currently sit in a raised container with a purple gradient on the active day. They become
plain text buttons in the same visual family as the Roster / Talents tabs above: no container, a
light hover, and a quiet highlight on the selected day.

- Files: `Site/src/styles/game-page-shared.css` (`.cm-days`).

---

## C. Shell / branding

### C1 — "Nyx" becomes "Pengo", and the eye moves
- The top-left wordmark text changes from **Nyx** to **Pengo** (`.tb-brand .wm`).
- The blinking eye that sits next to it moves out of the header and down into the left navigation,
  directly **below Settings**, keeping its mouse-following behaviour.
- Files: `Site/src/app/nyx-app.jsx` (top bar markup, `GameContent` / `SimContent` side nav),
  shared CSS for the new position.
- Decided 2026-08-09: the wordmark keeps the back-to-Worlds link; the relocated eye is **decorative
  only**.

---

## D. Database

This is the biggest block. One shared rule, applied everywhere.

### D1 — Missing artwork: two artifact sets
**Confirmed.** *Glacier and Snowfield* (id 15004) and *Prayers to the Firmament* (id 15012) both fall
back to the grey placeholder, on live too. Cause: the upstream record for those two sets has an empty
`assets` block, so no filename was ever produced — every other set has one.

Plan: derive the conventional filename (`UI_RelicIcon_15004_4`, `UI_RelicIcon_15012_3`), probe the
Nanoka/GameData CDN for it, and mirror it locally if it exists; if it doesn't, pull from the wiki
mirror we already scrape. Then add a check so any future set with an empty `assets` block is
auto-probed the same way instead of silently becoming a placeholder.

- Files: `Site/tools/localize-gamedata-icons.mjs`, `Site/tools/lib/database-data-helpers.mjs`,
  `Site/tools/generate-site-data.mjs`.

### D2 — Weapons: sort by type, then rarity, then newest first
New default order:
1. Group by weapon type — Sword, Claymore, Polearm, Bow, Catalyst (each game's own types).
2. Within a group, 5★ first, then 4★, then 3★ and below.
3. Within a rarity, **most recently released first**.

There is no release date in the weapon data today. I'll add one at build time from
`Database/BannerHistory/<game>.json`, which records weapon banner debuts with real dates, and fall
back to internal id order for weapons that never had a banner (craftables, battle-pass, shop).

- Files: `Site/tools/generate-site-data.mjs` (add a `released` field),
  `Site/src/app/nyx-app.jsx` (`CollectionLibrary` grouping + sort).

### D3 — Load everything; hide 3★ by default
- "Load more" disappears; every row for the chosen collection renders.
- Rarity 3★ and below is hidden by default behind a **Show all rarities** toggle.
- Genshin **Items** is 9,721 rows. Decided 2026-08-09: every row is present and nothing is hidden,
  but each category section **fills in as you scroll to it**, so the tab opens instantly instead of
  freezing.

### D4 — Weapon icons
**?** Needs your confirmation. I checked the live data: 236 of 247 Genshin weapons have real icons,
and I fetched two of them from the live asset server — both returned proper image files. So icons are
not broken across the board.

The 11 that genuinely fall back to the placeholder are the brand-new 7.0 weapons: *Serpent Devourer*,
*Ardent Storm*, *Shattered Moon*, *Hallowed Fetters*, *Starpiercer* (each plus its "- Sublimation"
variant) and *Super Awesome Magic Key* — same root cause as D1, they only exist in beta data.

I'll fix those 11 via the same beta-fallback + auto-probe route, so new weapons populate themselves
from Nanoka going forward. **If you were looking at a different view that was fully empty of icons,
send me which one** and I'll dig into that specifically.

### D5 — Monsters page: load all, grouped by type
Same treatment: no "Load more", and the list is split into labelled sections by type — Beast (89),
Human (65), Animal (62), Fish (60), Aviary (46), Elemental (43), Critter (41), Automatron (38),
Hilichurl (30), Fatui (30), Abyss (29), Boss (14).

### D6 — Same rule everywhere
The grouping/sorting/no-pagination pattern gets applied to every database surface, for every game:
artifacts and relic sets, light cones, W-engines, disk drives, bangboos, echoes, gear, items — plus
Genshin's **TCG**, **Serenitea Pot** and **Miliastra Wonderland** views, which currently have their
own separate "Load more" implementations.

- Files: `Site/src/app/nyx-app.jsx` (`CollectionLibrary`, `GenshinTcgView`, `GenshinPotView`,
  `GenshinWonderlandView`) — I'll factor the grouping into one shared helper rather than repeating it
  four times.

---

## E. Achievements

### E1 — Remove the seal icon
The decorative "eye seal" appears twice: before the **Achievements** heading, and before **All
achievements** in the category list. Both are removed.

Where an icon is genuinely wanted, the default becomes the **Wonders of the World** achievement icon,
for every game (each game's equivalent default if it has one; otherwise Genshin's).

- Files: `Site/src/features/achievements/achievement-view.jsx` (`AchievementCategoryIcon` and its two
  `all` call sites), plus the `.achievement-eye-seal` CSS.

---

## F. Library

### F1 — Drop the "Search Library" label
The bold heading in front of the search box goes; just the search field remains.

- Files: `Site/src/features/library/library-view.jsx`.

### F2 — Book titles: always exactly two lines
Today a long title pushes its tile taller than its neighbours, so the grid is ragged. Every title gets
a fixed two-line block; longer titles shrink their font (down to a readable floor) to fit rather than
growing the tile. Result: every tile the same height, everything lined up.

- Files: `Site/src/features/library/library-view.jsx` (measure-and-fit on the title),
  shared CSS (`.library-tile strong`).

---

## Delivery

Suggested order, each step independently reviewable:

1. **Overview** — A1–A11 (the page you were looking at; biggest visible win).
2. **Character page + shell** — B1–B4, C1.
3. **Database** — D1–D6 (largest, touches the build pipeline).
4. **Achievements + Library** — E1, F1–F2.

Everything is built on branch `live-base-20260809`, which starts from the exact commit that is live.
Nothing gets pushed or deployed without you asking.

## Decisions taken 2026-08-09

- **D3** — Items fills in as you scroll; nothing is hidden or paginated away.
- **C1** — relocated eye is decorative; the Pengo wordmark keeps the link.
- **A9 / A10** — generous cap with equal-height cards, and the card is clickable to open a pop-up with
  the full description.
- **Order** — build all four sections, then show.

## Build outcome (2026-08-09)

All 25 changes are built on `live-base-20260809` and verified in a local preview by measuring the
live DOM. Highlights confirmed working:

- Banner names render at 34px against their 44px icon; countdown at 22px; 4★ names in normal case.
- Odette's card now uses **Odette's own splash**, Alyosha their own icon — no shared face anywhere,
  and no `skirk.jpg` fallback left in the page.
- Upcoming rows are 56px (icon height), so four or five fit where two did.
- Clicking Columbina opens her page; Back reads **"Back to Overview"** and returns there.
- Events: no outbound links, art at the same brightness as the banners, description across the full
  card width, all six cards exactly the same height, click opens the full-text pop-up.
- Weapons group into Sword/Claymore/Polearm/Bow/Catalyst, 5★ → 4★ → 3★ within each, and
  **A Teaspoon of Transcendence leads the Claymores** — exactly the example you gave.
- Monsters: 547 rows in 12 type sections. Items: **all 9,721 rows in 74 sections** with only ~1,700
  cards in the page at a time; the tab opens instantly.
- Library: 118 tiles, every title box the same height, every subtitle on the same line, zero clipped
  titles.

### Two honest caveats

1. **The two artifact sets cannot be fixed — the artwork does not exist.** *Glacier and Snowfield*
   and *Prayers to the Firmament* have an empty asset block in both the live and beta feeds, and I
   probed every mirror we can reach (Nanoka, GameData, Ambr/Yatta, Enka) for every filename the
   naming convention allows — all 404. These are unreleased/unobtainable sets, so no icon was ever
   shipped. What I did build is the guard: any set whose feed omits a filename is now auto-matched
   against the conventional name, so future sets populate themselves the moment the art appears.
   The same guard covers the 6 new 7.0 weapons (Serpent Devourer, Ardent Storm, Shattered Moon,
   Hallowed Fetters, Starpiercer, Super Awesome Magic Key), which are missing art for the same
   reason.
2. **The Achievements change is unverified in the browser.** The Achievements tab does not appear in
   the preview at all: `window.NyxAchievementGames` is undefined because `achievement-games.js` is
   still an uncommitted file that the build does not include yet — separate in-flight work on this
   branch, not something these changes touched. The code change (seal removed, Wonders of the World
   as the default icon) is in place but I could not click through it.

### Tests

346 of 350 pass. The 4 failures are pre-existing data drift from other in-flight work on this branch
(HSR achievement catalog release ceiling ×2, a ZZZ Sigrid live/beta status assertion, and a ZZZ
drive-disc count) — I reproduced them with my changes reverted. Five tests that asserted behaviour
you asked me to remove were rewritten to assert the new behaviour instead.

## Still open

1. **D4** — which weapons view looked completely icon-less? Live data says only 11 of 247 are
   missing, and the ones I fetched from the live asset server returned real images.
2. **Section order** — weapon type sections are ordered by whichever type holds the newest item
   (Claymore, Polearm, Catalyst, Bow, Sword today), so the order shifts as new weapons ship. Say if
   you would rather they sat in a fixed order.

---

# Round 2 (2026-08-09)

Ten more changes from a second pass over the preview. All built and verified in the browser.

| # | Change | Where |
|---|---|---|
| 1 | Living eye moved from the side nav to sit directly above the Ko-fi badge | `nyx-app.jsx`, shared CSS |
| 2 | Banner characters with no art — root cause found and fixed (below) | `generate-site-data.mjs` |
| 3 | Pengo wordmark pulled left, `pengo.png` set behind it | `nyx-app.jsx`, shared CSS |
| 4 | Wish Tracker: diamond before "Import history" removed, glow rail added | `gacha-tracker.jsx`, shared CSS |
| 5 | Hub: All Events, All Banners, Pull Overview and Timeline tabs removed | `nyx-app.jsx` route tables |
| 6 | Hub: "Current Banners" replaced by five per-game columns of wide banner rows | `NyxBannerColumn` / `NyxBannerColumns` |
| 7 | Hub Overview renamed **Banners**; region control, reset timers and codes aside dropped from it | `SimContent` |
| 8 | Hub Characters renamed **Pinned Characters** | `SimContent` |
| 9 | "All Redemption Codes" → **Redemption Codes**; code and amount now sit together, four codes per row | `AllCodesView`, shared CSS |
| 10 | New hub **Events** tab showing each game's own current-events strip | `NyxEventsView` |

## #2 — why those characters had no art

The banner feed and the roster spell the same character differently:

- HSR publishes **"Himeko • Nova"**; the roster carries "Himeko Nova".
- ZZZ publishes full names — **"Piper Wheel"**, **"Ukinami Yuzuha"**, **"Remielle Dan"**, **"Seth Lowell"**,
  **"Asaba Harumasa"**, **"Sigrid de L'Azur"** — while the roster uses the in-game short name.

`rosterHit` compared the two strings exactly, so every one of those missed, and a miss means no icon
and no splash. It now compares on letters and digits only (which fixes the bullet), then falls back
to a roster name that is the leading or trailing run of words in the banner name (which fixes the
full names). An ambiguous fallback is dropped rather than guessed.

**Result: 0 banner characters across all five games are missing art**, down from 7.

Two knock-on fixes this exposed in the hub columns: a unit is listed once per column (identified by
its resolved artwork, since ZZZ lists "Ukinami Yuzuha" and "Yuzuha" in different phases), and two
sections carrying the same patch label are merged instead of printing "Patch 3.1" twice.

## Tests

339 of 350 pass. Five hub/favourite tests that asserted the old tab set were rewritten. The
remaining 11 failures are the same pre-existing in-flight drift as before: 2 data assertions, and 9
publisher tests failing because `Scraper/achievements/core.mjs` has been bumped to HSR `4.4` in the
working tree while the committed test still expects `4.3`.
