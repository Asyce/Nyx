# Desktop one-button daily check-in handoff

Date: 2026-07-20

Status: user-requested launcher follow-up; research complete; implementation not started

## Task

- **From:** Daily web check-in investigation
- **To:** Active Nyx Desktop launcher session
- **Goal:** Let the user press one launcher button to claim every supported official daily web check-in through local, publisher-owned browser sessions.

## User direction

The user asked whether a custom launcher could perform the daily sign-ins with one
button, using a headless browser if needed, and asked for this handoff for the
launcher session.

The intended first version is an explicit user action, not an unattended daily
bot. The launcher should provide:

- **Connect HoYoLAB**
- **Connect SKPORT**
- **CHECK IN ALL**
- One honest result per game: `Claimed`, `Already claimed`, `Login needed`,
  `Unavailable`, or `Could not check`

## Existing boundary conflict

`docs/desktop-boundary.md` currently says Nyx Desktop:

- does not embed a WebView;
- does not own publisher sign-in;
- does not collect or inspect browser storage;
- does not automate publisher UI; and
- explicitly defers headless or hidden publisher UI automation.

This request changes that product boundary. Before implementation, update
`docs/desktop-boundary.md` with a narrow daily-check-in exception. Do not treat the
request as permission for generic browser automation, arbitrary navigation,
publisher-launcher automation, game automation, or background bots.

## Verified availability and canonical links

Verified logged out on 2026-07-20:

| ID | Game | Status | Canonical official page |
|---|---|---|---|
| `gi` | Genshin Impact | Available | `https://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=e202102251931481` |
| `hsr` | Honkai: Star Rail | Available | `https://act.hoyolab.com/bbs/event/signin/hkrpg/e202303301540311.html` |
| `zzz` | Zenless Zone Zero | Available | `https://act.hoyolab.com/bbs/event/signin/zzz/e202406031448091.html` |
| `wuwa` | Wuthering Waves | No persistent official web check-in found | No URL; skip |
| `ae` | Arknights: Endfield | Available | `https://game.skport.com/endfield/sign-in` |

Endfield provenance:

- Official Gryphline Game Tools Guide:
  `https://endfield.gryphline.com/en-us/news/0755`
- Later official Daily Sign-in Tool notice:
  `https://endfield.gryphline.com/en-us/news/6187`

WuWa is a negative-search finding, not proof that no page can exist. Guessed paths
such as `/checkin`, `/sign_in`, and `/signin` redirect to the official homepage.
Do not publish or automate a guessed route. Recheck official Kuro news periodically.

## Important accuracy findings

An HTTP 200 response does not prove a check-in is valid.

- The stale Genshin ID `e202009291139501` still serves the generic web shell, but
  the official reward feed returns `retcode: -199` and `Event does not exist`.
- Fake SKPORT routes can return HTTP 200 with the generic title
  `SKPORT - Official Gryphline Community`.
- WuWa guessed routes can redirect to the homepage and appear healthy to a naive
  redirect-following checker.
- ZZZ's public home probe false-fails unless it receives
  `x-rpc-signgame: zzz`.

Credential-free HoYo health probes:

```text
GI  https://sg-act-public-api.hoyolab.com/event/sol/home?lang=en-us&act_id=e202102251931481
HSR https://sg-act-public-api.hoyolab.com/event/luna/hkrpg/os/home?lang=en-us&act_id=e202303301540311
ZZZ https://sg-act-public-api.hoyolab.com/event/luna/zzz/os/home?lang=en-us&act_id=e202406031448091
    header: x-rpc-signgame: zzz
```

A healthy HoYo probe requires HTTP 200, valid JSON, `retcode === 0`, and a
non-empty well-formed `data.awards`. HSR and ZZZ also require a present, exact
identity field: `biz === "hkrpg"` or `biz === "zzz"`. Do not permanently require
exactly 31 rewards; that was only the observed July 2026 payload.

A healthy Endfield page requires:

- exact HTTPS host `game.skport.com`;
- exact path `/endfield/sign-in`;
- no unexpected redirect; and
- semantic title `Arknights: Endfield Daily Sign-in`.

Keep the Gryphline guide as provenance, not as a mandatory daily dependency.

## Recommended architecture

Use Microsoft WebView2, which is the Edge browser embedded inside a Windows app.
It supports persistent, separated browser profiles.

### Profiles

- One app-owned `HoYoLAB` profile shared by `gi`, `hsr`, and `zzz`.
- One separate app-owned `SKPORT` profile for `ae`.
- No profile for `wuwa` until a permanent official page is proven.
- Store profiles under the current Windows user's local application-data folder.
- Never attach to or copy the user's Chrome, Edge, or other browser profile.

