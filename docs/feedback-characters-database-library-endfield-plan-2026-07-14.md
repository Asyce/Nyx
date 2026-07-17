# Characters, Database, Library, and Endfield Feedback Plan

Status: ready for implementation on `codex/genshin-timeline-redesign`.

This pass corrects the 14 feedback items supplied on 2026-07-14. It preserves
saved favourites, Library annotations, custom timers, existing generated-data
contracts, and all work from the preceding timeline pass. It does not deploy,
push, or modify the separate achievements worktree.

## Product decisions

1. Pinned favourites belong to the Roster scroll, not the fixed controls. In
   Card mode the first five remain cards and every later favourite is an icon
   immediately below. The full non-favourite roster always remains reachable.
2. Only the Roster/Talents/Trounce row stays fixed. Pinned favourites scroll
   away with the roster. The decorative burst beside its heading is removed.
3. Character section tabs reuse Nyx's ledger-tab language but stop growing at
   roughly 326 px each, matching the supplied Weekly Challenge reference.
4. A weekly boss panel is a compact boss ledger: sourced boss art sits quietly
   on the right, while its three drop items and matching character icons remain
   readable on the left. Character splash art is never used as boss art.
5. Weekly boss order is explicit game chronology, newest first, rendered in
   normal row-major order: newest column 1, second-newest column 2, third-newest
   next row column 1.
6. Database rarity is a filled material frame, not a colored outline. Every
   Database art surface receives the treatment. Valid source rarity maps to the
   existing 1–6 palettes; unsupported or missing rarity is explicit tier 0
   (white/grey Unknown). TCG keeps its card proportions inside a tier-0 frame.
7. Library body search is a contiguous phrase search inside one text leaf.
   Completed query words match exactly; only the final query word may be a
   prefix. `phane` therefore matches `Phanes`, while scattered `and`, `the`, and
   `moon` do not satisfy `and the moon`.
8. Library search carries the matching volume and exact source ranges. Opening
   a result selects that volume, temporarily highlights the complete phrase,
   and scrolls the first hit to the center. Temporary query marks compose with
   manual formatting but never enter IndexedDB.
9. Endfield categories follow the two cited source pages, never the existing
   inferred `kind` field:
   - Growth Materials: Kalkodendra, Chrysodendra, Vitrodendra, Blighted
     Jadeleaf, False Aggela.
   - Progression Materials: D96 Steel Sample 4, Metadiastima Photoemission
     Tube, Quadrant Fitting Fluid, Tachyon Screening Lattice, Triphasic
     Nanoflake.
   Unclassified materials remain in character calculations/details but do not
   enter either overview tab by guesswork.

Sources:

- https://endfield.wiki.gg/wiki/Item/Rare_Materials
- https://endfield.wiki.gg/wiki/Item/Progression_Materials

## Visual direction

The page remains a Nyx planning ledger. Existing Abyss/Ledger/Violet tokens,
GI/HSR type roles, and orbit navigation remain unchanged. This pass spends its
visual emphasis on one signature element: the compact weekly-boss ledger panel
from the supplied mockup. Everything else becomes quieter—short tabs, no
Pinned Favourites ornament, brighter but brief hover violet, and filled rarity
frames that carry real data rather than decorative borders.

```text
[ Roster ][ Talents ][ Trounce Domain ]       (each <= ~326 px)
---------------------------------------------------------------
  Pinned Favourites [Card/Icon/Hide]          (scrolls away)
  [card][card][card][card][card]
  [icon][icon] ...                            (favourites 6+)
  Recent | Upcoming
  Full roster ...

  The Doctor                     [boss art, low-contrast right]
  [drop] [character] [character]
  [drop] [character]
  [drop] [character]
```

## Dependency-ordered implementation

### Batch A — weekly source/data correctness

- Treat the exact 42 IDs in `GI_WEEKLY_BOSS_SPECS` as weekly drops regardless
  of names such as Dragon Lord's Crown. Only the real generic Crown of Insight
  remains a generic crown.
- Preserve every sourced weekly requirement for multi-form Traveler, remove
  the one-match early exit, and deduplicate names per drop.
- Generate exactly 14 bosses × 3 drops, keep all drop rows even before a
  character uses one, and attach local boss art from GI monster assets with
  explicit aliases for Exalted Master, Everlasting Lord, and Andrius.
- Add a monotonic `releaseOrder` to every boss spec and assert this exact
  newest-first sequence: Exalted Master of the Heretical Path, The Doctor, The
  Game Before the Gate, Lord of Eroded Primal Fire, The Knave, All-Devouring
  Narwhal, Guardian of Apep's Oasis, Everlasting Lord of Arcane Wisdom,
  Magatsu Mitake Narukami no Mikoto, La Signora, Azhdaha, Childe, Andrius,
  Stormterror Dvalin. Never re-sort by character release date.
