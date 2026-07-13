import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'banners') + path.sep;
const OUT = path.join(HERE, 'timeline-redesign.html');
const b64=k=>'data:image/png;base64,'+fs.readFileSync(DIR+`f_${k}.png`).toString('base64');
// Real site fonts, subset to latin (fonts/ holds pyftsubset output of
// Site/assets/fonts/GI.ttf + HSR.ttf — ~17KB total, so they inline fine).
const f64=p=>'data:font/woff2;base64,'+fs.readFileSync(path.join(HERE,'fonts',p)).toString('base64');
const GIF=f64('GI-sub.woff2'), HSRF=f64('HSR-sub.woff2');
const e64=p=>'data:image/jpeg;base64,'+fs.readFileSync(path.join(HERE,'events',p)).toString('base64');
const EART={
 ley:e64('ley-line-overflow.jpg'),
 marvelous:e64('marvelous-merchandise.jpg'),
 temper:e64('to-temper-thyself-and-journey-far.jpg'),
 stygian:e64('stygian-onslaught.jpg'),
};
const KEYS=['chasca','emilie','nefer','durin','nicole','mavuika','lohen','citlali','sandrone','mizuki'];
const ART={}; for(const k of KEYS) ART[k]=b64(k);
// Real 4-star rate-ups from the wiki (only where cleanly parsed; two rows merged
// with the weapon banner, so those stay null rather than show wrong units).
const FOURS={chasca:['Ororon','Sucrose','Barbara'],emilie:null,nefer:['Xingqiu','Collei','Yaoyao'],
 durin:['Jahoda','Bennett','Faruzan'],nicole:['Prune','Razor','Fischl'],mavuika:['Kachina','Bennett','Diona'],
 lohen:['Mika','Xiangling','Bennett'],citlali:['Kachina','Bennett','Diona'],sandrone:['Beidou','Diona','Freminet'],mizuki:null};

const U=(y,m,d)=>Date.UTC(y,m,d), DAY=86400000;
const NOW=U(2026,6,13);
const iso=ms=>new Date(ms).toISOString().slice(0,10);
// fandom page titles use a straight apostrophe (filenames were %27), not the
// typographic ’ we keep for display — normalise so the source link resolves.
const srcUrl=(name,ms)=>'https://genshin-impact.fandom.com/wiki/'+encodeURI(name.replace(/’/g,"'").replace(/ /g,'_'))+'/'+iso(ms);
// [char, banner, artKey, start, end, lane, state, version]
// Dates are illustrative but laid out as contiguous non-overlapping phases.
const B=[
 ['Chasca','Piercing Shot’s Crimson Wake','chasca',U(2026,3,8),U(2026,3,22),0,'past','Luna V'],
 ['Emilie','Dewlit Tranquility','emilie',U(2026,3,28),U(2026,4,18),0,'past','Luna VI'],
 ['Nefer','Temptation of the Crimson Sands','nefer',U(2026,3,28),U(2026,4,18),1,'past','Luna VI'],
 ['Durin','Rubedo, of White Stone Born','durin',U(2026,4,19),U(2026,5,9),0,'past','Luna VII'],
 ['Nicole','Angel’s Reverie','nicole',U(2026,4,19),U(2026,5,9),1,'past','Luna VII'],
 ['Mavuika','Ancient Flame Ablaze','mavuika',U(2026,5,10),U(2026,5,30),0,'past','Luna VII'],
 ['Lohen','Frostedge Nocturne','lohen',U(2026,5,10),U(2026,5,30),1,'past','Luna VII'],
 ['Citlali','Starry Night’s Whispers','citlali',U(2026,6,1),U(2026,6,22),0,'live','Luna VIII'],
 ['Sandrone','To the Looking-Glass the Mademoiselle Said','sandrone',U(2026,6,1),U(2026,6,22),1,'live','Luna VIII'],
 ['Yumemizuki Mizuki','Heavenlit Prophecy','mizuki',U(2026,6,22),U(2026,7,12),0,'upcoming','Luna VIII'],
 ['—','Next phase — dates unconfirmed',null,U(2026,6,22),U(2026,7,12),1,'expected','Luna VIII'],
];
// [title, useful description, start, end, state, lane, art key, source]
const EV=[
 ['Ley Line Overflow','Claim double rewards from Blossoms of Wealth and Revelation up to three times each day.',U(2026,3,9),U(2026,3,20),'past',0,'ley','https://www.hoyolab.com/article/21658752'],
 ['Marvelous Merchandise','Trade simple materials with Liben for Boxes o’ Marvels and a final Mega Box reward.',U(2026,4,12),U(2026,4,26),'past',0,'marvelous','https://www.hoyolab.com/article/43059628'],
 ['To Temper Thyself and Journey Far','Complete daily and weekly training goals to earn long-term character development rewards.',U(2026,5,25),U(2026,6,21),'live',0,'temper','https://www.hoyolab.com/article/45054197'],
];
const ACT=[]; for(let m=3;m<=6;m++){ ACT.push(['Spiral Abyss',U(2026,m,16),U(2026,m+1,1),0]); ACT.push(['Imaginarium Theater',U(2026,m,1),U(2026,m,19),1]); }
ACT.push(['Imaginarium Theater',U(2026,7,1),U(2026,7,19),1]);
const FEATURED_ACTIVITY=['Stygian Onslaught','A rotating high-difficulty combat challenge with escalating difficulty and performance rewards.',U(2026,6,16),U(2026,7,4),'upcoming','stygian','https://www.hoyolab.com/article/39387781'];
const MK=[['Save primogems for Citlali',U(2026,4,25),U(2026,6,1),'save'],['Welkin runs out',U(2026,6,4),null,'point']];
const RIB=[['Luna V',U(2026,3,8),U(2026,3,28)],['Luna VI',U(2026,3,28),U(2026,4,19)],['Luna VII',U(2026,4,19),U(2026,6,1)],['Luna VIII',U(2026,6,1),U(2026,7,12)]];
const FORECAST_START=U(2026,7,12);

const MSPX=0.1*DAY;
// Keep enough quiet future canvas after the final illustrative phase for Today
// to sit near the visual centre instead of being clamped against the right edge.
const T0=U(2026,3,1), T1=U(2026,8,15), SPAN=T1-T0, W=Math.round(SPAN/MSPX);
const x=ms=>Math.round((ms-T0)/MSPX), w=(a,b)=>Math.max(120,Math.round((b-a)/MSPX));
const pc=ms=>((ms-T0)/SPAN*100);   // percent across full range (for minimap)
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const CH=118, STRIDE=128, LTOP=30;
const TRACK_TOP=26, EVH=38, EVSTRIDE=42, ACTH=22, ACTSTRIDE=26;
const fmt=ms=>{const d=new Date(ms);return MON[d.getUTCMonth()]+' '+d.getUTCDate();};

