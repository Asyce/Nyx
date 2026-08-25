# Material card — ruleset

Spec for the condensed material infographic that the **Infographic** button on a
character page produces. Written so a new character works the moment it appears
in the shipped game data, with no per-character code.

Reference implementation in `tools/material-card/`:

```
node extract.mjs      chars.json Skirk Furina ...   game data  -> chars.json
node scrape-sites.mjs --for chars.json sites.json   the wiki   -> sites.json
python render.py      cards.html                    both       -> cards.html
```

Genshin is the default; `CARD_GAME` selects the others — `hsr` (§10), `zzz`
(§11), `wuwa` (§12) and `ae` (§13). One engine serves all five — the profile in
`extract.mjs` says only which families that game has and how to present them:

| flag | what it decides | gi | hsr | zzz | wuwa | ae |
|---|---|---|---|---|---|---|
| `layout` | the tile order (§4) | 5 wide | 4 wide | 4 wide | 4 wide | — |
| `maxLevel` | the level the card is costed to | 90 | 90 | 60 | 90 | 80 |
| `showsTargets` | whether the talent block appears (§2) | yes | no | no | no | no |
| `lowerMode` | what the dim second figure means (§2a) | talents | with weapon | with weapon | with weapon | with weapon |
| `claimsNew` | a missing source means "too new to be catalogued" (§5) | yes | no | no | no | no |
| `weaponWord` | what the second block is called | weapon | light cone | W-Engine | weapon | weapon |
| `dbDir` | where `Database/GameData` keeps it, when not the game key | — | — | — | `ww` | — |
| `alwaysWide` | every card gets an explicit tile order (§4a) | — | — | — | — | yes |

Every boolean defaults to the conservative answer for a game nobody has looked
at yet: no talent block, no **new** claim.

**The currency is not in the profile.** Every game ships its own name and icon
as `cfg.cur` / `cfg.curIcon`, so those are read from the data — which is shorter
than a lookup table and cannot point a Star Rail card at Genshin's Mora coin.

It runs standalone from `tools/material-card/` — the font subsets it needs are
in `fonts/`, and wiki responses cache under `wiki-cache/`.

## Where it runs

The card is **live** on the character page (2026-08-25). The offline pipeline
above is still the design surface, but the site no longer uses the old canvas
renderer for it:

```
generate-site-data.mjs  ->  cm-data-<game>.js      the game data, as the site sees it
generate-card-data.mjs  ->  cm-card-<game>.js      one card model per character
                            cm-card-<game>-weapons.js
                            cm-card-style.js       card.css + the two font subsets
char-materials-card.js  ->  the PNG the button downloads
```

`Site/tools/generate-card-data.mjs` runs `extract.mjs` once per game as part of
`npm run build`, straight after `generate:data` — it reads the generated packs,
so the order matters. The output is git-ignored: it is derived from data the
daily refresh rewrites, and every build regenerates it.

`char-materials-card.js` is a port of `render.py`. It builds the same markup,
wraps it in an SVG `<foreignObject>` and draws that into a canvas, so the
browser does the layout and the gradients, masks and stretched captions come out
as they do offline. Three consequences shape the code:

- **The foreignObject is its own document.** It cannot reach the page's
  stylesheets, fonts or images, so every asset is inlined as a data URI first
  and `card.css` ships inside `cm-card-style.js` with both font subsets baked in.
- **It is parsed as XML.** A bare `<` or `&` anywhere in the style sheet — a
  comment mentioning a tag is enough — makes the document malformed and the
  image fails to load with no error worth reading. The sheet goes in a CDATA
  section.
- **Captions are sized by measuring text**, where `render.py` reads advance
  widths out of the font. The measuring face has to be loaded before the markup
  is built, or every caption is sized against a fallback.

What `render.py` resolved by looking at the filesystem — meta icons, the weapon's
gacha art, gather sites — is baked into the card data at build time instead.

The old canvas renderer, `nyxRenderMaterialsCard` in
`Site/src/features/materials/char-materials-share-card.js`, stays as the
fallback: the button tries this card first and drops back to it for a character
with no card data, or a browser that cannot rasterise. Nobody loses their image.

Two things the offline sheet does not have to answer:

- **The weapon can change.** The page has a weapon picker, and the signature
  baked into the character is only its default. An explicit swap loads
  `cm-card-<game>-weapons.js` and recomputes the combined lower line (§2a).
- **A form character is several cards.** Traveler, Trailblazer and Rover are
  filed per element as `Name:Element`; the runtime addresses them from the
  active form and titles the card with the name the page shows — "Aether
  (Anemo)", not "Traveler (Anemo)".

Verified across all 367 cards in the five games: every one renders, median under
a second (Star Rail ~1.8s, the slowest game).

Validated against the full 120-character roster: every family resolves to its
expected tier count, with one intentional exception (Traveler, who has no
ascension boss material).

---

## 1. Families

A **family** is a set of materials that differ only by rarity. It collapses to a
single tile.

> Two items belong to the same family when they share an identical
> `sourceDetails` list **and** form an unbroken rarity ladder.

