# Desktop energy-status integration handoff

Date: 2026-07-20

Status: research complete; implementation not started by this handoff; existing
uncommitted WuWa account-status work is present and must be preserved

## Outcome

Nyx Desktop can provide a WuWa-style resource card for Genshin Impact, Honkai:
Star Rail, Zenless Zone Zero, and Wuthering Waves. Endfield should initially open
its official Protocol Terminal instead of copying private data.

This is technically possible. WuWa provides an official launcher panel, Endfield
provides an official PC web/launcher panel, and HoYoLAB Battle Records works in a
normal PC browser. HoYo does not provide a documented way for another launcher to
reuse those values: a custom Nyx numeric card would rely on undocumented
authenticated endpoints that may change without notice.

The safe product split is:

- **Official handoff:** always available when the corresponding official surface
  is known.
- **Nyx resource card:** local-only, off by default, separately enabled per
  publisher, and clearly labelled when its source is undocumented.
- **Manual timer:** available when a user declines account connection or a
  provider breaks.

Do not describe any private endpoint as official API support.

## Product-boundary decision required first

`docs/desktop-boundary.md` and `docs/v1-support-matrix.md` currently say Nyx does
not own publisher sign-in, inspect launcher/browser account material, embed a
WebView, or read credentials. The uncommitted WuWa account-status slice already
crosses part of that boundary by reading the official launcher's local account
cache and calling private Kuro endpoints.

Before implementation continues, record one explicit decision:

1. **Private personal build:** permit narrowly sealed, local-only account-status
   providers behind opt-in flags; or
2. **Publicly supportable build:** keep only official links/panels and manual
   timers until each publisher provides permission or a documented integration.

This handoff does not itself change that boundary. It also does not approve the
current WuWa prototype for distribution.

## Existing work: preserve and coordinate

The worktree is heavily modified. The complete WuWa account-status vertical slice
is currently untracked, while its App, state, and UI integration points are
modified. Do not delete, rename, generalize, or rewrite it as a first step.

Current implementation map:

| Layer | Existing path | What it already does |
|---|---|---|
| Core | `Desktop/src/Nyx.Desktop.Core/AccountStatus/WuWaAccountStatusContracts.cs` | Snapshot, result, stale state, and failure enum |
| Credentials | `Desktop/src/Nyx.Desktop.Infrastructure/AccountStatus/WuWaLauncherCredentialReader.cs` | Bounded read of one exact Kuro launcher cache; decodes one chosen session value only in memory; currently falls back to the first cache entry when none is marked selected |
| Network | `Desktop/src/Nyx.Desktop.Infrastructure/AccountStatus/WuWaAccountStatusTransport.cs` | Two fixed HTTPS endpoints, no redirects/cookies/proxy, 8-second timeout, 64 KiB cap |
| Parsing | `Desktop/src/Nyx.Desktop.Infrastructure/AccountStatus/WuWaAccountStatusResponseParser.cs` | Strict player identity and resource schema validation |
| Lifecycle | `Desktop/src/Nyx.Desktop.Infrastructure/AccountStatus/WuWaAccountStatusService.cs` | Single-flight refresh, 30-second request floor, account binding, stale projection, opt-out clearing, and asynchronous disposal |
| Composition | `Desktop/src/Nyx.Desktop.App/App.xaml.cs` | Creates, exposes, and disposes the service |
| UI | `Desktop/src/Nyx.Desktop.App/MainPage.xaml` and `MainPage.xaml.cs` | Opt-in strip immediately above Launch, manual refresh, freshness/error text, and page-observer detachment; observer cancellation does not stop shared provider work |
| Settings | `Desktop/src/Nyx.Desktop.Core/Features/LauncherFeatureFlags.cs` and `State/LauncherStateMigrations.cs` | Persists only the non-secret `WuWaAccountStatus` consent flag, default off |
| Tests | `Desktop/tests/Nyx.Desktop.Tests/AccountStatus/WuWaAccountStatusTests.cs` and `UI/WuWaAccountStatusUiTests.cs` | Security, parsing, lifecycle, opt-out, and UI contract coverage |

