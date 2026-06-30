# Nyx Review Execution Addendum

Date: 2026-06-30

Companion to: `docs/nyx-full-review-2026-06-30.md`

Current product-direction updates after user feedback are in `docs/report-feedback-decisions-2026-06-30.md`. That file supersedes earlier wording where it differs, especially around keeping both quick PowerShell and safer verified import paths.

This addendum improves the original report by turning the recommendations into a more operational implementation framework: decision gates, workstreams, milestones, test strategy, rollout controls, and risk management.

## Why this addendum exists

The full review already identifies the right problem areas. What it needed next was a clearer way to execute without turning the project into a broad rewrite. Nyx is already live-product shaped, so the implementation plan should protect working surfaces while improving trust, data quality, mobile usability, and maintainability.

The implementation rule should be:

1. Fix trust and correctness before feature expansion.
2. Add measurement before large refactors.
3. Ship behind reversible gates when behavior is user-facing.
4. Keep the visual identity; change the structure around it.

## Improved priority model

Use four priority lanes instead of only P0/P1/P2.

### Lane A - Ship blockers

These are issues that can make the live site misleading, unsafe-looking, or operationally inconsistent.

- Old remote PowerShell helper commands.
- Stale/invalid banner data deploying as if acceptable.
- Deploy before commit in scheduled workflows.
- Mobile hiding Live/Beta and Pengo controls.
- Sample pull history appearing like real history.

Rule: no major feature expansion should land before Lane A is closed or explicitly deferred with a written reason.

### Lane B - Reliability and observability

These make Nyx easier to operate and debug.

- Route-aware local server.
- Build/version metadata.
- Data-health JSON.
- Deploy artifact budget.
- Playwright route smoke checks.
- Worker tests.

Rule: add these while fixing Lane A, not after the project is "done".

### Lane C - Performance and architecture

These reduce long-term fragility.

- Lazy data chunks.
- Manifest-based asset copying.
- Split oversized frontend files.
- Split CSS.
- Add lint/type/test tooling.
- Move away from manual cache tokens.

Rule: do this after the user-facing trust and data problems are stabilized.

### Lane D - Product expansion

These make Nyx more useful.

- Cross-game dashboard.
- Material planner.
- Real gear sorter.
- Import-history improvements.
- Notifications/reminders.
- Optional sync.

Rule: each Lane D feature should include its own data correctness, privacy, and mobile acceptance criteria.

## Recommended workstreams

### Workstream 1 - Pull import trust

Owner type: frontend + security/privacy.

Files likely touched:

- `Site/src/features/gacha/pulls-engine.js`
- `Site/src/features/gacha/gacha-tracker.jsx`
- `Site/src/features/gacha/pulls-storage.js`
- `Site/public/scripts/pengo-pulls.ps1`
- `worker/worker.js`
- `Site/tools/*` for script hash validation

Definition of done:

- No default UI path tells users to run `iex (irm ...)`.
- Pengo script is branded correctly.
- Script hash is build-verified.
- Result view shows data provenance.
- Sample mode is visibly separate.
- User can delete/export local history from the tracker.

### Workstream 2 - Data gates

Owner type: scraper + CI.

Files likely touched:

- `Scraper/validate-data.cjs`
- `Scraper/banners/normalize.cjs`
- `.github/workflows/data-refresh.yml`
- `.github/workflows/roster-sync.yml`
- `.github/workflows/code-watch.yml`
- generated data status output

Definition of done:

- Structural validation and freshness validation are separate.
- `invalid` blocks deploy by default.
- `stale` blocks deploy for supported games unless explicitly overridden.
- Endfield unavailable/experimental status is represented as policy, not accidental failure.
- Data-health output is generated and visible in the app or Pengo menu.

### Workstream 3 - Mobile shell

Owner type: frontend/UI.

Files likely touched:

- `Site/src/app/nyx-app.jsx`
- `Site/src/components/game-page-components.jsx`
- `Site/src/styles/game-page-shared.css`
- `Site/pages/index.html`

Definition of done:

- Mobile topbar does not clip.
- Pengo menu is accessible on mobile.
- Live/Beta is accessible on mobile where supported.
- Homepage mobile cards have visible labels.
- Main nav and code controls meet touch target requirements.
- Playwright screenshots are captured for at least 390x844 and 430x932.

### Workstream 4 - CI/deploy contract

Owner type: CI/build.

Files likely touched:

- `.github/workflows/*.yml`
- `Site/tools/build-deploy.mjs`
- `Site/tools/inject-seo.mjs`
- new local smoke-test script
- new version metadata script

Definition of done:

- CI uses `npm ci`.
- Scheduled data changes are committed before deploy.
- Deploy exposes source commit.
- Clean routes are smoke-tested.
- Build fails when deploy artifact budget is exceeded.

### Workstream 5 - Performance architecture

Owner type: frontend/build/data.

Files likely touched:

- `Site/tools/generate-site-data.mjs`
- `Site/tools/build-site.mjs`
- `Site/tools/build-deploy.mjs`
- `Site/src/data/generated/*`
- app feature loaders

Definition of done:

- Overview pages load only overview data.
- Materials data loads on demand by game.
- Tracker-only metadata loads on tracker open.
- Deploy artifact copying is manifest-driven.
- Large fonts/images have optimized variants.

## Decision gates

### Gate 1 - Trust gate

Before any tracker feature expansion:

- Remote helper commands removed.
- Safe script flow is primary.
- Script hash verification is automated.
- Sample/provenance UI is implemented.

Failing this gate means the tracker can receive fixes, but not new import features.

### Gate 2 - Data gate

Before any scheduled deploy pipeline change is considered done:

- `invalid` banner status fails strict validation.
- At least one stale fixture test exists.
- Workflow behavior is documented for carry-forward, stale, invalid, and expected unavailable states.

Failing this gate means the workflow can build locally, but should not deploy automatically.

### Gate 3 - Mobile gate

Before a UI release:

- 390x844 screenshot shows no brand clipping.
- 430x932 screenshot shows Pengo menu access.
- Live/Beta is reachable in materials.
- Homepage labels are visible.
- No critical controls require hover.

Failing this gate means desktop-only UI changes should not be called complete.

### Gate 4 - Deploy provenance gate

Before changing scheduled deployment cadence:

- Deployed version maps to a commit SHA.
- Deploy happens after commit/push, not before.
- Route smoke passes locally.
- Artifact size is reported.

Failing this gate means scheduled automation remains hard to audit.

## Suggested milestone plan

### Milestone 1 - Stabilize user trust

Duration target: 1 focused pass.

Tasks:

1. Replace old helper command UI.
2. Rebrand and verify `pengo-pulls.ps1`.
3. Add tracker provenance and sample separation.
4. Add delete/export management controls.
5. Add import-flow Playwright smoke checks.

Exit criteria:

- No old remote helper string appears in built output.
- Tracker result screens clearly say real/imported/sample/local.

### Milestone 2 - Stabilize automated data

Duration target: 1 focused pass.

Tasks:

1. Split validation modes.
2. Add freshness policy config.
3. Block invalid deploys.
4. Generate data-health JSON.
5. Investigate current Wuwa invalid banner state.

Exit criteria:

- Strict validation can fail on current degraded banner state.
- Workflows know when to skip deploy.

### Milestone 3 - Make mobile first-class

Duration target: 1 to 2 UI passes.

Tasks:

1. Mobile topbar.
2. Mobile Pengo menu.
3. Mobile Live/Beta location.
4. Mobile homepage labels.
5. Touch target pass.
6. Screenshot regression checks.

Exit criteria:

- Desktop still matches current identity.
- Mobile no longer hides core controls.

### Milestone 4 - Make deploys auditable

Duration target: 1 CI pass.

Tasks:

1. `npm ci`.
2. Commit before deploy.
3. Version metadata.
4. Route-aware dev server.
5. Route smoke tests.
6. Artifact budget report.

Exit criteria:

- Every live deploy has a source commit and route smoke evidence.

### Milestone 5 - Reduce payload size

Duration target: multi-pass refactor.

Tasks:

1. Measure per-route initial assets.
2. Lazy-load materials data.
3. Lazy-load tracker metadata.
4. Manifest-copy Database assets.
5. Optimize fonts/backgrounds.

Exit criteria:

- A code-only refresh no longer republishes unnecessary stable art.
- Initial route load does not include irrelevant game/feature data.

## Testing framework

### Unit tests

Add tests around pure logic first:

- `bannerPhaseCards`
- `bannerFreshness`
- strict validation decisions
- gacha URL parsers
- Wuwa URL parser
- UIGF import parser
- IndexedDB merge/dedupe logic, possibly through a mock store

### Integration tests

Add tests around app behavior:

- route loading
- no console errors
- no broken images above the fold
- material popout open/close
- tracker import screen render
- sample mode badge visible
- Pengo menu open/close

### Worker tests

Add tests for:

- trusted origin allowed
- untrusted origin denied
- missing Origin policy
- OPTIONS response
- method denial
- body too large
- invalid JSON
- missing authkey
- Wuwa missing fields
- upstream timeout
- rate-limited branch

### Visual tests

Baseline screenshots:

- homepage desktop 1600x900
- homepage mobile 390x844
- game overview desktop 1600x900
- game overview mobile 390x844
- materials desktop
- material popout desktop
- tracker import view
- tracker result view sample
- database library

## Rollout controls

### Feature flags

Use local or build-time flags for risky changes:

- new import flow
- strict freshness deploy gate
- mobile shell rewrite
- lazy data loading
- manifest asset copy

Feature flags can be simple constants at first. They only need to make rollback easier during refactors.

### Progressive rollout

Suggested rollout order:

1. Local only.
2. Build artifact verification.
3. Cloudflare preview domain.
4. Production manual deploy.
5. Scheduled automation re-enabled.

Do not let scheduled automation be the first place a pipeline refactor runs.

### Rollback plan

Each milestone should define:

- files changed
- generated files changed
- expected build output
- how to revert without touching user data
- whether user localStorage/IndexedDB migration is involved

For tracker storage changes, add migrations that are idempotent and non-destructive.

## Risk register

### Risk: import flow breaks for existing users

Mitigation:

- Keep pasted URL import.
- Add file import.
- Add clear old-data migration.
- Add compatibility parser for old localStorage sample keys but mark them as sample.

### Risk: strict validation blocks all scheduled deploys

Mitigation:

- Start strict mode as report-only for one run.
- Add manual override workflow input.
- Allow expected unavailable policies.
- Keep structural validation separate.

### Risk: mobile shell rewrite causes desktop regressions

Mitigation:

- Isolate compact CSS.
- Add screenshots for both desktop and mobile.
- Avoid changing desktop selectors unnecessarily.

### Risk: lazy loading introduces blank panels

Mitigation:

- Add explicit loading/error states.
- Keep generated data shape versioned.
- Add per-feature loader tests.

### Risk: deploy artifact budget blocks emergency data updates

Mitigation:

- Budget report first, fail later.
- Add emergency override.
- Split code/data/art deploys before enforcing strict size budgets.

## Better acceptance criteria by area

### Trust

- No old Asyce helper command in UI or built JS.
- Privacy text explains local script, proxy, storage, and deletion.
- Import result shows provenance.

### Data

- Current degraded banner states are visible in data-health output.
- Strict validation blocks invalid states.
- Workflows do not deploy after failed strict validation.

### Mobile

- Core actions reachable without hover.
- No clipped brand.
- No hidden Live/Beta.
- No hidden Pengo settings.

### Build/deploy

- `npm ci` in CI.
- Deploy after commit.
- Version metadata available.
- Clean routes smoke-tested.

### Maintainability

- New tests protect each changed behavior.
- Large files are split only after tests/measurement exist.
- Historical docs are clearly marked historical.

## Final execution recommendation

Do not start with the biggest refactor. Start with the smallest changes that remove product risk:

1. Pull import trust.
2. Strict data gate.
3. Mobile shell access.
4. CI deploy provenance.

Then use the new tests and metrics to support the larger payload/build architecture work.
