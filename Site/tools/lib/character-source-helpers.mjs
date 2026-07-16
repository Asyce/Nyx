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
