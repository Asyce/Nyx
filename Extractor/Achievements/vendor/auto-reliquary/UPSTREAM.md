# Upstream pin and Pengo patch

Exact source tree: `hashblen/auto-reliquary` commit
`bc23b48cb3b1b994a5d4405cefea42eb0e1d3735`, MIT licensed.

Pengo removes payload/plaintext/ciphertext/session seed tracing. Release
logging is compile-time disabled. `mhy-kcp` is pinned to
`1acf4ba5938ff91f7f2d2a31e16bf1f8d2db9c8f`.

Pengo also rejects short or malformed packet, KCP, and key buffers instead of
indexing, panicking, or unwrapping attacker-controlled lengths.
