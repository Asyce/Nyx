/* ---------------- The Library: focused search and reader module ---------------- */
const NYX_LIBRARY_GAMES = { gi:'Genshin Impact', hsr:'Honkai: Star Rail' };


function LibraryPage({ game }){
  const [indexState, setIndexState] = React.useState({ loading:true, data:null, error:null });
  const [indexAttempt, setIndexAttempt] = React.useState(0);
  const [searchState, setSearchState] = React.useState({ loading:false, data:null, error:null, attempt:0 });
  const [shouldLoadSearch, setShouldLoadSearch] = React.useState(false);
  const [bookState, setBookState] = React.useState({ id:null, loading:false, data:null, error:null, attempt:0, query:'', bodyMatch:false, matchVolumeKey:'' });
  const [query, setQuery] = React.useState('');
  const [volume, setVolume] = React.useState(0);
  const readerTitle = React.useRef(null);
  const opener = React.useRef(null);

  React.useEffect(() => {
    const controller = new AbortController();
    setIndexState({ loading:true, data:null, error:null });
    setSearchState({ loading:false, data:null, error:null, attempt:0 });
    setShouldLoadSearch(false);
    setQuery('');
    setBookState({ id:null, loading:false, data:null, error:null, attempt:0, query:'', bodyMatch:false, matchVolumeKey:'' });
    fetch(`/data/library/${game}/index.json`, { signal:controller.signal, credentials:'same-origin' })
      .then((response) => { if (!response.ok) throw new Error(`Library index returned ${response.status}`); return response.json(); })
      .then((data) => {
        if (data?.game !== game || !Array.isArray(data.entries)) throw new Error('Library index is invalid');
        setIndexState({ loading:false, data, error:null });
      })
      .catch((error) => { if (error.name !== 'AbortError') setIndexState({ loading:false, data:null, error:error.message || 'The Library could not be loaded.' }); });
    return () => controller.abort();
  }, [game, indexAttempt]);

  React.useEffect(() => {
    if (!shouldLoadSearch || searchState.data || searchState.loading) return undefined;
    const controller = new AbortController();
    setSearchState((state) => ({ ...state, loading:true, error:null }));
    fetch(`/data/library/${game}/search-index.json`, { signal:controller.signal, credentials:'same-origin' })
      .then((response) => { if (!response.ok) throw new Error(`Library search returned ${response.status}`); return response.json(); })
      .then((data) => {
        if (data?.game !== game || data?.schemaVersion !== 2 || !Array.isArray(data.books) || !Array.isArray(data.volumes)) throw new Error('Library search is invalid');
        setSearchState((state) => ({ ...state, loading:false, data, error:null }));
      })
      .catch((error) => { if (error.name !== 'AbortError') setSearchState((state) => ({ ...state, loading:false, data:null, error:error.message || 'Book text search could not be loaded.' })); });
    return () => controller.abort();
  }, [game, shouldLoadSearch, searchState.attempt]);

  React.useEffect(() => {
    if (!bookState.id) return undefined;
    const row = indexState.data?.entries?.find((entry) => entry.id === bookState.id);
    if (!row || !/^[a-z0-9][a-z0-9-]*\.json$/.test(row.file || '')) {
      setBookState((state) => ({ ...state, loading:false, error:'This book has an invalid library record.' }));
      return undefined;
    }
    const controller = new AbortController();
    setBookState((state) => ({ ...state, loading:true, data:null, error:null }));
    fetch(`/data/library/${game}/${row.file}`, { signal:controller.signal, credentials:'same-origin' })
      .then((response) => { if (!response.ok) throw new Error(`Book returned ${response.status}`); return response.json(); })
      .then((data) => {
        if (data?.game !== game || !Array.isArray(data?.volumes) || !data.volumes.length) throw new Error('This book has no readable text.');
        const firstMatch = bookState.bodyMatch
          ? nyxLibraryMatchingVolumeIndex(data.volumes, bookState.query, bookState.matchVolumeKey)
          : -1;
        setVolume(firstMatch >= 0 ? firstMatch : 0);
        setBookState((state) => ({ ...state, loading:false, data, error:null, bodyMatch:firstMatch >= 0,
          matchVolumeKey:firstMatch >= 0 ? String(data.volumes[firstMatch]?.volumeKey || data.volumes[firstMatch]?.id || '') : '' }));
        requestAnimationFrame(() => readerTitle.current?.focus());
      })
      .catch((error) => { if (error.name !== 'AbortError') setBookState((state) => ({ ...state, loading:false, data:null, error:error.message || 'This book could not be loaded.' })); });
    return () => controller.abort();
  }, [game, bookState.id, bookState.attempt, indexState.data]);

  const normalizedQuery = nyxLibraryNormalizeText(query);
  const bodyMatches = React.useMemo(() => nyxLibrarySearchMatches(searchState.data, query), [searchState.data, query]);
  const entries = indexState.data?.entries || [];
  const matches = entries.map((entry) => ({
    entry,
    titleMatch:!!normalizedQuery && nyxLibraryTextHasPhrase(entry.name, query),
    bodyMatch:bodyMatches.get(entry.id) || null,
  })).filter((row) => !normalizedQuery || row.titleMatch || row.bodyMatch);

  const closeBook = () => {
    const openerId = opener.current?.dataset?.libraryBookId || bookState.id;
    ReactDOM.flushSync(() => {
      setBookState({ id:null, loading:false, data:null, error:null, attempt:0, query:'', bodyMatch:false, matchVolumeKey:'' });
      setVolume(0);
    });
    const target = nyxLibraryFocusReturnTarget(opener.current, openerId, document.querySelectorAll('[data-library-book-id]'));
    opener.current = target;
    target?.focus({ preventScroll:true });
  };

  if (bookState.id) {
    const selected = bookState.data?.volumes?.[volume];
    return <main className="gp-main-pane fill library-page">
      <header className="library-reader-head">
        <button type="button" className="library-back" onClick={closeBook} aria-label="Back to The Library"><span aria-hidden="true">{'\u2190'}</span> Library</button>
        <h1 tabIndex="-1" ref={readerTitle}>{bookState.data?.name || indexState.data?.entries?.find((entry) => entry.id === bookState.id)?.name || 'Loading book\u2026'}</h1>
      </header>
      {bookState.loading && <div className="library-status" role="status" aria-live="polite">Opening book\u2026</div>}
      {bookState.error && <div className="library-status error" role="alert"><p>{bookState.error}</p><button type="button" onClick={() => setBookState((state) => ({ ...state, attempt:state.attempt + 1 }))}>Try again</button></div>}
      {bookState.data && <article className="library-reader">
        {bookState.data.volumes.length > 1 && <div className="library-volumes" role="group" aria-label="Book volumes">
          {bookState.data.volumes.map((item, index) => <button type="button" key={item.volumeKey || item.id || index} className={volume === index ? 'on' : ''} aria-pressed={volume === index} onClick={() => setVolume(index)}>{item.label || `Volume ${index + 1}`}</button>)}
        </div>}
        <LibraryAnnotatedDocument
          document={selected?.document}
          game={game}
          bookId={bookState.data.id}
          volumeKey={selected?.volumeKey || selected?.id}
          knownVolumeKeys={bookState.data.volumes.map((item) => item.volumeKey || item.id)}
          query={bookState.bodyMatch ? bookState.query : ''}
        />
      </article>}
    </main>;
  }

  return <main className="gp-main-pane fill library-page">
    <header className="library-hero"><span>{NYX_LIBRARY_GAMES[game] || game}</span><h1>The Library</h1></header>
    {indexState.loading && <div className="library-status" role="status" aria-live="polite">Loading The Library\u2026</div>}
    {indexState.error && <div className="library-status error" role="alert"><p>{indexState.error}</p><button type="button" onClick={() => setIndexAttempt((attempt) => attempt + 1)}>Try again</button></div>}
    {indexState.data && <>
      <label className="library-search"><span>Search The Library</span><input type="search" value={query} onChange={(event) => {
        const value = event.target.value;
        setQuery(value);
        if (value.trim()) setShouldLoadSearch(true);
      }} placeholder="Search Title or Keyword" /></label>
      <div className="library-count-row">
        <p className="library-count" aria-live="polite">{matches.length} {matches.length === 1 ? 'book' : 'books'}</p>
        {query.trim() && searchState.loading && <span role="status">Searching book text\u2026</span>}
        {query.trim() && searchState.error && <button type="button" onClick={() => setSearchState((state) => ({ ...state, error:null, attempt:state.attempt + 1 }))}>Retry text search</button>}
      </div>
      <div className="library-grid">
        {matches.map(({ entry, bodyMatch }) => <button type="button" className={'library-tile' + (bodyMatch ? ' text-match' : '')} data-library-book-id={entry.id} key={entry.id} onClick={(event) => {
          opener.current = event.currentTarget;
          setBookState({ id:entry.id, loading:true, data:null, error:null, attempt:0, query, bodyMatch:!!bodyMatch, matchVolumeKey:bodyMatch?.volumeKey || '' });
        }}>
          <span className="library-cover">{entry.icon ? <img src={`/data/library/${game}/${entry.icon}`} alt="" loading="lazy" /> : <span aria-hidden="true">{'\ud83d\udcd6'}</span>}</span>
          <strong>{entry.name}</strong>
          <small>{entry.volumeCount > 1 ? `${entry.volumeCount} volumes` : 'Readable'}</small>
          {bodyMatch && <span className="library-text-match">Found in text</span>}
        </button>)}
      </div>
      {!matches.length && !searchState.loading && <div className="library-status">No books match that search.</div>}
    </>}
  </main>;
}