let ticks='',grid='';
for(let m=3;m<=8;m++){
  const t=U(2026,m,1);
  ticks+=`<span class="tk major" style="left:${x(t)}px"><b>${MON[m]}<i>2026</i></b></span>`;
  grid+=`<i style="left:${x(t)}px"></i>`;
}
// True UTC calendar weeks. The canvas begins on a Wednesday and ends at the
// start of a Tuesday, so the edge weeks are clipped and explicitly partial.
const mondayOf=ms=>ms-((new Date(ms).getUTCDay()+6)%7)*DAY;
const WEEK_ROWS=[];
let weeks='',weekGrid='',weekStart=mondayOf(T0),weekIndex=0;
for(;weekStart<T1;weekStart+=7*DAY,weekIndex++){
  const fullEnd=weekStart+7*DAY, a=Math.max(T0,weekStart), b=Math.min(T1,fullEnd);
  const partial=a!==weekStart||b!==fullEnd, lastDay=b-DAY;
  const ad=new Date(a), zd=new Date(lastDay), width=x(b)-x(a);
  const days=`${ad.getUTCDate()}&ndash;${zd.getUTCDate()}`;
  const cadence=partial?`${DOW[ad.getUTCDay()]}&ndash;${DOW[zd.getUTCDay()]}`:'Mon&ndash;Sun';
  const label=width>=44?`<b>${days}</b><i>${cadence}</i>`:'';
  const title=`${partial?'Partial week · visible ':'Week · '}${DOW[ad.getUTCDay()]} ${fmt(a)} – ${DOW[zd.getUTCDay()]} ${fmt(lastDay)}`;
  const cls=`wk ${weekIndex%2?'odd':'even'}${partial?' partial':''}`;
  weeks+=`<span class="${cls}" style="left:${x(a)}px;width:${width}px" title="${title}">${label}</span>`;
  weekGrid+=`<span class="week-band ${weekIndex%2?'odd':'even'}${partial?' partial':''}" style="left:${x(a)}px;width:${width}px"></span>`;
  WEEK_ROWS.push({weekStart,a,b,partial});
}
grid+=weekGrid;
// alternating version tint bands behind everything + a boundary line per version
grid+=RIB.map(([v,a,b],i)=>`<em style="left:${x(a)}px;width:${x(b)-x(a)}px;${i%2?'background:rgba(139,123,255,.045);':''}"></em>`).join('');
const rib=RIB.map(([v,a,b])=>`<span class="ver" style="left:${x(a)}px;width:${x(b)-x(a)}px"><i>${v}</i></span>`).join('');

// phase index within a version (only labelled when the version has >1 phase)
const PH={};
for(const b of B){(PH[b[7]]??=new Set()).add(b[3]);}
const phOf=(ver,a)=>{const arr=[...PH[ver]].sort((x,y)=>x-y);return arr.length>1?arr.indexOf(a)+1:0;};
const phaseSeen=new Set(), PHASES=[];
for(const b of B){const k=b[3]+'-'+b[4];if(phaseSeen.has(k))continue;phaseSeen.add(k);PHASES.push([b[3],b[4],b[6]]);}
grid+=PHASES.map(([a])=>`<b class="phase-line" style="left:${x(a)}px"></b>`).join('');
const phaseRail=PHASES.map(([a,e,st])=>{
 const sample=B.find(b=>b[3]===a&&b[4]===e), ph=sample?phOf(sample[7],a):0;
 const live=st==='live'?`<em>Live · ${Math.max(0,Math.round((e-NOW)/DAY))}d</em>`:'';
 return `<span class="phase ${st}" style="left:${x(a)}px;width:${x(e)-x(a)}px"><b>${ph?`Phase ${ph}`:'Phase'}</b><i>${fmt(a)} – ${fmt(e)}</i>${live}</span>`;
}).join('');
function banner(b){
 const [ch,name,art,a,e,lane,state,ver]=b;
 const live=state==='live',exp=state==='expected',past=state==='past',up=state==='upcoming';
 const days=Math.round((e-a)/DAY), remain=Math.max(0,Math.round((e-NOW)/DAY));
 const status=exp?'Expected':live?`Live · ${remain}d`:up?'Upcoming':'Ended';
 const cls='tile'+(past?' past':'')+(live?' live':'')+(exp?' expected':'')+(up?' up':'');
 const bg=art?`<span class="art" style="background-image:url('${ART[art]}')"></span><span class="scrim"></span>`:'';
 const ph=phOf(ver,a);
 const nm=exp?`<span class="exlabel"><b>${ch==='—'?'Next 5★':ch}</b><i>dates not confirmed</i></span>`
            :`<span class="nm"><b>${ch}</b></span>`;
 // Expected is uncertainty intrinsic to this card. Live/upcoming belong to the
 // shared phase rail, so paired character art stays clean.
 const chip=exp?`<span class="chip">Expected</span>`:'';
 const fours=(art&&FOURS[art])?FOURS[art].join(', '):'';
 const src=exp?'':srcUrl(name,a);
 return `<button class="${cls}" title="${ch} — ${name}" data-ch="${ch}" data-name="${name}" data-when="${fmt(a)} – ${fmt(e)} · ${days} days" data-k="${ver}${ph?` · Phase ${ph}`:''} · NA" data-remain="${live?(e-NOW):0}" data-fours="${fours}" data-src="${src}" data-search="${(ch+' '+name+' '+fours).toLowerCase()}" style="left:${x(a)+4}px;top:${LTOP+lane*STRIDE}px;width:${Math.max(112,w(a,e)-8)}px;height:${CH}px" aria-label="${ch} banner, ${status}">
   ${bg}${chip}${nm}</button>`;
}
function ev(e){const[t,d,a,b,st,lane,art,src]=e;
 const past=st==='past', lbl=past?'Ended':st==='live'?'Ongoing':'Upcoming';
 const cls='tile event '+(st==='live'?'ongoing':past?'pastc':'up')+(w(a,b)<170?' sm':'');
 const chip=past?'':`<span class="chip">${lbl}</span>`;   // past events self-explain, like past banners
 return `<button class="${cls}" title="${t}" data-ch="${t}" data-name="${d}" data-when="${fmt(a)} – ${fmt(b)} · ${Math.round((b-a)/DAY)} days" data-k="Official event · ${lbl}" data-remain="${st==='live'?b-NOW:0}" data-fours="" data-src="${src}" data-search="${(t+' '+d).toLowerCase()}" style="--entry-art:url('${EART[art]}');left:${x(a)}px;top:${TRACK_TOP+lane*EVSTRIDE}px;width:${w(a,b)}px;height:${EVH}px"><span class="evt">${t}</span><span class="evd">${fmt(a)} – ${fmt(b)}</span>${chip}</button>`;}
