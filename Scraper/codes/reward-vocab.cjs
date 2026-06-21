// Shared reward vocabulary — single source of truth for "does this reward text
// name a real in-game reward?". Consumed by both the codes scraper
// (codes/scrape.cjs) and the site generator (Site/tools/generate-site-data.mjs),
// so the scraper's publish gate and the site's display filter never disagree.
//
// Lifted verbatim from generate-site-data.mjs (codeRewardKeywords /
// codeRewardReject / isUsefulCodeReward) and extended with a slug→key alias map
// so it works whether called with a site key (gi) or a scraper slug (genshin).

const codeRewardKeywords = {
  gi: ['primogem', 'mora', 'adventurer', 'enhancement ore', 'geode', 'jueyun', 'stir fried', 'adeptea', 'torte'],
  hsr: ['stellar jade', 'credit', 'traveler', 'condensed aether', 'lost gold', 'quantum ghost'],
  zzz: ['polychrome', 'denny', 'investigator', 'w-engine', 'boopon'],
  wuwa: ['astrite', 'shell credit', 'resonance', 'potion', 'waveplate'],
  ae: ['originium', 'industrial currency', 'skill summary'],
};

// Junk-reward markers (merch/discount/affiliate language that shows up when a
// non-redemption "code" is fished out of a Reddit post). `^^` is the kaomoji
// tail that EARLYGIFT-style merch blurbs carry.
const codeRewardReject = /\b(checkout|discount|coupon|shipping|store|shop|etsy|patreon|all items)\b|\^\^/i;

// Accept either the site key (gi/hsr/zzz/wuwa/ae) or the scraper slug
// (genshin/hsr/zzz/wuwa/ww/endfield).
const SLUG_TO_KEY = {
  gi: 'gi', genshin: 'gi',
  hsr: 'hsr',
  zzz: 'zzz',
  wuwa: 'wuwa', ww: 'wuwa',
  ae: 'ae', endfield: 'ae',
};

function rewardKey(gameKeyOrSlug) {
  const k = String(gameKeyOrSlug || '').toLowerCase();
  return SLUG_TO_KEY[k] || k;
}

function hasRewardKeyword(gameKeyOrSlug, rewardText) {
  const text = String(rewardText || '').toLowerCase();
  const keywords = codeRewardKeywords[rewardKey(gameKeyOrSlug)] || [];
  return keywords.some((word) => text.includes(word));
}

// True when the reward text looks like a real game reward and isn't junk.
// A hoyoverse gift sourceUrl is accepted on its own (authoritative redeem link);
// a Reddit sourceUrl therefore must carry a real reward keyword to pass.
function isUsefulReward(gameKeyOrSlug, rewardText, sourceUrl) {
  const text = String(rewardText || '').toLowerCase();
  if (!text || text === 'rewards') return false;
  if (codeRewardReject.test(text)) return false;
  if (hasRewardKeyword(gameKeyOrSlug, rewardText)) return true;
  return /hoyoverse\.com\/.*gift/i.test(String(sourceUrl || ''));
}

module.exports = {
  codeRewardKeywords,
  codeRewardReject,
  rewardKey,
  hasRewardKeyword,
  isUsefulReward,
};