The local game session adapters are not account providers. Do not add account
network calls to `HoyoGameSessionAdapter`, `PublisherGameSessionAdapter`, or the
two-second `GameSessionRefreshPump`.

## Support decision by game

| ID | Display name | Resource | PC source | Custom card decision |
|---|---|---|---|---|
| `gi` | Genshin Impact | Original Resin | Official HoYoLAB Battle Records page; undocumented authenticated notes endpoint | Experimental local provider is feasible |
| `hsr` | Honkai: Star Rail | Trailblaze Power and Reserved Trailblaze Power | Official HoYoLAB Battle Records page; undocumented authenticated notes endpoint | Experimental local provider is feasible |
| `zzz` | Zenless Zone Zero | Battery Charge | Official HoYoLAB Battle Records page; undocumented authenticated notes endpoint | Experimental local provider is feasible; do not claim Backup Battery Charge unless the response contract is separately proven |
| `wuwa` | Wuthering Waves | Waveplates and reserve | Official Kuro launcher panel | Existing private-provider prototype; audit before keeping or shipping |
| `ae` | Arknights: Endfield | Sanity | Official Protocol Terminal web page and GRYPHLINK panel | Phase 1 is an official-page handoff only; do not scrape or call private endpoints |

## User experience

Use one shared resource strip in the existing location immediately above the
selected game's Launch button. The strip changes with the selected canonical game
instead of adding five independent hard-coded strips.

Fresh state example:

```text
RESIN 124/200   FULL IN 10H 08M                 UPDATED NOW
POWER 221/300   RESERVE 840   FULL IN 06H 35M   UPDATED 4M AGO
BATTERY 188/240 FULL IN 05H 12M                 UPDATED 8M AGO
WP 193/240      RESERVE 116                    UPDATED NOW
SANITY          OPEN PROTOCOL TERMINAL          OFFICIAL PAGE
```

Required actions and wording:

- `CONNECT` or `START` is an explicit opt-in.
- `REFRESH` is manual and never overlaps an in-flight request.
- `DISCONNECT` immediately cancels work and clears Nyx-owned secrets and cached
  account data before settings persistence is attempted.
- Show `UPDATED ...`, `STALE ...`, `SIGN IN AGAIN`, `ENABLE REAL-TIME NOTES`,
  `OPEN OFFICIAL PAGE`, `TRY AGAIN SOON`, or `STATUS UNAVAILABLE` honestly.
- Never show an earlier account's values while a new account identity is being
  checked.
- Account status must never alter local Ready/Running state, publisher maintenance
  state, Launch availability, or official-launcher actions.
- Accessibility names must include the selected game and the full resource value.

Count down locally from the last accepted server snapshot. Do not make a network
request every time the visible countdown changes.

## Shared Core contract

Introduce provider-neutral contracts beside the existing WuWa files. Migrate the
WuWa slice only after its owner and current changes are settled.

Suggested public Core shape:

```text
AccountResourceSnapshot
  GameId                 gi | hsr | zzz | wuwa | ae
  Current                required when numeric data exists
  Maximum                required when numeric data exists
  Reserve                optional
  SecondsUntilFull       optional; zero when full
  ObservedAt             local time when the snapshot was accepted
  SourceKind             OfficialPage | UndocumentedPublisherEndpoint | Manual

AccountResourceResult
  State                  Disabled | Checking | Fresh | Stale | LoginRequired |
                         PermissionRequired | RateLimited | Unavailable |
                         CouldNotCheck | Shutdown
  Snapshot               optional
  CheckedAt
  SuccessfulAt           optional
  UserAction             None | Connect | EnableNotes | OpenOfficialPage |
                         OpenOfficialLauncher | Retry
```

Do not put a cookie, token, UID, email, nickname, player ID, region-specific
credential, or account binding in a public Core record. Account matching belongs
inside the provider service. Logs receive only canonical game ID, result state,
stage, duration, and a random local operation ID.

