# Achievement tracker finished-product direction

Date: 2026-07-14
Queue: `nyx-0053`
Owner: `codex-achievement-ui`

## Outcome

Turn the current usable ledger into a first-class Nyx module for Genshin Impact and Honkai: Star Rail. A player should immediately understand overall progress, recognise categories from their released in-game artwork, find a missing achievement quickly, inspect useful context, mark it manually, and safely import or manage account progress without leaving the page.

This remains a local-first fan tool. It must not look like an official HoYoverse screen, store progress in Pengo pull-history data, upload account files, or expose beta/unreleased content as live progress.

## Evidence behind the direction

- The current page has solid foundations: a local profile store, safe additive import preview, backup/restore, per-category counts, search, status filtering, and manual checkboxes.
- Its main visual weakness is hierarchy. The screen is a dark rectangular database with two-letter category monograms, a flat 1,700+ row list, and import controls competing with progress for attention.
- Seelie's most useful patterns are icon-led categories, overall/category/row progress, version search, and per-category bulk action. Paimon.moe's most useful pattern is pairing achievement progress with the reward-currency total.
- The local catalogs already contain GI stages and HSR rarity, but the interface does not expose either. The catalogs contain no icon fields today.
- Released icon sourcing is viable without hotlinking: GI has one known in-game category icon ID for each of 69 released categories; HSR has nine released category icons available through its public wiki's MediaWiki file API. All assets will be mirrored locally with provenance.

## Structure alternatives considered

### 1. Category wall, then a separate category page

Very visual, but 69 GI categories become a long wall and force unnecessary navigation. Rejected.

### 2. Keep the existing narrow rail and flat ledger

Fast and familiar, but even with real icons it would still feel like a reskinned database and would not solve hierarchy, mobile density, or the all-category view. Rejected.

### 3. Celestial archive: summary observatory + category atlas + focused ledger

Selected. The page opens with one strong progress composition, followed by a two-column archive. The left atlas uses real medallions and progress; the right side gives the selected category a proper header, filters, and a bounded ledger. On mobile, the atlas becomes a compact category drawer rather than a horizontally scrolling wall.

## Visual system

The signature element is the **Astral Seal**: a large category medallion held inside a Nyx orbital progress instrument. It changes when the category changes, shows the category fraction and completion ring, and makes released game artwork the visual centre without copying an official layout.

Compact palette:

- `Void ink` `#080713` — page depth.
- `Ledger` `#121027` — primary reading surface.
- `Orbit violet` `#8D78FF` — Nyx interaction and focus.
- `Relic gold` `#E7C778` — earned value and completion.
- `Moon pearl` `#F3F0FF` — primary text.
- `Dusk` `#A8A0BA` — supporting text.

Game variants only tint the orbit light: warm lunar gold for GI and cool astral cyan for HSR. Purple remains the Nyx ownership signal.

Typography:

- `GI` display face for the editorial title, category title, and achievement names.
- `HSR` UI face for controls, counts, metadata, and body copy.
- Monospace only for IDs and compact version labels.

Surfaces use quiet one-pixel borders, shallow inner lines, and restrained radial light. Avoid stacked gradient cards, oversized generic statistics, glass blur everywhere, and decorative animation unrelated to progress.

## Page anatomy

### Observatory header

- Page identity and local-only promise.
- Astral Seal for overall completion until a category is selected.
- Achievement fraction and percentage with real `progressbar` semantics.
- Reward currency earned / available using the locally mirrored Primogem or Stellar Jade icon.
- Completed categories and remaining achievements as supporting facts, not separate dashboard cards.
- Profile switcher plus one `Manage` button. Import, export, rename, UID, create, and delete live in the management sheet instead of dominating the page.

### Category atlas

- Searchable list of real category medallions.
- Each entry shows name, done/total, percent, and a small orbit ring.
- `All achievements` is a Nyx eye seal rather than fake game artwork.
- Optional `Hide completed` control.
- Selected category remains obvious through border, light, and text—not colour alone.
- Mobile uses a full-width category button that opens an inline drawer/sheet with 44px targets.

### Focused ledger

- Category header contains its large real icon, name, description-quality summary (progress/reward/version range), and category-level completion action behind confirmation.
- Search, completion state, version, reward value, HSR rarity, and sort controls.
- Sort options: source order, incomplete first, newest version, reward high-to-low, and name.
- Visible filter summary with one `Clear` action.
- Rows show manual completion control, name, requirement, version, stable ID, reward icon/value, GI stage or HSR rarity, and category identity in the all-category view.
- Multi-stage GI achievements remain separate stored IDs but gain `Stage n of m` context.
- Clicking row content reveals an inline detail panel; the check control stays independent.
- Long results render progressively in deterministic batches. Filtering and completion preserve the user's place.

