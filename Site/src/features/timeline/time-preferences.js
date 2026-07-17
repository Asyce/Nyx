// Nyx — shared server-region + display-timezone preferences.
//
// Browser globals are intentional: the site build concatenates its sources.
// Keep the game server (which decides sourced schedule windows) separate from
// the display timezone (which only decides how an instant is written).

var NYX_TIME_REGIONS = ['eu', 'na', 'asia'];
var NYX_TIME_SERVER_ZONES = {
  eu: 'Etc/GMT-1',    // fixed UTC+01:00 — game server time, not European DST
  na: 'Etc/GMT+5',    // fixed UTC-05:00
  asia: 'Etc/GMT-8',  // fixed UTC+08:00
};
// Game-specific exceptions must carry official provenance. Endfield groups
// Americas and Europe on UTC-05:00; reusing the HoYo Europe clock would shift
// every displayed boundary by six hours.
var NYX_TIME_GAME_SERVER_ZONES = {
  ae: {
    zones:{ eu:'Etc/GMT+5', na:'Etc/GMT+5', asia:'Etc/GMT-8' },
    source:'https://endfield.gryphline.com/en-us/news/0758',
  },
};
var NYX_TIME_PREF_SUBS = {};

function nyxTimeGameKey_(gameKey){
  return String(gameKey || 'nyx').replace(/[^a-z0-9_-]/gi, '') || 'nyx';
}

function nyxTimePreferenceStorageKey(gameKey){
  return 'nyx:time-preferences:' + nyxTimeGameKey_(gameKey) + ':v2';
}

function nyxLegacyResetRegionKey(gameKey){
  return 'nyx:reset-region:' + nyxTimeGameKey_(gameKey) + ':v1';
}

function nyxBrowserTimeZone_(){
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch (e) { return 'UTC'; }
}

function nyxNormalizeTimeZone(value, fallback){
  var candidate = String(value || '').trim();
  try {
    if (candidate) { new Intl.DateTimeFormat('en', { timeZone:candidate }).format(0); return candidate; }
  } catch (e) {}
  var safe = String(fallback || '').trim();
  try {
    if (safe) { new Intl.DateTimeFormat('en', { timeZone:safe }).format(0); return safe; }
  } catch (e2) {}
  return 'UTC';
}

function nyxTimeOffsetMinutes_(timeZone, at){
  try {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone:timeZone,
      timeZoneName:'longOffset',
      year:'numeric',
    }).formatToParts(at || new Date());
    var label = parts.find(function(part){ return part.type === 'timeZoneName'; });
    var match = label && label.value.match(/GMT([+-])(\d{2}):?(\d{2})?/i);
    if (!match) return 0;
    var minutes = Number(match[2]) * 60 + Number(match[3] || 0);
    return match[1] === '-' ? -minutes : minutes;
  } catch (e) { return 0; }
}

function nyxNearestServerRegion_(timeZone){
  var offset = nyxTimeOffsetMinutes_(timeZone, new Date());
  var targets = [{ key:'eu', offset:60 }, { key:'na', offset:-300 }, { key:'asia', offset:480 }];
  targets.sort(function(a, b){ return Math.abs(offset - a.offset) - Math.abs(offset - b.offset); });
  return targets[0].key;
}

