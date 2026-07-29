# Achievement system plan — ELI5

Date: 2026-07-26

## Is everything working now?

No.

| Game | Simple status |
|---|---|
| Genshin | The checklist works. Automatic reading from the game is still a test tool, not ready for everyone. |
| Star Rail | The checklist is live. Its HoYoLAB reader exists, but the website does not yet guide the user through automatic import. |
| ZZZ | Not built yet. |
| Wuthering Waves | Not built yet. |
| Endfield | Not built yet. |

Think of each game like a school sticker book:

- The **catalog** is the book containing every sticker space.
- The **extractor** looks at the user's game and writes down which stickers they own.
- The **importer** puts those stickers into the correct spaces on Pengo.
- The **website** shows what is owned and what is missing.

Right now, Genshin and Star Rail have the book and website. The other three do not have their books built yet.

## What the finished version should feel like

The user opens the Pengo launcher and turns on:

> Import achievements when I launch

They launch the game. Pengo reads the achievement list safely and creates a small file in:

> Downloads\Pengo Exports\Game Name

On the game's Pengo page, **Automatic import** is the large first option. After pairing the launcher once, Pengo sends the result to the correct local profile and shows a preview. The user clicks approve; they do not hunt for the file every time. Finished achievements are marked. Missing ones stay unmarked.

The JSON file is still saved as a backup. If a browser refuses the automatic handoff, the user can choose that file manually.

There will also be:

- an official-account option when one exists, such as HoYoLAB for Star Rail;
- upload JSON for backups;
- a screen-reading backup when the game gives us no safe data;
- manual checkmarks only for correcting mistakes.

## The order

1. Connect the separate launcher project to Nyx safely, including signing, updates, and a one-time pairing.
2. Clean up the shared system so all five games can plug into it.
3. Finish and safely test Genshin's automatic reader.
4. Put Star Rail's HoYoLAB reader directly into the visible website flow.
5. Build ZZZ's full list and find a safe way to read an account.
6. Build WuWa's full list. If the account cannot be read, make Pengo scroll and read the achievement screen automatically.
7. Build Endfield's list and handle its medals, which can have more than a simple done/not-done state.
8. Test each game with real accounts before turning it on for everyone.

## The important catch

We cannot honestly promise that ZZZ, WuWa, or Endfield has a secret easy account button. None was found.

For each one, we first look for:

1. an official signed-in account page;
2. a safe local file;
3. a safe game-data snapshot when the game launches;
4. automatic screen reading as the fallback.

Pengo will not read game memory, inject code into a game, weaken anti-cheat, or send passwords/cookies to the site. Automatic results carry a private account fingerprint so Pengo can stop account A being placed in account B's profile. Old files without that fingerprint get a warning.

## When it is truly done

All five game pages are live. Each page clearly shows **Automatic import**. A user does not need to tick hundreds of achievements by hand. Every reader has been tried on real accounts, unknown game versions stop safely, and Pengo never puts private login data in the export.