**Do not group on `kind`.** The shipped data mislabels it often enough to break
things. Traveler alone contributes two more: Hydro's middle enemy tier
(`Transoceanic Chunk`) is tagged `gem`, and Pyro's weekly material is tagged
`specialty`. Both vanished from the card until the families were found by source
instead. Other examples: `Fragment of an Ancient Chord` is tagged `gem` while its three siblings
are `weapon`; Neuvillette's second-tier enemy drop is tagged `gem`; Arlecchino's
ascension boss drop is tagged `gem`. Grouping on `kind` split those families and
produced five-tier gems and two-tier enemy drops.

The ladder half matters for the rare case where two families genuinely share
one source list — Tulaytullah's Remembrance draws two separate fungal lines from
the same enemies. Walking the group in id order and breaking wherever the rarity
stops climbing separates them, because a repeated or falling rarity can only
mean a second family has started.

**Do not also require consecutive ids.** Genshin numbers a family one apart, but
Zenless numbers it ten apart (100112 / 100122 / 100132), and an adjacency test
shattered every Zenless family into singletons.

Families are then identified by **shape**, not by name or kind:

| family | how it is identified | tiers |
|---|---|---|
| gem | the 4-item ascension group | 4 |
| common | the 3-item ascension group; **its talent amounts are added on top**, matched by source | 3 |
| boss | whatever single ascension item is left once gem, common and specialty are taken | 1 |
| specialty | `kind = specialty` (no source, so nothing else can identify it) | 1 |
| books | the 3-item talent group whose source differs from the common family's | 3 |
| weekly | `kind = weekly` | 1 |
| crown | `kind = crown` | 1 |
| exp | the leveling table, see §3 | 1 |
| mora | ascension + talent + leveling cost | 1 |

The leftover rule for the boss drop is what makes it robust: neither `kind` nor
the presence of a source can be trusted there — Arlecchino's is tagged `gem`,
and Navia's, Baizhu's and six others have no source recorded at all.

Weapon families use the same grouping: the 4-tier group is the ascension domain
material, the 3-tier groups are enemy drops ordered by descending top rarity.

A family renders as **its top tier's icon**, with **one figure per tier**,
ordered low rarity → high.

## 2. Targets

**Only Genshin carries a talent block at all** — the skill icons in the top-right
corner and the level figures under them. It is the one game with a real decision
to report: the tenth talent level is what costs a Crown of Insight, so stopping
at 9 is a common and deliberate choice, and the gap between the two builds is
worth printing.

Star Rail, Zenless, Wuthering Waves and Endfield have no equivalent gate. The
build is simply maxed, so a row stating that would read the same on every card
in the game and say nothing. It is omitted entirely — icons and figures both,
not blanked or zeroed — and the header slot above the last column is left empty.

Where the block is shown, it carries two lines:

- **10/10/10** — every talent stage.
- **9/9/9** — talent stages 2–9 only (drop the last).

Ascension, specialty, gem, boss, EXP and the ascension half of the common family
are identical between them; only talents move.

The levels are **read off the data**, never written down: each talent reaches
`talentStages[i].length + 1`. The text is fitted to the column width, so a game
with four talents does not wrap where three fit comfortably.

`showsTargets` controls the block, and is **false by default**, so a new game is
quiet until someone establishes it has something to say.

### 2a. The dim second line

Every tile can carry a second, dimmer figure beneath its own. What that figure
*means* is per-game, set by `lowerMode`:

| mode | the second figure is | used by |
|---|---|---|
| `talents` | the one-below-max talent build | Genshin |
| `withWeapon` | the character **and** the signature weapon together | Star Rail |

Star Rail has no talent choice to report, so the line is spent on something a
reader does want instead: the combined bill. Families are paired between the
character and the weapon **by the material they hold**, so only the tiles the
weapon actually shares carry a figure — trace materials, enemy drops and
currency. EXP does not pair, because a character and a cone eat different packs.

Either way the rule is the same: **print only what changes**. Unchanged slots
are hidden but keep their column, so the figure lands directly under the one it
relates to.

The row is emitted even when every figure in it is hidden. It is what keeps
cells the same height, and the grid bottom-aligns them — drop it and a tile with
no second figure floats above its neighbours.

## 3. EXP packs collapse to their top tier

EXP is three pack sizes. Convert the whole bill into the largest pack:

```
ceil( Σ(qty × exp_value) / exp_value(top pack) )
```

**The pack values are not hard-coded.** Both games print them in the item's own
description — "Gives 20,000 EXP", "Provides `<unbreak>`6000`</unbreak>` Light
Cone EXP" — so they are parsed out of `items.json`. A new pack size needs no
code change, and a game whose numbers differ works for free.

Genshin character → **419 Hero's Wit**; 5★ weapon → **907 Mystic Ore**.
Star Rail character → **291 Traveler's Guide**; 5★ cone → **167 Refined Aether**.

## 4. Layout

One panel. Character block, a rule, then the weapon block.

