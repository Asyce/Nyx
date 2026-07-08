// ============================================================
// Nyx — universal gacha pull tracker (overlay)
// window.GachaTracker({ open, onClose, cfg })
//   cfg = { pull, pulls, currency, cost, fives:[], fours:[], key }
// Two phases: (1) import screen, (2) pull-history visualization.
// Imported data is persisted per game in IndexedDB.
// ============================================================

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

function gtHeroCardGroup(card, bannerGroups){
  if (!card) return null;
  const groups = (bannerGroups || []).filter((g) => g.bannerKey === 'character' || g.bannerKey === 'character2');
  if (!groups.length) return null;
  if (card.start) {
    // Card came from a real banner period (gtCurrentLimitedFeatures) — only the
    // source group for THAT exact period counts as "pulls on this banner". Do
    // not fall back to an older period just because the character's name
    // matches there too; that would mislabel a past rerun's pulls as current.
    return groups.find((g) => g.periodStart && Math.abs((g.periodStart || 0) - card.start) < 60 * 60 * 1000) || null;
  }
  // No period metadata (fallback-fives path, no NYX_BANNERS history for this game) —
  // best effort: the most recent source group the user actually pulled this name on.
  const norm = gtNormName(card.name);
  return groups.find((g) => (g.fives || []).some((f) => gtNormName(f.name) === norm)) || null;
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
    weaponArchive, archiveSort, archiveFilter, viewMode, expandedSource, pityFilter, historyFilter, setArchiveSort,
    setArchiveFilter, setViewMode, setExpandedSource, setPityFilter, setHistoryFilter, fmt, PULLS, CUR, COST, accountLabel,
    sourceLabel, importedAt,
  } = ctx;
  const sinceLastFive = characterView ? (characterView.currentPity || 0) : 0;
  const heroHard = (characterView && characterView.hard) || 90;
  const heroSoft = (characterView && characterView.soft) || 74;
  const heroPct = Math.max(0, Math.min(100, (sinceLastFive / heroHard) * 100));
  const heroSoftPct = Math.max(0, Math.min(100, (heroSoft / heroHard) * 100));
  const heroChipClass = currentState === 'Guaranteed' ? 'guaranteed' : (currentState === '50:50' ? 'fifty' : 'pool');
  const heroChipLabel = 'Next 5★: ' + currentState;
  // Prefer the notable pulls (4★+ "highlights") over raw recent, so the card tells
  // the "what did I actually get" story instead of a list of 3★ weapon filler
  // (handoff: "if 4 characters happened, show 4"). Falls back to raw recent only
  // when a banner produced no 4★+ at all.
  const gtHeroPulls = (group) => {
    if (!group) return [];
    const notable = (group.highlights || []).slice(0, 6);
    return notable.length ? notable : (group.recent || []).slice(0, 6);
  };
  let heroCards = (currentLimited || []).slice(0, 2).map((card) => {
    const group = gtHeroCardGroup(card, bannerGroups);
    const groupBanner = group ? (bannerByKey[group.bannerKey] || { label:group.bannerLabel, ff:false }) : null;
    return { card, group, groupBanner, pulls: gtHeroPulls(group) };
  });
  // If the user hasn't pulled on the current banner(s) yet, fall back to the last
  // character banner(s) they actually pulled on (handoff: "pulls done on the last
  // banner"). bannerGroups is pre-sorted by lastTime desc; reuse already-resolved
  // pull rows/art so no new resolution logic is needed.
  const heroBannersMode = heroCards.some((h) => h.pulls.length > 0) ? 'current' : 'last';
  if (heroBannersMode === 'last') {
    const lastGroups = (bannerGroups || [])
      .filter((g) => (g.bannerKey === 'character' || g.bannerKey === 'character2') && (g.recent || []).length)
      .slice(0, 2);
    if (lastGroups.length) {
      heroCards = lastGroups.map((group) => {
        const topFive = (group.fives || [])[0];
        const art = (topFive && (topFive.art || topFive.icon))
          || (group.recent[0] && (group.recent[0].art || group.recent[0].icon)) || '';
        return {
          card: { name:group.displayName || group.label, art, icon:art, start:group.periodStart || group.lastTime },
          group,
          groupBanner: bannerByKey[group.bannerKey] || { label:group.label, ff:false },
          pulls: gtHeroPulls(group),
        };
      });
    }
  }
  // Phase 2: full chronological pull history (all rarities), filterable.
  const historyAll = (banners || []).flatMap((b) => (b.items || []).map((it) => Object.assign({}, it, { _bk:b.key, _bl:b.label })))
    .sort((a, b) => (b.time || 0) - (a.time || 0) || (b.idx || 0) - (a.idx || 0));
  const historyRows = historyAll.filter((p) => (
    historyFilter === 'five' ? p.rank === 5 :
    historyFilter === 'four' ? p.rank === 4 :
    historyFilter === 'weapon' ? p.isWeapon : true
  ));
  const HISTORY_CAP = 80;
  return (
    <div className="gt-results">
      <div className="gt-results-top">
        <div className="gt-mode-tabs" role="tablist" aria-label="Wish tracker views">
          <button type="button" className={viewMode === 'overview' ? 'on' : ''} onClick={() => setViewMode('overview')}>Overview</button>
          <button type="button" className={viewMode === 'pity' ? 'on' : ''} onClick={() => setViewMode('pity')}>Pity Observatory</button>
          <button type="button" className={viewMode === 'archive' ? 'on' : ''} onClick={() => setViewMode('archive')}>Archive</button>
        </div>
        <div className="gt-account">
          <b>{accountLabel}</b>
          <span>{sourceLabel || 'Saved local import'}{importedAt ? ' / ' + gtFmtDate(importedAt) : ''}</span>
        </div>
      </div>

      {viewMode === 'overview' ? (
        <div className="gt-overview">
          <section className="gt-hero">
            <div className="gt-hero-pity gt-panel-box">
              <div className="gt-box-head"><b>Pity to next 5{'\u2605'}</b><span>{(characterView && characterView.label) || 'Character banner'}</span></div>
              <div className="gt-hero-pity-number"><b>{fmt(sinceLastFive)}</b><i>/ {heroHard}</i></div>
              <div className="gt-hero-pity-caption">{fmt(sinceLastFive)} {PULLS.toLowerCase()} since last 5{'\u2605'}</div>
              <div className="gt-hero-pity-bar">
                <div className="gt-hero-pity-fill" style={{ width:heroPct + '%' }}></div>
                <mark style={{ left:heroSoftPct + '%' }}></mark>
              </div>
              <div className="gt-hero-pity-scale"><span>Soft {heroSoft}</span><span>Hard {heroHard}</span></div>
              <div className={'gt-hero-chip ' + heroChipClass}>{heroChipLabel}</div>
            </div>

            <div className="gt-hero-banners">
              <div className="gt-hero-banners-head">{heroBannersMode === 'current' ? 'Current banners' : 'Your last banner pulls'}</div>
              {heroCards.map(({ card, group, groupBanner, pulls }) => (
                <article key={card.name} className="gt-hero-banner-card">
                  <div className="gt-hero-banner-art" style={(card.art || card.icon) ? gtBg(card.art || card.icon) : undefined}>
                    <div className="gt-hero-banner-fade"></div>
                    <div className="gt-hero-banner-copy">
                      <b>{card.name}</b>
                      <span>{card.version ? 'Version ' + card.version : gtFmtDate(card.start)}</span>
                    </div>
                  </div>
                  <div className="gt-hero-banner-pulls">
                    <div className="gt-hero-banner-pulls-head">Notable pulls</div>
                    {pulls.length > 0 ? pulls.map((p, idx) => {
                      const isFive = p.rank === 5;
                      return (
                        <div key={(p.id || p.idx || idx) + ':' + p.name} className="gt-hero-pull-row">
                          {(p.icon || p.art) ? <img src={p.icon || p.art} alt="" loading="lazy" /> : <span className="gt-img-fallback"></span>}
                          <div>
                            <b>{p.name}</b>
                            <span>{gtFmtDate(p.time)}</span>
                          </div>
                          {isFive
                            ? <em className={gtPullOutcomeClass(p, groupBanner).replace(/\s+/g, '-')}>{gtPullOutcome(p, groupBanner, gameKey)}</em>
                            : <i>{p.rank || '-'}{'\u2605'}</i>}
                        </div>
                      );
                    }) : <div className="gt-empty-row">No pulls yet on this banner.</div>}
                  </div>
                  {group && group.pairedWeapons && group.pairedWeapons.length > 0 && (
                    <div className="gt-paired-weapon">
                      {group.pairedWeapons.map((wg) => <span key={wg.key}>Weapon pair: {wg.displayName || wg.label} ({fmt(wg.total || 0)} {PULLS})</span>)}
                    </div>
                  )}
                </article>
              ))}
              {heroCards.length === 0 && <div className="gt-empty-row gt-panel-box">No current limited banner metadata found.</div>}
            </div>
          </section>

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

          <section className="gt-panel-box gt-recent-pulls">
            <div className="gt-box-head"><b>Pull history</b><span>{fmt(historyRows.length)} {historyFilter === 'all' ? PULLS.toLowerCase() : 'shown'}</span></div>
            <div className="gt-filter-pills" role="group" aria-label="Pull history filter">
              {[['all', 'All'], ['five', '5★'], ['four', '4★'], ['weapon', 'Weapons']].map((pair) => (
                <button key={pair[0]} type="button" className={historyFilter === pair[0] ? 'on' : ''} onClick={() => setHistoryFilter(pair[0])}>{pair[1]}</button>
              ))}
            </div>
            <div className="gt-recent-five-list">
              {historyRows.slice(0, HISTORY_CAP).map((row) => {
                const b = bannerByKey[row._bk] || { key:row._bk, label:row._bl };
                const isFive = row.rank === 5;
                return (
                  <div key={(row.id || row.idx) + ':' + row._bk + ':' + row.name} className="gt-recent-five-row">
                    {(row.icon || row.art) ? <img src={row.icon || row.art} alt="" loading="lazy" /> : <span className="gt-img-fallback"></span>}
                    <div>
                      <b>{row.name}</b>
                      <span>{gtBannerKindLabel(row._bk, row._bl)} · {gtFmtDate(row.time)}</span>
                    </div>
                    {isFive
                      ? <em className={gtPullOutcomeClass(row, b).replace(/\s+/g, '-')}>{gtPullOutcome(row, b, gameKey)}</em>
                      : <em className="rank">{row.rank || '-'}{'★'}</em>}
                    <i>Pity {row.pity || row.pity5 || row.pity4 || '-'}</i>
                  </div>
                );
              })}
              {historyRows.length === 0 && <div className="gt-empty-row">No {historyFilter === 'all' ? '' : historyFilter === 'weapon' ? 'weapon ' : historyFilter + '★ '}pulls recorded yet.</div>}
              {historyRows.length > HISTORY_CAP && <div className="gt-empty-row">Showing {HISTORY_CAP} of {fmt(historyRows.length)} — Archive tab has full totals.</div>}
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
  // Legacy sample/demo cache key. Kept only so old browser data can be removed.
  const LSKEY = 'nyx-tracker-' + (C.key || 'gi');
  // Real importer for this game, when one is wired. Games can support live URL
  // import, file import, CSV/manual import, or any combination of those.
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
  const [syncSecret, setSyncSecret] = React.useState('');
  const [syncStatus, setSyncStatus] = React.useState('');
  const [syncBusy, setSyncBusy] = React.useState(false);
  const fileRef = React.useRef(null);

  // On mount: load real imported history from IndexedDB. Old sample/demo
  // localStorage caches are intentionally ignored and removed.
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
              setData({ banners: ADAPT.buildViews(all, { cost: COST }), uid: uids[0],
                accountName:(summary && summary.accountName) || '',
                sourceLabel:(summary && summary.sourceLabel) || 'Saved local import',
                importedAt:(summary && summary.importedAt) || 0 });
              setBannerIdx(0); setUid(uids[0]); setPhase('results'); return;
            }
          }
        }
      } catch (e) {}
      try { localStorage.removeItem(LSKEY); } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, [LSKEY]);

  // Real import: parse the pasted URL → walk every banner via the proxy
  // → persist → render the character-banner view.
  const runImport = async () => {
    if (!ADAPT || !STORE || !ADAPT.runImport || !ADAPT.parseAuth) {
      setError('Live URL import is not available for this game yet. Use JSON/CSV import or manual CSV backfill instead.');
      return;
    }
    const auth = ADAPT.parseAuth(url);
    if (auth && auth.error) { setError(auth.error); return; }
    setError(''); setProgress(null); setPhase('loading');
    try {
      const res = await ADAPT.runImport(auth, (p) => setProgress(p));
      const accountName = res.accountName || res.nickname || res.name || '';
      await STORE.savePulls(ADAPT.game, res.uid, res.pulls, { accountName, sourceLabel:'Live history URL', importKind:'live-url' });
      const all = await STORE.loadPulls(ADAPT.game, res.uid);
      try { localStorage.removeItem(LSKEY); } catch (e) {}
      setData({ banners: ADAPT.buildViews(all, { cost: COST }), uid: res.uid, accountName,
        sourceLabel:'Live history URL', importedAt:Date.now() });
      setBannerIdx(0); setUid(res.uid); setProgress(null); setPhase('results');
    } catch (e) {
      setError(String((e && e.message) || e || 'Import failed.'));
      setProgress(null); setPhase('import');
    }
  };

  // Import an existing UIGF/JSON/CSV/XLSX file (Paimon.moe, Snap Hutao,
  // stardb, rng.moe, Wuwa/Endfield community exports, or manual CSV).
  const runImportFile = async (file) => {
    if (!file || !ADAPT || !STORE || (!ADAPT.importFile && !ADAPT.importExcel && !ADAPT.importCsv)) return;
    setError(''); setProgress(null); setPhase('loading');
    try {
      const isExcel = /\.xlsx$/i.test(file.name || '') || /spreadsheetml/i.test(file.type || '');
      const isCsv = /\.csv$/i.test(file.name || '') || /csv/i.test(file.type || '');
      let res;
      if (isExcel) {
        if (!ADAPT.importExcel) throw new Error('Excel import is not available for this game yet.');
        res = await ADAPT.importExcel(await file.arrayBuffer());
      } else if (isCsv) {
        if (!ADAPT.importCsv) throw new Error('CSV/manual import is not available for this game yet.');
        res = ADAPT.importCsv(await file.text());
      } else {
        if (!ADAPT.importFile) throw new Error('JSON import is not available for this game yet.');
        res = ADAPT.importFile(JSON.parse(await file.text()));
      }
      if (!res || res.error) throw new Error((res && res.error) || 'Could not read that file.');
      if (!res.pulls || !res.pulls.length) throw new Error('No ' + (C.pulls || 'pulls').toLowerCase() + ' for this game in that file.');
      const id = res.uid || 'imported';
      const accountName = res.accountName || res.nickname || res.name || (/paimon/i.test(id) ? 'Paimon.moe import' : 'Imported history');
      const sourceLabel = isExcel ? 'Paimon.moe Excel file' : (isCsv ? 'CSV/manual file' : 'JSON/UIGF file');
      await STORE.savePulls(ADAPT.game, id, res.pulls, { accountName, sourceLabel, importKind:isCsv ? 'csv' : (isExcel ? 'xlsx' : 'json') });
      const all = await STORE.loadPulls(ADAPT.game, id);
      try { localStorage.removeItem(LSKEY); } catch (e) {}
      setData({ banners: ADAPT.buildViews(all, { cost: COST }), uid: id, accountName, sourceLabel, importedAt:Date.now() });
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

  const runSync = async (mode) => {
    const SYNC = window.NyxAccountSync || null;
    if (!SYNC || !SYNC.available || !SYNC.available()) {
      setSyncStatus('Encrypted sync is not available in this browser.');
      return;
    }
    if (!ADAPT) {
      setSyncStatus('Sync is not available for this game yet.');
      return;
    }
    setSyncBusy(true);
    setSyncStatus(mode === 'push' ? 'Encrypting and uploading history...' : 'Downloading and decrypting history...');
    try {
      let result;
      if (mode === 'push') {
        try {
          result = await SYNC.pushGame(syncSecret, ADAPT.game);
        } catch (e) {
          if (e && e.code === 'stale_push' && typeof window !== 'undefined' && window.confirm
            && window.confirm('The copy saved on Pengo is newer than this device. Upload anyway and overwrite it?\n\nTip: use Restore instead to bring the newer copy to this device.')) {
            result = await SYNC.pushGame(syncSecret, ADAPT.game, { force: true });
          } else {
            throw e;
          }
        }
      } else {
        result = await SYNC.pullGame(syncSecret, ADAPT.game);
      }
      if (mode === 'pull') {
        const uids = await STORE.loadAllUids(ADAPT.game);
        if (uids && uids.length) {
          const all = await STORE.loadPulls(ADAPT.game, uids[0]);
          const summary = STORE.loadSummary ? await STORE.loadSummary(ADAPT.game, uids[0]) : null;
          setData({ banners: ADAPT.buildViews(all, { cost: COST }), uid: uids[0],
            accountName:(summary && summary.accountName) || '',
            sourceLabel:(summary && summary.sourceLabel) || 'Pengo sync',
            importedAt:(summary && summary.importedAt) || 0 });
          setBannerIdx(0); setUid(uids[0]); setPhase('results');
        }
      }
      setSyncStatus(mode === 'push'
        ? `Synced ${result.accounts || 1} saved account(s) for this game.`
        : `Restored ${fmt(result.added || 0)} new and skipped ${fmt(result.skipped || 0)} duplicate ${PULLS.toLowerCase()}.`);
    } catch (e) {
      setSyncStatus(String((e && e.message) || e || 'Sync failed.'));
    } finally {
      setSyncBusy(false);
    }
  };

  const runSyncDelete = async () => {
    const SYNC = window.NyxAccountSync || null;
    if (!SYNC || !SYNC.available || !SYNC.available() || !ADAPT) return;
    if (typeof window !== 'undefined' && window.confirm
      && !window.confirm('Remove this game’s synced history from Pengo’s servers? Your local history stays on this device.')) return;
    setSyncBusy(true);
    setSyncStatus('Removing synced copy from Pengo...');
    try {
      await SYNC.deleteGame(syncSecret, ADAPT.game);
      setSyncStatus('Removed this game’s synced copy from Pengo. Local history is untouched.');
    } catch (e) {
      setSyncStatus(String((e && e.message) || e || 'Could not remove synced copy.'));
    } finally {
      setSyncBusy(false);
    }
  };

  if (!inline && !open) return null;

  const fmt = (n) => n.toLocaleString('en-US');
  const hasLiveImport = !!(ADAPT && ADAPT.runImport && ADAPT.parseAuth);
  const hasFileImport = !!(ADAPT && (ADAPT.importFile || ADAPT.importExcel || ADAPT.importCsv));
  const manualCsv = 'time,name,rank,banner,item_type,item_id,id,uid\n2026-06-30 12:00:00,Example Character,5,character,character,example-id,manual-1,';
  const quickCommand = ADAPT && ADAPT.helperCommand;
  const verifiedRunCommand = ADAPT && ADAPT.safeScript ? ('powershell -ExecutionPolicy Bypass -File pengo-pulls.ps1 -Game ' + ADAPT.game) : '';
  const copyPlain = (text) => { try { navigator.clipboard.writeText(text); } catch (e) {} };

  return (
    <div className={inline ? 'gt-inline' : 'gt-overlay'}
         onMouseDown={inline ? undefined : (e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gt-panel" data-screen-label={PULL + ' Tracker'}>
        <div className="gt-head">
          <span className="gt-dia"></span>
          <div className="gt-ttl">
            {phase === 'results'
              ? <div className="gt-ttl-results"><div className="t">{TITLE}</div><button type="button" className="gt-title-import" onClick={showImport}>Manage import</button></div>
              : <div className="t">Import history</div>}
          </div>
          <button type="button" className="gt-x" title="Close" onClick={onClose} style={{ display:inline ? 'none' : undefined }}>{'\u2715'}</button>
        </div>

        {phase !== 'results' && (
          <div className="gt-import">
            <ol className="gt-steps">
              <li><span className="n">1</span><div><b>Choose an import method</b><span>Use the quick command, the verified script, a live URL, a tracker export, or a CSV/manual backfill.</span></div></li>
              <li><span className="n">2</span><div><b>Preview and save locally</b><span>Pengo stores imported history in this browser so it remembers previous uploads. Account sync can build on this later.</span></div></li>
              <li><span className="n">3</span><div><b>Keep a backup</b><span>JSON/UIGF/CSV files are the safest way to move between trackers and recover history that the game no longer shows.</span></div></li>
            </ol>

            <div className="gt-method-grid">
              {quickCommand && (
                <section className="gt-method">
                  <b>Quick PowerShell command</b>
                  <p>Fastest PC option. It downloads the Pengo helper, runs it, and copies the history link for you.</p>
                  <div className="gt-cmd">
                    <code>{quickCommand}</code>
                    <button type="button" onClick={() => copyPlain(quickCommand)}>Copy</button>
                  </div>
                </section>
              )}

              {ADAPT && ADAPT.safeScript && (
                <section className="gt-method">
                  <b>Download and verify</b>
                  <p>Safer PC option. Download the same helper first, inspect it, verify the hash, then run it yourself.</p>
                  <div className="gt-safe-links">
                    <a href={ADAPT.safeScript.url} download>Download script</a>
                    <a href={ADAPT.safeScript.url} target="_blank" rel="noopener noreferrer">View source</a>
                  </div>
                  <div className="gt-cmd">
                    <code>Get-FileHash pengo-pulls.ps1 -Algorithm SHA256</code>
                    <button type="button" onClick={() => copyPlain('Get-FileHash pengo-pulls.ps1 -Algorithm SHA256')}>Copy</button>
                  </div>
                  <div className="gt-sha">SHA-256 <code>{ADAPT.safeScript.sha256}</code></div>
                  <div className="gt-cmd">
                    <code>{verifiedRunCommand}</code>
                    <button type="button" onClick={() => copyPlain(verifiedRunCommand)}>Copy</button>
                  </div>
                </section>
              )}

              {hasFileImport && (
                <section className="gt-method">
                  <b>Import a file</b>
                  <p>Best privacy option. Upload UIGF/JSON exports from other trackers, Paimon Excel where supported, Wuwa/Endfield JSON, or CSV/manual files.</p>
                  <input ref={fileRef} type="file" accept=".json,application/json,.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display:'none' }}
                         onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; runImportFile(f); }} />
                  <button type="button" className="gt-method-action" disabled={phase === 'loading'}
                          onClick={() => { if (fileRef.current) fileRef.current.click(); }}>
                    Choose JSON / CSV / Excel
                  </button>
                </section>
              )}

              {ADAPT && ADAPT.importCsv && (
                <section className="gt-method">
                  <b>Manual CSV backfill</b>
                  <p>Use this when old history expired. Create a CSV with time, name, rank, banner, item_type, item_id, id, and uid, then import it as a file.</p>
                  <div className="gt-cmd">
                    <code>{manualCsv}</code>
                    <button type="button" onClick={() => copyPlain(manualCsv)}>Copy</button>
                  </div>
                </section>
              )}
            </div>

            <div className="gt-urlrow">
              <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck="false" disabled={!hasLiveImport}
                     placeholder={hasLiveImport ? ('https://... ' + PULL.toLowerCase() + ' history URL') : 'Live URL import is not available for this game yet'} />
              <button type="button" className="gt-go" disabled={phase === 'loading' || !hasLiveImport} onClick={runImport}>
                {phase === 'loading' ? <span className="gt-spin"></span> : 'Import URL'}
              </button>
            </div>
            <p className="gt-safe-note">Live URL import sends the temporary history link through Pengo&rsquo;s Worker to the game provider, then saves only the pull records in your browser. File import is parsed locally before saving.</p>

            <section className="gt-sync">
              <div>
                <b>Pengo encrypted sync</b>
                <span>Use the same sync phrase on another browser or device to restore this game&rsquo;s saved history. Pengo stores only encrypted data and cannot read your pulls.</span>
                <span className="gt-sync-warn">There is no password reset: anyone who knows or guesses your phrase can restore your history. Use 3&ndash;4 random words (for example <i>copper-lantern-otter-tide</i>), not a common password.</span>
              </div>
              <div className="gt-sync-row">
                <input
                  type="password"
                  value={syncSecret}
                  autoComplete="off"
                  onChange={(e) => setSyncSecret(e.target.value)}
                  placeholder="Sync phrase, 3-4 random words"
                />
                <button type="button" disabled={syncBusy || !syncSecret} onClick={() => runSync('push')}>Upload</button>
                <button type="button" disabled={syncBusy || !syncSecret} onClick={() => runSync('pull')}>Restore</button>
              </div>
              <button type="button" className="gt-sync-delete" disabled={syncBusy || !syncSecret} onClick={runSyncDelete}>Remove synced copy from Pengo</button>
              {syncStatus && <p className="gt-sync-status">{syncStatus}</p>}
            </section>
            {error && <div className="gt-err">{error}</div>}
            {phase === 'loading' && progress && (
              <div className="gt-prog">Importing {progress.bannerLabel}\u2026 {fmt(progress.fetched)} {PULLS.toLowerCase()}{progress.bannerTotal ? ' (' + (progress.bannerIndex + 1) + '/' + progress.bannerTotal + ')' : ''}</div>
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
            historyFilter, setHistoryFilter,
            sourceLabel:data.sourceLabel || 'Saved local import', importedAt:data.importedAt || 0,
          });
        })()}
      </div>
    </div>
  );
}

Object.assign(window, { GachaTracker });
