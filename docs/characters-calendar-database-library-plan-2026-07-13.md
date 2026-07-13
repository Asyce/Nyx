# Characters, Calendar, Database, and Library follow-up — 2026-07-13

**Status:** APPROVED FOR IMPLEMENTATION — 2026-07-13. No production deployment is authorized.

This is a corrective pass over completed batches `nyx-0022`, `nyx-0023`, `nyx-0025`, and `nyx-0027`. It does not rebuild those features. New work is queued as `nyx-0032` through `nyx-0037`; the user approved implementation on 2026-07-13.

The current branch, `codex/genshin-timeline-redesign`, has existing timeline/event changes in shared and generated files. The user explicitly requested implementation in this branch. Preserve those changes and run overlapping UI batches serially.

## Sol decisions

1. Per-game favourites start **empty** and in **Icon** mode. Existing saved favourites and modes are preserved.
2. The Nyx hub has no separate favourite list. It shows the union of the user's saved favourites from all five games, defaults to **Card**, shows every card, wraps after five cards, and scrolls vertically.
3. Mavuika's released local icon already exists. First fix hub data loading and reproduce the failed surface; do not add a second asset or scrape an unsafe source.
4. A star is hidden until mouse hover or keyboard focus. Touch-only devices keep a usable star because touch has no hover.
5. Custom birthdays recur yearly, are stored only in this browser, and may use a locally uploaded icon that is resized before storage. Metadata and icon Blobs use IndexedDB; no remote icon hotlinks and no account-sync expansion.
6. Database `title`/epithet is not a monster family. Show a family only when a separately verified source field supports it.
7. Database collections must make every record reachable. Do not render thousands at once; use paging or “Load more” while preserving search and filters.
8. Library body search uses a compact, per-game inverted word index (`word -> book IDs`). It must not duplicate or eagerly download the full 9 MB book corpus.
9. Library personal formatting is a browser-local v1 feature. Store annotations separately from scraped books, use stable text anchors, and never inject user HTML.
10. GI and HSR Library data are already isolated. The visible mixed `GI & HSR archives` label is the bug.
11. No production deployment is part of any batch unless the user asks separately.

## Batch 17 — Characters and favourites (`nyx-0032`)

Primary paths:

- `Site/src/shared/pinned-favourites.js`
- `Site/src/app/nyx-app.jsx`
- `Site/src/features/materials/char-materials.jsx`
- `Site/src/styles/game-page-shared.css`
- focused favourites/character tests

### Favourites behavior

- Change missing per-game mode storage from Card to Icon.
- Remove automatic five-character seeding. Missing per-game pinned storage resolves to an empty list; do not erase existing storage.
- Place the Card/Icon control immediately beside “Pinned Favourites.”
- Remove Hide and Edit controls and their dead state/UI. Roster stars become the normal add/remove path.
- Card mode shows the first five favourites as cards and every overflow favourite as compact icons directly below. It must not force a mode switch.
- Move Pinned Favourites below the Roster / Talents / Trounce Domain selector row and above the selected section's content.
- Build the Nyx hub block from all five per-game stores. Remove the independent `nyx` seed/list, listen for changes from every game, default the hub to Card, show at most five cards per row, and allow ordinary vertical page scrolling.
- Keep the hub Card/Icon control beside “Pinned Favourites,” remove Hide/Edit there too, preserve an existing hub display preference, and use Card only when that preference is absent. Icon mode remains unlimited.

### Character controls and visuals

- Restyle Roster / Talents / Trounce Domain as compact square menu-like buttons, using the existing Nyx navigation language rather than a new design system.
- Hide the favourite star until hover/focus; keep keyboard focus visible and provide a touch-safe reveal.
- Replace element/game-specific character hover glows with one shared purple-red hover/focus token. Normal element and rarity styling stays unchanged.
- Add a bandless `CMItemFrame` variant for Talents and Trounce Domain only. Calculator/count frames keep their number band.
- Make character search a plain rectangular box with the placeholder `Search` and an accessible label.
- Replace filter initials/glyphs with the real released local element/path/class/weapon icons already mapped by `CM_META_ICONS`. Keep an honest fallback only where no approved icon exists.

