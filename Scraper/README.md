# Nyxarium Scraper

Local data scrapers for the Nyxarium database.

## GameData

The GameData scraper writes versioned Live and Beta data into `../Database/GameData`.

```powershell
npm run gamedata:hsr
npm run gamedata:gi
npm run gamedata:ww
npm run gamedata:zzz
npm run gamedata -- --game all
```

Useful flags:

```powershell
npm run gamedata:gi -- --channel live
npm run gamedata:zzz -- --channel beta
npm run gamedata:ww -- --sample 3
npm run gamedata -- --game all --skip-assets
npm run gamedata:hsr -- --force-assets
npm run gamedata:hsr -- --debug          # include the raw upstream sourceSnapshot blob
npm run gamedata:gi -- --allow-empty     # override the empty-section guard
```

Output layout:

- `../Database/GameData/manifest.json`
- `../Database/GameData/<game>/live`
- `../Database/GameData/<game>/beta`
- `../Database/GameData/<game>/assets`
- `../Database/GameData/_state`
- `../Database/GameData/changes`
- `../Database/_httpcache` (conditional-GET cache; safe to delete)

The normalized files only use local database-relative asset paths. Change reports compare the current scrape against the previous local state, and Beta records are marked as `live`, `beta`, or `beta_changed` by comparing them to the Live channel.

Behavior notes:

- **`sourceSnapshot` is omitted by default.** Each normalized record used to embed the full verbatim upstream blob, which bloated output (HSR `characters.json` was ~110 MB) and made the change report flip on any upstream noise. The blob is now dropped unless you pass `--debug`; the same raw data is always written under `<channel>/raw/`. It is also excluded from the change hash, so `--debug` never churns the diff.
- **Conditional-GET cache.** Static JSON is revalidated with `ETag`/`Last-Modified`; unchanged files come back `304` and are reused from `../Database/_httpcache` instead of being re-downloaded and re-parsed. Disable with `NYXARIUM_HTTP_CACHE=0`.
- **Empty-section guard.** A scrape refuses to overwrite a section that previously had records with an empty one (a common symptom of upstream breakage), leaving the last good output in place. Override with `--allow-empty`.

## Endfield Wiki

The Endfield wiki scraper writes the operator roster and local art from endfield.wiki.gg into `../Database/EndfieldWiki`.

```powershell
npm run endfield:wiki
npm run endfield:wiki -- --sample 5
npm run endfield:wiki -- --skip-assets
```

Output layout:

- `../Database/EndfieldWiki/endfield/characters.json`
- `../Database/EndfieldWiki/endfield/overview.json`
- `../Database/EndfieldWiki/endfield/assets`
- `../Database/EndfieldWiki/endfield/raw`
- `../Database/EndfieldWiki/_state`
- `../Database/EndfieldWiki/changes`

The scraper uses the wiki Cargo Operators table plus page wikitext. Normalized JSON stores local paths only; missing optional art is listed in `missing-assets.json`.

## Prydwen

The Prydwen scraper covers HSR, Wuthering Waves, ZZZ, and Endfield. Genshin is intentionally excluded for now.

```powershell
npm run prydwen
npm run prydwen:hsr
npm run prydwen:ww
npm run prydwen:wuwa
npm run prydwen:zzz
npm run prydwen:endfield
```

Useful flags:

```powershell
npm run prydwen -- --game all --skip-assets
npm run prydwen:zzz -- --collection characters --sample 3
npm run prydwen:hsr -- --collection light-cones,relic-sets
npm run prydwen:endfield -- --collection characters,weapons,gear --force-assets
```

Output layout:

- `../Database/Prydwen/manifest.json`
- `../Database/Prydwen/<game>/overview.json`
- `../Database/Prydwen/<game>/collections.json`
- `../Database/Prydwen/<game>/characters.json`
- `../Database/Prydwen/<game>/collections`
- `../Database/Prydwen/<game>/pages`
- `../Database/Prydwen/<game>/assets`
- `../Database/Prydwen/_state`
- `../Database/Prydwen/changes`

Character detail pages keep the full visible page text, section text, tables when present, local asset references, and game-specific recommendation buckets such as light cones, relics, teams, weapons, echoes, disk drives, or gear. Catalog pages keep parsed entries plus the full page text. Prydwen does not expose GameData-style version channels, so records default to `live`; pages labeled as future or soon content are marked `beta`.

## GachaBase Beta

The GachaBase beta changelog scraper snapshots beta changelog entries for Genshin Impact, Honkai: Star Rail, and Zenless Zone Zero. It writes a combined file plus per-game files under `../Database/GachaBase`.

```powershell
npm run gachabase:beta
npm run gachabase:beta -- --game hsr
npm run gachabase:beta -- --game gi,zzz
```

Output layout:

- `../Database/GachaBase/beta-changelog.json`
- `../Database/GachaBase/<game>/beta-changelog.json`

The scraper reads the server-rendered changelog payload from normal HTML, so it runs in GitHub Actions and on a VPS without a browser. If a fetch fails and prior output exists, the previous file is preserved and marked stale.

## Wiki Titles

The wiki title scraper fills the character subtitle/title line used below character names. It reads the current local rosters, queries each game's Fandom MediaWiki API, and writes the local cache to `../Database/WikiTitles/character-titles.json`.

```powershell
npm run wiki:titles
npm run wiki:titles:hsr
npm run wiki:titles:zzz
npm run wiki:titles:ww
```

Useful flags:

```powershell
npm run wiki:titles -- --game all --concurrency 6
npm run wiki:titles -- --game wuwa --sample 5
npm run wiki:titles -- --game zzz --no-search
```

Output layout:

- `../Database/WikiTitles/character-titles.json`

The scraper batches exact page lookups first, then uses MediaWiki search for page-name mismatches such as shortened roster names. New characters are picked up automatically as soon as the local GameData/Prydwen roster files include them.

Source fields by game:

- Genshin Impact: infobox `title`.
- Honkai: Star Rail: infobox `how_to_obtain`, falling back to `lightcone`; Acheron is manually fixed to `Bosenmori`.
- Zenless Zone Zero: infobox `namecard`, using the name after the semicolon.
- Wuthering Waves: infobox `title`.
- Arknights: Endfield: no matching character subtitles, so Nyxarium displays each operator's class in the site generator.
