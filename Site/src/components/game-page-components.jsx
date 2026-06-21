// ============================================================
// Nyx — Game Page shared components (Genshin placeholder)
// Exports to window: GPRoot, GPSec, GPHex, GPBack, GPMedallion,
// GPSwitcher, GPFnRows, GPFav, GPBanner, GPCodes, GP_GAMES, GP_FNS
// ============================================================

const GP_GAMES = [
  { key:'nyx',  name:'Nyx',        icon:'../assets/icon/noxicon.png', glyph:true },
  { key:'gi',   name:'Genshin Impact',    icon:'../assets/icon/giicon.png' },
  { key:'hsr',  name:'Honkai: Star Rail', icon:'../assets/icon/hsricon.png' },
  { key:'zzz',  name:'Zenless Zone Zero', icon:'../assets/icon/zzzicon.png' },
  { key:'wuwa', name:'Wuthering Waves',   icon:'../assets/icon/wuwaicon.png' },
  { key:'ae',   name:'Arknights: Endfield', icon:'../assets/icon/aeicon.png' },
];

const GP_FNS = ['Character Materials', 'Artifact Sorter', 'Wish Tracker'];

/* each game key → its page, so the top rail icons navigate to the page they represent */
const GP_PAGE_HREF = {
  nyx:  'simulacrum.html',
  gi:   'genshin.html',
  hsr:  'honkai-star-rail.html',
  zzz:  'zenless-zone-zero.html',
  wuwa: 'wuthering-waves.html',
  ae:   'arknights-endfield.html',
};

const GP_CODES = [
  { code:'GENSHINGIFT',  reward:'50 Primogems · 3 Hero\u2019s Wit' },
  { code:'EA7VKTQ5N9HV', reward:'100 Primogems · 10 Mystic Enhancement Ore' },
  { code:'KT7DKSFGCRWV', reward:'100 Primogems · 5 Hero\u2019s Wit' },
];

function GPRoot({ children }){
  return (
    <div className="gp">
      <div className="gp-bg"></div>
      <div className="gp-pattern"></div>
      <div className="gp-vignette"></div>
      <div className="gp-content">{children}</div>
    </div>
  );
}

function GPSec({ title, style, icon, perch }){
  return (
    <div className={'gp-sec' + (perch ? ' withperch' : '')} style={style}>
      {icon ? <img className="ic" src={icon} alt="" /> : <span className="dia"></span>}
      <span className="t">{title}</span>
      <span className="rule">{perch ? <img className="perch" src={perch} alt="" /> : null}</span>
    </div>
  );
}

function GPHex({ children, small, on, disabled, style, onClick, fixw }){
  return (
    <button type="button" disabled={!!disabled}
            className={'gp-hex' + (small ? ' sm' : '') + (on ? ' on' : '') + (fixw ? ' fixw' : '')}
            style={style} onClick={onClick}>
      <span className="rim"></span>
      <span className="in">{children}</span>
    </button>
  );
}

function GPBack({ small, style }){
  return (
    <GPHex small={small} style={style}>
      <span className="chev">{'\u2039'}</span>
      <span className="eye"></span>
      <span>Worlds</span>
    </GPHex>
  );
}

/* plain left-click is intercepted for an in-app tab switch (no reload);
   the href stays real so the link is shareable + cmd/middle-click still opens it. */
function gpNav(e, onSwitch, key){
  if (!onSwitch) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
  e.preventDefault();
  onSwitch(key);
}

function GPMedallion({ game, size, on, dim, title, href, onSwitch }){
  const cls = 'gp-med' + (size === 'sm' ? ' sz-sm' : '') + (on ? ' on' : '') + (dim ? ' dim' : '');
  const inner = <img className={game.glyph ? 'glyph' : ''} src={game.icon} alt={game.name} />;
  if (href) return <a className={cls} href={href} title={title || game.name} onClick={(e) => gpNav(e, onSwitch, game.key)}>{inner}</a>;
  return (
    <div className={cls} title={title || game.name}>{inner}</div>
  );
}