Recommended interfaces:

```text
IAccountResourceProvider
  Supports(gameId)
  RefreshAsync(gameId, cancellationToken)
  DisconnectAsync(cancellationToken)

AccountResourceCoordinator
  one state machine per game
  one lifecycle gate per publisher account/profile
  selection-independent snapshots
  no dependency on game-session readiness
```

Use one HoYo provider/account session for `gi`, `hsr`, and `zzz`, but keep one
independent result per game. HoYo refreshes serialize through the shared account
session. Kuro and Gryphline remain separate and cannot block HoYo or each other.

## HoYo provider: `gi`, `hsr`, and `zzz`

### Verified data contract

The current overseas Battle Records routes used by the active `genshin.py`
reference implementation are:

| Game | Method and reviewed route | Query | Fields to project |
|---|---|---|---|
| `gi` | `GET https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote` | `role_id`, `server` | `current_resin`, `max_resin`, `resin_recovery_time` |
| `hsr` | `GET https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note` | `role_id`, `server` | `current_stamina`, `max_stamina`, `stamina_recover_time`, `current_reserve_stamina`, reserve-full flag |
| `zzz` | `GET https://sg-act-public-api.hoyolab.com/event/game_record_zzz/api/zzz/note` | `role_id`, `server` | `energy.progress.current`, `energy.progress.max`, `energy.restore` |

Known overseas server values:

- Genshin: `os_usa`, `os_euro`, `os_asia`, `os_cht`
- HSR: `prod_official_usa`, `prod_official_eur`, `prod_official_asia`,
  `prod_official_cht`
- ZZZ: `prod_gf_us`, `prod_gf_eu`, `prod_gf_jp`, `prod_gf_sg`

These hosts and headers have changed before. The official web bundle can use a
different `sg-act-public-api`/`sg-public-api` host for an equivalent route. Keep a
small locally compiled allowlist that is updated only after review; never accept a
redirect, wildcard subdomain, remote URL, remote header set, or remotely supplied
signing constant.

### Authentication and request rules

There is no public OAuth client-registration flow or API-key program for this
data. The calls use the player's HoYoLAB session cookies, a dynamic `DS` request
signature, and first-party-style `x-rpc-*` headers. The session cookie set changes
over time; current overseas sessions commonly use `ltoken_v2` and `ltuid_v2` plus
account/session companions issued by HoYoLAB.

Role discovery is a separate authenticated call. The reviewed overseas reference
uses:

`GET https://api-os-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie`

It returns the game roles bound to the current HoYoLAB account. Nyx must filter
the bounded response to `gi`, `hsr`, and `zzz`, then require an explicit choice
when a game has more than one UID/server pair. Do not copy `genshin.py`'s
highest-level fallback. Store the chosen game/UID/server only in user-scoped
DPAPI-protected provider state, re-run discovery before every notes refresh, and
prove that the same publisher account and exact role still exist before showing
or retaining a snapshot. An account, UID, server, or role-list change clears the
old snapshot and requires selection again.

Implementation requirements:

1. Add a visible WebView2 connection flow that opens only official HoYoLAB login
   and Battle Records pages in a Nyx-owned, isolated profile.
2. The user completes password entry, CAPTCHA, two-factor checks, and character
   selection on the official page. Nyx never asks for or receives the password.
3. Treat the WebView2 profile itself as secret-bearing publisher-managed storage.
   Read the reviewed minimum cookie names through WebView2's cookie manager only
   into bounded memory for each request, then clear the copy. Do not create a
   second persistent cookie store unless a separate security review proves it is
   technically required. If duplication is approved, use Windows Credential
   Manager or user-scoped DPAPI and delete both stores on disconnect.
4. Never read Chrome, Edge, HoYoPlay, or another app's cookie database. Never ask
   the user to paste cookies or tokens.
