// ============================================================
// Nyx — universal gacha pull tracker (overlay)
// window.GachaTracker({ open, onClose, cfg })
//   cfg = { pull, pulls, currency, cost, fives:[], fours:[], key }
// Two phases: (1) import screen, (2) pull-history visualization.
// Imported data is generated + persisted per game in localStorage.
// ============================================================

function gtSimulate(cfg){
  const fivePool = (cfg.fives && cfg.fives.length) ? cfg.fives : ['Featured'];
  const fourPool = (cfg.fours && cfg.fours.length) ? cfg.fours : ['Four Star'];
  const total = 170 + Math.floor(Math.random() * 200);
  const now = Date.now();
  let pity5 = 0, pity4 = 0, guaranteed = false;
  const fives = [], stream = [];
  let fourCount = 0, threeCount = 0;
  for (let i = 1; i <= total; i++){
    pity5++; pity4++;
    let r5 = 0.006;
    if (pity5 > 73) r5 = 0.006 + (pity5 - 73) * 0.06;
    if (pity5 >= 90) r5 = 1;
    if (Math.random() < r5){
      const ff = !guaranteed;
      let won;
      if (guaranteed){ won = true; guaranteed = false; }
      else { won = Math.random() < 0.5; if (!won) guaranteed = true; }
      const name = won
        ? fivePool[0]
        : (fivePool.length > 1 ? fivePool[1 + Math.floor(Math.random() * (fivePool.length - 1))] : fivePool[0]);
      fives.push({ idx:i, pity:pity5, pity5:pity5, rank:5, won, ff, name, time:now - (total - i) * 90000 });
      stream.push(5); pity5 = 0; pity4 = 0;
    } else if (pity4 >= 10 || Math.random() < 0.051){
      fourCount++; stream.push(4); pity4 = 0;
    } else {
      threeCount++; stream.push(3);
    }
  }
  return { total, fives, fourCount, threeCount, currentPity:pity5, guaranteed,
           stream, ts:Date.now() };
}

