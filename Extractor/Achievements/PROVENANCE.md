# Provenance

Pinned on 2026-07-14 for this branch-only test build.

The user attested that Stardb's owner directly permitted Pengo/Nyx to reuse the
public Stardb key maps and extractor behavior. The two maps came from Stardb
v2.19.0 commit `8952306535f3fdcae1a7bc29ad3ea67b7fa6d7ef`:

| Map | Source path | Entries | Upstream raw SHA-256 | Canonical JSON SHA-256 |
| --- | --- | ---: | --- | --- |
| GI | `keys/gi.json` | 10 | `b183ec29f1e2f7327a6ffdde60df8b1044f2c888333f51877ecd56c67007a5b1` | `37ccd359c35b0f990032e7941ed140914a322b935706a1c66d252b27dd74f3c3` |
| HSR | `keys/hsr.json` | 28 | `a4b92a819d8a0798a297be61f1478179df75875152b90e0f98b6ef3dff75e5e9` | `8cf5663effcef7540a4bb14678442f99c86bb746000ef5170505905ad084a698` |

`apply_patch` changed only JSON line endings. Tests hash the sorted canonical
JSON, so any changed, missing, or extra key fails. The raw hashes above identify
the exact upstream files.

Pinned parser forks are vendored in this folder so their release behavior can
be audited without relying on a moving Git checkout:

- `vendor/auto-artifactarium`: commit `04421c4f8a7ed7e7b65bb5e6e59231d4e98405cf`
- `vendor/auto-reliquary`: commit `bc23b48cb3b1b994a5d4405cefea42eb0e1d3735`
- `vendor/mhy-kcp`: commit `1acf4ba5938ff91f7f2d2a31e16bf1f8d2db9c8f`

Pengo's fork patches remove captured-field printing and all packet,
plaintext/ciphertext, and session-seed tracing. Parser logging is compile-time
disabled in release builds. Each vendor folder records its exact changes.

Artifactarium embeds two upstream static game-protocol RSA private-key files to
decode an encrypted dispatch field. They are public assets from the pinned MIT
source, not a Pengo user secret and not a player's login credential. The
retained LF-normalized PEM source hashes are:

| File | PEM bytes | PEM SHA-256 | Decoded PKCS#1 DER SHA-256 |
| --- | ---: | --- | --- |
| `private_key_4.pem` | 1,678 | `c43fafade9dbc63440339fab24fa19d5ae78bc69e60d66ee956d951d6ff6392f` | `e27f729e1944a7550b51d27b3c3bf4b680209cb982413d3245d56df2ae7f0602` |
| `private_key_5.pem` | 1,678 | `6a3fbd53387f9d13230f8558e40df18ad3a8fc11fc23da83a202eedc3bd70ce3` | `b4ab7873b89540628de48a250747d0746f3c76e64a17b77dad221578a60fd996` |

On a Windows checkout Git may render the same PEM text as 1,704 CRLF bytes.
Tests normalize line endings before checking the retained source hashes.

Packet capture starts from crates.io `pktmon` 0.6.2. Pengo vendors its Windows
11 realtime files, loads its DLL only from verified System32, bounds callback
descriptors, and removes the legacy ETL backend, fallback, and competing raw
console shutdown hook. See
`vendor/pktmon-realtime/PATCHES.md` and its retained `LICENSE`.

The final PE still imports `LoadLibraryA` through windows 0.48's internal
projection delay-loader. No Pengo or vendored capture/parser source calls it.
The PktMon loader itself uses only the absolute, verified System32 path and
`LoadLibraryExW`. Before any other startup work, the executable applies
`SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32)`. A non-elevated test
proves both `PktMonApi.dll` and `dbghelp.dll` ignore fake sibling files beside
the test executable.

The release build also uses Rust's static MSVC runtime and linker
`/DEPENDENTLOADFLAG:0x800`. The PE verifier requires no VCRUNTIME/UCRT DLL
imports, reads `IMAGE_LOAD_CONFIG_DIRECTORY64.DependentLoadFlags` directly,
and runs a copied release executable beside invalid `VCRUNTIME140.dll` and
`bcryptprimitives.dll` decoys. This protects dependencies loaded before
`main`; `bcryptprimitives.dll` remains a direct System32-only import.

The embedded released catalogs are built from Nyx's local database and pinned
by tests:

| Catalog | IDs | Raw SHA-256 |
| --- | ---: | --- |
| GI | 1,759 | `5608dd41a26a06639c6455d65de7abdd2a7e5e997f55c6ed93dec6d08dc673b5` |
| HSR | 1,811 | `9d4fa10905c5f8472577e0c23414907394f312a9ea3b85eaebcf83400a867229` |

## Npcap fallback review pin

Pengo does not bundle or install Npcap. The Genshin-only fallback accepts the
user's installed Npcap only when all of these reviewed values match exactly:

- `Npcap version 1.88, based on libpcap version 1.10.6 (64-bit time_t)`
- `wpcap.dll`: `D1CA7FCF9128D02A75EAF29CE9A9D85C5697377460F92420D976DA187521CF39`
- `Packet.dll`: `2793CE72F0E04D5885AAEE1273A7373441D01934B2CFF3886B031C13CA826345`
- `npcap.sys`: `13D598E277E9C7BF43688D7087EF9B944E8036561A1E7169D31D9EC1D38F9A01`
- settings: `AdminOnly=0`, `WinPcapCompatible=1`, `LoopbackSupport=1`,
  `DltNull=1`, and `Dot11Support=0`
- service: running, System-start (`Start=1`), with exact image path
  `\SystemRoot\system32\DRIVERS\npcap.sys`

The reviewed files had valid Microsoft WHCP (`npcap.sys`) and Nmap Software LLC
(`wpcap.dll` and `Packet.dll`) signatures when pinned. Runtime SHA-256 checks
bind the accepted files to that review. No Npcap source or binary is copied into
this repository.