```
Genshin — five columns
row 1   weekly src  │ boss src │ common src │ gather sites │ skills + targets
row 2   weekly      │ boss     │ common     │ specialty    │ books
row 3   crown       │ gem      │ exp        │ Mora         │ nyx mark + pengo.gg
─────────────────────────────────────────────────────────────────────────────
weapon  (only when a signature weapon exists)
row 1               │ elite src │ common src │
row 2   domain      │ elite     │ common     │ Mora     │ exp ore

Star Rail — four columns; no gem, no local specialty, no talent block
row 1   weekly src  │ boss src │ calyx      │ enemies
row 2   weekly      │ boss     │ trace mats │ common
row 3   tracks      │ exp      │ Credits    │ nyx mark + pengo.gg
─────────────────────────────────────────────────────────────────
light cone
row 1   calyx       │ enemies  │
row 2   trace mats  │ common   │ exp aether │ Credits

Zenless — four columns; no common drop, no local specialty, no talent block
row 1   weekly src  │ boss src │ promotion  │ skills
row 2   weekly      │ boss     │ seals      │ chips
row 3   hamster     │ exp      │ Dennies    │ nyx mark + pengo.gg
─────────────────────────────────────────────────────────────────
W-Engine
row 1   components  │
row 2   components  │ exp      │ Dennies
```

### 4a. When a character has more families than slots

Most characters have one enemy line and one book line. Traveler has two and
three — each of its talents draws a different book series, and ascension and
talents draw different enemies — and Geo has three and six, because it draws
from two nations at once. That does not fit a five-column layout, so such a
character gets an explicit **tile order** and a **width** instead of the
profile's fixed rows.

- Address one elemental form as `Traveler:Anemo`. The roster entry carries a
  `forms` array — 14 forms with complete materials each, male and female
  identical, so seven distinct sets. The top-level entry is byte-identical to
  `anemo:male`.
- Header-bearing tiles (weeklies, enemy lines, specialty) are ordered first so
  they all land in the top row, where the header strip lives. Width is
  `max(6, headers + 1)`, the `+1` keeping the talent block clear of them.
- Remaining tiles flow into as many rows as they need; branding takes the last
  free cell.

The trigger is having more than one weekly, enemy or book family — nothing is
named, so any future character with the same shape gets the same treatment.

**Order comes from the profile, width from the data.** Each game names its rows
in `layout`, since not every game has the same families or wants them in the
same order. The column *count* is never configured: the card is as wide as the
families the game actually returns — `max(len(rowA), len(rowB) + 1)`, the `+1`
reserving the branding slot.

Weapon families are ordered: ascension domain, then enemy-drop groups by
descending top rarity, then currency, then EXP.

## 5. Sources

A family's source is the monster it drops from. Four passes, each falling back to
the next, because the shipped `sourceDetails` is patchy:

1. **`sourceDetails` carrying an icon.** The normal case.
2. **`sourceDetails` name, looked up in the monster database.** Weekly-boss
   entries carry a name but no icon. Match against
   `Database/GameData/gi/*/monsters.json` by both `name` **and** `title`.
3. **The weekly-boss alias table.** Those two names do not always agree: the
   material data calls Mirror of Mushin's boss *Everlasting Lord of Arcane
   Wisdom*, while the monster database files it under *Shouki no Kami, the
   Prodigal*. `generate-site-data.mjs` already carries that mapping in
   `GI_WEEKLY_BOSS_SPECS[].artAliases`, so read it from there rather than
   keeping a second copy.
4. **The item itself.** With no `sourceDetails` at all, match the item's text —
   description *and* flavour text, since Star Rail only names the enemy in the
   latter — against every monster name and title. Failing that, match a 7+
   character token from the item's **name**: "Artificed Spare Clockwork
   Component — Coppelius" finds *Nemesis of Coppelius*.

   Token matching has two guards, both learned the hard way:

   - **The token must belong to exactly one monster.** "eternal" appears in half
     a dozen Star Rail names and put a *Lance of the Eternal Freeze* on
     Castorice's Eternal Lament. Ambiguous tokens are dropped, not guessed.
     Monsters are compared by *portrait*, not name, so the database listing
     "Shape Shifter" twice — once tagged `(Bug)` — does not make its token look
     ambiguous.
   - **Only things a monster actually drops are eligible.** Trace books and EXP
     come out of domains; letting them match a name in their flavour text put a
     Calyx boss's face on Kafka's light cone.

> **Never discard a source you cannot illustrate.** Filtering the resolved list
> down to entries that have an icon was the cause of every wrong **new** chip:
> Skirk's, Chasca's and Alhaitham's weekly bosses all had a perfectly good named
> source that the filter threw away. Resolve first, render whatever survives.

Sources are **deduplicated by portrait**. Six Oprichniki share four faces, and
drawing the same face four times in one cluster says nothing while eating slots.
Across the Genshin roster this removes 54 redundant portraits from 15 clusters
and costs no information.

| what resolved | rendering |
|---|---|
| at least one icon | portrait or cluster, below |
| a name but no icon | the name itself, as a chip |
| nothing at all | a **new** chip — but only where that means something, below |