function gtNormName(s){
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function gtTitleName(s){
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function gtFmtDate(ms){
  if (!ms) return 'Unknown time';
  try {
    return new Date(ms).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  } catch (e) {
    return 'Unknown time';
  }
}

function gtBg(src){
  if (!src) return undefined;
  return { backgroundImage:'url("' + String(src).replace(/"/g, '%22') + '")' };
}

function gtRosterMeta(gameKey, name){
  const key = gtNormName(name);
  if (!key) return null;
  try {
    if (window.NyxPulls && window.NyxPulls.itemIndex) {
      const ix = window.NyxPulls.itemIndex(gameKey);
      if (ix && ix.byName && ix.byName[key]) return ix.byName[key];
    }
  } catch (e) {}
  const cfg = (window.CM_CFG && window.CM_CFG[gameKey]) || null;
  const dbGame = window.NYX_DB && window.NYX_DB.games && window.NYX_DB.games[gameKey];
  const lists = [
    cfg && cfg.roster,
    cfg && cfg.chars,
    dbGame && dbGame.roster,
  ];
  for (const list of lists) {
    for (const ch of (list || [])) {
      const nm = ch.n || ch.name || ch.rawName;
      if (gtNormName(nm) === key) {
        return {
          name: nm,
          rarity: ch.r || ch.rarity,
          element: ch.el || ch.element,
          weaponType: ch.w || ch.weaponType,
          icon: ch.icon,
          art: ch.art || ch.overviewArt || ch.icon,
        };
      }
    }
  }
  return null;
}

function gtBannerType(key){
  return key === 'weapon' || key === 'lightcone' || key === 'wengine' || key === 'standard_wpn' ? 'weapon' : 'character';
}

function gtCurrentBannerPeriod(gameKey, bannerKey){
  const hist = (window.NYX_BANNERS && window.NYX_BANNERS[gameKey]) || [];
  if (!hist.length) return null;
  const type = gtBannerType(bannerKey);
  const periods = hist.filter((b) => b.type === type && Array.isArray(b.featured5) && b.featured5.length)
    .sort((a, b) => a.start - b.start);
  if (!periods.length) return null;
  const now = Date.now();
  const current = periods.filter((b) => now >= b.start && now <= b.end);
  if (current.length) return current[current.length - 1];
  const next = periods.find((b) => b.start > now);
  return next || periods[periods.length - 1];
}

function gtFeatureList(gameKey, bannerKey, fallbackFives){
  const period = gtCurrentBannerPeriod(gameKey, bannerKey);
  const names = period && period.featured5 && period.featured5.length
    ? period.featured5
    : (fallbackFives || []).slice().reverse().slice(0, 2).map((f) => f.name);
  return names.slice(0, 2).map((name) => {
    const meta = gtRosterMeta(gameKey, name) || {};
    return {
      name: meta.name || gtTitleName(name),
      icon: meta.icon || '',
      art: meta.art || meta.icon || '',
      element: meta.element || '',
      version: period && period.version,
      start: period && period.start,
      end: period && period.end,
      fourStars: period && period.featured4 ? period.featured4.map((n) => {
        const four = gtRosterMeta(gameKey, n) || {};
        return four.name || gtTitleName(n);
      }) : [],
    };
  });
}

function gtBannerPeriodForTime(gameKey, type, timeMs){
  const hist = (window.NYX_BANNERS && window.NYX_BANNERS[gameKey]) || [];
  if (!hist.length || !timeMs) return null;
  return hist.find((b) => b.type === type && timeMs >= b.start && timeMs <= b.end) || null;
}

function gtBannerPeriodLabel(gameKey, period){
  if (!period) return '';
  const featured = (period.featured5 || []).map((name) => {
    const meta = gtRosterMeta(gameKey, name) || {};
    return meta.name || gtTitleName(name);
  }).filter(Boolean);
  return featured.length ? featured.join(' / ') : (period.name || 'Limited banner');
}

function gtBannerTimelineType(key){
  if (key === 'character' || key === 'character2') return 'character';
  if (key === 'chronicled') return 'chronicled';
  if (key === 'weapon' || key === 'lightcone' || key === 'wengine' || key === 'standard_wpn') return 'weapon';
  return key || 'standard';
}

function gtPeriodForBannerKey(gameKey, key, timeMs){
  const type = gtBannerTimelineType(key);
  const direct = gtBannerPeriodForTime(gameKey, type, timeMs);
  if (direct) return direct;
  if (type === 'weapon') return gtBannerPeriodForTime(gameKey, 'character', timeMs);
  return null;
}

function gtCurrentLimitedFeatures(gameKey, fallbackFives){
  const hist = (window.NYX_BANNERS && window.NYX_BANNERS[gameKey]) || [];
  const now = Date.now();
  let periods = hist.filter((b) => b.type === 'character' && Array.isArray(b.featured5) && b.featured5.length && now >= b.start && now <= b.end);
  if (!periods.length) {
    const next = hist.find((b) => b.type === 'character' && Array.isArray(b.featured5) && b.featured5.length && b.start > now);
    if (next) periods = [next];
    else periods = hist.filter((b) => b.type === 'character' && Array.isArray(b.featured5) && b.featured5.length).slice(-1);
  }
  const cards = [];
  periods.slice(-1).forEach((period) => {
    (period.featured5 || []).slice(0, 2).forEach((name) => {
      const meta = gtRosterMeta(gameKey, name) || {};
      cards.push({
        name: meta.name || gtTitleName(name),
        icon: meta.icon || '',
        art: meta.art || meta.icon || '',
        version: period.version || '',
        start: period.start,
        end: period.end,
        fourStars: (period.featured4 || []).map((n) => {
          const four = gtRosterMeta(gameKey, n) || {};
          return { name: four.name || gtTitleName(n), icon: four.icon || '', art: four.art || four.icon || '' };
        }),
      });
    });
  });
  if (!cards.length) {
    (fallbackFives || []).slice(0, 2).forEach((f) => cards.push({
      name:f.name, icon:f.icon || '', art:f.art || f.icon || '', version:'', start:f.time || 0, end:f.time || 0, fourStars:[],
    }));
  }
  return cards.slice(0, 2);
}

function gtBannerKindLabel(key, label){
  if (key === 'weapon' || key === 'lightcone' || key === 'wengine' || key === 'standard_wpn') return 'Weapon';
  if (key === 'standard') return 'Standard';
  if (key === 'chronicled') return 'Chronicled';
  if (key === 'beginner') return 'Beginner';
  return label || 'Character';
}

function gtAllSourceGroups(banners, gameKey){
  return (banners || []).flatMap((banner) => {
    const fiveById = {};
    (banner.fives || []).forEach((five) => {
      const key = String(five.id || '') || (gtNormName(five.name) + ':' + (five.time || 0) + ':' + (five.pity || 0));
      fiveById[key] = five;
    });
    const periodGroups = {};
    (banner.items || []).forEach((item) => {
      const period = gtPeriodForBannerKey(gameKey, banner.key, item.time || 0);
      const source = String(item.sourceBanner || '').trim();
      const groupKey = period
        ? (banner.key + ':period:' + (period.start || 0) + ':' + (period.end || 0))
        : (banner.key + ':source:' + gtNormName(source || banner.label) + ':' + String(item.part || ''));
      const label = period ? gtBannerPeriodLabel(gameKey, period) : (source || banner.label);
      const rec = periodGroups[groupKey] || {
        key: groupKey,
        label: label,
        part: item.part || '',
        displayName: label + (period && period.version ? ' v' + period.version : ''),
        total: 0,
        fiveCount: 0,
        fourCount: 0,
        lastTime: 0,
        periodStart: period && period.start,
        periodEnd: period && period.end,
        periodVersion: period && period.version,
        periodName: period && period.name,
        items: [],
      };
      const fiveKey = String(item.id || '') || (gtNormName(item.name) + ':' + (item.time || 0) + ':' + (item.pity || item.pity5 || 0));
      const enriched = item.rank === 5 && fiveById[fiveKey] ? Object.assign({}, item, fiveById[fiveKey]) : item;
      rec.total += 1;
      if (item.rank === 5) rec.fiveCount += 1;
      if (item.rank === 4) rec.fourCount += 1;
      rec.lastTime = Math.max(rec.lastTime || 0, item.time || 0);
      rec.items.push(enriched);
      periodGroups[groupKey] = rec;
    });
    let groups = Object.values(periodGroups).map((rec) => {
      const newest = rec.items.slice().sort((a, b) => (b.time || 0) - (a.time || 0) || (b.idx || 0) - (a.idx || 0));
      return Object.assign({}, rec, {
        recent: newest.slice(0, 8),
        highlights: newest.filter((it) => it.rank >= 4).slice(0, 8),
      });
    });
    if (!groups.length) {
      groups = banner.sourceGroups && banner.sourceGroups.length
        ? banner.sourceGroups
        : [{ key:'fallback', label:banner.label, displayName:banner.label, total:banner.total || 0, fiveCount:(banner.fives || []).length, fourCount:banner.fourCount || 0, lastTime:(banner.history && banner.history[0] && banner.history[0].time) || 0, recent:(banner.history || []).slice(0, 8), highlights:(banner.history || []).filter((it) => it.rank >= 4).slice(0, 8), items:banner.items || [] }];
    }
    return groups.map((group) => Object.assign({}, group, {
      bannerKey: banner.key,
      bannerLabel: banner.label,
      bannerKind: gtBannerKindLabel(banner.key, banner.label),
      fives: (group.items || []).filter((it) => it.rank === 5),
    }));
  }).sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0) || (b.total || 0) - (a.total || 0));
}

function gtPairSourceGroups(gameKey, banners){
  const all = gtAllSourceGroups(banners, gameKey);
  const weapons = all.filter((g) => g.bannerKey === 'weapon' || g.bannerKey === 'lightcone' || g.bannerKey === 'wengine' || g.bannerKey === 'standard_wpn');
  const primary = all.filter((g) => !weapons.includes(g));
  const used = new Set();
  const rows = primary.map((group) => {
    const canPair = group.bannerKey === 'character' || group.bannerKey === 'chronicled';
    const pairedWeapons = weapons.filter((wg) => {
      if (!canPair) return false;
      if (used.has(wg.key)) return false;
      if (group.periodStart && wg.periodStart && group.periodStart === wg.periodStart) return true;
      if (group.periodStart && wg.lastTime && wg.lastTime >= group.periodStart && wg.lastTime <= (group.periodEnd || group.periodStart)) return true;
      return Math.abs((wg.lastTime || 0) - (group.lastTime || 0)) < 24 * 24 * 3600000;
    });
    pairedWeapons.forEach((wg) => used.add(wg.key));
    return Object.assign({}, group, { pairedWeapons });
  });
  weapons.filter((wg) => !used.has(wg.key)).forEach((wg) => rows.push(Object.assign({}, wg, { pairedWeapons:[] })));
  return rows.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0) || (b.total || 0) - (a.total || 0));
}

