# Nyxarium Scraper

Local data scrapers for the Nyxarium database.

## Nanoka

The Nanoka scraper writes versioned Live and Beta data into `../Database/Nanoka`.

```powershell
npm run nanoka:hsr
npm run nanoka:gi
npm run nanoka:ww
npm run nanoka:zzz
npm run nanoka -- --game all
```

Useful flags:

```powershell
npm run nanoka:gi -- --channel live
npm run nanoka:zzz -- --channel beta
npm run nanoka:ww -- --sample 3
npm run nanoka -- --game all --skip-assets
npm run nanoka:hsr -- --force-assets
```

Output layout:

- `../Database/Nanoka/manifest.json`
- `../Database/Nanoka/<game>/live`
- `../Database/Nanoka/<game>/beta`
- `../Database/Nanoka/<game>/assets`
- `../Database/Nanoka/_state`
- `../Database/Nanoka/changes`

The normalized files only use local database-relative asset paths. Change reports compare the current scrape against the previous local state, and Beta records are marked as `live`, `beta`, or `beta_changed` by comparing them to the Live channel.

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

Character detail pages keep the full visible page text, section text, tables when present, local asset references, and game-specific recommendation buckets such as light cones, relics, teams, weapons, echoes, disk drives, or gear. Catalog pages keep parsed entries plus the full page text. Prydwen does not expose Nanoka-style version channels, so records default to `live`; pages labeled as future or soon content are marked `beta`.

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

The scraper batches exact page lookups first, then uses MediaWiki search for page-name mismatches such as shortened roster names. New characters are picked up automatically as soon as the local Nanoka/Prydwen roster files include them.

Source fields by game:

- Genshin Impact: infobox `title`.
- Honkai: Star Rail: infobox `how_to_obtain`, falling back to `lightcone`; Acheron is manually fixed to `Bosenmori`.
- Zenless Zone Zero: infobox `namecard`, using the name after the semicolon.
- Wuthering Waves: infobox `title`.
- Arknights: Endfield: no matching character subtitles, so Nyxarium displays each operator's class in the site generator.