- Verify 42/42 drops, Azhdaha's Dragon Lord's Crown, zero duplicate character
  name per drop, and set equality between the generated weekly-character union
  and every current live GI roster entry that has a sourced weekly requirement.
  Today's expected snapshot is 116/116; any missing weekly ID must fail with a
  named gap report rather than silently reducing that set.
- Verify 14/14 `boss.art` paths resolve to local monster/boss assets and zero
  paths resolve to character or splash-art folders.

### Batch B — Characters and topbar UI

- Move the Roster-only pinned block inside the scrolling body before roster
  groups; keep only the section-tab row fixed.
- Remove the Pinned Favourites ornament. Preserve five cards plus overflow
  icons and saved Card/Icon/Hide preferences.
- Cap each section tab at exactly 326 px including its own padding; gaps remain
  outside that width. Add deliberate 1/2/3-column responsive rules.
- Move Back beside Materials/Character Kit inside the character detail action
  row while retaining Calendar/Nyx origin-aware labels.
- Render boss panels from `boss.art` only and match the supplied compact layout.
- Use one shared EU/NA/Asia/Custom implementation on GI, HSR, ZZZ, WuWa,
  Endfield, and Nyx Overview surfaces. Keep it in the game-icon header row,
  right-align it directly above the Reset Timers column, and verify zero region
  controls remain inside Reset Timers.
- Increase game medallions from 64/52 px to exactly 68/56 px
  (outer/image); leave the Nyx medallion at 74/60 px. Verify mobile rail
  scrolling prevents collision.
- Define one shared character hover/focus token `#c18cff` at 0.86 glow opacity.
  Both favourite and non-favourite characters use it only on hover/focus; no
  selected or permanent favourite glow returns.

### Batch C — Database rarity surfaces

- Add one shared Database item-frame adapter around the existing material frame
  component. Always pass explicit tier 0 for Unknown.
- Use it on Collection, Wonderland, Pot, and TCG list/detail art while
  preserving source art proportions and modal sizing. The TCG adapter reuses
  the same tier-0 fill/rim palette but has a portrait-aspect variant; it does
  not force card art into the square material frame.
- Require zero source-to-normalized rarity mismatches for every row with a
  supported source rarity. Tier 0 must always be passed explicitly and never
  fall through the component's tier-4 default; 1-star grey must remain visibly
  distinct from Unknown white, and Endfield 6-star remains red.
- Preserve these honest current-snapshot Unknown groups: GI monsters 547 and
  items 2,270; HSR relic sets 60, monsters 577, and light cones 3; ZZZ drive
  discs 28; WuWa echoes 180; Endfield gear 129; TCG cards 619. Preserve GI
  artifact highest-obtainable-tier logic and never infer rarity from rank,
  family, camp, or a multi-tier WuWa Echo array.

### Batch D — Library phrase-prefix navigation

- Replace schema-v1 word postings with a deterministic volume-aware schema-v2
  index containing normalized public leaf text, sorted book IDs, and safe
  volume keys. Keep each runtime file below the publisher's 5 MiB limit.
- Implement contiguous leaf-local phrase matching with final-token prefix only.
- Carry and revalidate the matched volume/ranges when opening a result; fall
  back safely if a generated index is stale.
- Render temporary query ranges alongside manual annotation segments, select
  the matching volume, and scroll the first hit once. Do not change the
  `nyx-library-annotations` IndexedDB schema or write query highlights.

### Batch E — Endfield overview correction

- Rename tabs to Growth Materials and Progression Materials.
- Generate Growth only from the five sourced rare plants in talent
  requirements.
- Generate Progression only from the five sourced Rare Progression items across
  the deduplicated union of ascension and talent requirements.
- This Progression tab intentionally means the five **Rare Progression
  Materials used by character requirements**, not all 21 general progression
  items listed by the broader wiki category.
- Keep all other requirements in details/calculations. Emit an audit gap instead
  of guessing any new item category.
- Record both source URLs, `sourceCheckedAt: 2026-07-14`, and available page
  revision/last-edited metadata in the generated classification audit.
- Verify exact 5+5 membership, local icons, and 4/5-star rarity. For each view,
  require set equality against the current 28-character source requirements;
  any missing or extra character fails with a named gap list. No silent
  exceptions are allowed.

## Final gate

- Author-focused tests after each batch; a different agent verifies each
  author's diff.
- Full Scraper and Site tests, strict validation, pinned-favourites fixtures,
  `build:deploy`, and `smoke:deploy`.
- Disposable-browser checks at 390×844, 1600×900, and 2560×1080 for scrolling,
  overflow icons, tab widths, Back placement, boss art/order/completeness,
  topbar alignment, Database frames, Library volume/highlight/scroll, focus, no
  horizontal overflow, broken art, or console errors.
- `git diff --check`, generated-asset audit, secret scan, worktree-isolation
  check, and an independent CEO challenge review.
- No commit, push, pull request, or production deployment without a new ask.
