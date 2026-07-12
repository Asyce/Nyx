// Per-game banner timeline. Data is intentionally loaded only from the
// published /data runtime URLs; Database files are never fetched by the UI.
function nyxTlViewDate(ms, dateOnly){
  var d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return 'Time unavailable';
  var options = { month:'short', day:'numeric', year:'numeric' };
  // Date-only evidence is a published calendar date, not an instant to shift
  // through the viewer's timezone (which can turn Jul 9 into Jul 10).
  if (dateOnly) options.timeZone = 'UTC';
  return d.toLocaleDateString(undefined, options);
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
function nyxTlViewIcon(game, name){
  try {
    var roster = typeof getCmRoster === 'function' ? getCmRoster(game) : [];
    var row = roster.find(function(item){ return String(item.n || item.name || '').toLowerCase() === String(name || '').toLowerCase(); });
    return row && (row.icon || row.circle || row.card) || null;
  } catch (e) { return null; }
}

function BannerTimeline({ game, gameName }){
  var rootRef = React.useRef(null);
  var [payload, setPayload] = React.useState({ loading:true, records:[], activities:[], updated:null, error:null });
  var [region, setRegion] = React.useState(function(){ return (typeof loadResetRegion === 'function' ? loadResetRegion(game) : 'na'); });
  var [now, setNow] = React.useState(Date.now());
  var [view, setView] = React.useState(function(){ var saved = nyxTlDecodeHash(location.hash); return saved || { centerMs:Date.now(), zoom:NYX_TL_DEFAULT_ZOOM }; });
  var [width, setWidth] = React.useState(1000);
  var [search, setSearch] = React.useState('');
  var [selected, setSelected] = React.useState(null);
  var [layersOpen, setLayersOpen] = React.useState(false);
  var [layers, setLayers] = React.useState({ banners:true, activities:true, custom:true, hidePast:false });
  var [timers, setTimers] = React.useState(function(){ return nyxLoadCustomTimersV2(game); });
  var [form, setForm] = React.useState({ label:'', color:'#8b9cff', type:'point', when:'', end:'', recur:'interval', every:'7', until:'', align:false });
  var [showMarker, setShowMarker] = React.useState(false);
  var [editingId, setEditingId] = React.useState(null);
  var [jumpDate, setJumpDate] = React.useState('');
  var [copied, setCopied] = React.useState('');

  React.useEffect(function(){
    var controller = new AbortController();
    setPayload({ loading:true, records:[], activities:[], updated:null, error:null });
    Promise.all([
      fetch('/data/banner-history/' + game + '.json', { signal:controller.signal, credentials:'same-origin' }).then(function(r){ if (!r.ok) throw new Error('Banner history returned ' + r.status); return r.json(); }),
      fetch('/data/activities/' + game + '.json', { signal:controller.signal, credentials:'same-origin' }).then(function(r){ if (!r.ok) throw new Error('Activities returned ' + r.status); return r.json(); }).catch(function(){ return { activities:[] }; }),
    ]).then(function(results){
      var history = results[0], acts = results[1];
      if (!Array.isArray(history.records)) throw new Error('Banner history is invalid');
      setPayload({ loading:false, records:history.records, activities:Array.isArray(acts.activities) ? acts.activities : [], updated:history.generatedAt || history.dataTimestamp || null, error:null });
    }).catch(function(error){ if (error.name !== 'AbortError') setPayload({ loading:false, records:[], activities:[], updated:null, error:error.message || 'Timeline could not be loaded.' }); });
    return function(){ controller.abort(); };
  }, [game]);
  React.useEffect(function(){ setTimers(nyxLoadCustomTimersV2(game)); setRegion(typeof loadResetRegion === 'function' ? loadResetRegion(game) : 'na'); }, [game]);
  // Single source of truth: re-read the shared timer store and the shared
  // server-region setting whenever the Reset Timers card (or another tab)
  // changes them, so the two surfaces never diverge (Sol findings #2, #6).
  React.useEffect(function(){ return nyxSubscribeCustomTimers(game, setTimers); }, [game]);
  React.useEffect(function(){ return (typeof subscribeResetRegion === 'function') ? subscribeResetRegion(game, setRegion) : undefined; }, [game]);
  React.useEffect(function(){ var id = setInterval(function(){ setNow(Date.now()); }, 1000); return function(){ clearInterval(id); }; }, []);
  React.useEffect(function(){
    var el = rootRef.current; if (!el || !window.ResizeObserver) return undefined;
    var observer = new ResizeObserver(function(){ setWidth(Math.max(320, el.clientWidth || 320)); }); observer.observe(el); setWidth(Math.max(320, el.clientWidth || 320));
    return function(){ observer.disconnect(); };
  }, []);

  var regionKey = nyxTlRegionKey(region);
  var msPerPx = NYX_TL_ZOOM_LEVELS[view.zoom];
  var builtBlocks = React.useMemo(function(){ return nyxTlBuildBlocks(payload.records, regionKey); }, [payload.records, regionKey]);
  // Assign sub-lanes from the ACTUAL rendered card extent (min-width
  // inflated to NYX_TL_BLOCK_MIN_PX * msPerPx), so min-width cards never
  // overlap at coarse zoom levels (Sol finding #5). Re-runs on zoom change.
  var blocks = React.useMemo(function(){ return nyxTlAssignSubLanes(builtBlocks, NYX_TL_BLOCK_MIN_PX * msPerPx); }, [builtBlocks, msPerPx]);
  var rangeStart = nyxTlXToMs(-600, view.centerMs, msPerPx, width);
  var rangeEnd = nyxTlXToMs(width + 600, view.centerMs, msPerPx, width);
  var visible = nyxTlVisibleBlocks(blocks.blocks, view.centerMs, msPerPx, width, 600).filter(function(block){ return !layers.hidePast || block.endMs >= now; });
  var activities = layers.activities ? nyxTlExpandActivities(payload.activities, rangeStart, rangeEnd, regionKey) : [];
  var activityLayout = nyxTlAssignSubLanes(activities, 12 * msPerPx);
  var markers = layers.custom ? nyxTlViewMarkerInstances(timers, rangeStart, rangeEnd) : [];
  var markerLayout = nyxTlAssignSubLanes(markers, NYX_TL_MARKER_MIN_PX * msPerPx);
  var ribbons = nyxTlVersionRibbons(visible);
  var searchGroups = nyxTlSearchGroups(blocks.blocks, search);
  var visibleMatches = search ? visible.filter(function(block){ return nyxTlSearchMatch(block, search).match; }) : visible;
  var selectedBlock = selected && blocks.blocks.find(function(block){ return block.id === selected; });
  function recenter(centerMs){ setView(function(old){ return { centerMs:centerMs, zoom:old.zoom }; }); }
  function panBy(px){ setView(function(old){ return { centerMs:old.centerMs - px * NYX_TL_ZOOM_LEVELS[old.zoom], zoom:old.zoom }; }); }
  function zoomBy(delta){ setView(function(old){ return { centerMs:old.centerMs, zoom:Math.max(0, Math.min(NYX_TL_ZOOM_LEVELS.length - 1, old.zoom + delta)) }; }); }
  function pointerDown(event){
    var startX = event.clientX, startCenter = view.centerMs;
    function move(e){ setView(function(old){ return { centerMs:startCenter - (e.clientX - startX) * NYX_TL_ZOOM_LEVELS[old.zoom], zoom:old.zoom }; }); }
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
        flash(ok ? 'Link copied' : 'Copy failed — copy the URL');
      } catch (e) { flash('Copy failed — copy the URL'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function(){ flash('Link copied'); }, function(){ fallback(); });
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
  return <section className="ntl" ref={rootRef} aria-label={gameName + ' banner timeline'}>
    <header className="ntl-head"><div><span className="eyebrow">Banner history</span><h1>{gameName} Timeline</h1></div>{payload.updated && <span className="ntl-updated">Updated {nyxTlViewDate(Date.parse(payload.updated))}</span>}</header>
    <div className="ntl-tools">
      <label className="ntl-search"><span>Search all banners</span><input type="search" value={search} onChange={function(e){ setSearch(e.target.value); }} placeholder="Character or weapon" /></label>
      <div className="ntl-regions" aria-label="Banner server region">{['na','eu','asia'].map(function(key){ return <button type="button" key={key} className={region === key ? 'on' : ''} aria-pressed={region === key} onClick={function(){ setRegion(key); if (typeof saveResetRegion === 'function') saveResetRegion(game, key); else try { localStorage.setItem(resetRegionStorageKey(game), key); } catch (e) {} }}>{RESET_REGIONS[key].short}</button>; })}</div>
      <button type="button" onClick={function(){ recenter(Date.now()); }}>Today</button><label className="ntl-jump"><span>Jump to date</span><input type="date" value={jumpDate} onChange={function(e){ setJumpDate(e.target.value); var at = Date.parse(e.target.value + 'T12:00:00'); if (Number.isFinite(at)) recenter(at); }} /></label><button type="button" aria-label="Zoom out" onClick={function(){ zoomBy(-1); }}>−</button><button type="button" aria-label="Zoom in" onClick={function(){ zoomBy(1); }}>+</button>
      <button type="button" onClick={function(){ if (showMarker) { setShowMarker(false); setEditingId(null); } else { setEditingId(null); setForm({ label:'', color:'#8b9cff', type:'point', when:'', end:'', recur:'interval', every:'7', until:'', align:false }); setShowMarker(true); } }}>Add marker</button><button type="button" onClick={copyView}>Copy link</button>{copied && <span className="ntl-copied" role="status" aria-live="polite">{copied}</span>}
      <div className="ntl-layers"><button type="button" aria-expanded={layersOpen} onClick={function(){ setLayersOpen(!layersOpen); }}>Layers</button>{layersOpen && <div className="ntl-popover">{[['banners','Character banners'],['activities','Activities'],['custom','Custom planning'],['hidePast','Hide past banners']].map(function(item){ return <label key={item[0]}><input type="checkbox" checked={layers[item[0]]} onChange={function(e){ var next = Object.assign({}, layers); next[item[0]] = e.target.checked; setLayers(next); }} />{item[1]}</label>; })}</div>}</div>
    </div>
    {showMarker && <form className="ntl-marker-form" onSubmit={saveMarker}><input required maxLength="42" value={form.label} placeholder="Marker label" onChange={function(e){ setForm(Object.assign({}, form, { label:e.target.value })); }} /><input type="color" aria-label="Marker color" value={form.color} onChange={function(e){ setForm(Object.assign({}, form, { color:e.target.value })); }} /><select aria-label="Marker type" value={form.type} onChange={function(e){ setForm(Object.assign({}, form, { type:e.target.value })); }}><option value="point">Exact moment</option><option value="range">Range</option><option value="recurring">Recurring</option></select><input required type="datetime-local" aria-label={form.type === 'range' ? 'Start' : 'When'} value={form.when} onChange={function(e){ setForm(Object.assign({}, form, { when:e.target.value })); }} />{form.type === 'range' && <input required type="datetime-local" aria-label="End" value={form.end} onChange={function(e){ setForm(Object.assign({}, form, { end:e.target.value })); }} />}{form.type === 'recurring' && <><select aria-label="Recurrence" value={form.recur} onChange={function(e){ setForm(Object.assign({}, form, { recur:e.target.value })); }}><option value="interval">Every N days</option><option value="semimonthly">1st + 16th</option><option value="monthly">Monthly</option></select>{form.recur === 'interval' && <input type="number" min="1" aria-label="Interval days" value={form.every} onChange={function(e){ setForm(Object.assign({}, form, { every:e.target.value })); }} />}<label className="ntl-until"><span>Until</span><input type="datetime-local" aria-label="Repeat until" value={form.until} onChange={function(e){ setForm(Object.assign({}, form, { until:e.target.value })); }} /></label></>}{form.type !== 'range' && <label className="ntl-align"><input type="checkbox" checked={form.align} onChange={function(e){ setForm(Object.assign({}, form, { align:e.target.checked })); }} />Align to reset (04:00)</label>}<button type="submit">{editingId ? 'Update' : 'Save'}</button>{editingId && <button type="button" onClick={function(){ setShowMarker(false); setEditingId(null); setForm({ label:'', color:'#8b9cff', type:'point', when:'', end:'', recur:'interval', every:'7', until:'', align:false }); }}>Cancel</button>}</form>}
    {payload.loading && <div className="ntl-status" role="status">Loading complete banner history…</div>}{payload.error && <div className="ntl-status error" role="alert">{payload.error}</div>}
    {!payload.loading && !payload.error && <>
      {search && <div className="ntl-results" aria-live="polite">{searchGroups.slice(0, 8).map(function(group){ return <button type="button" key={group.name} onClick={function(){ var hit = blocks.blocks.find(function(block){ return block.id === group.blockIds[0]; }); if (hit) { recenter(hit.startMs); setSelected(hit.id); } }}>{group.name} — {group.count} {group.count === 1 ? 'run' : 'runs'}</button>; })}</div>}
      <div className="ntl-canvas" onPointerDown={pointerDown} onWheel={function(e){ if (e.ctrlKey) { e.preventDefault(); zoomBy(e.deltaY > 0 ? -1 : 1); } else { panBy(-e.deltaX || -e.deltaY); } }}>
        <div className="ntl-ribbons">{ribbons.map(function(ribbon){ return <span key={ribbon.version} style={{ left:nyxTlMsToX(ribbon.startMs, view.centerMs, msPerPx, width), width:Math.max(28, (ribbon.endMs - ribbon.startMs) / msPerPx) }}>{ribbon.version}</span>; })}</div><div className="ntl-now" style={{ left:nyxTlMsToX(now, view.centerMs, msPerPx, width) }}><i>◆</i><span>Now</span></div>
        {layers.banners && <div className="ntl-lane banners" style={{ minHeight:Math.max(112, blocks.laneCount * 104) }}><b>Character banners</b>{visibleMatches.map(function(block){ var x = nyxTlMsToX(block.startMs, view.centerMs, msPerPx, width), w = Math.max(78, (block.endMs - block.startMs) / msPerPx), state = block.startMs <= now && block.endMs >= now ? ' live' : (block.endMs < now ? ' past' : ''), icon = nyxTlViewIcon(game, block.primaryFive), tag = block.expected ? 'Expected' : (state === ' live' ? 'LIVE · ' + nyxTlCountdownLabel(block.endMs - now) : block.version || 'Banner'); return <button type="button" key={block.id} className={'ntl-block' + state + (block.expected ? ' expected' : '') + (selected === block.id ? ' selected' : '')} title={block.expected ? 'Educated guess — dates not officially confirmed yet' : block.name} style={{ left:x, top:32 + block.lane * 100, width:w }} onClick={function(e){ e.stopPropagation(); setSelected(block.id); }}><span>{tag}</span><strong>{icon && <img src={icon} alt="" loading="lazy" />}{block.primaryFive || block.name}</strong>{block.weaponPrimary && <small>Weapon: {block.weaponPrimary}</small>}</button>; })}</div>}
        {layers.activities && <div className="ntl-lane activities" style={{ minHeight:Math.max(58, 30 + activityLayout.laneCount * 26) }}><b>Activities</b>{activityLayout.blocks.map(function(activity){ return <a key={activity.id} className="ntl-activity" href={activity.sourceUrl || undefined} target={activity.sourceUrl ? '_blank' : undefined} rel="noreferrer" title={activity.label} style={{ left:nyxTlMsToX(activity.start, view.centerMs, msPerPx, width), top:23 + activity.lane * 26, width:Math.max(12, (activity.end - activity.start) / msPerPx) }}>{activity.label}</a>; })}</div>}
        {layers.custom && <div className="ntl-lane custom" style={{ minHeight:Math.max(58, 30 + markerLayout.laneCount * 31) }}><b>Custom planning</b>{markerLayout.blocks.map(function(marker){ var w = Math.max(NYX_TL_MARKER_MIN_PX, (marker.end - marker.start) / msPerPx); return <span key={marker.id} className={'ntl-marker' + (marker.timer.enabled === false ? ' off' : '')} title={marker.label} style={{ left:nyxTlMsToX(marker.start, view.centerMs, msPerPx, width), top:23 + marker.lane * 31, width:w, borderColor:marker.color, color:marker.color }}><button type="button" className="ntl-marker-label" title="Edit marker" onClick={function(){ editTimer(marker.timer); }}>{marker.label}</button><button type="button" className="ntl-marker-toggle" aria-pressed={marker.timer.enabled !== false} title={marker.timer.enabled === false ? 'Enable marker' : 'Disable marker'} onClick={function(){ toggleTimer(marker.timer.id); }}>{marker.timer.enabled === false ? '○' : '●'}</button><button type="button" className="ntl-marker-del" aria-label={'Remove ' + marker.label} title="Remove marker" onClick={function(){ deleteTimer(marker.timer.id); }}>×</button></span>; })}</div>}
      </div>
      <div className="ntl-detail">{selectedBlock ? <><div><span>{selectedBlock.version || 'Banner'} · {selectedBlock.region || 'time unavailable'}</span><h2>{selectedBlock.primaryFive || selectedBlock.name}</h2><p>{nyxTlViewDate(selectedBlock.startMs, selectedBlock.dateOnly)} – {nyxTlViewDate(selectedBlock.endMs, selectedBlock.dateOnly)} · {nyxTlViewDuration(selectedBlock.startMs, selectedBlock.endMs)}</p></div><div><b>Featured</b><p>{selectedBlock.searchNames.join(', ') || 'No featured names published.'}</p>{selectedBlock.weaponNames.length > 0 && <p><b>Paired weapon:</b> {selectedBlock.weaponNames.join(', ')}</p>}{selectedBlock.sourceUrl && <a href={selectedBlock.sourceUrl} target="_blank" rel="noreferrer">Source</a>}</div></> : <p>Select a banner run for its dates, featured characters and paired weapon.</p>}</div>
    </>}
  </section>;
}