The user must complete initial login, account selection, CAPTCHA, and two-factor
verification in a visible official page. Afterward, WebView2 may reuse the local
session. If publisher verification appears again, stop silent automation and show
the official page.

Visible connection and automated claiming have different navigation policies:

- **Visible connection:** start from a fixed publisher-owned login entry point and
  permit only a separately reviewed, locally compiled set of exact authentication
  hosts, paths, callback origins, and popup targets required by that publisher.
- **Automated claiming:** top-level navigation is limited to the complete normalized
  canonical check-in URL for that game. Publisher CDN/API subresources use a
  separate reviewed host allowlist; subresource permission never authorizes a
  top-level navigation or popup.

Discover and test the actual login redirect graph before implementation. Do not
solve an unknown login redirect by allowing an entire publisher domain, wildcard
subdomains, arbitrary paths, or arbitrary popup windows.

### Check-in flow

```text
User presses CHECK IN ALL
  -> take one operation lock; repeated clicks do not overlap
  -> GI, HSR, and ZZZ use the HoYoLAB profile
  -> Endfield uses the SKPORT profile independently
  -> navigate only to fixed catalog URLs
  -> determine login/already-claimed state from the official page
  -> press the official claim control inside that page
  -> verify the official success/already-claimed result
  -> publish one redacted result per game
```

HoYo operations should serialize within the shared profile. SKPORT may run in
parallel because it has separate state. Cancellation, shutdown, timeout, or a page
change must leave the result as `Could not check`, never guessed success.

Cancellation is not only a displayed state. Each run needs a generation token and
owns its WebView/controller until navigation, scripts, callbacks, and pending claim
work have stopped. On timeout, cancellation, shutdown, or unexpected navigation:

- cancel and dispose the operation's WebView/controller;
- ignore every callback from the old generation;
- keep the publisher profile lock until disposal is complete; and
- do not start another operation against that profile while old work might still
  press Claim.

If the browser operation cannot be proven stopped, quarantine that profile for the
rest of the app session and require a visible reconnect/review. Never convert a
late completion into success for a cancelled generation.

### First-version limits

- Explicit button press only.
- No scheduled or start-with-Windows check-in.
- No raw HTTP client that copies or replays browser cookies.
- No generic caller-provided URL, script, selector, JavaScript, host, path, header,
  or game ID.
- No remote code or remotely supplied DOM selectors.
- No automatic account switching.
- No WuWa automation.
- No production release until policy and security review are complete.

Prefer driving the official page over reproducing undocumented sign requests.
The page should continue to own publisher cookies, request headers, and challenges.

## Security and privacy requirements

- Never request, receive, store, export, inspect, synchronize, or log publisher
  passwords.
- Do not export browser cookies, tokens, local storage, authorization headers, or
  request bodies from the WebView profile.
- Do not include account identifiers, cookies, tokens, page HTML, or response
  bodies in logs, crash reports, telemetry, queues, or handoffs.
- Redacted diagnostics may contain only game ID, result code, stage, elapsed time,
  expected host/path, and a locally generated operation ID.
- Provide visible **Sign out / clear connection** actions that clear only Nyx's
  relevant WebView profile.
- Profile clearing, app uninstall, and migration behavior must be deterministic and
  tested. Never delete or touch another browser's data.
- One per-publisher lifecycle gate must serialize Connect, check-in, Sign out,
  profile clearing, WebView recreation, and shutdown. Clearing waits for every
  controller using that profile to dispose, then confirms deletion before the
  profile can be reused.
- Enforce a single Nyx Desktop instance or an equivalent named cross-process lock
  around each WebView user-data folder. A second process must never automate or
  delete a profile owned by the first.
- Restrict navigation, new windows, downloads, permissions, and external schemes.
  Unexpected hosts and paths fail closed.
- Treat every publisher page and response as untrusted input. Bound navigation,
  DOM waits, response sizes, and total operation time.
- A remote kill switch may disable a known integration, but it must not supply code,
  selectors, URLs, or broaden the local allowlist.

## Publisher-policy risk

Technical feasibility is not publisher authorization.

HoYoLAB's current terms restrict unauthorized scripts, scraping, and third-party
software that interferes with its services:

`https://www.hoyolab.com/agreement`

The terms do not clearly approve automatic daily check-ins. Before public release,
the launcher session must either obtain publisher permission or record an explicit
product decision accepting the account-policy risk. The same review is required
for SKPORT/Gryphline. Do not describe the feature as officially supported unless a
publisher says so.

## Link registry and health checks

Keep one reviewed registry containing:

- canonical game ID;
- availability status;
- canonical page URL;
- expected host and path;
- HoYo event ID and probe definition where applicable;
- provenance URL;
- `verifiedAt`; and
- kill-switch state.

Run credential-free health checks in CI and on a small schedule. Never update a
canonical URL automatically from a redirect or search result. Two consecutive
failures should open a human review; one transient failure should not silently
replace or remove a link.

The runtime must still fail closed when its locally compiled catalog and the
health state disagree.

Runtime matching uses the complete normalized URL, not host/path alone. Reject
userinfo, non-default or explicit ports, fragments, extra or missing query keys,
duplicate query keys, encoded path variants, path traversal, and redirects. In
particular, Genshin requires the exact query
`act_id=e202102251931481`; HSR, ZZZ, and Endfield require their exact canonical
paths with no query string.

## Required contracts and states

Use the five existing canonical IDs: `gi`, `hsr`, `zzz`, `wuwa`, and `ae`.

Suggested account connection states:

- `NotConnected`
- `Connecting`
- `Connected`
- `LoginRequired`
- `NeedsReview`

Suggested per-game operation states:

- `NotStarted`
- `Opening`
- `Checking`
- `Claiming`
- `Claimed`
- `AlreadyClaimed`
- `LoginNeeded`
- `Unavailable`
- `CouldNotCheck`

Account connection state and individual game result state are separate facts.
Neither may alter local game readiness, game session state, publisher maintenance
state, or the existing Launch action.

## Verification required

- The exact four current pages pass the logged-out structural health checker.
- The stale Genshin event ID fails despite its HTTP 200 page.
- Wrong HoYo event IDs, malformed JSON, empty rewards, wrong `biz`, and unexpected
  redirects fail closed.
- HSR and ZZZ require the `biz` field to be present and exactly `hkrpg` or `zzz`;
  an omitted `biz` is a failure, not a weaker success.
- ZZZ succeeds only when the fixed required `x-rpc-signgame: zzz` probe header is
  present.
- Fake SKPORT paths and the generic SKPORT shell fail semantic validation.
- WuWa homepage redirects never become a check-in link.
- Initial visible login, successful claim, already-claimed, expired session,
  CAPTCHA/2FA, missing game character, publisher error, timeout, cancellation,
  shutdown, and page-layout change all produce honest deterministic results.
- Visible login and automated claiming use separate tested navigation/popup
  policies; allowed subresources cannot become allowed top-level destinations.
- Full URL normalization rejects altered Genshin `act_id`, extra queries, duplicate
  queries, fragments, ports, userinfo, encoded path variants, and redirect targets.
- Repeated **CHECK IN ALL** clicks create at most one operation.
- HoYo games serialize without blocking the independent SKPORT result.
- Cancelled, timed-out, shut-down, and superseded generations cannot press Claim,
  publish a result, release the profile gate early, or overlap a later generation.
- Connect, check-in, Sign out, clear-profile, recreation, and shutdown serialize per
  publisher; cross-process ownership prevents a second launcher instance from
  using or deleting the same profile.
- Failure for one game does not hide another game's success.
- No check-in result changes local Launch or publisher-maintenance state.
- No secret reaches logs, crash reports, clipboard, telemetry, stdout, files outside
  the WebView profile, or another profile.
- Navigation cannot escape the fixed host/path catalog or open unsafe schemes.
- Clearing the HoYoLAB profile does not touch SKPORT, and clearing SKPORT does not
  touch HoYoLAB or any external browser.
- The feature can be disabled locally and by a narrow remote kill switch without
  remote code or configuration expansion.

## Suggested implementation order

1. Update `docs/desktop-boundary.md` and add pure Core contracts/states with fake
   adapters only.
2. Add the fixed link registry and credential-free health validator with regression
   fixtures for the known false positives.
3. Add WebView2 profiles plus visible connect/sign-out flows, with no automation.
4. Pilot user-pressed Genshin check-in behind an experimental local setting.
5. Independently review authentication isolation, navigation policy, cancellation,
   shutdown, diagnostics, and profile deletion.
6. Add HSR and ZZZ serially; preserve the ZZZ header/probe special case.
7. Add Endfield through the separate SKPORT profile.
8. Run a real-account pilot only after explicit user approval and without logging
   browser or account material.
9. Decide publisher-permission/public-release policy before enabling the feature by
   default or distributing it.

## Changed paths

- Added only this handoff document.
- No launcher source, boundary, queue, browser profile, account data, deployment,
  or production files were changed.

## Next action

The launcher session should start by reconciling this user direction with
`docs/desktop-boundary.md`. It should then build the sealed contracts and fake
adapter tests before adding WebView2 or touching any publisher login surface.