/* nyx logo as the back-to-Worlds button */
function GPLogoBack({ size }){
  return (
    <button type="button" className="gp-logo-btn" title="Back to Worlds">
      <img src="../assets/icon/nyx_logo.png" alt="Back to Worlds" style={size ? { width:size+'px', height:size+'px' } : undefined} />
    </button>
  );
}

/* Nyx medallion — the hub's living eye (gaze follows the mouse,
   vibrates with excitement when hovered) */
function GPMedSim({ on, href, onSwitch }){
  const ref = React.useRef(null);
  const ballRef = React.useRef(null);
  React.useEffect(() => {
    const eye = ref.current, ball = ballRef.current;
    if (!eye || !ball) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = null;
    const onMove = (e) => {
      if (raf) return;
      const mx = e.clientX, my = e.clientY;
      raf = requestAnimationFrame(() => {
        raf = null;
        const rc = eye.getBoundingClientRect();
        const cx = rc.left + rc.width / 2;
        const cy = rc.top + rc.height * 0.46;
        const dx = mx - cx, dy = my - cy;
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 240);
        ball.style.transform = 'translate(' + (dx / d * k * 3.4).toFixed(1) + 'px,' + (dy / d * k * 1.6).toFixed(1) + 'px)';
      });
    };
    document.addEventListener('mousemove', onMove);
    return () => { document.removeEventListener('mousemove', onMove); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return (
    <a ref={ref} href={href || GP_PAGE_HREF.nyx} className={'gp-med sim' + (on ? ' on' : ' sz-sm')} title="Nyx" onClick={(e) => gpNav(e, onSwitch, 'nyx')}>
      <span className="ballvibe"><span className="ballscale"><span ref={ballRef} className="slayer ball"></span></span></span>
      <span className="slayer lid"></span>
      <span className="slayer drips"></span>
    </a>
  );
}

/* Nyx eye first, then the active game, then the rest.
   When Nyx itself is active, the eye IS the highlighted medallion. */
/* fixed game order on every page — the current page's icon is highlighted
   in place (never reordered to the front) so positions stay stable. */
function GPGameRail({ active, onSwitch }){
  const isNyx = active === 'nyx';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
      <GPMedSim on={isNyx} href={GP_PAGE_HREF.nyx} onSwitch={onSwitch} />
      <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
        {GP_GAMES.filter(g => g.key !== 'nyx').map(g => (
          <GPMedallion key={g.key} game={g} size="sm"
                       on={g.key === active} dim={g.key !== active}
                       href={GP_PAGE_HREF[g.key]} onSwitch={onSwitch} />
        ))}
      </div>
    </div>
  );
}

/* overflow favourites — row of small character icons (placeholder art) */
function GPMoreFavs({ count, icon }){
  const n = count || 8;
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'12px' }}>
      {Array.from({ length:n }).map((_, i) => (
        <div key={i} className="gp-med sz-sm dim" title="Pinned favourite">
          <img src={icon || '../assets/icon/giicon.png'} alt="Pinned favourite" />
        </div>
      ))}
    </div>
  );
}

/* horizontal medallion strip — all games except `active` */
function GPSwitcher({ active, size, gap }){
  return (
    <div style={{ display:'flex', alignItems:'center', gap:(gap || 14) + 'px' }}>
      {GP_GAMES.filter(g => g.key !== active).map(g => (
        <GPMedallion key={g.key} game={g} size={size} />
      ))}
    </div>
  );
}

/* vertical world rows (sidebar) — medallion + name */
function GPWorldRows({ active }){
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
      {GP_GAMES.filter(g => g.key !== active).map(g => (
        <div key={g.key} className="gp-world-row">
          <GPMedallion game={g} size="sm" />
          <span className="wn">{g.name}</span>
        </div>
      ))}
    </div>
  );
}

function GPFnRows(){
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
      {GP_FNS.map(f => (
        <div key={f} className="gp-fn-row">
          <span>{f}</span>
          <span className="go">{'\u203A'}</span>
        </div>
      ))}
    </div>
  );
}

