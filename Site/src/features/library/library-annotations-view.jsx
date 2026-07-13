/* ---------------- Library personal annotations: safe reader UI ---------------- */
function nyxLibraryDomNodeLength(node){
  if (!node) return 0;
  if (node.nodeType === 3) return String(node.data || '').length;
  if (node.nodeType !== 1) return 0;
  if (node.hasAttribute?.('data-library-ui')) return 0;
  if (node.tagName === 'BR') return 1;
  return Array.from(node.childNodes || []).reduce((total, child) => total + nyxLibraryDomNodeLength(child), 0);
}

function nyxLibraryDomPointOffset(root, target, targetOffset){
  let total = 0;
  let answer = null;
  function walk(node){
    if (answer != null || !node) return;
    if (node === target) {
      if (node.nodeType === 3) answer = total + Math.max(0, Math.min(String(node.data || '').length, Number(targetOffset) || 0));
      else if (node.nodeType === 1) answer = total + Array.from(node.childNodes || []).slice(0, Math.max(0, Number(targetOffset) || 0)).reduce((sum, child) => sum + nyxLibraryDomNodeLength(child), 0);
      return;
    }
    if (node.nodeType === 3) { total += String(node.data || '').length; return; }
    if (node.nodeType !== 1 || node.hasAttribute?.('data-library-ui')) return;
    if (node.tagName === 'BR') { total += 1; return; }
    Array.from(node.childNodes || []).forEach(walk);
  }
  walk(root);
  return answer;
}

function nyxLibraryLeafElement(node){
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  return element?.closest?.('[data-library-block-id]') || null;
}

function nyxLibraryCaptureDomSelection(root, leafMap){
  const browserSelection = typeof window !== 'undefined' ? window.getSelection?.() : null;
  if (!root || !browserSelection || browserSelection.rangeCount !== 1 || browserSelection.isCollapsed) return null;
  const range = browserSelection.getRangeAt(0);
  const startLeaf = nyxLibraryLeafElement(range.startContainer);
  const endLeaf = nyxLibraryLeafElement(range.endContainer);
  if (!startLeaf || !endLeaf || !root.contains(startLeaf) || !root.contains(endLeaf)) return null;
  const selectedText = String(browserSelection.toString() || '');
  if (!selectedText.trim()) return null;
  if (startLeaf !== endLeaf) return { anchorable:false, quote:selectedText, message:'Formatting works within one paragraph. You can still copy this selection.' };
  const blockId = String(startLeaf.dataset.libraryBlockId || '');
  const leaf = leafMap.get(blockId);
  if (!leaf) return null;
  const start = nyxLibraryDomPointOffset(startLeaf, range.startContainer, range.startOffset);
  const end = nyxLibraryDomPointOffset(startLeaf, range.endContainer, range.endOffset);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start || end > leaf.text.length) return null;
  const quote = leaf.text.slice(start, end);
  if (!quote.trim()) return null;
  return { anchorable:true, blockId, leafType:leaf.leafType, start, end, quote, leafText:leaf.text };
}

function nyxLibraryAnnotationClasses(presentation, queryHit){
  return [
    'library-source-text',
    presentation.bold ? 'is-bold' : '',
    presentation.underline ? 'is-underlined' : '',
    presentation.highlightColor ? `is-highlight-${presentation.highlightColor}` : '',
    presentation.hasNote ? 'has-note' : '',
    queryHit ? 'library-query-hit' : '',
  ].filter(Boolean).join(' ');
}

