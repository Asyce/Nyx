// ============================================================
// Nyx — Game Page shared components (Genshin placeholder)
// Exports to window: GPRoot, GPSec, GPHex, GPBack, GPMedallion,
// GPSwitcher, GPFnRows, GPFav, GPCodes, GP_GAMES, GP_FNS
// ============================================================

const GP_GAMES = [
  { key:'nyx',  name:'Nyx',        icon:'../assets/icon/noxicon.png', glyph:true },
  { key:'gi',   name:'Genshin Impact',    icon:'../assets/icon/giicon.png' },
  { key:'hsr',  name:'Honkai: Star Rail', icon:'../assets/icon/hsricon.png' },
  { key:'zzz',  name:'Zenless Zone Zero', icon:'../assets/icon/zzzicon.png' },
  { key:'wuwa', name:'Wuthering Waves',   icon:'../assets/icon/wuwaicon.png' },
  { key:'ae',   name:'Arknights: Endfield', icon:'../assets/icon/aeicon.png' },
];

const GP_FNS = ['Character Materials', 'Database', 'Wish Tracker'];

/* each game key → its page, so the top rail icons navigate to the page they
   represent. Extensionless clean URLs (Cloudflare serves /hsr from hsr.html). */
const GP_PAGE_HREF = {
  nyx:  '/nyx',
  gi:   '/genshin',
  hsr:  '/hsr',
  zzz:  '/zzz',
  wuwa: '/wuwa',
  ae:   '/endfield',
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

function GPMedallion({ game, size, on, dim, title, href, onSwitch, railRival }){
  const cls = 'gp-med' + (size === 'sm' ? ' sz-sm' : '') + (on ? ' on' : '') + (dim ? ' dim' : '');
  const inner = <img className={game.glyph ? 'glyph' : ''} src={game.icon} alt={game.name} />;
  if (href) return <a className={cls} href={href} title={title || game.name} data-nyx-rail-rival={railRival ? 'true' : undefined} onClick={(e) => gpNav(e, onSwitch, game.key)}>{inner}</a>;
  return (
    <div className={cls} title={title || game.name} data-nyx-rail-rival={railRival ? 'true' : undefined}>{inner}</div>
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
  const sadRef = React.useRef(false);
  React.useEffect(() => {
    const eye = ref.current, ball = ballRef.current;
    if (!eye || !ball) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = null;
    const onMove = (e) => {
      if (sadRef.current) return;
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
  React.useEffect(() => {
    const eye = ref.current, ball = ballRef.current;
    const rail = eye && eye.closest('.gp-game-rail');
    if (!eye || !ball || !rail) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let sad = false;
    let sadTimer = null;
    let droopTimer = null;
    const clearSad = () => {
      clearTimeout(sadTimer);
      clearTimeout(droopTimer);
      sadRef.current = false;
      if (sad) {
        sad = false;
        eye.classList.remove('sad');
        ball.style.transition = '';
      }
    };
    const onOver = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !target.closest('[data-nyx-rail-rival]')) return;
      clearTimeout(sadTimer);
      clearTimeout(droopTimer);
      sadTimer = setTimeout(() => {
        sad = true;
        sadRef.current = true;
        eye.classList.add('sad');
        ball.style.transition = 'transform 1.1s cubic-bezier(.4,.1,.3,1)';
        ball.style.transform = 'translate(0px, 0px)';
        droopTimer = setTimeout(() => {
          if (!sad) return;
          ball.style.transition = 'transform 1.9s cubic-bezier(.45,.05,.3,1)';
          ball.style.transform = 'translate(0px, 5px)';
        }, 1150);
      }, 500);
    };
    const onOut = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const rival = target && target.closest('[data-nyx-rail-rival]');
      const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (!rival || (related && rival.contains(related))) return;
      clearSad();
    };
    rail.addEventListener('mouseover', onOver);
    rail.addEventListener('mouseout', onOut);
    return () => {
      rail.removeEventListener('mouseover', onOver);
      rail.removeEventListener('mouseout', onOut);
      clearSad();
    };
  }, []);
  return (
    <a ref={ref} href={href || GP_PAGE_HREF.nyx} className={'gp-med sim' + (on ? ' on' : ' sz-sm dim')} title="Nyx" onClick={(e) => gpNav(e, onSwitch, 'nyx')}>
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
function GPGameRail({ active, onSwitch, displayGames, gameIcons }){
  const isNyx = active === 'nyx';
  const visible = (g) => !displayGames || displayGames[g.key] !== false;
  return (
    <div className="gp-game-rail">
      <GPMedSim on={isNyx} href={GP_PAGE_HREF.nyx} onSwitch={onSwitch} />
      <div className="gp-game-rail-icons">
        {GP_GAMES.filter(g => g.key !== 'nyx' && visible(g)).map(g => {
          const icon = gameIcons && gameIcons[g.key] ? gameIcons[g.key] : g.icon;
          const view = icon === g.icon ? g : Object.assign({}, g, { icon });
          return (
            <GPMedallion key={g.key} game={view} size="sm"
                         on={g.key === active} dim={g.key !== active}
                         href={GP_PAGE_HREF[g.key]} onSwitch={onSwitch} railRival />
          );
        })}
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

function GPSectionNavButton({ active, label, onActivate, diamond = true, arrow = true, className = '' }){
  return (
    <button type="button"
            className={'gp-fn-row click gp-section-nav-button' + (active ? ' on' : '') + (className ? ' ' + className : '')}
            aria-current={active ? 'page' : undefined}
            onClick={onActivate}>
      {diamond && <span className="dia" aria-hidden="true"></span>}
      <span>{label}</span>
      {arrow && <span className="go" aria-hidden="true">{'›'}</span>}
    </button>
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
  GPFnRows, GPFnTabs, GPFav, GPCodes, GP_GAMES, GP_FNS, GP_CODES,
  GPLogoBack, GPGameRail, GPMoreFavs, GPMedSim,
});
