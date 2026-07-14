# Achievement catalog builder

Run from the Nyx repository root:

```powershell
node Scraper/achievements/build.mjs
node Scraper/achievements/refresh-icons.mjs
node --test Scraper/achievements/tests/catalog.test.mjs
```

The builder downloads English achievement data at build time, pins the exact source commits in each output, removes records above the configured live release ceiling, validates all IDs and fields, and writes normalized catalogs to `Database/Achievements`.

`refresh-icons.mjs` is the explicit, reviewed asset refresh. It joins only the category IDs already present in the released catalogs, mirrors bounded PNG/WebP files into content-addressed local paths, checks media signatures, dimensions, hashes, and source revisions, and records per-file provenance. It never discovers new categories from the asset source.

Runtime catalogs contain local `/assets/achievements/...` paths only. Generated monograms remain the accessible fallback. The mirrored files are small released game UI icons for an unofficial free fan tool; no license or ownership claim is made for game artwork.
