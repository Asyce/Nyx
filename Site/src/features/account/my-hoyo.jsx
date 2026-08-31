function myHoyoRoleKey(binding){
  return binding ? binding.server + ':' + binding.roleId : '';
}

function myHoyoDate(value){
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'Unknown';
}

function myHoyoExpectedFull(resource){
  const observed = Date.parse(resource?.observedAt || '');
  const recovery = Number(resource?.recoverySeconds);
  if (!Number.isFinite(observed) || !Number.isInteger(recovery) || recovery < 0) return 'Unknown';
  return myHoyoDate(new Date(observed + recovery * 1000).toISOString());
}

function MyHoyoPage(){
  const api = window.NyxHoyoSync;
  const sessionRef = React.useRef(null);
  const operationRef = React.useRef({ generation:0, controller:null });
  const catalogAbortRef = React.useRef(null);
  const mountedRef = React.useRef(false);
  const pullOnlyFormRef = React.useRef(null);
  const combinedFormRef = React.useRef(null);
  const [recoveryCode, setRecoveryCode] = React.useState('');
  const [session, setSession] = React.useState(null);
  const [hasHoyoAuth, setHasHoyoAuth] = React.useState(false);
  const [selectedRole, setSelectedRole] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [catalog, setCatalog] = React.useState({ rows:new Map(), loading:false, error:'' });
  const [visibleAchievements, setVisibleAchievements] = React.useState(100);
  const [entirePengoOpen, setEntirePengoOpen] = React.useState(false);

  const clearSensitive = React.useCallback(({ updateState = true, nextMessage = '' } = {}) => {
    operationRef.current.generation += 1;
    operationRef.current.controller?.abort();
    operationRef.current.controller = null;
    catalogAbortRef.current?.abort();
    catalogAbortRef.current = null;
    if (sessionRef.current) api?.scrub(sessionRef.current);
    sessionRef.current = null;
    pullOnlyFormRef.current?.reset();
    combinedFormRef.current?.reset();
    if (updateState) {
      setRecoveryCode('');
      setSession(null);
      setHasHoyoAuth(false);
      setSelectedRole('');
      setVisibleAchievements(100);
      setEntirePengoOpen(false);
      setBusy(false);
      setError('');
      setMessage(nextMessage);
    }
  }, [api]);

  const beginOperation = React.useCallback(() => {
    operationRef.current.controller?.abort();
    const controller = new AbortController();
    const generation = operationRef.current.generation + 1;
    operationRef.current = { generation, controller };
    return { generation, controller };
  }, []);

  const isCurrentOperation = React.useCallback((operation) => (
    mountedRef.current && operationRef.current.generation === operation.generation
  ), []);

  React.useEffect(() => {
    mountedRef.current = true;
    const exitPage = () => ReactDOM.flushSync(() => clearSensitive({ updateState:true }));
    const restorePage = (event) => { if (event.persisted) ReactDOM.flushSync(() => clearSensitive({ updateState:true, nextMessage:'Locked after page restore.' })); };
    window.addEventListener('pagehide', exitPage);
    window.addEventListener('pageshow', restorePage);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', exitPage);
      window.removeEventListener('pageshow', restorePage);
      clearSensitive({ updateState:false });
    };
  }, [clearSensitive]);

  React.useEffect(() => {
    if (!session) { setCatalog({ rows:new Map(), loading:false, error:'' }); return undefined; }
    const controller = new AbortController();
    catalogAbortRef.current = controller;
    setCatalog({ rows:new Map(), loading:true, error:'' });
    fetch('/data/achievements/hsr/catalog.json', { signal:controller.signal, credentials:'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error('Achievement catalog returned ' + response.status + '.');
        return response.json();
      })
      .then((data) => {
        if (controller.signal.aborted || !mountedRef.current) return;
        if (data?.schemaVersion !== 1 || data?.game !== 'hsr' || !Array.isArray(data.achievements)) throw new Error('The achievement catalog is invalid.');
        setCatalog({ rows:new Map(data.achievements.map((row) => [String(row.id), row])), loading:false, error:'' });
      })
      .catch((reason) => {
        if (!controller.signal.aborted && mountedRef.current && reason.name !== 'AbortError') setCatalog({ rows:new Map(), loading:false, error:reason.message || 'Achievement names are unavailable.' });
      });
    return () => {
      controller.abort();
      if (catalogAbortRef.current === controller) catalogAbortRef.current = null;
    };
  }, [session]);

  if (!api) {
    return <main className="gp-main-pane fill my-hoyo"><section className="nyx-panel my-hoyo-lock"><h1>My HoYo</h1><p>Encrypted HoYo access is not available in this build.</p></section></main>;
  }

  const pullOnlyDeleteForm = (suffix) => <form ref={pullOnlyFormRef} className="my-hoyo-pull-retry" onSubmit={removePullOnly}>
    <p>Remove only encrypted pull-history cloud data with its separate sync phrase. This is available even when no HoYo copy can be opened.</p>
    <label htmlFor={'my-hoyo-pull-only-' + suffix}>Pull sync phrase</label>
    <input id={'my-hoyo-pull-only-' + suffix} name="pullPhrase" className="nyx-input" type="password" autoComplete="off" minLength="10" disabled={busy} required />
    <button type="submit" disabled={busy}>Remove pull-history cloud data</button>
  </form>;

  const unlock = async (event) => {
    event.preventDefault();
    if (busy) return;
    let rawCode = recoveryCode;
    clearSensitive();
    setBusy(true); setError(''); setMessage('');
    const operation = beginOperation();
    let candidate = null;
    try {
      const derivation = api.derive(rawCode);
      rawCode = '';
      const auth = await derivation;
      candidate = { auth, bundle:null, updatedAt:null };
      if (!isCurrentOperation(operation)) { api.scrub(candidate); return; }
      sessionRef.current = candidate;
      setHasHoyoAuth(true);
      const pulled = await api.pull(auth, { signal:operation.controller.signal });
      if (!isCurrentOperation(operation)) {
        api.scrub(pulled);
        if (sessionRef.current === candidate) sessionRef.current = null;
        api.scrub(candidate);
        return;
      }
      candidate.bundle = pulled.bundle;
      candidate.updatedAt = pulled.updatedAt;
      setSession(candidate);
      setSelectedRole(myHoyoRoleKey(candidate.bundle.selectedRole || candidate.bundle.roles[0]?.binding));
      setMessage('Your encrypted Star Rail copy is unlocked on this page.');
    } catch (reason) {
      if (!isCurrentOperation(operation)) {
        if (candidate && sessionRef.current !== candidate) api.scrub(candidate);
        return;
      }
      if (candidate?.auth) {
        candidate.auth.key = null;
        sessionRef.current = candidate;
        setHasHoyoAuth(true);
        setError((reason.message || 'That HoYo copy could not be opened.') + ' You can still try removing the cloud copy with this recovery code below.');
      } else {
        if (candidate) api.scrub(candidate);
        setError(reason.message || 'That HoYo copy could not be unlocked.');
      }
    } finally {
      rawCode = '';
      if (isCurrentOperation(operation)) {
        operationRef.current.controller = null;
        setBusy(false);
      }
    }
  };

  const lock = () => {
    clearSensitive({ nextMessage:'Locked.' });
  };

  const removeHsr = async () => {
    const auth = sessionRef.current?.auth;
    if (!auth || busy || !window.confirm('Remove the synced Star Rail copy from Pengo? This does not remove your launcher data or pull history.')) return;
    setBusy(true); setError(''); setMessage('');
    const operation = beginOperation();
    try {
      await api.deleteGame(auth, { signal:operation.controller.signal });
      if (isCurrentOperation(operation)) clearSensitive({ nextMessage:'Removed the Star Rail HoYo cloud copy. Launcher and pull data were not changed.' });
    } catch (reason) { if (isCurrentOperation(operation)) setError(reason.message || 'Star Rail cloud deletion was not confirmed.'); }
    finally { if (isCurrentOperation(operation)) { operationRef.current.controller = null; setBusy(false); } }
  };

  const removeHoyo = async () => {
    const auth = sessionRef.current?.auth;
    if (!auth || busy || !window.confirm('Remove all HoYo cloud data from Pengo? This does not remove pull history or local launcher data.')) return;
    setBusy(true); setError(''); setMessage('');
    const operation = beginOperation();
    try {
      await api.deleteAccount(auth, { signal:operation.controller.signal });
      if (isCurrentOperation(operation)) clearSensitive({ nextMessage:'Removed all HoYo cloud data. Pull history and local launcher data were not changed.' });
    } catch (reason) { if (isCurrentOperation(operation)) setError(reason.message || 'HoYo cloud deletion was not confirmed.'); }
    finally { if (isCurrentOperation(operation)) { operationRef.current.controller = null; setBusy(false); } }
  };

  const removePullOnly = async (event) => {
    event.preventDefault();
    if (busy || !window.confirm('Remove encrypted pull-history cloud data from Pengo? Local browser data stays on this device.')) return;
    let phrase = String(new FormData(event.currentTarget).get('pullPhrase') || '');
    event.currentTarget.reset();
    setBusy(true); setError(''); setMessage('');
    const operation = beginOperation();
    try {
      if (!window.NyxAccountSync?.deleteAccount) throw new Error('Pull cloud deletion is unavailable in this build.');
      const deletion = window.NyxAccountSync.deleteAccount(phrase, { signal:operation.controller.signal });
      phrase = '';
      await deletion;
      if (isCurrentOperation(operation)) setMessage('Removed encrypted pull-history cloud data. Local data was not changed.');
    } catch (reason) { if (isCurrentOperation(operation)) setError(reason.message || 'Pull cloud deletion was not confirmed.'); }
    finally { phrase = ''; if (isCurrentOperation(operation)) { operationRef.current.controller = null; setBusy(false); } }
  };

  const removeEntirePengo = async (event) => {
    event.preventDefault();
    const auth = sessionRef.current?.auth;
    if (!auth || busy) return;
    if (!window.confirm('Remove both HoYo data and encrypted pull history from Pengo cloud storage? Local browser and launcher data stay on your devices.')) return;
    setBusy(true); setError(''); setMessage('');
    let phrase = String(new FormData(event.currentTarget).get('pullPhrase') || '');
    event.currentTarget.reset();
    const operation = beginOperation();
    try {
      if (!window.NyxAccountSync?.deleteAccount) throw new Error('Pull cloud deletion is unavailable in this build.');
      const pullDeletion = window.NyxAccountSync.deleteAccount(phrase, { signal:operation.controller.signal });
      phrase = '';
      await pullDeletion;
    } catch (reason) {
      phrase = '';
      if (isCurrentOperation(operation)) {
        operationRef.current.controller = null;
        setError('Pull cloud deletion was not confirmed: ' + (reason.message || 'request failed') + ' HoYo cloud data was not touched. Retry the pull-only action.');
        setBusy(false);
      }
      return;
    }
    phrase = '';
    if (!isCurrentOperation(operation)) return;
    try {
      await api.deleteAccount(auth, { signal:operation.controller.signal });
      if (isCurrentOperation(operation)) clearSensitive({ nextMessage:'Removed HoYo and pull-history cloud data. Local data was not changed.' });
    } catch (reason) {
      if (isCurrentOperation(operation)) setError('Pull cloud data was removed. HoYo cloud deletion was not confirmed: ' + (reason.message || 'request failed') + ' Retry the HoYo-only action.');
    } finally {
      if (isCurrentOperation(operation)) { operationRef.current.controller = null; setBusy(false); }
    }
  };

  if (!session) {
    return (
      <main className="gp-main-pane fill my-hoyo">
        <section className="nyx-panel my-hoyo-lock" aria-labelledby="my-hoyo-title">
          <div className="my-hoyo-kicker">Private cloud viewer</div>
          <h1 id="my-hoyo-title">My HoYo</h1>
          <p>Unlock your encrypted Star Rail copy with the recovery code made by Nyx Launcher. The code and decrypted data stay in this page&rsquo;s memory.</p>
          <p className="my-hoyo-warning"><b>Keep the recovery code somewhere safe.</b> Pengo cannot recover the copy if every remembered device and the code are lost.</p>
          <form onSubmit={unlock} className="my-hoyo-unlock-form">
            <label htmlFor="my-hoyo-code">Recovery code</label>
            <input id="my-hoyo-code" className="nyx-input" type="text" value={recoveryCode}
                   onChange={(event) => { const nextCode = event.target.value; clearSensitive(); setRecoveryCode(nextCode); }} autoComplete="off" autoCapitalize="characters"
                   spellCheck="false" placeholder="NYX-HOYO-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" disabled={busy} required />
            <button type="submit" disabled={busy || !recoveryCode.trim()}>{busy ? 'Unlocking…' : 'Unlock'}</button>
          </form>
          {hasHoyoAuth && <section className="my-hoyo-auth-delete" aria-label="Unavailable HoYo copy deletion">
            <p>You can try removing the encrypted HoYo copy with this recovery code without opening its contents.</p>
            <div className="my-hoyo-delete-actions">
              <button type="button" onClick={lock} disabled={busy}>Lock</button>
              <button type="button" onClick={removeHsr} disabled={busy}>Remove HSR cloud copy</button>
              <button type="button" onClick={removeHoyo} disabled={busy}>Remove all HoYo cloud data</button>
            </div>
          </section>}
          {pullOnlyDeleteForm('locked')}
          {(error || message) && <p className={error ? 'my-hoyo-status error' : 'my-hoyo-status'} role={error ? 'alert' : 'status'}>{error || message}</p>}
        </section>
      </main>
    );
  }

  const role = session.bundle.roles.find((item) => myHoyoRoleKey(item.binding) === selectedRole) || session.bundle.roles[0] || null;
  const achievementIds = role?.completedAchievementIds;
  const achievementRows = Array.isArray(achievementIds)
    ? achievementIds.slice(0, visibleAchievements).map((id) => ({ id, row:catalog.rows.get(String(id)) || null }))
    : [];

  return (
    <main className="gp-main-pane fill my-hoyo">
      <div className="my-hoyo-scroll">
        <header className="my-hoyo-head">
          <div><div className="my-hoyo-kicker">Decrypted on this device</div><h1>My HoYo</h1></div>
          <button type="button" onClick={lock} disabled={busy}>Lock</button>
        </header>
        <section className="my-hoyo-sync-strip" aria-label="Cloud copy status">
          <span><b>Cloud copy</b> Unlocked</span>
          <span><b>Last updated</b> {myHoyoDate(session.updatedAt)}</span>
          <a href="https://act.hoyolab.com/app/community-game-records-sea/index.html?gid=6#/hsr" target="_blank" rel="noopener noreferrer" aria-label="Open official HoYoLAB Star Rail Battle Records in a new tab">Open official Battle Records</a>
        </section>

        <section className="my-hoyo-roles" aria-labelledby="my-hoyo-roles-title">
          <div><h2 id="my-hoyo-roles-title">Star Rail roles</h2><span>{session.bundle.roles.length} of 8</span></div>
          <div className="my-hoyo-constellation" role="group" aria-label="Choose a Star Rail role">
            {session.bundle.roles.map((item, index) => {
              const key = myHoyoRoleKey(item.binding);
              return <button key={key} type="button" className={key === myHoyoRoleKey(role?.binding) ? 'on' : ''}
                             aria-pressed={key === myHoyoRoleKey(role?.binding)} onClick={() => { setSelectedRole(key); setVisibleAchievements(100); }}>
                <span aria-hidden="true">{index + 1}</span><b>{item.nickname || 'Trailblazer'}</b><small>{item.region}</small>
              </button>;
            })}
          </div>
          {session.bundle.roles.length === 0 && <p className="my-hoyo-catalog-note">This cloud copy has no active Star Rail roles.</p>}
        </section>

        {role && <section className="my-hoyo-identity" aria-label="Selected Star Rail role">
          <div><span>Trailblazer</span><b>{role.nickname || 'No nickname shared'}</b></div>
          <div><span>UID</span><b>{role.binding.roleId}</b></div>
          <div><span>Region</span><b>{role.region}</b></div>
        </section>}

        {role && <div className="my-hoyo-detail-grid">
          {role.resource ? <section className="nyx-card my-hoyo-detail" aria-labelledby="my-hoyo-resource-title">
            <div className="nyx-section-title" id="my-hoyo-resource-title">Trailblaze Power</div>
            <p className="my-hoyo-resource-value"><b>{role.resource.current}</b><span>/ {role.resource.maximum}</span></p>
            <dl><div><dt>Expected full at snapshot</dt><dd>{myHoyoExpectedFull(role.resource)}</dd></div>
              {role.resource.reserve !== null && <div><dt>Reserved</dt><dd>{role.resource.reserve}</dd></div>}
              <div><dt>Observed</dt><dd>{myHoyoDate(role.resource.observedAt)}</dd></div></dl>
          </section> : <section className="my-hoyo-unavailable" aria-label="Trailblaze Power unavailable"><b>Trailblaze Power unavailable</b><p>This role has no complete shared resource observation. Nyx does not show it as zero.</p><a href="https://act.hoyolab.com/app/community-game-records-sea/index.html?gid=6#/hsr" target="_blank" rel="noopener noreferrer" aria-label="Open official HoYoLAB Star Rail Battle Records in a new tab">Open official Battle Records</a></section>}

          {Array.isArray(achievementIds) ? <section className="nyx-card my-hoyo-detail my-hoyo-achievements" aria-labelledby="my-hoyo-achievements-title">
            <div className="nyx-section-title" id="my-hoyo-achievements-title">Completed achievements</div>
            <p className="my-hoyo-achievement-count"><b>{achievementIds.length}</b><span>shared completions</span></p>
            {catalog.loading && <p className="my-hoyo-catalog-note">Loading achievement names…</p>}
            {catalog.error && <p className="my-hoyo-catalog-note">{catalog.error} IDs remain visible below.</p>}
            <ol className="my-hoyo-achievement-list" tabIndex="0" aria-label="Completed achievement names and IDs">
              {achievementRows.map(({ id, row }) => <li key={id}><span>{row?.name || 'Unmatched achievement #' + id}</span><code>{id}</code></li>)}
            </ol>
            {visibleAchievements < achievementIds.length && <button type="button" className="my-hoyo-more" onClick={() => setVisibleAchievements((count) => Math.min(count + 100, achievementIds.length))}>Show 100 more</button>}
          </section> : <section className="my-hoyo-unavailable" aria-label="Achievements unavailable"><b>Achievements unavailable</b><p>This role has no complete shared achievement observation. Nyx does not show it as zero.</p><a href="https://act.hoyolab.com/app/community-game-records-sea/index.html?gid=6#/hsr" target="_blank" rel="noopener noreferrer" aria-label="Open official HoYoLAB Star Rail Battle Records in a new tab">Open official Battle Records</a></section>}
        </div>}

        <section className="my-hoyo-delete" aria-labelledby="my-hoyo-delete-title">
          <div><h2 id="my-hoyo-delete-title">Cloud deletion</h2><p>These actions remove encrypted server copies. Data stored in your browser or launcher stays on your devices.</p></div>
          <div className="my-hoyo-delete-actions">
            <button type="button" onClick={removeHsr} disabled={busy}>Remove HSR cloud copy</button>
            <button type="button" onClick={removeHoyo} disabled={busy}>Remove all HoYo cloud data</button>
            <button type="button" onClick={() => { combinedFormRef.current?.reset(); setEntirePengoOpen((open) => !open); }} disabled={busy} aria-expanded={entirePengoOpen} aria-controls="my-hoyo-entire-delete">Remove entire Pengo cloud data</button>
          </div>
          {entirePengoOpen && <form ref={combinedFormRef} id="my-hoyo-entire-delete" className="my-hoyo-entire-delete" onSubmit={removeEntirePengo}>
            <p>This separately removes HoYo cloud data and encrypted pull-history cloud data. Enter the pull sync phrase; it is not the HoYo recovery code.</p>
            <label htmlFor="my-hoyo-pull-phrase">Pull sync phrase</label>
            <input id="my-hoyo-pull-phrase" name="pullPhrase" className="nyx-input" type="password" autoComplete="off" minLength="10" disabled={busy} required />
            <label className="my-hoyo-confirm"><input type="checkbox" disabled={busy} required /> I understand both Pengo cloud copies will be removed.</label>
            <button type="submit" disabled={busy}>Remove both cloud copies</button>
          </form>}
          {pullOnlyDeleteForm('unlocked')}
        </section>
        {(error || message) && <p className={error ? 'my-hoyo-status error' : 'my-hoyo-status'} role={error ? 'alert' : 'status'}>{error || message}</p>}
      </div>
    </main>
  );
}