function LibraryAnnotationText({ value, globalStart, resolved, highlightTokens, onOpenNote }){
  const text = String(value || '');
  const boundaries = new Set([0, text.length]);
  const localRows = [];
  (resolved || []).forEach((row) => {
    const start = Math.max(globalStart, row.start); const end = Math.min(globalStart + text.length, row.end);
    if (end <= start) return;
    boundaries.add(start - globalStart); boundaries.add(end - globalStart); localRows.push(row);
  });
  const queryRanges = [];
  if (highlightTokens?.size) for (const match of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    if (!highlightTokens.has(nyxLibraryNormalizeText(match[0]))) continue;
    boundaries.add(match.index); boundaries.add(match.index + match[0].length); queryRanges.push([match.index, match.index + match[0].length]);
  }
  const points = [...boundaries].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1]; if (end <= start) return null;
    const absoluteStart = globalStart + start; const absoluteEnd = globalStart + end;
    const active = localRows.filter((row) => row.start < absoluteEnd && row.end > absoluteStart);
    const presentation = nyxLibraryAnnotationPresentation(active);
    const queryHit = queryRanges.some(([from, to]) => from < end && to > start);
    const noteStarts = active.filter((row) => row.annotation.note && row.start === absoluteStart);
    return <React.Fragment key={`${absoluteStart}-${absoluteEnd}`}>
      {noteStarts.map((row) => <button type="button" className="library-note-pin" data-library-ui="note" key={`note-${row.annotation.id}`} aria-label={`Open note for ${row.annotation.anchor.quote}`} onClick={(event) => onOpenNote(row.annotation, event.currentTarget)} />)}
      <span className={nyxLibraryAnnotationClasses(presentation, queryHit)} data-library-text-start={absoluteStart}>{text.slice(start, end)}</span>
    </React.Fragment>;
  });
}

function libraryAnnotatedInline(nodes, keyPrefix, cursor, resolved, highlightTokens, onOpenNote){
  return (nodes || []).map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === 'text') {
      const start = cursor.value; const value = String(node.text || ''); cursor.value += value.length;
      return <React.Fragment key={key}><LibraryAnnotationText value={value} globalStart={start} resolved={resolved} highlightTokens={highlightTokens} onOpenNote={onOpenNote} /></React.Fragment>;
    }
    if (node.type === 'br') { const start = cursor.value; cursor.value += 1; return <br key={key} data-library-text-start={start} />; }
    if (node.type === 'em') return <em key={key}>{libraryAnnotatedInline(node.children, key, cursor, resolved, highlightTokens, onOpenNote)}</em>;
    if (node.type === 'strong') return <strong key={key}>{libraryAnnotatedInline(node.children, key, cursor, resolved, highlightTokens, onOpenNote)}</strong>;
    return null;
  });
}

function LibraryAnnotatedLeaf({ leaf, Tag, resolved, highlightTokens, onOpenNote }){
  const key = leaf.id;
  const attrs = { 'data-library-block-id':String(leaf.id || ''), 'data-library-leaf-type':nyxLibraryLeafType(leaf), 'data-library-text-length':nyxLibraryLeafText(leaf).length };
  if (leaf.type === 'heading') return <Tag key={key} {...attrs}><LibraryAnnotationText value={leaf.text} globalStart={0} resolved={resolved} highlightTokens={highlightTokens} onOpenNote={onOpenNote} /></Tag>;
  const cursor = { value:0 };
  const children = libraryAnnotatedInline(leaf.children, key, cursor, resolved, highlightTokens, onOpenNote);
  if (Tag === 'td') return <td key={key} {...attrs}>{children}</td>;
  return React.createElement(Tag, { key, ...attrs }, children);
}

function LibraryAnnotationToolbar({ selection, color, setColor, busy, onFormat, onNote, onCopy, onRemove, onClose }){
  if (!selection) return null;
  return <div className="library-annotation-toolbar" role="toolbar" aria-label="Personalise selected text" data-library-ui="toolbar" onMouseDown={(event) => { if (event.target.tagName !== 'SELECT') event.preventDefault(); }}>
    <p>{selection.anchorable ? `Selected: “${selection.quote.slice(0, 70)}${selection.quote.length > 70 ? '…' : ''}”` : selection.message}</p>
    {selection.anchorable && <>
      <button type="button" disabled={busy} onClick={() => onFormat('highlight')}>Highlight</button>
      <select aria-label="Highlight color" value={color} onChange={(event) => setColor(event.target.value)} disabled={busy}>
        <option value="violet">Purple</option><option value="rose">Rose</option><option value="amber">Amber</option><option value="blue">Blue</option><option value="green">Green</option>
      </select>
      <button type="button" disabled={busy} onClick={() => onFormat('underline')}>Underline</button>
      <button type="button" disabled={busy} onClick={() => onFormat('bold')}>Bold</button>
      <button type="button" disabled={busy} onClick={onNote}>Add note</button>
      <button type="button" disabled={busy} onClick={onRemove}>Remove formatting</button>
    </>}
    <button type="button" disabled={busy} onClick={onCopy}>Copy</button>
    <button type="button" className="library-annotation-close" onClick={onClose} aria-label="Close text tools">×</button>
  </div>;
}

