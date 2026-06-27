const test = require("node:test");
const assert = require("node:assert/strict");

const {
  activeWindowGames,
  isLivestreamEntry,
  mergeWindows,
  parseYoutubeFeed,
  shouldKeepExistingWindow,
  windowFromEntry,
} = require("../detect-livestream-windows.cjs");

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <id>yt:video:abc123</id>
    <yt:videoId>abc123</yt:videoId>
    <title>Wuthering Waves Version 3.5 Preview Special Broadcast</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
    <published>2026-06-26T12:27:31+00:00</published>
    <updated>2026-06-26T12:48:26+00:00</updated>
    <media:description>Codes and version preview.</media:description>
  </entry>
  <entry>
    <id>yt:video:def456</id>
    <yt:videoId>def456</yt:videoId>
    <title>Wuthering Waves Version 3.5 Geographic Preview</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=def456"/>
    <published>2026-06-26T11:20:09+00:00</published>
    <updated>2026-06-26T11:20:09+00:00</updated>
  </entry>
</feed>`;

test("parseYoutubeFeed extracts titles, dates, and links", () => {
  const entries = parseYoutubeFeed(feed);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, "abc123");
  assert.equal(entries[0].title, "Wuthering Waves Version 3.5 Preview Special Broadcast");
  assert.equal(entries[0].published, "2026-06-26T12:27:31+00:00");
  assert.equal(entries[0].link, "https://www.youtube.com/watch?v=abc123");
});

test("livestream title filter accepts official programs and rejects ordinary preview videos", () => {
  assert.equal(isLivestreamEntry({ title: "Genshin Impact Version 6.0 Special Program" }), true);
  assert.equal(isLivestreamEntry({ title: "Zenless Zone Zero Version 3.0 Special Program" }), true);
  assert.equal(isLivestreamEntry({ title: "Wuthering Waves Version 3.5 Preview Special Broadcast" }), true);
  assert.equal(isLivestreamEntry({ title: "Bangboo In the Clouds | Roscaelifer Special Livestream" }), false);
  assert.equal(isLivestreamEntry({ title: "Wuthering Waves Version 3.5 Geographic Preview" }), false);
  assert.equal(isLivestreamEntry({ title: "Version 3.5 Trailer | Cool New Area" }), false);
});

test("windowFromEntry builds a buffered deep window from the program publish time", () => {
  const entry = parseYoutubeFeed(feed)[0];
  const window = windowFromEntry(
    { game: "wuwa", name: "Wuthering Waves" },
    entry,
    { now: new Date("2026-06-27T00:00:00Z") },
  );

  assert.equal(window.game, "wuwa");
  assert.equal(window.startsAt, "2026-06-26T06:27:31Z");
  assert.equal(window.endsAt, "2026-06-29T18:27:31Z");
  assert.equal(window.mode, "deep");
  assert.equal(window.source, "youtube");
  assert.equal(window.sourceUrl, "https://www.youtube.com/watch?v=abc123");
});

test("mergeWindows keeps manual windows and merges overlapping detected windows per game", () => {
  const merged = mergeWindows([
    {
      game: "wuwa",
      startsAt: "2026-06-26T10:00:00Z",
      endsAt: "2026-06-29T12:00:00Z",
      mode: "deep",
      note: "manual window",
    },
    {
      game: "wuwa",
      startsAt: "2026-06-26T06:27:31Z",
      endsAt: "2026-06-29T18:27:31Z",
      mode: "deep",
      note: "Wuthering Waves Version 3.5 Preview Special Broadcast",
      source: "youtube",
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
    },
    {
      game: "hsr",
      startsAt: "2026-07-01T00:00:00Z",
      endsAt: "2026-07-04T06:00:00Z",
      mode: "deep",
      note: "Honkai: Star Rail Version 4.0 Special Program",
      source: "youtube",
    },
  ]);

  assert.equal(merged.length, 2);
  const wuwa = merged.find((w) => w.game === "wuwa");
  assert.equal(wuwa.startsAt, "2026-06-26T06:27:31Z");
  assert.equal(wuwa.endsAt, "2026-06-29T18:27:31Z");
  assert.equal(wuwa.source, "manual+youtube");
  assert.equal(wuwa.note, "Wuthering Waves Version 3.5 Preview Special Broadcast");
});

test("activeWindowGames and pruning are time bounded", () => {
  const windows = [
    { game: "genshin", startsAt: "2026-06-01T00:00:00Z", endsAt: "2026-06-04T00:00:00Z" },
    { game: "zzz", startsAt: "2026-06-26T00:00:00Z", endsAt: "2026-06-29T00:00:00Z" },
  ];

  assert.deepEqual(activeWindowGames(windows, new Date("2026-06-27T00:00:00Z")), ["zzz"]);
  assert.equal(shouldKeepExistingWindow(windows[0], new Date("2026-06-20T00:00:00Z")), false);
  assert.equal(shouldKeepExistingWindow(windows[1], new Date("2026-06-30T00:00:00Z")), true);
});
