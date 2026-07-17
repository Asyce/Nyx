# Nyx desktop tools and finish-pass research

Date: 2026-07-15
Decision: **GO, with a sealed website handoff.**

## Question

How should the desktop launcher expose Pengo's pull and achievement tools in one click, and which remaining UI/functionality changes provide the largest product improvement without weakening the launcher's security boundary?

## Source-backed tool matrix

The website owns the tool UI and browser storage. Pull history is stored in IndexedDB and achievement profiles are stored in local browser storage. Opening the user's default browser therefore preserves the same data the Pengo website already uses; embedding a separate WebView would create a different storage area and make existing data appear missing.

| Game | Fixed pull route | Pull import support | Fixed achievement route | Achievement support |
|---|---|---|---|---|
| Genshin Impact | `https://pengo.gg/genshin/tracker` | Live URL, Pengo helper, UIGF/JSON, Paimon Excel, CSV/manual | `https://pengo.gg/genshin/achievements` | Manual ledger, Stardb-compatible JSON, Nyx backup; offline screenshot OCR helper available |
| Honkai: Star Rail | `https://pengo.gg/hsr/tracker` | Live URL, Pengo helper, UIGF/JSON, CSV/manual | `https://pengo.gg/hsr/achievements` | Manual ledger, Stardb-compatible JSON, Nyx backup; signed-in HoYoLAB helper and screenshot OCR backup |
| Zenless Zone Zero | `https://pengo.gg/zzz/tracker` | Live URL, Pengo helper, UIGF/JSON, CSV/manual | none | Not implemented on the website |
| Wuthering Waves | `https://pengo.gg/wuwa/tracker` | Live URL, Pengo helper, WWGF/JSON, CSV/manual | none | Not implemented on the website |
| Arknights: Endfield | `https://pengo.gg/endfield/tracker` | JSON/CSV/manual only; no live-token import | none | Not implemented on the website |

Authoritative route sources are `Site/src/components/game-page-components.jsx` and `Site/src/app/nyx-app.jsx`. Import capabilities come from `Site/src/features/gacha/pulls-engine.js`, `Site/src/features/gacha/gacha-tracker.jsx`, and `Site/src/features/achievements/`.

## One-click boundary

The desktop action will mean: **open the exact tool page for the selected game in the user's default browser.** The website then explains the available import or extraction method and asks the user to choose it.

The desktop app must:

- expose exactly five pull routes and two achievement routes;
- select routes only from an internal `(canonical game ID, tool kind)` catalog;
- reject unsupported pairs and any casing/alias variation;
- accept no caller-provided URL, path, query, fragment, command, script, shell, or arguments;
- use Windows' normal URI launcher only after the fixed catalog resolves;
- keep browser-open failures separate from game and maintenance readiness;
- suppress duplicate clicks while one fixed route is being handed off; and
- show Achievements only for Genshin and Star Rail.

The desktop app must not download or run `pengo-pulls.ps1` or `pengo-achievements.ps1`, inspect browser storage, read game web caches, copy tokens or URLs, call Pengo's gacha APIs directly, embed the site in a WebView, or claim that opening the page automatically imports data.

This is deliberate. The pull helper reads local web-cache data and can require elevated copy access. The achievement flows also differ by game: HSR can use a signed-in HoYoLAB page, screenshot OCR needs user-chosen images, and the Genshin packet collector is not approved for public desktop distribution. Automatic native extraction therefore remains a separate security-reviewed milestone.

## Current product audit

The five-game launch/session core is already strong: exact identity checks, concurrent different-game sessions, close confirmation, relaunch, duplicate suppression, and failure isolation are covered. All five individual games have passed a live launch/close pilot.

The largest remaining functional risks are:

