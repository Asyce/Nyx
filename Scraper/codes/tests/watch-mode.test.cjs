const test = require("node:test");
const assert = require("node:assert/strict");

const { diffSemanticCodes } = require("../semantic-diff.cjs");
const { decideWatchMode } = require("../watch-mode.cjs");
const { parseCliOptions, parseGameList, preserveEarlierAddedDates } = require("../scrape.cjs");

function baseCodes() {
  return {
    generatedAt: "2026-06-26T00:00:00.000Z",
    games: [
      {
        slug: "wuwa",
        lastSuccessfulFetch: "2026-06-26T00:00:00.000Z",
        codes: [
          {
            code: "MECHANISMCITY",
            rewards: "100 Astrite",
            added: "2026-06-26",
            sourceUrl: "https://game8.co/games/Wuthering-Waves/archives/453149",
            premium: true,
            premium100: true,
            firstSeen: "2026-06-26T00:00:00.000Z",
          },
        ],
      },
    ],
  };
}

test("semantic diff ignores generated/fetch/firstSeen timestamp churn", () => {
  const before = baseCodes();
  const after = baseCodes();
  after.generatedAt = "2026-06-26T01:00:00.000Z";
  after.games[0].lastSuccessfulFetch = "2026-06-26T01:00:00.000Z";
  after.games[0].codes[0].firstSeen = "2026-06-26T01:00:00.000Z";

  assert.deepEqual(diffSemanticCodes(before, after), { changed: false, summary: [] });
});

test("semantic diff catches new live codes", () => {
  const before = baseCodes();
  const after = baseCodes();
  after.games[0].codes.push({
    code: "INTOTHEFOG",
    rewards: "100 Astrite",
    added: "2026-06-26",
    sourceUrl: "https://game8.co/games/Wuthering-Waves/archives/453149",
    premium: true,
    premium100: true,
  });

  const diff = diffSemanticCodes(before, after);
  assert.equal(diff.changed, true);
  assert.ok(diff.summary.includes("wuwa:live +INTOTHEFOG"));
});

test("watch mode skips extra half-hour checks outside livestream windows", () => {
  const mode = decideWatchMode({
    now: new Date("2026-07-01T00:37:00Z"),
    eventName: "schedule",
    schedule: "37 * * * *",
    windows: [],
  });

  assert.equal(mode.shouldRun, false);
  assert.equal(mode.deep, false);
  assert.equal(mode.npmScript, "codes:watch");
});

test("watch mode enables deep checks during livestream windows", () => {
  const mode = decideWatchMode({
    now: new Date("2026-06-26T14:37:00Z"),
    eventName: "schedule",
    schedule: "37 * * * *",
    windows: [
      {
        game: "wuwa",
        startsAt: "2026-06-26T10:00:00Z",
        endsAt: "2026-06-29T12:00:00Z",
        mode: "deep",
      },
    ],
  });

  assert.equal(mode.shouldRun, true);
  assert.equal(mode.deep, true);
  assert.equal(mode.npmScript, "codes:watch:deep");
  assert.deepEqual(mode.redditGames, ["wuwa"]);
});

test("active-only scraper mode preserves prior codes and skips destructive sweeps", () => {
  const normal = parseCliOptions(["--active-only", "--change-gated"]);
  assert.equal(normal.skipExpired, true);
  assert.equal(normal.skipReddit, true);
  assert.equal(normal.preserveMissing, true);

  const deep = parseCliOptions(["--active-only", "--deep", "--change-gated"], { CODES_REDDIT_GAMES: "wuwa,zzz" });
  assert.equal(deep.skipExpired, true);
  assert.equal(deep.skipReddit, false);
  assert.deepEqual(deep.redditGames, ["wuwa", "zzz"]);
  assert.equal(deep.preserveMissing, true);
});

test("reddit game list normalizes comma and whitespace separated values", () => {
  assert.deepEqual(parseGameList(" WUWA, zzz hsr "), ["wuwa", "zzz", "hsr"]);
});

test("date-less active sources cannot make an existing code look new each day", () => {
  const entries = [
    { code: "STABLECODE", added: "2026-08-09" },
    { code: "CORRECTEDCODE", added: "2026-08-01" },
  ];
  preserveEarlierAddedDates(entries, {
    codes: [
      { code: "stablecode", added: "2026-08-03" },
      { code: "correctedcode", added: "2026-08-05" },
    ],
  });

  assert.equal(entries[0].added, "2026-08-03");
  assert.equal(entries[1].added, "2026-08-01");
});