### Mavuika and hub data

- Reproduce Mavuika on roster, per-game favourites, hub favourites, and Calendar.
- Ensure `/nyx` loads each required `cm-data-*.js` roster before resolving cross-game favourites instead of freezing fallback rows in `NYX_META`.
- Verify the existing `UI_AvatarIcon_Mavuika_Circle.webp` request returns 200 and the rendered image has non-zero natural dimensions. Add no duplicate asset when the existing file works.

### Acceptance

- Fresh browser: every game has no pinned entries and opens in Icon mode; hub opens in Card mode and is empty.
- Existing browser: saved pins and saved per-game mode remain unchanged.
- Eight pins in per-game Card mode render five cards plus three icons. Eleven cross-game pins on the hub render three rows and no horizontal carousel.
- The hub can switch between unlimited Card and Icon modes without changing the underlying per-game favourites.
- Mouse, keyboard, and touch can all add/remove a favourite.
- All five games show the square section controls, rectangular Search box, real filter icons, purple-red hover, and bandless Talent/Trounce item frames.

## Batch 18 — Calendar (`nyx-0033`)

Primary paths:

- a new focused Calendar storage/helper module under `Site/src/features/calendar/`
- `Site/src/app/nyx-app.jsx`
- `Site/src/features/materials/char-materials.jsx`
- `Site/src/styles/game-page-shared.css`
- focused Calendar storage and return-route tests

### Custom birthdays

- Add an “Add birthday” action and accessible Add/Edit/Delete dialog.
- Minimum record: stable ID, name, month, day, optional game/label, optional local icon, and optional short note.
- Save metadata and icon Blobs in a versioned IndexedDB store. Accept decoded PNG/JPEG/WebP input up to 10 MB, resize to at most 256×256 WebP and 256 KB before saving, and use initials when no icon is supplied. A quota failure keeps the form open and explains that the entry can be saved after freeing space or removing the icon.
- Validate real recurring month/day pairs. February 29 is allowed and its next occurrence is the next actual leap day; never silently move it to February 28 or March 1.
- Merge custom birthdays into both month cells and “Next birthdays.” Never write them into scraped/generated game data.

### Calendar polish and navigation

- Replace the current 2 px game-colored character rings with one thin 1 px purple ring, including hover/focus states.
- When Calendar opens a character, carry `from: calendar` through the route. UI Back, Escape, and browser Back return to `/nyx/calendar`; a character opened normally still returns to that game's Characters page.

### Acceptance

- Add, edit, delete, reload, month navigation, and next-birthday ordering all work for custom entries.
- Bad image files are rejected; large images are resized locally; no remote URL is stored.
- Invalid dates are rejected; February 29 remains February 29 and is ordered against its next real occurrence.
- Calendar-opened characters return to Calendar without losing selected month/game toggles/scroll position.
- Direct character links do not gain a false Calendar history entry.

## Batch 19 — Database data correctness (`nyx-0034`)

Primary paths:

- `Scraper/gamedata/games/*.mjs`
- `Database/Audits/database-missing-art.json`
- `Database/GameData/gi/assets/items/`
- `Database/GameData/hsr/assets/monsters/`
- `Database/GameData/zzz/assets/items/`
- `Database/GameData/zzz/assets/monsters/`
- `Database/GameData/ww/assets/items/`
- `Database/GameData/ww/assets/monsters/`
- `Site/tools/generate-site-data.mjs`
- generated `Site/src/data/generated/db-data-*.js`
- scraper fixtures, validation, and Database data tests

### Images and missing records

