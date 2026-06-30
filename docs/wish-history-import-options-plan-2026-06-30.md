# Wish History Import Options Plan

Date: 2026-06-30

Scope: Nyx/Pengo pull-history import for Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Wuthering Waves, and Arknights: Endfield.

Current product-direction updates after user feedback are in `docs/report-feedback-decisions-2026-06-30.md`. That file supersedes earlier wording where it differs, especially around keeping both quick PowerShell and safer verified import paths.

This plan is separate from the main codebase review. It focuses only on how Nyx can import pull/wish/warp/signal/convene/headhunting history as easily and safely as possible for the largest number of users.

## Executive summary

Nyx should support many import paths, but the default path should be the safest practical one for each game.

The best import strategy is:

1. Use a canonical internal pull archive format in Nyx.
2. Support standard file imports first.
3. Keep live URL import for HoYo and Wuwa.
4. Provide both a quick Pengo-hosted helper command and a safer download/inspect/hash-verify helper path for PC users.
5. Treat Endfield differently: prefer local extraction to JSON/CSV, because current community sources indicate Endfield access-token exposure is riskier than HoYo/Wuwa history URLs.
6. Support imports from existing trackers where possible.
7. Provide manual backfill for users whose server-side history expired.
8. Keep everything local-first, with optional sync/export only after users choose it.

The most user-friendly final product is an import wizard:

- Pick game.
- Pick source:
  - PC auto-detect
  - paste URL/token
  - upload file
  - import from another tracker
  - mobile-only help
  - manual backfill
- Preview parsed records.
- Merge/dedupe.
- Show exactly what was imported, skipped, and stored.
- Offer export/backup immediately.

## Research summary

### Standard formats