### Management sheet

- Tabs/sections: `Import progress`, `Profile`, and `Backup`.
- Import accepts the existing Pengo/Stardb-compatible JSON, clearly labels the detected game, previews new/already-known/unknown/invalid values, and names a small sample of newly matched achievements.
- Import mode is explicit: `Merge` is the safe default; `Replace` requires a typed or two-step confirmation and changes only the selected profile/game.
- Profile exposes label and optional UID, create, rename, and delete. The final profile cannot be deleted without creating a replacement.
- Backup can export the selected profile or all profiles. Restore remains additive unless an explicit selected-profile replace path is chosen.
- Reset progress is isolated in a danger area with confirmation.

## Data and asset contract

Catalog categories gain an optional local icon descriptor:

```json
{
  "icon": {
    "path": "/assets/achievements/gi/categories/UI_AchievementIcon_O001.webp",
    "sourceKey": "UI_AchievementIcon_O001"
  }
}
```

The UI treats all icon data as optional and keeps the current generated symbol as the accessible fallback. No remote URL is rendered by the client.

Asset rules:

- Only small released/live category and reward UI icons.
- Mirror under `Database/Achievements/<game>/assets/` and publish under `/assets/achievements/<game>/`.
- Record source page/API URL, resolved asset URL, hash, byte count, media type, retrieval time, and released version in provenance.
- Build validation rejects remote runtime paths, missing files, invalid media types, and incomplete category mapping.
- Never fetch assets in the browser and never rely on a third-party host at runtime.

## Progress and storage behaviour

- Existing profile IDs and completed achievement IDs remain compatible.
- Catalog load reconciles an imported unknown ID when that ID becomes known: it moves from `unknownIds` to `completedIds` once, locally.
- Manual toggles update local component state immediately and then persist, avoiding a full 1,800-row profile refresh.
- A `storage` listener refreshes the active profile when another tab changes it.
- Read-only catalog browsing remains available if local storage fails; only completion controls and management actions are disabled.
- Merge never removes a checkmark. Replace, reset, and delete always show exactly what will be removed.
- No completion dates are invented for imported IDs. Future schema changes may store manual timestamps, but this release will not imply history that does not exist.

## Responsive and accessibility contract

- Required checks: 390×844, 1600×900, 2560×1080.
- No fixed viewport-height workspace and no nested 68vh list on mobile.
- Primary controls are at least 44px on touch layouts.
- Progress uses `role="progressbar"` with min/max/current values.
- Every icon has meaningful alt text when informative and empty alt text when adjacent text already names it.
- Selection and completion states have text/semantic signals, not colour alone.
- Category sheet, management sheet, and row detail support Escape, predictable focus, and focus return.
- Reduced motion removes orbit transitions and sheet movement.
- Text critical to using the page is at least 12px; metadata may be smaller but remains readable and sufficiently contrasted.

## Empty, loading, error, and complete states

- Loading uses a ledger skeleton with a plain text status.
- Catalog failure retains the page shell and offers retry.
- Storage failure still shows the catalog and explains that checkmarks are temporarily unavailable.
- Empty filters name the active restriction and offer `Clear filters`.
- A zero-progress profile guides the user to import or mark manually.
- A fully completed category replaces urgency copy with a calm completion seal and keeps browsing available.
- Unknown imported IDs are inspectable and honestly described; they never inflate the visible completion percentage.

## Verification

- Catalog generation tests cover icon mapping, local paths, media type, hashes, and all released categories.
- Runtime publisher tests cover local asset copying and traversal/remote-path rejection.
- Import/storage tests cover merge, replace, reset, selected-profile export, unknown-ID reconciliation, rollback, and cross-game isolation.
- Pure view-model tests cover combined filters, every sort mode, category-atlas filtering, semantic versions, reward shapes, stable IDs, and progressive rendering. Browser QA covers category selection, dialogs, focus, responsive layout, and accessible semantics.
- Build and deploy smoke must pass with both real catalogs.
- Browser QA uses a synthetic populated profile by default. A user-authorized real export may be loaded only into localhost browser storage for validation; it is never copied into the repository, logs, screenshots, or handoff. All three required viewports, keyboard/focus, icons, and console output are checked.

## Required disclaimer

PENGO • Nyx is an unofficial fan-made tool and is not affiliated with HoYoverse.
Game content and assets are owned by HoYoverse / COGNOSPHERE / miHoYo.
Other properties belong to their respective owners.
