// Unit tests for the codes scraper's pure heuristics — the confidence gate,
// region/expiry parsing, CN detection, and Reddit harvesting. No network.
//   run: npm run codes:test   (or: node --test codes/tests/)

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyRedditOnlyHolds,
  parseCrimsonwitchPayload,
  normalizeRegionLocked,
  parseCodeVariants,
  harvestRedditCodes,
  isCnContext,
  isAuthoritativeSource,
  classifyPremium,
  collectGame8ExpiredCodes,
  parseGame8EndfieldActive,
  codeKey,
} = require("../scrape.cjs");
const { isUsefulReward } = require("../reward-vocab.cjs");

// --- confidence gate --------------------------------------------------------

test("confidence gate: junk Reddit-only reward is held", () => {
  const kept = [
    { code: "EARLYGIFT", rewards: "at checkout for 10% an all items ^^", sourceUrl: "https://www.reddit.com/r/Genshin_Impact/comments/x/", mentions: 1 },
  ];
  const held = classifyRedditOnlyHolds(kept, { slug: "genshin", prevLiveKeys: new Set() });
  assert.ok(held.has("EARLYGIFT"), "EARLYGIFT must be held");
});

test("confidence gate: corroborated (authoritative sourceUrl) publishes", () => {
  const kept = [
    { code: "NMI20MAJGIBP", rewards: "20 Primogems", sourceUrl: "https://genshin.hoyoverse.com/en/gift?code=NMI20MAJGIBP", mentions: 0 },
  ];
  const held = classifyRedditOnlyHolds(kept, { slug: "genshin", prevLiveKeys: new Set() });
  assert.ok(!held.has("NMI20MAJGIBP"), "authoritative code must publish");
});

test("confidence gate: uppercase + real reward + >=2 mentions publishes", () => {
  const kept = [
    { code: "GOODCODE2", rewards: "60 Primogems", sourceUrl: "https://www.reddit.com/r/x/", mentions: 2 },
  ];
  const held = classifyRedditOnlyHolds(kept, { slug: "genshin", prevLiveKeys: new Set() });
  assert.ok(!held.has("GOODCODE2"));
});

test("confidence gate: single-mention Reddit-only is held", () => {
  const kept = [
    { code: "ONEMENTION", rewards: "60 Primogems", sourceUrl: "https://www.reddit.com/r/x/", mentions: 1 },
  ];
  const held = classifyRedditOnlyHolds(kept, { slug: "genshin", prevLiveKeys: new Set() });
  assert.ok(held.has("ONEMENTION"));
});

test("confidence gate: already-live legit code keeps publishing (mentions waived)", () => {
  const kept = [
    { code: "PrevLive", rewards: "60 Primogems", sourceUrl: "https://www.reddit.com/r/x/", mentions: 1 },
  ];
  const held = classifyRedditOnlyHolds(kept, { slug: "genshin", prevLiveKeys: new Set(["PREVLIVE"]) });
  assert.ok(!held.has("PREVLIVE"), "case-folded prevLive key waives only the mentions check");
});

test("confidence gate: already-live JUNK code is still removed (reward check always applies)", () => {
  // EARLYGIFT carry-forward case: it was live, but its reward is merch junk, so
  // the reward check (which is never waived) still moves it off live.
  const kept = [
    { code: "EARLYGIFT", rewards: "at checkout for 10% an all items ^^", sourceUrl: "https://www.reddit.com/r/x/", mentions: 1 },
  ];
  const held = classifyRedditOnlyHolds(kept, { slug: "genshin", prevLiveKeys: new Set(["EARLYGIFT"]) });
  assert.ok(held.has("EARLYGIFT"), "junk reward is held even if it was live last run");
});

// --- reward vocabulary parity ----------------------------------------------

