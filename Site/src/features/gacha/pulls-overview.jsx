// ============================================================
// Nyx — cross-game Pull Overview (window.PullsOverview)
// Reads every game's imported history from IndexedDB and shows a
// per-game summary card: current character-banner pity, lifetime
// pulls, 5★ count, and the most recent 5★ with art. Lives on the
// Nyx (Nyx) hub's "Pull Overview" tab.
// ============================================================

function PullsOverview() {
  const GAMES = [
    { key: 'gi',   name: 'Genshin Impact',    pull: 'Wishes',   accent: '#b7c8ff' },
    { key: 'hsr',  name: 'Honkai: Star Rail', pull: 'Warps',    accent: '#9fd0ff' },
    { key: 'zzz',  name: 'Zenless Zone Zero', pull: 'Signals',  accent: '#ffd76b' },
    { key: 'wuwa', name: 'Wuthering Waves',   pull: 'Convenes', accent: '#c4a6ff' },
    { key: 'ae',   name: 'Arknights: Endfield', pull: 'Pulls',  accent: '#7ee6c6' },
  ];
  const [rows, setRows] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const STORE = window.NyxPullStore, ENG = window.NyxPulls;
      const out = [];
      for (const g of GAMES) {
        let row = Object.assign({}, g, { imported: false });
        try {
          if (STORE && ENG && ENG.adapterFor(g.key)) {
            const uids = await STORE.loadAllUids(g.key);
            if (uids && uids.length) {
              const all = await STORE.loadPulls(g.key, uids[0]);
              if (all && all.length) {
                const views = ENG.buildViews(g.key, all, {});
                const char = g.key === 'ae'
                  ? (views.find((view) => !view.pityUnavailable) || views.find((view) => view.key === 'character') || views[0])
                  : (views.find((view) => view.key === 'character') || views[0]);
                const lastFive = char && char.fives.length ? char.fives[char.fives.length - 1] : null;
                const fiveCount = views.reduce((a, v) => a + v.fives.length, 0);
                row = Object.assign({}, g, {
                  imported: true, uid: uids[0], total: all.length,
                  pity: char ? char.currentPity : 0, hard: char ? char.hard : 90,
                  guaranteed: !!(char && char.guaranteed), lastFive: lastFive, fiveCount: fiveCount,
                  topRank:(char && char.topRank) || 5, pityUnavailable:!!(char && char.pityUnavailable),
                });
              }
            }
          }
        } catch (e) {}
        out.push(row);
      }
      if (!cancelled) setRows(out);
    })();
    return () => { cancelled = true; };
  }, []);

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  return (
    <div className="pulls-overview">
      <div className="nyx-section-title pulls-overview-title">Pull Overview</div>
      <div className="pulls-overview-subtitle">Your pity and pulls across every game, at a glance.</div>
      {!rows
        ? <div className="pulls-overview-loading">Loading your pulls…</div>
        : (
          <div className="pulls-overview-grid">
            {rows.map((r) => (
              <div key={r.key} className={'nyx-card pulls-overview-card' + (r.imported ? '' : ' is-empty')} style={{ '--pull-accent':r.accent }}>
                <div className="pulls-overview-game">{r.name}</div>
                {r.imported ? (
                  <React.Fragment>
                    {r.pityUnavailable ? (
                      <div className="pulls-overview-pity"><b>History only</b></div>
                    ) : <React.Fragment>
                      <div className="pulls-overview-pity">
                        <b>{r.pity}</b>
                        <i>/ {r.hard} pity</i>
                        {r.guaranteed && <span className="nyx-chip nyx-chip--warning pulls-overview-guaranteed">Guaranteed</span>}
                      </div>
                      <div className="pulls-overview-progress">
                        <i style={{ '--pull-progress':Math.min(100, (r.pity / r.hard) * 100) + '%' }}></i>
                      </div>
                    </React.Fragment>}
                    <div className="pulls-overview-stats">
                      <span>{fmt(r.total)} {r.pull.toLowerCase()}</span><span>{r.fiveCount} {r.topRank}{'★'}</span>
                    </div>
                    {r.lastFive && (
                      <div className="pulls-overview-last">
                        {(r.lastFive.icon || r.lastFive.art)
                          ? <img src={r.lastFive.icon || r.lastFive.art} alt="" loading="lazy" />
                          : <span className="pulls-overview-avatar-fallback"></span>}
                        <span>Last {r.topRank}{'★'}: {r.lastFive.name} {!r.pityUnavailable && <i>(pity {r.lastFive.pity})</i>}</span>
                      </div>
                    )}
                  </React.Fragment>
                ) : (
                  <div className="pulls-overview-empty">Not imported yet — open the {r.pull.replace(/s$/, '')} Tracker on the {r.name} page to import.</div>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

Object.assign(window, { PullsOverview });
