# Achievement + launcher integration handoff

Date: 2026-07-26

Owners: `C:\Pengo\Nyx` and `C:\Pengo\Nyx-desktop`

Status: local implementation and safety gates passed; one real Genshin
end-to-end acceptance passed; wider external acceptance and release gates
remain.

## Implemented truth

- Genshin Impact and Honkai: Star Rail have released catalogs, tracker routes, profiles, manual correction, backups, merge/replace import previews, unknown-ID retention, and legacy import compatibility.
- New site helpers and the packaged launcher helper write Pengo achievement JSON v1.
- The launcher starts pulls and achievements as independent jobs. Either job can fail without blocking a valid game launch.
- Achievement capture is prepared before game launch and uses a fixed, hash-verified helper invocation.
- Output is atomic, timestamped, never overwrites another export, and stays below `Downloads\Pengo Exports\<Game>\`.
- The launcher validator accepts only the exact Pengo v1 envelope, exact game/catalog version, a strict UTC timestamp, sorted unique positive IDs, and `status: "complete"`.
- Genshin native exports remain deliberately unbound because capture does not
  provide a reviewed UID source. HSR HoYoLAB exports include an opaque,
  per-install account binding derived after explicit provider consent. The
  website still previews and asks before applying either kind of import.
- Successful exports use a two-minute, one-use loopback handoff to open the
  matching Pengo tracker automatically. The validated file picker remains the
  fallback when the browser handoff fails or expires.
- The canonical cross-repository fixture is `contracts/pengo-achievements-v1.fixture.json`, SHA-256 `707b2c45f3751c3a617f380895ec1ab338258bd1bc3b031b67dedf2aa208c3ad`.
- ZZZ, Wuthering Waves, and Endfield have registry slots plus pinned unpublished catalog candidates. Their catalog/tracker/export flags remain off.
- Endfield remains blocked from v1 because its Path of Glory progress model is multi-state and unresolved.
- Endfield now has a synthetic, fixture-backed v2 draft with strict validation and tested merge/replace rules. It is not loaded by the live achievement page and does not prove real account payload semantics.

## Verification evidence

- Rust achievement helper: 38 unit tests, 3 launcher-process tests, and 9 security-static tests passed.
- Desktop application: 1,332 tests passed.
- Desktop packaging: 66 tests passed.
- Desktop Debug build: 0 warnings, 0 errors.
- Fresh development package:
  - `Desktop\packaging\artifacts\Nyx-Desktop-1.0.0.0-development-win-x64.zip`
  - 129,863,840 bytes
  - outer SHA-256 `a68f4990fb38146cfbaed007a58617c39383c782d8177eb944bac4a13402d1c8`
  - inner update payload: 91,789,707 bytes, SHA-256 `300799d193cfcaec93db54a320a695ac06a6587c4b9643e015cc004df6a9b915`
  - packaged achievement helper SHA-256 `1113b153b47e23903f950bd573db4375082cc4ecf6c70e5c25e17329ff13fa75`
  - 38 reviewed offline Permanent/Collab portraits: 539,114 bytes total
  - PE hardening and updater verification passed.
- Site achievement tests: 42 passed, including disabled Endfield v2 safety and contract tests.
- Full scraper/catalog/discovery suite: 173 passed.
- Launcher manifest/data tests: 36 passed.
- Runtime publisher tests: 15 passed.
- Site deploy build completed and deployment smoke passed, including both achievement routes, both reviewed helper files, exact helper checksums, and 971 runtime data files.
- Visible browser QA passed for Genshin and HSR Manage Progress dialogs. Both showed the intended helper actions and honest status labels; no browser console warnings or errors appeared.
- Visual QA of the exact packaged launcher passed for Genshin, HSR, ZZZ,
  WuWa, Endfield, Add Game, and Settings. HSR Collab showed Gilgamesh, Rin
  Tohsaka, Saber, and Archer; HSR Permanent showed all ten reviewed
  characters with visible portraits. A newer remote feed that omits reviewed
  collections can no longer erase the bundled fallback, while any non-empty
  remote collection remains authoritative.

## Real-account acceptance recorded 2026-07-27

One high-completion Genshin account passed the packaged launcher flow on
Windows 11 Pro 23H2 build 22631:

- Nyx prepared the fixed, hash-verified helper before starting the game.
- The helper produced one atomic Pengo achievement JSON v1 snapshot for
  catalog `gi-6.7`, then stopped while the game remained running.
- The snapshot contained 1,641 unique, sorted, complete-only achievement rows.
- The envelope and every row used only the allowed fields; no account, session,
  token, machine, packet, or path data was present.
- A fresh local Pengo profile previewed and merged all 1,641 rows with zero
  unknown IDs, invalid rows, or duplicate rows.
- Importing the same file again previewed zero new checks and 1,641 already
  checked rows; applying it added zero checks.
- The 1,641 / 1,759 result and reward/category totals survived reopening the
  tracker.
- A helper protocol drain defect found during the run was fixed with a bounded
  post-exit read and a fail-closed timeout. A regression test covers the case.
- Achievement capture can no longer be started after the game process is
  already running because it would miss the required launch handshake. The
  mid-game `EXPORT` action remains available only for pull-only arming.

This is one-account, one-Windows-build evidence. It does not satisfy the second
account, second region, second supported Windows build, signing, or release
gates.

## Unpublished catalog-source audit

`Scraper/achievements/build-candidates.mjs` now creates strict research
artifacts under `Database/Achievements/candidates/`. They are outside the
released manifest and runtime publisher, carry `publishable: false`, pin every
source or response hash, and list their blockers. Thirty achievement
catalog/discovery/candidate tests pass.

- ZZZ candidate: 894 stable-ID English rows in 24 series from the public StarDB
  API, including rewards, hidden flags, versions through 3.0, and 153 arcade
  rows. A pinned 733-row Chinese version reference reconciles 727 rows to
  unique stable IDs and leaves six composite/renamed reference rows plus 14
  stable IDs for manual review. Combined snapshot SHA-256:
  `d8323c5a4b04f063484a6615a44e69b059e1dc5eca424dd4d763728f8a33fc21`.
  Category icons, final in-game reconciliation, and a complete-account source
  remain missing.
- Wuthering Waves candidate: 1,172 standard trophies in 4 categories from
  1,274 stable raw rows at Arikatsu 3.5 commit
  `dae29691c04ef0f48d0810b5d244fb0b37288c60`. The pinned current English text
  and drop tables resolve every candidate title, description, category, and
  Astrite reward. All 35 reviewed 3.5.10 group pages are now parsed and
  hash-pinned. Their summary reports 1,163 trophies but their recursively
  expanded stable-ID rows total 1,170. The candidate contains no missing
  reference IDs and only two additional IDs: hidden story row `200704` and
  Echo Collection row `400205`. Those two IDs and a complete-account source
  still block publication. Combined snapshot SHA-256:
  `4881d94415af95bf39d8ec455f923929b486754c4d086c2ceeef1b641f74b2b6`.
- Endfield candidate: 140 stable medal IDs in 8 categories with 182 explicit
  level states from current extracted client tables. All 140 rows map to Enka
  profile medal IDs and per-level icon paths; the client table and achievement
  UI prove that medals carry no material reward. Snapshot SHA-256:
  `c9d2b01405e67ca50ae567c9b3621079791af58c333efa28eaf8b33c01da32a0`.
  A public Enka profile page exposed only six user-selected showcase medals,
  and the page identifies itself as a showcase; it is useful for proving
  profile medal IDs and levels, but it is not a complete-account progress
  source. The pinned client `TimeRangeTable` now resolves every timed medal:
  six are already open and four are future content dated 2026-07-30,
  2026-08-06, 2026-08-09, and 2026-08-19. No real complete-account payload
  has yet proven level, condition, plating, rare-effect, or timestamp field
  meanings.
- Endfield v2 draft: the sealed contract is documented at
  `contracts/pengo-achievements-v2-ae-draft.md`; its synthetic canonical fixture
  is `contracts/pengo-achievements-v2-ae-draft.fixture.json`, SHA-256
  `dfff90376bc5da50b0c97899d6ebd6cdecc09a4594ca16178850ddc43cbd2689`.
  Validation enforces exact fields, sorted stable string IDs, catalog level and
  capability bounds, matching condition targets, and size limits. Merge never
  downgrades progress; replace reports known removals and retains unresolved
  achievement IDs. The module remains outside the live page and release flags.

The next catalog gate is an in-game count and field-by-field review. Candidate
artifacts must remain unpublished until that and each game-specific import gate
pass.

## Re-audited game gates

| Game | Local implementation now | Gate that still prevents release |
|---|---|---|
| Genshin | Released 1,759-row catalog, tracker, profiles, Pengo v1 import/export, launcher job, strict helper validation, and one high-completion real-account pass on Windows build 22631 | A second account, second region, second supported Windows build, clean/partial-account comparison, UID/region binding, independent binary review, signing, and Npcap decision |
| Star Rail | Released 1,869-row 4.4 catalog, tracker, profiles, Pengo v1 import/export, HoYoLAB helper, and launcher job | Real signed-in account coverage plus a normal-user helper/extension flow that does not require developer tools |
| ZZZ | Disabled registry slot and unpublished 894-row stable-ID candidate | Reviewed released-list reconciliation, category icons, and a proven complete-account source |
| Wuthering Waves | Disabled registry slot and unpublished 1,172-row standard-trophy candidate with complete English and Astrite rewards; all 35 reference groups reconciled | Verify the two exact candidate-only IDs (`200704`, `400205`) in-game and prove a complete-account source or precision-preserving scan |
| Endfield | Disabled registry slot, unpublished 140-medal client/profile-mapped catalog, sealed synthetic v2 state contract, and complete client schedule mapping | Keep the four future-dated rows out of release and prove every real payload level/condition/plating/rare-effect/timestamp meaning |

The common local foundation is complete enough for later adapters without
enabling unfinished games. No remaining gate can be closed honestly by
inventing data, silently reading credentials, or changing a feature flag.

## Release blockers that code cannot honestly close

1. Genshin packet capture has one high-completion pass on Windows build 22631. It still needs a second account, second region, second supported Windows build, and clean/partial-account comparisons.
2. HSR HoYoLAB export has a normal-user, launcher-assisted hidden official-page
   flow and a current 4.4/1,869-ID catalog. It still needs real signed-in
   acceptance across regions, no-achievement and hidden-achievement cases,
   pagination, stale catalogs, and unfamiliar replies.
3. HSR account binding is implemented without exposing the UID, but Genshin's
   native capture still has no reviewed UID/region source and remains
   deliberately unbound.
4. The short-lived loopback browser handoff is implemented and covered by
   strict automated tests. It still needs live acceptance in Chrome, Firefox,
   and Edge; the validated file picker remains the fallback.
5. The native helper needs independent binary review, production code signing, and the documented Npcap legal/distribution decision.
6. ZZZ, Wuthering Waves, and Endfield have pinned unpublished candidates. WuWa is narrowed to two exact disputed IDs and Endfield to four exact future-dated rows, but all three still need real complete-account discovery observations. Candidate catalogs are not extractors.
7. Endfield's synthetic v2 contract is implemented, but real exported payloads must prove level, condition, plating, and rare-effect meanings before the contract or tracker can be enabled.
8. A signed installer/update path and production deployment require explicit release authorization.

## Next acceptance sequence

1. Use the fresh development package on dedicated test accounts; record only counts, versions, regions, timings, and pass/fail evidence.
2. Compare each exported completed set with the in-game or official list and import it into the matching Pengo profile twice to prove idempotence.
3. Resolve every count mismatch before changing a feature flag.
4. Design a Genshin UID/region binding source only after it is proven not to
   expose account secrets.
5. Live-test the one-use loopback handoff in Chrome, Firefox, and Edge; retain
   the file-picker fallback.
6. Sign and independently review the exact release helper and installer artifacts.
7. Enable one game/method at a time only after its own acceptance matrix is complete.

No production deployment, commit, push, or feature enablement was performed.

One checkout-integrity test remains intentionally blocked until the work is
committed: it compares the generated launcher file list byte-for-byte with the
old `HEAD`. The manifest, art, code-feed, application, packaging, and runtime
tests pass. Do not make that test green by discarding the current generated
art.
