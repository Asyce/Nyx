# Pengo achievement extractor

This is a branch-only Windows 11 test tool. It makes the small JSON file that
Nyx already knows how to import. It does not upload anything by itself.

## Use it

1. Build it with `cargo build --release --locked`.
2. Close the game completely.
3. For Genshin on this Windows 11 23H2 PC, open PowerShell normally. Do **not**
   use **Run as administrator**. The reviewed Npcap fallback refuses elevation.
4. Start one capture:

   `pengo-achievements-live.exe --game gi`

   The experimental HSR packet fallback still requires an Administrator
   PowerShell:

   `pengo-achievements-live.exe --game hsr`

5. Read the warning. Type `I UNDERSTAND` only if you accept it.
6. Launch the game fresh. For Genshin, enter the world through the door. For
   HSR, enter from the train screen.
7. The tool stops itself after one complete list. Import the new file from
   `%LOCALAPPDATA%\Pengo\Exports` into Nyx.

Use `Ctrl+C` to cancel. Nothing is written after a cancel, timeout, incomplete
list, parser problem, safety limit, or cleanup problem. There is no output-path
or overwrite option. If an export already exists, move or delete it first.

## What it watches

The tool watches only these UDP ports:

- Genshin Impact: 22101 and 22102
- Honkai: Star Rail: 23301 and 23302

On newer supported Windows builds it uses the independent realtime Packet
Monitor interface. When that interface is absent for Genshin, it automatically
uses the separately installed, reviewed Npcap 1.88 build. Pengo does not install
Npcap. The fallback opens only Windows' one default-route adapter, refuses
Administrator mode, accepts Ethernet frames only, disables promiscuous mode,
uses the fixed filter `udp and (port 22101 or port 22102)`, truncates at 9,000
bytes, limits Npcap's kernel buffer to 1 MiB, and polls synchronously in
nonblocking mode. It has no capture thread or packet queue.

Frames are never saved. There is a three-minute default timeout plus hard
packet, byte, frame, and five-minute maximum limits. The tool has no web client,
uploader, login, clipboard access, game memory access, input control, packet
log, or self-updater.

The release executable uses a built-in C runtime, embeds an application
manifest that disables executable-name `.local` DLL redirection, and marks
every startup DLL dependency as System32-only. Before parsing arguments or installing its panic
handler, the process also limits later DLL searches to Windows System32. It
loads `PktMonApi.dll` only from the verified System32 path. For the fallback it
loads only `%WINDIR%\System32\Npcap\wpcap.dll`, rejects a preloaded DLL with the
same name, and verifies the exact reviewed Npcap version, three file hashes, and
five installation settings before resolving any capture function. It also requires
the `npcap` service to be running with System-start mode and the exact
`\SystemRoot\system32\DRIVERS\npcap.sys` image path. It writes only to a
fixed local disk under the protected export folder above, rejects redirected
folders, holds that folder open against
renames, flushes a new temporary file, then performs one no-overwrite rename.

The release executable links the C runtime into itself and marks every direct
Windows dependency as System32-only in its PE load configuration. This closes
the earlier startup window before `main` could apply the process-wide rule.

Some Windows 11 builds do not include Microsoft's newer independent realtime
Packet Monitor interface. This PC's Windows 11 23H2 build is one of them.
Genshin therefore selects the reviewed Npcap fallback. The tool never falls
back to the older system-wide Packet Monitor mode because that could disturb
another Packet Monitor session or its filters.

Unexpected parser failures print only a generic message; panic payloads, source
paths, and backtraces are not shown or saved.

This method may still break a game's rules. HSR capture is experimental; use
the official HoYoLAB route instead when it is available.

## Important release block

Packet Monitor capture and parsing still share one Administrator process. Npcap
capture runs without elevation, but decrypted parser buffers are not yet wiped.
Before public release, privilege separation for Packet Monitor, buffer wiping,
code signing, Npcap licensing/distribution review, and a supported real-account
test must be independently cleared. Do not publish this executable yet.

## Developer checks

Run:

```powershell
cargo fmt --all -- --check
cargo check --all-targets --locked
cargo clippy --all-targets --locked -- -D warnings
cargo test --all-targets --locked
cargo build --release --locked
python tools/verify_release.py target/release/pengo-achievements-live.exe
```

The reviewed branch build is 1,263,616 bytes with SHA-256
`79BF579C318594F55C32D876A09BBEC01FA715BB518475A95EDCA8011BAFB47D`.
No live game capture is performed by the automated tests.
Tests compile the real fixed BPF expression against Npcap's offline filter and
exercise synthetic Ethernet IPv4/IPv6 frames only. They never open an adapter.
