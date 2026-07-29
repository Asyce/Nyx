# All-game achievement system audit and implementation plan

Date: 2026-07-26

Scope: Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Wuthering Waves, and Arknights: Endfield.

## Bottom line

The achievement system is **not** fully implemented for every game.

| Game | Production site | Current repository | Automatic account import | Honest status |
|---|---|---|---|---|
| Genshin Impact | Achievement page is visible | Catalog, tracker, profiles, JSON import, manual correction, and experimental extractor exist | The game-packet extractor is branch-only and has not passed a real-account release test | Useful tracker; automatic import is not public-ready |
| Honkai: Star Rail | Achievement route and catalog are live | Catalog, tracker, JSON import, HoYoLAB helper, and experimental packet support exist | HoYoLAB is the best route, but the helper is not shown on the site and needs live acceptance testing | Tracker is live; automatic import is not delivered end to end |
| Zenless Zone Zero | No achievement page | No catalog, importer, tracker configuration, or extractor | No safe, proven complete-account source was found | Not implemented |
| Wuthering Waves | No achievement page | No catalog, importer, tracker configuration, or extractor | No safe account API was found; an automated screen scan is the known practical fallback | Not implemented |
| Arknights: Endfield | No achievement page | No catalog, importer, tracker configuration, or extractor | No safe, proven complete-account source was found; progress has more states than yes/no | Not implemented |

The two existing catalogs were generated on 2026-07-14:

- Genshin: 1,759 achievements in 69 categories.
- Star Rail: 1,811 achievements in 9 categories.

Production and source are different facts. An earlier navigation check did not show Star Rail Achievements, but a later direct production check on 2026-07-26 confirmed `/hsr/achievements`, its catalog, and the matching deployed navigation code. Production browser checks remain a required release gate so this does not depend on inference from source.

## What “working” means

A game is not complete merely because a list is visible. Each game is complete only when all of these are true:

1. Pengo has a current, sourced catalog with stable IDs, categories, descriptions, rewards, hidden-state rules, icons, and a recorded game version.
2. The game page has an Achievement tab and a direct route.
3. The page supports profiles, category progress, search, filters, manual correction, backup, restore, and responsive use.
4. The normal path is **Automatic import**, not manually checking hundreds of rows.
5. The automatic method reads only the user's own account, produces a small local Pengo JSON file, and does not send credentials or game traffic to Pengo.
6. The page clearly explains and launches the available import method.
7. Import has a preview, wrong-game protection, unknown-ID reporting, and merge/replace choices.
8. A real account has proved the full path: export, file creation, site import, correct totals, refresh persistence, and a second import with no duplication.
9. New game versions fail safely instead of silently marking the wrong achievements.
10. Automated tests, a clean production build, deployment smoke tests, and post-deploy browser checks pass.

Until a game passes all ten points, label the unfinished part honestly as “Automatic import in development.”

## Audit evidence

### What already works in source

- The common achievement page has category cards, achievement rows, profiles, search, filters, progress, local storage, manual checkmarks, backup/restore, and JSON preview.
- Import accepts only `gi_achievements` or `hsr_achievements`.
- The UI, route allowlist, runtime catalog publisher, catalog builder, and Rust extractor are restricted to Genshin and Star Rail.
- Core/import tests pass.
- The Star Rail HoYoLAB exporter tests pass.
- The Rust extractor's synthetic parser tests pass, but those tests never read a real account.

### Current gaps and defects

- The website offers only a generic “Choose achievement JSON” control. It does not show where that file comes from or offer an automatic-export button/instructions.
- Genshin and Star Rail expose achievement pages, but neither page connects its user to the available automatic export method.
- ZZZ, WuWa, and Endfield have no catalog directories and no achievement code coverage.
- The screenshot helper is only a backup and is limited to Genshin/Star Rail.
- One screenshot-extractor distribution test fails because the documented SHA-256 and the current script do not match. Fix the test by deciding which reviewed script is canonical, then update the file and documentation together. Never merely change a hash without reviewing the script.
- The Genshin packet extractor is explicitly blocked from public release: no supported real-account capture, no code signing, incomplete privilege separation/buffer wiping review, and unresolved Npcap distribution/licensing decisions.
- Catalog freshness is a manual snapshot, not a proven release-by-release pipeline.