**The "new" chip is a per-game claim.** It says "this shipped before anyone
catalogued it", which is only a fair reading in a game that normally records
sources. Genshin does, so a blank there is real news. Star Rail records none at
all, so a blank says nothing and the slot is left empty instead. The profile
flag is `claimsNew`.

| icon count | rendering |
|---|---|
| 1 | single 56px portrait |
| 2–6 | cluster, 3 across, 26px icons |
| 7–8 | 6 in the cluster, the rest nested in the gaps between rows |

The **weapon** rows never use the big portrait, however few sources a family has
— a 56px face beside 90px tiles reads as another material rather than as a
source. They use the character cluster's icons at exactly the same size (26.67px,
derived from the 86px strip rather than hard-coded, so the two can never drift),
but on one line only: 3 shown, and past that 2 icons plus a **+N** chip.

Three slots is what a 90px tile holds at that size — 3 × 26.67 + 2 × 3 = 86px. A
fourth would come to 115px and overrun the 10px column gap into its neighbour.

Coverage over all 120 characters: **586 of 591** rendered source slots get a
portrait, none fall back to a name chip, and 5 show **new** (§10).

### 5a. Circle art must reach the rim

The shipped portraits are 256px frames with the subject floating inside, so
dropping one straight into a round container leaves a crescent of dead
background. Every circular container therefore rebuilds its image:

1. **Find the art.** A plain alpha bounding box is useless here — one stray
   anti-aliased pixel holds a whole edge open, which is why most of these icons
   measure as "already full-bleed" and still look empty. A row or column counts
   as art only once **>0.4 %** of it clears **alpha 24**.
2. **Crop to it.**
3. **Square it around the centre of mass.** A circle wants a square, so one axis
   has to lose pixels. Taking them from the geometric middle beheads anything
   drawn off-centre; taking them around the alpha centroid keeps the creature.
4. Re-encode as WebP and let `object-fit:cover` scale it up until the circle is
   full.

Small images are scaled **up** — filling the circle takes priority over native
resolution, since these render at 26–56px.

The cost is that a very wide or very tall subject loses its extremes: the
Hunter's Ray is a 256×110 sliver, so only its middle third survives. That is the
unavoidable price of a full circle, and it affects 9 of 90 source icons.

## 6. Numbers

- Figures joined by `/`, low rarity first.
- **Single-tier tile → white.** The frame already carries the rarity.
- **Multi-tier tile → each figure tinted by its own rarity**, because the tile can
  only show the top one. Colour is redundant with position, never load-bearing.
- Where the game has a second target (§2), that line sits underneath, dim, and
  prints **only figures that changed**; unchanged slots are hidden but keep
  their column so the changed figure lands directly under the one it replaces.
  Where it does not, the line is absent entirely — not blank, not zeroed.
- A figure that drops to **0 prints nothing**.
- Currency ≥ 1 000 000 → `X.XXM`, else grouped with `.`.
- A row too wide for its tile **scales its figures down**, which four-tier
  ladders need — `29/40/52/61` is eleven characters under a 90px tile and used
  to collide with the next column.
- **Line heights are fixed pixels, not multiples of the font size.** Cells are
  bottom-aligned, so a row that shrank its own height lifted its tile out of
  line with its neighbours — visible wherever one tile's figures scaled and the
  next tile's did not.

### 6a. Every icon belongs to its own game

Tile art comes from the family's own top-tier item, so it is right by
construction — except the currency tile, which has no item behind it in the
requirement lists. It is looked up **by name in that game's `items.json`**
(`Mora` id 202, `Credit` id 2), and the profile carries the name. Nothing is
hard-coded: pointing a Star Rail card at Genshin's Mora coin is exactly the bug
this replaced, and a missing lookup is now a hard error rather than a silent
fallback to the wrong game's art.

The same rule covers the element and weapon/path chips: `Site/assets/meta/<game>/`,
trying the plain name first and then the game's own prefix — Star Rail files its
Paths as `path_remembrance.png` and its elements plainly.

## 7. Frames

### 7a. Spacing

A caption belongs to the tile beneath it, so the gap between them is small: a
3px grid row gap, and caption lines whose box is 1.12x the font size rather than
the 1.30x that reserved room for descenders nothing uses. The gap **below** a
tile — between its art and its figures — is larger and deliberately so, because
those figures are the tile's own label rather than a heading for what follows.

Tiles reuse the site's own item frame: the rarity gradient, the rarity glow, and
`nyx_eye_line.png` masked at 22 % opacity — same `--cmf-*` maths as
`.cm-item-frame`. Panel chrome is `.gp-panel`'s violet rim over
`--nyx-gradient-panel`; the element colour appears **only** as the ambient bloom,
as on `.cm-pop`.

## 8. Degradation

Every one of these already occurs in the current data:

| situation | behaviour | seen on |
|---|---|---|
| no signature weapon | weapon block omitted entirely | Vesna, Vodyanitsa, Alyosha |
| no source at all | **new** chip in the header slot | Chiori, Lynette, Kirara, Baizhu, Vesna |
| source named but not illustrated | the name as a chip | nothing currently; every named source resolves to a portrait |
| family has exactly 1 source | portrait on a character, one small icon on a weapon | Skirk |
| more sources than fit | `+N` chip in the last slot, so 2 icons + `+N` on a weapon | most 5★ weapons |
| no ascension boss material at all | boss column omitted | Traveler |
| announced but not shipped | the entry is skipped, with a reason | Star Rail's Pearl |
| specialty page carries no prose | gather line falls back to the nation | Alhaitham (Sumeru), Neuvillette (Fontaine) |
| beta character | renders from the beta pack | Vesna, Vodyanitsa |

## 9. Gather sites are scraped

The lines above the specialty tile are not in the game data. `scrape-sites.mjs`
takes them from the wiki's `How to Obtain` section, in three passes, each falling
back to the next:

1. **Wiki links in the lead paragraph**, kept only if the linked page is in
   `Category:Locations`. That filter is what rejects boss arenas used as
   landmarks — Dendrobium's paragraph links Maguu Kenki and the Pyro Hypostasis,
   and neither is a Location.
2. **Capitalised phrases**, for pages that name a place without linking it
   ("Cecilias grow exclusively on Starsnatch Cliff"). Still category-checked, so
   a stray proper noun cannot slip through.
3. **The region from the infobox** (`Local Specialty (Snezhnaya)`). A nation is a
   worse answer than a subarea but better than an empty slot — needed for
   Nilotpala Lotus and Lumidouce Bell, whose pages carry no prose at all, only a
   link to the interactive map.

Responses are cached under `wiki-cache/` and requests are spaced 300 ms apart.
Coverage on a 12-specialty probe: 12/12, of which 2 fall back to the region.

## 10. Star Rail

The ruleset transfers. `CARD_GAME=hsr` swaps the profile; everything in §1-§8
runs unchanged. What differs is what the game *has*:

| Genshin | Star Rail |
|---|---|
| gem, 4 tiers | — |
| local specialty + gather sites | — |
| common enemy drop, 3 tiers | the same, 3 tiers |
| talent books, 3 tiers | trace materials, 3 tiers |
| ascension boss drop | the same |
| weekly boss drop | the same |
| Crown of Insight | **Tracks of Destiny** |
| Mora, `items.json` id 202 | Credits, `items.json` id 2 |
| signature weapon | signature light cone |
| talent block, 10/10/10 over 9/9/9 | no talent block |

So the grid is **four columns wide, not five**. That is read off the data, not
configured: the card is as wide as the families the game actually returns.

Three things needed real work rather than a rename:

1. **Nothing is grouped by source, because there are no sources.** Star Rail
   ships no `sourceDetails` at all. The id-run half of §1 carries the whole
   load — and it is enough, because each family occupies consecutive ids.
2. **Tracks of Destiny is filed as a mob drop** and is nothing of the sort. It
   falls out as the leftover single once the three-tier enemy line is taken —
   the same trick §1 uses for Genshin's ascension boss drop.
3. **An enemy drop is billed twice**, once for ascension and once for traces, so
   the two lists are folded by id before anything reads the runs. Without that
   the duplicate ids break every run into singletons.

**Trace totals come from `req.talents`, not `talentStages`.** The stages cover
only the four traces' level-ups; the bonus abilities and the stat nodes cost
materials too and appear nowhere in them. Using the stages alone undercounted
every trace figure — 56 Whimsy Wax read as 26, 139 trace books read as 80.
`req.talents` is the complete bill, and `req.talentBase` is the node half on its
own; the two sum exactly, as do their credit costs against `req.talentCost`.

**Variant names lose their bullet.** `Silver Wolf • Lv. 999` wraps onto two
lines on the card, which strands the separator at the start of the second one.
The space alone reads better, and the same applies to every `A • B` name in the
roster.

**Beta packs ship placeholder names.** Robin Summeretto's weekly is literally
`"..."` in the beta data while the live item database has *High Hopes of the
Falsely Enlightened*. A placeholder never displaces a real name, or the wiki
lookup has nothing to search for.

**No talent block** (§2). Star Rail has no Crown-of-Insight gate, so there is no
build decision to report: the trace icons and their `6 / 10 / 10 / 10` are
omitted, and so is the dim second figure under every tile. The card is
noticeably shorter than a Genshin one as a result.

**Credits include the trace nodes.** `talentStages` only bills the level-ups;
the stat nodes in the trace tree cost credits too and appear nowhere in it.
`req.talentCost` knows the real total, so the gap is carried as a constant that
applies to both targets.

**A light cone is a card, not a cut-out.** Genshin's weapon art is a
transparent PNG that floats; Star Rail's is a rectangular card image. It gets a
radial mask so its edges dissolve into the panel the same way.

### Captions, not faces

Star Rail names its sources by **domain**, and that is what the card prints. The
wiki's item infobox carries a `source1` link in one of four shapes, and each maps
to a caption above the tile — the same width-fitted text Genshin uses for gather
sites (§9), so nothing new was invented to draw them:

| `source1` | caption |
|---|---|
| `[[Stagnant Shadow: Shape of Deepsheaf]]` | the character's **element**, then **Deepsheaf** |
| `[[Calyx (Crimson): Bud of Elation (…)]]` | **Crimson Calyx**, then **Elation** |
| `[[Imagenated Creature]]s` · `[[Antimatter Legion\|…]]` | **Imagenated Creatures** |
| `[[Echo of War: Rusted Crypt of the Iron Carcass]]` | a **portrait** — see below |

Echo of War entries also carry `mentions`, which names the boss rather than the
stage, and that is what turns the weekly slot into a portrait.

The two never spell it the same way. The wiki gives the plain name; the database
gives a decorated one, and the decoration takes every form:

| wiki | database | how it differs |
|---|---|---|
| Irontomb | *Irontomb, Anti-Nous, Funeral of Gnosis* | title appended |
| Asat Pramad | *Lord of Saṃvartasthāyi, Asat Pramad* | title prepended |
| Phantylia | *Phantylia the Undying* | epithet |
| Feixiao | *Maddened Feixiao*, *Shadow of "Feixiao"* | adjective, quotes |

So the match is: **the plain name appearing as a whole word anywhere in the
decorated one**. Both sides are reduced to space-separated words first, which
also means no regex and so no escaping to get wrong on a name like
`Asat Pramad: "Existence"`.

Two narrower rules preceded this and both silently lost bosses — a prefix match
lost everything whose name is not the first word, and a comma-segment match lost
everything decorated with an adjective. Castorice's weekly had no face for that
second reason.

Where several entries match, the **shortest** wins: the longer ones are combat
phases or stage dressing, and the card wants the boss. Where the boss has no art
at all, the stage name is printed instead.

**The wiki wins over the description matcher.** A caption naming the actual
domain beats a face scraped out of flavour text, so a scraped entry clears
whatever §5 guessed. Mixing the two put a caption and an unrelated portrait in
the same slot.

The light cone reuses the character's materials, so it reuses their captions.

### Coverage

| | Genshin | Star Rail |
|---|---|---|
| ascension boss drops resolved | ~all | 16 / 30 |
| weekly bosses resolved to a portrait | 14 / 14 | 0 / 8 |
| enemy drops resolved | ~all | partial |

Star Rail is materially thinner, and the reason is upstream: its item text names
a category ("dropped by black tide creatures") where Genshin names a monster.
Weekly drops are named after the **Echo of War stage**, not the boss — "Divine
Seed", "Inner Beast" — and the monster database has no row under those names.
Those render as the name chip from §5 rather than a portrait, which is the first
time that path fires in practice.

### 6b. Rarity comes from the game, and it was wrong

Tile colour is the item's rarity, so a wrong rarity is a wrong-coloured card.
Genshin and Zenless ship rarity as a **number** and are safe by construction.
Star Rail ships it as a **string**, and `generate-site-data.mjs` had two of them
the wrong way round:

```
Normal < NotNormal < Rare < VeryRare < SuperRare      <- the real ladder
                             ^^^^^^^^   ^^^^^^^^^
                             was 5      was 4
```

Every 4-star purple Star Rail material was painted gold and every 5-star gold
one purple — on the cards *and* on the live material pages, which read the same
generated data.

The ladder is settled by the data, not by memory: `SuperRare` is what **Stellar
Jade**, **Oneiric Shard** and the **Star Rail Special Pass** are filed as, and
those are unambiguously the game's top tier. Of a character's materials only
Tracks of Destiny is genuinely gold.

The map lives in two places in `generate-site-data.mjs` (`QUALITY_RARITY` and
`HSR_RARITY_SCORE`); both were wrong and both are fixed. Wuthering Waves and
Endfield ship no `items.json` yet, so nothing there consults either map.

### 8a. The card must add up

Every tile is one family, which assumes one family per slot. Rather than trust
that, the extractor totals what the character actually needs and compares it
with what the tiles print. A shortfall is stated on the card instead of being
silently dropped.

One character fails: **Traveler**, whose roster entry merges all seven elemental
forms and so carries three separate talent-book lines and two enemy families.
The card shows one of each and says so. This check is also what caught the books
slot showing Traveler's Forbidden Curse Scrolls — an enemy drop — while the real
books went missing entirely; §1's book rule now selects on `kind` first and only
falls back to shape.

Audited over the full rosters: 120 Genshin characters and 90 Star Rail, every
tier count as expected, every figure adding up, with Traveler the only
exception.

## 11. Zenless Zone Zero

`CARD_GAME=zzz`. Four columns like Star Rail, and the same two-portraits-plus-
two-captions header, but the families differ again:

| Genshin | Zenless |
|---|---|
| gem, 4 tiers | Certification Seals, **3** tiers |
| talent books, 3 tiers | element Chips, 3 tiers |
| common enemy drop | — |
| local specialty | — |
| ascension boss drop | Higher Dimensional Data |
| weekly boss drop | the same |
| Crown of Insight | **Hamster Cage Pass** |
| Mora | Dennies |
| signature weapon | signature W-Engine |
| level 90 | **level 60** |

Nothing needed hand-holding except three things the other two games never
exercised:

1. **Ids step by ten, not one.** This is what forced §1's family rule to stop
   testing id adjacency and test the rarity ladder instead. Zenless numbers
   `100112 / 100122 / 100132`; the old rule made three singletons of them.

