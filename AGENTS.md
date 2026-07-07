# Agent Instructions

Start with `docs/agent-index.md`.

Important current direction:

- Work only in the real project: `C:\Pengo\Nyx`.
- Treat `C:\Pengo\AI\As-I-ve-Hoarded` as historical reference only unless the user explicitly asks.
- `docs/report-feedback-decisions-2026-06-30.md` supersedes earlier review wording where it differs.
- Keep both quick PowerShell and safer verified script import paths, but they must be Pengo-owned and plainly explained.
- React 19 + esbuild bundling landed (2026-07): do not reintroduce UMD vendor scripts to the HTML pages; React is bundled via `Site/tools/build-site.mjs`.
- Do not commit `.deploy`.

## User vocabulary → where the code lives

- "wish tracker" / "pulls" / "gacha tracker" → `Site/src/features/gacha/` (tracker UI `gacha-tracker.jsx`, parsers `pulls-engine.js`, storage `pulls-storage.js`, sync `pulls-sync.js`, hub overview `pulls-overview.jsx`)
- "materials" / "calculator" / "rarity frames" / "popout" → `Site/src/features/materials/char-materials.jsx` + `Site/src/styles/game-page-shared.css`
- "banners" → `Site/src/app/nyx-app.jsx` (UI) + `Scraper/banners/` (data)
- "codes" → `Scraper/codes/` + codes tab in `nyx-app.jsx`
- "database" / "library" → `Database/` (data) + database tab in `nyx-app.jsx`
- "the worker" / "API" / "sync" → `worker/worker.js`
- "game pages" / "the shell" → `Site/src/app/nyx-app.jsx`, `Site/pages/*.html`, `Site/src/components/game-page-components.jsx`
- Games shorthand: GI=Genshin, HSR=Star Rail, ZZZ=Zenless, WuWa=Wuthering Waves, Endfield=Arknights Endfield
