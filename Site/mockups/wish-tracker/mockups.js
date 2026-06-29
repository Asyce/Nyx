(async function(){
  const data = await fetch('./wish-tracker-data.json').then((res) => res.json());
  const root = document.getElementById('mockRoot');
  const views = Object.fromEntries([...document.querySelectorAll('[data-view]')].map((el) => [el.dataset.view, el]));

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const pct = (value, max) => Math.max(0, Math.min(100, (Number(value || 0) / Number(max || 1)) * 100));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;',
  })[ch]);
  const cssUrl = (value) => value ? `url("${String(value).replace(/"/g, '%22')}")` : 'none';
  const copyLabel = (copies) => {
    const c = Math.max(0, Number(copies || 0) - 1);
    return c <= 6 ? `C${c}` : `C6 +${c - 6}`;
  };
  const rankClass = (rank) => Number(rank) >= 5 ? 'r5' : Number(rank) >= 4 ? 'r4' : 'r3';
  const itemAvatar = (item, sizeClass = '') => {
    const icon = item.icon || item.art || '';
    const kind = item.kind || (/weapon/i.test(item.type || '') ? 'weapon' : 'character');
    return `<span class="avatar ${kind} ${rankClass(item.rank || item.rarity)} ${sizeClass}" title="${escapeHtml(item.name)}">${icon ? `<img src="${escapeHtml(icon)}" alt="">` : `<span class="fallback">${escapeHtml(item.rank || item.rarity || '?')}</span>`}</span>`;
  };
  const tinyItems = (items, limit = 6) => {
    const list = (items || []).slice(0, limit);
    if (!list.length) return '<span class="row-meta">No high-rarity pulls yet</span>';
    return list.map((item) => itemAvatar(item)).join('');
  };
  const uniqueFiveNames = (group) => {
    const seen = new Set();
    return (group.fiveStars || []).map((item) => item.name).filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  function renderLedger(){
    const ce = data.characterEvent;
    const topChase = ce.chaseGroups.find((g) => /Void Star/i.test(g.label)) || ce.chaseGroups[0] || ce.sourceGroups[0];
    const heroArt = data.anchors.Skirk?.art || topChase?.fiveStars?.[0]?.art || '';
    const toSoft = Math.max(0, ce.soft - ce.currentPity);
    const toHard = Math.max(0, ce.hard - ce.currentPity);
    const splitGroups = ce.sourceGroups.slice(0, 4);
    const chaseCards = ce.chaseGroups.slice(0, 8);

    views.ledger.innerHTML = `
      <div class="ledger-grid">
        <section class="hero-ledger" style="--hero-art:${cssUrl(heroArt)}">
          <div class="hero-content">
            <div class="chase-title">
              <span>Recommended first screen</span>
              <h2>${fmt(ce.currentPity)} into the next 5-star</h2>
              <p>${escapeHtml(ce.lastBanner)} has ${fmt(ce.lastBannerTotal)} recent pulls. The state is ${ce.guaranteed ? 'guaranteed' : 'still 50:50'}, with ${fmt(toSoft)} pulls to soft pity and ${fmt(toHard)} to hard pity.</p>
              <div class="current-box">
                <div class="current-line">
                  <span>Current character pity</span>
                  <span class="pill">${ce.guaranteed ? 'Guaranteed' : '50:50'}</span>
                </div>
                <div class="pity-number">${fmt(ce.currentPity)}<em>/ ${ce.hard}</em></div>
                <div class="pity-bar">
                  <i style="width:${pct(ce.currentPity, ce.hard)}%"></i>
                  <mark style="left:${pct(ce.soft, ce.hard)}%"></mark>
                </div>
                <div class="pity-note">${fmt(toSoft)} to soft pity / ${fmt(toHard)} to hard pity / ${fmt(toHard * 160)} Primogems</div>
              </div>
            </div>

            <div class="split-stack">
              <div class="split-head">
                <span>Imported source banners, newest first</span>
                <b>${fmt(data.summary.character.total)} wishes</b>
              </div>
              ${splitGroups.map((group) => `
                <article class="source-chip">
                  <div>
                    <h3>${escapeHtml(group.label)}</h3>
                    <small>${escapeHtml(group.lastDate)} / ${fmt(group.total)} pulls from this banner source</small>
                  </div>
                  <div class="source-metrics">
                    <span><b>${fmt(group.total)}</b>Pulls</span>
                    <span><b>${fmt(group.fives)}</b>5-star</span>
                    <span><b>${fmt(group.fours)}</b>4-star</span>
                  </div>
                  <div class="tiny-items">${tinyItems(group.recentHigh, 6)}</div>
                </article>
              `).join('')}
            </div>

            <div class="last-pulls">
              <div class="panel-label">Last banner pulls, capped at six</div>
              <div class="pull-strip">
                ${ce.lastRecent.map((item) => `
                  <div class="pull-card">
                    ${itemAvatar(item)}
                    <div>
                      <b>${escapeHtml(item.name)}</b>
                      <span>${item.rank}-star / pity ${item.pity}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </section>

        <aside class="side-column">
          <div class="stat-ledger">
            <div><b>${fmt(data.totals.pulls)}</b><span>Total pulls</span></div>
            <div><b>${fmt(data.summary.character.total)}</b><span>Character wishes</span></div>
            <div><b>${fmt(data.summary.character.cost)}</b><span>Primogems on character</span></div>
            <div><b>${fmt(data.summary.character.fives)}</b><span>Character 5-star</span></div>
            <div><b>${data.summary.character.avgPity}</b><span>Average pity</span></div>
            <div><b>${ce.winRate}%</b><span>Event wins</span></div>
          </div>
          <div class="recommend-panel">
            <span class="panel-label">Implementation idea</span>
            <p>Replace the generic banner-stage card with this ledger: current pity, newest split-banner sources, recent pulls, and a chase list. It answers what was pulled on each banner before archive/history details appear.</p>
          </div>
        </aside>
      </div>

      <section class="chase-ledger" aria-label="5-star chase ledger">
        ${chaseCards.map((group) => {
          const face = group.fiveStars?.[0] || {};
          const names = uniqueFiveNames(group).slice(0, 3).join(', ');
          return `
            <article class="chase-card" style="--card-art:${cssUrl(face.art || face.icon || data.anchors.Skirk?.art)}">
              <span class="panel-label">Pulls done for</span>
              <h3>${escapeHtml(names || group.label)}</h3>
              <small>${escapeHtml(group.label)} / ${escapeHtml(group.lastDate)}</small>
              <div class="chase-stats">
                <span><b>${fmt(group.total)}</b>Pulls</span>
                <span><b>${fmt(group.fives)}</b>5-star</span>
                <span><b>${fmt(group.fours)}</b>4-star</span>
              </div>
              <div class="face-row">${tinyItems(group.fiveStars, 5)}</div>
            </article>
          `;
        }).join('')}
      </section>
    `;
  }

  function renderPity(){
    const ce = data.characterEvent;
    const maxBand = Math.max(1, ...ce.pityBands.map((band) => band.count));
    const dots = ce.pityDots.slice(-44);
    const outcomes = dots.slice().reverse().slice(0, 14);
    views.pity.innerHTML = `
      <div class="pity-layout">
        <section class="wide-panel">
          <div class="table-title">
            <span>Concept B</span>
            <h2>Pity Observatory</h2>
          </div>
          <div class="pity-rail" aria-label="5-star pity distribution">
            ${dots.map((dot) => `
              <i class="pity-dot ${dot.win ? '' : 'loss'} ${dot.pity >= ce.soft ? 'soft' : ''}" style="left:${pct(dot.pity, ce.hard)}%" title="${escapeHtml(dot.name)} at pity ${dot.pity}"></i>
            `).join('')}
          </div>
          <div class="band-grid">
            ${ce.pityBands.map((band) => `
              <div class="band-card">
                <span>${escapeHtml(band.label)}</span>
                <b>${fmt(band.count)}</b>
                <i>${escapeHtml(band.range)} pity / ${Math.round((band.count / maxBand) * 100)}% of top band</i>
              </div>
            `).join('')}
          </div>
          <div class="recommend-panel" style="margin-top:14px">
            <span class="panel-label">Implementation idea</span>
            <p>Use this as the compact replacement for the old timeline: one probability rail, explicit soft/hard bands, and outcome rows. It keeps the liked distribution idea while removing the awkward generated-timeline feel.</p>
          </div>
        </section>

        <aside class="history-panel">
          <div class="table-title">
            <span>Recent 5-star outcomes</span>
            <h2>Wins and losses</h2>
          </div>
          <div class="outcome-list">
            ${outcomes.map((item) => `
              <div class="outcome-row">
                ${itemAvatar({...item, rank:5})}
                <div class="row-name">${escapeHtml(item.name)}</div>
                <div class="row-meta">Pity ${item.pity}</div>
                <span class="result-pill ${item.win ? '' : 'loss'}">${item.win ? 'Win' : 'Loss'}</span>
              </div>
            `).join('')}
          </div>
        </aside>
      </div>
    `;
  }

  function renderArchive(){
    const chars = data.archive.slice(0, 42);
    const weapons = data.weaponArchive.slice(0, 12);
    const history = data.recentHistory.slice(0, 24);
    views.archive.innerHTML = `
      <div class="archive-layout">
        <section class="wide-panel">
          <div class="archive-toolbar">
            <div class="table-title">
              <span>Concept C</span>
              <h2>Archive Console</h2>
            </div>
            <div class="chip-row" aria-label="Archive controls mockup">
              <button type="button" class="on">Most copies</button>
              <button type="button">C6+</button>
              <button type="button">5-star</button>
              <button type="button">4-star</button>
            </div>
          </div>
          <div class="archive-grid">
            ${chars.map((item) => `
              <article class="archive-unit">
                ${itemAvatar({...item, rank:item.rarity})}
                <div>
                  <div class="row-name">${escapeHtml(item.name)}</div>
                  <div class="row-meta">${fmt(item.copies)} copies / last ${escapeHtml(item.lastDate)}</div>
                </div>
                <span class="copy-badge ${item.constellation > 6 ? 'over' : ''}">${copyLabel(item.copies)}</span>
              </article>
            `).join('')}
          </div>
        </section>

        <aside class="side-stack">
          <section class="history-panel">
            <div class="table-title">
              <span>Weapon side view</span>
              <h2>${fmt(data.summary.weapon.total)} weapon wishes</h2>
            </div>
            <div class="weapon-list">
              ${weapons.map((item) => `
                <div class="weapon-row">
                  ${itemAvatar({...item, rank:item.rarity, kind:'weapon'})}
                  <div class="row-name">${escapeHtml(item.name)}</div>
                  <div class="row-meta">${item.rarity}-star</div>
                  <div class="row-meta">x${fmt(item.copies)}</div>
                </div>
              `).join('')}
            </div>
          </section>

          <section class="history-panel">
            <div class="table-title">
              <span>Dense wish history</span>
              <h2>Newest rows</h2>
            </div>
            <div class="history-table">
              ${history.map((item) => `
                <div class="history-row">
                  ${itemAvatar(item)}
                  <div class="row-name">${escapeHtml(item.name)}</div>
                  <div class="row-meta">${item.rank}-star</div>
                  <div class="row-meta">#${item.pity}</div>
                  <div class="row-meta">${escapeHtml(item.date)}</div>
                </div>
              `).join('')}
            </div>
          </section>
        </aside>
      </div>
    `;
  }

  renderLedger();
  renderPity();
  renderArchive();

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view-button]');
    if (!button) return;
    const view = button.dataset.viewButton;
    document.querySelectorAll('[data-view-button]').forEach((el) => el.classList.toggle('on', el === button));
    document.querySelectorAll('[data-view]').forEach((el) => el.classList.toggle('on', el.dataset.view === view));
  });
})();