function GPFnTabs({ small }){
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
      {GP_FNS.map(f => (
        <GPHex key={f} small={small}>
          <span className="dia"></span>
          <span>{f}</span>
        </GPHex>
      ))}
    </div>
  );
}

function GPFav({ w, h, land, name, art, pos }){
  return (
    <div className={'gp-fav' + (land ? ' land' : '')} style={{ width:w + 'px', height:h + 'px' }}>
      <div className="frame"></div>
      <div className="topline"></div>
      <div className="artwrap">
        <div className="art" style={{ backgroundImage:'url(' + (art || '../assets/char/skirk.jpg') + ')', backgroundPosition: pos || undefined }}></div>
        <div className="scrim"></div>
      </div>
      <span className="pin"></span>
      <div className="nm">{name || 'Skirk'}</div>
    </div>
  );
}

function GPBanner({ w, h, next, compact, ph, title, five, fiveIcon, status, fourStars, chips, time, pct, art }){
  const stars = fourStars || ['Bennett', 'Xiangling', 'Fischl'];
  const usePh = ph !== undefined ? ph : next;
  const showStars = !next && !(compact && fourStars === null);
  const chipRows = chips || stars.map((s) => ({ key:s, text:'4\u2605 ' + s }));
  return (
    <div className={'gp-ban' + (compact ? ' compact' : '')} style={{ width: w ? w + 'px' : undefined, height: h ? h + 'px' : undefined }}>
      <span className="rim"></span>
      <div className="body" style={{ height:'100%' }}>
        {usePh
          ? <div className="art ph"><span className="phnote">banner art</span></div>
          : <div className="art" style={{ backgroundImage:'url(' + (art || '../assets/banner/skirk_namecard.png') + ')' }}></div>}
        <div className="shade"></div>
        <div className="inner" style={{ height:'100%' }}>
          <div className="ban-head">
            <div className={'status' + (next ? ' next' : '')}>
              <span className="dot"></span>
              <span>{status || (next ? 'Up next \u00B7 Phase II' : 'Ongoing \u00B7 Phase I')}</span>
            </div>
            <span className="tm">{time || (next ? 'Starts in 11d 22h' : 'Ends in 11d 22h 14m')}</span>
          </div>
          <div className="bt">{title || (next ? 'To Be Revealed' : 'Lone Shadow')}</div>
          <div className="feat">
            <span className="chip five">
              {fiveIcon && <img src={fiveIcon} alt="" draggable="false" />}
              {five || (next ? '5\u2605 ???' : '5\u2605 Skirk')}
            </span>
            {showStars && chipRows.map(s => (
              <span key={s.key || s.text || s} className="chip">
                {s.icon && <img src={s.icon} alt="" draggable="false" />}
                {s.text || s}
              </span>
            ))}
          </div>
          <div className="cd">
            {!next && <span className="bar"><i style={{ width:(pct || 42) + '%' }}></i></span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function GPCodeRow({ code, reward }){
  const [ok, setOk] = React.useState(false);
  const copy = () => {
    try { navigator.clipboard.writeText(code); } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = code; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) {}
      ta.remove();
    }
    setOk(true);
    setTimeout(() => setOk(false), 1600);
  };
  return (
    <div className="gp-code">
      <span className="cc">{code}</span>
      <span className="rw">{reward}</span>
      <button type="button" className={'cp' + (ok ? ' ok' : '')} onClick={copy}>{ok ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

function GPCodes({ gap }){
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:(gap || 10) + 'px' }}>
      {GP_CODES.map(c => <GPCodeRow key={c.code} code={c.code} reward={c.reward} />)}
    </div>
  );
}

Object.assign(window, {
  GPRoot, GPSec, GPHex, GPBack, GPMedallion, GPSwitcher, GPWorldRows,
  GPFnRows, GPFnTabs, GPFav, GPBanner, GPCodes, GP_GAMES, GP_FNS, GP_CODES,
  GPLogoBack, GPGameRail, GPMoreFavs, GPMedSim,
});
