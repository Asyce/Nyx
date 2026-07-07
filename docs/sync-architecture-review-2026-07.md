# Encrypted Pull-Sync — Security & Design Review (2026-07-07, Fable)

Scope: `worker/worker.js` (all API routes, focus `handleAccountSync`) and
`Site/src/features/gacha/pulls-sync.js` (client crypto). Review only — fixes are
queued as nyx-0014, not applied inline.

## How it works (plain language)

The user picks a **sync phrase**. From that phrase the browser derives three things:
an **account id** (public locker number), a **token** (locker key shown to the server),
and an **encryption key** (never leaves the browser). Pull history is encrypted
locally (AES-GCM-256, key via PBKDF2 150k iterations) and the server stores only the
sealed blob plus a hash of the token. The server can never read the history.

## Verdicts

| Area | Verdict | Notes |
|---|---|---|
| Server never sees plaintext | ✅ PASS | Only ciphertext + token *hash* stored; bodies never logged; `no-store` |
| Client crypto | ✅ PASS | AES-GCM-256, fresh random 12-byte IV per push, non-extractable key, PBKDF2-SHA256 150k, GCM tag gives integrity |
| No-Origin policy (June-30 §7) | ✅ PASS | `originAllowed('')` requires `ALLOW_NO_ORIGIN==='true'`; not set in wrangler.jsonc → rejected in prod. Old Asyce/Nyxarium origins removed; extra origins via env var, localhost + pages.dev previews allowed |
| Body-size abuse | ✅ PASS | 8 KiB (gacha) / 3 MiB (sync) enforced by **streaming**, so a forged Content-Length can't bypass it |
| Rate limiting | ✅ PASS | 60/min/IP per endpoint via GACHA_RL binding (bound in config); fails open only when binding absent (local dev) |
| Injection surfaces | ✅ PASS | authkey params allowlisted + length/CRLF-filtered; account fields strictly regex-validated; upstream errors never echoed |
| Error envelope | ✅ PASS | Stable `{ok:false,error:{code,message,requestId}}`, no secret leakage |
| Phrase strength | ⚠ ACCEPTED RISK | See finding 1 |
| Account-exists oracle | ⚠ MINOR | Finding 2 |
| Stale overwrite | ⚠ MINOR | Finding 3 |
| No delete endpoint | ⚠ GAP | Finding 4 |

## Findings (ranked)

1. **A guessable phrase unlocks everything — by design, so the UI must say so.**
   Account id and token are single fast SHA-256 hashes of the phrase. Anyone can try
   phrases online (throttled to 60/min/IP) and, once a phrase matches, pull and decrypt
   that account. The 10-character minimum allows weak phrases like `password123`.
   *This is the accepted trade-off of "no email, no password reset" — fine — but:*
   - UI should push toward 3–4 random words (show an example) and say plainly:
     "anyone who knows or guesses your phrase gets your history".
   - Optionally derive the **token** through PBKDF2 as well (attacker cost per online
     guess stays 1 request, but any future KV leak becomes much harder to crack).
2. **404 vs 403 tells an attacker which phrases are real accounts.**
   `sync_not_found` (no such account) vs `sync_auth_failed` (exists, wrong token) lets
   someone confirm a phrase is in use, then focus on it. Return one identical error for
   both cases on `pull`/`status`.
3. **Push is last-writer-wins with no staleness check.** A forgotten old device can
   silently overwrite newer synced history (`exportedAt` is stored but never compared).
   Cheap guard: if incoming `exportedAt` is older than stored, return a `stale_push`
   error the client can surface ("server copy is newer — pull first or force").
4. **No way to delete a synced blob.** June-30 Phase 8 acceptance says "export/delete
   always remain available". Add `POST /api/account/sync/delete` (same token auth,
   deletes `pulls:v1:*` for that account+game, and the auth record when last blob goes).
5. Nits (no action needed): token comparison is non-constant-time string compare
   (irrelevant at these hash sizes over network); first-push claims an account id
   forever (inherent to the phrase design; covered by finding 1's UI copy);
   `SETTINGS_KEY` line 13 builds its key via a `.replace()` — works, just odd.

## What I would NOT change

Local-first remains the right default; don't add accounts/emails for this. Don't raise
KDF iterations further on the client (mobile cost) without measuring. Don't log more.

## Queued fixes

`nyx-0014 sync-hardening-round1`: unify 404/403 (finding 2), stale-push guard
(finding 3), delete endpoint (finding 4), phrase-strength UI copy (finding 1). Small,
one worker + one UI file, testable with curl + existing smoke.