- Fix HSR `normalizeMonster()` so it preserves released `icon`, `rank`, `camp`, and weakness fields and emits a usable local asset reference.
- Audit every current no-art row against only the released records already fetched by `Scraper/gamedata` and the exact static asset URL named by that released record. Download approved small icons into `Database/GameData`; browser hotlinks, unrelated mirrors, asset packs, raw dumps, beta/test endpoints, and guessed filenames are forbidden.
- Generate `Database/Audits/database-missing-art.json` with game, collection, record ID, release status, source icon field, source URL, local destination, result, and the reason when art remains unavailable.
- Start from the measured baseline: HSR Monsters are 577/577 missing art; smaller gaps exist in GI/ZZZ/WuWa collections. Do not claim missing upstream records when the current local/source counts match.
- Add source-count -> normalized-count -> generated-count checks. Treat the UI's 400-result cap separately from ingestion.

### Rarity, text, and families

- Normalize supported rarity to numeric `1★`, `2★`, `3★`, `4★`, `5★` and sort ascending. Unknown/invalid rarity remains Unknown; never invent a star level.
- Decode literal escaped line breaks, preserve real paragraphs, and remove the fixed 160/200-character truncation from detailed descriptions.
- Keep short summaries only when explicitly labelled as summaries; modal/detail text uses the complete description.
- Stop mapping GI upstream `title` to `family`. Preserve it as an epithet/title when useful, or omit it. Add a family only from a separately verified field and audit the rest of the collection.

### Acceptance

- “The Game Before the Gate” has no visible `\\n`, is not cut off, scrolls when long, and is not labelled as a Fatui family without verified evidence.
- HSR monster assets load locally; no beta/unreleased asset enters the tree.
- Cross-game fixtures prove rarity order and unknown handling.
- No source collection silently shrinks and all generated asset references pass deploy checks.
- The missing-art audit accounts for every no-art row and contains no beta/unreleased or guessed source.

## Batch 20 — Database interface (`nyx-0035`)

Primary paths:

- `Site/src/app/nyx-app.jsx`
- `Site/src/styles/game-page-shared.css`
- focused Database navigation/filter tests
- `Site/tools/smoke-deploy.mjs`

### Layout and controls

- Flatten collection tiles: one visible frame around the image, then the name as plain text below. The whole tile remains one keyboard-usable button.
- Remove number badges from Database collection tabs, Wonderland, TCG, and Pot where the same tab pattern is used. Tighten padding/minimum width without hiding active/focus states.
- Sort applicable rarity filters numerically as `1★`, `2★`, `3★`, `4★`, `5★`; show only supported levels, keep invalid data under `Unknown`, and never order rarity by result count.
- Replace the hard 400-row dead end with paging or “Load more” so every matching record is reachable without rendering the entire collection at once.
- Put TCG Search and a Filter button on one row. Move Card Type and Tags into a pop-out based on the Characters filter pattern. Show active filters and a clear-all action.

### Back/Escape behavior

- Escape from any Database, TCG, Pot, or Wonderland detail returns to its exact prior list and restores focus, search, filters, and scroll.
- Escape on a normal list does nothing; it must not unexpectedly leave Database.
- Pop-outs close on Escape/outside click without also navigating away.

### Acceptance

- No tile has a box inside another box.
- Counts are gone and tabs remain usable without horizontal clipping at 390 px.
- Rarity filters appear in numeric order regardless of how many records each level contains.
- A record after position 400 can be found and opened.
- TCG filter pop-out is mouse-, keyboard-, and touch-usable.

## Batch 21 — Library structure, search, and selection (`nyx-0036`)

Primary paths:

- move the growing Library UI into `Site/src/features/library/`
- `Scraper/library/core.mjs` and Library tests
- `Site/tools/publish-runtime-data.mjs` and its tests
- `Site/tools/smoke-deploy.mjs`
- `Site/src/app/nyx-app.jsx` only mounts/routes the feature
- `Site/src/styles/game-page-shared.css`

### Compact full-text discovery