function gtMergeArchive(banners, kind){
  const merged = {};
  (banners || []).forEach((banner) => {
    (banner.archive || []).forEach((rec) => {
      if (kind && rec.kind !== kind) return;
      const key = rec.kind + ':' + gtNormName(rec.name || rec.itemId || rec.key);
      const out = merged[key] || Object.assign({}, rec, { copies:0, lastTime:0 });
      out.copies += rec.copies || 0;
      out.rank = Math.max(out.rank || 0, rec.rank || 0);
      out.rarity = Math.max(out.rarity || 0, rec.rarity || rec.rank || 0);
      out.lastTime = Math.max(out.lastTime || 0, rec.lastTime || 0);
      out.icon = out.icon || rec.icon || rec.art || '';
      out.art = out.art || rec.art || rec.icon || '';
      merged[key] = out;
    });
  });
  return Object.values(merged);
}

function gtCopyMark(rec){
  const copies = rec.copies || 0;
  if (rec.kind === 'weapon') {
    if (copies <= 5) return 'R' + Math.max(1, copies);
    return 'R5 +' + (copies - 5);
  }
  const c = Math.max(0, copies - 1);
  if (c <= 6) return 'C' + c;
  return 'C6 +' + (c - 6);
}

function gtSortArchive(list, sort){
  return list.slice().sort((a, b) => {
    if (sort === 'recent') return (b.lastTime || 0) - (a.lastTime || 0) || (b.copies || 0) - (a.copies || 0);
    if (sort === 'rarity') return (b.rank || 0) - (a.rank || 0) || (b.copies || 0) - (a.copies || 0) || String(a.name).localeCompare(String(b.name));
    if (sort === 'name') return String(a.name).localeCompare(String(b.name));
    return (b.copies || 0) - (a.copies || 0) || (b.rank || 0) - (a.rank || 0) || String(a.name).localeCompare(String(b.name));
  });
}

function gtPityBands(fives, soft, hard){
  const bands = [
    { key:'early', label:'Before soft pity', range:'1-' + Math.max(1, soft - 1), test:(p) => p < soft },
    { key:'soft', label:'At / beyond soft pity', range:String(soft) + '-' + hard, test:(p) => p >= soft },
  ];
  return bands.map((band) => Object.assign({}, band, { count:(fives || []).filter((f) => band.test(f.pity || 0)).length }));
}

function gtPullOutcome(five, banner, gameKey){
  if (banner && banner.ff) {
    if (five.ff) return five.won ? '50:50 win' : '50:50 loss';
    return 'Guaranteed';
  }
  const key = (banner && banner.key) || five.bannerKey || five.banner || '';
  const type = gtBannerTimelineType(key);
  if (type === 'weapon') return gameKey === 'gi' ? 'Weapon banner' : 'Weapon pool';
  if (type === 'standard' || key === 'beginner') return 'Standard pool';
  return 'Limited pool';
}

function gtPullOutcomeClass(five, banner){
  if (banner && banner.ff) {
    if (!five.ff) return 'guaranteed';
    return five.won ? 'fifty win' : 'fifty loss';
  }
  return 'pool';
}

function gtPityFilterMatch(five, banner, filter){
  const soft = (banner && banner.soft) || 74;
  if (filter === 'guaranteed') return banner && banner.ff && !five.ff;
  if (filter === 'fifty') return banner && banner.ff && !!five.ff;
  if (filter === 'early') return (five.pity || five.pity5 || 0) < soft;
  if (filter === 'soft') return (five.pity || five.pity5 || 0) >= soft;
  return true;
}

function gtPityDotClass(five, banner){
  const soft = (banner && banner.soft) || 74;
  const parts = ['gt-pity-dot2'];
  if ((five.pity || five.pity5 || 0) < soft) parts.push('early');
  else parts.push('soft');
  parts.push(gtPullOutcomeClass(five, banner).replace(/\s+/g, '-'));
  return parts.join(' ');
}

function gtHistoryRows(active, filter){
  const rows = (active.history && active.history.length
    ? active.history
    : (active.fives || []).slice().reverse().map((f) => Object.assign({ rank:5, pity5:f.pity, time:f.time || 0 }, f))
  ).slice();
  return rows.filter((row) => {
    if (filter === '5') return row.rank === 5;
    if (filter === '4') return row.rank === 4;
    if (filter === 'weapon') return row.isWeapon;
    return true;
  });
}

function gtRealUid(value){
  const s = String(value || '').trim();
  return /^\d{6,}$/.test(s) ? s : '';
}