1. The Endfield sibling discovery runs synchronously before the window is created. Slow disk or antivirus checks can make startup appear frozen. Move it behind first window activation, make it cancellable, and ensure a manual folder choice wins any race with late discovery.
2. The desktop has no Pengo tool catalog, buttons, browser-failure state, or route tests.
3. Multi-game behavior is proven with deterministic fakes and all ten game pairs, but a real simultaneous pair and WinUI out-of-order selection/launch behavior have not been piloted.
4. Kuro and GRYPHLINK maintenance starts have not had a final visible-window pilot.
5. Latest content is intentionally display-only. Its approved remote links remain out of this task so a dynamic publisher URL cannot be confused with the sealed Pengo tool boundary.

## Visual critique and direction

The existing shell is recognizably Nyx, but it reads as a stylish diagnostics panel rather than a premium game launcher. Technical labels, two separate status blocks, a paragraph of maintenance explanation, tiny text-only Latest cards, and a flat violet launch rectangle compete with the selected game art.

The finish direction is **Nyx Aperture**:

- one oversized, asymmetric eye aperture on the right reveals the selected game's art;
- the white Nyx eye becomes a quiet orbit/edge mark instead of a competing foreground logo;
- the Pengo background remains ambient texture, not the focal image;
- local and maintenance evidence collapse into a calmer status ledger;
- Pengo tools become a slim utility row, not generic dashboard cards;
- Latest becomes one featured headline plus two quieter ledger rows;
- selected game icons remain large and bare, with a thin orbit/crescent marker instead of a rounded aura;
- the launch action becomes moon-white/lavender with void text, an 8 px radius, and a restrained hover bloom;
- utility text moves away from Consolas to Segoe UI Variable; and
- the header reads `NYXARIUM / FAN LAUNCHER`, with one quiet affiliation disclosure.

Target tokens:

- Void `#08060F`
- Deep plum `#120D1D`
- Glass `#CC181126`
- Moon `#F5F2FF`
- Mist `#AAA4B8`
- Iris `#B8A6FF`
- Hairline `#2EFFFFFF`
- 8 px spacing rhythm
- minimum 44 px interactive height
- minimum 12 px utility and 14 px body text

Responsive behavior remains four-state. Wide/expanded layouts use an approximately 42/58 content-to-art split and a 128 px game rail. Compact/horizontal layouts move the icons to the top, dim the aperture to ambient art, and give content/actions the full readable width. Long titles such as Arknights: Endfield may wrap or scale instead of being forced to one truncated line.

## Implementation scope

Proceed in one reviewed implementation task with:

1. the exact seven-route Pengo tool catalog and one-click default-browser handoff;
2. game-aware tool visibility, accessible labels, honest helper text, duplicate suppression, and isolated failure feedback;
3. the Nyx Aperture hierarchy pass: hero, rail marker/spacing, typography, status density, Latest hierarchy, header/disclosure, and launch action;
4. asynchronous post-activation Endfield discovery with cancellation and manual-choice precedence;
5. deterministic catalog/security, startup-race, responsive/XAML, accessibility, and multi-game UI-state tests;
6. full Release tests/builds, independent security/product review, and native visual QA when the unpackaged build can be activated.

## Deferred, not hidden

- automatic desktop pull or achievement extraction;
- public Genshin packet capture;
- WebView embedding or browser-storage synchronization;
- dynamic Latest links or remote artwork expansion;
- safe manual folder recovery for the other four games;
- cloud accounts/sync changes;
- production website changes or deployment; and
- copying an official launcher's branding or claiming affiliation.

## Verification gate

Implementation can close only when:

- all seven exact routes and every unsupported pair are tested;
- source/security gates prove no generic URL, script, WebView, clipboard, cache scan, game-file write, or API capability was added;
- the window is activated before optional Endfield discovery begins, closing cancels it, and a manual choice cannot be overwritten;
- 1280x720 plus compact/wide/expanded layout tests remain clean;
- keyboard focus, high contrast, visible text status, and 44 px actions are preserved;
- full Desktop tests and Core/Infrastructure/Pilot/App x64 Release builds pass with zero warnings/errors;
- independent implementation review and independent test verification are clean; and
- the final manual list is limited to the browser handoff, one real simultaneous pair, and visible Kuro/GRYPHLINK maintenance windows.