## Target user experience

Every supported game page should show the same simple choice under **Manage progress**:

1. **Automatic import — Recommended**
   - If the Pengo launcher is installed: “Import when I launch this game” toggle and “Import now.”
   - If it is not installed: “Get the Pengo launcher/helper” with a short explanation.
   - Show the last successful import, game version, completed count, and any catalog mismatch.
2. **Official account import**
   - Show only where a safe official signed-in page is available, currently Star Rail through HoYoLAB.
   - Credentials and cookies remain inside the official page.
3. **Upload Pengo JSON**
   - Backup/recovery and imports made on another PC.
4. **Screen scan fallback**
   - Only for games where account data cannot be safely read.
   - It may navigate the list automatically; it must not require checking achievements one by one.
5. **Manual correction**
   - Kept for fixing rare misses, never presented as the normal setup.

The import panel must not use “Stardb-compatible” as the main user-facing explanation. Call it “Pengo achievement JSON”; compatibility can remain a small technical note.

## Common technical foundation

Complete this foundation once before adding three more one-off implementations.

### 1. One versioned import contract

Add a Pengo-owned format while continuing to read the existing two-key files:

```json
{
  "kind": "pengo-achievements",
  "version": 1,
  "game": "gi",
  "accountBinding": {
    "scheme": "pengo-install-hmac-v1",
    "value": "opaque-local-account-fingerprint",
    "region": "os_euro"
  },
  "catalogVersion": "gi-6.7",
  "exportedAt": "2026-07-26T12:00:00Z",
  "achievements": [
    { "id": 81001, "status": "complete" },
    { "id": 81002, "status": "complete" }
  ]
}
```

Rules:

- `game` is one of `gi`, `hsr`, `zzz`, `wuwa`, or `ae`.
- `achievements` is sorted by numeric `id`, unique, and bounded.
- Boolean games use `status: "complete"`. Multi-state fields are added only after Endfield's actual state model and merge rules are proven with fixtures.
- The format remains an internal draft until that multi-state design is complete. If it cannot be completed without breaking the boolean record shape, publish boolean games as version 1 and Endfield states as version 2.
- Automatic imports require `accountBinding`. The launcher derives this opaque value with HMAC-SHA-256 from the game, region, account UID, and a random secret stored only in that launcher installation. It does not expose the UID and lets Pengo detect account A being imported into profile B on the same installation.
- A first automatic import explicitly binds the chosen Pengo profile. A later mismatch stops before preview. Moving to another PC requires an explicit rebind.
- Legacy/unbound files remain importable, but Pengo must warn that it cannot verify the account and require the user to confirm the target profile. Do not claim wrong-account protection for those files.
- Never include login tokens, cookies, packet data, account names, paths, or machine identifiers.
- Importers keep unknown IDs instead of losing them, but do not count them until the catalog recognizes them.
- Keep legacy `gi_achievements` and `hsr_achievements` readers for compatibility. New Pengo exporters write the new format.

### 2. Game adapter instead of hard-coded pairs

Create one achievement game registry containing:

- route key and display name;
- catalog URL;
- reward name/icon;
- import field aliases;
- automatic methods and their availability;
- official fallback, if any;
- whether progress is boolean or multi-state;
- copy and support links.

Make the route, navigation, catalog publisher, importer, view, build scripts, smoke tests, and extractor CLI all consume this registry or generated equivalents. Adding a game should require an adapter and data, not edits to many `gi || hsr` checks.

### 3. Catalog pipeline

For each game, store:

- source URL/repository and exact source revision;
- game release/version;
- extraction time;
- categories and their icons;
- stable achievement IDs;
- titles/descriptions in supported languages;
- hidden flags and reveal rules;
- reward value;
- series/tiers and predecessor relationships;
- release availability;
- a checksum and semantic change report.

The scheduled refresh job should:

1. fetch only reviewed sources;
2. build a candidate catalog;
3. compare counts, IDs, categories, rewards, and removals;
4. block on unexplained deletions, duplicate IDs, empty categories, or a large count change;
5. run fixture and UI tests;
6. open a reviewable change rather than silently deploying it;
7. publish only released content, with future/beta data kept separate.

### 4. Launcher project prerequisite and integration

The launcher is being built in a separate project/session and is not contained in this repository. Before achievement work depends on it:

1. identify its repository, owner, supported Windows versions, installer, update path, and current launch contract;
2. give that project a versioned Pengo achievement-export interface;
3. define code signing, safe update verification, game-path discovery, custom paths, process launch/exit behavior, rollback, and support logging;
4. add shared contract fixtures so the launcher and Nyx cannot silently disagree;
5. record the integration in a handoff owned by both projects.

The launcher is then the normal automatic path:

- Per-game toggles: **Import pulls on launch** and **Import achievements on launch**.
- Start the extractor before launching only where capture must begin first.
- Stop after one complete snapshot or a strict timeout.
- Write atomically to `Downloads\Pengo Exports\<Game>\`.
- Never overwrite an existing export; use a timestamped name.
- After the user's one-time pairing consent, hand the result to the matching Pengo profile automatically and open the preview. The user approves merge/replace; they do not pick the file again.
- Implement the handoff with a short-lived loopback bridge bound only to `127.0.0.1`, an unguessable one-use nonce, exact Pengo origin checks, strict CORS/private-network handling, small response limits, expiry, and immediate shutdown after delivery. The launcher opens the matching HTTPS page with the nonce in the URL fragment so it is not sent to Pengo's server.
- Prove the handoff in Chrome, Firefox, and Edge. If a browser blocks the local bridge, fall back to the saved JSON picker and label that path **Automatic export + file import**, not automatic import.
- “Import now” uses the same paired handoff without launching the game when the selected extractor permits it.

The helper must not inject into the game, read game memory, alter files, disable anti-cheat, install a certificate, run a traffic proxy, or upload captured traffic. It must fail closed on unknown versions/keys.

### 5. Import safety

For every game test:

- invalid JSON and oversized files;
- wrong game/profile;
- duplicate, malformed, negative, huge, and unknown IDs;
- old and future catalog versions;
- merge versus replace;
- partial/missing progress;
- empty account;
- interrupted writes;
- repeated import idempotence;
- storage quota/corruption;
- export contains no secrets.

## Dependency-ordered implementation

### Batch 0 — Fix and freeze the current truth

1. Reproduce both live achievement routes and record the deployed revision and timestamp.
2. Compare the deployed revision, generated runtime catalogs, route allowlist, asset cache headers, and production console/network errors.
3. Add a production smoke check that opens `/genshin/achievements` and `/hsr/achievements`, verifies a non-empty catalog, and verifies the import control.
4. Resolve the screenshot-helper checksum mismatch through a script review.
5. Record real counts and versions in a generated manifest rather than prose.

Exit gate: Genshin and Star Rail source, build artifact, and production behavior agree.

### Batch 1 — Build the common foundation

1. Add the new versioned Pengo format and legacy readers.
2. Add the five-game adapter registry.
3. Remove all scattered two-game allowlists.
4. Make the build publish any registry-enabled catalog.
5. Add shared import-method cards and status messages.
6. Add per-game feature flags: `catalog`, `tracker`, `automaticImport`, and `officialImport`.
7. Add common fixtures and contract tests for five games.
8. Define and fixture Endfield's multi-state record and merge/replace semantics before publishing the new format version.
9. Add bound-profile, mismatched-profile, rebind, and legacy-unbound import tests.

Exit gate: a fixture-only game can be enabled without changing common UI/import code.

### Batch 2 — Finish Genshin end to end

Primary route: passive local packet extraction based on the current Pengo-owned Rust implementation and temporary reviewed version-key map.

1. Run supported real-account tests across at least two regions and two Windows builds.
2. Confirm the snapshot is complete by comparing game totals and a sample from several categories.
3. Prove timeout, cancel, unknown version, wrong port, existing file, and interrupted launch produce no partial export.
4. Separate any elevated packet collection from parsing/file writing where Packet Monitor requires it.
5. Wipe decrypted buffers, finish Npcap legal/distribution review, sign the executable, publish checksums, and independently review the binary.
6. Package it inside the Pengo launcher; do not ask users to install Stardb.
7. Add “Import achievements on launch” and site instructions.
8. Keep screen scanning as a clearly labeled backup.
9. Run a clean-account, partial-account, and high-completion account acceptance test.

Go/no-go: if passive capture cannot be made stable and safe for the current release, do not publish it. Ship automated screen scanning as the temporary recommended option and continue packet discovery behind a feature flag.

### Batch 3 — Finish Star Rail end to end

Primary route: the signed-in HoYoLAB achievement list. Packet capture remains a fallback, not the default.

1. Keep the live Star Rail route/navigation covered by a production smoke test.
2. Reconfirm the official-page request shape, regions, pagination/`need_all`, hidden achievements, and completion flags with real accounts.
3. Compare Pengo's 1,811-item catalog against the current released list; resolve the previously observed count gap before launch.
4. Move the reviewed helper into a clear site flow:
   - “Open HoYoLAB”
   - “Run Pengo export”
   - download Pengo JSON
   - return to/import on the Star Rail page.
5. Prefer a browser extension or launcher-assisted page action over asking users to paste code into the console.
6. Verify the helper contacts only HoYoLAB, logs nothing, exports no cookie/UID by default, rejects unfamiliar replies, and times out safely.
7. Add launcher instructions and optional launch-time packet fallback only after the same binary gates as Genshin.
8. Test multiple regions, no achievements, hidden achievements, and a stale catalog.

Exit gate: a normal signed-in user can complete export and import without developer tools.

### Batch 4 — Add Zenless Zone Zero

Current state: no safe, proven complete-account importer was found. Treat discovery as required engineering, not an assumed endpoint.

1. Build and verify the full released catalog, including category icons, hidden entries, series/tiers, rewards, and any arcade-only separation.
2. Add the ZZZ adapter and `zzz` fixtures, but keep production flags off.
3. Build a passive discovery harness that records only message metadata in development and never ships captures.
4. Test, in order:
   - official HoYoLAB/HoYoPlay signed-in tools for a full achievement list;
   - read-only local cache/state files;
   - passive launch/login/menu network snapshots;
   - automated screen-list scan.
5. Require a complete snapshot with stable IDs. A profile summary containing only an achievement total is insufficient.
6. If an official endpoint is found, use the Star Rail browser-assisted model. If a passive game snapshot is found, use the Genshin launcher model.
7. Otherwise build a local automated screen scanner that opens/scrolls the achievement list and matches exact localized titles plus completed state. It must generate a review screen and report uncertain rows.
8. Add the ZZZ catalog page, import cards, JSON support, profiles, backup/restore, and production smoke tests.

Exit gate: at least two real accounts produce the same completed set as the in-game list, with uncertain results never silently counted.

### Batch 5 — Add Wuthering Waves

Current state: no safe complete-account API was found. Existing public scanning work shows UI automation/OCR is practical, but not perfectly reliable.

1. Build the released catalog from a versioned source and verify it against the game UI.
2. Add the WuWa adapter and `wuwa` fixtures with production flags off.
3. Investigate official account pages and read-only local state before using OCR.
4. If neither contains stable per-achievement completion, implement a Pengo-owned automated screen scan:
   - detect supported resolution/UI scale/language;
   - navigate only the achievement menu;
   - scroll deterministically;
   - capture locally;
   - exact-match stable IDs/titles;
   - identify completed versus incomplete state;
   - deduplicate overlaps;
   - stop and show uncertain rows rather than guess.
5. Support the most common resolutions first and publish the tested matrix.
6. Add launcher toggle, progress/cancel, output file, site import panel, and correction review.
7. Validate against full manual counts on low-, medium-, and high-completion accounts.

Exit gate: the scanner needs one start action, no per-achievement work, and meets an agreed recall target while preserving 100% precision for automatically checked items.

### Batch 6 — Add Arknights: Endfield

Current state: no safe complete-account extraction route was found. Its Path of Glory medals can have upgrade/reforge/trim/finality state, so a boolean-only model may lose information.

1. Model the catalog and progress states before reusing the Genshin schema.
2. Verify which states affect completion, displayed percentage, rewards, and visual presentation.
3. Add the Endfield adapter and `ae` fixtures with production flags off.
4. Investigate official account/web tools, read-only local cache, and passive launch/menu snapshots.
5. Accept a data route only if it exposes stable medal ID plus all progress fields required by the UI.
6. If no safe data route exists, prototype a local automated Path of Glory screen scan with the same exact-match/uncertainty rules as WuWa.
7. Extend preview to show state changes, not merely “newly completed.”
8. Add the page, launcher toggle, JSON import, backup/restore, and state-aware tests.

Exit gate: import round-trips every supported medal state without downgrading or inventing progress.

### Batch 7 — Release and operate

Release one game at a time behind its own flag:

1. internal fixture build;
2. developer real-account test;
3. independent security/privacy review;
4. small opt-in preview;
5. catalog and import telemetry limited to anonymous success/error codes;
6. production enablement;
7. immediate rollback switch;
8. post-release browser smoke test.

Never log achievement titles, IDs tied to a UID, cookies, packet contents, local paths, or raw screenshots. Track only game, method, helper version, catalog version, success/failure category, and duration when the user has consented to diagnostics.

## Required test matrix

Each game must pass:

- Windows 11 current and previous supported build.
- Fresh install and upgrade.
- Supported launcher path and custom game path.
- At least two common resolutions for scan-based methods.
- Every supported region and language, or a clear UI restriction.
- Empty, partial, and near-complete accounts.
- Offline, slow network, timeout, cancel, game crash, helper crash.
- Current, stale, and unknown game/catalog versions.
- First import, repeat import, merge, replace, backup, and restore.
- Desktop and mobile site display; extraction itself may remain PC-only.
- Screen reader, keyboard navigation, focus, reduced motion, and narrow layout.
- Production route, catalog fetch, cache refresh, and direct-link behavior.

## Final acceptance checklist

The overall project is complete only when:

- all five games have released catalogs and visible production pages;
- all five pages clearly lead with the best available automatic method;
- no game requires users to manually tick their initial progress;
- every automatic method has two-account real-world evidence and a maintained version gate;
- after one-time launcher pairing, a normal automatic import reaches the correct profile preview without a file picker;
- bound automatic imports stop on an account/profile mismatch, while legacy unbound files display a clear warning;
- Genshin and Star Rail preserve compatibility with existing JSON exports;
- ZZZ/WuWa/Endfield have honest fallbacks if direct account data remains unavailable;
- the launcher exposes separate pull and achievement toggles for each game;
- the separate launcher project has a signed installer/update path and passes the shared import-contract fixtures;
- output defaults to `Downloads\Pengo Exports\<Game>\`;
- no helper depends on installing or visibly running a third-party tracker;
- no helper reads memory, injects code, weakens anti-cheat, or uploads secrets;
- catalog refresh, importer, build, smoke, security, and accessibility gates pass;
- production is checked after deploy and can be disabled per game without removing the tracker.

## Source notes

Repository evidence is in:

- `Site/src/app/nyx-app.jsx`
- `Site/src/features/achievements/`
- `Database/Achievements/`
- `Scraper/achievements/`
- `Extractor/Achievements/`
- `docs/achievement-live-extractor-2026-07-14.md`
- `docs/achievement-extractor-2026-07-14.md`

External feasibility checks:

- [Star Rail HoYoLAB achievement-list exporter reference](https://gist.github.com/BobbyWibowo/e9ce2f8bea3a4cdcf7bdfd4454f8369d)
- [Genshin Achievement Scanner](https://github.com/ThePythonGuy3/Genshin-Impact-Achievement-Scanner)
- [WuWa Inventory Kamera](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera)
- [ZZZ Scanner, evidence that local UI automation is possible for inventory data](https://github.com/samsaq/ZZZ-Scanner)

Those projects are research references, not runtime dependencies. Absence of a public importer is not proof that no private/official endpoint exists; it is why ZZZ, WuWa, and Endfield have explicit discovery gates.