function gtAccountLabel(data, uid, adapterLabel, fallbackName){
  const id = gtRealUid(uid || (data && data.uid));
  const rawName = String(
    (data && (data.accountName || data.nickname || data.name || data.profileName)) ||
    ''
  ).trim();
  let name = rawName;
  if (!name) {
    const stored = String((data && data.uid) || uid || '').trim();
    if (/paimon/i.test(stored)) name = 'Paimon.moe import';
    else if (/^imported$/i.test(stored)) name = 'Imported history';
    else name = adapterLabel ? (adapterLabel + ' account') : (fallbackName || 'Local history');
  }
  return id ? (name + ' · UID ' + id) : name;
}

function gtSourceBannerLabel(gameKey, row){
  const sourceKey = row.banner || row.bannerKey || '';
  const sourceType = gtBannerTimelineType(sourceKey);
  const source = String(row.sourceBanner || '').trim();
  if (sourceType === 'weapon') return source || row.bannerLabel || 'Weapon banner';
  if (sourceType === 'standard' || sourceKey === 'beginner') return source || row.bannerLabel || gtBannerKindLabel(sourceKey, row.bannerLabel);

  const period = gtPeriodForBannerKey(gameKey, sourceKey, row.time || 0);
  if (period && Array.isArray(period.featured5) && period.featured5.length) {
    const pulledName = gtNormName(row.name);
    const featured = period.featured5 || [];
    const pulledFeatured = featured.find((name) => gtNormName(name) === pulledName);
    if (pulledFeatured) {
      const meta = gtRosterMeta(gameKey, pulledFeatured) || {};
      return meta.name || gtTitleName(pulledFeatured);
    }
    if (sourceKey === 'character' || sourceKey === 'character2') {
      const raw = featured[sourceKey === 'character2' ? 1 : 0] || featured[0];
      const meta = gtRosterMeta(gameKey, raw) || {};
      return meta.name || gtTitleName(raw);
    }
    return period.name || gtBannerPeriodLabel(gameKey, period);
  }
  return source || row.bannerLabel || gtBannerKindLabel(sourceKey, row.bannerLabel);
}

