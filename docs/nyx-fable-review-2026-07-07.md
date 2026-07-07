# Nyx Whole-Project Review & Plan — 2026-07-07 (Fable)

Method: read all prior review/decision docs (2026-06-30 → 07-02), verified each finding
against `main` (git history + code greps at HEAD `39a623f4`), then live-tested the deploy
artifact (`.deploy/pengo`, built from exactly HEAD) in a browser at desktop 1600x900 and
mobile 375x812. This doc supersedes the *status* of earlier reviews; their design intent
(especially `nyx-ui-ux-visual-review-2026-07-01.md`) still stands.

## 1. Scoreboard — prior findings verified against HEAD

| Prior finding (doc) | Status at HEAD | Evidence |
|---|---|---|
| P0 remote `iex(irm)` helper trust issue | **DONE** | 0 hits for old script URLs in `Site/src`; wizard shows local/verified flow + plain-language copy |
| P0 strict banner freshness gate | **DONE** | `--strict-freshness` wired; 3 hits in workflows; UI shows LIVE NOW / UP NEXT / countdown states |
| P0 deploy artifact size | **OPEN** (accepted risk for now) | ~700MB artifact still ships whole-tree; size *reporting* exists in build output |
| P0 mobile shell (clipped brand, overflow) | **MOSTLY DONE** | live probe: brand at x=6 (not clipped), no horizontal overflow at 375px, index labels visible |
| P1 CI `npm ci` + commit-before-deploy | **DONE** | 10 `npm ci` hits; version.json written with commit/branch and smoke-verified |
| P1 worker allowlist → env config | **DONE (verify no-Origin policy)** | `envTrustedOrigins(env)` exists; whether no-Origin is still accepted needs the security review |
| P1 sample data separation | **DONE** | legacy `nyx-tracker-*` localStorage purged/migrated in tracker |
| P1 route-aware dev server | **OPEN** | game pages 404 unless served from `Site/` or the artifact (root-absolute paths) |
| P1 no lint/type/test layer for frontend | **OPEN** | repowise: hotspot health 2.34/10; `char-materials.jsx` + `generate-site-data.mjs` untested hotspots |
| React 18 UMD constraint | **RESOLVED — docs drifted** | React 19 + esbuild bundling landed; `Nyx/AGENTS.md` + decisions doc still say "don't update React" — stale |
| Redesign plan Phase 1 (deco primitives, Artwork quality, pref sync) | **NOT STARTED** | 0 hits for `deco-panel|deco-rail|game-crest|artworkQuality` |
| Redesign plan Phase 2 (mobile baseline) | **LARGELY DONE VIA OTHER WORK** | see mobile probes above; remaining: Pengo menu on mobile (below) |
| Redesign plan Phase 3 (dense surfaces) | **PARTIAL** | materials popout/kits got heavy July 5–6 work; tracker + database ledger treatments not done |
| Wish tracker design pass (`WISH_TRACKER_HANDOFF.md`) | **NOT STARTED** | last tracker UI commits June 29–30; all user feedback in the handoff still applies |

## 2. New findings (live pass, 2026-07-07)

### Functionality / correctness
1. **Banner cards render art-less for new characters.** Current 4.7 banners (Sandrone,
   Citlali; up-next Columbina) show empty dark cards. Circle icons exist
   (`…MarionetteNew_Circle.webp` → 200) but splash art 404s
   (`…UI_Gacha_AvatarImg_MarionetteNew.webp`). Two defects in one:
   (a) data pipeline doesn't ingest splash art for new characters yet,
   (b) the banner card has **no visual fallback** (should degrade to circle icon + name
   treatment, never an empty box). This is the first thing a returning user sees.
2. **Library/Database section absent from Genshin nav** at HEAD (code for `tab === 'library'`
   exists; nav showed only Overview/Materials/Tracker/TCG/Pot/Settings). Confirm whether a
   settings toggle hides it intentionally or the `visibleFns` list regressed.
3. **Boot overlay stays mounted forever** (`.nyx-boot`, fixed, full-viewport, opacity 0,
   z-50). Works because pointer-events pass through, but it's a permanent composited layer —
   unmount after fade.
4. **Tracker command blocks still overflow horizontally** — desktop: inner code 574px in a
   307px box; mobile: 4 of 9 blocks scroll. The July-1 recommendation (wrapped command
   blocks + copy button) is still the right fix.
5. **Pengo menu appears unreachable on mobile** — only the LIVE/BETA switch is present at
   375px; Ko-fi/Pengo controls not found. June-30 decision requires "core controls
   reachable" on mobile.
6. **Constant rAF/canvas animation load** — the procedural cosmos + whispers keep the
   compositor permanently busy (bad for battery/low-end; also made automated screenshots
   time out). Respect `prefers-reduced-motion`, pause when tab hidden, and consider pausing
   when a heavy panel (tracker/materials) is open.

### Coverage gaps (features that exist but no review has ever covered)
7. **TCG (GCG) section** — landed ~July 4 (`20260704-gcg-full01`), in nav, unreviewed.
8. **Serenitea Pot section** — in nav with detail pages (`pot-view`, furnishing detail),
   unreviewed. (`feat/serenitea-pot` branch also still exists — check it merged fully.)
9. **Reset Timers panel** (EU/NA/Asia, abyss/weekly/imaginarium/daily + custom timers) —
   genuinely useful, unreviewed; check timezone correctness across server regions and DST.

