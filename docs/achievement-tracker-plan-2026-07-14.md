# GI + HSR Achievement Tracker

Status: implemented on `codex/gi-hsr-achievement-tracker`.

## Shipped scope

- Routes: `/genshin/achievements` and `/hsr/achievements`.
- Released English catalogs with stable numeric achievement IDs and ordered categories.
- Genshin 6.7: 1,759 achievements across 69 categories.
- Star Rail 4.3: 1,811 achievements across 9 categories.
- Browser-local profiles, category totals, search, completed/missing filters, and manual correction.
- Additive Stardb-format imports with a preview, wrong-game rejection, duplicate reporting, and unknown-ID retention.
- Readable local JSON backup/restore. Achievement data uses its own storage namespace and is not uploaded or mixed with pull history.
- Responsive Nyx ledger UI with generated text medallions. No official category artwork is copied.
- HSR primary extractor: a Pengo-owned helper on HoYoLAB's signed-in Upgrade Recommendations page. It downloads completed IDs only and does not copy cookies, UID, region, or full replies into Pengo.
- Genshin extractor: a branch-only Pengo Windows CLI using realtime PktMon, pinned parsers, and the temporarily authorized Stardb v2.19 compatibility map. It writes the same small import file without installing or running Stardb.
- Screenshot OCR remains an optional backup, not the main extractor.

## Catalog contract

The build-time provider is replaceable. `Scraper/achievements/build.mjs` fetches exact pinned commits, filters records above the declared released version, normalizes them into `Database/Achievements`, and rejects duplicate IDs, incomplete records, unsafe markup, inconsistent counts, or a refresh that falls below 80% of the last known good catalog.

Sources and licenses are recorded in `Database/Achievements/provenance.json`. Runtime pages use only locally published JSON and never hotlink upstream data.

## Import contract

Supported MVP shapes:

```json
{"gi_achievements":[80091,81000]}
```

```json
{"hsr_achievements":[4010101,4010201]}
```

Imports only add known completed IDs. Unknown IDs are kept for a future catalog refresh. Repeating an import is safe and never removes a manual checkmark.

## Deliberately deferred

- Public distribution of the Genshin packet extractor. Its branch-only test build still combines Administrator capture and parsing; release requires a small elevated collector, a normal parser, explicit sensitive-buffer wiping, and another security review.
- A real-account packet-capture test. Automated checks do not start either game or touch an account.
- Cloud accounts or cross-device sync.
- Import formats beyond the proven Stardb ID-list shape and Nyx backup.
- Official in-game category artwork until a clean released source and provenance path is approved.

Those are separate safety-gated milestones; they are not hidden inside the tracker MVP.

## Verification

- Catalog tests, import/storage tests, publisher tests, and all existing scraper tests.
- Local deploy build and smoke checks for both routes and catalogs.
- Visual, keyboard, interaction, overflow, and console checks at 390x844, 1600x900, and 2560x1080.
- `validate` passes. `validate:strict` is currently blocked by pre-existing stale banner freshness for GI, HSR, ZZZ, and WuWa; the achievement catalogs are not the cause.