- During scraping, assign stable IDs to document blocks and build one compact per-game search file mapping normalized words to sorted book IDs. Normalize Unicode case, punctuation, and accents deterministically.
- Keep book bodies lazy-loaded. Do not fetch all 736 books during a search and do not duplicate the entire prose corpus in the main index.
- Title matching remains substring-based. Body matching intersects query words and marks the tile as a text match; opening a result highlights the matching word in the loaded reader.
- Add tests proving `Tanuki` returns Toki Alley Tales, queries never cross between GI and HSR, and hostile source markup remains stripped.

### Reader/interface polish

- Flatten Library tiles to one image frame with title/volume text below.
- Replace the repeated eyebrow/title/back layout with one compact header and a small Back action; return focus to the opened tile.
- Visible search label: `Search The Library`. Placeholder: `Search Title or Keyword`.
- Replace the hard-coded `GI & HSR archives` label with the active game's name.
- Override the global no-selection rule inside `.library-document` so mouse drag, keyboard selection, mobile long-press, and normal copy work.

### Acceptance

- GI shows no HSR label and HSR shows no GI label.
- Search by title and by body keyword works without loading all book files.
- Book text can be selected and copied; controls remain non-selecting and usable.
- Search payload size is measured and recorded before approval; runtime manifest/hash/allowlist tests pass.

## Batch 22 — Library personal annotations (`nyx-0037`)

Primary paths:

- `Site/src/features/library/library-annotations.js`
- Library renderer/toolbar components and focused tests
- Library styles

### Annotation model

- Store annotations in a versioned Library IndexedDB database, separate from scraped JSON and pull-history sync.
- An annotation belongs to game + book + volume and stores: stable block ID, start/end offsets, selected quote, short prefix/suffix context, style (`highlight`, `underline`, `bold`), optional plain-text note, color where relevant, and timestamps.
- Re-anchor after a scrape refresh by stable block ID first, then one unique quote/context match. If neither is safe, show the mark as needing repair instead of attaching it to the wrong text.
- User notes are plain text only. Never render them as HTML.

### Interaction

- Selecting text opens a small toolbar: Highlight, Underline, Bold, Add note, Copy, and Remove formatting.
- A note appears as a user-opened pop-up attached to the marked text and can be edited/deleted.
- Source text is never mutated. Marks survive close/reopen and stay isolated between games, books, and volumes.

### Acceptance

- Every annotation action works by mouse and keyboard; selection/copy remains native.
- At 390×844, touch selection, toolbar actions, note editing, copy, and dismissal work without blocking native long-press selection.
- Marks survive reload and a fixture with harmless surrounding-text movement.
- Ambiguous/stale anchors never move silently to unrelated prose.
- Notes cannot inject scripts, links, or markup.

## Execution order and gates

After the dirty timeline work is safely finished or separated, use two non-overlapping lanes:

- UI lane: `nyx-0032` Characters/favourites -> `nyx-0033` Calendar.
- Data lane: `nyx-0034` Database data correctness may run independently of `nyx-0032`/`0033` because it does not touch the app shell or shared CSS.
- Join: `nyx-0035` starts only after both `nyx-0033` and `nyx-0034` are done.
- Finish serially: `nyx-0035` Database interface -> `nyx-0036` Library search/reader -> `nyx-0037` Library annotations.

Only non-overlapping batches may be ready concurrently. The single active UI-lane task (`nyx-0032`, then `nyx-0033`) may overlap with `nyx-0034`; `nyx-0035` waits for both lanes, and everything after the join is serial. Each batch gets an author and a different verifier under the CEO framework.

Every batch runs its focused tests plus the relevant full gates:

- `Scraper`: `npm test`, `npm run validate:strict`
- `Site`: focused feature tests, `npm run build:deploy`, `npm run smoke:deploy`
- Browser QA through the Chrome extension at `390x844`, `1600x900`, and `2560x1080`
- No blank primary UI, clipped modal/sheet content, unreadable labels, missing keyboard focus, overlapping controls, broken images, console errors, or unsafe assets

The Talents/Trounce frame is interpreted as the current item container with its bottom number band removed. Compare the implementation to the supplied reference image during visual QA.
