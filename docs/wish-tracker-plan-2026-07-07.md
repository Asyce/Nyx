# Wish Tracker Design Pass — Plan (nyx-0005) · 2026-07-07 (Opus)

Grounds `WISH_TRACKER_HANDOFF.md` (still the source of truth for *user intent*)
against the **current** tracker code, which has moved well past what the handoff
describes. This plan is a focused gap pass, not a rebuild.

## Reality check — what already exists (do NOT redo)

Current tracker (`Site/src/features/gacha/gacha-tracker.jsx`, `gtRenderResultsView`)
already has a 3-tab result view:

- **Overview**: Account summary (6 stats: total/character/weapon pulls, currency, 50:50 W/L, avg pity) · Current limited banners · 5-Star pulls list (icons, outcome, pity) · expandable Banner history (5★/4★ counts, paired weapons, per-banner 5★ detail).
- **Pity Observatory**: horizontal 0→hard-pity track per banner, soft-pity marker, one dot per 5★ colored by outcome (early/soft/guaranteed/50:50), with filters. This is a clean distribution strip — it already replaced the "awkward timeline" the handoff complained about. **Leave the concept; polish only.**
- **Archive**: sortable console (copies/recent/rarity/name) + filter pills + copy-total side strip. Handles copies beyond C6. **The handoff's "archive sortable by copies/constellation" ask is done.**

Data is multi-game-parameterized already: `PULLS`, `CUR`, `COST`, banner labels come from `cfg`/adapters, not hardcoded Genshin strings.

## Durable user priorities (from the handoff — these still drive the pass)

1. **THE hero story = "pulls done toward your next 5★"** (+ whether it's guaranteed).
2. Current-banner context must say **"these are the pulls YOU did on these banners"** — not duplicate the banner overview. Cap recent shown at 6.
3. Support **two parallel character banners** + weapon banner nearby.
4. Pity distribution: keep, keep it clean (done).
5. History: **denser and more useful**, filterable.
6. Use character **images** properly; never the Khaenri'ah font in the tracker.

## Gap analysis (priority → current state → action)

| Priority | Current state | Gap? |
|---|---|---|
| 1. Pulls-toward-next-5★ as hero | Only a small `gt-tab-status` line ("N since last 5★") | **YES — biggest gap.** Promote to a real hero module. |
| 2. "What you pulled on THESE banners" | `gt-current-limited` shows banner *metadata* (rate-up names), not the user's pulls on them | **YES — real gap.** |
| 3. Two parallel char banners + weapon | Banner history groups them; current-banner hero doesn't foreground both | Partial — fold into the new hero. |
| 4. Clean pity | Observatory track is good | No — polish only. |
| 5. Denser filterable history | 5★ list + expandable banner history exist; no single chronological all/5/4/weapon history | Partial — add compact filterable history. |
| 6. Images / no Khaenriah font | Icons + `gt-img-fallback`; confirm font exclusion | Verify (font rule already exists in CSS: `.nyx-pengo-menu` excluded; confirm tracker not swept by `html.nyx-khaenriah .gp`). |

## Phased plan

### Phase 0 — Validate with real data (prerequisite; needs the user's file)
- Import `C:\Users\cedri\Downloads\paimonmoe_wish_history.xlsx` via the tracker (file import already supports `.xlsx`).
- Assert every 5★/4★ row resolves an icon; log unresolved names (a debug pass) and confirm the `gt-img-fallback` never shows for a real GI character.
- Screenshot the populated Overview / Observatory / Archive at 1600×900 and 375×812 as the baseline.
- *Gate:* nothing else starts until the populated view is captured — the redesign is hierarchy work that only makes sense against real data.

### Phase 1 — Hero module (priorities 1–3, highest value)
- New `gt-hero` block at the top of Overview (above `gt-overview-grid`), built from existing `currentState`, `characterView.currentPity`, `pityBanners`, and `bannerGroups`:
  - **Left: pity/guarantee state.** Big current pity number toward soft/hard, and a clear "Next 5★: Guaranteed / 50:50" chip (reuse `nextState`, `gtPullOutcomeClass` colors). This is priorities 1+2 merged into one module, as the user asked.
  - **Right: current character banners (up to 2) + weapon.** For each active limited character banner, show the featured character art and **your recent pulls on that source group, capped at 6** (pull from `bannerGroups` matched to `currentLimited`, not banner metadata). Answers "what did I pull on these banners".
- Keep `gt-current-limited` OR fold it into the hero's right column (decide during build to avoid duplication with the banner overview elsewhere).
- *Acceptance:* hero shows pity-toward-next-5★ + guarantee at a glance; two parallel char banners both visible with the user's own recent pulls (≤6 each); no duplication of the standalone banner overview.

### Phase 2 — Compact filterable wish history (priority 5)
- Add a chronological history list (all pulls, newest first) with filter pills: **All / 5★ / 4★ / Weapons**, reusing the `gt-filter-pills` pattern already in Archive.
- Dense rows (icon + name + banner + date + pity), virtualized or capped-with-"load more" if large, so it never becomes a wall of empty cards.
- *Acceptance:* history filters switch instantly; 5★/4★/weapon subsets correct; dense layout, no oversized cards.

### Phase 3 — Polish + multi-game + a11y (priority 6)
- Confirm the Khaenri'ah font never applies inside the tracker (add `.gt-results` to the font-exclusion selector if `html.nyx-khaenriah .gp *` sweeps it).
- Verify every surface uses `PULLS`/`CUR` (no leaked "Wishes"/"Primogems" on HSR/ZZZ/WuWa) — spot-check each game.
- Touch targets ≥40px on mobile for tabs/pills; reduced-motion respected; no horizontal overflow at 375px.
- *Acceptance:* HSR/ZZZ/WuWa/Endfield show correct per-game terms; 375px clean; no Khaenriah font in tracker.

## Verification (every phase)
Handoff's "Verification Checklist For Tracker Work", plus: `npm --prefix Site run build`, browser check of the populated view at 1600×900 and 375×812, zero console errors, and the deploy gates (`build:deploy` + `smoke:deploy`) before any deploy. **Local preview only; user approves before deploy.**

## Non-goals / explicitly out of scope
- No new gacha math, adapters, or data-shape changes (display only).
- Don't rebuild the Pity Observatory or Archive — they meet intent.
- Don't add account/sync UI here (separate workstream).
- No from-scratch visual reskin; this rides the existing `gt-*` system + the Phase-1 deco primitives from nyx-0010 when they land.

## One open question for the user (decide before Phase 1 build)
The hero could either (a) **replace** the current small `gt-tab-status` line and `gt-current-limited` card, or (b) **sit above** them as an additional band. (a) is cleaner and matches "don't duplicate the banner overview"; (b) is lower-risk. Recommend (a). Confirm before building Phase 1.
