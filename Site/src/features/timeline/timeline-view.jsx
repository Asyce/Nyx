// Per-game banner timeline. Data is intentionally loaded only from the
// published /data runtime URLs; Database files are never fetched by the UI.
function nyxTlViewDate(ms, dateOnly, preference, gameKey){
  var d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return 'Time unavailable';
  var options = { month:'short', day:'numeric', year:'numeric' };
  // Date-only evidence is a published calendar date, not an instant to shift
  // through the viewer's timezone (which can turn Jul 9 into Jul 10).
  if (dateOnly) options.timeZone = 'UTC';
  else if (preference && typeof nyxFormatTimePreferenceDate === 'function') return nyxFormatTimePreferenceDate(ms, preference, options, gameKey);
  return d.toLocaleDateString(undefined, options);
}
function nyxTlUseTimePreference(gameKey){
  var [preference, setPreference] = React.useState(function(){
    return typeof nyxLoadTimePreference === 'function' ? nyxLoadTimePreference(gameKey) : null;
  });
  React.useEffect(function(){
    if (typeof nyxLoadTimePreference === 'function') setPreference(nyxLoadTimePreference(gameKey));
    return typeof nyxSubscribeTimePreference === 'function' ? nyxSubscribeTimePreference(gameKey, setPreference) : undefined;
  }, [gameKey]);
  return preference;
}
function nyxTlViewDuration(start, end){
  var days = Math.max(0, Math.round((end - start) / NYX_TL_DAY_MS));
  return days ? days + (days === 1 ? ' day' : ' days') : 'Same day';
}
// Format an epoch-ms into a <input type="datetime-local"> value in local time.
function nyxTlLocalInput(ms){
  var d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  var p = function(n){ return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function nyxTlViewMarkerInstances(rows, start, end){
  var out = [];
  (rows || []).forEach(function(row){
    // Disabled markers stay visible as a single greyed pin at their base
    // time so they remain toggleable/editable in place (no ghost expansion).
    if (row.enabled === false) {
      var baseAt = row.type === 'range' ? row.start : row.target;
      var baseEnd = row.type === 'range' ? row.end : row.target;
      if (Number.isFinite(baseAt) && baseEnd >= start && baseAt <= end) {
        out.push({ id:row.id + '@base', label:row.label, color:row.color, start:baseAt, end:baseEnd, timer:row });
      }
      return;
    }
    var recur = row.recur || null;
    var until = (recur && Number.isFinite(recur.until)) ? recur.until : Infinity;
    var push = function(s, e){ if (s > until) return; if (e >= start && s <= end) out.push({ id:row.id + '@' + s, label:row.label, color:row.color, start:s, end:e, timer:row }); };
    if (row.type === 'range') { push(row.start, row.end); return; }
    if (row.type !== 'recurring' || !recur) { push(row.target, row.target); return; }
    if (recur.type === 'interval') {
      var step = Math.max(1, recur.days || 1) * NYX_TL_DAY_MS;
      var n = Math.max(0, Math.floor((start - row.target) / step) - 1);
      for (var guard = 0; guard < 1000; guard++, n++) { var at = row.target + n * step; if (at > end || at > until) break; if (at >= row.target) push(at, at); }
    } else if (recur.type === 'monthly') {
      var base = new Date(row.target), first = new Date(start); first.setDate(1); first.setHours(base.getHours(), base.getMinutes(), 0, 0);
      for (var m = -1; m < 180; m++) { var at2 = new Date(first.getFullYear(), first.getMonth() + m, base.getDate(), base.getHours(), base.getMinutes()).getTime(); if (at2 > end || at2 > until) break; if (at2 >= row.target) push(at2, at2); }
    } else if (recur.type === 'semimonthly') {
      var sb = new Date(row.target), sf = new Date(start); sf.setDate(1); sf.setHours(sb.getHours(), sb.getMinutes(), 0, 0);
      for (var mm = -1; mm < 180; mm++) {
        var d1 = new Date(sf.getFullYear(), sf.getMonth() + mm, 1, sb.getHours(), sb.getMinutes()).getTime();
        var d16 = new Date(sf.getFullYear(), sf.getMonth() + mm, 16, sb.getHours(), sb.getMinutes()).getTime();
        if (d1 > end && d16 > end) break;
        if (d1 >= row.target && d1 <= until) push(d1, d1);
        if (d16 >= row.target && d16 <= until) push(d16, d16);
      }
    }
  });
  return out;
}
// Database/Events/<game>.json files are named per the backend pipeline's own
// game key, which for Endfield is 'endfield' — the client/UI game key is
// 'ae' everywhere else (banner history, activities, page routes). Map here
// rather than touching the backend schema or filenames.
function nyxTlEventsFile(game){ return game === 'ae' ? 'endfield' : game; }
function nyxTlRosterRow(game, name){
  try {
    var roster = typeof getCmRoster === 'function' ? getCmRoster(game) : [];
    return roster.find(function(item){ return String(item.n || item.name || '').toLowerCase() === String(name || '').toLowerCase(); }) || null;
  } catch (e) { return null; }
}
function nyxTlViewIcon(game, name){
  var row = nyxTlRosterRow(game, name);
  return row && (row.icon || row.circle || row.card) || null;
}
// Wide splash/card art for the featured unit, used as a faint card
// backdrop so a banner reads as "that character" at a glance. Degrades to
// null (flat tinted fill) when no art is published for the unit.
function nyxTlViewArt(game, name){
  var row = nyxTlRosterRow(game, name);
  return row && (row.card || row.art || row.overviewArt) || null;
}
// Rarity accent colour for a banner block, game-aware via the shared rarity
// rank (numeric 5/6 or ZZZ letter S). Gold for the headline tier, a warmer
// amber for Endfield 6★, violet as the neutral fallback.
function nyxTlRarityColor(block){
  var five = block && block.fives && block.fives[0];
  var rank = five ? nyxTlRarityRank(five.rarity) : NaN;
  if (Number.isFinite(rank) && rank >= 6) return '#ff9d6e';
  if (Number.isFinite(rank) && rank >= 5) return '#e6c46a';
  return '#c8bcff';
}

// Shared reading order for every timeline: published patch windows first,
// their real banner phases second, then sourced weekly-reset cells. Mixed
// Nyx views keep one compact sub-row per game so overlapping patches do not
// masquerade as a single schedule.
function NyxTimelineBands({ blocks, game, gameName, groups, region, view, msPerPx, width }){
  var entries = Array.isArray(groups) && groups.length ? groups : [{ gameKey:game, gameName:gameName, blocks:blocks || [] }];
  var schedules = entries.map(function(entry){ return { entry:entry, hierarchy:nyxTlScheduleHierarchy(entry.blocks || [], entry.gameKey, region) }; });
  var mixed = schedules.length > 1, weekHeight = mixed ? schedules.length * 22 : 28;
  var visibleStart = nyxTlXToMs(-160, view.centerMs, msPerPx, width), visibleEnd = nyxTlXToMs(width + 160, view.centerMs, msPerPx, width);
  function place(row){ return row.endMs >= visibleStart && row.startMs <= visibleEnd; }
  function packKind(kind){
    var top = 0;
    var items = schedules.map(function(item){
      var packed = nyxTlPackScheduleIntervals(item.hierarchy[kind] || []);
      var result = { item:item, rows:packed.rows, top:top, height:Math.max(1, packed.laneCount) * 22 };
      top += result.height;
      return result;
    });
    return { items:items, height:Math.max(28, top) };
  }
  var patchLayout = packKind('patches'), phaseLayout = packKind('phases');
  return <div className={'ntl-schedule' + (mixed ? ' mixed' : '')} aria-label="Patch, phase, and weekly reset schedule">
    <div className="ntl-schedule-row patches" style={{ height:patchLayout.height }}><span className="ntl-schedule-kind">Patch</span>{patchLayout.items.map(function(group){
      var item = group.item, rows = group.rows.filter(place);
      if (!rows.length) return <i className="ntl-schedule-unavailable" key={'patch-empty-' + item.entry.gameKey} style={{ top:group.top }}>{mixed && (item.entry.gameName || item.entry.gameKey) + ': '}{item.hierarchy.patchStatus || 'Patch data unavailable'}</i>;
      return rows.map(function(row){ return <span className={'ntl-schedule-band patch' + (row.expected ? ' expected' : '')} key={item.entry.gameKey + ':' + row.label} title={(item.entry.gameName || '') + ' patch ' + row.label + (row.expected ? ' (Expected)' : '')} style={{ left:nyxTlMsToX(row.startMs, view.centerMs, msPerPx, width), top:group.top + row.subrow * 22, width:Math.max(0, (row.endMs - row.startMs) / msPerPx) }}><b>{mixed && <em>{item.entry.gameName} </em>}{row.label}</b>{row.expected && <small>Expected</small>}</span>; });
    })}</div>
    <div className="ntl-schedule-row phases" style={{ height:phaseLayout.height }}><span className="ntl-schedule-kind">Phase</span>{phaseLayout.items.map(function(group){
      var item = group.item;
      return group.rows.filter(place).map(function(row){ return <span className={'ntl-schedule-band phase' + (row.expected ? ' expected' : '')} key={item.entry.gameKey + ':' + row.patch + ':' + row.startMs + ':' + row.endMs} title={(item.entry.gameName || '') + ' ' + row.patch + ' ' + row.label + (row.expected ? ' (Expected)' : '')} style={{ left:nyxTlMsToX(row.startMs, view.centerMs, msPerPx, width), top:group.top + row.subrow * 22, width:Math.max(0, (row.endMs - row.startMs) / msPerPx) }}><b>{mixed && <em>{item.entry.gameName} </em>}{row.label}</b>{row.expected && <small>Expected</small>}</span>; });
    })}</div>
    <div className="ntl-schedule-row weeks" style={{ height:weekHeight }}><span className="ntl-schedule-kind">Week</span>{schedules.map(function(item, track){
      if (!item.hierarchy.reset.known) return <i className="ntl-schedule-unavailable" key={'week-empty-' + item.entry.gameKey} style={{ top:track * 22 }}>{mixed && (item.entry.gameName || item.entry.gameKey) + ': '}{item.hierarchy.reset.label}</i>;
      return item.hierarchy.weeks.filter(place).map(function(row, index){ return <span className={'ntl-schedule-week' + (index % 2 ? ' odd' : '') + (row.partial ? ' partial' : '')} key={item.entry.gameKey + ':' + row.patch + ':' + row.startMs} title={(item.entry.gameName || item.entry.gameKey) + ' · ' + row.label + ' · ' + item.hierarchy.reset.label} style={{ left:nyxTlMsToX(row.startMs, view.centerMs, msPerPx, width), top:track * 22, width:(row.endMs - row.startMs) / msPerPx }}><b>{mixed && <em>{String(item.entry.gameKey || '').toUpperCase()} </em>}{row.label.replace('Week ', 'W')}</b></span>; });
    })}</div>
  </div>;
}

function NyxBottomDateRuler({ view, msPerPx, width }){
  var ticks = nyxTlAxisTicks(view.centerMs, msPerPx, width).filter(function(t){ return t.major; });
  return <div className="ntl-bottom-ruler" aria-label="Timeline dates">{ticks.map(function(t){ return <span key={t.ms} style={{ left:nyxTlMsToX(t.ms, view.centerMs, msPerPx, width) }}><b>{t.label}</b><i>{t.year}</i></span>; })}</div>;
}

function NyxSplitName({ value }){
  var parts = nyxTlSplitName(value);
  return <>{parts.map(function(part, index){ return <React.Fragment key={index}>{index > 0 && <br />}{part}</React.Fragment>; })}</>;
}

function nyxTlDetailExcerpt(value){
  var text = String(value || '').replace(/={2,}[^=]+={2,}|〓[^〓]+〓/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 240 ? text.slice(0, 237).trimEnd() + '…' : text;
}
function nyxTlIsGenshinFeaturedActivity(block){
  return !!(block && /stygian onslaught/i.test(block.title || ''));
}
function nyxTlGenshinEntryTitle(block){
  var title = String(block && block.title || 'Event');
  if (/stygian onslaught/i.test(title)) return 'Stygian Onslaught';
  var quoted = title.match(/^["“](.+?)["”]/);
  return quoted ? quoted[1] : title;
}

// Renders one game's character-banner lane onto a shared canvas. Block
// markup/positioning lives here ONCE so the per-game BannerTimeline and the
// hub's cross-game CrossGameBannerTimeline (nyx-0031, plan M4) never fork
// this logic — only the data feeding it differs. `icon` is an optional game
// icon shown beside the lane label; the per-game timeline passes none,
// which keeps its existing "Character banners" header byte-for-byte
// unchanged.
function NyxBannerLane({ game, label, icon, blocks, laneCount, view, msPerPx, width, now, selected, onSelect, genshin, query }){
  var laneHeight = genshin ? Math.max(116, 38 + laneCount * 78) : Math.max(112, laneCount * 100);
  return <div className={'ntl-lane banners' + (genshin ? ' ntl-gi-banner-lane' : '')} style={{ minHeight:laneHeight }}>
    {!genshin && <b>{icon && <img src={icon} alt="" className="ntl-lane-icon" />}{label}</b>}
    {(blocks || []).map(function(block){
      var rawX = nyxTlMsToX(block.startMs, view.centerMs, msPerPx, width), rawW = (block.endMs - block.startMs) / msPerPx,
          x = genshin ? rawX + 8 : rawX, w = genshin ? Math.max(96, rawW - 16) : Math.max(88, rawW - 8),
          state = block.startMs <= now && block.endMs >= now ? ' live' : (block.endMs < now ? ' past' : ''),
          charIcon = nyxTlViewIcon(game, block.primaryFive),
          art = nyxTlViewArt(game, block.primaryFive),
          tag = block.expected ? 'Expected' : (state === ' live' ? 'LIVE · ' + nyxTlCountdownLabel(block.endMs - now) : (block.version || 'Banner')),
          dim = !!(genshin && query && !nyxTlSearchMatch(block, query).match);
      if (genshin) return <button type="button" key={block.id} className={'ntl-block ntl-gi-banner' + state + (block.expected ? ' expected' : '') + (selected === block.id ? ' selected' : '') + (dim ? ' dim' : '')} title={block.expected ? 'Dates are not officially confirmed yet' : block.name} style={{ left:x, top:26 + block.lane * 78, width:w, height:64, '--rar':nyxTlRarityColor(block) }} onClick={function(e){ e.stopPropagation(); onSelect(block); }}>
        {charIcon && <img className="ntl-gi-banner-icon" src={charIcon} alt="" loading="lazy" />}
        <span className="ntl-gi-banner-name"><b><NyxSplitName value={block.primaryFive || 'Next 5★'} /></b></span>
      </button>;
      return <button type="button" key={block.id} className={'ntl-block' + state + (block.expected ? ' expected' : '') + (selected === block.id ? ' selected' : '')} title={block.expected ? 'Educated guess — dates not officially confirmed yet' : block.name} style={{ left:x, top:32 + block.lane * 92, width:w, '--rar':nyxTlRarityColor(block) }} onClick={function(e){ e.stopPropagation(); onSelect(block); }}>
        {art && <span className="ntl-block-art" style={{ backgroundImage:'url("' + art + '")' }} />}
        <span className="ntl-block-body">
          <span className="ntl-block-tag">{tag}</span>
          <strong>{charIcon && <img className="ntl-block-portrait" src={charIcon} alt="" loading="lazy" />}<span className="ntl-block-title"><NyxSplitName value={block.primaryFive || block.name} /></span></strong>
          {block.weaponPrimary && <small>{block.weaponPrimary}</small>}
        </span>
      </button>;
    })}
  </div>;
}

function NyxEventLane({ label, icon, blocks, laneCount, view, msPerPx, width, now, selected, onSelect }){
  return <div className="ntl-lane events" style={{ minHeight:Math.max(112, laneCount * 104) }}>
    <b>{icon && <img src={icon} alt="" className="ntl-lane-icon" />}{label}</b>
    {(blocks || []).map(function(block){
      var x = nyxTlMsToX(block.startMs, view.centerMs, msPerPx, width), w = Math.max(78, (block.endMs - block.startMs) / msPerPx), status = nyxTlEventStatus(block, now), remaining = block.endMs - now;
      var tag = block.expected ? 'Expected' : status === 'live' ? (remaining > 60 * NYX_TL_DAY_MS ? 'LIVE' : 'LIVE · ' + nyxTlCountdownLabel(remaining)) : status === 'ongoing' ? 'Ongoing' : status === 'upcoming' ? 'Upcoming' : 'Ended';
      return <button type="button" key={block.id} className={'ntl-block event ' + status + (block.expected ? ' expected' : '') + (selected === block.id ? ' selected' : '')} title={block.expected ? block.title + ' · Expected dates' : block.title} style={{ left:x, top:32 + block.lane * 100, width:w }} onClick={function(e){ e.stopPropagation(); onSelect(block); }}><span>{tag}</span><strong>{block.image && <img src={block.image} alt="" loading="lazy" />}{block.title}</strong></button>;
    })}
  </div>;
}

function BannerTimeline({ game, gameName }){
  var rootRef = React.useRef(null);
  var canvasRef = React.useRef(null);
  // Unified frame: every game renders the Genshin timeline layout — track
  // rail, patch/phase/week schedule, forecast horizon, mini-map (user 2026-07-16).
  var isGenshin = true;
  var timePreference = nyxTlUseTimePreference(game);
  var viewDate = function(ms, dateOnly){ return nyxTlViewDate(ms, dateOnly, timePreference, game); };
  var [payload, setPayload] = React.useState({ loading:true, records:[], activities:[], events:[], updated:null, error:null });
  var [region, setRegion] = React.useState(function(){ return (typeof loadResetRegion === 'function' ? loadResetRegion(game) : 'na'); });
  var [now, setNow] = React.useState(Date.now());
  var [view, setView] = React.useState(function(){ var saved = nyxTlDecodeHash(location.hash); return saved || { centerMs:Date.now(), zoom:NYX_TL_DEFAULT_ZOOM }; });
  var [width, setWidth] = React.useState(1000);
  var [search, setSearch] = React.useState('');
  var [expandedSearchName, setExpandedSearchName] = React.useState(null);
  var [selected, setSelected] = React.useState(null);
  var [selectedEventId, setSelectedEventId] = React.useState(null);
  var [detailOpen, setDetailOpen] = React.useState(false);
  var [layersOpen, setLayersOpen] = React.useState(false);
  var [layers, setLayers] = React.useState({ banners:true, events:true, activities:true, custom:true, hidePast:false });
  var [timers, setTimers] = React.useState(function(){ return nyxLoadCustomTimersV2(game); });
  var [form, setForm] = React.useState({ label:'', color:'#8b9cff', type:'point', when:'', end:'', recur:'interval', every:'7', until:'', align:false });
  var [showMarker, setShowMarker] = React.useState(false);
  var [editingId, setEditingId] = React.useState(null);
  var [jumpDate, setJumpDate] = React.useState('');
  var [copied, setCopied] = React.useState('');

  React.useEffect(function(){
    var controller = new AbortController();
    setPayload({ loading:true, records:[], activities:[], events:[], updated:null, error:null });
    Promise.all([
      fetch('/data/banner-history/' + game + '.json', { signal:controller.signal, credentials:'same-origin' }).then(function(r){ if (!r.ok) throw new Error('Banner history returned ' + r.status); return r.json(); }),
      fetch('/data/activities/' + game + '.json', { signal:controller.signal, credentials:'same-origin' }).then(function(r){ if (!r.ok) throw new Error('Activities returned ' + r.status); return r.json(); }).catch(function(){ return { activities:[] }; }),
      // Events is a best-effort lane — a missing/broken feed degrades to an
      // empty lane rather than failing the whole timeline (same pattern as
      // activities above).
      fetch('/data/events/' + nyxTlEventsFile(game) + '.json', { signal:controller.signal, credentials:'same-origin' }).then(function(r){ if (!r.ok) throw new Error('Events returned ' + r.status); return r.json(); }).catch(function(){ return { events:[] }; }),
    ]).then(function(results){
      var history = results[0], acts = results[1], evts = results[2];
      if (!Array.isArray(history.records)) throw new Error('Banner history is invalid');
      setPayload({ loading:false, records:history.records, activities:Array.isArray(acts.activities) ? acts.activities : [], events:Array.isArray(evts.events) ? evts.events : [], updated:history.generatedAt || history.dataTimestamp || null, error:null });
    }).catch(function(error){ if (error.name !== 'AbortError') setPayload({ loading:false, records:[], activities:[], events:[], updated:null, error:error.message || 'Timeline could not be loaded.' }); });
    return function(){ controller.abort(); };
  }, [game]);
  React.useEffect(function(){ setTimers(nyxLoadCustomTimersV2(game)); setRegion(typeof loadResetRegion === 'function' ? loadResetRegion(game) : 'na'); setSelectedEventId(null); }, [game]);
  // Single source of truth: re-read the shared timer store and the shared
  // server-region setting whenever the Reset Timers card (or another tab)
  // changes them, so the two surfaces never diverge (Sol findings #2, #6).
  React.useEffect(function(){ return nyxSubscribeCustomTimers(game, setTimers); }, [game]);
  React.useEffect(function(){ return (typeof subscribeResetRegion === 'function') ? subscribeResetRegion(game, setRegion) : undefined; }, [game]);
  React.useEffect(function(){ var id = setInterval(function(){ setNow(Date.now()); }, 1000); return function(){ clearInterval(id); }; }, []);
  React.useEffect(function(){
    var el = canvasRef.current || rootRef.current; if (!el || !window.ResizeObserver) return undefined;
    var observer = new ResizeObserver(function(){ setWidth(Math.max(320, el.clientWidth || 320)); }); observer.observe(el); setWidth(Math.max(320, el.clientWidth || 320));
    return function(){ observer.disconnect(); };
  }, [isGenshin]);

  var regionKey = nyxTlRegionKey(region);
  var msPerPx = NYX_TL_MS_PER_PX;
  var builtBlocks = React.useMemo(function(){ return nyxTlBuildBlocks(payload.records, regionKey); }, [payload.records, regionKey]);
  // Assign sub-lanes from the ACTUAL rendered card extent (min-width
  // inflated to NYX_TL_BLOCK_MIN_PX * msPerPx), so min-width cards never
  // overlap at coarse zoom levels (Sol finding #5). Re-runs on zoom change.
  var blocks = React.useMemo(function(){ return nyxTlAssignSubLanes(builtBlocks, (isGenshin ? 120 : NYX_TL_BLOCK_MIN_PX) * msPerPx); }, [builtBlocks, msPerPx, isGenshin]);
  var rangeStart = nyxTlXToMs(-600, view.centerMs, msPerPx, width);
  var rangeEnd = nyxTlXToMs(width + 600, view.centerMs, msPerPx, width);
  var visible = nyxTlVisibleBlocks(blocks.blocks, view.centerMs, msPerPx, width, 600).filter(function(block){ return !layers.hidePast || block.endMs >= now; });
  var activities = layers.activities ? nyxTlExpandActivities(payload.activities, rangeStart, rangeEnd, regionKey) : [];
  var activityLayout = nyxTlAssignSubLanes(activities, 12 * msPerPx);
  var markers = layers.custom ? nyxTlViewMarkerInstances(timers, rangeStart, rangeEnd) : [];
  var markerLayout = nyxTlAssignSubLanes(markers, NYX_TL_MARKER_MIN_PX * msPerPx);
  var eventBlocksAll = React.useMemo(function(){ return nyxTlBuildEventBlocks(payload.events, now); }, [payload.events, now]);
  var eventSplit = React.useMemo(function(){ return nyxTlSplitEventBlocks(eventBlocksAll); }, [eventBlocksAll]);
  var eventAxisBlocks = isGenshin ? eventSplit.axis.filter(function(block){ return !nyxTlIsGenshinFeaturedActivity(block); }) : eventSplit.axis;
  var eventAxisLayout = React.useMemo(function(){ return nyxTlAssignSubLanes(eventAxisBlocks, (isGenshin ? 120 : NYX_TL_BLOCK_MIN_PX) * msPerPx); }, [eventAxisBlocks, msPerPx, isGenshin]);
  var visibleEvents = layers.events ? nyxTlVisibleBlocks(eventAxisLayout.blocks, view.centerMs, msPerPx, width, 600) : [];
  var searchGroups = nyxTlSearchGroups(blocks.blocks, search);
  var visibleMatches = search ? visible.filter(function(block){ return nyxTlSearchMatch(block, search).match; }) : visible;
  var selectedBlock = !selectedEventId && selected && blocks.blocks.find(function(block){ return block.id === selected; });
  var selectedEventBlock = selectedEventId && eventBlocksAll.find(function(block){ return block.id === selectedEventId; });
  function selectEvent(id){ setSelectedEventId(id); setSelected(null); setDetailOpen(true); }
  function recenter(centerMs){ setView(function(old){ return { centerMs:centerMs, zoom:old.zoom }; }); }
  function jumpToBlock(block, openDetails){
    if (!block) return;
    recenter(block.startMs + Math.max(0, block.endMs - block.startMs) / 2);
    setSelected(block.id); setSelectedEventId(null); setDetailOpen(!!openDetails);
  }
  function submitSearch(event){
    event.preventDefault();
    var latest = blocks.blocks.filter(function(block){ return nyxTlSearchMatch(block, search).match; }).sort(function(a,b){ return b.startMs - a.startMs; })[0];
    if (latest) jumpToBlock(latest, false);
  }
  function panBy(px){ setView(function(old){ return { centerMs:old.centerMs - px * NYX_TL_MS_PER_PX, zoom:old.zoom }; }); }
  function pointerDown(event){
    var startX = event.clientX, startCenter = view.centerMs;
    function move(e){ setView(function(old){ return { centerMs:startCenter - (e.clientX - startX) * NYX_TL_MS_PER_PX, zoom:old.zoom }; }); }
    function up(){ window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function copyView(){
    var token = nyxTlEncodeHash(view);
    try { history.replaceState(null, '', location.pathname + location.search + '#' + token); } catch (e) {}
    var url = location.href;
    var flash = function(msg){ setCopied(msg); setTimeout(function(){ setCopied(''); }, 5000); };
    // Fallback path: a hidden textarea + execCommand for browsers without
    // (or denying) the async Clipboard API. Either way, give visible
    // success/failure feedback (Sol finding #12).
    var fallback = function(){
      try {
        var ta = document.createElement('textarea');
        ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        flash(ok ? 'View link copied' : 'Copy failed — copy the URL');
      } catch (e) { flash('Copy failed — copy the URL'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function(){ flash('View link copied'); }, function(){ fallback(); });
    } else { fallback(); }
  }
  // Optional server-reset alignment uses the selected game server, not the
  // browser/computer timezone (plan M2).
  function alignToReset(ms){ return nyxTlAlignToServerReset(ms, region); }
  function buildMarkerRecur(){
    if (form.type !== 'recurring') return null;
    var recur = form.recur === 'monthly' ? { type:'monthly' }
      : form.recur === 'semimonthly' ? { type:'semimonthly' }
      : { type:'interval', days:Number(form.every) || 1 };
    var until = Date.parse(form.until);
    if (Number.isFinite(until)) recur.until = until;
    return recur;
  }
  function saveMarker(event){
    event.preventDefault();
    var when = Date.parse(form.when), end = Date.parse(form.end);
    if (form.align && form.type !== 'range') when = alignToReset(when);
    var input = { id:editingId || undefined, label:form.label, color:form.color, type:form.type, target:when, start:when, end:end, recur:buildMarkerRecur() };
    var timer = nyxMakeTimerV2(input); if (!timer) return;
    if (editingId) timer.id = editingId;
    // Per-id upsert against a fresh store read (Sol finding #2).
    setTimers(nyxUpsertCustomTimerV2(game, timer));
    setShowMarker(false); setEditingId(null);
    setForm({ label:'', color:'#8b9cff', type:'point', when:'', end:'', recur:'interval', every:'7', until:'', align:false });
  }
  function deleteTimer(id){ setTimers(nyxRemoveCustomTimerV2(game, id)); if (editingId === id) { setEditingId(null); setShowMarker(false); } }
  function toggleTimer(id){ setTimers(nyxToggleCustomTimerV2(game, id)); }
  function editTimer(row){
    setEditingId(row.id);
    setForm({
      label:row.label || '', color:row.color || '#8b9cff', type:row.type || 'point',
      when:row.type === 'range' ? nyxTlLocalInput(row.start) : nyxTlLocalInput(row.target),
      end:row.type === 'range' ? nyxTlLocalInput(row.end) : '',
      recur:(row.recur && row.recur.type) || 'interval',
      every:String((row.recur && row.recur.days) || 7),
      until:(row.recur && Number.isFinite(row.recur.until)) ? nyxTlLocalInput(row.recur.until) : '',
      align:false,
    });
    setShowMarker(true);
  }

  function closeDetails(){ setDetailOpen(false); setSelected(null); setSelectedEventId(null); }
  React.useEffect(function(){
    if (!isGenshin || !detailOpen || (!selected && !selectedEventId)) return undefined;
    function onKeyDown(event){ if (event.key === 'Escape') closeDetails(); }
    window.addEventListener('keydown', onKeyDown);
    return function(){ window.removeEventListener('keydown', onKeyDown); };
  }, [isGenshin, detailOpen, selected, selectedEventId]);

  if (isGenshin) {
    var giBannerHeight = Math.max(116, 38 + blocks.laneCount * 78);
    var giEventHeight = Math.max(74, 36 + eventAxisLayout.laneCount * 42);
    var giActivityHeight = Math.max(74, 34 + activityLayout.laneCount * 26);
    var giPlanningHeight = Math.max(58, 30 + markerLayout.laneCount * 31);
    var expectedStart = visible.filter(function(block){ return block.expected; }).reduce(function(min, block){ return Math.min(min, block.startMs); }, Infinity);
    var detailArt = selectedEventBlock ? selectedEventBlock.image : (selectedBlock ? nyxTlViewArt(game, selectedBlock.primaryFive) : null);
    var detailStatus = selectedEventBlock ? nyxTlEventStatus(selectedEventBlock, now) : null;
    var detailLabel = selectedEventBlock ? 'Event details' : 'Banner details';
    var miniStart = now - 120 * NYX_TL_DAY_MS, miniEnd = now + 120 * NYX_TL_DAY_MS, miniSpan = miniEnd - miniStart;
    var viewStart = nyxTlXToMs(0, view.centerMs, msPerPx, width), viewEnd = nyxTlXToMs(width, view.centerMs, msPerPx, width);
    var miniLeft = Math.max(0, Math.min(100, (viewStart - miniStart) / miniSpan * 100));
    var miniWidth = Math.max(5, Math.min(100 - miniLeft, (viewEnd - viewStart) / miniSpan * 100));
    function scrubTo(event){
      var rect = event.currentTarget.getBoundingClientRect();
      var at = miniStart + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * miniSpan;
      recenter(at);
    }
    function scrubDown(event){
      scrubTo(event);
      var target = event.currentTarget;
      function move(e){ var rect = target.getBoundingClientRect(); recenter(miniStart + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * miniSpan); }
      function up(){ window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }
    return <section className="ntl ntl-genshin" ref={rootRef} aria-label={gameName + ' banner timeline'}>
      {payload.updated && <header className="ntl-head ntl-head-quiet"><span className="ntl-updated">Updated {viewDate(Date.parse(payload.updated))}</span></header>}
      <div className="ntl-tools ntl-gi-tools">
        <form className="ntl-search" onSubmit={submitSearch}><label htmlFor="ntl-gi-search">Search banners</label><input id="ntl-gi-search" type="search" value={search} onChange={function(e){ setSearch(e.target.value); setExpandedSearchName(null); }} placeholder="Character/Weapon" /></form>
        <button type="button" className="ntl-gi-today" onClick={function(){ recenter(Date.now()); }}>Today</button>
        <label className="ntl-jump ntl-gi-jump" title="Choose a date"><span>Jump to date</span><i className="ntl-gi-calendar-icon" aria-hidden="true" /><input type="date" aria-label="Jump to date" value={jumpDate} onChange={function(e){ setJumpDate(e.target.value); var at = Date.parse(e.target.value + 'T12:00:00'); if (Number.isFinite(at)) recenter(at); }} /></label>
        <button type="button" onClick={function(){ if (showMarker) { setShowMarker(false); setEditingId(null); } else { setEditingId(null); setForm({ label:'', color:'#8b9cff', type:'point', when:'', end:'', recur:'interval', every:'7', until:'', align:false }); setShowMarker(true); } }}>Add to Personal</button>
        <button type="button" title="Copy a link to this exact timeline position" onClick={copyView}>Copy view</button>{copied && <span className="ntl-copied" role="status" aria-live="polite">{copied}</span>}
        <div className="ntl-gi-layer-buttons"><b>Display</b>{[['events','Events'],['activities','Activities'],['custom','Personal']].map(function(item){ return <button type="button" key={item[0]} className={layers[item[0]] ? 'on' : 'off'} aria-pressed={layers[item[0]]} onClick={function(){ var next = Object.assign({}, layers); next[item[0]] = !next[item[0]]; setLayers(next); }}>{item[1]}</button>; })}</div>
      </div>
      {showMarker && <form className="ntl-marker-form" onSubmit={saveMarker}><input required maxLength="42" value={form.label} placeholder="Marker label" onChange={function(e){ setForm(Object.assign({}, form, { label:e.target.value })); }} /><input type="color" aria-label="Marker color" value={form.color} onChange={function(e){ setForm(Object.assign({}, form, { color:e.target.value })); }} /><select aria-label="Marker type" value={form.type} onChange={function(e){ setForm(Object.assign({}, form, { type:e.target.value })); }}><option value="point">Exact moment</option><option value="range">Range</option><option value="recurring">Recurring</option></select><input required type="datetime-local" aria-label={form.type === 'range' ? 'Start' : 'When'} value={form.when} onChange={function(e){ setForm(Object.assign({}, form, { when:e.target.value })); }} />{form.type === 'range' && <input required type="datetime-local" aria-label="End" value={form.end} onChange={function(e){ setForm(Object.assign({}, form, { end:e.target.value })); }} />}{form.type === 'recurring' && <><select aria-label="Recurrence" value={form.recur} onChange={function(e){ setForm(Object.assign({}, form, { recur:e.target.value })); }}><option value="interval">Every N days</option><option value="semimonthly">1st + 16th</option><option value="monthly">Monthly</option></select>{form.recur === 'interval' && <input type="number" min="1" aria-label="Interval days" value={form.every} onChange={function(e){ setForm(Object.assign({}, form, { every:e.target.value })); }} />}<label className="ntl-until"><span>Until</span><input type="datetime-local" aria-label="Repeat until" value={form.until} onChange={function(e){ setForm(Object.assign({}, form, { until:e.target.value })); }} /></label></>}{form.type !== 'range' && <label className="ntl-align"><input type="checkbox" checked={form.align} onChange={function(e){ setForm(Object.assign({}, form, { align:e.target.checked })); }} />Align to reset (04:00)</label>}<button type="submit">{editingId ? 'Update' : 'Save'}</button>{editingId && <button type="button" onClick={function(){ setShowMarker(false); setEditingId(null); }}>Cancel</button>}</form>}
      {payload.loading && <div className="ntl-status" role="status">Loading complete banner history…</div>}{payload.error && <div className="ntl-status error" role="alert">{payload.error}</div>}
      {!payload.loading && !payload.error && <>
        {search && <div className="ntl-results ntl-gi-search-results" aria-live="polite">{searchGroups.slice(0, 8).map(function(group){ var runs = group.blockIds.map(function(id){ return blocks.blocks.find(function(block){ return block.id === id; }); }).filter(Boolean).sort(function(a,b){ return b.startMs - a.startMs; }); var open = expandedSearchName === group.name; return <section key={group.name}><button type="button" className="ntl-gi-search-summary" aria-expanded={open} onClick={function(){ setExpandedSearchName(open ? null : group.name); }}><b>{group.name}</b><span>{group.count} {group.count === 1 ? 'run' : 'runs'}</span><i>{open ? '−' : '+'}</i></button>{open && <div className="ntl-gi-search-runs">{runs.map(function(block){ return <button type="button" key={block.id} onClick={function(){ jumpToBlock(block, false); }}><span><b>{viewDate(block.startMs, block.dateOnly)} – {viewDate(block.endMs, block.dateOnly)}</b><small>{nyxTlViewDuration(block.startMs, block.endMs)} · {block.name}</small></span><em>Jump</em></button>; })}</div>}</section>; })}{!searchGroups.length && <span>No banner runs found.</span>}</div>}
        <div className="ntl-gi-workspace">
          <div className="ntl-gi-stage">
            <div className="ntl-gi-frame">
              <div className="ntl-gi-track-rail" aria-hidden="true"><div className="ntl-gi-rail-head"><span>Patch</span><b>Phase<br />Week</b></div><div className="ntl-gi-rail-row" style={{ height:giBannerHeight }}><span><i />Character<br />banners</span></div>{layers.events && <div className="ntl-gi-rail-row event" style={{ height:giEventHeight }}><span><i />Events</span></div>}{layers.activities && <div className="ntl-gi-rail-row activity" style={{ height:giActivityHeight }}><span><i />Activities</span></div>}{layers.custom && <div className="ntl-gi-rail-row planning" style={{ height:giPlanningHeight }}><span><i />Personal</span></div>}<div className="ntl-gi-rail-foot">Dates</div></div>
              <div className="ntl-canvas ntl-gi-canvas" ref={canvasRef} onPointerDown={pointerDown} onWheel={function(e){ var horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0); if (Math.abs(horizontal) > 1) { e.preventDefault(); panBy(-horizontal); } }}>
                <NyxTimelineBands blocks={blocks.blocks} game={game} gameName={gameName} region={regionKey} view={view} msPerPx={msPerPx} width={width} />
                {Number.isFinite(expectedStart) && <div className="ntl-gi-forecast" style={{ left:nyxTlMsToX(expectedStart, view.centerMs, msPerPx, width) }}><span>Forecast horizon</span></div>}
                <div className="ntl-gi-now-band" style={{ left:nyxTlMsToX(now, view.centerMs, msPerPx, width) }} /><div className="ntl-now" style={{ left:nyxTlMsToX(now, view.centerMs, msPerPx, width) }}><span>Now</span></div>
                <NyxBannerLane game={game} label="Character banners" blocks={visible} laneCount={blocks.laneCount} view={view} msPerPx={msPerPx} width={width} now={now} selected={selected} query={search} genshin onSelect={function(block){ setSelected(block.id); setSelectedEventId(null); setDetailOpen(true); }} />
                {layers.events && <div className="ntl-lane events ntl-gi-event-lane" style={{ minHeight:giEventHeight }}>{visibleEvents.map(function(block){ var x = nyxTlMsToX(block.startMs, view.centerMs, msPerPx, width), w = Math.max(120, (block.endMs - block.startMs) / msPerPx), status = nyxTlEventStatus(block, now), tag = block.expected ? 'Expected' : status === 'live' || status === 'ongoing' ? 'Ongoing' : status === 'upcoming' ? 'Upcoming' : 'Ended'; return <button type="button" key={block.id} className={'ntl-gi-event ' + status + (block.expected ? ' expected' : '') + (selectedEventId === block.id ? ' selected' : '')} title={block.expected ? block.title + ' · Expected dates' : block.title} style={{ left:x, top:26 + block.lane * 42, width:w, height:38 }} onClick={function(e){ e.stopPropagation(); selectEvent(block.id); }}><b>{nyxTlGenshinEntryTitle(block)}</b><i>{block.expected ? 'Expected schedule' : viewDate(block.startMs, true) + ' – ' + viewDate(block.endMs, true)}</i>{(status !== 'past' || block.expected) && <span>{tag}</span>}</button>; })}</div>}
                {layers.activities && <div className="ntl-lane activities ntl-gi-activity-lane" style={{ minHeight:giActivityHeight }}>{activityLayout.blocks.map(function(activity){ return <span key={activity.id} className={'ntl-activity' + (activity.expected ? ' expected' : '')} title={activity.label + (activity.expected ? ' · Expected schedule' : ' · Exact schedule')} style={{ left:nyxTlMsToX(activity.start, view.centerMs, msPerPx, width), top:26 + activity.lane * 26, width:Math.max(12, (activity.end - activity.start) / msPerPx), height:22 }}>{activity.label}{activity.expected && <small>Expected</small>}</span>; })}</div>}
                {layers.custom && <div className="ntl-lane custom ntl-gi-planning-lane" style={{ minHeight:giPlanningHeight }}>{markerLayout.blocks.map(function(marker){ var w = Math.max(NYX_TL_MARKER_MIN_PX, (marker.end - marker.start) / msPerPx); return <span key={marker.id} className={'ntl-marker' + (marker.timer.enabled === false ? ' off' : '')} title={marker.label} style={{ left:nyxTlMsToX(marker.start, view.centerMs, msPerPx, width), top:23 + marker.lane * 31, width:w, borderColor:marker.color, color:marker.color }}><button type="button" className="ntl-marker-label" title="Edit marker" onClick={function(){ editTimer(marker.timer); }}>{marker.label}</button><button type="button" className="ntl-marker-toggle" aria-pressed={marker.timer.enabled !== false} title={marker.timer.enabled === false ? 'Enable marker' : 'Disable marker'} onClick={function(){ toggleTimer(marker.timer.id); }}>{marker.timer.enabled === false ? '○' : '●'}</button><button type="button" className="ntl-marker-del" aria-label={'Remove ' + marker.label} title="Remove marker" onClick={function(){ deleteTimer(marker.timer.id); }}>×</button></span>; })}</div>}
                <NyxBottomDateRuler view={view} msPerPx={msPerPx} width={width} />
              </div>
            </div>
            <div className="ntl-gi-mini" role="scrollbar" aria-label="Timeline overview — drag to navigate" tabIndex="0" onPointerDown={scrubDown}><span className="ntl-gi-mini-now" style={{ left:(now - miniStart) / miniSpan * 100 + '%' }}><b>Today</b></span><span className="ntl-gi-mini-window" style={{ left:miniLeft + '%', width:miniWidth + '%' }} /></div>
          </div>
        </div>
        {detailOpen && (selectedEventBlock || selectedBlock) && <div className="ntl-gi-modal-backdrop" onMouseDown={function(event){ if (event.target === event.currentTarget) closeDetails(); }}>
          <aside className={'ntl-gi-detail ntl-gi-modal' + (detailArt ? '' : ' noart')} role="dialog" aria-modal="true" aria-label={detailLabel}>
            <div className="ntl-gi-ledger-head"><span>{detailLabel}</span><i /></div>
            <button type="button" className="ntl-gi-modal-close" aria-label="Close details" onClick={closeDetails}>×</button>
            {detailArt && <div className="ntl-gi-detail-art" style={{ backgroundImage:'url("' + detailArt + '")' }} />}
            <div className="ntl-gi-detail-copy">{selectedEventBlock ? <>
              <span className="k">Official event · {selectedEventBlock.expected ? 'Expected' : ({ review:'Needs review', ongoing:'Ongoing', live:'Live now', upcoming:'Upcoming', past:'Ended' }[detailStatus])}</span>
              <h2>{nyxTlGenshinEntryTitle(selectedEventBlock)}</h2>
              <p className="when">{selectedEventBlock.expected ? 'Expected — dates are not officially confirmed yet' : viewDate(selectedEventBlock.startMs) + ' – ' + (selectedEventBlock.openEnd ? 'Ongoing' : viewDate(selectedEventBlock.endMs))}</p>
              {selectedEventBlock.description && <p>{nyxTlDetailExcerpt(selectedEventBlock.description)}</p>}
              {!selectedEventBlock.expected && (detailStatus === 'live' || detailStatus === 'ongoing') && <p className="countdown">Ends in <b>{nyxTlCountdownLabel(selectedEventBlock.endMs - now)}</b></p>}
              {selectedEventBlock.sourceUrl && <p><a href={selectedEventBlock.sourceUrl} target="_blank" rel="noreferrer">View official source ↗</a></p>}
            </> : <>
              <span className="k">{selectedBlock.version || 'Banner'} · {selectedBlock.region ? selectedBlock.region.toUpperCase() + ' schedule' : 'Published schedule'}</span>
              <h2>{selectedBlock.primaryFive || selectedBlock.name}</h2>
              <p>{selectedBlock.name}</p>
              <p className="when">{viewDate(selectedBlock.startMs, selectedBlock.dateOnly)} – {viewDate(selectedBlock.endMs, selectedBlock.dateOnly)} · {nyxTlViewDuration(selectedBlock.startMs, selectedBlock.endMs)}</p>
              {selectedBlock.fours.length > 0 && <p><b>Featured 4★:</b> {selectedBlock.fours.map(function(row){ return row.name; }).join(', ')}</p>}
              {selectedBlock.signatureWeaponNames && selectedBlock.signatureWeaponNames.length > 0 && <p><b>Featured 5★ weapons:</b> {selectedBlock.signatureWeaponNames.join(', ')}</p>}
              {selectedBlock.startMs <= now && selectedBlock.endMs >= now && <p className="countdown">Ends in <b>{nyxTlCountdownLabel(selectedBlock.endMs - now)}</b></p>}
              {selectedBlock.sourceUrl && <p><a href={selectedBlock.sourceUrl} target="_blank" rel="noreferrer">View source ↗</a></p>}
            </>}</div>
          </aside>
        </div>}
      </>}
    </section>;
  }
  return <section className="ntl" ref={rootRef} aria-label={gameName + ' banner timeline'}>
    {payload.updated && <header className="ntl-head ntl-head-quiet"><span className="ntl-updated">Updated {viewDate(Date.parse(payload.updated))}</span></header>}
    <div className="ntl-tools">
      <label className="ntl-search"><span>Search all banners</span><input type="search" value={search} onChange={function(e){ setSearch(e.target.value); }} placeholder="Character or weapon" /></label>
      <button type="button" onClick={function(){ recenter(Date.now()); }}>Today</button><label className="ntl-jump"><span>Jump to date</span><input type="date" value={jumpDate} onChange={function(e){ setJumpDate(e.target.value); var at = Date.parse(e.target.value + 'T12:00:00'); if (Number.isFinite(at)) recenter(at); }} /></label>      <button type="button" onClick={function(){ if (showMarker) { setShowMarker(false); setEditingId(null); } else { setEditingId(null); setForm({ label:'', color:'#8b9cff', type:'point', when:'', end:'', recur:'interval', every:'7', until:'', align:false }); setShowMarker(true); } }}>Add to Personal</button><button type="button" onClick={copyView}>Copy link</button>{copied && <span className="ntl-copied" role="status" aria-live="polite">{copied}</span>}
      <div className="ntl-layers"><button type="button" aria-expanded={layersOpen} onClick={function(){ setLayersOpen(!layersOpen); }}>Display</button>{layersOpen && <div className="ntl-popover">{[['banners','Character banners'],['events','Events'],['activities','Activities'],['custom','Personal'],['hidePast','Hide past banners']].map(function(item){ return <label key={item[0]}><input type="checkbox" checked={layers[item[0]]} onChange={function(e){ var next = Object.assign({}, layers); next[item[0]] = e.target.checked; setLayers(next); }} />{item[1]}</label>; })}</div>}</div>
    </div>
    {showMarker && <form className="ntl-marker-form" onSubmit={saveMarker}><input required maxLength="42" value={form.label} placeholder="Marker label" onChange={function(e){ setForm(Object.assign({}, form, { label:e.target.value })); }} /><input type="color" aria-label="Marker color" value={form.color} onChange={function(e){ setForm(Object.assign({}, form, { color:e.target.value })); }} /><select aria-label="Marker type" value={form.type} onChange={function(e){ setForm(Object.assign({}, form, { type:e.target.value })); }}><option value="point">Exact moment</option><option value="range">Range</option><option value="recurring">Recurring</option></select><input required type="datetime-local" aria-label={form.type === 'range' ? 'Start' : 'When'} value={form.when} onChange={function(e){ setForm(Object.assign({}, form, { when:e.target.value })); }} />{form.type === 'range' && <input required type="datetime-local" aria-label="End" value={form.end} onChange={function(e){ setForm(Object.assign({}, form, { end:e.target.value })); }} />}{form.type === 'recurring' && <><select aria-label="Recurrence" value={form.recur} onChange={function(e){ setForm(Object.assign({}, form, { recur:e.target.value })); }}><option value="interval">Every N days</option><option value="semimonthly">1st + 16th</option><option value="monthly">Monthly</option></select>{form.recur === 'interval' && <input type="number" min="1" aria-label="Interval days" value={form.every} onChange={function(e){ setForm(Object.assign({}, form, { every:e.target.value })); }} />}<label className="ntl-until"><span>Until</span><input type="datetime-local" aria-label="Repeat until" value={form.until} onChange={function(e){ setForm(Object.assign({}, form, { until:e.target.value })); }} /></label></>}{form.type !== 'range' && <label className="ntl-align"><input type="checkbox" checked={form.align} onChange={function(e){ setForm(Object.assign({}, form, { align:e.target.checked })); }} />Align to reset (04:00)</label>}<button type="submit">{editingId ? 'Update' : 'Save'}</button>{editingId && <button type="button" onClick={function(){ setShowMarker(false); setEditingId(null); setForm({ label:'', color:'#8b9cff', type:'point', when:'', end:'', recur:'interval', every:'7', until:'', align:false }); }}>Cancel</button>}</form>}
    {payload.loading && <div className="ntl-status" role="status">Loading complete banner history…</div>}{payload.error && <div className="ntl-status error" role="alert">{payload.error}</div>}
    {!payload.loading && !payload.error && <>
      {search && <div className="ntl-results" aria-live="polite">{searchGroups.slice(0, 8).map(function(group){ return <button type="button" key={group.name} onClick={function(){ var hit = blocks.blocks.find(function(block){ return block.id === group.blockIds[0]; }); if (hit) { recenter(hit.startMs); setSelected(hit.id); setSelectedEventId(null); } }}>{group.name} — {group.count} {group.count === 1 ? 'run' : 'runs'}</button>; })}</div>}
      <div className="ntl-canvas" onPointerDown={pointerDown} onWheel={function(e){ panBy(-e.deltaX || -e.deltaY); }}>
        <NyxTimelineBands blocks={blocks.blocks} game={game} gameName={gameName} region={regionKey} view={view} msPerPx={msPerPx} width={width} /><div className="ntl-now" style={{ left:nyxTlMsToX(now, view.centerMs, msPerPx, width) }}><i>◆</i><span>Now</span></div>
        {layers.banners && <NyxBannerLane game={game} label="Character banners" blocks={visibleMatches} laneCount={blocks.laneCount} view={view} msPerPx={msPerPx} width={width} now={now} selected={selected} onSelect={function(block){ setSelected(block.id); setSelectedEventId(null); }} />}
        {layers.events && <div className="ntl-lane events" style={{ minHeight:Math.max(112, eventAxisLayout.laneCount * 104) }}><b>Events</b>{visibleEvents.map(function(block){ var x = nyxTlMsToX(block.startMs, view.centerMs, msPerPx, width), w = Math.max(78, (block.endMs - block.startMs) / msPerPx), status = nyxTlEventStatus(block, now), remaining = block.endMs - now, tag = block.expected ? 'Expected' : status === 'live' ? (remaining > 60 * NYX_TL_DAY_MS ? 'LIVE' : 'LIVE · ' + nyxTlCountdownLabel(remaining)) : status === 'ongoing' ? 'Ongoing' : status === 'upcoming' ? 'Upcoming' : 'Ended'; return <button type="button" key={block.id} className={'ntl-block event ' + status + (block.expected ? ' expected' : '') + (selectedEventId === block.id ? ' selected' : '')} title={block.expected ? block.title + ' · Expected dates' : block.title} style={{ left:x, top:32 + block.lane * 100, width:w }} onClick={function(e){ e.stopPropagation(); selectEvent(block.id); }}><span>{tag}</span><strong>{block.image && <img src={block.image} alt="" loading="lazy" />}{block.title}</strong></button>; })}</div>}
        {layers.activities && <div className="ntl-lane activities" style={{ minHeight:Math.max(58, 30 + activityLayout.laneCount * 26) }}><b>Activities</b>{activityLayout.blocks.map(function(activity){ return <a key={activity.id} className={'ntl-activity' + (activity.expected ? ' expected' : '')} href={activity.sourceUrl || undefined} target={activity.sourceUrl ? '_blank' : undefined} rel="noreferrer" title={activity.label + (activity.expected ? ' · Expected schedule' : ' · Exact schedule')} style={{ left:nyxTlMsToX(activity.start, view.centerMs, msPerPx, width), top:23 + activity.lane * 26, width:Math.max(12, (activity.end - activity.start) / msPerPx) }}>{activity.label}{activity.expected && <small>Expected</small>}</a>; })}</div>}
        {layers.custom && <div className="ntl-lane custom" style={{ minHeight:Math.max(58, 30 + markerLayout.laneCount * 31) }}><b>Personal</b>{markerLayout.blocks.map(function(marker){ var w = Math.max(NYX_TL_MARKER_MIN_PX, (marker.end - marker.start) / msPerPx); return <span key={marker.id} className={'ntl-marker' + (marker.timer.enabled === false ? ' off' : '')} title={marker.label} style={{ left:nyxTlMsToX(marker.start, view.centerMs, msPerPx, width), top:23 + marker.lane * 31, width:w, borderColor:marker.color, color:marker.color }}><button type="button" className="ntl-marker-label" title="Edit marker" onClick={function(){ editTimer(marker.timer); }}>{marker.label}</button><button type="button" className="ntl-marker-toggle" aria-pressed={marker.timer.enabled !== false} title={marker.timer.enabled === false ? 'Enable marker' : 'Disable marker'} onClick={function(){ toggleTimer(marker.timer.id); }}>{marker.timer.enabled === false ? '○' : '●'}</button><button type="button" className="ntl-marker-del" aria-label={'Remove ' + marker.label} title="Remove marker" onClick={function(){ deleteTimer(marker.timer.id); }}>×</button></span>; })}</div>}
        <NyxBottomDateRuler view={view} msPerPx={msPerPx} width={width} />
      </div>
      {layers.events && eventSplit.review.length > 0 && <div className="ntl-events-review">
        <b>Needs review — dates not yet confirmed ({eventSplit.review.length})</b>
        <div className="ntl-events-review-list">{eventSplit.review.map(function(block){ return <button type="button" key={block.id} className={'ntl-block event expected' + (selectedEventId === block.id ? ' selected' : '')} title={block.title} onClick={function(e){ e.stopPropagation(); selectEvent(block.id); }}><span>Expected</span><strong>{block.image && <img src={block.image} alt="" loading="lazy" />}{block.title}</strong></button>; })}</div>
      </div>}
      <div className="ntl-detail">{selectedEventBlock ? <>
        <div><span>{(selectedEventBlock.type || 'event')} · {selectedEventBlock.server || 'server unavailable'}</span><h2>{selectedEventBlock.title}</h2><p>{selectedEventBlock.expected ? 'Expected — dates not officially confirmed yet' : (viewDate(selectedEventBlock.startMs) + ' – ' + (selectedEventBlock.openEnd ? 'ongoing (until the next update)' : viewDate(selectedEventBlock.endMs)))}</p>{selectedEventBlock.description && <p>{selectedEventBlock.description}</p>}</div>
        <div><b>Status</b><p>{selectedEventBlock.expected ? 'Expected' : ({ review:'Needs review', ongoing:'Ongoing', live:'Live now', upcoming:'Upcoming', past:'Ended' }[nyxTlEventStatus(selectedEventBlock, now)])}</p>{selectedEventBlock.sourceUrl && <a href={selectedEventBlock.sourceUrl} target="_blank" rel="noreferrer">Source</a>}</div>
      </> : selectedBlock ? <>
        <div><span>{selectedBlock.version || 'Banner'} · {selectedBlock.region || 'time unavailable'}</span><h2>{selectedBlock.primaryFive || selectedBlock.name}</h2><p>{viewDate(selectedBlock.startMs, selectedBlock.dateOnly)} – {viewDate(selectedBlock.endMs, selectedBlock.dateOnly)} · {nyxTlViewDuration(selectedBlock.startMs, selectedBlock.endMs)}</p></div>
        <div><b>Featured</b><p>{selectedBlock.searchNames.join(', ') || 'No featured names published.'}</p>{selectedBlock.weaponNames.length > 0 && <p><b>Paired weapon:</b> {selectedBlock.weaponNames.join(', ')}</p>}{selectedBlock.sourceUrl && <a href={selectedBlock.sourceUrl} target="_blank" rel="noreferrer">Source</a>}</div>
      </> : <p>Select a banner run or event for its dates and source link.</p>}</div>
    </>}
  </section>;
}

// Hub events view: five fail-soft feeds on one shared axis. Banner notices are
// excluded by nyxTlBuildEventBlocks and undated rows stay in a separate bucket.
function CrossGameEventsTimeline({ games }){
  var rootRef = React.useRef(null), list = Array.isArray(games) ? games : [];
  var listKey = list.map(function(g){ return g.key; }).join(',');
  var timePreference = nyxTlUseTimePreference('nyx');
  var viewDate = function(ms, dateOnly, sourceGame){ return nyxTlViewDate(ms, dateOnly, timePreference, sourceGame); };
  var [now, setNow] = React.useState(Date.now()), [view, setView] = React.useState({ centerMs:Date.now(), zoom:NYX_TL_DEFAULT_ZOOM }), [width, setWidth] = React.useState(1000);
  var [jumpDate, setJumpDate] = React.useState(''), [search, setSearch] = React.useState(''), [selected, setSelected] = React.useState(null);
  var [perGame, setPerGame] = React.useState(function(){ var init={}; list.forEach(function(g){ init[g.key]={ loading:true, events:[], records:[], error:null }; }); return init; });
  React.useEffect(function(){
    var controller = new AbortController(), init={}; list.forEach(function(g){ init[g.key]={ loading:true, events:[], records:[], error:null }; }); setPerGame(init);
    list.forEach(function(g){ Promise.all([
      fetch('/data/events/' + nyxTlEventsFile(g.key) + '.json', { signal:controller.signal, credentials:'same-origin' }).then(function(r){ if(!r.ok) throw new Error('Events returned ' + r.status); return r.json(); }),
      fetch('/data/banner-history/' + g.key + '.json', { signal:controller.signal, credentials:'same-origin' }).then(function(r){ if(!r.ok) throw new Error('Banner history returned ' + r.status); return r.json(); }),
    ]).then(function(results){ var data=results[0],history=results[1]; if(!Array.isArray(data.events)||!Array.isArray(history.records)) throw new Error('Timeline feed is invalid'); setPerGame(function(old){ var next=Object.assign({},old); next[g.key]={loading:false,events:data.events,records:history.records,error:null}; return next; }); })
      .catch(function(error){ if(error.name==='AbortError') return; setPerGame(function(old){ var next=Object.assign({},old); next[g.key]={loading:false,events:[],records:[],error:error.message||'Could not load.'}; return next; }); }); });
    return function(){ controller.abort(); };
  },[listKey]);
  React.useEffect(function(){ var id=setInterval(function(){setNow(Date.now());},1000); return function(){clearInterval(id);}; },[]);
  React.useEffect(function(){ var el=rootRef.current;if(!el||!window.ResizeObserver)return undefined;var observer=new ResizeObserver(function(){setWidth(Math.max(320,el.clientWidth||320));});observer.observe(el);setWidth(Math.max(320,el.clientWidth||320));return function(){observer.disconnect();};},[]);
  var msPerPx=NYX_TL_MS_PER_PX, feeds={}, hubRegion=nyxTlRegionKey(timePreference && timePreference.serverRegion || 'na'); list.forEach(function(g){feeds[g.key]=(perGame[g.key]&&perGame[g.key].events)||[];});
  var grouped=nyxTlGroupEventsByGame(feeds,list,now).map(function(group){var state=perGame[group.gameKey]||{loading:true,events:[],error:null},game=list.find(function(g){return g.key===group.gameKey;})||{key:group.gameKey,name:group.gameName};var layout=nyxTlAssignSubLanes(group.axis,NYX_TL_BLOCK_MIN_PX*msPerPx),visible=nyxTlVisibleBlocks(layout.blocks,view.centerMs,msPerPx,width,600);if(search)visible=visible.filter(function(b){return String(b.title||'').toLowerCase().includes(search.trim().toLowerCase());});return {game:game,state:state,allBlocks:group.allBlocks,review:group.review,blocks:visible,laneCount:layout.laneCount};});
  var matches=[], review=[]; grouped.forEach(function(group){group.review.forEach(function(block){review.push({game:group.game,block:block});});if(search.trim())group.allBlocks.forEach(function(block){if(String(block.title||'').toLowerCase().includes(search.trim().toLowerCase()))matches.push({game:group.game,block:block});});});
  var anyLoading=grouped.some(function(group){return group.state.loading;});
  var scheduleGroups=list.map(function(g){ return { gameKey:g.key, gameName:g.name, blocks:nyxTlBuildBlocks((perGame[g.key]&&perGame[g.key].records)||[],hubRegion) }; });
  var selectedBlock=null,selectedGame=null;if(selected){var lane=grouped.find(function(g){return g.game.key===selected.gameKey;});if(lane){selectedBlock=lane.allBlocks.find(function(b){return b.id===selected.blockId;})||null;selectedGame=lane.game;}}
  function recenter(ms){setView(function(old){return {centerMs:ms,zoom:old.zoom};});} function panBy(px){setView(function(old){return {centerMs:old.centerMs-px*NYX_TL_MS_PER_PX,zoom:old.zoom};});}
  function pointerDown(event){var x=event.clientX,center=view.centerMs;function move(e){setView(function(old){return {centerMs:center-(e.clientX-x)*NYX_TL_MS_PER_PX,zoom:old.zoom};});}function up(){window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);}window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);}
  return <section className="ntl ntl-xgame" ref={rootRef} aria-label="Cross-game events timeline">
    <div className="ntl-tools"><label className="ntl-search"><span>Search all events</span><input type="search" value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="Event name" /></label><button type="button" onClick={function(){recenter(Date.now());}}>Today</button><label className="ntl-jump"><span>Jump to date</span><input type="date" value={jumpDate} onChange={function(e){setJumpDate(e.target.value);var at=Date.parse(e.target.value+'T12:00:00');if(Number.isFinite(at))recenter(at);}} /></label></div>
    {anyLoading&&<div className="ntl-status" role="status">Loading event history…</div>}
    {search&&<div className="ntl-results" aria-live="polite">{matches.slice(0,12).map(function(row){return <button type="button" key={row.game.key+':'+row.block.id} onClick={function(){if(row.block.startMs!==null)recenter(row.block.startMs);setSelected({gameKey:row.game.key,blockId:row.block.id});}}>{row.block.title} - {row.game.name}</button>;})}{!matches.length&&<span>No events found.</span>}</div>}
    <div className="ntl-canvas" onPointerDown={pointerDown} onWheel={function(e){panBy(-e.deltaX||-e.deltaY);}}><NyxTimelineBands groups={scheduleGroups} region={hubRegion} view={view} msPerPx={msPerPx} width={width} /><div className="ntl-now" style={{left:nyxTlMsToX(now,view.centerMs,msPerPx,width)}}><i>◆</i><span>Now</span></div>{grouped.map(function(group){return group.state.error?<div className="ntl-lane events" key={group.game.key} style={{minHeight:112}}><b>{group.game.icon&&<img src={group.game.icon} alt="" className="ntl-lane-icon"/>}{group.game.name}</b><div className="ntl-xgame-error">{group.game.name}: {group.state.error}</div></div>:<NyxEventLane key={group.game.key} label={group.game.name} icon={group.game.icon} blocks={group.blocks} laneCount={group.laneCount} view={view} msPerPx={msPerPx} width={width} now={now} selected={selected&&selected.gameKey===group.game.key?selected.blockId:null} onSelect={function(block){setSelected({gameKey:group.game.key,blockId:block.id});}}/>;})}<NyxBottomDateRuler view={view} msPerPx={msPerPx} width={width} /></div>
    {review.length>0&&<div className="ntl-events-review"><b>Needs review - dates not yet confirmed ({review.length})</b><div className="ntl-events-review-list">{review.map(function(row){return <button type="button" key={row.game.key+':'+row.block.id} className={'ntl-block event expected'+(selected&&selected.gameKey===row.game.key&&selected.blockId===row.block.id?' selected':'')} onClick={function(){setSelected({gameKey:row.game.key,blockId:row.block.id});}}><span>{row.game.name}</span><strong>{row.block.image&&<img src={row.block.image} alt="" loading="lazy"/>}{row.block.title}</strong></button>;})}</div></div>}
    <div className="ntl-detail">{selectedBlock?<><div><span>{selectedGame.name} - {selectedBlock.type||'event'}</span><h2>{selectedBlock.title}</h2><p>{selectedBlock.expected?'Expected — dates are not officially confirmed yet':viewDate(selectedBlock.startMs,false,selectedGame.key)+' - '+(selectedBlock.openEnd?'ongoing (until the next update)':viewDate(selectedBlock.endMs,false,selectedGame.key))}</p>{selectedBlock.description&&<p>{selectedBlock.description}</p>}</div><div><b>Status</b><p>{selectedBlock.expected?'Expected':{review:'Needs review',ongoing:'Ongoing',live:'Live now',upcoming:'Upcoming',past:'Ended'}[nyxTlEventStatus(selectedBlock,now)]}</p>{selectedBlock.sourceUrl&&<a href={selectedBlock.sourceUrl} target="_blank" rel="noreferrer">Source</a>}</div></>:<p>Select an event for its dates and official source link.</p>}</div>
  </section>;
}

// ============================================================
// Cross-game banner timeline (nyx-0031, plan M4) — the hub's "Banners" tab.
// All configured games' banner lanes stacked on ONE shared time axis. Reuses
// the exact same pure axis/lane maths as the per-game BannerTimeline
// (nyxTlMsToX/xToMs, NYX_TL_ZOOM_LEVELS, nyxTlBuildBlocks, nyxTlAssignSubLanes,
// nyxTlVisibleBlocks, nyxTlSearchMatch) and the shared NyxBannerLane renderer
// above — nothing about pan/zoom/region/lane logic is forked here.
//
// Deliberately BANNER LANES ONLY. A cross-game EVENTS lane belongs here per
// the plan but depends on Workstream N's events pipeline, which is still
// under review in another batch — see the stub placeholder in the JSX below.
// This view never fetches /data/events/* or /data/activities/*.
//
// `games` is an explicit prop (e.g. SIM_GAMES: [{key,name,icon}]) rather than
// a baked-in list, so the component stays parameterized per plan M4.
function CrossGameBannerTimeline({ games }){
  var rootRef = React.useRef(null);
  var list = Array.isArray(games) ? games : [];
  var listKey = list.map(function(g){ return g.key; }).join(',');
  var timePreference = nyxTlUseTimePreference('nyx');
  var viewDate = function(ms, dateOnly, sourceGame){ return nyxTlViewDate(ms, dateOnly, timePreference, sourceGame); };
  var [now, setNow] = React.useState(Date.now());
  var [view, setView] = React.useState({ centerMs:Date.now(), zoom:NYX_TL_DEFAULT_ZOOM });
  var [width, setWidth] = React.useState(1000);
  var [search, setSearch] = React.useState('');
  var [selected, setSelected] = React.useState(null); // { gameKey, blockId }
  var [region, setRegion] = React.useState(function(){ return (typeof loadResetRegion === 'function' ? loadResetRegion('nyx') : 'na'); });
  var [jumpDate, setJumpDate] = React.useState('');
  var [perGame, setPerGame] = React.useState(function(){
    var init = {};
    list.forEach(function(g){ init[g.key] = { loading:true, records:[], updated:null, error:null }; });
    return init;
  });

  React.useEffect(function(){ return (typeof subscribeResetRegion === 'function') ? subscribeResetRegion('nyx', setRegion) : undefined; }, []);
  React.useEffect(function(){
    var controller = new AbortController();
    setPerGame(function(){
      var init = {};
      list.forEach(function(g){ init[g.key] = { loading:true, records:[], updated:null, error:null }; });
      return init;
    });
    list.forEach(function(g){
      fetch('/data/banner-history/' + g.key + '.json', { signal:controller.signal, credentials:'same-origin' })
        .then(function(r){ if (!r.ok) throw new Error('Banner history returned ' + r.status); return r.json(); })
        .then(function(history){
          if (!Array.isArray(history.records)) throw new Error('Banner history is invalid');
          setPerGame(function(old){ var next = Object.assign({}, old); next[g.key] = { loading:false, records:history.records, updated:history.generatedAt || history.dataTimestamp || null, error:null }; return next; });
        })
        // Fail soft per game — one broken/missing feed degrades to an empty
        // lane for that game only, never blanks the whole cross-game view.
        .catch(function(error){
          if (error.name === 'AbortError') return;
          setPerGame(function(old){ var next = Object.assign({}, old); next[g.key] = { loading:false, records:[], updated:null, error:error.message || 'Could not load.' }; return next; });
        });
    });
    return function(){ controller.abort(); };
  }, [listKey]);
  React.useEffect(function(){ var id = setInterval(function(){ setNow(Date.now()); }, 1000); return function(){ clearInterval(id); }; }, []);
  React.useEffect(function(){
    var el = rootRef.current; if (!el || !window.ResizeObserver) return undefined;
    var observer = new ResizeObserver(function(){ setWidth(Math.max(320, el.clientWidth || 320)); }); observer.observe(el); setWidth(Math.max(320, el.clientWidth || 320));
    return function(){ observer.disconnect(); };
  }, []);

  var regionKey = nyxTlRegionKey(region);
  var msPerPx = NYX_TL_MS_PER_PX;

  var gameLanes = list.map(function(g){
    var state = perGame[g.key] || { loading:true, records:[], updated:null, error:null };
    var built = nyxTlBuildBlocks(state.records, regionKey);
    var laned = nyxTlAssignSubLanes(built, NYX_TL_BLOCK_MIN_PX * msPerPx);
    var visible = nyxTlVisibleBlocks(laned.blocks, view.centerMs, msPerPx, width, 600);
    var matches = search ? visible.filter(function(block){ return nyxTlSearchMatch(block, search).match; }) : visible;
    return { game:g, state:state, laneCount:laned.laneCount, allBlocks:laned.blocks, blocks:matches };
  });
  var anyLoading = gameLanes.some(function(gl){ return gl.state.loading; });
  var scheduleGroups = gameLanes.map(function(gl){ return { gameKey:gl.game.key, gameName:gl.game.name, blocks:gl.allBlocks }; });
  var searchResults = nyxTlCrossGameBannerSearch(gameLanes.map(function(gl){ return { gameKey:gl.game.key, gameName:gl.game.name, allBlocks:gl.allBlocks }; }), search);

  var selectedBlock = null, selectedGame = null;
  if (selected) {
    for (var i = 0; i < gameLanes.length; i++) {
      if (gameLanes[i].game.key !== selected.gameKey) continue;
      var hit = gameLanes[i].allBlocks.find(function(b){ return b.id === selected.blockId; });
      if (hit) { selectedBlock = hit; selectedGame = gameLanes[i].game; }
      break;
    }
  }

  function recenter(centerMs){ setView(function(old){ return { centerMs:centerMs, zoom:old.zoom }; }); }
  function panBy(px){ setView(function(old){ return { centerMs:old.centerMs - px * NYX_TL_MS_PER_PX, zoom:old.zoom }; }); }
  function pointerDown(event){
    var startX = event.clientX, startCenter = view.centerMs;
    function move(e){ setView(function(old){ return { centerMs:startCenter - (e.clientX - startX) * NYX_TL_MS_PER_PX, zoom:old.zoom }; }); }
    function up(){ window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  return <section className="ntl ntl-xgame" ref={rootRef} aria-label="Cross-game banner timeline">
    <div className="ntl-tools">
      <label className="ntl-search"><span>Search all banners</span><input type="search" value={search} onChange={function(e){ setSearch(e.target.value); }} placeholder="Character or weapon" /></label>
      <button type="button" onClick={function(){ recenter(Date.now()); }}>Today</button><label className="ntl-jump"><span>Jump to date</span><input type="date" value={jumpDate} onChange={function(e){ setJumpDate(e.target.value); var at = Date.parse(e.target.value + 'T12:00:00'); if (Number.isFinite(at)) recenter(at); }} /></label>    </div>
    {anyLoading && <div className="ntl-status" role="status">Loading complete banner history…</div>}
    {search && <div className="ntl-results" aria-live="polite">{searchResults.slice(0, 12).map(function(result){ return <button type="button" key={result.gameKey + ':' + result.blockId} onClick={function(){ recenter(result.startMs); setSelected({ gameKey:result.gameKey, blockId:result.blockId }); }}>{result.name} · {result.gameName} · {viewDate(result.startMs, false, result.gameKey)}</button>; })}{!searchResults.length && <span>No banner runs found.</span>}</div>}
    <div className="ntl-canvas" onPointerDown={pointerDown} onWheel={function(e){ panBy(-e.deltaX || -e.deltaY); }}><NyxTimelineBands groups={scheduleGroups} region={regionKey} view={view} msPerPx={msPerPx} width={width} />
      <div className="ntl-now" style={{ left:nyxTlMsToX(now, view.centerMs, msPerPx, width) }}><i>◆</i><span>Now</span></div>
      {gameLanes.map(function(gl){
        return gl.state.error
          ? <div className="ntl-lane banners" key={gl.game.key} style={{ minHeight:112 }}><b>{gl.game.icon && <img src={gl.game.icon} alt="" className="ntl-lane-icon" />}{gl.game.name}</b><div className="ntl-xgame-error">{gl.game.name}: {gl.state.error}</div></div>
          : <NyxBannerLane key={gl.game.key} game={gl.game.key} label={gl.game.name} icon={gl.game.icon} blocks={gl.blocks} laneCount={gl.laneCount} view={view} msPerPx={msPerPx} width={width} now={now} selected={selected && selected.gameKey === gl.game.key ? selected.blockId : null} onSelect={function(block){ setSelected({ gameKey:gl.game.key, blockId:block.id }); }} />;
      })}
      <NyxBottomDateRuler view={view} msPerPx={msPerPx} width={width} />
    </div>
    <div className="ntl-detail">{selectedBlock ? <><div><span>{selectedGame.name} · {selectedBlock.version || 'Banner'} · {selectedBlock.region || 'time unavailable'}</span><h2>{selectedBlock.primaryFive || selectedBlock.name}</h2><p>{viewDate(selectedBlock.startMs, selectedBlock.dateOnly, selectedGame.key)} – {viewDate(selectedBlock.endMs, selectedBlock.dateOnly, selectedGame.key)} · {nyxTlViewDuration(selectedBlock.startMs, selectedBlock.endMs)}</p></div><div><b>Featured</b><p>{selectedBlock.searchNames.join(', ') || 'No featured names published.'}</p>{selectedBlock.weaponNames.length > 0 && <p><b>Paired weapon:</b> {selectedBlock.weaponNames.join(', ')}</p>}{selectedBlock.sourceUrl && <a href={selectedBlock.sourceUrl} target="_blank" rel="noreferrer">Source</a>}</div></> : <p>Select a banner run for its dates and source link.</p>}</div>
  </section>;
}
