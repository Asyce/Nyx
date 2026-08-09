/* ---------------- Achievement tracker ---------------- */
const NYX_ACHIEVEMENT_GAMES = {
  gi:{ name:'Genshin Impact', short:'Genshin', defaultProfile:'My Traveler', currency:'Primogems' },
  hsr:{ name:'Honkai: Star Rail', short:'Star Rail', defaultProfile:'My Trailblazer', currency:'Stellar Jade' },
};

const NYX_ACHIEVEMENT_VIEW = window.NyxAchievementViewModel;
if (!NYX_ACHIEVEMENT_VIEW) throw new Error('NyxAchievementViewModel must load before achievement-view.jsx.');
const NYX_ACHIEVEMENT_BATCH = NYX_ACHIEVEMENT_VIEW.BATCH_SIZE;

function nyxAchievementDownload(name, value){
  const blob = new Blob([value], { type:'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const nyxAchievementCatalogRows = NYX_ACHIEVEMENT_VIEW.catalogRows;
const nyxAchievementReward = NYX_ACHIEVEMENT_VIEW.reward;
const nyxAchievementCompareVersions = NYX_ACHIEVEMENT_VIEW.compareVersions;

function nyxAchievementIconPath(value, game){
  const path = String(value || '');
  if (!['gi', 'hsr'].includes(game) || path.includes('..') || !path.startsWith(`/assets/achievements/${game}/`)) return '';
  return /^[A-Za-z0-9_./-]+\.(?:avif|png|svg|webp)$/i.test(path) ? path : '';
}

function nyxAchievementCategorySymbol(category){
  return category?.symbol?.value || category?.symbol || String(category?.name || '?')
    .split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

// The decorative "eye seal" was removed 2026-08-09. "All achievements" now
// borrows the game's first category icon — for Genshin that is Wonders of the
// World, which the user picked as the default.
function AchievementCategoryIcon({ category, game, className='', all=false, categories=null }){
  const [failed, setFailed] = React.useState(false);
  const source = all ? (Array.isArray(categories) ? categories[0] : null) : category;
  const path = nyxAchievementIconPath(source?.icon?.path || source?.iconPath, game);
  React.useEffect(() => setFailed(false), [path]);
  return <span className={`${className} achievement-category-art`} aria-hidden="true">
    {path && !failed
      ? <img src={path} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      : <b>{all ? '★' : nyxAchievementCategorySymbol(category)}</b>}
  </span>;
}

function AchievementPage({ game }){
  const config = NYX_ACHIEVEMENT_GAMES[game];
  const [catalogState, setCatalogState] = React.useState({ loading:true, data:null, error:null, attempt:0 });
  const [storeState] = React.useState(() => {
    try { return { value:window.NyxAchievementStore.create(), error:'' }; }
    catch (error) { return { value:null, error:error.message || 'Local storage is unavailable.' }; }
  });
  const store = storeState.value;
  const [runtimeError, setRuntimeError] = React.useState('');
  const storeError = storeState.error || runtimeError;
  const [profiles, setProfiles] = React.useState([]);
  const [profileId, setProfileId] = React.useState('');
  const [query, setQuery] = React.useState('');
  const deferredQuery = React.useDeferredValue(query);
  const [status, setStatus] = React.useState('all');
  const [categoryId, setCategoryId] = React.useState('all');
  const [version, setVersion] = React.useState('all');
  const [reward, setReward] = React.useState('all');
  const [rarity, setRarity] = React.useState('all');
  const [sort, setSort] = React.useState('source');
  const [visibleLimit, setVisibleLimit] = React.useState(NYX_ACHIEVEMENT_BATCH);
  const [expandedId, setExpandedId] = React.useState('');
  const [categoryQuery, setCategoryQuery] = React.useState('');
  const [hideCompletedCategories, setHideCompletedCategories] = React.useState(false);
  const [atlasOpen, setAtlasOpen] = React.useState(false);
  const [categoryGridOpen, setCategoryGridOpen] = React.useState(false);
  const [manageOpen, setManageOpen] = React.useState(false);
  const [manageTab, setManageTab] = React.useState('import');
  const [profileDraft, setProfileDraft] = React.useState({ label:'', uid:'' });
  const [newProfileName, setNewProfileName] = React.useState('');
  const [confirmAction, setConfirmAction] = React.useState('');
  const [bulkConfirm, setBulkConfirm] = React.useState('');
  const [importPreview, setImportPreview] = React.useState(null);
  const [importMode, setImportMode] = React.useState('merge');
  const [replaceConfirmed, setReplaceConfirmed] = React.useState(false);
  const [importMessage, setImportMessage] = React.useState('');
  const [importError, setImportError] = React.useState('');
  const importInput = React.useRef(null);
  const restoreInput = React.useRef(null);
  const manageButton = React.useRef(null);
  const managePanel = React.useRef(null);
  const atlasToggle = React.useRef(null);

  const refreshProfiles = React.useCallback((preferredId) => {
    if (!store) return;
    try {
      let next = store.listProfiles(game);
      if (!next.length) next = [store.createProfile({ game, label:config.defaultProfile })];
      setRuntimeError('');
      setProfiles(next);
      setProfileId((current) => {
        const wanted = preferredId || current;
        return next.some((row) => row.id === wanted) ? wanted : next[0].id;
      });
    } catch (error) {
      setProfiles([]);
      setProfileId('');
      setRuntimeError(error.message || 'Achievement progress could not be saved in this browser.');
    }
  }, [store, game, config.defaultProfile]);

  React.useEffect(() => { refreshProfiles(); }, [refreshProfiles]);
  React.useEffect(() => {
    setCategoryId('all');
    setQuery('');
    setStatus('all');
    setVersion('all');
    setReward('all');
    setRarity('all');
    setSort('source');
    setImportPreview(null);
    setImportError('');
  }, [game, profileId]);
  React.useEffect(() => {
    const controller = new AbortController();
    setCatalogState((state) => ({ ...state, loading:true, data:null, error:null }));
    fetch(`/data/achievements/${game}/catalog.json`, { signal:controller.signal, credentials:'same-origin' })
      .then((response) => { if (!response.ok) throw new Error(`Achievement catalog returned ${response.status}`); return response.json(); })
      .then((data) => {
        if (data?.schemaVersion !== 1 || data?.game !== game || !Array.isArray(data.categories) || !Array.isArray(data.achievements)) throw new Error('The achievement catalog is invalid.');
        setCatalogState((state) => ({ ...state, loading:false, data, error:null }));
      })
      .catch((error) => { if (error.name !== 'AbortError') setCatalogState((state) => ({ ...state, loading:false, data:null, error:error.message || 'Achievements could not be loaded.' })); });
    return () => controller.abort();
  }, [game, catalogState.attempt]);
  React.useEffect(() => {
    if (!store) return undefined;
    const listener = (event) => {
      if (!event.key || event.key.startsWith(window.NyxAchievementStore.STORAGE_PREFIX)) refreshProfiles(profileId);
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, [store, profileId, refreshProfiles]);
  React.useEffect(() => {
    if (!manageOpen) return undefined;
    const previouslyFocused = document.activeElement;
    const frame = requestAnimationFrame(() => managePanel.current?.querySelector('button, input, select')?.focus());
    const keydown = (event) => {
      if (event.key === 'Escape') { setManageOpen(false); return; }
      if (event.key !== 'Tab' || !managePanel.current) return;
      const focusable = Array.from(managePanel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!managePanel.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keydown);
      if (previouslyFocused === document.body) manageButton.current?.focus();
      else previouslyFocused?.focus?.();
    };
  }, [manageOpen]);
  React.useEffect(() => {
    if (!atlasOpen) return undefined;
    const keydown = (event) => {
      if (event.key !== 'Escape') return;
      setAtlasOpen(false);
      requestAnimationFrame(() => atlasToggle.current?.focus());
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [atlasOpen]);

  const storedProfile = profiles.find((row) => row.id === profileId) || profiles[0] || null;
  const profile = storedProfile || ((!store || storeError) ? { id:'read-only', game, label:'Read-only catalog', uid:'', completedIds:[], unknownIds:[] } : null);
  const canSave = Boolean(store && storedProfile && !storeError);
  React.useEffect(() => {
    setProfileDraft({ label:profile?.label || '', uid:profile?.uid || '' });
    setConfirmAction('');
  }, [profile?.id, profile?.label, profile?.uid]);

  const rows = React.useMemo(() => nyxAchievementCatalogRows(catalogState.data), [catalogState.data]);
  const categories = React.useMemo(() => (catalogState.data?.categories || []).map((category) => ({ ...category, id:String(category.id) })), [catalogState.data]);
  React.useEffect(() => {
    if (!store || !storedProfile || !rows.length) return;
    try {
      const result = store.reconcileCatalog(game, storedProfile.id, rows.map((row) => row.id));
      if (result.resolved) setProfiles((current) => current.map((item) => item.id === result.profile.id ? result.profile : item));
    } catch (error) { setRuntimeError(error.message || 'Imported achievement IDs could not be updated.'); }
  }, [store, storedProfile?.id, rows, game]);

  const completed = React.useMemo(() => new Set(profile?.completedIds || []), [profile]);
  const categoryById = React.useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const categoryProgress = React.useMemo(() => {
    const progress = new Map(categories.map((category) => [category.id, { total:0, done:0, reward:0, earned:0, versions:[] }]));
    for (const row of rows) {
      if (!progress.has(row.categoryId)) progress.set(row.categoryId, { total:0, done:0, reward:0, earned:0, versions:[] });
      const value = progress.get(row.categoryId);
      const amount = nyxAchievementReward(row);
      value.total += 1;
      value.reward += amount;
      if (row.version) value.versions.push(row.version);
      if (completed.has(row.id)) { value.done += 1; value.earned += amount; }
    }
    return progress;
  }, [categories, rows, completed]);
  const doneCount = React.useMemo(() => rows.reduce((count, row) => count + (completed.has(row.id) ? 1 : 0), 0), [rows, completed]);
  const totalReward = React.useMemo(() => rows.reduce((sum, row) => sum + nyxAchievementReward(row), 0), [rows]);
  const earnedReward = React.useMemo(() => rows.reduce((sum, row) => sum + (completed.has(row.id) ? nyxAchievementReward(row) : 0), 0), [rows, completed]);
  const completeCategories = React.useMemo(() => categories.reduce((count, category) => {
    const progress = categoryProgress.get(category.id);
    return count + (progress?.total > 0 && progress.done === progress.total ? 1 : 0);
  }, 0), [categories, categoryProgress]);
  const percent = rows.length ? Math.round((doneCount / rows.length) * 100) : 0;
  const selectedCategory = categoryId === 'all' ? null : categoryById.get(categoryId) || null;
  const selectedProgress = selectedCategory ? categoryProgress.get(selectedCategory.id) : { total:rows.length, done:doneCount, reward:totalReward, earned:earnedReward, versions:rows.map((row) => row.version).filter(Boolean) };
  const currencyName = catalogState.data?.rewardCurrency?.name || config.currency;
  const rewardIcon = nyxAchievementIconPath(catalogState.data?.rewardCurrency?.icon?.path, game);

  const availableVersions = React.useMemo(() => Array.from(new Set(rows.map((row) => row.version).filter(Boolean))).sort((a, b) => nyxAchievementCompareVersions(b, a)), [rows]);
  const availableRewards = React.useMemo(() => Array.from(new Set(rows.map(nyxAchievementReward).filter((value) => value > 0))).sort((a, b) => a - b), [rows]);
  const availableRarities = React.useMemo(() => Array.from(new Set(rows.map((row) => row.rarity).filter(Boolean))).sort(), [rows]);
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
  const filteredRows = React.useMemo(() => NYX_ACHIEVEMENT_VIEW.filterRows(rows, {
    completed, categoryId, status, version, reward, rarity, query:normalizedQuery, sort,
  }), [rows, completed, categoryId, status, version, reward, rarity, normalizedQuery, sort]);
  React.useEffect(() => { setVisibleLimit(NYX_ACHIEVEMENT_BATCH); setExpandedId(''); }, [categoryId, status, version, reward, rarity, normalizedQuery, sort]);
  const visibleRows = NYX_ACHIEVEMENT_VIEW.progressiveRows(filteredRows, visibleLimit).rows;
  const hasFilters = Boolean(query.trim() || status !== 'all' || version !== 'all' || reward !== 'all' || rarity !== 'all' || sort !== 'source');
  const filteredCategories = React.useMemo(() => NYX_ACHIEVEMENT_VIEW.filterCategories(categories, categoryProgress, {
    query:categoryQuery, hideCompleted:hideCompletedCategories,
  }), [categories, categoryProgress, categoryQuery, hideCompletedCategories]);

  const clearFilters = () => {
    setQuery(''); setStatus('all'); setVersion('all'); setReward('all'); setRarity('all'); setSort('source');
  };
  const selectCategory = (id) => {
    setCategoryId(id);
    setAtlasOpen(false);
    setCategoryGridOpen(false);
    setBulkConfirm('');
    if (atlasOpen) requestAnimationFrame(() => atlasToggle.current?.focus());
  };
  const updateLocalProfile = (next) => setProfiles((current) => current.map((row) => row.id === next.id && row.game === next.game ? next : row));
  const toggleAchievement = (id, checked) => {
    if (!store || !storedProfile) return;
    const previous = storedProfile;
    const optimistic = new Set(previous.completedIds);
    if (checked) optimistic.add(id); else optimistic.delete(id);
    updateLocalProfile({ ...previous, completedIds:Array.from(optimistic), unknownIds:previous.unknownIds.filter((value) => value !== id) });
    try {
      const saved = store.setCompleted(game, previous.id, id, checked);
      setRuntimeError('');
      updateLocalProfile(saved);
    } catch (error) {
      updateLocalProfile(previous);
      setRuntimeError(error.message || 'That checkmark could not be saved.');
    }
  };
  const applyBulk = (complete) => {
    if (!store || !storedProfile) return;
    const targetRows = categoryId === 'all' ? rows : rows.filter((row) => row.categoryId === categoryId);
    try {
      const result = store.setCompletedMany(game, storedProfile.id, targetRows.map((row) => row.id), complete);
      updateLocalProfile(result.profile);
      setBulkConfirm('');
      setRuntimeError('');
    } catch (error) { setRuntimeError(error.message || 'That category could not be updated.'); }
  };
  const createProfile = (event) => {
    event.preventDefault();
    const label = newProfileName.trim();
    if (!store || !label) return;
    try {
      const created = store.createProfile({ game, label });
      setNewProfileName('');
      refreshProfiles(created.id);
      setRuntimeError('');
    } catch (error) { setRuntimeError(error.message || 'That profile could not be saved.'); }
  };
  const saveProfile = (event) => {
    event.preventDefault();
    if (!store || !storedProfile || !profileDraft.label.trim()) return;
    try {
      const saved = store.updateProfile(game, storedProfile.id, profileDraft);
      updateLocalProfile(saved);
      setRuntimeError('');
      setImportMessage('Profile details saved.');
    } catch (error) { setRuntimeError(error.message || 'Profile details could not be saved.'); }
  };
  const deleteProfile = () => {
    if (!store || !storedProfile || profiles.length <= 1) return;
    try {
      store.deleteProfile(game, storedProfile.id);
      setConfirmAction('');
      refreshProfiles();
    } catch (error) { setRuntimeError(error.message || 'That profile could not be deleted.'); }
  };
  const resetProgress = () => {
    if (!store || !storedProfile) return;
    try {
      const result = store.resetProgress(game, storedProfile.id);
      updateLocalProfile(result.profile);
      setConfirmAction('');
      setImportMessage(`${result.removed} checkmark${result.removed === 1 ? '' : 's'} cleared.`);
    } catch (error) { setRuntimeError(error.message || 'Progress could not be reset.'); }
  };
  const readJsonFile = (file, onValue) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setImportError('That file is too large. Choose a JSON file smaller than 5 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => onValue(String(reader.result || ''));
    reader.onerror = () => setImportError('That file could not be read.');
    reader.readAsText(file);
  };
  const previewImport = (file) => readJsonFile(file, (text) => {
    setImportError(''); setImportMessage(''); setImportPreview(null); setReplaceConfirmed(false);
    try {
      const parsed = window.NyxAchievementImport.parse(text);
      if (parsed.format !== 'stardb') throw new Error('Choose a Pengo/Stardb-compatible achievement export here.');
      setImportPreview(window.NyxAchievementImport.preview(parsed, game, rows, storedProfile));
    } catch (error) { setImportError(error.message || 'That achievement file is not supported.'); }
    if (importInput.current) importInput.current.value = '';
  });
  const applyImport = () => {
    if (!store || !storedProfile || !importPreview || (importMode === 'replace' && !replaceConfirmed)) return;
    try {
      const result = window.NyxAchievementImport.apply(store, storedProfile.id, importPreview, { mode:importMode });
      updateLocalProfile(result.profile);
      setRuntimeError('');
      setImportMessage(importMode === 'replace'
        ? `Progress replaced. ${result.added} checkmark${result.added === 1 ? '' : 's'} added, ${result.removed} removed.${result.unknownRemoved ? ` ${result.unknownRemoved} unmatched ID${result.unknownRemoved === 1 ? '' : 's'} removed.` : ''}`
        : `${result.added} new checkmark${result.added === 1 ? '' : 's'} added.${result.unknownAdded ? ` ${result.unknownAdded} unknown ID${result.unknownAdded === 1 ? '' : 's'} kept safely.` : ''}`);
      setImportPreview(null);
      setReplaceConfirmed(false);
    } catch (error) { setImportError(error.message || 'That progress could not be saved.'); }
  };
  const restoreBackup = (file) => readJsonFile(file, (text) => {
    setImportError(''); setImportMessage('');
    try {
      const parsed = window.NyxAchievementImport.parse(text);
      const result = window.NyxAchievementImport.restoreBackup(store, parsed);
      setImportMessage(`Backup restored: ${result.created} profile${result.created === 1 ? '' : 's'} added, ${result.merged} safely merged.`);
      refreshProfiles();
    } catch (error) { setImportError(error.message || 'That backup is not supported.'); }
    if (restoreInput.current) restoreInput.current.value = '';
  });
  const exportBackup = (selectedOnly) => {
    if (!store || !storedProfile) return;
    try {
      const bundle = store.exportBackup(selectedOnly ? { game, profileId:storedProfile.id } : undefined);
      const scope = selectedOnly ? `${game}-${storedProfile.label || 'profile'}` : 'all';
      nyxAchievementDownload(`nyx-achievements-${scope}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2) + '\n');
    } catch (error) { setRuntimeError(error.message || 'The backup could not be created.'); }
  };

  const sampleImportNames = importPreview ? importPreview.newCompletedIds.slice(0, 5).map((id) => rows.find((row) => row.id === id)?.name || `#${id}`) : [];
  const versionRange = selectedProgress?.versions?.length
    ? [...selectedProgress.versions].sort(nyxAchievementCompareVersions)
    : [];

  return <main className={`gp-main-pane fill achievement-page achievement-${game}`}>
    <header className="achievement-page-head">
      {/* The seal in front of the heading was removed 2026-08-09 at the user's
          request. */}
      <div className="achievement-page-title">
        <div><span>{config.name}</span><h1>Achievements</h1></div>
      </div>
      <div className="achievement-overall" role="progressbar" aria-label="Overall achievement progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
        <span>Completed</span><strong>{doneCount.toLocaleString()} / {rows.length.toLocaleString()}</strong>
        <i><b style={{ width:`${percent}%` }} /></i>
        <small>{earnedReward.toLocaleString()} / {totalReward.toLocaleString()} {currencyName} · {completeCategories} / {categories.length} categories</small>
      </div>
      <div className="achievement-profile-tools">
        <label><span>Profile</span><select value={storedProfile?.id || ''} onChange={(event) => setProfileId(event.target.value)} disabled={!canSave || !profiles.length}>{profiles.length ? profiles.map((row) => <option value={row.id} key={row.id}>{row.label || 'Unnamed profile'}</option>) : <option>Read-only catalog</option>}</select></label>
        <button ref={manageButton} type="button" className="achievement-manage-button" onClick={() => setManageOpen(true)} disabled={!profile}>Manage progress</button>
      </div>
    </header>

    {storeError && <div className="achievement-notice error" role="alert"><strong>Checkmarks are unavailable.</strong><span>{storeError} You can still browse the catalog.</span></div>}
    {catalogState.loading && <div className="achievement-loading" role="status" aria-live="polite"><span /><span /><span /><p>Loading achievements…</p></div>}
    {catalogState.error && <div className="achievement-notice error" role="alert"><p>{catalogState.error}</p><button type="button" onClick={() => setCatalogState((state) => ({ ...state, attempt:state.attempt + 1 }))}>Try again</button></div>}

    {catalogState.data && profile && <>
      {profile.unknownIds.length > 0 && <div className="achievement-notice achievement-unknown-note"><strong>{profile.unknownIds.length} future match{profile.unknownIds.length === 1 ? '' : 'es'} saved</strong><span>These imported IDs are not in this catalog yet. They will become checkmarks automatically if a future catalog includes them.</span></div>}

      <div className="achievement-toolbar">
        <label className="achievement-search"><span>Search achievements</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search achievements" /></label>
        <div className="achievement-status-filter" role="group" aria-label="Completion filter">{[['all','All'],['missing','Missing'],['done','Completed']].map(([value, label]) => <button type="button" key={value} className={status === value ? 'on' : ''} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>)}</div>
        <button type="button" className="achievement-gallery-toggle" aria-pressed={categoryGridOpen} onClick={() => setCategoryGridOpen((value) => !value)}>{categoryGridOpen ? 'Back to list' : 'View categories'}</button>
        <label className="achievement-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="source">Game order</option><option value="incomplete">Incomplete first</option><option value="newest">Newest version</option><option value="reward">Highest reward</option><option value="name">Name A–Z</option></select></label>
      </div>

      <button ref={atlasToggle} type="button" className="achievement-atlas-toggle" aria-expanded={atlasOpen} aria-controls="achievement-category-atlas" onClick={() => setAtlasOpen((value) => !value)}>
        <AchievementCategoryIcon category={selectedCategory} game={game} all={!selectedCategory} categories={categories} className="achievement-atlas-toggle-art" />
        <span><small>Category</small><b>{selectedCategory?.name || 'All achievements'}</b></span><i aria-hidden="true">{atlasOpen ? 'Close' : 'Change'}</i>
      </button>

      {categoryGridOpen ? <section className="achievement-category-gallery" aria-label="Achievement categories">
        {categories.map((category) => {
          const progress = categoryProgress.get(category.id) || { done:0, total:0 };
          const categoryPercent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
          return <button type="button" className="achievement-category-card" key={category.id} onClick={() => selectCategory(category.id)}>
            <AchievementCategoryIcon category={category} game={game} className="achievement-category-card-icon" />
            <strong>{category.name}</strong>
            <span><small>{progress.done} / {progress.total}</small><b>{categoryPercent}%</b></span>
            <i style={{ '--category-progress':`${categoryPercent}%` }} />
          </button>;
        })}
      </section> : <div className="achievement-archive">
        <aside id="achievement-category-atlas" className={`achievement-atlas${atlasOpen ? ' open' : ''}`} aria-label="Achievement categories">
          <header><span>Categories</span><b>{categories.length} total</b></header>
          <label className="achievement-atlas-search"><span>Find a category</span><input type="search" value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="Category name" /></label>
          <label className="achievement-atlas-check"><input type="checkbox" checked={hideCompletedCategories} onChange={(event) => setHideCompletedCategories(event.target.checked)} /><span>Hide completed categories</span></label>
          <nav>
            <button type="button" className={categoryId === 'all' ? 'on' : ''} aria-current={categoryId === 'all' ? 'true' : undefined} onClick={() => selectCategory('all')}>
              <span className="achievement-category-orbit" style={{ '--cat-pct':`${percent * 3.6}deg` }}><AchievementCategoryIcon game={game} all categories={categories} className="achievement-category-icon" /></span>
              <span><strong>All achievements</strong><small>{doneCount} / {rows.length}<i>{percent}%</i></small></span>
            </button>
            {filteredCategories.map((category) => {
              const progress = categoryProgress.get(category.id) || { done:0, total:0 };
              const categoryPercent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
              return <button type="button" key={category.id} className={categoryId === category.id ? 'on' : ''} aria-current={categoryId === category.id ? 'true' : undefined} onClick={() => selectCategory(category.id)}>
                <span className="achievement-category-orbit" style={{ '--cat-pct':`${categoryPercent * 3.6}deg` }}><AchievementCategoryIcon category={category} game={game} className="achievement-category-icon" /></span>
                <span><strong>{category.name}</strong><small>{progress.done} / {progress.total}<i>{categoryPercent}%</i></small></span>
              </button>;
            })}
            {!filteredCategories.length && <p>No categories match that search.</p>}
          </nav>
        </aside>

        <section className="achievement-ledger" aria-label="Achievement ledger">
          <header className="achievement-ledger-heading">
            <AchievementCategoryIcon category={selectedCategory} game={game} all={!selectedCategory} categories={categories} className="achievement-ledger-icon" />
            <div><span>{selectedCategory ? 'Category' : 'Complete catalog'}</span><h2>{selectedCategory?.name || 'All achievements'}</h2><p>{selectedProgress.done} of {selectedProgress.total} complete · {selectedProgress.earned.toLocaleString()} of {selectedProgress.reward.toLocaleString()} {currencyName}{versionRange.length ? ` · v${versionRange[0]}–${versionRange[versionRange.length - 1]}` : ''}</p></div>
            <div className="achievement-category-actions">
              {!bulkConfirm && <><button type="button" onClick={() => setBulkConfirm('complete')} disabled={!canSave || selectedProgress.done === selectedProgress.total}>Mark all complete</button><button type="button" className="achievement-quiet-button" onClick={() => setBulkConfirm('clear')} disabled={!canSave || !selectedProgress.done}>Clear checks</button></>}
              {bulkConfirm && <div className="achievement-inline-confirm" role="alert"><span>{bulkConfirm === 'complete' ? `Check all ${selectedProgress.total}?` : `Remove ${selectedProgress.done} checks?`}</span><button autoFocus type="button" onClick={() => applyBulk(bulkConfirm === 'complete')}>Confirm</button><button type="button" className="achievement-quiet-button" onClick={() => setBulkConfirm('')}>Cancel</button></div>}
            </div>
          </header>

          <div className="achievement-filter-bar" aria-label="More achievement filters">
            <label><span>Version</span><select value={version} onChange={(event) => setVersion(event.target.value)}><option value="all">Every version</option>{availableVersions.map((value) => <option value={value} key={value}>v{value}</option>)}</select></label>
            <label><span>Reward</span><select value={reward} onChange={(event) => setReward(event.target.value)}><option value="all">Any reward</option>{availableRewards.map((value) => <option value={value} key={value}>{value} {currencyName}</option>)}</select></label>
            {game === 'hsr' && <label><span>Rarity</span><select value={rarity} onChange={(event) => setRarity(event.target.value)}><option value="all">Every rarity</option>{availableRarities.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>}
          </div>
          <div className="achievement-result-strip" aria-live="polite"><span>{filteredRows.length} achievement{filteredRows.length === 1 ? '' : 's'} found</span>{hasFilters && <button type="button" onClick={clearFilters}>Clear filters</button>}</div>

          <div className="achievement-list">
            {visibleRows.map((row) => {
              const isDone = completed.has(row.id);
              const category = categoryById.get(row.categoryId);
              const isExpanded = expandedId === row.id;
              const amount = nyxAchievementReward(row);
              return <article className={`achievement-row${isDone ? ' done' : ''}${isExpanded ? ' expanded' : ''}`} key={row.id}>
                <button type="button" className="achievement-check" aria-pressed={isDone} aria-label={`${isDone ? 'Mark incomplete' : 'Mark complete'}: ${row.name}`} onClick={() => toggleAchievement(row.id, !isDone)} disabled={!canSave}><span aria-hidden="true">{isDone ? '✓' : ''}</span></button>
                <button type="button" className="achievement-row-main" aria-expanded={isExpanded} aria-controls={`achievement-detail-${row.id}`} onClick={() => setExpandedId(isExpanded ? '' : row.id)}>
                  <span className="achievement-row-meta"><small>#{row.id}</small>{row.hidden && <em>Hidden</em>}{row.version && <em>v{row.version}</em>}{row.stageCount > 1 && <em>Stage {row.stage} of {row.stageCount}</em>}{row.rarity && <em>{row.rarity}</em>}{categoryId === 'all' && category && <em>{category.name}</em>}</span>
                  <strong>{row.name}</strong><span>{row.description}</span>
                </button>
                <span className="achievement-reward">{rewardIcon && <img src={rewardIcon} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}<b>{amount}</b><small>{currencyName}</small></span>
                {isExpanded && <div id={`achievement-detail-${row.id}`} className="achievement-row-detail">
                  <div><span>Requirement</span><p>{row.description || 'No requirement text is available in this catalog.'}</p></div>
                  <dl><div><dt>Stable ID</dt><dd>{row.id}</dd></div><div><dt>Category</dt><dd>{category?.name || 'Unknown'}</dd></div>{row.version && <div><dt>Released</dt><dd>Version {row.version}</dd></div>}<div><dt>Reward</dt><dd>{amount} {currencyName}</dd></div>{row.stageCount > 1 && <div><dt>Chain</dt><dd>Stage {row.stage} of {row.stageCount}</dd></div>}{row.rarity && <div><dt>Rarity</dt><dd>{row.rarity}</dd></div>}</dl>
                </div>}
              </article>;
            })}
            {!filteredRows.length && <div className="achievement-empty"><AchievementCategoryIcon game={game} all categories={categories} className="achievement-empty-seal" /><strong>No achievements match</strong><span>Change the search or filters.</span><button type="button" onClick={clearFilters}>Clear filters</button></div>}
            {visibleRows.length < filteredRows.length && <button type="button" className="achievement-load-more" onClick={() => setVisibleLimit((value) => value + NYX_ACHIEVEMENT_BATCH)}>Show {Math.min(NYX_ACHIEVEMENT_BATCH, filteredRows.length - visibleRows.length)} more <span>{visibleRows.length} of {filteredRows.length} loaded</span></button>}
            {!doneCount && !hasFilters && categoryId === 'all' && <div className="achievement-zero-guide"><strong>No progress yet</strong><span>Import progress or mark achievements one by one.</span><button type="button" onClick={() => setManageOpen(true)}>Manage progress</button></div>}
          </div>
        </section>
      </div>}

      <footer className="achievement-disclaimer">PENGO • Nyx is an unofficial fan-made tool and is not affiliated with HoYoverse.<br />Game content and assets are owned by HoYoverse / COGNOSPHERE / miHoYo.<br />Other properties belong to their respective owners.</footer>
    </>}

    {manageOpen && <div className="achievement-manage-layer">
      <button type="button" className="achievement-manage-scrim" aria-label="Close achievement management" onClick={() => setManageOpen(false)} />
      <aside ref={managePanel} className="achievement-manage" role="dialog" aria-modal="true" aria-labelledby="achievement-manage-title">
        <header><div><span>Achievement controls</span><h2 id="achievement-manage-title">Manage progress</h2></div><button type="button" className="achievement-manage-close" aria-label="Close" onClick={() => setManageOpen(false)}>×</button></header>
        <nav aria-label="Management sections">{[['import','Import progress'],['profile','Profile'],['backup','Backup']].map(([value, label]) => <button type="button" key={value} className={manageTab === value ? 'on' : ''} aria-current={manageTab === value ? 'page' : undefined} onClick={() => { setManageTab(value); setConfirmAction(''); }}>{label}</button>)}</nav>

        {manageTab === 'import' && <section className="achievement-manage-section">
          <div className="achievement-manage-intro"><span>Import progress</span><h3>Import achievement progress</h3><p>Choose a Pengo/Stardb-compatible JSON file. Nothing changes until you approve the preview.</p></div>
          <label className="achievement-file-button" aria-disabled={!canSave}>Choose achievement JSON<input ref={importInput} type="file" accept=".json,application/json" onChange={(event) => previewImport(event.target.files?.[0])} disabled={!canSave} /></label>
          <fieldset className="achievement-import-mode"><legend>How should this import behave?</legend><label><input type="radio" name="achievement-import-mode" value="merge" checked={importMode === 'merge'} onChange={() => { setImportMode('merge'); setReplaceConfirmed(false); }} /><span><b>Merge</b><small>Safe default. Add checks and keep everything already marked.</small></span></label><label><input type="radio" name="achievement-import-mode" value="replace" checked={importMode === 'replace'} onChange={() => { setImportMode('replace'); setReplaceConfirmed(false); }} /><span><b>Replace</b><small>Make this profile match the file, including removing checks.</small></span></label></fieldset>
          {importPreview && <div className="achievement-import-preview" role="status"><div><b>{importPreview.newCompletedCount}</b><span>new checks</span></div><div><b>{importPreview.alreadyCompletedCount}</b><span>already checked</span></div><div className={importPreview.unknownCount ? 'warn' : ''}><b>{importPreview.unknownCount}</b><span>unknown IDs</span></div><div className={importPreview.invalidCount ? 'warn' : ''}><b>{importPreview.invalidCount}</b><span>invalid rows</span></div><div className={importPreview.duplicateCount ? 'warn' : ''}><b>{importPreview.duplicateCount}</b><span>duplicates skipped</span></div>{importMode === 'replace' && <><div className={importPreview.replaceCompletedRemovedCount ? 'danger' : ''}><b>{importPreview.replaceCompletedRemovedCount}</b><span>checks removed</span></div><div className={importPreview.replaceUnknownRemovedCount ? 'danger' : ''}><b>{importPreview.replaceUnknownRemovedCount}</b><span>unmatched IDs removed</span></div></>}<p><strong>Detected game:</strong> {importPreview.game === 'gi' ? 'Genshin Impact' : 'Honkai: Star Rail'}{sampleImportNames.length > 0 && <> · <strong>New matches:</strong> {sampleImportNames.join(' · ')}</>}{!importPreview.uniqueCount && <> · No usable achievement IDs were found.</>}</p>{importMode === 'replace' && <label className="achievement-replace-confirm"><input type="checkbox" checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} /><span>I understand this removes saved checkmarks and unmatched IDs missing from the file.</span></label>}<div className="achievement-import-actions"><button type="button" onClick={applyImport} disabled={!importPreview.uniqueCount || (importMode === 'replace' && !replaceConfirmed)}>{importMode === 'replace' ? 'Replace this profile' : 'Merge this progress'}</button><button type="button" className="achievement-quiet-button" onClick={() => setImportPreview(null)}>Cancel</button></div></div>}
          {profile?.unknownIds?.length > 0 && <details className="achievement-unknown-list"><summary>{profile.unknownIds.length} unmatched imported ID{profile.unknownIds.length === 1 ? '' : 's'}</summary><p>{profile.unknownIds.join(', ')}</p></details>}
        </section>}

        {manageTab === 'profile' && <section className="achievement-manage-section">
          <div className="achievement-manage-intro"><span>Profile</span><h3>{storedProfile?.label || 'Read-only catalog'}</h3><p>Profiles let two accounts keep separate checkmarks on this device.</p></div>
          <form className="achievement-profile-form" onSubmit={saveProfile}><label><span>Profile name</span><input value={profileDraft.label} onChange={(event) => setProfileDraft((value) => ({ ...value, label:event.target.value }))} maxLength="80" disabled={!canSave} /></label><label><span>UID (optional)</span><input value={profileDraft.uid} onChange={(event) => setProfileDraft((value) => ({ ...value, uid:event.target.value }))} maxLength="64" inputMode="numeric" placeholder="Only saved in this browser" disabled={!canSave} /></label><button type="submit" disabled={!canSave || !profileDraft.label.trim()}>Save details</button></form>
          <form className="achievement-create-profile" onSubmit={createProfile}><label><span>New profile</span><input value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} maxLength="80" placeholder={config.defaultProfile} disabled={!canSave} /></label><button type="submit" disabled={!canSave || !newProfileName.trim()}>Create profile</button></form>
          <div className="achievement-danger-zone"><span>Danger area</span>{confirmAction !== 'reset' ? <button type="button" onClick={() => setConfirmAction('reset')} disabled={!canSave || !(profile?.completedIds?.length || profile?.unknownIds?.length)}>Reset this profile’s progress</button> : <div className="achievement-danger-confirm" role="alert"><p>Remove all {profile.completedIds.length} checkmarks and {profile.unknownIds.length} unmatched IDs from this profile?</p><button autoFocus type="button" onClick={resetProgress}>Yes, reset progress</button><button type="button" className="achievement-quiet-button" onClick={() => setConfirmAction('')}>Cancel</button></div>}{confirmAction !== 'delete' ? <button type="button" onClick={() => setConfirmAction('delete')} disabled={!canSave || profiles.length <= 1}>Delete this profile</button> : <div className="achievement-danger-confirm" role="alert"><p>Delete “{storedProfile?.label}” and all of its local progress?</p><button autoFocus type="button" onClick={deleteProfile}>Yes, delete profile</button><button type="button" className="achievement-quiet-button" onClick={() => setConfirmAction('')}>Cancel</button></div>}<small>{profiles.length <= 1 ? 'Create another profile before deleting this one.' : 'This cannot be undone unless you have a backup.'}</small></div>
        </section>}

        {manageTab === 'backup' && <section className="achievement-manage-section">
          <div className="achievement-manage-intro"><span>Backup</span><h3>Keep a copy you control</h3><p>Backups are readable JSON files. They include profile names, optional UIDs, and checkmarks.</p></div>
          <div className="achievement-backup-actions"><button type="button" onClick={() => exportBackup(true)} disabled={!canSave}>Save this profile</button><button type="button" className="achievement-quiet-button" onClick={() => exportBackup(false)} disabled={!canSave}>Save all profiles</button><label className="achievement-quiet-button achievement-file-button" aria-disabled={!canSave}>Restore backup<input ref={restoreInput} type="file" accept=".json,application/json" onChange={(event) => restoreBackup(event.target.files?.[0])} disabled={!canSave} /></label></div>
          <p className="achievement-backup-note">Restore safely merges progress. It does not erase newer checkmarks already in this browser.</p>
        </section>}
        {importMessage && <p className="achievement-import-message" role="status">{importMessage}</p>}
        {importError && <p className="achievement-import-message error" role="alert">{importError}</p>}
      </aside>
    </div>}
  </main>;
}