function actc(a){const[label,s,e,lane]=a;return `<span class="chip-act${e<=NOW?' past':''}" style="left:${x(s)}px;width:${x(e)-x(s)}px;top:${TRACK_TOP+lane*ACTSTRIDE}px;height:${ACTH}px" title="${label} (recurring)">${label}</span>`;}
function mkc(m){const[label,s,e,kind]=m;const past=(e||s)<NOW?' past':'';if(kind==='point')return `<span class="mkpt${past}" style="left:${x(s)}px;top:${TRACK_TOP}px" title="${label}"><i></i>${label}</span>`;return `<span class="chip-mk${past}" style="left:${x(s)}px;width:${x(e)-x(s)}px;top:${TRACK_TOP}px" title="${label}">${label}</span>`;}
function featuredActivity(a){const[t,d,s,e,st,art,src]=a;const lbl=st==='live'?'Ongoing':'Upcoming';return `<button class="tile feature-act ${st==='live'?'ongoing':'up'}" title="${t}" data-ch="${t}" data-name="${d}" data-when="${fmt(s)} – ${fmt(e)} · ${Math.round((e-s)/DAY)} days" data-k="Featured activity · ${lbl}" data-remain="${st==='live'?e-NOW:0}" data-fours="" data-src="${src}" data-search="${(t+' '+d).toLowerCase()}" style="--entry-art:url('${EART[art]}');left:${x(s)}px;top:${TRACK_TOP+2*ACTSTRIDE+8}px;width:${w(s,e)}px;height:48px"><span class="evt">${t}</span><span class="evd">${fmt(s)} – ${fmt(e)}</span><span class="chip">${lbl}</span></button>`;}
const banners=B.map(banner).join(''), events=EV.map(ev).join('');
const acts=ACT.map(actc).join('')+featuredActivity(FEATURED_ACTIVITY), marks=MK.map(mkc).join('');
let miniMonths='';for(let m=3;m<=8;m++)miniMonths+=`<u style="left:${pc(U(2026,m,1))}%">${MON[m]}</u>`;
const laneRows=Math.max(...B.map(b=>b[5]))+1, evRows=Math.max(...EV.map(e=>e[5]))+1;
const CHARH=LTOP+laneRows*STRIDE+8;
const EVHALL=TRACK_TOP+(evRows-1)*EVSTRIDE+EVH+10;
const ACTHALL=TRACK_TOP+2*ACTSTRIDE+8+48+10;
const MKHALL=TRACK_TOP+24+10;