5. Build the minimal signed notes requests in the .NET Infrastructure project.
   Use `genshin.py` only as a reviewed protocol reference, not as a Python sidecar,
   subprocess, runtime dependency, or secret-handling helper.
6. Project role discovery into an internal binding over publisher account, game,
   UID, and server. UIDs and account identifiers never enter public Core state,
   logs, or ordinary settings. The selection UI may show a masked UID and region
   transiently.
7. Set the equivalent of `autoauth: false`. If Real-Time Notes are disabled, show
   `ENABLE REAL-TIME NOTES` and open the official settings/page. Never change the
   setting silently.
8. Do not reuse wish-history `authkey` values. They do not authorize Battle
   Records notes.

One isolated HoYoLAB profile can also serve the separate daily-check-in feature
described in `docs/desktop-daily-checkin-handoff-2026-07-20.md`, but its lifecycle
gate must serialize Connect, notes refresh, check-in, disconnect, profile clearing,
and shutdown. The user-data folder must live under Nyx's current-user local app
data, inherit current-user-only filesystem permissions, and have one named
cross-process ownership lock. Record the exact resolved folder for packaged and
unpackaged builds. A second Nyx process cannot open, automate, or delete it.
Disconnect waits for all controllers and provider work to dispose, deletes that
profile, verifies deletion, and clears any separately approved protected store.
Document uninstall/upgrade behavior and provide an in-app deletion action because
uninstall cleanup must not be assumed.

### HoYo transport and parser limits

- Exact HTTPS endpoint equality; redirects off; proxy policy explicit; cookies not
  stored in `HttpClientHandler` beyond the scoped request.
- Eight-second request timeout and a 64 KiB response ceiling are suitable starting
  limits, matching the current WuWa slice.
- Require HTTP 200, JSON media type, top-level success code, and a complete bounded
  numeric schema.
- Reject negative values, `current > maximum`, impossible recovery times,
  duplicate/unknown account identity, wrong server, malformed JSON, oversized
  bodies, and partial success.
- Freeze redacted success/error fixtures per game. Fixtures must contain no real
  cookie, UID, nickname, or player ID.
- Map login expiry, notes-disabled, risk verification/CAPTCHA, rate limiting,
  malformed response, and network failure to distinct internal failures and honest
  UI actions.

## WuWa provider: audit the existing slice

The current slice already produces Waveplates, reserve, daily activity, recovery
fields, freshness, and stale/error states. It also reads
`%APPDATA%\KR_G153\A1730\KRSDKUserLauncherCache.json`, reverses the launcher's
simple OAuth-code obfuscation, and calls two undocumented Kuro launcher endpoints.

Keep its useful design properties:

- explicit opt-in, default off;
- one exact bounded cache path;
- no reparse points;
- fixed endpoints and no redirects;
- small response cap and timeout;
- in-memory account binding before stale data can be reused;
- in-memory HMAC account binding;
- no credential persistence in Nyx settings;
- single-flight, rate limiting, generation cancellation, and clear-on-opt-out.

Current defects/gaps to fix before migration:

- `WuWaLauncherCredentialReader` accepts `distinct[0]` when several cache entries
  exist and none is explicitly selected. That can query the wrong cached account.
  Require exactly one explicit selection, or first prove with publisher-owned
  evidence that the fallback entry is the active account. Add a regression test
  for multiple unselected accounts.
- Page cancellation currently detaches that observer while the shared provider
  request continues. Keep that behavior only if it is an explicit coordinator
  decision; otherwise cancel provider work when no observer or publisher-owned
  operation remains.
- `App.xaml.cs` currently starts account-status disposal without awaiting it on
  window close. Add an app-owned shutdown barrier so provider disposal and secret
  clearing complete before process exit.

Before retaining or shipping it, require an independent security and publisher-
policy review. Specifically decide whether reading another launcher's session
cache is acceptable. If it is not, replace the numeric provider with `OPEN KURO
LAUNCHER` plus the manual timer. Do not expand the cache search, copy the whole
cache, log its contents, or reuse the OAuth code for anything beyond the sealed
resource calls.

