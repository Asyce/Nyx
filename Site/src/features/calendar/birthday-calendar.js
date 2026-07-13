// Browser-local custom birthdays. Metadata and resized icon Blobs live in a
// dedicated versioned IndexedDB database; scraped character data stays untouched.
const NYX_BIRTHDAY_DB_NAME = 'nyx-birthday-calendar';
const NYX_BIRTHDAY_DB_VERSION = 1;
const NYX_BIRTHDAY_META_STORE = 'birthdays';
const NYX_BIRTHDAY_ICON_STORE = 'icons';
const NYX_BIRTHDAY_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const NYX_BIRTHDAY_MAX_INPUT_BYTES = 10 * 1024 * 1024;
const NYX_BIRTHDAY_MAX_ICON_BYTES = 256 * 1024;
const NYX_BIRTHDAY_MAX_ICON_EDGE = 256;
const NYX_CALENDAR_VIEW_KEY = 'nyx:birthday-calendar-view:v1';
const nyxBirthdaySubscribers = new Set();

function nyxBirthdayRequest(request){
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Birthday storage request failed.'));
  });
}

function nyxBirthdayTransaction(transaction){
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Birthday storage transaction failed.'));
  });
}

function nyxOpenBirthdayDatabase(factory){
  const idb = factory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!idb) return Promise.reject(new Error('Birthday storage is not available in this browser.'));
  return new Promise((resolve, reject) => {
    const request = idb.open(NYX_BIRTHDAY_DB_NAME, NYX_BIRTHDAY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NYX_BIRTHDAY_META_STORE)) db.createObjectStore(NYX_BIRTHDAY_META_STORE, { keyPath:'id' });
      if (!db.objectStoreNames.contains(NYX_BIRTHDAY_ICON_STORE)) db.createObjectStore(NYX_BIRTHDAY_ICON_STORE, { keyPath:'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Birthday storage could not be opened.'));
  });
}

function nyxBirthdayDaysInMonth(month){
  if (!Number.isInteger(month) || month < 0 || month > 11) return 0;
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
}

function nyxValidBirthdayDate(month, day){
  return Number.isInteger(month) && Number.isInteger(day) && day >= 1 && day <= nyxBirthdayDaysInMonth(month);
}

function nyxBirthdayOccursInYear(year, month, day){
  const value = new Date(year, month, day);
  return value.getFullYear() === year && value.getMonth() === month && value.getDate() === day;
}

function nyxNextBirthdayDate(now, month, day){
  if (!(now instanceof Date) || Number.isNaN(now.getTime()) || !nyxValidBirthdayDate(month, day)) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let year = today.getFullYear(); year <= today.getFullYear() + 8; year += 1) {
    if (!nyxBirthdayOccursInYear(year, month, day)) continue;
    const candidate = new Date(year, month, day);
    if (candidate >= today) return candidate;
  }
  return null;
}

function nyxBirthdayText(value, max){
  return String(value || '').trim().slice(0, max);
}

