// Local storage in IndexedDB: the decks (the built-in one is imported once from its CSV,
// on first launch), their cards and the Leitner progress of each card.
const DB_NAME = 'flashcards';
const DB_VERSION = 4;

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
      if (event.oldVersion < 3) {
        // Cards now belong to a deck instead of an HSK level. Card ids don't change, so
        // re-importing the built-in deck keeps its progress.
        const cards = req.transaction.objectStore('cards');
        cards.deleteIndex('level');
        cards.createIndex('deck', 'deck');
        cards.clear();
        req.transaction.objectStore('meta').delete('imported:1');
        db.createObjectStore('decks', { keyPath: 'id' });
      }
      if (event.oldVersion >= 3 && event.oldVersion < 4) {
        // Cards went from { hanzi, pinyin, french } to { front, back }: convert imported decks
        // the way their CSV read (column 1: hanzi and pinyin). The built-in deck is re-imported.
        const cursorReq = req.transaction.objectStore('cards').openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const { id, deck, hanzi, pinyin, french } = cursor.value;
          cursor.update({ id, deck, front: [hanzi, pinyin].filter(Boolean).join(' '), back: french });
          cursor.continue();
        };
      }
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

// Minimal CSV parser: handles quoted fields with separators and doubled quotes.
function parseCsv(text, separator = ',') {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === separator) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim()));
}

// Turns a CSV (front, back, optional pronunciation) into a deck's cards; a cell can span
// several lines. A first row "Recto,Verso" (or "Front,Back") is a header. Excel's ";" separator
// is accepted too.
function cardsFromCsv(text, deckId) {
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const rows = parseCsv(text, firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',');
  const [front = '', back = ''] = rows[0] || [];
  if (/^(recto|front)$/i.test(front.trim()) && /^(verso|back)$/i.test(back.trim())) rows.shift();
  return rows
    .map(([front = '', back = '', pronunciation = ''], i) => (
      { id: `${deckId}-${i + 1}`, deck: deckId, front: front.trim(), back: back.trim(), pronunciation: pronunciation.trim() }
    ))
    .filter(card => card.front && card.back);
}

async function fetchDeck(deck) {
  return cardsFromCsv(await (await fetch(deck.url)).text(), deck.id);
}

// (Re-)imports the built-in deck when its CSV version changed. Card ids follow the CSV rows,
// so progress survives as long as rows keep their order.
async function importBuiltinDeck(db, deck) {
  const meta = db.transaction('meta').objectStore('meta');
  if (await request(meta.get(`imported:${deck.id}`)) === deck.version) return;

  const deckCards = await fetchDeck(deck);
  const tx = db.transaction(['cards', 'meta'], 'readwrite');
  const cards = tx.objectStore('cards');
  const cursorReq = cards.index('deck').openKeyCursor(deck.id);
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (cursor) { cards.delete(cursor.primaryKey); cursor.continue(); }
    else deckCards.forEach(card => cards.put(card));
  };
  tx.objectStore('meta').put(deck.version, `imported:${deck.id}`);
  await txDone(tx);
}

async function getCards(db, deckId) {
  return request(db.transaction('cards').objectStore('cards').index('deck').getAll(deckId));
}

async function countCards(db, deckId) {
  return request(db.transaction('cards').objectStore('cards').index('deck').count(deckId));
}

// Imported decks: { id, name }. The built-in deck is not stored here.
async function getDecks(db) {
  return request(db.transaction('decks').objectStore('decks').getAll());
}

async function saveDeck(db, deck, deckCards) {
  const tx = db.transaction(['decks', 'cards'], 'readwrite');
  tx.objectStore('decks').put(deck);
  const cards = tx.objectStore('cards');
  deckCards.forEach(card => cards.put(card));
  await txDone(tx);
}

// Removes a deck with its cards and their progress.
async function deleteDeck(db, deckId) {
  const tx = db.transaction(['decks', 'cards', 'progress'], 'readwrite');
  tx.objectStore('decks').delete(deckId);
  const progress = tx.objectStore('progress');
  const cursorReq = tx.objectStore('cards').index('deck').openCursor(deckId);
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    progress.delete(cursor.primaryKey);
    cursor.delete();
    cursor.continue();
  };
  await txDone(tx);
}

async function getMeta(db, key) {
  return request(db.transaction('meta').objectStore('meta').get(key));
}

async function setMeta(db, key, value) {
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(value, key);
  await txDone(tx);
}

// Progress entries: { id, box }.
async function getProgress(db) {
  return request(db.transaction('progress').objectStore('progress').getAll());
}

async function clearProgress(db, ids) {
  const tx = db.transaction('progress', 'readwrite');
  const store = tx.objectStore('progress');
  ids.forEach(id => store.delete(id));
  await txDone(tx);
}

async function saveProgress(db, entries) {
  const tx = db.transaction('progress', 'readwrite');
  const store = tx.objectStore('progress');
  entries.forEach(entry => store.put(entry));
  await txDone(tx);
}