test("isUsefulReward rejects merch junk and accepts real rewards (slug or key)", () => {
  assert.equal(isUsefulReward("genshin", "at checkout for 10% an all items ^^", "https://www.reddit.com/x"), false);
  assert.equal(isUsefulReward("gi", "at checkout for 10% an all items ^^", "https://www.reddit.com/x"), false);
  assert.equal(isUsefulReward("genshin", "60 Primogems", "https://www.reddit.com/x"), true);
  // authoritative hoyoverse gift link passes even without a keyword
  assert.equal(isUsefulReward("genshin", "Rewards", "https://genshin.hoyoverse.com/en/gift?code=X"), false, "literal 'Rewards' is rejected");
  assert.equal(isUsefulReward("genshin", "some thing", "https://genshin.hoyoverse.com/en/gift?code=X"), true);
  assert.equal(isUsefulReward("endfield", "Oroberyl x150, T-Creds x10000", "https://nexus-codes.app/copy/?code=X"), true);
  assert.equal(isUsefulReward("ae", "Advanced Combat Record x2, Arms INSP Kit x2", "https://game8.co/x"), true);
});

test("Endfield premium rewards are classified", () => {
  assert.deepEqual(classifyPremium("Oroberyl x150 and T-Creds x10000"), { premium: true, premium100: false });
  assert.deepEqual(classifyPremium("100 Originium"), { premium: true, premium100: true });
});

test("Game8 expired parser handles nested Endfield expired sections", () => {
  const html = `
    <h2>Arknights: Endfield Expired Codes</h2>
    <h3>All Expired Codes</h3>
    <table>
      <tr><th>Redeem Codes</th><th>Reward</th></tr>
      <tr><td>ALLFIELD Expired 1/29/2026</td><td>Oroberyl x1500</td></tr>
      <tr><td>RETURNOFALL Expired 1/29/2026</td><td>Oroberyl x500</td></tr>
    </table>
    <h2>How to Redeem Codes</h2>
  `;
  assert.deepEqual([...collectGame8ExpiredCodes(html, { mode: "table" })].sort(), ["ALLFIELD", "RETURNOFALL"]);
});

test("Game8 active parser extracts Endfield clipboard codes and rewards", () => {
  const html = `
    <h2>Arknights: Endfield Active Codes</h2>
    <table>
      <tr><th>Redeem Codes</th><th>Reward</th></tr>
      <tr>
        <td><input class="a-clipboard__textInput" value="ENDFIELDGIFT" /></td>
        <td><div>Oroberyl x150</div><div>T-Creds x10,000</div></td>
      </tr>
    </table>
    <h2>Arknights: Endfield Expired Codes</h2>
    <table>
      <tr><td><input class="a-clipboard__textInput" value="ALLFIELD" /></td><td>Oroberyl x1500</td></tr>
    </table>
  `;
  assert.deepEqual(parseGame8EndfieldActive(html, { today: new Date("2026-06-27T00:00:00Z"), sourceUrl: "https://game8.test/endfield" }), [
    {
      code: "ENDFIELDGIFT",
      rewards: "Oroberyl x150 T-Creds x10,000",
      added: "2026-06-27",
      sourceUrl: "https://game8.test/endfield",
      keepWhileActive: true,
    },
  ]);
});

// --- region / expiry parsing -----------------------------------------------

test("normalizeRegionLocked treats null/$undefined as global", () => {
  assert.equal(normalizeRegionLocked(null), null);
  assert.equal(normalizeRegionLocked("$undefined"), null);
  assert.equal(normalizeRegionLocked(""), null);
  assert.equal(normalizeRegionLocked("SEA"), "SEA");
});

test("parseCodeVariants normalizes single string / array / junk", () => {
  assert.deepEqual(parseCodeVariants("593KV7WUMAFN"), ["593KV7WUMAFN"]);
  assert.deepEqual(parseCodeVariants(["ABCD1234", "x"]), ["ABCD1234"]); // "x" too short
  assert.deepEqual(parseCodeVariants(null), []);
});

