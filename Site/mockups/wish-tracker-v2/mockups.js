(async function(){
  const data = await fetch("../wish-tracker/wish-tracker-data.json").then((res) => res.json());
  const views = Object.fromEntries([...document.querySelectorAll("[data-concept]")].map((el) => [el.dataset.concept, el]));
  let archiveFilter = "all";

  const fmt = (value) => Number(value || 0).toLocaleString("en-US");
  const pct = (value, max) => Math.max(0, Math.min(100, (Number(value || 0) / Number(max || 1)) * 100));
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    "\"":"&quot;",
    "'":"&#39;",
  })[ch]);
  const rankClass = (rank) => Number(rank) >= 5 ? "r5" : Number(rank) >= 4 ? "r4" : "r3";
  const kindClass = (item) => item?.kind || (/weapon/i.test(item?.type || "") ? "weapon" : "character");
  const copyLabel = (copies) => {
    const cons = Math.max(0, Number(copies || 0) - 1);
    return cons <= 6 ? `C${cons}` : `C6 +${cons - 6}`;
  };

  const bannerLeadMap = [
    [/frostedge|void star/i, "Skirk"],
    [/ancient flame/i, "Mavuika"],
    [/angel/i, "Nicole"],
    [/crimson sands|temptation/i, "Nefer"],
    [/moonsong/i, "Lauma"],
    [/harmonious/i, "Zibai"],
    [/somnias|luna/i, "Columbina"],
    [/cerise/i, "Furina"],
    [/knocks at night/i, "Ineffa"],
    [/rubedo/i, "Albedo"],
  ];

  function image(src, cls = "", alt = ""){
    return src ? `<img class="${cls}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">` : "";
  }

  function avatar(item, extraClass = ""){
    if (!item) return "";
    const rank = item.rank || item.rarity || 3;
    const src = item.icon || item.art || "";
    return `<span class="avatar ${kindClass(item)} ${rankClass(rank)} ${extraClass}" title="${escapeHtml(item.name)}">${image(src, "", item.name) || `<span>${escapeHtml(rank)}</span>`}</span>`;
  }

  function distinctItems(items, limit){
    const seen = new Set();
    const out = [];
    for (const item of items || []) {
      const key = String(item.name || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= limit) break;
    }
    return out;
  }

  function leadForGroup(group){
    const hit = bannerLeadMap.find(([rx]) => rx.test(group.label || group.banner || ""));
    if (hit && data.anchors[hit[1]]) return data.anchors[hit[1]];
    const byPull = (group.fiveStars || []).find((item) => kindClass(item) === "character") ||
      (group.recentHigh || []).find((item) => kindClass(item) === "character" && Number(item.rank) >= 4);
    if (byPull) return byPull;
    return data.anchors.Skirk || Object.values(data.anchors)[0];
  }

  function rateIcons(group, lead){
    const items = distinctItems([lead, ...(group.recentHigh || []), ...(group.fiveStars || [])], 5);
    return items.map((item) => avatar(item, "sm")).join("");
  }

  function bannerCard(group, opts = {}){
    const lead = leadForGroup(group);
    const total = group.total || 0;
    const fives = group.fives ?? group.fiveCount ?? 0;
    const fours = group.fours ?? group.fourCount ?? 0;
    const cls = opts.main ? "banner-card main" : "banner-card banner-mini";
    const sub = opts.sub || `${group.lastDate || ""} / ${fmt(total)} pulls from this source`;
    return `
      <article class="${cls}">
        <div class="banner-image">${image(lead?.art || lead?.icon, "", lead?.name || group.label)}</div>
        <div class="banner-shade"></div>
        <div class="banner-info">
          <span class="wt2-label">${escapeHtml(lead?.name || "Featured")}</span>
          <h3>${escapeHtml(group.label || group.banner || "Banner source")}</h3>
          <p>${escapeHtml(sub)}</p>
          <div class="banner-stats">
            <span><b>${fmt(total)}</b>pulls</span>
            <span><b>${fmt(fives)}</b>5-star</span>
            <span><b>${fmt(fours)}</b>4-star</span>
          </div>
          <div class="rate-row">${rateIcons(group, lead)}</div>
        </div>
      </article>
    `;
  }

  function pullLine(item){
    return `
      <div class="pull-line">
        ${avatar(item)}
        <div><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.date || "")} / pity ${escapeHtml(item.pity || "-")}</span></div>
        <em>${escapeHtml(item.rank)}-star</em>
      </div>
    `;
  }

  function renderLedger(){
    const ce = data.characterEvent;
    const groups = ce.sourceGroups || [];
    const newest = groups[0];
    const topGroups = groups.slice(0, 6);
    const bannerStack = groups.slice(1, 3);
    const toSoft = Math.max(0, ce.soft - ce.currentPity);
    const toHard = Math.max(0, ce.hard - ce.currentPity);

    views.ledger.innerHTML = `
      <div class="wt2-grid">
        <section class="wt2-panel">
          <div class="hero-ledger">
            <div class="status-block">
              <div class="pity-core">
                <span class="wt2-label">Concept 01 / first screen</span>
                <h2 class="wt2-title">${fmt(ce.currentPity)} pulls into character pity</h2>
                <p class="wt2-copy">${escapeHtml(newest.label)} is the latest source. The tracker should open on this summary before archive/history details.</p>
                <div class="big">${fmt(ce.currentPity)}<em>/ ${ce.hard}</em></div>
                <span class="state-pill">${ce.guaranteed ? "Guaranteed" : "50:50"} / ${fmt(toSoft)} to soft / ${fmt(toHard)} to hard</span>
                <div class="pity-track"><i style="width:${pct(ce.currentPity, ce.hard)}%"></i><mark style="left:${pct(ce.soft, ce.hard)}%"></mark></div>
              </div>
            </div>

            <div class="banner-deck">
              ${bannerCard(newest, { main:true, sub:"Latest source banner from the imported history" })}
              <div class="banner-mini-stack">
                ${bannerStack.map((group) => bannerCard(group)).join("")}
              </div>
            </div>
          </div>

          <div class="metric-rail">
            <div class="metric-tile"><b>${fmt(data.totals.pulls)}</b><span>Total pulls</span></div>
            <div class="metric-tile"><b>${fmt(data.summary.character.total)}</b><span>Character wishes</span></div>
            <div class="metric-tile"><b>${fmt(data.summary.character.fives)}</b><span>Character 5-star</span></div>
            <div class="metric-tile"><b>${ce.winRate}%</b><span>Event wins</span></div>
          </div>

          <div class="source-list">
            ${topGroups.map((group) => {
              const lead = leadForGroup(group);
              return `
                <article class="source-row">
                  <span class="thumb">${image(lead?.art || lead?.icon, "", lead?.name || group.label)}</span>
                  <div><b>${escapeHtml(group.label)}</b><small>${escapeHtml(group.lastDate)} / ${fmt(group.fives || 0)} five-stars / ${fmt(group.fours || 0)} four-stars</small></div>
                  <strong>${fmt(group.total)}</strong>
                </article>
              `;
            }).join("")}
          </div>
        </section>

        <aside class="side-stack">
          <section class="small-panel">
            <span class="wt2-label">Last banner pulls</span>
            <h2 class="wt2-title">Capped at six</h2>
            <div class="pull-strip">${ce.lastRecent.map(pullLine).join("")}</div>
          </section>
          <section class="small-panel">
            <span class="wt2-label">Refinement from v1</span>
            <p class="wt2-copy">Same overview idea, but it is now framed like the existing Nyx game page. Banner cards use actual character and weapon images rather than abstract placeholders.</p>
          </section>
        </aside>
      </div>
    `;
  }

  function renderObservatory(){
    const ce = data.characterEvent;
    const dots = (ce.pityDots || []).slice(-80);
    const beforeSoft = dots.filter((dot) => Number(dot.pity || 0) < ce.soft).length;
    const afterSoft = dots.length - beforeSoft;
    const maxBand = Math.max(1, beforeSoft, afterSoft);
    const outcomes = dots.slice().reverse().slice(0, 13);

    views.observatory.innerHTML = `
      <div class="observatory-grid">
        <section class="pity-panel">
          <span class="wt2-label">Concept 02 / visual pity map</span>
          <h2 class="wt2-title">Pity Observatory</h2>
          <p class="wt2-copy">This keeps the liked visual distribution, but reduces the categories to the two that matter: before soft pity and at/beyond soft pity.</p>
          <div class="pity-map">
            <span class="soft-marker" style="left:${pct(ce.soft, ce.hard)}%"></span>
            ${dots.map((dot, index) => {
              const pity = Number(dot.pity || 0);
              const top = pity >= ce.soft ? 40 + ((index % 5) * 8) : 72 - ((index % 5) * 7);
              return `<i class="pity-dot ${dot.win ? "" : "loss"} ${pity >= ce.soft ? "soft" : ""}" style="left:${pct(pity, ce.hard)}%; top:${top}%" title="${escapeHtml(dot.name)} / pity ${pity}"></i>`;
            }).join("")}
            <div class="pity-axis"><span>1</span><span>Soft ${ce.soft}</span><span>Hard ${ce.hard}</span></div>
          </div>

          <div class="band-split">
            <div class="band-card">
              <span class="tile-label">Before soft pity</span>
              <b>${fmt(beforeSoft)}</b>
              <p class="wt2-copy">5-stars before pity ${ce.soft}</p>
              <mark style="width:${pct(beforeSoft, maxBand)}%"></mark>
            </div>
            <div class="band-card soft">
              <span class="tile-label">At / beyond soft pity</span>
              <b>${fmt(afterSoft)}</b>
              <p class="wt2-copy">5-stars from pity ${ce.soft} onward</p>
              <mark style="width:${pct(afterSoft, maxBand)}%"></mark>
            </div>
          </div>
        </section>

        <aside class="side-stack">
          <section class="small-panel">
            <span class="wt2-label">50:50 outcomes</span>
            <h2 class="wt2-title">${fmt(ce.wins)} wins / ${fmt(ce.losses)} losses</h2>
            <div class="metric-rail">
              <div class="metric-tile"><b>${ce.winRate}%</b><span>Win rate</span></div>
              <div class="metric-tile"><b>${ce.avgPity}</b><span>Avg pity</span></div>
            </div>
          </section>
          <section class="small-panel">
            <span class="wt2-label">Recent 5-star outcomes</span>
            <div class="outcome-ledger">
              ${outcomes.map((item) => `
                <div class="history-line">
                  ${avatar({...item, rank:5})}
                  <div><b>${escapeHtml(item.name)}</b><i>Pity ${escapeHtml(item.pity)} / ${escapeHtml(item.date || "")}</i></div>
                  <span>${escapeHtml(item.banner || "")}</span>
                  <em class="result-pill ${item.win ? "" : "loss"}">${item.win ? "Win" : "Loss"}</em>
                </div>
              `).join("")}
            </div>
          </section>
        </aside>
      </div>
    `;
  }

  function renderArchive(){
    const groups = data.characterEvent.sourceGroups || [];
    const chars = (data.archive || []).filter((item) => {
      if (archiveFilter === "all") return true;
      if (archiveFilter === "c6") return Number(item.constellation || 0) > 6;
      return Number(item.rarity || 0) === Number(archiveFilter);
    }).slice(0, 40);
    const weapons = (data.weaponArchive || []).slice(0, 9);
    const topBanners = groups.filter((group) => group.fives > 0).slice(0, 3);

    views.archive.innerHTML = `
      <div class="archive-screen">
        <section class="wt2-panel">
          <span class="wt2-label">Concept 03 / long-term account view</span>
          <h2 class="wt2-title">Archive Console</h2>
          <p class="wt2-copy">Dense copy counts, C6 overflow, and a banner drawer share the same screen. This is the place for sorting and filtering once the opening ledger has answered the current-pity question.</p>
          <div class="archive-tools" role="group" aria-label="Archive filters">
            ${[
              ["all", "All"],
              ["c6", "C6+"],
              ["5", "5-star"],
              ["4", "4-star"],
            ].map(([key,label]) => `<button type="button" class="${archiveFilter === key ? "on" : ""}" data-archive-filter="${key}">${label}</button>`).join("")}
          </div>
          <div class="archive-grid">
            ${chars.map((item) => `
              <article class="archive-unit">
                ${avatar({...item, rank:item.rarity}, "lg")}
                <div><b>${escapeHtml(item.name)}</b><i>${fmt(item.copies)} copies / last ${escapeHtml(item.lastDate || "")}</i></div>
                <span class="copy-badge ${Number(item.constellation || 0) > 6 ? "over" : ""}">${copyLabel(item.copies)}</span>
              </article>
            `).join("") || `<p class="empty-note">No archive entries for this filter.</p>`}
          </div>
        </section>

        <aside class="side-stack">
          <section class="small-panel">
            <span class="wt2-label">Banner drawer</span>
            <h2 class="wt2-title">Pulled sources</h2>
            <div class="banner-mini-stack">
              ${topBanners.map((group) => bannerCard(group)).join("")}
            </div>
          </section>
          <section class="small-panel">
            <span class="wt2-label">Weapon side view</span>
            <h2 class="wt2-title">${fmt(data.summary.weapon.total)} wishes</h2>
            <div class="pull-strip">
              ${weapons.map((item) => `
                <div class="weapon-line">
                  ${avatar({...item, rank:item.rarity})}
                  <b>${escapeHtml(item.name)}</b>
                  <span>x${fmt(item.copies)}</span>
                </div>
              `).join("")}
            </div>
          </section>
        </aside>
      </div>
    `;
  }

  function showConcept(key){
    document.querySelectorAll("[data-concept-button]").forEach((button) => {
      button.classList.toggle("on", button.dataset.conceptButton === key);
    });
    document.querySelectorAll("[data-concept]").forEach((view) => {
      view.classList.toggle("on", view.dataset.concept === key);
    });
  }

  document.addEventListener("click", (event) => {
    const conceptButton = event.target.closest("[data-concept-button]");
    if (conceptButton) {
      showConcept(conceptButton.dataset.conceptButton);
      return;
    }
    const archiveButton = event.target.closest("[data-archive-filter]");
    if (archiveButton) {
      archiveFilter = archiveButton.dataset.archiveFilter;
      renderArchive();
    }
  });

  document.addEventListener("error", (event) => {
    if (event.target && event.target.tagName === "IMG") {
      event.target.closest(".avatar,.thumb,.banner-image")?.classList.add("image-missing");
      event.target.remove();
    }
  }, true);

  renderLedger();
  renderObservatory();
  renderArchive();
})();
