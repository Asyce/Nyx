# Live achievement export

## Honkai: Star Rail — HoYoLAB

This helper reads completed achievements from HoYoLAB's signed-in **Upgrade Recommendations** page. It creates a small JSON file that Pengo can import.

1. Open `https://act.hoyolab.com/sr/event/cultivation-tool/index.html`.
2. Sign in to HoYoLAB normally.
3. Run the reviewed `pengo-hsr-hoyolab-achievements.js` helper on that exact page.
4. Click **Export completed achievements** in the Pengo box.
5. Import the downloaded `pengo-hsr-achievements.json` file into the matching HSR profile in Pengo.

The helper does nothing until step 4. It then asks HoYoLAB for the signed-in game account and achievement list. The request goes directly from the HoYoLAB page to HoYoLAB. Pengo never receives the login password, cookies, UID, region, or full HoYoLAB response.

The downloaded file contains only this shape:

```json
{"hsr_achievements":[4010101,4010201]}
```

Only finished achievements that exist in Pengo's current released HSR catalog are kept, and the IDs are sorted. An account with no finished achievements still gets a valid empty file. A malformed row, a repeated ID, or an unknown finished ID stops the export instead of creating a partial file.

Each HoYoLAB reply must come from the exact address requested, be a successful JSON reply, and have HoYoLAB's normal success marker. Requests time out after 12 seconds. The small login reply is limited to 16 KiB, and the achievement reply is limited to 2 MiB. Bad, oversized, redirected, or unfamiliar replies stop with a generic message and no download.

The helper does not use the clipboard, browser storage, console logging, or any third-party network address.

Reviewed script SHA-256:

```text
0334492029931c7c55731560e037263e98594ecb3bd11d4dcfe5374a8723fadb
```

## Genshin Impact — branch-only Windows test

Genshin does not have the same HoYoLAB achievement-list route. The experimental
Pengo CLI therefore watches the game's two known UDP ports and keeps frames only
in memory. It prefers Windows' independent realtime Packet Monitor interface.
On this Windows 11 23H2 PC, where that interface is absent, it automatically
uses the separately installed and reviewed Npcap 1.88 build without
Administrator access. It does not install or run Stardb, install Npcap, read the
game process, save a packet capture, or upload anything.

The temporary compatibility map comes from the user-authorized public Stardb
v2.19.0 source. It contains 10 version-to-dispatch-key entries. These are packet
decoding values, not the user's account password or login token. Pengo embeds the
map and verifies its exact canonical fingerprint at test time; it never contacts
Stardb while running. An unknown game version stops without writing a partial
file.

Build and test instructions, safety limits, provenance, and the public-release
blockers are in `Extractor/Achievements/README.md` and
`Extractor/Achievements/PROVENANCE.md`. No real account capture has been run.

The reviewed branch executable is 1,263,616 bytes with SHA-256
`79BF579C318594F55C32D876A09BBEC01FA715BB518475A95EDCA8011BAFB47D`.
Its release file embeds an application manifest, forces startup dependencies
to Windows System32, and the release verifier proves that fake DLL files and
an executable-name `.local` redirect beside it are ignored.

The Npcap fallback loads only the exact reviewed System32 Npcap files. It checks
the version, hashes, and installation settings, rejects elevation and preloaded
DLLs, requires the reviewed running/System-start service and driver path, opens
only the default-route Ethernet adapter without promiscuous mode,
applies the exact two-port filter, and uses bounded synchronous nonblocking
reads. There is deliberately no fallback to the older system-wide Packet
Monitor mode. No live account capture has been run yet.