function LibraryNoteEditor({ editor, setEditor, busy, onSave, onDelete, onClose, textareaRef }){
  if (!editor) return null;
  return <div className="library-note-popover" role="dialog" aria-modal="false" aria-labelledby="library-note-title" data-library-ui="note-editor">
    <div className="library-note-popover-head"><strong id="library-note-title">{editor.annotation ? 'Edit note' : 'Add note'}</strong><button type="button" onClick={onClose} aria-label="Close note editor">×</button></div>
    <p>For “{editor.selection?.quote || editor.annotation?.anchor?.quote}”</p>
    <textarea ref={textareaRef} value={editor.note} maxLength={NYX_LIBRARY_ANNOTATION_MAX_NOTE} onChange={(event) => setEditor((state) => ({ ...state, note:event.target.value }))} placeholder="Write a plain-text note" />
    <div className="library-note-actions">
      <button type="button" disabled={busy || !editor.note.trim()} onClick={onSave}>Save note</button>
      {editor.annotation && <button type="button" className="danger" disabled={busy} onClick={onDelete}>Delete note</button>}
      <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
    </div>
  </div>;
}

function LibraryAnnotatedDocument({ document, game, bookId, volumeKey, knownVolumeKeys, highlightTokens }){
  const rootRef = React.useRef(null);
  const noteTextareaRef = React.useRef(null);
  const noteTriggerRef = React.useRef(null);
  const [annotations, setAnnotations] = React.useState([]);
  const [selection, setSelection] = React.useState(null);
  const [color, setColor] = React.useState('violet');
  const [editor, setEditor] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [storageError, setStorageError] = React.useState('');
  const scope = React.useMemo(() => ({ game, bookId, volumeKey }), [game, bookId, volumeKey]);
  const fingerprint = React.useMemo(() => nyxLibraryVolumeFingerprint(document), [document]);
  const leafMap = React.useMemo(() => new Map(nyxLibraryDocumentLeaves(document).map((leaf) => [String(leaf.id || ''), { leaf, text:nyxLibraryLeafText(leaf), leafType:nyxLibraryLeafType(leaf) }])), [document]);

  const reload = React.useCallback(() => {
    let active = true;
    nyxListLibraryAnnotations({ game, bookId }).then((rows) => { if (active) { setAnnotations(rows); setStorageError(''); } })
      .catch((error) => { if (active) { setAnnotations([]); setStorageError(error.message || 'Personal marks are unavailable. Reading and copying still work.'); } });
    return () => { active = false; };
  }, [game, bookId]);

  React.useEffect(() => {
    setAnnotations([]); setSelection(null); setEditor(null); setMessage(''); setStorageError('');
    const cancel = reload();
    const unsubscribe = nyxSubscribeLibraryAnnotations(() => reload());
    return () => { cancel(); unsubscribe(); };
  }, [reload, volumeKey]);

  React.useEffect(() => {
    if (editor) requestAnimationFrame(() => noteTextareaRef.current?.focus());
  }, [editor]);

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (editor) {
        event.preventDefault(); setEditor(null);
        requestAnimationFrame(() => {
          if (noteTriggerRef.current?.isConnected) noteTriggerRef.current.focus({ preventScroll:true });
          else rootRef.current?.focus({ preventScroll:true });
        });
      }
      else if (selection) { event.preventDefault(); setSelection(null); rootRef.current?.focus({ preventScroll:true }); }
    };
    globalThis.document.addEventListener('keydown', onKeyDown);
    return () => globalThis.document.removeEventListener('keydown', onKeyDown);
  }, [editor, selection]);

  const current = annotations.filter((row) => row.volumeKey === volumeKey);
  const resolved = React.useMemo(() => nyxResolveLibraryAnnotations(current, document), [current, document]);
  const known = new Set(knownVolumeKeys || []);
  const staleVolumes = annotations.filter((row) => row.volumeKey !== volumeKey && !known.has(row.volumeKey)).map((row) => ({ annotation:row, status:'stale-missing', reason:'missing-volume' }));
  const stale = [...resolved.filter((row) => row.status !== 'resolved'), ...staleVolumes];
  const resolvedByBlock = new Map();
  resolved.filter((row) => row.status === 'resolved').forEach((row) => { if (!resolvedByBlock.has(row.blockId)) resolvedByBlock.set(row.blockId, []); resolvedByBlock.get(row.blockId).push(row); });

  const capture = () => {
    const next = nyxLibraryCaptureDomSelection(rootRef.current, leafMap);
    if (next) { setSelection(next); setMessage(''); }
  };
  const closeTools = () => { setSelection(null); requestAnimationFrame(() => rootRef.current?.focus({ preventScroll:true })); };
  const fail = (error) => setMessage(error?.message || 'That action could not be completed. Reading and copying still work.');

  const saveStyle = async (style) => {
    if (!selection?.anchorable) return;
    setBusy(true);
    try {
      const existing = resolved.find((row) => row.status === 'resolved' && row.blockId === selection.blockId && row.start === selection.start && row.end === selection.end && row.annotation.style === style)?.annotation;
      const row = nyxMakeLibraryAnnotation({ ...scope, id:existing?.id, createdAt:existing?.createdAt, revision:existing?.revision, blockId:selection.blockId, leafType:selection.leafType, start:selection.start, end:selection.end, leafText:selection.leafText, sourceFingerprint:fingerprint, style, color:style === 'highlight' ? color : null });
      await nyxSaveLibraryAnnotation(row); setMessage(style === 'highlight' ? 'Highlight saved.' : `${style[0].toUpperCase()}${style.slice(1)} saved.`);
    } catch (error) { fail(error); } finally { setBusy(false); }
  };

  const openAddNote = (event) => {
    if (!selection?.anchorable) return;
    noteTriggerRef.current = event.currentTarget;
    setEditor({ annotation:null, selection, note:'' });
  };
  const openExistingNote = (annotation, trigger) => { noteTriggerRef.current = trigger; setEditor({ annotation, selection:null, note:annotation.note || '' }); };
  const closeEditor = () => {
    setEditor(null);
    requestAnimationFrame(() => {
      if (noteTriggerRef.current?.isConnected) noteTriggerRef.current.focus({ preventScroll:true });
      else rootRef.current?.focus({ preventScroll:true });
    });
  };

  const saveNote = async () => {
    if (!editor?.note.trim()) return;
    setBusy(true);
    try {
      const row = editor.annotation
        ? nyxNormalizeLibraryAnnotation({ ...editor.annotation, note:editor.note })
        : nyxMakeLibraryAnnotation({ ...scope, blockId:editor.selection.blockId, leafType:editor.selection.leafType, start:editor.selection.start, end:editor.selection.end, leafText:editor.selection.leafText, sourceFingerprint:fingerprint, style:null, note:editor.note });
      await nyxSaveLibraryAnnotation(row); setMessage('Note saved.'); closeEditor();
    } catch (error) { fail(error); } finally { setBusy(false); }
  };

  const deleteNote = async () => {
    if (!editor?.annotation) return;
    setBusy(true);
    try {
      const row = editor.annotation;
      if (row.style) await nyxSaveLibraryAnnotation({ ...row, note:'' });
      else await nyxDeleteLibraryAnnotation(row.id);
      setMessage('Note deleted.'); closeEditor();
    } catch (error) { fail(error); } finally { setBusy(false); }
  };

  const removeFormatting = async () => {
    if (!selection?.anchorable) return;
    const overlaps = resolved.filter((row) => row.status === 'resolved' && row.blockId === selection.blockId && row.annotation.style && row.start < selection.end && row.end > selection.start);
    if (!overlaps.length) { setMessage('No formatting overlaps this selection.'); return; }
    const deleteIds = []; const put = [];
    overlaps.forEach((row) => { const result = nyxLibrarySubtractFormatting(row.annotation, selection.start, selection.end, selection.leafText, fingerprint); deleteIds.push(...result.deleteIds); put.push(...result.put); });
    setBusy(true);
    try { await nyxReplaceLibraryAnnotations(deleteIds, put); setMessage('Formatting removed.'); }
    catch (error) { fail(error); } finally { setBusy(false); }
  };

  const copySelection = async () => {
    const text = selection?.quote || '';
    try { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(text); setMessage('Copied.'); }
    catch (error) { setMessage('Use your browser’s Copy command for this selection.'); }
  };

  const deleteStale = async (id) => {
    setBusy(true); try { await nyxDeleteLibraryAnnotation(id); setMessage('Stale mark deleted.'); } catch (error) { fail(error); } finally { setBusy(false); }
  };

  const renderLeaf = (leaf, Tag) => <LibraryAnnotatedLeaf leaf={leaf} Tag={Tag} resolved={resolvedByBlock.get(String(leaf.id || '')) || []} highlightTokens={highlightTokens} onOpenNote={openExistingNote} />;
  return <>
    {(storageError || message) && <div className={'library-annotation-message' + (storageError ? ' error' : '')} role={storageError ? 'alert' : 'status'} data-library-ui="status">{storageError || message}</div>}
    {!!stale.length && <details className="library-stale-marks" data-library-ui="stale"><summary>{stale.length} {stale.length === 1 ? 'mark needs' : 'marks need'} repair</summary>
      {stale.map((row) => <div key={row.annotation.id}><span>“{row.annotation.anchor.quote.slice(0, 70)}{row.annotation.anchor.quote.length > 70 ? '…' : ''}” — {row.status === 'stale-ambiguous' ? 'more than one safe match' : row.reason === 'missing-volume' ? 'volume changed or is missing' : 'source text is missing'}</span><button type="button" disabled={busy} onClick={() => deleteStale(row.annotation.id)}>Delete</button></div>)}
    </details>}
    <div className="library-document" ref={rootRef} tabIndex="-1" data-library-game={game} data-library-book-id={bookId} data-library-volume-key={volumeKey || ''} onMouseUp={capture} onKeyUp={capture} onTouchEnd={() => setTimeout(capture, 80)}>
      {(document?.blocks || []).map((block, index) => {
        const key = block.id || `block-${index}`;
        if (block.type === 'heading') return renderLeaf(block, block.level >= 4 ? 'h4' : block.level === 3 ? 'h3' : 'h2');
        if (block.type === 'paragraph') return renderLeaf(block, 'p');
        if (block.type === 'list') { const Tag = block.ordered ? 'ol' : 'ul'; return <Tag key={key}>{(block.items || []).map((item) => renderLeaf(item, 'li'))}</Tag>; }
        if (block.type === 'table') return <div className="library-table-wrap" key={key}><table><tbody>{(block.rows || []).map((row, rowIndex) => <tr key={`${key}-${rowIndex}`}>{(row.cells || []).map((cell) => renderLeaf(cell, 'td'))}</tr>)}</tbody></table></div>;
        if (block.type === 'image' && /^icons\/[a-f0-9]{16,64}\.(?:png|webp)$/i.test(block.src || '')) return <img key={key} className="library-inline-image" src={`/data/library/${game}/${block.src}`} alt={block.alt || ''} loading="lazy" />;
        return null;
      })}
    </div>
    <LibraryAnnotationToolbar selection={selection} color={color} setColor={setColor} busy={busy} onFormat={saveStyle} onNote={openAddNote} onCopy={copySelection} onRemove={removeFormatting} onClose={closeTools} />
    <LibraryNoteEditor editor={editor} setEditor={setEditor} busy={busy} onSave={saveNote} onDelete={deleteNote} onClose={closeEditor} textareaRef={noteTextareaRef} />
  </>;
}