### Docs / hygiene
10. **Doc drift**: `Nyx/AGENTS.md` and `report-feedback-decisions-2026-06-30.md` still
    forbid React 19 (done); `WISH_TRACKER_HANDOFF.md` references the pre-esbuild world;
    `agent-index.md` "Current decision docs" doesn't include the July 1–2 UI docs.
11. Working tree carries uncommitted `.gitignore` + `AGENTS.md` improvements (agent-config
    ignore rules, vocabulary glossary) — commit when approved.

## 3. Product suggestions (beyond fixing — what would make Nyx better)

Ordered by user value per effort:

1. **Banner-first trust loop** (fix #1 above + freshness chip): the overview's first-glance
   value is "what's running, what's next, how long" — art + countdown + confidence state.
   It's 90% there; the art fallback and a small "data checked 21:41" chip complete it.
2. **The tracker pass from the handoff** is still the highest-value product work: the
   "pulls toward next 5★" story, split character banners, dense archive/history. All the
   user feedback is preserved in `WISH_TRACKER_HANDOFF.md` — execute it Genshin-first.
3. **Cross-game Nyx dashboard** (June-30 Phase 7, still unbuilt): all codes + banners
   ending soon + today's materials + pity summary in one hub view. Most of the data
   already exists per-game; this is composition, not new plumbing.
4. **Material planner** (multi-character aggregate farming list) — the roster + popout
   foundation from July 5–6 makes this the natural next materials feature.
5. **Reset-timer notifications** (later): the timers panel begs for opt-in reminders
   (code expiry, banner ending, reset in 1h). Needs the notification workstream.
6. **Library/database density redesign** (July-1 review §Database) once #2 in §2 is
   answered — list-mode default, real filters, no clipped descriptions.
7. **Account/pref sync design doc before any more sync surface** — `handleAccountSync`
   is already flagged complex; write the design doc (June-30 Phase 8) before extending.

## 4. Execution queue (written to `.agents/queue.json`)

Priority order, with the reasoning:

| # | Item | Why this order |
|---|---|---|
| nyx-0004 | Banner splash ingestion + card art fallback | First-screen defect, visible daily |
| nyx-0005 | Wish tracker design pass (handoff) | Biggest promised product improvement; spec ready |
| nyx-0006 | Tracker command-block wrap + copy buttons | Small, trust-adjacent, unblocks 0005 polish |
| nyx-0007 | Mobile Pengo-menu reachability (+ library nav question) | June-30 mobile baseline completion |
| nyx-0008 | Sync/worker security review | Fresh unreviewed crypto in production (Fable/Opus) |
| nyx-0009 | TCG + Serenitea Pot + Reset Timers QA/review pass | New surfaces, zero coverage, asset-policy check |
| nyx-0010 | Redesign Phase 1 primitives + Artwork quality setting | Foundation for all Phase-3 ledger work |
| nyx-0011 | Animation/perf pass (boot overlay, rAF, reduced-motion) | Cheap wins, battery + a11y |
| nyx-0012 | Doc sync (React/AGENTS/agent-index/handoff drift) | Prevents agents acting on stale rules |
| nyx-0013 | Dead-code triage (140 repowise findings) | Cleanup sprint fodder, Sonnet-grade |

Explicitly deferred (per June-30 decisions): deploy-size separation (report first),
mobile over-perfection (app planned), Vite migration (post-stability), account sync UI
(design doc first).

## Addendum (same day, after user feedback)

- **Banner art finding confirmed on production**, ruling out any test-browser artifact:
  `pengo.gg` returns 404 for Sandrone AND Citlali splash art while circle icons return 200.
  Production runs `486b428c` (newer than the local checkout at review time — `git pull`
  before starting nyx-0004).
- **Database hidden = intended.** Shipped the requested control: a **Database Library
  On/Off row** in the Pengo menu → Interface group (`showDatabase` in `nyx-pengo-settings`,
  default Off, participates in Interface reset). Verified: default nav has no Database;
  with the flag on, DATABASE appears and the Library view renders (63 artifacts / 247
  weapons). Remaining manual QA: click the row inside the real Pengo menu — the menu would
  not open via synthetic events in automation. Change is uncommitted in `nyx-app.jsx`;
  preview and commit when approved. nyx-0007 rescoped to mobile-menu reachability only.
- **Browser routing changed per user decision:** both apps now have a `chrome-ai`
  playwright MCP server that launches the user's real Chrome with profile "AI"
  (Profile 4) — registered user-scope in Claude and as `[mcp_servers.chrome_ai]` in Codex —
  and global instructions route real-web browsing there, keeping the isolated playwright
  only for localhost QA. Caveat: Chrome's profile lock means chrome-ai cannot launch while
  another Chrome instance is running from the same User Data dir. Neither vendor's
  extension is installed in the AI profile; installing the Claude-in-Chrome / Codex
  extensions there (user action) would enable the richer extension route later.
- The clean-route dev-server gap (P1, still open) bit during verification twice: the app
  rewrites URLs to `/genshin`, which plain static servers 404 on reload. Worth folding a
  tiny route-aware dev server into nyx-0011 or its own small item.

## 5. Verification pattern for every queue item

Unchanged from `agent-index.md` gates: Scraper `npm test` + `npm run validate:strict`,
Site `npm run build:deploy` + `npm run smoke:deploy`, browser check on the artifact
(desktop + 375px), no console errors, no broken images, screenshots for UI work.
Deploy guard: production `wrangler deploy` is hook-blocked without explicit approval;
preview via `wrangler.preview.jsonc` only.