function nyxDetectTimePreference(timeZone){
  var zone = nyxNormalizeTimeZone(timeZone, nyxBrowserTimeZone_());
  var region = null;
  if (/^Europe\//i.test(zone)) region = 'eu';
  else if (/^(?:America|US|Canada)\//i.test(zone)) region = 'na';
  else if (/^Asia\//i.test(zone)) region = 'asia';
  return {
    serverRegion: region || nyxNearestServerRegion_(zone),
    displayMode: region ? 'server' : 'custom',
    timeZone: zone,
  };
}

function nyxNormalizeTimePreference(value, fallbackTimeZone){
  var detected = nyxDetectTimePreference(fallbackTimeZone || nyxBrowserTimeZone_());
  var row = value && typeof value === 'object' ? value : {};
  var region = NYX_TIME_REGIONS.indexOf(row.serverRegion) !== -1 ? row.serverRegion : detected.serverRegion;
  var mode = row.displayMode === 'custom' || row.displayMode === 'server' ? row.displayMode : detected.displayMode;
  return {
    serverRegion:region,
    displayMode:mode,
    timeZone:nyxNormalizeTimeZone(row.timeZone, detected.timeZone),
  };
}

function nyxValidTimePreference_(value){
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (NYX_TIME_REGIONS.indexOf(value.serverRegion) === -1) return false;
  if (value.displayMode !== 'server' && value.displayMode !== 'custom') return false;
  try {
    if (!value.timeZone) return false;
    new Intl.DateTimeFormat('en', { timeZone:String(value.timeZone) }).format(0);
    return true;
  } catch (e) { return false; }
}

function nyxReadTimePreference_(key){
  try {
    var parsed = JSON.parse(localStorage.getItem(key));
    return nyxValidTimePreference_(parsed) ? parsed : null;
  } catch (e) { return null; }
}

function nyxReadLegacyRegion_(gameKey){
  try {
    var value = localStorage.getItem(nyxLegacyResetRegionKey(gameKey));
    return NYX_TIME_REGIONS.indexOf(value) !== -1 ? value : null;
  } catch (e) { return null; }
}

function nyxSameTimePreference_(a, b){
  return !!a && !!b && a.serverRegion === b.serverRegion && a.displayMode === b.displayMode && a.timeZone === b.timeZone;
}

function nyxCommitTimePreference_(gameKey, preference){
  var v2Key = nyxTimePreferenceStorageKey(gameKey);
  try {
    localStorage.setItem(v2Key, JSON.stringify(preference));
    var verified = nyxReadTimePreference_(v2Key);
    if (!nyxSameTimePreference_(verified, preference)) return false;
    // Keep the previous key mirrored. A rolled-back build therefore still sees
    // the user's server choice; migration never destroys the old preference.
    try { localStorage.setItem(nyxLegacyResetRegionKey(gameKey), preference.serverRegion); } catch (e) {}
    return true;
  } catch (e2) { return false; }
}

function nyxLoadTimePreference(gameKey, detectedTimeZone){
  var zone = nyxNormalizeTimeZone(detectedTimeZone, nyxBrowserTimeZone_());
  var stored = nyxReadTimePreference_(nyxTimePreferenceStorageKey(gameKey));
  if (stored) return nyxNormalizeTimePreference(stored, zone);
  var legacy = nyxReadLegacyRegion_(gameKey);
  var initial = legacy
    ? nyxNormalizeTimePreference({ serverRegion:legacy, displayMode:'server', timeZone:zone }, zone)
    : nyxDetectTimePreference(zone);
  nyxCommitTimePreference_(gameKey, initial);
  return initial;
}

function nyxNotifyTimePreference_(gameKey, preference){
  var list = NYX_TIME_PREF_SUBS[nyxTimeGameKey_(gameKey)];
  if (!list || !list.length) return;
  list.slice().forEach(function(cb){ try { cb(preference); } catch (e) {} });
}

function nyxSaveTimePreference(gameKey, value){
  var preference = nyxNormalizeTimePreference(value, nyxBrowserTimeZone_());
  nyxCommitTimePreference_(gameKey, preference);
  nyxNotifyTimePreference_(gameKey, preference);
  return preference;
}

function nyxPatchTimePreference(gameKey, patch){
  var current = nyxLoadTimePreference(gameKey);
  var next = {};
  Object.keys(current).forEach(function(key){ next[key] = current[key]; });
  Object.keys(patch || {}).forEach(function(key){ next[key] = patch[key]; });
  return nyxSaveTimePreference(gameKey, next);
}

function nyxSubscribeTimePreference(gameKey, cb){
  if (typeof cb !== 'function') return function(){};
  var key = nyxTimeGameKey_(gameKey);
  var list = NYX_TIME_PREF_SUBS[key] || (NYX_TIME_PREF_SUBS[key] = []);
  list.push(cb);
  return function(){
    var rows = NYX_TIME_PREF_SUBS[key];
    if (!rows) return;
    var index = rows.indexOf(cb);
    if (index !== -1) rows.splice(index, 1);
  };
}

function nyxTimePreferenceDisplayZone(preference, gameKey){
  var row = nyxNormalizeTimePreference(preference, nyxBrowserTimeZone_());
  if (row.displayMode === 'custom') return row.timeZone;
  var scoped = NYX_TIME_GAME_SERVER_ZONES[nyxTimeGameKey_(gameKey)];
  return scoped && scoped.zones[row.serverRegion] || NYX_TIME_SERVER_ZONES[row.serverRegion];
}

function nyxFormatTimePreferenceDate(value, preference, options, gameKey){
  var at = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(at.getTime())) return 'Time unavailable';
  var config = {};
  Object.keys(options || {}).forEach(function(key){ config[key] = options[key]; });
  config.timeZone = nyxTimePreferenceDisplayZone(preference, gameKey);
  return new Intl.DateTimeFormat(undefined, config).format(at);
}

function nyxSupportedTimeZones(){
  var current = nyxBrowserTimeZone_();
  var zones = [];
  try { if (Intl.supportedValuesOf) zones = Intl.supportedValuesOf('timeZone'); } catch (e) {}
  if (!zones.length) zones = ['UTC', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore'];
  if (zones.indexOf(current) === -1) zones.unshift(current);
  return zones;
}

if (typeof window !== 'undefined' && !window.__nyxTimePreferenceStorageBound) {
  window.__nyxTimePreferenceStorageBound = true;
  window.addEventListener('storage', function(event){
    if (!event || typeof event.key !== 'string') return;
    var match = /^nyx:time-preferences:([^:]+):v2$/.exec(event.key);
    if (match) {
      var value = nyxReadTimePreference_(event.key);
      if (value) nyxNotifyTimePreference_(match[1], nyxNormalizeTimePreference(value, nyxBrowserTimeZone_()));
      return;
    }
    var legacy = /^nyx:reset-region:([^:]+):v1$/.exec(event.key);
    if (!legacy || NYX_TIME_REGIONS.indexOf(event.newValue) === -1) return;
    // A modern save emits both keys. Its v2 copy already contains the same
    // server region, so ignore only that paired legacy event. If an older tab
    // changes the legacy value by itself, still reflect it in this tab.
    var current = nyxReadTimePreference_(nyxTimePreferenceStorageKey(legacy[1]));
    if (current && current.serverRegion === event.newValue) return;
    current = current
      ? nyxNormalizeTimePreference(current, nyxBrowserTimeZone_())
      : nyxLoadTimePreference(legacy[1]);
    current.serverRegion = event.newValue;
    // An older build can only express a server choice. Persist that one field
    // while preserving a modern tab's Custom display timezone/mode.
    nyxCommitTimePreference_(legacy[1], current);
    nyxNotifyTimePreference_(legacy[1], current);
  });
}

if (typeof window !== 'undefined') {
  window.NyxTimePreferences = {
    regions:NYX_TIME_REGIONS.slice(),
    serverZones:Object.assign({}, NYX_TIME_SERVER_ZONES),
    key:nyxTimePreferenceStorageKey,
    legacyKey:nyxLegacyResetRegionKey,
    detect:nyxDetectTimePreference,
    normalize:nyxNormalizeTimePreference,
    displayZone:nyxTimePreferenceDisplayZone,
    format:nyxFormatTimePreferenceDate,
    supportedTimeZones:nyxSupportedTimeZones,
    load:nyxLoadTimePreference,
    save:nyxSaveTimePreference,
    patch:nyxPatchTimePreference,
    subscribe:nyxSubscribeTimePreference,
  };
}
