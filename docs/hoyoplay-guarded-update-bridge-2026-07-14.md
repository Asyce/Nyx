# HoYoPlay guarded update bridge probe

Date: 2026-07-14

## Result

The hidden/minimized bridge is not safe with HoYoPlay `1.16.1.364` and was
archived before implementation.

The validated `C:\Program Files\HoYoPlay\launcher.exe` handed off to the signed,
versioned `HYP.exe`. In both hidden and minimized states, Windows semantic
accessibility exposed only the HoYoPlay window and title bar. It did not expose
the Genshin page or any Update, Start Game, Repair, login, or agreement control.

The window was revealed rather than guessed. The visible Genshin page showed
`Start Game`, not `Update`, so the installed game was already current at probe
time. No launcher control was invoked and no game or update content was changed.

## Decision

Nyx will not use coordinates, screenshots, guessed focus order, or blind input to
operate HoYoPlay. Work continues with the Nyx-owned updater v2 research and
safety boundary. Ordinary direct game launch remains separate.
