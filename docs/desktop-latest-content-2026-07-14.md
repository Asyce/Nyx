# Desktop Latest content v1

## Scope

The desktop launcher shows a quiet, text-only Latest strip for the selected game.
It is optional information only. It cannot launch a game, open a publisher link,
change maintenance state, inspect an account, or mutate local files.

## Sources

- Genshin Impact, Honkai: Star Rail, and Zenless Zone Zero use the three fixed
  `sg-hyp-api.hoyoverse.com` HoYoPlay content URLs in
  `LatestContentService.cs`.
- Each HoYo response must match the exact requested `game.id`, publisher `biz`,
  and `en-us` language before any post can be assigned to that game.
- Wuthering Waves and Arknights: Endfield use only the generated Nyx banner
  snapshot at the fixed `https://pengo.gg/dist/launcher-content-v1.json` URL.
  This is labeled as a Nyx banner snapshot, not publisher-launcher parity.
- A bundled snapshot covers all five games when any optional remote source fails.

## Data boundary

- The transport accepts only four byte-for-byte allowlisted HTTPS URLs.
- Redirects, cookies, automatic decompression, credentials, and arbitrary hosts
  are disabled. Responses must be HTTP 200 JSON and stay within 128 KiB for HoYo
  or 256 KiB for Nyx.
- HoYo JSON is duplicate-key checked, depth bounded, and reduced to at most three
  ordered cards. Only bounded id, recognized type, title, publisher date, and an
  approved-link value are retained. The UI does not expose the link.
- Publisher `MM/dd` labels remain `MM/dd`; Nyx does not invent a year. Full ISO
  timestamps remain timestamps.
- Remote Nyx snapshots must be no more than seven days old and no more than five
  minutes in the future according to the service's injected UTC clock.
- Invalid identity, language, type, link, schema, freshness, status, content type,
  size, timeout, or cancellation never crosses into launch/session/update state.

## Refresh and UI

The service performs a coalesced startup refresh and then uses a six-hour
app-lifetime timer. It shuts down with the app. The selected game's source,
freshness, and up to three text cards are rendered in a compact horizontal scroller.
Refresh events repaint only the Latest strip. The palette uses existing Nyx Moon,
Mist, Iris, and Lavender resources and adds no cyan.

## Verification

Coverage includes all three exact HoYo identities, cross-game/language rejection,
publisher date preservation, stale/future Nyx fallback, hostile JSON, fixed
transport URI/status/redirect/content-type/timeout/size/cancellation behavior,
refresh coalescing and shutdown, generator rollover rules, UI isolation, and
text-only accessibility contracts.

