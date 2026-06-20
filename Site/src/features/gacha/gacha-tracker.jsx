// ============================================================
// Nyxarium — universal gacha pull tracker (overlay)
// window.GachaTracker({ open, onClose, cfg })
//   cfg = { pull, pulls, currency, cost, fives:[], fours:[], key }
// Two phases: (1) import screen, (2) pull-history visualization.
// Imported data is generated + persisted per game in localStorage.
// ============================================================

function gtSimulate(cfg){
  const fivePool = (cfg.fives && cfg.fives.length) ? cfg.fives : ['Featured'];
  const fourPool = (cfg.fours && cfg.fours.length) ? cfg.fours : ['Four Star'];
  const total = 170 + Math.floor(Math.random() * 200);
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
      fives.push({ idx:i, pity:pity5, won, ff, name });
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
              setData({ banners: ADAPT.buildViews(all, { cost: COST }), uid: uids[0] });
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
      await STORE.savePulls(ADAPT.game, res.uid, res.pulls);
      const all = await STORE.loadPulls(ADAPT.game, res.uid);
      try { localStorage.removeItem(LSKEY); } catch (e) {}
      setData({ banners: ADAPT.buildViews(all, { cost: COST }), uid: res.uid });
      setBannerIdx(0); setUid(res.uid); setProgress(null); setPhase('results');
    } catch (e) {
      setError(String((e && e.message) || e || 'Import failed.'));
      setProgress(null); setPhase('import');
    }
  };

  // Import an existing UIGF file (Paimon.moe / Snap Hutao / stardb / …).
  const runImportFile = async (file) => {
    if (!file || !ADAPT || !STORE || !ADAPT.importFile) return;
    setError(''); setProgress(null); setPhase('loading');
    try {
      const json = JSON.parse(await file.text());
      const res = ADAPT.importFile(json);
      if (!res || res.error) throw new Error((res && res.error) || 'Could not read that file.');
      if (!res.pulls || !res.pulls.length) throw new Error('No ' + (C.pulls || 'pulls').toLowerCase() + ' for this game in that file.');
      const id = res.uid || 'imported';
      await STORE.savePulls(ADAPT.game, id, res.pulls);
      const all = await STORE.loadPulls(ADAPT.game, id);
      try { localStorage.removeItem(LSKEY); } catch (e) {}
      setData({ banners: ADAPT.buildViews(all, { cost: COST }), uid: id });
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

  if (!inline && !open) return null;

  const fmt = (n) => n.toLocaleString('en-US');

  return (
    <div className={inline ? 'gt-inline' : 'gt-overlay'}
         onMouseDown={inline ? undefined : (e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gt-panel" data-screen-label={PULL + ' Tracker'}>
        <div className="gt-head">
          <span className="gt-dia"></span>
          <div className="gt-ttl">
          <div className="t">{TITLE}</div>
            <div className="s">{phase === 'results' ? 'Your pull history' : 'Import your ' + PULL.toLowerCase() + ' history'}</div>
          </div>
          <button type="button" className="gt-x" title="Close" onClick={onClose} style={{ display:inline ? 'none' : undefined }}>{'\u2715'}</button>
        </div>

        {phase !== 'results' && (
          <div className="gt-import">
            <ol className="gt-steps">
              <li><span className="n">1</span><div><b>Open your history</b><span>In {CUR === 'Primogems' ? 'Genshin' : 'the game'}, open the {PULL} history page so the feed URL is cached.</span></div></li>
              <li><span className="n">2</span><div><b>Copy the feed URL</b><span>{ADAPT ? 'Open PowerShell (Windows search → PowerShell) and run the command below — it copies your link to the clipboard.' : 'Run the helper command, then copy the ' + PULL.toLowerCase() + ' history link it prints.'}</span></div></li>
              <li><span className="n">3</span><div><b>Paste &amp; import</b><span>Drop the link below — Nyxarium reads every banner and never sees your account.</span></div></li>
            </ol>
            {ADAPT && ADAPT.helperCommand && (
              <div className="gt-cmd">
                <code>{ADAPT.helperCommand}</code>
                <button type="button" onClick={() => { try { navigator.clipboard.writeText(ADAPT.helperCommand); } catch (e) {} }}>Copy</button>
              </div>
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
            {ADAPT && ADAPT.importFile && (
              <span>
                <input ref={fileRef} type="file" accept=".json,application/json" style={{ display:'none' }}
                       onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; runImportFile(f); }} />
                <button type="button" className="gt-sample" disabled={phase === 'loading'}
                        onClick={() => { if (fileRef.current) fileRef.current.click(); }}>
                  or import a UIGF file (Paimon.moe, Snap Hutao\u2026) {'\u2192'}
                </button>
              </span>
            )}
          </div>
        )}

        {phase === 'results' && data && data.banners && data.banners.length > 0 && (() => {
          const banners = data.banners;
          const bi = Math.min(bannerIdx, banners.length - 1);
          const active = banners[bi];
          const fives = active.fives || [];
          const ffEvents = fives.filter(f => f.ff);
          const won = ffEvents.filter(f => f.won).length;
          const winRate = ffEvents.length ? Math.round((won / ffEvents.length) * 100) : 0;
          const avgPity = fives.length ? Math.round(fives.reduce((a, f) => a + f.pity, 0) / fives.length) : 0;
          const spent = active.total * COST;
          const stream = (active.stream || []).slice(-70);
          const pct = (k) => active.total ? Math.round((k / active.total) * 100) : 0;
          const soft = active.soft || 74, hard = active.hard || 90;
          return (
            <div className="gt-results">
              {banners.length > 1 && (
                <div className="gt-bannertabs">
                  {banners.map((b, i) => (
                    <button key={b.key} type="button" className={i === bi ? 'on' : ''} onClick={() => setBannerIdx(i)}>
                      {b.label}<span>{fmt(b.total)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="gt-pity">
                <div className="lbl"><span>Current pity</span><b>{active.currentPity}<i> / {hard}</i></b>
                  {active.ff && active.guaranteed && <span className="gtag">Guaranteed next</span>}</div>
                <div className="bar">
                  <i style={{ width:Math.min(100, (active.currentPity / hard) * 100) + '%' }}></i>
                  <span className="soft" style={{ left:(soft / hard) * 100 + '%' }} title="Soft pity"></span>
                </div>
              </div>

              <div className="gt-stats">
                <div className="st"><div className="v">{fmt(active.total)}</div><div className="k">Total {PULLS}</div></div>
                <div className="st"><div className="v">{fmt(spent)}</div><div className="k">{CUR} spent</div></div>
                <div className="st five"><div className="v">{fives.length}</div><div className="k">5{'\u2605'} pulled</div></div>
                <div className="st four"><div className="v">{active.fourCount}</div><div className="k">4{'\u2605'} pulled</div></div>
                <div className="st"><div className="v">{avgPity}</div><div className="k">Avg 5{'\u2605'} pity</div></div>
                {active.ff
                  ? <div className="st"><div className="v">{winRate}<i>%</i></div><div className="k">Won 50:50</div></div>
                  : <div className="st"><div className="v">{pct(fives.length)}<i>%</i></div><div className="k">5{'\u2605'} rate</div></div>}
              </div>

              <div className="gt-dist">
                <div className="seg s5" style={{ flex:Math.max(2, fives.length) }}><span>5{'\u2605'} {pct(fives.length)}%</span></div>
                <div className="seg s4" style={{ flex:Math.max(2, active.fourCount) }}><span>4{'\u2605'} {pct(active.fourCount)}%</span></div>
                <div className="seg s3" style={{ flex:Math.max(2, active.threeCount) }}><span>3{'\u2605'} {pct(active.threeCount)}%</span></div>
              </div>

              <div style={{ background:'rgba(13,10,30,.5)', borderRadius:12, padding:'11px 14px', boxShadow:'inset 0 0 0 1px rgba(183,170,255,.14)' }}>
                <div style={{ fontFamily:"'HSR',sans-serif", fontSize:12, color:'#b3a9e0', letterSpacing:'.04em', marginBottom:8, display:'flex', justifyContent:'space-between' }}>
                  <span>Pity timeline</span><span style={{ opacity:.55 }}>soft {soft} {'\u00b7 '} hard {hard}</span>
                </div>
                {fives.length > 0
                  ? (() => {
                      const W = 100, H = 40, n = fives.length, bw = W / n;
                      const sy = H - (Math.min(soft, hard) / hard) * H;
                      return (
                        <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none" style={{ width:'100%', height:66, display:'block' }}>
                          <line x1="0" y1={sy} x2={W} y2={sy} stroke="rgba(255,205,120,.5)" strokeWidth="0.35" strokeDasharray="1.4 1.1" />
                          {fives.map((f, i) => {
                            const h = Math.max(1.2, (Math.min(f.pity, hard) / hard) * H);
                            const col = !active.ff ? '#9a89ea' : (!f.ff ? '#caa14a' : (f.won ? '#5ad19a' : '#e0607a'));
                            return <rect key={i} x={i * bw + bw * 0.14} y={H - h} width={bw * 0.72} height={h} rx={Math.min(1, bw * 0.12)} fill={col}><title>{f.name + ' \u2014 pity ' + f.pity}</title></rect>;
                          })}
                        </svg>
                      );
                    })()
                  : <div style={{ opacity:.5, fontSize:12, fontFamily:"'HSR',sans-serif" }}>No 5{'\u2605'} yet.</div>}
              </div>

              <div className="gt-cols">
                <div className="gt-fives">
                  <div className="hd">5{'\u2605'} history <span>{fives.length}</span></div>
                  <div className="lst">
                    {fives.slice().reverse().map((f, i) => (
                      <div key={i} className="row">
                        {(f.icon || f.art)
                          ? <img src={f.icon || f.art} alt="" loading="lazy"
                                 style={{ width:30, height:30, borderRadius:'50%', objectFit:'cover', flex:'0 0 auto', background:'rgba(255,255,255,.06)' }} />
                          : <span aria-hidden="true"
                                  style={{ width:30, height:30, borderRadius:'50%', flex:'0 0 auto',
                                           background: f.isWeapon ? 'linear-gradient(135deg,#b98a3e,#6c4f1c)' : 'linear-gradient(135deg,#caa14a,#7a5c1e)' }}></span>}
                        <span className="nm">{f.name}{f.el ? <i style={{ opacity:.55, marginLeft:6, fontStyle:'normal' }}>{'\u00b7 ' + f.el}</i> : null}</span>
                        <span className={'fz ' + (f.pity >= soft ? 'hi' : f.pity <= 35 ? 'lo' : '')}>Pity {f.pity}</span>
                        {active.ff
                          ? (f.ff
                              ? <span className={'res ' + (f.won ? 'win' : 'lose')}>{f.won ? 'Won 50:50' : 'Lost 50:50'}</span>
                              : <span className="res gtd">Guaranteed</span>)
                          : null}
                      </div>
                    ))}
                    {fives.length === 0 && <div className="row" style={{ opacity:.55 }}>No 5{'\u2605'} on this banner yet.</div>}
                  </div>
                </div>
                <div className="gt-stream">
                  <div className="hd">Recent {PULLS.toLowerCase()} <span>last {stream.length}</span></div>
                  <div className="pips">
                    {stream.map((r, i) => <span key={i} className={'pip r' + r} title={r + '\u2605'}></span>)}
                  </div>
                  <button type="button" className="gt-reset" onClick={reset}>Re-import history</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

Object.assign(window, { GachaTracker });
