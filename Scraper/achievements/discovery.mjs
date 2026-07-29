const GAME_KEYS = new Set(['zzz', 'wuwa', 'ae']);
const PROBE_KINDS = new Set([
  'official-page-metadata',
  'local-file-metadata',
  'network-message-metadata',
  'screen-scan',
]);
const PROBE_STATES = new Set(['not-run', 'blocked', 'candidate', 'rejected']);
const OUTCOMES = new Set(['no-signal', 'partial-signal', 'candidate', 'rejected', 'blocked']);
const SIGNAL_KEYS = new Set([
  'requestCount',
  'responseCount',
  'localFileCount',
  'screenCount',
  'hasStableIds',
  'hasCompleteState',
  'hasPagination',
  'hasMultiStateProgress',
]);

function exactKeys(value, expected, label) {
  const keys = Object.keys(value || {}).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(keys) !== JSON.stringify(wanted)) throw new Error(`${label} fields are invalid`);
}

function iso(value, label) {
  const normalized = new Date(value).toISOString();
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${label} is invalid`);
  return normalized;
}

function safeIdentifier(value, label) {
  const normalized = String(value || '');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

export function validateAchievementDiscoveryPlan(plan) {
  exactKeys(plan, ['schemaVersion', 'updatedAt', 'games'], 'Discovery plan');
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.games) || plan.games.length !== GAME_KEYS.size) {
    throw new Error('Discovery plan envelope is invalid');
  }
  iso(plan.updatedAt, 'Discovery plan updatedAt');
  const seenGames = new Set();
  for (const game of plan.games) {
    exactKeys(game, ['game', 'status', 'progressModel', 'publishable', 'blocker', 'probes'], 'Discovery game');
    if (!GAME_KEYS.has(game.game) || seenGames.has(game.game)) throw new Error('Discovery game is invalid or duplicated');
    seenGames.add(game.game);
    if (game.status !== 'research' || game.publishable !== false || !String(game.blocker || '').trim()) {
      throw new Error(`${game.game} discovery must remain blocked and unpublished`);
    }
    if (game.progressModel !== (game.game === 'ae' ? 'multi-state-unresolved' : 'boolean')) {
      throw new Error(`${game.game} discovery progress model is invalid`);
    }
    if (!Array.isArray(game.probes) || game.probes.length !== PROBE_KINDS.size) {
      throw new Error(`${game.game} discovery probes are incomplete`);
    }
    const seenKinds = new Set();
    const seenIds = new Set();
    for (const probe of game.probes) {
      exactKeys(probe, ['id', 'kind', 'state', 'recordsPayloads', 'recordsCredentials'], 'Discovery probe');
      safeIdentifier(probe.id, 'Discovery probe id');
      if (seenIds.has(probe.id) || !PROBE_KINDS.has(probe.kind) || seenKinds.has(probe.kind)) {
        throw new Error(`${game.game} discovery probes are duplicated or unknown`);
      }
      seenIds.add(probe.id);
      seenKinds.add(probe.kind);
      if (!PROBE_STATES.has(probe.state) || probe.recordsPayloads !== false || probe.recordsCredentials !== false) {
        throw new Error(`${game.game} discovery probe violates the metadata-only policy`);
      }
    }
  }
  if (seenGames.size !== GAME_KEYS.size) throw new Error('Discovery plan is missing a game');
  return plan;
}

export function createDiscoveryObservation({
  game,
  probeId,
  observedAt,
  outcome,
  signals = {},
}) {
  if (!GAME_KEYS.has(game)) throw new Error('Discovery observation game is invalid');
  safeIdentifier(probeId, 'Discovery observation probe id');
  if (!OUTCOMES.has(outcome)) throw new Error('Discovery observation outcome is invalid');
  if (!signals || typeof signals !== 'object' || Array.isArray(signals)) throw new Error('Discovery observation signals are invalid');
  const normalizedSignals = {};
  for (const [key, value] of Object.entries(signals)) {
    if (!SIGNAL_KEYS.has(key)) throw new Error('Discovery observations may contain only bounded metadata signals');
    if (key.endsWith('Count')) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 100000) throw new Error(`${key} is invalid`);
    } else if (typeof value !== 'boolean') {
      throw new Error(`${key} is invalid`);
    }
    normalizedSignals[key] = value;
  }
  return {
    schemaVersion: 1,
    game,
    probeId,
    observedAt: iso(observedAt, 'Discovery observation observedAt'),
    outcome,
    signals: normalizedSignals,
  };
}