function gtRenderPityPanel({ gameKey, pityBanners, pityFilter, setPityFilter, standalone }){
  return (
    <section className={'gt-panel-box gt-pity-observatory' + (standalone ? ' gt-pity-wide' : '')}>
      <div className="gt-box-head"><b>Pity observatory</b><span>Character / Weapon / Standard / Chronicled</span></div>
      <div className="gt-pity-filters" role="group" aria-label="Pity filters">
        {[
          ['all', 'All'],
          ['guaranteed', 'Guaranteed'],
          ['fifty', '50:50'],
          ['early', 'Early'],
          ['soft', 'Soft+'],
        ].map((pair) => <button key={pair[0]} type="button" className={pityFilter === pair[0] ? 'on' : ''} onClick={() => setPityFilter(pair[0])}>{pair[1]}</button>)}
      </div>
      <div className="gt-pity-lanes">
        {pityBanners.map((banner) => {
          const laneFives = (banner.fives || []).filter((five) => gtPityFilterMatch(five, banner, pityFilter));
          const hard = banner.hard || 90;
          const soft = banner.soft || 74;
          return (
            <div key={banner.key} className="gt-pity-lane">
              <div className="gt-pity-lane-label">
                <b>{banner.label}</b>
                <span>{laneFives.length}/{(banner.fives || []).length} shown</span>
              </div>
              <div className="gt-pity-track">
                <mark style={{ left:Math.min(100, (soft / hard) * 100) + '%' }}></mark>
                {laneFives.map((five, idx) => (
                  <i key={(five.id || idx) + ':' + five.name}
                     className={gtPityDotClass(five, banner)}
                     style={{ left:Math.max(2, Math.min(98, (((five.pity || five.pity5 || 0) / hard) * 100))) + '%' }}
                     title={five.name + ' / ' + gtPullOutcome(five, banner, gameKey) + ' / pity ' + (five.pity || five.pity5 || '-')}></i>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="gt-pity-legend">
        <span className="early">Early</span>
        <span className="soft">Soft+</span>
        <span className="guaranteed">Guaranteed</span>
        <span className="fifty">50:50</span>
      </div>
    </section>
  );
}

function gtRenderResultsView(ctx){
  const {
    banners, gameKey, bannerByKey, characterView, allFives, totalAll, eventFives, eventWins, eventLosses,
    avgPity, currentState, weaponView, currentLimited, bannerGroups, pityBanners, archiveRows, characterArchive,
    weaponArchive, archiveSort, archiveFilter, viewMode, expandedSource, pityFilter, setArchiveSort,
    setArchiveFilter, setViewMode, setExpandedSource, setPityFilter, fmt, PULLS, CUR, COST, accountLabel,
  } = ctx;
  const nextState = currentState === 'Guaranteed' ? 'Next: Guaranteed' : (currentState === '50:50' ? 'Next: 50:50' : 'Next: ' + currentState);
  const sinceLastFive = characterView ? (characterView.currentPity || 0) : 0;
  return (
    <div className="gt-results">
      <div className="gt-results-top">
        <div className="gt-mode-tabs" role="tablist" aria-label="Wish tracker views">
          <button type="button" className={viewMode === 'overview' ? 'on' : ''} onClick={() => setViewMode('overview')}>Overview</button>
          <button type="button" className={viewMode === 'pity' ? 'on' : ''} onClick={() => setViewMode('pity')}>Pity Observatory</button>
          <button type="button" className={viewMode === 'archive' ? 'on' : ''} onClick={() => setViewMode('archive')}>Archive</button>
        </div>
        <div className="gt-tab-status"><b>{nextState}</b><span>{fmt(sinceLastFive)} since last 5{'\u2605'}</span></div>
        <div className="gt-account">{accountLabel}</div>
      </div>

      {viewMode === 'overview' ? (
        <div className="gt-overview-grid">
          <section className="gt-panel-box gt-summary-card">
            <div className="gt-box-head"><b>Account summary</b><span>{fmt(allFives.length)} total 5{'\u2605'}</span></div>
            <div className="gt-summary-grid">
              <div><b>{fmt(totalAll)}</b><span>Total {PULLS}</span></div>
              <div><b>{fmt((characterView && characterView.total) || 0)}</b><span>Character {PULLS}</span></div>
              <div><b>{fmt((weaponView && weaponView.total) || 0)}</b><span>Weapon {PULLS}</span></div>
              <div><b>{fmt(totalAll * COST)}</b><span>{CUR} spent</span></div>
              <div><b>{eventWins}/{eventLosses}</b><span>50:50 W / L</span></div>
              <div><b>{avgPity || '--'}</b><span>Avg pity</span></div>
            </div>
          </section>

          <section className="gt-panel-box gt-current-limited">
            <div className="gt-box-head"><b>Current limited banners</b><span>{currentLimited.length || 0} active</span></div>
            <div className="gt-limited-grid">
              {currentLimited.map((card) => (
                <article key={card.name} className="gt-limited-card" style={(card.art || card.icon) ? gtBg(card.art || card.icon) : undefined}>
                  <div className="gt-limited-fade"></div>
                  <div className="gt-limited-copy">
                    <b>{card.name}</b>
                    <span>{card.version ? 'Version ' + card.version : gtFmtDate(card.start)}</span>
                  </div>
                  <div className="gt-limited-rateups">
                    {(card.fourStars || []).slice(0, 3).map((four) => <i key={four.name}>{four.name}</i>)}
                  </div>
                </article>
              ))}
              {currentLimited.length === 0 && <div className="gt-empty-row">No current limited banner metadata found.</div>}
            </div>
          </section>

          <section className="gt-panel-box gt-recent-pulls">
            <div className="gt-box-head"><b>5-Star pulls</b><span>All banners</span></div>
            <div className="gt-recent-five-list">
              {allFives.map((row) => {
                const b = bannerByKey[row.bannerKey] || { key:row.bannerKey, label:row.bannerLabel, soft:row.bannerSoft, hard:row.bannerHard, ff:row.bannerFf };
                const bannerName = gtSourceBannerLabel(gameKey, row);
                return (
                  <div key={(row.id || row.idx) + ':' + row.bannerKey + ':' + row.name} className="gt-recent-five-row">
                    {(row.icon || row.art) ? <img src={row.icon || row.art} alt="" loading="lazy" /> : <span className="gt-img-fallback"></span>}
                    <div>
                      <b>{row.name}</b>
                      <span>Banner: {bannerName} · {gtFmtDate(row.time)}</span>
                    </div>
                    <em className={gtPullOutcomeClass(row, b).replace(/\s+/g, '-')}>{gtPullOutcome(row, b, gameKey)}</em>
                    <i>Pity {row.pity || row.pity5 || '-'}</i>
                  </div>
                );
              })}
              {allFives.length === 0 && <div className="gt-empty-row">No 5-star pulls recorded yet.</div>}
            </div>
          </section>

          <section className="gt-panel-box gt-banner-history">
            <div className="gt-box-head"><b>Banner history</b><span>Click to expand</span></div>
            <div className="gt-banner-history-list">
              {bannerGroups.map((group) => {
                const openGroup = expandedSource === group.key;
                const groupBanner = bannerByKey[group.bannerKey] || { label:group.bannerLabel, ff:false };
                const paired = group.pairedWeapons || [];
                const detailFives = (group.fives || []).map((f) => Object.assign({ _banner:groupBanner, _source:group }, f))
                  .concat(paired.flatMap((wg) => (wg.fives || []).map((f) => Object.assign({ _banner:bannerByKey[wg.bannerKey] || { label:wg.bannerLabel, ff:false }, _source:wg }, f))))
                  .sort((a, b) => (b.time || 0) - (a.time || 0) || (b.idx || 0) - (a.idx || 0));
                return (
                  <article key={group.key} className={'gt-banner-history-row' + (openGroup ? ' open' : '')}>
                    <button type="button" onClick={() => setExpandedSource(openGroup ? '' : group.key)}>
                      <div className="gt-banner-history-main">
                        <b>{group.displayName || group.label}</b>
                        <span>{gtBannerKindLabel(group.bannerKey, group.bannerLabel)} / {gtFmtDate(group.lastTime)}</span>
                      </div>
                      <div className="gt-banner-history-meta">
                        <span>{fmt(group.total || 0)} {PULLS}</span>
                        <span>{group.fiveCount || 0}x 5{'\u2605'}</span>
                        <span>{group.fourCount || 0}x 4{'\u2605'}</span>
                      </div>
                    </button>
                    {paired.length > 0 && (
                      <div className="gt-paired-weapon">
                        {paired.map((wg) => <span key={wg.key}>Weapon pair: {wg.displayName || wg.label} ({fmt(wg.total || 0)} {PULLS})</span>)}
                      </div>
                    )}
                    {openGroup && (
                      <div className="gt-banner-history-detail">
                        {detailFives.map((five) => (
                          <div key={(five.id || five.idx) + ':' + five._source.key + ':' + five.name}>
                            {(five.icon || five.art) ? <img src={five.icon || five.art} alt="" loading="lazy" /> : <span className="gt-img-fallback"></span>}
                            <b>{five.name}</b>
                            <span>{five.isWeapon ? 'Weapon' : 'Character'} / {five._source.bannerKind}</span>
                            <em className={gtPullOutcomeClass(five, five._banner).replace(/\s+/g, '-')}>{gtPullOutcome(five, five._banner, gameKey)}</em>
                            <i>Pity {five.pity || five.pity5 || '-'}</i>
                          </div>
                        ))}
                        {detailFives.length === 0 && <div className="gt-empty-row">No 5-star pulls on this banner.</div>}
                      </div>
                    )}
                  </article>
                );
              })}
              {bannerGroups.length === 0 && <div className="gt-empty-row">No banner history rows yet.</div>}
            </div>
          </section>
        </div>
      ) : viewMode === 'pity' ? (
        <div className="gt-pity-view">
          {gtRenderPityPanel({ gameKey, pityBanners, pityFilter, setPityFilter, standalone:true })}
        </div>
      ) : (
        <div className="gt-archive-view">
          <section className="gt-panel-box gt-archive-console">
            <div className="gt-box-head"><b>Archive console</b><span>{archiveRows.length} entries</span></div>
            <div className="gt-archive-tools">
              <select value={archiveSort} onChange={(e) => setArchiveSort(e.target.value)} aria-label="Sort archive">
                <option value="copies">Most copies</option>
                <option value="recent">Most recent</option>
                <option value="rarity">Rarity</option>
                <option value="name">Name</option>
              </select>
              <div className="gt-filter-pills" role="group" aria-label="Archive filter">
                {[
                  ['all', 'All'],
                  ['c6', 'C6/R5+'],
                  ['5', '5\u2605'],
                  ['4', '4\u2605'],
                ].map((pair) => <button key={pair[0]} type="button" className={archiveFilter === pair[0] ? 'on' : ''} onClick={() => setArchiveFilter(pair[0])}>{pair[1]}</button>)}
              </div>
            </div>
            <div className="gt-archive-grid expanded">
              {archiveRows.map((rec) => (
                <article key={rec.key} className={'gt-archive-card r' + rec.rank}>
                  {(rec.icon || rec.art) ? <img src={rec.icon || rec.art} alt="" loading="lazy" /> : <span className="gt-img-fallback"></span>}
                  <b>{rec.name}</b>
                  <i>{gtCopyMark(rec)}</i>
                  <em>{rec.copies} copies</em>
                </article>
              ))}
              {archiveRows.length === 0 && <div className="gt-empty-row">No archive entries for this filter.</div>}
            </div>
          </section>
          <section className="gt-panel-box gt-archive-side">
            <div className="gt-box-head"><b>Copy overview</b><span>Characters / weapons</span></div>
            <div className="gt-total-strip archive">
              {characterArchive.concat(weaponArchive).map((rec) => (
                <div key={rec.key} className="gt-total-unit">
                  {(rec.icon || rec.art) ? <img src={rec.icon || rec.art} alt="" loading="lazy" /> : <span className="gt-img-fallback"></span>}
                  <b>{rec.name}</b>
                  <i>{gtCopyMark(rec)}</i>
                  <em>{rec.copies}</em>
                </div>
              ))}
              {characterArchive.length + weaponArchive.length === 0 && <div className="gt-empty-row">No copy totals yet.</div>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function GachaTracker({ open, onClose, cfg, inline }){
  const C = cfg || {};
  const PULL = C.pull || 'Wish';
  const PULLS = C.pulls || (PULL + 's');
  const TITLE = C.title || (PULL + ' Tracker');
  const CUR = C.currency || 'Primogems';
  const COST = C.cost || 160;
  const LSKEY = 'nyx-tracker-' + (C.key || 'gi');
  // Real importer for this game, when one is wired (Genshin today).
  // Unsupported games fall back to the sample simulator so their tabs
  // still render instead of breaking.
  const ADAPT = (window.NyxPulls && window.NyxPulls.adapterFor) ? window.NyxPulls.adapterFor(C.key || 'gi') : null;
  const STORE = window.NyxPullStore || null;

  const [phase, setPhase] = React.useState('import'); // import | loading | results
  const [data, setData] = React.useState(null);
  const [url, setUrl] = React.useState('');
  const [error, setError] = React.useState('');
  const [progress, setProgress] = React.useState(null);
  const [uid, setUid] = React.useState('');
  const [bannerIdx, setBannerIdx] = React.useState(0);
  const [archiveSort, setArchiveSort] = React.useState('copies');
  const [archiveFilter, setArchiveFilter] = React.useState('all');
  const [historyFilter, setHistoryFilter] = React.useState('all');
  const [viewMode, setViewMode] = React.useState('overview');
  const [expandedSource, setExpandedSource] = React.useState('');
  const [pityFilter, setPityFilter] = React.useState('all');
  const fileRef = React.useRef(null);

  // Wrap a single (sample/legacy) view into the multi-banner shape the
  // results renderer now expects.
  const wrapSim = (d) => ({ banners: [Object.assign({ key: 'character', label: 'Character', soft: 74, hard: 90, ff: true }, d)] });

  // On mount: prefer real imported history from IndexedDB; fall back to
  // the old localStorage sample cache so existing demos still load.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (ADAPT && STORE) {
          const uids = await STORE.loadAllUids(ADAPT.game);
          if (uids && uids.length) {
            const all = await STORE.loadPulls(ADAPT.game, uids[0]);
            if (!cancelled && all && all.length) {
              let summary = null;
              try { summary = STORE.loadSummary ? await STORE.loadSummary(ADAPT.game, uids[0]) : null; } catch (e) {}
              setData({ banners: ADAPT.buildViews(all, { cost: COST }), uid: uids[0], accountName:(summary && summary.accountName) || '' });
              setBannerIdx(0); setUid(uids[0]); setPhase('results'); return;
            }
          }
        }
      } catch (e) {}
      try {
        const raw = localStorage.getItem(LSKEY);
        if (!cancelled && raw){ setData(wrapSim(JSON.parse(raw))); setBannerIdx(0); setPhase('results'); }
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, [LSKEY]);

  // Sample data (the simulator) — used by "load sample" and as the
  // fallback for games whose real importer isn't wired yet.
  const runSample = () => {
    setError(''); setPhase('loading');
    setTimeout(() => {
      const d = gtSimulate(C);
      try { localStorage.setItem(LSKEY, JSON.stringify(d)); } catch (e) {}
      setData(wrapSim(d)); setBannerIdx(0); setPhase('results');
    }, 700);
  };

  // Real import: parse the pasted URL → walk every banner via the proxy
  // → persist → render the character-banner view.
  const runImport = async () => {
    if (!ADAPT || !STORE) { runSample(); return; }
    const auth = ADAPT.parseAuth(url);
    if (auth && auth.error) { setError(auth.error); return; }
    setError(''); setProgress(null); setPhase('loading');
    try {
      const res = await ADAPT.runImport(auth, (p) => setProgress(p));
      const accountName = res.accountName || res.nickname || res.name || '';
      await STORE.savePulls(ADAPT.game, res.uid, res.pulls, { accountName });
      const all = await STORE.loadPulls(ADAPT.game, res.uid);
      try { localStorage.removeItem(LSKEY); } catch (e) {}
      setData({ banners: ADAPT.buildViews(all, { cost: COST }), uid: res.uid, accountName });
      setBannerIdx(0); setUid(res.uid); setProgress(null); setPhase('results');
    } catch (e) {
      setError(String((e && e.message) || e || 'Import failed.'));
      setProgress(null); setPhase('import');
    }
  };

  // Import an existing UIGF file (Paimon.moe / Snap Hutao / stardb / …).
  const runImportFile = async (file) => {
    if (!file || !ADAPT || !STORE || (!ADAPT.importFile && !ADAPT.importExcel)) return;
    setError(''); setProgress(null); setPhase('loading');
    try {
      const isExcel = /\.xlsx$/i.test(file.name || '') || /spreadsheetml/i.test(file.type || '');
      let res;
      if (isExcel) {
        if (!ADAPT.importExcel) throw new Error('Excel import is not available for this game yet.');
        res = await ADAPT.importExcel(await file.arrayBuffer());
      } else {
        if (!ADAPT.importFile) throw new Error('JSON import is not available for this game yet.');
        res = ADAPT.importFile(JSON.parse(await file.text()));
      }
      if (!res || res.error) throw new Error((res && res.error) || 'Could not read that file.');
      if (!res.pulls || !res.pulls.length) throw new Error('No ' + (C.pulls || 'pulls').toLowerCase() + ' for this game in that file.');
      const id = res.uid || 'imported';
      const accountName = res.accountName || res.nickname || res.name || (/paimon/i.test(id) ? 'Paimon.moe import' : 'Imported history');
      await STORE.savePulls(ADAPT.game, id, res.pulls, { accountName });
      const all = await STORE.loadPulls(ADAPT.game, id);
      try { localStorage.removeItem(LSKEY); } catch (e) {}
      setData({ banners: ADAPT.buildViews(all, { cost: COST }), uid: id, accountName });
      setBannerIdx(0); setUid(id); setPhase('results');
    } catch (e) {
      setError('Import failed: ' + String((e && e.message) || e)); setPhase('import');
    }
  };

  const reset = async () => {
    try { localStorage.removeItem(LSKEY); } catch (e) {}
    try { if (ADAPT && STORE && uid) await STORE.clearImport(ADAPT.game, uid); } catch (e) {}
    setData(null); setUrl(''); setUid(''); setError(''); setProgress(null); setBannerIdx(0); setPhase('import');
  };

  const showImport = () => {
    setUrl('');
    setError('');
    setProgress(null);
    setPhase('import');
  };

  if (!inline && !open) return null;

  const fmt = (n) => n.toLocaleString('en-US');

  return (
    <div className={inline ? 'gt-inline' : 'gt-overlay'}
         onMouseDown={inline ? undefined : (e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gt-panel" data-screen-label={PULL + ' Tracker'}>
        <div className="gt-head">
          <span className="gt-dia"></span>
          <div className="gt-ttl">
            {phase === 'results'
              ? <button type="button" className="gt-title-import" onClick={showImport}>Import</button>
              : <div className="t">Import</div>}
          </div>
          <button type="button" className="gt-x" title="Close" onClick={onClose} style={{ display:inline ? 'none' : undefined }}>{'\u2715'}</button>
        </div>

        {phase !== 'results' && (
          <div className="gt-import">
            <ol className="gt-steps">
              <li><span className="n">1</span><div><b>Open your history</b><span>In {CUR === 'Primogems' ? 'Genshin' : 'the game'}, open the {PULL} history page so the feed URL is cached.</span></div></li>
              <li><span className="n">2</span><div><b>Copy the feed URL</b><span>{ADAPT ? 'Open PowerShell (Windows search → PowerShell) and run the command below — it copies your link to the clipboard.' : 'Run the helper command, then copy the ' + PULL.toLowerCase() + ' history link it prints.'}</span></div></li>
              <li><span className="n">3</span><div><b>Paste &amp; import</b><span>Drop the link below — Pengo&rsquo;s worker proxies it to the game to read every banner, and keeps nothing (no token, no history).</span></div></li>
            </ol>
            {ADAPT && ADAPT.helperCommand && (
              <div className="gt-cmd">
                <code>{ADAPT.helperCommand}</code>
                <button type="button" onClick={() => { try { navigator.clipboard.writeText(ADAPT.helperCommand); } catch (e) {} }}>Copy</button>
              </div>
            )}
            {ADAPT && ADAPT.safeScript && (
              <details className="gt-safe">
                <summary>Prefer not to run a remote command? Download &amp; verify instead</summary>
                <div className="gt-safe-body">
                  <p className="gt-safe-note">
                    The script only reads your local game cache to find the history link and copies it to your
                    clipboard — its one network call is a validation hit to the game&rsquo;s own API. Pengo&rsquo;s
                    worker then proxies the history request to the game provider and stores nothing: not your
                    authorization token, not your pull history.
                  </p>
                  <ol className="gt-safe-steps">
                    <li>
                      <b>Download</b>{' '}
                      <a href={ADAPT.safeScript.url} download>pengo-pulls.ps1</a>
                      {'  ·  '}
                      <a href={ADAPT.safeScript.url} target="_blank" rel="noopener noreferrer">view source</a>
                    </li>
                    <li>
                      <b>Verify</b> (optional) — the hash should match:
                      <div className="gt-cmd">
                        <code>Get-FileHash pengo-pulls.ps1 -Algorithm SHA256</code>
                        <button type="button" onClick={() => { try { navigator.clipboard.writeText('Get-FileHash pengo-pulls.ps1 -Algorithm SHA256'); } catch (e) {} }}>Copy</button>
                      </div>
                      <div className="gt-sha">SHA-256 <code>{ADAPT.safeScript.sha256}</code></div>
                    </li>
                    <li>
                      <b>Run</b> it in PowerShell:
                      <div className="gt-cmd">
                        <code>{'powershell -ExecutionPolicy Bypass -File pengo-pulls.ps1 -Game ' + ADAPT.game}</code>
                        <button type="button" onClick={() => { try { navigator.clipboard.writeText('powershell -ExecutionPolicy Bypass -File pengo-pulls.ps1 -Game ' + ADAPT.game); } catch (e) {} }}>Copy</button>
                      </div>
                    </li>
                  </ol>
                </div>
              </details>
            )}
            <div className="gt-urlrow">
              <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck="false"
                     placeholder={'https://\u2026 ' + PULL.toLowerCase() + ' history URL'} />
              <button type="button" className="gt-go" disabled={phase === 'loading'} onClick={runImport}>
                {phase === 'loading' ? <span className="gt-spin"></span> : 'Import'}
              </button>
            </div>
            {error && <div className="gt-err">{error}</div>}
            {phase === 'loading' && progress && (
              <div className="gt-prog">Importing {progress.bannerLabel}\u2026 {fmt(progress.fetched)} {PULLS.toLowerCase()}{progress.bannerTotal ? ' (' + (progress.bannerIndex + 1) + '/' + progress.bannerTotal + ')' : ''}</div>
            )}
            <button type="button" className="gt-sample" onClick={runSample} disabled={phase === 'loading'}>
              or load sample data {'\u2192'}
            </button>
            {ADAPT && (ADAPT.importFile || ADAPT.importExcel) && (
              <span>
                <input ref={fileRef} type="file" accept=".json,application/json,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display:'none' }}
                       onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; runImportFile(f); }} />
                <button type="button" className="gt-sample" disabled={phase === 'loading'}
                        onClick={() => { if (fileRef.current) fileRef.current.click(); }}>
                  or import JSON / Paimon.moe Excel {'\u2192'}
                </button>
              </span>
            )}
          </div>
        )}

        {phase === 'results' && data && data.banners && data.banners.length > 0 && (() => {
          const banners = data.banners;
          const gameKey = C.key || 'gi';
          const bannerByKey = {};
          banners.forEach((b) => { bannerByKey[b.key] = b; });
          const characterView = banners.find((b) => b.key === 'character') || banners[0];
          const weaponView = banners.find((b) => b.key === 'weapon' || b.key === 'lightcone' || b.key === 'wengine' || b.key === 'standard_wpn')
            || { key:'weapon', label:'Weapon', soft:63, hard:80, ff:false, total:0, fives:[] };
          const standardView = banners.find((b) => b.key === 'standard')
            || { key:'standard', label:'Standard', soft:74, hard:90, ff:false, total:0, fives:[] };
          const chronicledView = banners.find((b) => b.key === 'chronicled')
            || { key:'chronicled', label:'Chronicled', soft:74, hard:90, ff:true, total:0, fives:[] };
          const totalAll = banners.reduce((sum, b) => sum + (b.total || 0), 0);
          const allFives = banners.flatMap((b) => (b.fives || []).map((f) => Object.assign({}, f, {
            bannerKey:b.key,
            bannerLabel:b.label,
            bannerSoft:b.soft,
            bannerHard:b.hard,
            bannerFf:b.ff,
          })))
            .sort((a, b) => (b.time || 0) - (a.time || 0) || (b.idx || 0) - (a.idx || 0));
          const eventFives = (characterView && characterView.fives) || [];
          const fiftyEvents = eventFives.filter((f) => f.ff);
          const eventWins = fiftyEvents.filter((f) => f.won).length;
          const eventLosses = fiftyEvents.filter((f) => !f.won).length;
          const avgPity = allFives.length ? Math.round(allFives.reduce((sum, f) => sum + (f.pity || f.pity5 || 0), 0) / allFives.length) : 0;
          const currentState = characterView && characterView.ff ? (characterView.guaranteed ? 'Guaranteed' : '50:50') : 'Fixed pool';
          const currentLimited = gtCurrentLimitedFeatures(gameKey, eventFives.slice().reverse());
          const accountLabel = gtAccountLabel(data, uid, ADAPT && ADAPT.label, TITLE);
          const bannerGroups = gtPairSourceGroups(gameKey, banners);
          const pityBanners = [characterView, weaponView, standardView, chronicledView].filter(Boolean);
          const archiveBase = gtMergeArchive(banners);
          const archiveRows = gtSortArchive(archiveBase.filter((rec) => {
            if (archiveFilter === '5') return rec.rank === 5;
            if (archiveFilter === '4') return rec.rank === 4;
            if (archiveFilter === 'c6') return rec.kind === 'weapon' ? (rec.copies || 0) >= 5 : (rec.copies || 0) >= 7;
            return true;
          }), archiveSort);
          const characterArchive = gtSortArchive(gtMergeArchive(banners, 'character'), 'copies').slice(0, 10);
          const weaponArchive = gtSortArchive(gtMergeArchive(banners, 'weapon'), 'copies').slice(0, 8);
          return gtRenderResultsView({
            banners, gameKey, bannerByKey, characterView, allFives, totalAll, eventFives, eventWins, eventLosses,
            avgPity, currentState, weaponView, currentLimited, bannerGroups, pityBanners, archiveRows, characterArchive,
            weaponArchive, archiveSort, archiveFilter, viewMode, expandedSource, pityFilter, setArchiveSort,
            setArchiveFilter, setViewMode, setExpandedSource, setPityFilter, fmt, PULLS, CUR, COST, accountLabel,
          });
        })()}
      </div>
    </div>
  );
}

Object.assign(window, { GachaTracker });