## Endfield provider: official handoff first

The official Protocol Terminal is available in a normal PC browser at:

`https://game.skport.com/endfield/game-data?header=0`

Gryphline says it provides Sanity stats and other real-time game data after the
user signs in and authorizes the linked character. GRYPHLINK also has an official
real-time panel.

Phase 1 implementation:

- Show `SANITY · OPEN PROTOCOL TERMINAL` in the shared strip.
- Open the exact HTTPS URL as a visible top-level browser page, or use the existing
  validated zero-argument GRYPHLINK handoff.
- Keep the fixed URL catalog closed to caller input.
- Never infer a Sanity number from page availability.

Do not scrape the page, embed it as a hidden browser, copy SKPORT cookies, or call
its undocumented backing endpoints. An iframe happens not to be blocked by
headers today, but that is not an official embedding contract and login/cookie
behavior can break it. A numeric Endfield provider requires a documented API or
written publisher permission plus a new security review.

## Refresh, stale, and lifecycle rules

- Refresh once after explicit connection, on manual request, and on app activation
  only when the last successful snapshot is old enough.
- Target automatic refresh at 15 to 30 minutes. Keep a hard provider request floor
  of at least 30 seconds. Apply exponential backoff to network/rate-limit failures.
- Update the visible countdown locally between accepted snapshots.
- A provider failure never erases a proven snapshot from the same account
  immediately, but marks it stale. Identity/login failures clear it at once.
- A snapshot is never carried across an unproven account change.
- Repeated clicks join one in-flight operation. One observer cancellation cannot
  cancel shared work unless the publisher session is disconnecting or shutting
  down.
- Every operation has a generation. Results from a disconnected, superseded,
  cancelled, or closed page generation are discarded.
- Disconnect cancels and awaits work, clears the provider's memory and Nyx-owned
  secret/profile storage, and only then permits reconnection.
- App shutdown awaits provider disposal. Late callbacks cannot mutate UI or write
  settings.
- Keep account refresh independent per publisher. A failing HoYo request cannot
  delay WuWa, Endfield, game launch, or maintenance status.

## Security and privacy requirements

- No backend, Cloudflare Worker, sync, telemetry, or remote secret processing.
- Never store secrets in launcher state JSON, Nyx-authored ordinary files,
  Nyx-authored localStorage, URLs, command-line arguments, clipboard, stdout,
  logs, crash reports, test fixtures, queues, handoffs, or analytics. The isolated
  WebView2 user-data folder is the explicit exception: it is publisher-managed,
  secret-bearing browser storage and must receive the ownership, permissions,
  lifecycle, and deletion controls above.
- Never request a publisher password or accept a pasted cookie/header/token.
- Never read an existing browser's profile or silently extract browser cookies.
- Never log account identifiers, response bodies, request bodies, headers, cookies,
  page HTML, or local launcher-cache contents.
- Encrypt any Nyx-owned session secret at rest with Windows Credential Manager or
  user-scoped DPAPI. Clear plaintext buffers where practical.
- Provide one-click disconnect/delete per publisher. Clearing HoYo must not touch
  Kuro, Gryphline, an external browser, or game files.
- Treat publisher responses and launcher caches as untrusted input. Bound path,
  file size, JSON depth, string length, response size, numeric ranges, and time.
- A remote kill switch may only disable a provider. It cannot add endpoints,
  signing values, cookies, scripts, selectors, or permissions.
- Feature flags default off. Consent is per publisher; stored consent contains no
  account material.
- No production distribution until policy and security review are recorded.

## Implementation order

1. Settle ownership of the live uncommitted WuWa work. Run its focused tests and
   record whether it is kept, revised, or replaced.
2. Update `docs/desktop-boundary.md` and `docs/v1-support-matrix.md` with the
   approved private-build or official-only decision.
3. Add provider-neutral Core contracts and fake providers without changing the
   current WuWa files.