2. **Some item art is a sprite sheet.** The weekly boss drop ships as one
   2048px image holding about 130 copies of the same 156px icon, which drew
   inside the tile as a grid of specks. Anything unusually large is scanned for
   its first sprite: walk in to the first ink, then on to the first fully
   transparent line, and that span is one cell.

3. **The recorded source says nothing, so the caption is read off the item.**
   Zenless records `Combat Simulation - Agent Promotion` for every agent's
   promotion materials and `Combat Simulation - Agent Skills` for every agent's
   chips — the same words on all 59 cards. The item names carry what a reader
   actually wants, so the caption comes from there:

   | family | caption | from |
   |---|---|---|
   | promotion seals | **Agent Promotion** / **Controller** | the *top* tier — `Controller Certification Seal` |
   | skill chips | **Agent Skill** / **Freeze** | the *bottom* tier — `Basic Freeze Chip` |
   | W-Engine parts | **W-Engine Mod** / **Anomaly** | the *bottom* tier — `Anomaly Component` |

   Top for the seals because only that tier names the agent's role; bottom for
   the other two because only that tier is unprefixed. Strip the tier word
   (`Basic`/`Advanced`/`Specialized`/`Reinforced`), strip the type word
   (`Chip`/`Certification Seal`/`Component`), and what is left is the caption.

   The generic rule still applies elsewhere: a source with no art whose name
   carries a ` - ` or ` / ` separator is a place, not a creature, and stacks
   into two lines. It never applies when the family has art, so a boss with a
   portrait is never demoted to text.

4. **Boss portraits are captioned.** `namesBosses` — the only game with it.
   Zenless enemy art is a small dark bust that reads as a smudge at 56px, so the
   name goes under it, fitted to the tile like any other caption. Genshin and
   Star Rail draw creatures that are recognisable at that size and do not need
   it.

The weekly and the ascension boss both resolve to portraits, because their
`sourceDetails` name the enemy outright (`Sacrifice - Covenant Guardian`) and
the Zenless monster database uses the same names.

### Audited

59 agents: every family the right shape, every total adding up, no shortfalls.

### One agent in fifteen has no W-Engine

`signatureWeaponName` is set for 56 of 60 agents. The rest — currently the
newest, like Sigrid — render as a character block alone, which §8 already
covers.

## 12. Wuthering Waves

`CARD_GAME=wuwa`, and the database folder is `ww` rather than the game key.
Four columns like Star Rail, but its ladders run **four tiers**, not three:

| family | shape |
|---|---|
| enemy drop | LF / MF / HF / FF, 4 tiers |
| forgery material | 4 tiers, captioned with its Forgery Challenge |
| ascension boss drop | 1 |
| weekly boss drop | 1 |
| gathered plant | 1 |

**The currency tile takes the money's own rarity**, read from `items.json` — a
Shell Credit is blue where Mora is gold, and hard-coding a tier painted it
wrong.

**The forgery material is captioned by nation, not by challenge.** A material
lists the challenges that drop it — "Forgery Challenge: Abyss of Confession" —
and each challenge's wiki page names the nation it sits in. Three lines:
`Forgery Challenge`, then each distinct nation. `scrape-sites.mjs --wuwa`
collects them; a challenge too new to have a page contributes no line, so the
caption falls back to the type alone.

**A source that is a place is not drawn as one.** Wuthering Waves lists game
modes and shops beside enemies — "Forgery Challenge", "Souvenir Store" — and
they were crowding out the creatures. A source naming **more than 20 distinct
items** is a mode, not a monster; specific enemies name a handful. The same
frequency test that separates a boss's proper noun from ordinary vocabulary
(§5) separates a place from a creature here.

Two more things needed care:

1. **Families are read off the ids, not the sources.** The lower two tiers of a
   family list a different source from the upper two — the weak ones also drop
   from a Forgery Challenge — so grouping on the source list splits every family
   clean in half. `byLadder` walks the ids and breaks where the rarity stops
   climbing, ignoring the source entirely.
2. **`kind` separates the boss drop from the plant for some characters and calls
   both `mob` for others.** Rarity separates them reliably: the boss drop is the
   rare one, the plant is the common one.

3. **An enemy family is a wiki category.** Wuthering Waves names the *family* —
   "Whisperins", "Clamorlings", "Howlers" — where the database holds individual
   monsters. The wiki files each as `Category:<Family> Enemies`, and its members
   are exactly those monsters, so `scrape-sites.mjs --wuwa` collects them and
   the card draws the ones it has art for.

   The family list is built from `rawSources`, the unfiltered names the data
   listed, because by the time a caption has replaced them the names are gone.
   `"Clamorlings or Tranquilites"` is two families in one string and is split on
   both sides — in the scraper and in the extractor.

   A page title may disambiguate where the monster does not: `Exile (Enemy)` is
   the monster `Exile`. A source may also be qualified by where it was seen —
   `Clamorling TDs in Lahai-Roi` is the Clamorling family — so the qualifier and
   the plural are stripped before the category is asked for.

   **The family wins over a single face, including one the data supplied.**
   `Exile` is both an individual monster and a group of three, and the group is
   what drops the material; checking the category only when the data gave us
   nothing left that tile showing one icon instead of three.

