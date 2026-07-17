# Pengo Achievement Screenshot Extractor

## What it does

`Site/public/scripts/pengo-achievements.ps1` reads screenshots that the user chooses and makes the small JSON file accepted by Nyx's Achievement Ledger.

It uses Windows' built-in English offline text reader. It does not open or control either game. It does not use the network, inspect an account, upload screenshots, copy text to the clipboard, or save the text it reads.

## Safe use

1. Open the completed achievement list in Genshin Impact or Honkai: Star Rail in English.
2. Take clear screenshots. Keep each achievement name and its completion date visible on the same card.
3. Put screenshots for only one game in a plain local folder. PNG and JPEG are supported.
4. Download and inspect `/scripts/pengo-achievements.ps1`.
5. In PowerShell, go to the download folder and verify the exact file before running it:

```powershell
$expected = '4c083e9c6133bd739a6094f53c887b1d5d75d8426b9a3a1c4f8e16d3a1eb3876'
$actual = (Get-FileHash .\pengo-achievements.ps1 -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'Checksum mismatch. Do not run this file.' }
powershell -NoProfile -ExecutionPolicy Bypass -File .\pengo-achievements.ps1 -Game gi -InputPath .\genshin-screenshots
```

For Star Rail, use the same verified file and change the final command to:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\pengo-achievements.ps1 -Game hsr -InputPath .\star-rail-screenshots
```

Use `-DryRun` to see the count without writing a file. Use `-OutputPath .\my-achievements.json` to choose a filename. An existing file is never replaced unless `-Force` is supplied.

Then choose the JSON file in Nyx. Nyx shows a preview before adding checkmarks.

## Conservative matching

The helper contains the unique English names from Nyx's pinned released GI 6.7 and HSR 4.3 catalogs. It cleans up spacing and common punctuation, but it does not guess or use fuzzy matching.

An achievement is included only when all of these are true:

- the name exactly matches one released achievement in the chosen game;
- the name maps to exactly one released ID;
- a real calendar date is present, not just words such as “completed”;
- the date is valid, is not before that game's release, and is not later than today; and
- the name and date are close together both up/down and left/right on the same visible card.

Each date can mark only the nearest compatible achievement title in its column. If two titles are equally plausible, neither is guessed from that date.

Negative or uncertain wording, repeated names, names shared by both games, unclear text, future achievements, wrong-game names, and dates on another row or column are skipped. The console reports counts only. It never prints screenshot text, names, IDs, paths, or filenames.

## Limits and privacy

- At most 250 screenshots, 30 MB each and 500 MB total.
- PNG/JPEG only; each image is limited to 10,000 pixels per side and 50 million pixels.
- The real side limit is the smaller of 10,000 pixels and Windows OCR's own reported limit. A 10,001-pixel-wide or tall image is rejected.
- Network shares, UNC paths, device paths, mapped network drives, unknown drives, and filesystem links are rejected.
- A generic warning appears when a selected local path looks cloud-synced. Move the files to a plain local folder if another app must not copy them.
- Output is written safely as UTF-8 without a BOM.
- The output contains only `gi_achievements` or `hsr_achievements` and sorted numeric IDs.
- Windows 10/11 with the English offline OCR language component is required.

## Remaining real-world boundary

Generated-image tests prove the matching rules, safety limits, privacy-safe errors, and Nyx import format without using anyone's private screenshots. Real game screenshots can still vary with UI scale, resolution, language, and Windows text-reading quality. The helper skips uncertain results, and Nyx still lets the user correct the list manually.