test("parseCrimsonwitchPayload extracts items with region_locked/expires", () => {
  const items = [
    { id: 1, code: "GLOBALCODE1", code_variants: null, added: "2026-06-10T00:00:00Z", expires: null, rewards: [{ item: "Primogem", qty: 60 }], region_locked: null },
    { id: 2, code: "SEALOCKED1", code_variants: null, added: "2026-06-10T00:00:00Z", expires: null, rewards: [{ item: "Mora", qty: 10000 }], region_locked: "SEA" },
    { id: 3, code: "EXPIREDONE", code_variants: null, added: "2026-06-01T00:00:00Z", expires: "2026-06-05T00:00:00Z", rewards: [{ item: "Primogem", qty: 20 }], region_locked: "$undefined" },
  ];
  const inner = JSON.stringify({ initialCodes: items, other: 1 });
  const body = JSON.stringify(inner).slice(1, -1); // JS-string body for the regex
  const html = `<script>self.__next_f.push([1,"${body}"])</script>`;
  const parsed = parseCrimsonwitchPayload(html);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[1].code, "SEALOCKED1");
  assert.equal(normalizeRegionLocked(parsed[1].region_locked), "SEA");
  assert.equal(normalizeRegionLocked(parsed[2].region_locked), null);
  assert.equal(parsed[2].expires, "2026-06-05T00:00:00Z");
  assert.equal(parseCrimsonwitchPayload("<html>no payload</html>"), null);
});

// --- CN context (must not match global server names) ------------------------

test("isCnContext matches CN markers but not global server names", () => {
  assert.ok(isCnContext("CN server codes"));
  assert.ok(isCnContext("redeem on Bilibili"));
  assert.ok(isCnContext("国服 codes"));
  assert.ok(!isCnContext("select the Asia server"));
  assert.ok(!isCnContext("Europe / America servers"));
  assert.ok(!isCnContext("60 Primogems"));
});

test("isAuthoritativeSource distinguishes reddit from everything else", () => {
  assert.equal(isAuthoritativeSource("https://www.reddit.com/r/x/"), false);
  assert.equal(isAuthoritativeSource("https://genshin.hoyoverse.com/en/gift?code=X"), true);
  assert.equal(isAuthoritativeSource("https://hoyo-codes.seria.moe/codes?game=genshin"), true);
});

// --- Reddit harvesting ------------------------------------------------------

test("harvestRedditCodes: uppercase-only, mention tally, CN + digit-prose drops", () => {
  const byCode = new Map();
  const at = new Date("2026-06-20T00:00:00Z");

  // Two independent bodies dropping the same code → mentions should reach 2.
  harvestRedditCodes("Stellar Jade Codes:\nTOTHEMOON", at, "https://reddit.com/a", byCode);
  harvestRedditCodes("Stellar Jade Codes:\nTOTHEMOON", at, "https://reddit.com/b", byCode);
  assert.ok(byCode.has("TOTHEMOON"));
  assert.equal(byCode.get("TOTHEMOON").mentions, 2);

  // Lowercase token is not a code.
  harvestRedditCodes("Stellar Jade Codes:\ntothemoon", at, "https://reddit.com/c", byCode);
  assert.ok(!byCode.has("TOTHEMOON_LOWER"));
  assert.equal([...byCode.keys()].filter((k) => k === "TOTHEMOON").length, 1);

  // CN header → code beneath it dropped.
  const cn = new Map();
  harvestRedditCodes("China server codes:\nCNGIFTONLY", at, "https://reddit.com/d", cn);
  assert.ok(!cn.has("CNGIFTONLY"), "code under a CN header must be dropped");

  // Asia (a global server) must NOT drop the code.
  const asia = new Map();
  harvestRedditCodes("Active Codes (select Asia/Europe server)\nASIAOKCODE", at, "https://reddit.com/e", asia);
  assert.ok(asia.has("ASIAOKCODE"), "global Asia-server mention must not drop the code");

  // Digit-bearing token buried in long prose near a reward word → no longer
  // bypasses the standalone check.
  const prose = new Map();
  harvestRedditCodes("you can get primogems from BUILD20260815 in this long announcement about various things and more", at, "https://reddit.com/f", prose);
  assert.ok(!prose.has("BUILD20260815"), "digit token in long prose must not be harvested");
});

test("codeKey folds case for identity", () => {
  assert.equal(codeKey("ToTheMoon"), "TOTHEMOON");
  assert.equal(codeKey("tothemoon"), "TOTHEMOON");
});