UIGF v4.2 is the main standard for HoYo-family gacha logs. The current UIGF standard says it merges supported game formats into one file/string and supports Genshin, Honkai: Star Rail, and Zenless Zone Zero data sections. It also says applications should implement both import and export to claim support, because one-way support reduces user data portability. Source: [UIGF v4.2 standard](https://uigf.org/en/standards/uigf.html).

UIGF v4.0 merged earlier Genshin UIGF and Star Rail SRGF and added Zenless Zone Zero support; v4.0+ is not backward compatible with UIGF v3.0/SRGF v1.0. Source: [UIGF v4.0 legacy standard](https://uigf.org/en/standards/uigf-legacy-v4.0.html).

The UIGF partnership page shows current ecosystem support across tools such as Snap Hutao and others, including import/export support for UIGF v4.2. Source: [UIGF home/partnership listing](https://uigf.org/en/).

### HoYo history limits

Genshin officially expanded its in-game Wish history view from 6 months to 1 year in Version 4.5. Source: [Genshin Version 4.5 update details](https://genshin.hoyoverse.com/en/news/detail/122817).

HoYoverse support says HSR Warp records can take up to one hour to appear, records page history displays the last six months, older records are still counted for pity, and some collaboration warp history shows 24 months. Source: [HoYoverse HSR Warp history support article](https://support.hoyoverse.com/hc/en-us/articles/50913754903577-How-can-I-check-my-Warp-history-and-why-aren-t-my-latest-pulls-showing-up).

Third-party ZZZ trackers continue to warn that HoYo-style histories are limited and should be backed up. Source: [stardb ZZZ signal tracker updates](https://stardb.gg/en/posts/signal-tracker-updates).

### Existing import UX patterns

Paimon.moe focuses on importing/backing up Genshin Wish history and offers Google Drive sync. Source: [Paimon.moe import page](https://paimon.moe/wish/import).

Snap Hutao supports UIGF import/export, older UIGF upgrading, multi-account export, and cloud sync. Source: [Snap Hutao Wish History](https://snaphutaorp.org/en/features/wish-export).

stardb's import pages for Genshin, HSR, and ZZZ use Windows PowerShell one-liners and also list alternate imports from existing trackers or standards. Sources: [stardb Genshin wish import](https://stardb.gg/en/genshin/wish-import), [stardb HSR warp import](https://stardb.gg/en/warp-import), [stardb ZZZ signal import](https://stardb.gg/en/zzz/signal-import).

rng.moe's ZZZ privacy policy says imported signal history is saved locally, signal links are sent temporarily for import, and global-stat contributions store pull metadata if users opt into stats. Source: [rng.moe privacy policy](https://zzz.rng.moe/en/privacy).

WuWa Tracker public strings describe PC, Android, and iOS import tutorials and pull tracking/global stats. Source: [WuWa Tracker i18n metadata](https://github.com/wuwatracker/i18n/blob/main/en.json).

Community Wuthering Waves scripts extract the Convene History URL from local game logs, and at least one gist explicitly says the script only reads files and copies the URL to the clipboard. Source: [Wuthering Waves Convene History URL gist](https://gist.github.com/Luzefiru/19c0759bea1b9e7ef480bb39303b3f6c).

For Endfield, current community tooling is newer and riskier. There are scripts that retrieve gacha history URLs/tokens, trackers already show Endfield pull tracking, and community discussion calls out token exposure risks and mutable remote scripts. Sources: [ak-endfield-gacha-link-gen](https://github.com/daydreamer-json/ak-endfield-gacha-link-gen), [TrackMyPulls Endfield tracker](https://trackmypulls.com/en/endfield/tracker), [WuWa Tracker article discussing Endfield token risk](https://wuwatracker.com/articles/is-wuwatracker-or-any-third-party-tool-safe-to-use), [puyomi2k gacha-tracker note about mutable script risk](https://github.com/puyomi2k/gacha-tracker), [TrackMyPulls Endfield token extractor script](https://raw.githubusercontent.com/an2nin/trackmypulls-extras/master/scripts/endfield.ps1), and [ake-tracker Endfield importer notes](https://github.com/mmgfrcs/ake-tracker).

## Current Nyx state

Nyx currently has:

- Live URL import for Genshin through `/api/gacha/genshin`.
- Live URL import for HSR through `/api/gacha/hsr`.
- Live URL import for ZZZ through `/api/gacha/zzz`.
- Live URL import for Wuthering Waves through `/api/gacha/wuwa`.
- IndexedDB local storage for imported records.
- UIGF import for Genshin, HSR, and ZZZ.
- Paimon Excel import for Genshin.
- Best-effort Wuwa file import.
- No Endfield live adapter yet.

Important implementation update:

- The app should not expose old `asyce.com/asivepulled` helper commands. The active helper path should be the Pengo-hosted `pengo-pulls.ps1`, paired with a published SHA-256 and plain-language safety explanation.

## Product principles

### Principle 1 - User control over portability

Nyx should import and export wherever possible. If Nyx can import a format but not export it, user data becomes sticky. UIGF specifically warns against one-way support for that reason.

### Principle 2 - Local-first by default

The safest default is:

- history records stored in browser IndexedDB
- no account required
- no token retained
- no global stats contribution by default
- export available immediately

### Principle 3 - Make quick helper commands transparent

Quick remote execution can stay as an option for users who explicitly want the fastest path, but it should not be the only path. If a script is needed:

- host a versioned script file
- publish the SHA-256
- verify hash in the UI and build
- let users download, inspect, verify, and run it
- provide a signed helper app later

### Principle 4 - Token sensitivity differs by game

HoYo authkey history URLs and Wuwa record URLs are sensitive, but generally limited to gacha history. Endfield access tokens appear broader/riskier in community discussion, so Endfield should prefer local extraction to file rather than sending tokens through Pengo.

### Principle 5 - Always preview before save

Every import path should produce a preview:

- game
- UID/account
- record count
- date range
- banner categories
- duplicates found
- new records to add
- source/provenance

No import should silently mutate storage.

## Canonical Nyx pull archive

Before adding many import paths, define one canonical internal archive.

Suggested shape:

```json
{
  "format": "nyx-pulls",
  "version": 1,
  "exportedAt": 1782864000,
  "exportedBy": "Pengo Nyx",
  "accounts": [
    {
      "game": "gi",
      "uid": "600000000",
      "server": "os_usa",
      "timezone": -5,
      "label": "Main account",
      "records": [
        {
          "id": "1234567890",
          "banner": "character",
          "sourceBanner": "Character Event Wish",
          "name": "Skirk",
          "itemId": "10000111",
          "itemType": "character",
          "rank": 5,
          "time": 1782864000000,
          "rawTime": "2026-06-30 14:00:00",
          "part": "",
          "source": "live-url",
          "raw": {}
        }
      ]
    }
  ]
}
```

Rules:

- Store exact raw time strings for standard export compatibility.
- Store normalized epoch for sorting.
- Preserve raw records optionally for future format upgrades.
- Use stable dedupe keys:
  - HoYo: game + uid + record id
  - Wuwa: game + uid + synthetic id or upstream id if available
  - Endfield: game + uid + upstream record id if available, else time + item + banner + sequence
- Track source provenance:
  - `live-url`
  - `uigf`
  - `srgf`
  - `wwgf`
  - `csv`
  - `tracker-export`
  - `manual`
  - `sample`
  - `local-helper`

## Import options overview

### Option A - Upload standard export files

Supported formats to implement:

- UIGF v4.2 for Genshin, HSR, ZZZ.
- UIGF v4.1/v4.0 for compatibility.
- Legacy UIGF v3 for Genshin.
- SRGF v1 for HSR.
- Paimon.moe JSON export.
- Snap Hutao UIGF export.
- Genshin Wish Export UIGF export.
- Star Rail Station export JSON/CSV if format can be identified.
- stardb exports if user-accessible.
- rng.moe ZZZ export JSON.
- WuWa Tracker export if available.
- WWGF/community Wuwa JSON variants.
- Endfield CSV/JSON from local scripts and community trackers.
- Generic CSV template for manual import.

Pros:

- Safest and most privacy-preserving.
- Works for users who already backed up data.
- Works after server history expires.
- No token/authkey needs to pass through Pengo.
- Easiest to test with fixtures.
- Enables migration from other trackers.

Cons:

- Users need an existing export.
- Every external tracker format can drift.
- Some trackers do not document export schema clearly.
- Does not help first-time users with no backup.

Implementation priority:

1. UIGF v4.2 import/export.
2. Legacy UIGF/SRGF import.
3. Paimon.moe JSON.
4. rng.moe JSON.
5. Wuwa flexible JSON/CSV.
6. Endfield CSV/JSON.
7. Star Rail Station and stardb formats after collecting fixtures.

### Option B - Paste live history URL/token

Current Nyx already supports this for HoYo and Wuwa.

Pros:

- Simple once the URL is obtained.
- No file handling required.
- Browser UI can walk every banner and dedupe.
- Good for PC users who can extract the URL.

Cons:

- Obtaining the URL is the hard part.
- URLs contain sensitive auth material.
- HoYo/Kuro APIs usually require a server-side proxy because of CORS.
- Users must trust Pengo not to store/log the URL.
- Endfield token paste is riskier and should not be the default.

Recommended use:

- Keep for Genshin, HSR, ZZZ, Wuwa.
- Do not make this the primary Endfield method.
- Add explicit "Pengo temporarily sends this through the Worker and does not store it" text.
- Add a local-only fallback where possible.

### Option C - Verified local helper script

A Pengo-hosted script reads local logs/cache and copies the relevant URL or writes a local JSON export.

Per-game behavior:

- Genshin: read `output_log.txt` and web cache for authkey URL.
- HSR: read `Player.log` and web cache for authkey URL.
- ZZZ: read `Player.log` and web cache for authkey URL; include `real_gacha_type`.
- Wuwa: read `Client.log` for convene URL/record fields.
- Endfield: read PlatformProcess/HGWebview cache/token, then preferably fetch records locally and write JSON/CSV.

Pros:

- Most practical PC path.
- Can be open-source and inspectable.
- Can avoid remote executable one-liners.
- Can support multiple games with one script.
- Can output a file for safer import.

Cons:

- Windows-focused for most users.
- PowerShell execution policy can be scary.
- Antivirus or OS permissions can interfere.
- Still requires users to run a script.
- Endfield token handling needs extra caution.

Recommended UX:

1. Download script.
2. Show SHA-256.
3. Let user verify hash.
4. Run:
   - `powershell -ExecutionPolicy Bypass -File pengo-pulls.ps1 -Game gi`
5. Script either copies URL or writes `pengo-pulls-<game>-<uid>.json`.
6. User uploads/pastes output.

Better long-term UX:

- Signed Pengo Helper app.
- No remote code execution.
- Auto-updater with signed releases.
- Local-only export to file.

### Option D - Signed native helper app

Build a small Tauri/Electron/native helper that handles URL extraction and local export.

Pros:

- Best experience for PC users.
- Can be signed.
- Can auto-detect games.
- Can produce JSON files instead of exposing tokens in the browser.
- Can support multiple accounts.
- Can be open-source.

Cons:

- More maintenance.
- Code signing cost/process.
- Platform-specific testing.
- Users may hesitate to install another app.
- Requires release/security process.

Recommended approach:

- Start with scripts.
- Build a helper only after import logic stabilizes.
- Prefer Tauri or a small native CLI over a large Electron app if possible.

### Option E - Import from existing trackers

Targets:

- Paimon.moe for Genshin.
- Snap Hutao for Genshin.
- Genshin Wish Export for Genshin.
- Star Rail Station for HSR.
- Pom.moe if users have HSR exports.
- stardb for Genshin/HSR/ZZZ if export is user-accessible.
- rng.moe for ZZZ.
- WuWa Tracker for Wuwa.
- TrackMyPulls/Goyfield/Endfield tools for Endfield if they export.

Pros:

- Helps users migrate existing histories.
- Recovers records no longer on game servers.
- Builds trust because users keep ownership.
- Good way to bootstrap Nyx with real data.

Cons:

- Export formats vary.
- Some sites require accounts.
- Some sites may not export all records.
- Need ongoing fixture updates.

Implementation strategy:

1. Add drag-and-drop file import with auto-detect.
2. Detect by top-level keys and sample records.
3. Show "Detected Paimon.moe export" or similar.
4. Normalize to Nyx canonical archive.
5. Store import source in account metadata.

### Option F - Mobile-only import guides

Mobile-only users need a path even if it is not as easy as PC.

Possible methods:

- Import from an existing tracker that already supports mobile.
- Use a local network helper on a PC and transfer with QR code.
- Use Android ADB/log extraction where feasible.
- Use local VPN/proxy capture with clear warnings.
- Manual backfill.

Pros:

- Covers a large user group.
- Reduces "PC only" frustration.
- Can be documented without needing immediate automation.

Cons:

- iOS is difficult without proxy/certificate flows.
- Proxy/MITM workflows are high-friction and easy to explain badly.
- Security risk is higher.
- Game updates can break methods.

Recommended stance:

- Do not make proxy/MITM the default.
- Offer mobile import as "advanced".
- Prefer file imports and existing tracker exports for mobile users.
- Provide a QR transfer from desktop helper to phone for users who can briefly access a PC.

### Option G - Manual backfill

Manual import should support:

- current pity
- last 5-star/6-star item
- guarantee state
- known past pulls from screenshots
- CSV rows
- "only notable pulls" mode

Pros:

- Works when server history is gone.
- Works for console/mobile-only users.
- Works for privacy-sensitive users.
- Low technical risk.

Cons:

- Less accurate.
- Cannot reconstruct full 3-star/low-rarity history.
- User effort is high.
- Mistakes affect pity calculations.

Recommended UX:

- "I only know my current pity" path.
- "I have screenshots" path.
- CSV template download/upload.
- Mark manual records clearly.
- Let manual records coexist with imported real records.

### Option H - Cloud backup/sync import

Future paths:

- Google Drive appDataFolder.
- Local file backup.
- Pengo account/D1 sync.
- WebDAV or Dropbox later.

Pros:

- Prevents future data loss.
- Makes device migration easy.
- Helps mobile users after initial import.

Cons:

- Requires authentication design.
- Raises privacy obligations.
- Sync conflict resolution needed.
- More support burden.

Recommended stance:

- Export/import local file first.
- Add optional Drive or account sync only after local data management is mature.

## Game-by-game plan

## Genshin Impact

Current Nyx support:

- Live URL import through authkey URL.
- UIGF import.
- Paimon Excel import.

Recommended import options:

1. Upload UIGF v4.2/v4.1/v4.0.
2. Upload legacy UIGF v3.
3. Upload Paimon.moe JSON.
4. Upload Snap Hutao UIGF.
5. Upload Genshin Wish Export UIGF.
6. Paste history URL.
7. Pengo local script URL extraction.
8. Future signed helper app.
9. Manual backfill.

Specific notes:

- Genshin has the strongest standard ecosystem.
- Official Genshin Version 4.5 notes expanded viewable Wish records from 6 months to 1 year.
- Nyx should export UIGF v4.2 for Genshin to be a good ecosystem citizen.

Priority:

- High. This is the easiest game to make excellent.

## Honkai: Star Rail

Current Nyx support:

- Live URL import.
- UIGF import.

Recommended import options:

1. Upload UIGF v4.2/v4.1/v4.0.
2. Upload SRGF v1.
3. Import Star Rail Station export after collecting fixtures.
4. Import Pom.moe export if format can be identified.
5. Import stardb export if user-accessible.
6. Paste history URL.
7. Pengo local script URL extraction.
8. Future signed helper app.
9. Manual backfill.

Specific notes:

- HoYoverse support says most Warp records page history displays the last six months, with collaboration warp history showing 24 months.
- HSR has extra banner types: character, light cone, standard, departure, collab character, collab light cone.
- UIGF v4.1 added support for new HSR pool types introduced in Star Rail v3.4.

Priority:

- High. Existing adapter is already wired; file compatibility is the next win.

## Zenless Zone Zero

Current Nyx support:

- Live URL import.
- UIGF import.

Recommended import options:

1. Upload UIGF v4.2/v4.1/v4.0.
2. Upload rng.moe export JSON.
3. Upload stardb export if user-accessible.
4. Paste signal history URL.
5. Pengo local script URL extraction.
6. Future signed helper app.
7. Manual backfill.

Specific notes:

- ZZZ requires `real_gacha_type` for live API calls in Nyx's current code.
- ZZZ has Agent, W-Engine, Bangboo, and Stable channels.
- rng.moe explicitly documents local storage and temporary signal-link use, which is a useful privacy model to study.

Priority:

- High. ZZZ has active tracker ecosystem and Nyx already has an adapter.

## Wuthering Waves

Current Nyx support:

- Live URL import through Wuwa record fields.
- Best-effort JSON file import.

Recommended import options:

1. Paste Convene History URL.
2. Pengo local script extraction from `Client.log`.
3. Upload Wuwa Tracker export if available.
4. Upload flexible WWGF/community JSON.
5. Upload CSV.
6. Future signed helper app.
7. Mobile advanced guide, after careful safety review.
8. Manual backfill.

Specific notes:

- Wuwa's flow differs from HoYo. Nyx parses `player_id`, `record_id`, and `svr_id`.
- Community Wuwa scripts read local logs and copy the history URL.
- WuWa Tracker advertises import tutorials for PC, Android, and iOS, but Nyx should not copy those blindly without auditing the actual method.
- Wuwa has multiple banner pools: featured resonator, featured weapon, standard resonator, standard weapon, beginner, selector variants.

Priority:

- Medium-high. Existing support is promising, but file import should be hardened with fixtures.

## Arknights: Endfield

Current Nyx support:

- No live adapter in current source.
- Game page has tracker labels, but import is not implemented.

Recommended import options:

1. Local script generates JSON/CSV file, then user uploads it.
2. Upload community Endfield CSV/JSON exports.
3. Manual backfill.
4. Experimental paste token/history URL only behind explicit warnings.
5. Future signed helper app for local-only extraction.

Specific notes:

- Current community tooling exists, including gacha history URL generators and pull trackers.
- Community discussion around Endfield is more security-sensitive because token exposure may be broader than HoYo/Wuwa history URLs.
- A raw TrackMyPulls Endfield script describes extracting the latest token from PlatformProcess cache data.
- A community article warns that Endfield access-token handling exposes users to more risk.
- Therefore, Nyx should not rush an Endfield Worker proxy that accepts tokens. The safer first implementation is local extraction to file.

Priority:

- Medium, but high caution.

Recommended Endfield path:

1. Add `ae` canonical record model and banner categories.
2. Build CSV/JSON import first.
3. Add manual backfill.
4. Add a local helper script that fetches Endfield history locally and outputs `nyx-pulls` JSON.
5. Only after threat modeling, consider a Worker endpoint for token-based live import.

## Import wizard design

### Entry screen

Title:

- `Import Pull History`

Game selection:

- Genshin Impact
- Honkai: Star Rail
- Zenless Zone Zero
- Wuthering Waves
- Arknights: Endfield

Source selection:

- `I play on PC`
- `I have an export file`
- `I use another tracker`
- `I only play on mobile`
- `I want to enter pity manually`

### Recommended path logic

Genshin:

- PC: verified Pengo script or helper.
- File: UIGF/Paimon/Snap.
- Tracker: Paimon/Snap/GWE/stardb.
- Mobile: import existing tracker file or manual; advanced guide.
- Manual: pity/backfill.

HSR:

- PC: verified Pengo script/helper.
- File: UIGF/SRGF.
- Tracker: Star Rail Station/Pom/stardb.
- Mobile: import tracker file or manual.
- Manual: pity/backfill.

ZZZ:

- PC: verified Pengo script/helper.
- File: UIGF/rng.moe/stardb.
- Tracker: rng.moe/stardb.
- Mobile: rng.moe export or manual.
- Manual: pity/backfill.

Wuwa:

- PC: verified Pengo script/helper.
- File: Wuwa Tracker/WWGF/flexible JSON/CSV.
- Tracker: WuWa Tracker.
- Mobile: advanced guide or tracker export.
- Manual: pity/backfill.

Endfield:

- PC: local helper outputs file.
- File: CSV/JSON.
- Tracker: TrackMyPulls/Goyfield/other export if available.
- Mobile: manual or tracker export.
- Manual: pity/backfill.

### Preview screen

Show:

- detected game
- detected source
- UID/account
- server/region if known
- earliest/latest record
- records by banner
- records by rarity
- duplicates to skip
- new records to add
- warnings:
  - sample/manual data
  - token-sensitive import
  - server history limit
  - unsupported banner category

Buttons:

- `Import`
- `Export backup first`
- `Cancel`

### Post-import screen

Show:

- imported count
- skipped duplicate count
- total records now stored
- backup/export button
- delete import button
- "set reminder to re-import" later

## Parser and converter architecture

Add modules:

- `detect-import-format.js`
- `parse-uigf.js`
- `parse-uigf-legacy.js`
- `parse-srgf.js`
- `parse-paimon.js`
- `parse-rngmoe.js`
- `parse-wuwa.js`
- `parse-endfield.js`
- `parse-csv.js`
- `normalize-pull-record.js`
- `export-nyx-pulls.js`
- `export-uigf.js`
- `merge-pulls.js`

Each parser returns:

```js
{
  ok: true,
  source: "uigf-v4.2",
  accounts: [
    {
      game: "hsr",
      uid: "800000000",
      timezone: 8,
      records: []
    }
  ],
  warnings: []
}
```

Do not write to IndexedDB inside parsers. The wizard should call parsers, preview, then save.

## Dedupe strategy

### HoYo

Primary:

- record `id`

Fallback:

- game + uid + banner + raw time + item id/name + rank

### Wuwa

Primary:

- upstream id if present

Fallback:

- player id + cardPoolType + time + resourceId + count/index

### Endfield

Primary:

- upstream record id if found

Fallback:

- account id + banner + time + item id/name + rarity + sequence

### Manual records

Manual records should use generated ids prefixed with:

- `manual:<uuid>`

Manual records should never dedupe away real imported records unless the user explicitly confirms.

## Privacy model

### Low-risk imports

- Upload file.
- Manual entry.
- Local helper writes JSON and user uploads it.

Storage:

- browser IndexedDB only unless user chooses export/sync.

### Medium-risk imports

- Paste HoYo authkey URL.
- Paste Wuwa record URL.

Handling:

- send through Worker only to fetch records
- no logging request body
- no storing token/authkey
- no global stats by default
- no third-party analytics on import page

### High-risk imports

- Endfield access token paste.
- Proxy/MITM mobile capture.
- Any method requiring remote script execution.

Handling:

- not default
- separate warning
- prefer local-file method
- never use for public global stats without explicit separate consent

## Pros and cons by implementation path

| Path | Ease | Coverage | Privacy | Maintenance | Recommendation |
|---|---:|---:|---:|---:|---|
| UIGF/SRGF upload | Medium | High for HoYo | High | Low | Build first |
| Tracker export upload | Medium | High | High | Medium | Build after fixtures |
| Paste HoYo URL | Medium | High | Medium | Medium | Keep, improve UX |
| Paste Wuwa URL | Medium | Medium | Medium | Medium | Keep, harden |
| Endfield token paste | Medium | Medium | Low | Medium | Avoid as default |
| Verified script | Medium | High PC | Medium-high | Medium | Primary PC path |
| Signed helper app | High | High PC | High | High | Long-term best |
| Mobile proxy guide | Low | Medium | Low | High | Advanced only |
| Manual backfill | Medium | Universal | High | Low | Always offer |
| Cloud sync | High | Universal after import | Medium | High | Later |

## Recommended implementation phases

### Phase 1 - Fix and stabilize existing tracker import

Tasks:

1. Remove old prototype helper commands.
2. Provide both quick Pengo command and verified local script flows.
3. Add provenance badges.
4. Separate sample mode.
5. Add parser preview flow.
6. Add delete/export controls.

Acceptance:

- Existing GI/HSR/ZZZ/Wuwa live import still works.
- No default remote executable command appears.
- Sample data is never mistaken for real data.

### Phase 2 - Build file import foundation

Tasks:

1. Add canonical `nyx-pulls` archive.
2. Add parser interface.
3. Add UIGF v4.2 import for GI/HSR/ZZZ.
4. Add legacy UIGF v3 and SRGF import.
5. Add export to UIGF v4.2 for GI/HSR/ZZZ.
6. Add fixtures and unit tests.

Acceptance:

- Valid UIGF v4.2 fixture imports.
- Invalid schema gives clear errors.
- Exported Nyx records validate with UIGF schema where applicable.

### Phase 3 - Add tracker migration imports

Tasks:

1. Paimon.moe JSON.
2. Snap Hutao UIGF compatibility.
3. Star Rail Station after fixture collection.
4. rng.moe ZZZ export.
5. Wuwa flexible JSON/CSV.
6. Endfield CSV/JSON.

Acceptance:

- Each parser has at least two fixtures when possible.
- Auto-detect identifies source correctly.
- Preview warns on partial/unknown fields.

### Phase 4 - Harden PC helper

Tasks:

1. Rebrand `pengo-pulls.ps1`.
2. Add per-game modes.
3. Add `-OutputFile` mode.
4. Add `-Clipboard` mode.
5. Add `-NoNetwork` where applicable.
6. For Endfield, default to local fetch/write file if technically feasible.
7. Build-time SHA check.

Acceptance:

- Script can output a file for all supported games where extraction is implemented.
- Hash in UI always matches file.
- Script has no old project URLs.

### Phase 5 - Add Endfield experimental support

Tasks:

1. Research exact Endfield record API from audited open-source scripts.
2. Implement local-file parser.
3. Add manual Endfield banner model.
4. Add local helper output file.
5. Add optional token paste only if threat model approves it.

Acceptance:

- Endfield import can work without sending token to Pengo.
- Token paste, if implemented, is disabled by default or behind explicit warning.

### Phase 6 - Mobile support

Tasks:

1. Add mobile-only wizard branch.
2. Add tracker-export instructions.
3. Add QR transfer from desktop helper output.
4. Add manual backfill.
5. Evaluate Android and iOS methods separately.

Acceptance:

- Mobile-only users have at least two paths:
  - file/tracker import
  - manual backfill
- Advanced proxy paths are documented as advanced and riskier.

### Phase 7 - Signed helper app

Tasks:

1. Decide Tauri vs CLI vs Electron.
2. Open-source repo.
3. Signed releases.
4. Auto-detect installed games.
5. Export `nyx-pulls` files.
6. Optional localhost handoff to browser.

Acceptance:

- Helper can run without remote code execution.
- Helper does not send tokens to Pengo unless user explicitly requests live handoff.

## UI copy recommendations

### Safe script copy

Use:

> Download and run a local Pengo script. It reads your local game cache/log to find the history link, then copies the link or writes a local import file. You can inspect the script before running it.

Avoid:

> Run this remote command.

### Token warning

Use:

> This link/token can read your pull history. Pengo uses it only for this import request and does not store it. For Endfield, we recommend the local file method instead.

### File import copy

Use:

> Files are parsed in your browser first. You will see a preview before anything is saved.

### Manual mode copy

Use:

> Use this when your game history expired or you only know your current pity. Manual entries are marked separately from imported records.

## Test plan

### Unit fixtures

Create fixtures:

- `uigf-v4.2-gi.json`
- `uigf-v4.2-hsr.json`
- `uigf-v4.2-zzz.json`
- `uigf-v4.0-mixed.json`
- `uigf-v3-gi.json`
- `srgf-v1-hsr.json`
- `paimon-export.json`
- `rngmoe-export.json`
- `wuwa-url.json`
- `wuwa-tracker-export.json`
- `endfield-csv.csv`
- `endfield-json.json`
- `manual-csv.csv`

### Parser tests

Each parser should test:

- source detection
- account count
- record count
- UID extraction
- banner mapping
- rarity mapping
- time parsing
- duplicate handling
- invalid file errors

### Worker tests

Add tests for live import endpoints:

- no logging of body
- missing auth rejected
- unknown fields dropped
- CR/LF values dropped
- rate limit branch
- upstream timeout
- CORS

### Browser tests

Add Playwright tests:

- open import wizard
- upload fixture
- preview shows expected counts
- import fixture
- reload tracker
- export backup
- delete local history

## Data portability commitments

Nyx should commit to:

- import and export for every supported standard where feasible
- no locked-in proprietary-only storage
- visible source/provenance
- delete local data at any time
- export local data at any time
- no global stats contribution unless explicit opt-in

## Final recommendation

Build the import system in this order:

1. Fix trust in existing live import.
2. Add UIGF v4.2 import/export.
3. Add legacy and third-party file imports.
4. Add a safer local helper script with file output.
5. Add Wuwa and Endfield local-file support.
6. Add mobile guidance and manual backfill.
7. Later, build a signed helper app and optional sync.

This gives Nyx broad coverage while making the fastest helper command transparent, preserving a safer verified alternative, and avoiding high-risk token submission by default.

## Sources

- [UIGF v4.2 standard](https://uigf.org/en/standards/uigf.html)
- [UIGF v4.0 legacy standard](https://uigf.org/en/standards/uigf-legacy-v4.0.html)
- [UIGF ecosystem listing](https://uigf.org/en/)
- [Genshin Version 4.5 update details](https://genshin.hoyoverse.com/en/news/detail/122817)
- [HoYoverse HSR Warp history support](https://support.hoyoverse.com/hc/en-us/articles/50913754903577-How-can-I-check-my-Warp-history-and-why-aren-t-my-latest-pulls-showing-up)
- [Paimon.moe import page](https://paimon.moe/wish/import)
- [Snap Hutao Wish History](https://snaphutaorp.org/en/features/wish-export)
- [stardb Genshin import](https://stardb.gg/en/genshin/wish-import)
- [stardb HSR import](https://stardb.gg/en/warp-import)
- [stardb ZZZ import](https://stardb.gg/en/zzz/signal-import)
- [rng.moe privacy policy](https://zzz.rng.moe/en/privacy)
- [Wuwa Convene URL extraction gist](https://gist.github.com/Luzefiru/19c0759bea1b9e7ef480bb39303b3f6c)
- [WuWa Tracker public metadata](https://github.com/wuwatracker/i18n/blob/main/en.json)
- [ak-endfield-gacha-link-gen](https://github.com/daydreamer-json/ak-endfield-gacha-link-gen)
- [TrackMyPulls Endfield tracker](https://trackmypulls.com/en/endfield/tracker)
- [TrackMyPulls Endfield script](https://raw.githubusercontent.com/an2nin/trackmypulls-extras/master/scripts/endfield.ps1)
- [ake-tracker Endfield import notes](https://github.com/mmgfrcs/ake-tracker)
- [WuWa Tracker article on third-party tracker safety and Endfield token risk](https://wuwatracker.com/articles/is-wuwatracker-or-any-third-party-tool-safe-to-use)
- [puyomi2k gacha-tracker note about mutable script risk](https://github.com/puyomi2k/gacha-tracker)