4. Replace the hard-coded `WuWaAccountStatusStrip` behavior with one shared
   selected-game strip. Preserve its position, layout reservation, accessibility,
   page lease, and opt-out ordering.
5. Add the coordinator, per-publisher lifecycle gates, feature flags, migrations,
   and fake-provider UI tests. Do not connect network or credentials yet.
6. Add the Endfield official-page action. This is the only low-risk new provider
   behavior.
7. Add the visible isolated HoYoLAB connection/disconnect flow with no notes
   request. Review navigation, popup, secret storage, profile deletion, and
   shutdown behavior.
8. Add Genshin notes behind an experimental local flag using frozen redacted
   fixtures. Review request signing and secret handling independently.
9. Add HSR and ZZZ serially through the same HoYo account session. Keep their
   parsers and failure fixtures separate.
10. Migrate the audited WuWa provider to the shared contract without weakening its
    existing limits.
11. Add local countdowns, activation refresh, backoff, stale display, and manual
    timer fallback.
12. Run a user-approved real-account pilot locally with secret logging disabled.
    Do not commit fixtures captured from a real account.
13. Decide publisher permission and distribution policy before enabling any
    undocumented provider by default.

## Required verification

### Pure and fixture tests

- Every canonical game ID maps to exactly one resource label and source policy.
- Current, maximum, reserve, recovery, full, malformed, negative, overflow,
  partial, login-expired, notes-disabled, rate-limit, timeout, cancellation, and
  oversized-response cases are deterministic.
- A response from the wrong game/server/account is rejected.
- Role discovery rejects unknown games, malformed roles, duplicates, oversized
  lists, and an unavailable prior selection. Multiple roles require explicit
  selection; no highest-level or first-entry fallback is allowed.
- Publisher account, canonical game, UID, and server are rebound before every
  notes refresh. Any change clears the previous snapshot.
- No unknown host, redirect, caller URL, extra query, wildcard, or remote signing
  configuration is accepted.
- A manual countdown reaches full without producing extra requests and never
  exceeds the accepted maximum.
- Same-account transient failure may show stale data; identity failure or account
  change clears it.
- Repeated refresh joins one request; old generations cannot publish after opt-out,
  reconnect, page change, or shutdown.
- App shutdown waits for provider work, WebView controllers, secret clearing, and
  profile ownership release; no fire-and-forget disposal remains.
- HoYo games serialize on one account gate while different publishers remain
  independent.

### UI and state tests

- One shared strip immediately precedes Launch and renders only the selected game.
- Feature flags default off and migrations store booleans only.
- Opt-out clears live state before a settings save can fail.
- Refresh/failure never changes game readiness, maintenance state, or Launch.
- Endfield opens only the exact Protocol Terminal URL or existing validated
  GRYPHLINK action.
- Every state has accessible text and a visible freshness/source label.
- Narrow and wide launcher layouts reserve the strip correctly for all five games.

### Secret and boundary gates

- Repository and build artifacts contain no real cookie, token, UID, player ID,
  email, cache content, request/response capture, or password.
- Nyx does not touch external browser profiles or unrelated launcher/game files.
- Disconnect/profile clear is publisher-scoped and deterministic.
- Core remains free of network, filesystem, WebView, Windows credential, and
  launcher-cache implementations.
- Capture `git status --short` before the energy batch. The energy change must
  introduce no additional edits to Website, Worker, game files, production data,
  or deployment files; unrelated pre-existing dirty changes are preserved.
- No commit, push, package publication, or deployment occurs without explicit
  approval.

## Release labels

Use these exact trust labels in UI/help:

- HoYo custom cards: **Unofficial local connection · may stop working**
- WuWa custom card, if retained: **Unofficial local connection · reads Kuro
  launcher session · may stop working**
- Endfield: **Official Protocol Terminal**
- Manual timer: **Local estimate**

