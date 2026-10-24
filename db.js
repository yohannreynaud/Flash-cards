// Local storage in IndexedDB: the words (imported once from the CSV, on first launch)
// and the Leitner progress of each card.
const DB_NAME = 'flashcards';
const DB_VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = event => {
      const db = req.result;
      if (event.oldVersion < 1) {
        const cards = db.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('level', 'level');
        db.createObjectStore('meta');
      }
      if (event.oldVersion < 2) db.createObjectStore('progress', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Minimal CSV parser: handles quoted fields with commas and doubled quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim()));
}

// "我们 wǒmen" -> { hanzi: "我们", pinyin: "wǒmen" }
function splitHanziPinyin(value) {
  const s = value.trim();
  const space = s.indexOf(' ');
  return space === -1
    ? { hanzi: s, pinyin: '' }
    : { hanzi: s.slice(0, space), pinyin: s.slice(space + 1).trim() };
}

// Reads the CSV for a level and returns its cards.
async function fetchLevel(level, url) {
  const text = (await (await fetch(url)).text()).replace(/^\uFEFF/, '');
  const [, ...rows] = parseCsv(text);
  return rows.map(([hanziPinyin, french], i) => (
    { id: `hsk${level}-${i + 1}`, level, ...splitHanziPinyin(hanziPinyin), french: (french || '').trim() }
  ));
}

async function importLevel(db, level, url) {
  const meta = db.transaction('meta').objectStore('meta');
  if (await request(meta.get(`imported:${level}`))) return;

  const levelCards = await fetchLevel(level, url);
  const tx = db.transaction(['cards', 'meta'], 'readwrite');
  const cards = tx.objectStore('cards');
  levelCards.forEach(card => cards.put(card));
  tx.objectStore('meta').put(true, `imported:${level}`);
  await txDone(tx);
}

async function getCards(db, level) {
  const index = db.transaction('cards').objectStore('cards').index('level');
  return request(index.getAll(level));
}

// Progress entries: { id, box, due } where due is a timestamp (0 = due now).
async function getProgress(db) {
  return request(db.transaction('progress').objectStore('progress').getAll());
}

async function saveProgress(db, entries) {
  const tx = db.transaction('progress', 'readwrite');
  const store = tx.objectStore('progress');
  entries.forEach(entry => store.put(entry));
  await txDone(tx);
}
