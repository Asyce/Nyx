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
                const char = views.find((v) => v.key === 'character') || views[0];
                const lastFive = char && char.fives.length ? char.fives[char.fives.length - 1] : null;
                const fiveCount = views.reduce((a, v) => a + v.fives.length, 0);
                row = Object.assign({}, g, {
                  imported: true, uid: uids[0], total: all.length,
                  pity: char ? char.currentPity : 0, hard: char ? char.hard : 90,
                  guaranteed: !!(char && char.guaranteed), lastFive: lastFive, fiveCount: fiveCount,
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

  const card = { background: 'rgba(13,10,30,.66)', borderRadius: 16, padding: '16px 18px', boxShadow: 'inset 0 0 0 1px rgba(183,170,255,.16)', display: 'flex', flexDirection: 'column', gap: 10 };
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  return (
    <div style={{ padding: '8px 4px 24px' }}>
      <div style={{ fontFamily: "'HSR',sans-serif", fontSize: 20, color: '#efeaff', letterSpacing: '.04em', marginBottom: 4 }}>Pull Overview</div>
      <div style={{ fontFamily: "'HSR',sans-serif", fontSize: 13, color: '#9a8fce', marginBottom: 18 }}>Your pity and pulls across every game, at a glance.</div>
      {!rows
        ? <div style={{ color: '#b3a9e0', fontFamily: "'HSR',sans-serif" }}>Loading your pulls…</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))', gap: 14 }}>
            {rows.map((r) => (
              <div key={r.key} style={Object.assign({}, card, r.imported ? {} : { opacity: .72 })}>
                <div style={{ fontFamily: "'HSR',sans-serif", fontSize: 15, color: '#efeaff', letterSpacing: '.03em', borderLeft: '3px solid ' + r.accent, paddingLeft: 10 }}>{r.name}</div>
                {r.imported ? (
                  <React.Fragment>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <b style={{ fontFamily: "'HSR',sans-serif", fontSize: 30, color: '#fff', lineHeight: 1 }}>{r.pity}</b>
                      <i style={{ color: '#8b80b8', fontStyle: 'normal', fontSize: 14 }}>/ {r.hard} pity</i>
                      {r.guaranteed && <span style={{ marginLeft: 'auto', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: '#100c26', background: 'linear-gradient(160deg,#ffd9a0,#e0a24a)', padding: '3px 8px', borderRadius: 7 }}>Guaranteed</span>}
                    </div>
                    <div style={{ height: 7, borderRadius: 6, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                      <i style={{ display: 'block', height: '100%', width: Math.min(100, (r.pity / r.hard) * 100) + '%', background: 'linear-gradient(90deg,#9a89ea,' + r.accent + ')' }}></i>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'HSR',sans-serif", fontSize: 12.5, color: '#b3a9e0' }}>
                      <span>{fmt(r.total)} {r.pull.toLowerCase()}</span><span>{r.fiveCount} 5{'★'}</span>
                    </div>
                    {r.lastFive && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 2 }}>
                        {(r.lastFive.icon || r.lastFive.art)
                          ? <img src={r.lastFive.icon || r.lastFive.art} alt="" loading="lazy" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto', background: 'rgba(255,255,255,.06)' }} />
                          : <span style={{ width: 30, height: 30, borderRadius: '50%', flex: '0 0 auto', background: 'linear-gradient(135deg,#caa14a,#7a5c1e)' }}></span>}
                        <span style={{ fontFamily: "'HSR',sans-serif", fontSize: 12.5, color: '#cfc6ff' }}>Last 5{'★'}: {r.lastFive.name} <i style={{ color: '#8b80b8', fontStyle: 'normal' }}>(pity {r.lastFive.pity})</i></span>
                      </div>
                    )}
                  </React.Fragment>
                ) : (
                  <div style={{ fontFamily: "'HSR',sans-serif", fontSize: 12.5, color: '#8b80b8', lineHeight: 1.5 }}>Not imported yet — open the {r.pull.replace(/s$/, '')} Tracker on the {r.name} page to import.</div>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

Object.assign(window, { PullsOverview });