Never promise zero account risk. HoYoLAB and Gryphline terms restrict unauthorized
scripts, scraping, reverse engineering, or collection. Kuro provides no public
resource API documentation. Public distribution needs a recorded legal/product
decision or publisher permission.

## Source registry

Official user-facing surfaces:

These pages prove that the publisher exposes the feature to its own users. They do
not authorize third-party endpoint reuse, scraping, framing, or automation.

- Genshin Battle Records:
  `https://act.hoyolab.com/app/community-game-records-sea/index.html#/ys`
- HSR Battle Records:
  `https://act.hoyolab.com/app/community-game-records-sea/rpg/index.html#/hsr`
- ZZZ Battle Records:
  `https://act.hoyolab.com/app/mihoyo-zzz-game-record/index.html#/zzz`
- Endfield Protocol Terminal:
  `https://game.skport.com/endfield/game-data?header=0`
- Endfield official Game Tools Guide:
  `https://endfield.gryphline.com/en-us/news/0755`

Current protocol references; evidence only, not an official API contract. These
links are pinned to `genshin.py` commit
`cf675f341f7b4f9a0311f64a1438307b919ebeed`, verified 2026-07-20:

- `genshin.py` routes:
  `https://github.com/seriaati/genshin.py/blob/cf675f341f7b4f9a0311f64a1438307b919ebeed/genshin/client/routes.py`
- Role discovery and account binding reference:
  `https://github.com/seriaati/genshin.py/blob/cf675f341f7b4f9a0311f64a1438307b919ebeed/genshin/client/components/base.py`
- Genshin notes call and model:
  `https://github.com/seriaati/genshin.py/blob/cf675f341f7b4f9a0311f64a1438307b919ebeed/genshin/client/components/chronicle/genshin.py`
  `https://github.com/seriaati/genshin.py/blob/cf675f341f7b4f9a0311f64a1438307b919ebeed/genshin/models/genshin/chronicle/notes.py`
- HSR notes call and model:
  `https://github.com/seriaati/genshin.py/blob/cf675f341f7b4f9a0311f64a1438307b919ebeed/genshin/client/components/chronicle/starrail.py`
  `https://github.com/seriaati/genshin.py/blob/cf675f341f7b4f9a0311f64a1438307b919ebeed/genshin/models/starrail/chronicle/notes.py`
- ZZZ notes call and model:
  `https://github.com/seriaati/genshin.py/blob/cf675f341f7b4f9a0311f64a1438307b919ebeed/genshin/client/components/chronicle/zzz.py`
  `https://github.com/seriaati/genshin.py/blob/cf675f341f7b4f9a0311f64a1438307b919ebeed/genshin/models/zzz/chronicle/notes.py`
- Request signing and headers:
  `https://github.com/seriaati/genshin.py/blob/cf675f341f7b4f9a0311f64a1438307b919ebeed/genshin/client/components/base.py`
  `https://github.com/seriaati/genshin.py/blob/cf675f341f7b4f9a0311f64a1438307b919ebeed/genshin/utility/ds.py`
- Authentication warning/reference:
  `https://github.com/seriaati/genshin.py/blob/cf675f341f7b4f9a0311f64a1438307b919ebeed/docs/authentication.md`

Publisher policy/privacy references:

- HoYoLAB terms: `https://www.hoyolab.com/agreement`
- Gryphline terms:
  `https://user.gryphline.com/en-us/protocol/terms_of_service`
- Endfield privacy:
  `https://user.gryphline.com/en-us/protocol/plain/endfield/game/privacy_policy`
- WuWa privacy:
  `https://wutheringwaves.kurogames.com/p/language_en/privacy_policy.html`
- WuWa terms:
  `https://wutheringwaves.kurogames.com/p/language_en/terms_of_service.html`

Reverify the source registry, current official bundles, endpoints, signing rules,
and terms immediately before implementation and again before any distribution.

## Changed paths

- Added only this handoff document.
- No source, state, account data, browser/launcher profile, queue, test fixture,
  package, deployment, or production file was changed.