The **+N** chip is a weapon-strip thing only. A character cluster is a picture
of where a material comes from, not an inventory, and "+21" beside eight faces
is noise rather than information.

Four tiers also means eleven characters of figures under a 90px tile, which
overran into the neighbouring column. The number row now scales down once it
stops fitting (§6).

## 13. Endfield

`CARD_GAME=ae`. The most different of the five, and the only game that is
**always wide** (§4a) — a character wants eight separate gathered materials on
top of its ladders, which no fixed layout holds.

| | Endfield |
|---|---|
| ids | strings (`ae:Talos_Cap`), so id order says nothing about tier |
| sources | none in the game data at all |
| money | an ordinary item (`T-Creds`), not a cost |
| EXP | **no stated values anywhere**, so the packs cannot collapse (§3) |
| gathered materials | eight per character, each its own tile |

- **EXP renders as the ladders it is**, `1/7/74` and `6/46`, rather than a
  top-tier equivalent. The two lines are told apart by the last two words of the
  item name — Combat Record and Cognitive Carrier — since the ids cannot.
- **Captions come from a scraped wiki file**, `Database/EndfieldWiki/endfield/
  items.json`, whose `source` field reads "Area found: Wuling Outskirts, Rare
  Gathering Sites, …". The first place named is the caption.
- Those captions sit **inside the cell**, above the tile, because a wide card's
  tiles run over several rows and the header strip only spans the first. Every
  cell reserves the slot so tiles in a row still line up.

## 14. Known gaps

1. **Signature weapon is an automated guess.** The site already warns about this.
   Raiden Shogun resolves to Dragon's Bane, which is wrong.
2. **Talent-book domains** are recorded for 101 of 118 characters but not for the
   newest ones, including Odette.
3. **Currency formatting straddles the 1M threshold** — a 5★ weapon shows
   `1.13M` while a light cone shows `883.500`. Pick one and apply it to both if
   the mix reads badly.
4. **Star Rail portraits read poorly at cluster size, and this is known and
   accepted.** §5a fills the circle, which is right for Genshin's head-and-
   shoulders busts (median 49 % ink) and wrong for Star Rail's full-body action
   poses (median 21 % ink, 46 % well off square): filling the circle with a
   gryphon in flight crops away the gryphon.

   Measured alternatives, should this be revisited: fitting the whole creature
   into a **rounded square** is clearly the most legible at 26 px — a square
   holds ~27 % more area than its inscribed circle, which matters because the
   poses are wide — and the 56 px boss portrait reads instantly when fitted
   rather than cropped. The principle would be that *fill versus fit is decided
   by how a game draws its source art, not by the container*, and median ink
   coverage classifies a new game automatically.

   Deliberately not applied: the cost is that Star Rail's chips would stop
   matching Genshin's circles.

5. **Traveler needs more families than the card has slots.** Not a merge of the
   elemental forms — the roster entry carries a proper `forms` array, 14 forms
   with complete materials each, and male/female are identical, so it is really
   seven clean per-element sets. The top-level entry is byte-identical to
   `anemo:male`, which is what the card currently renders.

   A single form legitimately needs **three talent-book lines** (one per talent)
   and **two enemy lines** (ascension and talents draw different ones), against
   the one slot each the layout has. For Anemo that drops Freedom, Resistance
   and the whole Scroll family — 291 materials, which is exactly the shortfall
   the §8a check reports.

   Verified against the wiki: the book sets are **correct for all seven
   elements**, including Geo, which genuinely draws two nations' worth —
   Mondstadt *and* Liyue, six book lines and three enemy families. Geo is the
   worst case by some margin.

   Two real gaps found while checking, both upstream:

   - **Geo is missing its second weekly**, `Tail of Boreas`. The wiki lists it
     as used by Traveler (Geo); the shipped data has only `Dvalin's Sigh`.
   - **Hydro is missing the middle tier of its enemy line**, `Transoceanic
     Chunk` (id 112081). The item exists in `items.json` and the wiki lists it
     for Traveler (Hydro), but it is absent from the requirement list, so the
     family renders with two tiers where every other element has three.

   Pyro having **no** weekly material is *correct*, not a gap: no Natlan weekly
   lists Traveler (Pyro).

6. **Three items have no resolvable source** — 5 of 591 slots, and two of the
   three are database gaps rather than card bugs:

   | item | characters | why |
   |---|---|---|
   | `Artificed Spare Clockwork Component — Coppelia` | Chiori, Lynette | one boss with two forms, filed only as *Nemesis of Coppelius*; the Coppelius drop resolves, the Coppelia one has no token to match |
   | `Evergloom Ring` | Kirara, Baizhu | the boss is absent from `monsters.json` entirely |
   | `Vagabond's Cracked Armor` | Vesna | genuinely new — here the **new** chip is correct |

   The first two are fixed by adding the missing monster rows, with no code
   change.