function nyxBirthdayId(){
  try { if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch (e) {}
  return `birthday-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nyxNormalizeBirthday(input){
  const row = input || {};
  const name = nyxBirthdayText(row.name, 80);
  const month = Number(row.month);
  const day = Number(row.day);
  if (!name) throw new Error('Enter a name.');
  if (!nyxValidBirthdayDate(month, day)) throw new Error('Choose a real month and day.');
  const now = Date.now();
  return {
    id:nyxBirthdayText(row.id, 120) || nyxBirthdayId(),
    name,
    month,
    day,
    game:nyxBirthdayText(row.game, 20),
    label:nyxBirthdayText(row.label, 60),
    note:nyxBirthdayText(row.note, 280),
    hasIcon:row.iconBlob instanceof Blob,
    createdAt:Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : now,
    updatedAt:now,
  };
}

function nyxBirthdayInitials(name){
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((word) => word[0]).join('') || '?').toUpperCase();
}

function nyxBirthdayIsQuotaError(error){
  return !!error && (error.name === 'QuotaExceededError' || /quota|storage.*full/i.test(String(error.message || '')));
}

function nyxBirthdayFriendlyStorageError(error){
  if (nyxBirthdayIsQuotaError(error)) {
    const friendly = new Error('This browser is out of space. Free some space or remove the birthday icon, then try again.');
    friendly.name = 'QuotaExceededError';
    return friendly;
  }
  return error instanceof Error ? error : new Error('The birthday could not be saved.');
}

async function nyxListCustomBirthdays(options = {}){
  const db = await nyxOpenBirthdayDatabase(options.indexedDB);
  try {
    const tx = db.transaction([NYX_BIRTHDAY_META_STORE, NYX_BIRTHDAY_ICON_STORE], 'readonly');
    const metaPromise = nyxBirthdayRequest(tx.objectStore(NYX_BIRTHDAY_META_STORE).getAll());
    const iconPromise = nyxBirthdayRequest(tx.objectStore(NYX_BIRTHDAY_ICON_STORE).getAll());
    const [rows, icons] = await Promise.all([metaPromise, iconPromise]);
    await nyxBirthdayTransaction(tx);
    const iconMap = new Map(icons.map((entry) => [entry.id, entry.blob]));
    return rows.map((row) => ({ ...row, iconBlob:iconMap.get(row.id) || null }));
  } finally { db.close(); }
}

async function nyxSaveCustomBirthday(input, options = {}){
  const normalized = nyxNormalizeBirthday(input);
  const blob = input && input.iconBlob instanceof Blob ? input.iconBlob : null;
  if (blob && (blob.type !== 'image/webp' || blob.size > NYX_BIRTHDAY_MAX_ICON_BYTES)) throw new Error('The birthday icon is not a safe resized WebP image.');
  const db = await nyxOpenBirthdayDatabase(options.indexedDB);
  try {
    const tx = db.transaction([NYX_BIRTHDAY_META_STORE, NYX_BIRTHDAY_ICON_STORE], 'readwrite');
    tx.objectStore(NYX_BIRTHDAY_META_STORE).put(normalized);
    if (blob) tx.objectStore(NYX_BIRTHDAY_ICON_STORE).put({ id:normalized.id, blob });
    else tx.objectStore(NYX_BIRTHDAY_ICON_STORE).delete(normalized.id);
    await nyxBirthdayTransaction(tx);
  } catch (error) {
    throw nyxBirthdayFriendlyStorageError(error);
  } finally { db.close(); }
  nyxBirthdaySubscribers.forEach((listener) => { try { listener(); } catch (e) {} });
  return { ...normalized, iconBlob:blob };
}

async function nyxDeleteCustomBirthday(id, options = {}){
  const safeId = nyxBirthdayText(id, 120);
  if (!safeId) return;
  const db = await nyxOpenBirthdayDatabase(options.indexedDB);
  try {
    const tx = db.transaction([NYX_BIRTHDAY_META_STORE, NYX_BIRTHDAY_ICON_STORE], 'readwrite');
    tx.objectStore(NYX_BIRTHDAY_META_STORE).delete(safeId);
    tx.objectStore(NYX_BIRTHDAY_ICON_STORE).delete(safeId);
    await nyxBirthdayTransaction(tx);
  } catch (error) {
    throw nyxBirthdayFriendlyStorageError(error);
  } finally { db.close(); }
  nyxBirthdaySubscribers.forEach((listener) => { try { listener(); } catch (e) {} });
}

function nyxSubscribeCustomBirthdays(listener){
  nyxBirthdaySubscribers.add(listener);
  return () => nyxBirthdaySubscribers.delete(listener);
}

async function nyxDecodeBirthdayImage(file){
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  if (typeof document === 'undefined' || typeof URL === 'undefined') throw new Error('Image resizing is not available in this browser.');
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('That file is not a readable image.'));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

async function nyxEncodeBirthdayImage({ source, width, height, quality }){
  let canvas;
  if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(width, height);
  else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d', { alpha:true });
  if (!context) throw new Error('This browser could not resize the image.');
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type:'image/webp', quality });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('This browser could not make a WebP icon.')), 'image/webp', quality));
}

async function nyxPrepareBirthdayIcon(file, options = {}){
  if (!(file instanceof Blob)) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (!NYX_BIRTHDAY_IMAGE_TYPES.has(String(file.type || '').toLowerCase())) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (!file.size || file.size > NYX_BIRTHDAY_MAX_INPUT_BYTES) throw new Error('Choose an image no larger than 10 MB.');
  const decode = options.decode || nyxDecodeBirthdayImage;
  const encode = options.encode || nyxEncodeBirthdayImage;
  let source;
  try {
    source = await decode(file);
    const sourceWidth = Number(source.width || source.naturalWidth);
    const sourceHeight = Number(source.height || source.naturalHeight);
    if (!sourceWidth || !sourceHeight) throw new Error('That file is not a readable image.');
    const startScale = Math.min(1, NYX_BIRTHDAY_MAX_ICON_EDGE / sourceWidth, NYX_BIRTHDAY_MAX_ICON_EDGE / sourceHeight);
    let width = Math.max(1, Math.round(sourceWidth * startScale));
    let height = Math.max(1, Math.round(sourceHeight * startScale));
    const qualities = [.86, .76, .66, .56, .46, .36];
    for (let shrink = 0; shrink < 4; shrink += 1) {
      for (const quality of qualities) {
        const blob = await encode({ source, width, height, quality });
        if (blob && blob.type === 'image/webp' && blob.size <= NYX_BIRTHDAY_MAX_ICON_BYTES) return blob;
      }
      width = Math.max(32, Math.round(width * .82));
      height = Math.max(32, Math.round(height * .82));
    }
    throw new Error('That image could not be reduced below 256 KB. Try a simpler image.');
  } catch (error) {
    if (/Choose|could not|readable|reduced/.test(String(error && error.message))) throw error;
    throw new Error('That file is not a readable image.');
  } finally {
    if (source && typeof source.close === 'function') source.close();
  }
}

function nyxReadCalendarViewState(){
  try {
    const value = JSON.parse(sessionStorage.getItem(NYX_CALENDAR_VIEW_KEY) || 'null');
    if (!value || !Number.isInteger(value.year) || !Number.isInteger(value.month) || value.month < 0 || value.month > 11) return null;
    return { year:value.year, month:value.month, scrollTop:Math.max(0, Number(value.scrollTop) || 0) };
  } catch (e) { return null; }
}

function nyxSaveCalendarViewState(value){
  const safe = value && Number.isInteger(value.year) && Number.isInteger(value.month) && value.month >= 0 && value.month <= 11
    ? { year:value.year, month:value.month, scrollTop:Math.max(0, Number(value.scrollTop) || 0) } : null;
  if (!safe) return;
  try { sessionStorage.setItem(NYX_CALENDAR_VIEW_KEY, JSON.stringify(safe)); } catch (e) {}
}

function nyxCalendarRouteToken(value){
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function nyxCalendarHistoryOrigin(state, routeCharacter){
  return state && state.nyxFrom === 'calendar' && nyxCalendarRouteToken(state.nyxCharacter) === nyxCalendarRouteToken(routeCharacter)
    ? 'calendar' : undefined;
}

function nyxShouldReturnToCalendar(selection){ return !!selection && selection.from === 'calendar'; }

function nyxCalendarFocusTarget(trigger, fallback){
  if (trigger && trigger.isConnected !== false && typeof trigger.focus === 'function') return trigger;
  if (fallback && fallback.isConnected !== false && typeof fallback.focus === 'function') return fallback;
  return null;
}
