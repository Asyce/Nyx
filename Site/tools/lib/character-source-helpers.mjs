import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HSR_TEST_ROUND_ICON_SHA256 = '40a77817b465339c0a82d7249bf3fd00f260cc340a2d3d99faba492c8cf4eb86';

export function chooseHsrCharacterIconFromHash(assets = {}, roundIconSha256 = null) {
  const roundIcon = assets?.roundIcon;
  const avatar = assets?.avatar;
  if (!roundIcon) return avatar || null;
  return roundIconSha256 === HSR_TEST_ROUND_ICON_SHA256 ? avatar || null : roundIcon;
}

export function chooseHsrCharacterIcon(assets = {}, dbDir) {
  let roundIconSha256 = null;
  try {
    if (assets?.roundIcon) roundIconSha256 = createHash('sha256')
      .update(readFileSync(resolve(dbDir, assets.roundIcon)))
      .digest('hex');
  } catch {}
  return chooseHsrCharacterIconFromHash(assets, roundIconSha256);
}

export function chooseCharacterOverlay({ game, primary = null, beta = null, sourceStatus = null }) {
  // ZZZ live rows can be public placeholder stubs, so an explicitly beta
  // Prydwen row still prefers its complete beta overlay. Other games use live
  // GameData as soon as Nanoka promotes the character.
  const preferBeta = game === 'zzz' && sourceStatus && sourceStatus !== 'live' && beta;
  const local = preferBeta || primary || beta || null;
  return {
    local,
    status: preferBeta
      ? (local?.contentStatus || sourceStatus || null)
      : (primary?.contentStatus || local?.contentStatus || sourceStatus || null),
  };
}
