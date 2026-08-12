# Character materials share-card handoff

Date: 2026-08-12

Owner: `C:\Pengo\Nyx`

Status: implemented. Confirm the current live release through `https://pengo.gg/version.json`.

## Approved result

Each supported character page now offers:

- `Download image`: renders a maxed-material PNG in the browser.
- `Copy share link`: copies a hosted `pengo.gg` URL. If text clipboard access is unavailable or denied, a normal copy prompt displays the URL.
- An in-page preview when a share URL is opened. The preview can be downloaded, copied again, retried after a render failure, or closed with Back.

The same design covers all five games: Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Wuthering Waves, and Arknights: Endfield.

## Stateless hosted URL

The selected design is a normal character URL with a small, deterministic query string:

```text
/{game}/characters/{character}?card=1&weapon={id}&form={key}&gender={key}&channel={live|beta}
```

Parameters are emitted in this order: `card`, optional `weapon`, optional `form`, optional `gender`, then `channel`. `card=1` enables preview mode. Without it, the parser returns `null`. Unknown nonempty weapon, form, and gender values are deliberately preserved so the page can say that the referenced choice is unavailable instead of silently changing the card.

The URL stores no image and creates no server record. On open, Nyx resolves the character, weapon, form, artwork choice, and live/beta channel against the data available at that time, then reconstructs the card in the browser.

### One-month expiry decision

A one-month expiry was discussed. It is not needed for this version because there are no stored links to expire: no Worker endpoint, KV, R2 object, database row, queue, cleanup job, or link backlog exists. A stateless URL can continue resolving while its route and referenced data remain available.

This also means the image is not an immutable snapshot. If a future requirement needs a frozen PNG, social preview metadata, or a guaranteed expiry date, that would be a separate hosted-image feature with storage and an explicit retention policy.

## Card contract

- Canvas width is fixed at 2000 internal pixels. Height is deterministic from fixed header and row sizes plus eight tiles per line. Browser zoom and device pixel ratio do not change the output dimensions.
- Max character levels are GI 90, HSR 80, ZZZ 60, WuWa 90, and Endfield 80.
- Max talent targets are GI `10/10/10`, HSR `6/10/10/10`, and ZZZ `12/12/12/12/12/6`. WuWa and Endfield use their max-material requirement data and show `Max` where no numbered target array exists.
- The card always combines max ascension, max talents, and the selected weapon. It does not inherit the interactive ledger's lower level, lower talent, or row checkbox choices.
- An explicit weapon cost of `0` stays zero through nullish fallback (`activeWeapon.cost ?? req.weaponCost`).
- The selected weapon name is plain text. Its standard icon remains as a faint ghost watermark.
- Only standard character art is shared: `originalArt` before `art`/`card`, and `originalIcon` before `icon`/`circle`. Local custom artwork is excluded.
- Boss, mob, weekly-boss, and other farm-source artwork is completely excluded.
- The output contains static labels and tiles only: no page navigation, presets, inputs, dropdowns, notes, or checkboxes.
- The Nyx logo and `pengo.gg` watermark remain in the top-right.
- Assets load through `Image`; the renderer does not use `fetch`. Cross-origin images request anonymous CORS access and are skipped on failure so they cannot taint the canvas.
- PNG encoding uses `OffscreenCanvas.convertToBlob` when available and `canvas.toBlob` otherwise. No image clipboard API or `ClipboardItem` is used.
- Renderer functions remain inside the generated bundle. Nothing is added to `window` as a share-card API.

## Implemented functions and files

| File | Implemented responsibility |
|---|---|
| `Site/src/features/materials/char-materials-share-card.js` | Bundle-local `nyxBuildMaterialsCardModel`, `nyxRenderMaterialsCard`, `nyxMaterialsCardFilename`, `nyxMaterialsCardUrl`, and `nyxParseMaterialsCardSearch`; fixed Canvas renderer, image loading, and PNG encoding. |
| `Site/src/features/materials/char-materials.jsx` | `CMMaterialsShareCard`, download helper, Copy share link fallback, in-page preview, max-data input, standard-art selection, and clear unavailable messages for stale or unknown URL selections. |
| `Site/src/app/nyx-app.jsx` | Parses share state only on character routes, carries it through initial load and browser back/forward, writes query parameters in canonical order, and removes them when preview mode closes or navigation leaves the shared selection. |
| `Site/tools/build-site.mjs` | Loads `char-materials-share-card.js` immediately after `char-materials.jsx` and before `nyx-app.jsx`, preserving the shared bundle scope required by callers and helpers. |
| `Site/src/styles/game-page-shared.css` | Header controls, status/error text, preview actions, and responsive preview image styling. |
| `Site/tools/tests/characters-nyx.test.mjs` | Executable URL/parser and model checks plus static route, UI, build-order, fixed-output, and forbidden-feature guards. |

There are no new dependencies and no backend, R2, KV, database, stored-link, or expiry changes.

## Validation gates

Automated gates:

1. From `Site`: `npm run test:characters`.
2. From `Site`: `npm run build`.
3. From `Site`: `npm run build:deploy` and `npm run smoke:deploy` using the current deployment asset mode.
4. Run `git diff --check` on the feature files and confirm `.deploy` remains untracked.

Browser release gates because Node cannot prove Canvas pixels or browser permissions:

1. Open one shared character URL for each game, plus a beta/form/gender case. Confirm the preview appears inside the character page.
2. Confirm an unknown weapon, form, or gender shows an unavailable message instead of silently substituting another choice.
3. Lower the normal page controls, then confirm the preview and downloaded PNG still use the max values above.
4. Confirm the PNG width is exactly 2000 pixels at different browser zoom levels.
5. Confirm standard art appears, local custom art does not, the weapon ghost remains, and no farm-source artwork appears.
6. Exercise both Copy share link paths: allowed clipboard write and the copy prompt fallback.
7. Block one image or font, then confirm rendering degrades without a page crash; exercise Retry after a forced render failure.

## Rollout gates

Release procedure:

1. Keep the feature changes isolated from unrelated work in the dirty checkout.
2. Run the full scraper tests and strict data validation required by `docs/agent-index.md`.
3. Pass all Site build, deploy-build, smoke, share-card test, and browser gates above.
4. Publish through the existing serialized deployment workflow.
5. Verify production's version commit, homepage and launcher HTTP 200 responses, then repeat a real shared-link preview, Copy share link, and PNG download check on `pengo.gg`.

Hosted PNGs and per-character social `og:image` previews remain possible future work only. They are not part of this stateless release.