let html=`<title>Nyx Timeline — real banner art (16:9)</title>
<style>
@font-face{font-family:'GI';src:url('${GIF}') format('woff2');font-display:swap;}
@font-face{font-family:'HSR';src:url('${HSRF}') format('woff2');font-display:swap;}
:root{color-scheme:dark;--ink:#f3f0ff;--muted:#9c93c4;--muted2:#6f6790;--line:rgba(183,170,255,.16);--acc:#8b7bff;--acc2:#b7aaff;
--hclip:polygon(0% 50%, 10px 0%, calc(100% - 10px) 0%, 100% 50%, calc(100% - 10px) 100%, 10px 100%);}
*{box-sizing:border-box;}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important;}}
body{margin:0;background:radial-gradient(100% 70% at 76% -8%,rgba(120,86,220,.16),transparent 58%),radial-gradient(70% 60% at 8% 45%,rgba(183,170,255,.035),transparent 62%),#05040b;color:var(--ink);font-family:'HSR','Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding:18px 20px 36px;}
.wrap{max-width:1560px;margin:0 auto;}
.eyebrow{font:600 10px/1 'HSR',system-ui;letter-spacing:.18em;text-transform:uppercase;color:#c6b8ff;opacity:.85;}
h1{margin:6px 0 14px;font:400 30px/1 'GI',Georgia,serif;letter-spacing:.01em;}
.tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;}
.tools button,.tools .field{height:34px;display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;background:rgba(25,19,51,.8);color:#e9e2ff;font:600 12.5px 'HSR',system-ui;padding:0 12px;cursor:pointer;transition:background .14s,border-color .14s;}
.tools button:hover{background:rgba(139,123,255,.35);border-color:rgba(183,170,255,.4);}
.tools button:focus-visible,.tile:focus-visible,.mini:focus-visible,.lgb:focus-visible{outline:2px solid var(--acc2);outline-offset:2px;}
.tools #today{clip-path:var(--hclip);border:0;border-radius:0;padding:0 18px;background:rgba(139,123,255,.22);}
.tools #today:hover{background:rgba(139,123,255,.4);}
.tools .field{background:rgba(9,7,20,.6);color:var(--muted);gap:7px;padding-right:8px;}
.tools .field input{border:0;background:transparent;color:var(--ink);font:500 13px 'HSR',system-ui;outline:none;width:130px;}
.tools .field input::placeholder{color:var(--muted2);}
.count{font-size:11px;color:var(--muted);}
.seg{display:flex;border-radius:8px;overflow:hidden;background:rgba(9,7,20,.6);border:1px solid var(--line);}
.seg button{border:0;border-radius:0;height:32px;background:transparent;color:var(--muted);padding:0 12px;font:600 12.5px 'HSR',system-ui;cursor:pointer;}
.seg button.on{background:rgba(139,123,255,.3);color:#fff;}
.layers{display:flex;gap:6px;align-items:center;margin-left:auto;}
.layers b{font:600 9.5px 'HSR',system-ui;letter-spacing:.12em;text-transform:uppercase;color:var(--muted2);margin-right:2px;}
.lgb{height:26px;border:0;clip-path:var(--hclip);background:rgba(139,123,255,.18);color:#d9d0f5;font:600 10.5px 'HSR',system-ui;padding:0 15px;cursor:pointer;transition:opacity .12s,background .12s;}
.lgb:hover{background:rgba(139,123,255,.32);}
.lgb.off{background:rgba(139,123,255,.06);color:var(--muted2);opacity:.65;text-decoration:line-through;}
.workspace{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px;align-items:start;}
.stage{min-width:0;}
.timeline-frame{display:grid;grid-template-columns:116px minmax(0,1fr);overflow:hidden;border:1px solid rgba(183,170,255,.22);border-radius:16px;background:linear-gradient(180deg,rgba(25,19,51,.55),rgba(12,9,34,.95));box-shadow:0 18px 50px rgba(2,1,8,.28);}
.track-rail{position:relative;z-index:12;background:linear-gradient(180deg,rgba(18,13,38,.98),rgba(10,8,24,.98));border-right:1px solid rgba(183,170,255,.16);}
.rail-head{display:flex;flex-direction:column;justify-content:space-between;height:104px;padding:13px 12px 11px;color:var(--muted2);font:600 9px 'HSR',system-ui;letter-spacing:.12em;text-transform:uppercase;}
.rail-head span{align-self:flex-end;color:#77708f;}
.rail-head b{margin-top:4px;color:#dcd4f5;font:400 16px 'GI',Georgia,serif;letter-spacing:0;text-transform:none;}
.rail-row{display:flex;align-items:flex-start;padding:13px 12px 0;border-top:1px solid rgba(183,170,255,.1);color:#c9c0e2;font:600 10px 'HSR',system-ui;letter-spacing:.055em;text-transform:uppercase;}
.rail-row span{display:flex;align-items:center;gap:7px;line-height:1.25;}
.rail-row i{width:6px;height:6px;transform:rotate(45deg);background:#8b7bff;box-shadow:0 0 8px rgba(139,123,255,.7);flex:none;}
.rail-row.ev i{border-radius:50%;transform:none;background:#b5a7ff;}
.rail-row.act i{background:transparent;border:1px solid #b7aaff;box-shadow:0 0 7px rgba(183,170,255,.38);}
.rail-row.mk i{background:transparent;border:1px solid #b8aaff;box-shadow:none;}
.scroll{position:relative;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;background:radial-gradient(120% 90% at 80% -12%,rgba(120,86,220,.1),transparent 55%),linear-gradient(180deg,rgba(25,19,51,.55),rgba(12,9,34,.95));scroll-behavior:smooth;}
.scroll::-webkit-scrollbar{display:none;}
.canvas{position:relative;width:${W}px;}
.ruler{position:relative;height:58px;overflow:hidden;border-bottom:1px solid rgba(183,170,255,.16);background:rgba(7,5,16,.4);z-index:2;}
.tk{position:absolute;top:0;bottom:0;border-left:1px solid rgba(183,170,255,.26);}
.tk b{position:absolute;top:7px;left:9px;display:inline-flex;align-items:baseline;gap:6px;color:#efe9ff;font:400 15px 'GI',Georgia,serif;white-space:nowrap;}
.tk b i{font:600 9px 'HSR',system-ui;font-style:normal;letter-spacing:.08em;color:#8f85b0;}
.wk{position:absolute;top:27px;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border-left:1px solid rgba(183,170,255,.2);border-top:1px solid rgba(183,170,255,.08);color:#847c9e;font-family:'HSR',system-ui;white-space:nowrap;overflow:hidden;}
.wk.odd{background:rgba(139,123,255,.035);}
.wk b{color:#b9b0d0;font:600 9px/1 'HSR',system-ui;letter-spacing:.02em;}
.wk i{color:#746d8d;font:600 6.5px/1 'HSR',system-ui;font-style:normal;letter-spacing:.12em;text-transform:uppercase;}
.wk.partial{border-left-style:dashed;background-image:repeating-linear-gradient(135deg,rgba(183,170,255,.035) 0 3px,transparent 3px 7px);}
.grid{position:absolute;top:58px;left:0;right:0;bottom:0;z-index:0;pointer-events:none;}
.grid i{position:absolute;top:0;bottom:0;border-left:1px solid rgba(183,170,255,.07);}
.grid em{position:absolute;top:0;bottom:0;border-left:1px solid rgba(183,170,255,.12);}
.grid .week-band{position:absolute;top:0;bottom:0;border-left:1px solid rgba(183,170,255,.095);}
.grid .week-band.odd{background:rgba(139,123,255,.018);}
.grid .week-band.partial{border-left-style:dashed;background-image:repeating-linear-gradient(135deg,rgba(183,170,255,.018) 0 4px,transparent 4px 10px);}
.grid .phase-line{position:absolute;top:46px;bottom:0;width:1px;background:linear-gradient(180deg,rgba(183,170,255,.28),rgba(183,170,255,.08) 42%,rgba(183,170,255,.03));}
.forecast{position:absolute;z-index:1;top:104px;bottom:0;border-left:1px dashed rgba(183,170,255,.2);background-image:radial-gradient(circle,rgba(183,170,255,.12) 1px,transparent 1.5px),linear-gradient(90deg,rgba(183,170,255,.025),transparent 58%);background-size:34px 34px,100% 100%;pointer-events:none;}
.forecast span{position:absolute;top:15px;left:16px;display:flex;align-items:center;gap:7px;color:rgba(198,184,255,.5);font:600 8.5px 'HSR',system-ui;letter-spacing:.13em;text-transform:uppercase;white-space:nowrap;}
.forecast span::before{content:"";width:18px;border-top:1px solid rgba(183,170,255,.32);}
.ribbons{position:relative;height:46px;overflow:hidden;border-bottom:1px solid rgba(183,170,255,.12);background:rgba(9,7,20,.48);}
.ribbons .ver{position:absolute;top:0;height:22px;display:flex;align-items:center;min-width:20px;color:#c9baff;font:600 9.5px 'HSR',system-ui;letter-spacing:.11em;text-transform:uppercase;white-space:nowrap;border-left:2px solid rgba(139,123,255,.52);background:linear-gradient(90deg,rgba(139,123,255,.16),transparent 64%);}
.ribbons .ver>i{font-style:normal;position:sticky;left:12px;padding:0 4px;}
.ribbons .phase{position:absolute;bottom:0;height:24px;display:flex;align-items:center;gap:7px;overflow:hidden;padding:0 9px;border-left:1px solid rgba(183,170,255,.24);border-top:1px solid rgba(183,170,255,.08);color:#cfc6ea;white-space:nowrap;}
.ribbons .phase b{font:600 9px 'HSR',system-ui;letter-spacing:.07em;text-transform:uppercase;color:#ebe5ff;}
.ribbons .phase i{font:500 8.5px 'HSR',system-ui;font-style:normal;letter-spacing:.04em;text-transform:uppercase;color:var(--muted2);}
.ribbons .phase em{margin-left:auto;padding:2px 6px;border-radius:999px;background:rgba(183,170,255,.11);color:#ddd4ff;font:600 8px 'HSR',system-ui;font-style:normal;letter-spacing:.07em;text-transform:uppercase;}
.ribbons .phase.live{background:linear-gradient(90deg,rgba(183,170,255,.1),rgba(139,123,255,.08));}
.ribbons .phase.upcoming::after{content:"Up next";margin-left:auto;padding:2px 6px;border-radius:999px;background:rgba(139,123,255,.12);color:#cfc5ff;font:600 8px 'HSR',system-ui;letter-spacing:.07em;text-transform:uppercase;}
.ribbons .phase.expected{border-top-style:dashed;}
.orbital{position:absolute;z-index:8;top:3px;width:26px;height:20px;transform:translateX(-13px);pointer-events:none;}
.orbital::before{content:"";position:absolute;left:1px;top:5px;width:23px;height:10px;border:1px solid rgba(183,170,255,.72);border-radius:50%;transform:rotate(-18deg);box-shadow:0 0 10px rgba(183,170,255,.2);}
.orbital::after{content:"";position:absolute;left:10px;top:6px;width:6px;height:6px;border-radius:50%;background:#efe9ff;box-shadow:0 0 8px rgba(183,170,255,.9);}
.orbital b{position:absolute;left:21px;top:5px;color:#c6b8ff;font:600 8px 'HSR',system-ui;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;}
.nowband{position:absolute;z-index:1;top:104px;bottom:0;width:26px;transform:translateX(-13px);background:linear-gradient(90deg,transparent,rgba(200,188,255,.07),transparent);pointer-events:none;}
.now{position:absolute;z-index:2;top:104px;bottom:0;width:0;border-left:1px solid rgba(200,188,255,.72);box-shadow:0 0 9px rgba(200,188,255,.3);pointer-events:none;}
.now span{display:none;}
.lane{position:relative;border-top:1px solid rgba(183,170,255,.1);}
.lane.alt{background:rgba(139,123,255,.025);}
.tile{position:absolute;z-index:3;overflow:hidden;border:0;border-radius:12px;cursor:pointer;padding:0;background:linear-gradient(150deg,rgba(52,38,92,.9),rgba(20,14,38,.96));box-shadow:0 8px 20px rgba(4,2,10,.5),inset 0 0 0 1px rgba(255,255,255,.08);transition:transform .14s ease,box-shadow .14s ease,filter .2s ease,opacity .2s ease;}
.tile .art{position:absolute;inset:0;z-index:0;background-size:auto 108%;background-repeat:repeat-x;background-position:right center;transition:transform .3s ease,filter .25s ease;}
.tile .scrim{position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(7,4,16,.1),transparent 52%,rgba(7,4,16,.62));border-radius:12px;}
.tile::after{content:"";position:absolute;inset:0;z-index:1;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);border-radius:12px;pointer-events:none;}
.tile:hover{transform:translateY(-3px);box-shadow:0 16px 34px rgba(4,2,10,.65),inset 0 0 0 1px rgba(255,255,255,.16);}
.tile:hover .art{transform:scale(1.025);}
.tile.sel{transform:none;box-shadow:0 12px 30px rgba(4,2,10,.72),inset 0 0 0 2px #c8bcff;}
.tile.dim{opacity:.14;filter:grayscale(.5);pointer-events:none;}
.tile .nm{position:absolute;z-index:2;left:0;right:0;bottom:0;min-height:35px;display:flex;justify-content:center;flex-direction:column;padding:6px 10px 5px;text-align:left;pointer-events:none;background:linear-gradient(90deg,rgba(8,5,18,.86),rgba(8,5,18,.62) 72%,rgba(8,5,18,.35));border-top:1px solid rgba(255,255,255,.07);}
.tile .nm b{font:400 15.5px/1.15 'GI',Georgia,serif;font-weight:400;color:#fff;text-shadow:0 1px 8px rgba(0,0,0,.9),0 0 2px rgba(0,0,0,.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tile .chip{position:absolute;z-index:2;top:7px;left:7px;display:inline-flex;align-items:center;gap:5px;font:700 9px 'HSR',system-ui;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:rgba(9,6,20,.66);padding:3px 7px;border-radius:999px;backdrop-filter:blur(3px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);}
.tile.past .art{filter:grayscale(.45) brightness(.7) saturate(.85);}
.tile.past .nm b{color:#ddd6f0;}
.tile.past:hover .art{filter:grayscale(.1) brightness(.9) saturate(1);}
.tile.live{box-shadow:0 0 0 1px rgba(200,188,255,.45),0 0 26px rgba(168,123,255,.5),inset 0 0 0 1px rgba(255,255,255,.1);}
.tile.up .art{filter:brightness(.82) saturate(.9);}
.tile.expected{background:rgba(12,9,26,.6);border:1.5px dashed rgba(183,170,255,.45);box-shadow:none;}
.tile.expected::after{display:none;}
.tile.expected .chip{background:rgba(139,123,255,.16);color:#c9bcff;box-shadow:inset 0 0 0 1px rgba(139,123,255,.4);}
.tile .exlabel{position:absolute;z-index:2;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:#cabfe8;pointer-events:none;}
.tile .exlabel b{font:400 17px 'GI',Georgia,serif;font-weight:400;color:#e6ddff;}
.tile .exlabel i{font:600 9px 'HSR',system-ui;font-style:normal;letter-spacing:.09em;text-transform:uppercase;color:#8c83aa;}
.tile.event{background:linear-gradient(135deg,rgba(47,35,88,.92),rgba(15,11,33,.98));border-radius:9px;}
.tile.event::after{border-radius:9px;}
.tile.event::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--acc);z-index:2;border-radius:2px 0 0 2px;}
.tile.event .evt{position:absolute;z-index:2;left:12px;top:5px;right:10px;overflow:hidden;font:400 12px 'GI',Georgia,serif;white-space:nowrap;text-overflow:ellipsis;color:#f0ecff;text-align:left;}
.tile.event .evd{position:absolute;z-index:2;left:12px;bottom:5px;right:76px;overflow:hidden;white-space:nowrap;font:600 8.5px 'HSR',system-ui;letter-spacing:.06em;text-transform:uppercase;color:rgba(200,190,240,.7);}
.tile.event .chip{top:auto;left:auto;right:5px;bottom:4px;background:rgba(12,9,26,.62);color:#c9bcff;}
.tile.event.ongoing{box-shadow:0 0 0 1px rgba(183,170,255,.35),0 0 22px rgba(139,123,255,.4),inset 0 0 0 1px rgba(255,255,255,.08);}
.tile.event.ongoing .chip{background:linear-gradient(160deg,#efe9ff,#9c8cff);color:#1a1030;}
.tile.event.sm .evt{font-size:10.5px;top:7px;}
.tile.event.sm .evd{right:10px;}
.tile.event.sm .chip{display:none;}
.tile.event.pastc{background:linear-gradient(135deg,rgba(34,26,65,.9),rgba(13,10,28,.96));}
.tile.event.pastc::before{background:rgba(139,123,255,.4);}
.tile.event.pastc .evt{color:#bdb4dd;}
.tile.event.pastc .evd{color:rgba(170,160,210,.55);}
.chip-act{position:absolute;z-index:3;display:flex;align-items:center;overflow:hidden;padding:0 9px;border-radius:5px;font:600 10px 'HSR',system-ui;white-space:nowrap;color:#d8d0f2;background:repeating-linear-gradient(135deg,rgba(139,123,255,.08) 0 5px,rgba(139,123,255,.025) 5px 10px);box-shadow:inset 0 0 0 1px rgba(183,170,255,.26);}
.feature-act{clip-path:polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px);border-radius:0;background:linear-gradient(135deg,rgba(48,34,91,.94),rgba(15,11,35,.98));}
.feature-act::after{border-radius:0;box-shadow:inset 0 0 0 1px rgba(183,170,255,.28);}
.feature-act::before{content:"";position:absolute;z-index:2;inset:0;background:repeating-linear-gradient(135deg,transparent 0 7px,rgba(183,170,255,.035) 7px 9px);pointer-events:none;}
.feature-act .evt{position:absolute;z-index:3;left:12px;top:7px;right:8px;overflow:hidden;color:#f0ecff;font:400 13px 'GI',Georgia,serif;white-space:nowrap;text-overflow:ellipsis;text-align:left;}
.feature-act .evd{position:absolute;z-index:3;left:12px;right:78px;bottom:7px;overflow:hidden;color:#b8afd4;font:600 8.5px 'HSR',system-ui;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;}
.feature-act .chip{top:auto;bottom:5px;left:auto;right:7px;}
.chip-mk{position:absolute;z-index:3;height:24px;display:flex;align-items:center;overflow:hidden;padding:0 9px;border-radius:7px;font:600 10.5px 'HSR',system-ui;white-space:nowrap;color:#d9ccff;background:repeating-linear-gradient(135deg,rgba(60,44,104,.55) 0 8px,rgba(40,28,74,.55) 8px 16px);box-shadow:inset 0 0 0 1px rgba(139,123,255,.4);}
.mkpt{position:absolute;z-index:3;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px 0 6px;transform:translateX(-6px);border-radius:7px;font:600 10.5px 'HSR',system-ui;white-space:nowrap;color:#d9ccff;background:rgba(52,37,84,.75);box-shadow:inset 0 0 0 1px rgba(139,123,255,.4);}
.mkpt i{width:8px;height:8px;border-radius:50%;background:#b79cff;box-shadow:0 0 8px #b79cff;}
.chip-act.past,.chip-mk.past,.mkpt.past{opacity:.55;}
/* compact overview rail */
.mini{position:relative;height:32px;margin-top:8px;border:1px solid var(--line);border-radius:8px;background:linear-gradient(180deg,rgba(20,14,40,.58),rgba(10,7,22,.82));overflow:hidden;cursor:pointer;}
.mini u{position:absolute;top:3px;margin-left:4px;text-decoration:none;font:600 9px 'HSR',system-ui;letter-spacing:.1em;text-transform:uppercase;color:var(--muted2);border-left:1px solid rgba(183,170,255,.14);padding-left:4px;height:12px;pointer-events:none;}
.mini .mininow{position:absolute;z-index:3;top:0;bottom:0;width:0;border-left:1.5px solid rgba(200,188,255,.82);box-shadow:0 0 6px rgba(200,188,255,.5);}
.mini .mininow b{position:absolute;top:17px;left:4px;color:#efe9ff;font:600 7.5px 'HSR',system-ui;letter-spacing:.07em;text-transform:uppercase;white-space:nowrap;}
.miniwin{position:absolute;z-index:2;top:0;bottom:0;background:rgba(200,188,255,.1);border:1px solid rgba(200,188,255,.55);border-radius:5px;cursor:grab;box-shadow:0 0 0 200vw rgba(4,2,10,.35);}
.miniwin::before,.miniwin::after{content:"";position:absolute;top:50%;width:3px;height:16px;margin-top:-8px;border-radius:2px;background:rgba(200,188,255,.75);}
.miniwin::before{left:-1.5px;}.miniwin::after{right:-1.5px;}
.miniwin:active{cursor:grabbing;}
.detail{position:sticky;top:18px;display:flex;flex-direction:column;gap:14px;min-height:540px;padding:15px;border:1px solid rgba(183,170,255,.2);border-radius:16px;background:linear-gradient(180deg,rgba(22,15,45,.92),rgba(10,8,24,.96));box-shadow:0 18px 50px rgba(2,1,8,.36),inset 0 1px 0 rgba(255,255,255,.035);}
.ledgerhead{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid rgba(183,170,255,.12);}
.ledgerhead span{font:600 9px 'HSR',system-ui;letter-spacing:.14em;text-transform:uppercase;color:var(--muted2);}
.ledgerhead i{width:28px;height:12px;position:relative;border:1px solid rgba(183,170,255,.52);border-radius:50%;transform:rotate(-14deg);}
.ledgerhead i::after{content:"";position:absolute;left:10px;top:3px;width:4px;height:4px;border-radius:50%;background:#efe9ff;box-shadow:0 0 7px rgba(183,170,255,.9);}
.dthumb{position:relative;aspect-ratio:16/9;border-radius:11px;background-size:cover;background-position:right center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 10px 24px rgba(4,2,10,.55);overflow:hidden;}
.dthumb::after{content:"";position:absolute;inset:auto 0 0;height:36%;background:linear-gradient(transparent,rgba(5,3,14,.64));pointer-events:none;}
.detail.noart .dthumb{background-image:none!important;background:radial-gradient(circle at 50% 50%,rgba(183,170,255,.11),transparent 10%),radial-gradient(ellipse at 50% 50%,transparent 20%,rgba(139,123,255,.18) 21% 22%,transparent 23%),rgba(7,5,17,.72);}
.detail.noart .dthumb::before{content:"EVENT";position:absolute;inset:0;display:grid;place-items:center;color:rgba(205,196,237,.52);font:600 9px 'HSR',system-ui;letter-spacing:.2em;}
.dcontent{padding:0 2px;}
.detail .k{font:600 9.5px 'HSR',system-ui;letter-spacing:.14em;text-transform:uppercase;color:var(--muted2);}
.detail h2{margin:5px 0 7px;font:400 27px/1.08 'GI',Georgia,serif;}
.detail p{margin:4px 0;color:#b7aed2;font-size:12.5px;line-height:1.35;}
.detail .when{color:#c6b8ff;font-variant-numeric:tabular-nums;}
.detail .fours b{color:#d7cff0;font-weight:600;}
.detail .cd{margin-top:8px;font:600 12px 'HSR',system-ui;color:#e9e2ff;}
.detail .cd b{font-variant-numeric:tabular-nums;color:#fff;}
.detail a.src{color:#c6b8ff;font-size:12px;text-decoration:none;border-bottom:1px solid var(--line);}
.dside{display:flex;gap:8px;align-items:center;margin-top:auto;padding-top:12px;border-top:1px solid rgba(183,170,255,.12);}
.dbtn{border:0;clip-path:var(--hclip);background:rgba(139,123,255,.3);color:#efe9ff;font:600 12px 'HSR',system-ui;padding:10px 18px;cursor:pointer;white-space:nowrap;}
.dbtn:hover{background:rgba(139,123,255,.5);}
.kbd{margin-left:auto;font:600 9.5px 'HSR',system-ui;color:var(--muted2);text-align:right;}
.kbd b{display:inline-block;padding:1px 5px;border:1px solid var(--line);border-radius:4px;color:#cabfe8;}
@media (max-width:640px){
  body{padding:16px 12px 32px;} h1{font-size:24px;}
  .tools .field input{width:110px;}
  .layers{margin-left:0;}
  .workspace{display:block;}.detail{position:static;margin-top:12px;}.timeline-frame{grid-template-columns:92px minmax(0,1fr);}.dside{flex-wrap:wrap;}
  .dthumb{max-width:260px;}
  .mini{height:32px;}
}
</style>
<div class="wrap">
  <div class="eyebrow">Banner history</div><h1>Genshin Impact Timeline</h1>
  <div class="tools">
    <div class="field"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#948bad" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><input id="q" placeholder="Search banners"></div>
    <span class="count" id="count"></span>
    <button id="today">Today</button>
    <label class="field" style="cursor:pointer"><span>Jump</span><input id="jump" type="month" value="2026-07" style="width:120px;color-scheme:dark"></label>
    <div class="seg" id="region"><button class="on">NA</button><button>EU</button><button>Asia</button></div>
    <div class="layers"><b>Layers</b>
      <button class="lgb" data-lane="lane-ev">Events</button>
      <button class="lgb" data-lane="lane-act">Activities</button>
      <button class="lgb" data-lane="lane-mk">My planning</button>
    </div>
  </div>
  <div class="workspace">
    <section class="stage" aria-label="Banner timeline">
      <div class="timeline-frame">
        <div class="track-rail" aria-hidden="true">
          <div class="rail-head"><span>Time &rarr;</span><b>Tracks &darr;</b></div>
          <div class="rail-row" style="height:${CHARH}px"><span><i></i>Character<br>banners</span></div>
          <div class="rail-row ev" style="height:${EVHALL}px"><span><i></i>Events</span></div>
          <div class="rail-row act" style="height:${ACTHALL}px"><span><i></i>Activities</span></div>
          <div class="rail-row mk" style="height:${MKHALL}px"><span><i></i>My planning</span></div>
        </div>
        <div class="scroll" id="scroll"><div class="canvas">
          <div class="grid">${grid}</div>
          <div class="ruler">${ticks}${weeks}<div class="orbital" style="left:${x(NOW)}px"><b>Today · ${fmt(NOW)}</b></div></div>
          <div class="ribbons">${rib}${phaseRail}</div>
          <div class="forecast" style="left:${x(FORECAST_START)}px;width:${x(T1)-x(FORECAST_START)}px"><span>Forecast horizon</span></div>
          <div class="nowband" style="left:${x(NOW)}px"></div>
          <div class="now" style="left:${x(NOW)}px"><span>Now · ${fmt(NOW)}</span></div>
          <div class="lane" style="height:${CHARH}px">${banners}</div>
          <div class="lane alt" id="lane-ev" style="height:${EVHALL}px">${events}</div>
          <div class="lane" id="lane-act" style="height:${ACTHALL}px">${acts}</div>
          <div class="lane alt" id="lane-mk" style="height:${MKHALL}px">${marks}</div>
        </div></div>
      </div>
      <div class="mini" id="mini" tabindex="0" role="scrollbar" aria-label="Timeline overview — drag to navigate">
        ${miniMonths}
        <div class="mininow" style="left:${pc(NOW)}%"><b>Today</b></div>
        <div class="miniwin" id="miniwin"></div>
      </div>
    </section>
    <aside class="detail" id="detail">
      <div class="ledgerhead"><span id="dlabel">Banner details</span><i></i></div>
      <div class="dthumb" id="dthumb"></div>
      <div class="dcontent">
        <div class="k" id="dk">—</div>
        <h2 id="dt">—</h2>
        <p class="when" id="dw">—</p>
        <p id="dn">—</p>
        <p class="fours" id="dfours"></p>
        <p class="cd" id="dcd"></p>
        <p><a class="src" id="dsrc" href="#" target="_blank" rel="noopener">View source ↗</a></p>
      </div>
      <div class="dside">
        <button class="dbtn">+ Add to planning</button>
        <div class="kbd"><b>←</b> <b>→</b><br>step banners</div>
      </div>
    </aside>
  </div>
</div>
<script>
(function(){
  var sc=document.getElementById('scroll'), NOWX=${x(NOW)}, SW=${W};
  function centre(px,inst){sc.scrollTo({left:Math.max(0,px-sc.clientWidth*0.43),behavior:inst?'auto':'smooth'});}
  centre(NOWX,true);
  var detail=document.getElementById('detail'),dthumb=document.getElementById('dthumb'),dlabel=document.getElementById('dlabel'),
      dt=document.getElementById('dt'),dw=document.getElementById('dw'),dn=document.getElementById('dn'),dk=document.getElementById('dk'),
      dcd=document.getElementById('dcd'),dfours=document.getElementById('dfours'),dsrc=document.getElementById('dsrc');
  var cdTimer=null;
  function pad(n){return String(n).padStart(2,'0');}
  function select(b,scrollTo){
    document.querySelectorAll('.tile.sel').forEach(function(x){x.classList.remove('sel');});
    b.classList.add('sel');
    dlabel.textContent=b.classList.contains('feature-act')?'Activity details':b.classList.contains('event')?'Event details':'Banner details';
    dt.textContent=b.dataset.ch; dw.textContent=b.dataset.when; dn.textContent=b.dataset.name; dk.textContent=b.dataset.k;
    dfours.innerHTML=b.dataset.fours?'<b>4&#9733; rate-up:</b> '+b.dataset.fours:'';
    if(b.dataset.src){dsrc.href=b.dataset.src;dsrc.style.display='';}else{dsrc.style.display='none';}
    var artEl=b.querySelector('.art'), entryArt=b.style.getPropertyValue('--entry-art');
    if(entryArt){dthumb.style.backgroundImage=entryArt;detail.classList.remove('noart');}
    else if(artEl){dthumb.style.backgroundImage=artEl.style.backgroundImage;detail.classList.remove('noart');}
    else detail.classList.add('noart');
    if(cdTimer){clearInterval(cdTimer);cdTimer=null;}
    var rem=+b.dataset.remain;
    if(rem>0){var end=Date.now()+rem;var tick=function(){var ms=end-Date.now();if(ms<0)ms=0;var s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),mi=Math.floor(s%3600/60),se=s%60;dcd.innerHTML='Ends in <b>'+d+'d '+pad(h)+':'+pad(mi)+':'+pad(se)+'</b>';};tick();cdTimer=setInterval(tick,1000);}
    else dcd.textContent='';
    if(scrollTo){var r=b.getBoundingClientRect(),sr=sc.getBoundingClientRect();centre(sc.scrollLeft+(r.left-sr.left)+r.width/2);}
  }
  var tiles=[].slice.call(document.querySelectorAll('.tile'));
  tiles.forEach(function(b){b.addEventListener('click',function(){select(b);});});
  // search: dim non-matches, count, jump to first match
  var countEl=document.getElementById('count');
  document.getElementById('q').addEventListener('input',function(e){
    var q=e.target.value.trim().toLowerCase(), n=0, first=null;
    tiles.forEach(function(t){var hit=!q||(t.dataset.search||'').indexOf(q)>-1;t.classList.toggle('dim',!!q&&!hit);t.tabIndex=(q&&!hit)?-1:0;if(q&&hit){n++;if(!first)first=t;}});
    countEl.textContent=q?(n+' match'+(n===1?'':'es')):'';
    if(first)select(first,true);
  });
  document.getElementById('today').addEventListener('click',function(){centre(NOWX);});
  document.getElementById('jump').addEventListener('change',function(e){var p=e.target.value.split('-');if(p.length<2)return;centre((Date.UTC(+p[0],+p[1]-1,15)-${T0})/${SPAN}*SW);});
  document.querySelectorAll('#region button').forEach(function(btn){btn.addEventListener('click',function(){document.querySelectorAll('#region button').forEach(function(x){x.classList.remove('on');});btn.classList.add('on');});});
  // layer toggles: hide/show secondary lanes
  document.querySelectorAll('.lgb').forEach(function(btn){btn.addEventListener('click',function(){
    var off=btn.classList.toggle('off');
    document.getElementById(btn.dataset.lane).style.display=off?'none':'';
    btn.setAttribute('aria-pressed',String(!off));
  });btn.setAttribute('aria-pressed','true');});
  // keyboard: step through visible banners
  document.addEventListener('keydown',function(e){
    if(/^(INPUT|TEXTAREA)$/.test((e.target.tagName||''))) return;
    if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight') return;
    var list=tiles.filter(function(t){return !t.classList.contains('dim')&&t.offsetParent;});
    var cur=document.querySelector('.tile.sel'), i=list.indexOf(cur);
    i=(i<0?0:i)+(e.key==='ArrowRight'?1:-1); if(i<0)i=0; if(i>=list.length)i=list.length-1;
    if(list[i])select(list[i],true); e.preventDefault();
  });
  // minimap: window sync + drag/click to navigate
  var mini=document.getElementById('mini'), win=document.getElementById('miniwin');
  function sync(){var f=sc.scrollLeft/sc.scrollWidth,wf=sc.clientWidth/sc.scrollWidth;win.style.left=(f*100)+'%';win.style.width=(wf*100)+'%';}
  function jumpTo(clientX){var r=mini.getBoundingClientRect();var frac=Math.min(1,Math.max(0,(clientX-r.left)/r.width));sc.scrollTo({left:frac*sc.scrollWidth-sc.clientWidth/2,behavior:'auto'});}
  mini.addEventListener('pointerdown',function(e){jumpTo(e.clientX);var mv=function(ev){jumpTo(ev.clientX);};var up=function(){window.removeEventListener('pointermove',mv);window.removeEventListener('pointerup',up);};window.addEventListener('pointermove',mv);window.addEventListener('pointerup',up);e.preventDefault();});
  sc.addEventListener('scroll',sync); window.addEventListener('resize',sync);
  var liveT=document.querySelector('.tile.live'); if(liveT) select(liveT); sync();
})();
</script>`;
html=html.replace(/—/g,'&mdash;').replace(/–/g,'&ndash;').replace(/’/g,'&rsquo;').replace(/‘/g,'&lsquo;').replace(/·/g,'&middot;').replace(/★/g,'&#9733;').replace(/↗/g,'&#8599;').replace(/←/g,'&larr;').replace(/→/g,'&rarr;');
fs.writeFileSync(OUT,html);
console.log('wrote',path.basename(OUT),Math.round(html.length/1024)+'KB');
