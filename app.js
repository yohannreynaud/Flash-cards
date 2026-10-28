// Shipped with the app and always available. Imported decks are kept in IndexedDB.
// Bump version when the CSV changes, so phones re-import it.
const BUILTIN_DECK = { id: 'hsk1', name: 'HSK 1', url: 'data/hsk1.csv', version: 4 };

// Leitner boxes with a weighted random draw: a card in box n+1 is half as likely to come up
// as a card in box n, so on average box n+1 is reviewed once every 2 reviews of box n.
// "Je savais" moves a card up one box, "À revoir" sends it back to box 1, "Garder" leaves it.
// There is no last box: a card can keep climbing, and soon almost never comes up.
// Never-seen cards are only added to box 1 while it holds fewer than this many cards.
// Cards falling back from other boxes ignore the cap.
const FIRST_BOX_CAP = 10;

// Boxes are stored from 1 but shown to the user numbered from 0.
function boxName(box) {
  return `Boîte ${box - 1}`;
}

const els = {
  card: document.getElementById('card'),
  counter: document.getElementById('counter'),
  front: document.getElementById('front'),
  back: document.getElementById('back'),
  frontBack: document.getElementById('front-back'),
  pronunciation: document.getElementById('pronunciation'),
};

let db = null;               // null when IndexedDB is unavailable: progress then lives in memory only
let decks = [BUILTIN_DECK];
let activeDeck = BUILTIN_DECK;
let cards = [];              // cards of the active deck
let progress = new Map();    // card id -> { id, box }
let current = null;
let revealed = false;         // answers (swipes) only count once the back has been seen

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Adds random never-seen cards to box 1 up to the cap, and returns them.
function fillFirstBox() {
  const inFirstBox = [...progress.values()].filter(p => p.box === 1).length;
  const room = FIRST_BOX_CAP - inFirstBox;
  if (room <= 0) return [];
  const added = shuffle(cards.filter(c => !progress.has(c.id)))
    .slice(0, room)
    .map(c => ({ id: c.id, box: 1 }));
  added.forEach(p => progress.set(p.id, p));
  return added;
}

function weight(p) {
  return 2 ** (1 - p.box);
}

// Draws a card at random, weighted by its box, never the card just answered when another exists.
function drawCard() {
  let pool = [...progress.values()];
  if (pool.length > 1 && current) pool = pool.filter(p => p.id !== current.id);
  let r = Math.random() * pool.reduce((sum, p) => sum + weight(p), 0);
  const picked = pool.find(p => (r -= weight(p)) < 0) || pool[pool.length - 1];
  return cards.find(c => c.id === picked.id);
}

function persist(entries) {
  if (!db || !entries.length) return;
  saveProgress(db, entries).catch(err => {
    console.error('[DB] Sauvegarde impossible', err);
    showToast('⚠︎ Progression non sauvegardée');
  });
}

function render(card) {
  els.front.textContent = card.front;
  // Short fronts (a few characters) are shown big; longer words and phrases get smaller.
  els.front.classList.toggle('long', card.front.length > 4);
  els.frontBack.textContent = card.front;
  els.frontBack.classList.toggle('long', card.front.length > 4);
  els.back.textContent = card.back;
  els.pronunciation.textContent = card.pronunciation || '';
  els.counter.textContent = boxName(progress.get(card.id).box);
}

function showNext() {
  current = drawCard();
  revealed = false;
  if (els.card.classList.contains('flipped')) {
    // Swap content once the card has turned back, so the answer never flashes on the front.
    els.card.classList.remove('flipped');
    setTimeout(() => render(current), 220);
  } else {
    render(current);
  }
}

// result: "known" moves the card up a box, "again" sends it back to box 1, "keep" leaves it.
function answer(result) {
  if (!current) return;
  const p = progress.get(current.id);
  if (result === 'known') p.box++;
  if (result === 'again') p.box = 1;
  persist([p, ...fillFirstBox()]);
  showNext();
}

els.card.addEventListener('click', () => {
  if (swipe.dragged) return;   // the end of a swipe is not a tap
  els.card.classList.toggle('flipped');
  if (current) revealed = true;   // stays true once the answer has been seen
});

// Once the answer has been seen: swipe right for "Je savais", left for "À revoir",
// down to leave the card in its box.
const SWIPE_THRESHOLD = 80;
const swipe = { el: document.getElementById('swipe'), startX: null, startY: null, dx: 0, dy: 0, dragged: false };

// A mostly horizontal drag answers left or right; a mostly downward one keeps the card.
function swipeResult(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return Math.abs(dx) > SWIPE_THRESHOLD ? (dx > 0 ? 'known' : 'again') : null;
  return dy > SWIPE_THRESHOLD ? 'keep' : null;
}

function setSwipe(dx, dy) {
  const down = dy > Math.abs(dx);
  swipe.el.style.transform = !dx && !dy ? ''
    : down ? `translateY(${dy}px)` : `translateX(${dx}px) rotate(${dx / 20}deg)`;
  const result = swipeResult(dx, dy);
  swipe.el.classList.toggle('swipe-known', result === 'known');
  swipe.el.classList.toggle('swipe-again', result === 'again');
  swipe.el.classList.toggle('swipe-keep', result === 'keep');
}

swipe.el.addEventListener('pointerdown', event => {
  swipe.dragged = false;
  swipe.startX = event.clientX;
  swipe.startY = event.clientY;
  swipe.dx = swipe.dy = 0;
  swipe.el.classList.remove('animate');
});

swipe.el.addEventListener('pointermove', event => {
  if (swipe.startX === null) return;
  swipe.dx = event.clientX - swipe.startX;
  swipe.dy = event.clientY - swipe.startY;
  if (!swipe.dragged && Math.hypot(swipe.dx, swipe.dy) > 10) {
    swipe.dragged = true;
    swipe.el.setPointerCapture(event.pointerId);   // keep following the finger outside the card
  }
  if (swipe.dragged && revealed) setSwipe(swipe.dx, swipe.dy);
});

function endSwipe() {
  if (swipe.startX === null) return;
  const result = swipeResult(swipe.dx, swipe.dy);
  swipe.startX = null;
  swipe.el.classList.add('animate');
  // A drag before the answer is shown does nothing, but still isn't a tap.
  if (!revealed || !result) {
    setSwipe(0, 0);
  } else {
    // Fly off screen, answer, then fade the next card in at the center.
    swipe.el.style.transform = result === 'keep' ? `translateY(${window.innerHeight}px)`
      : `translateX(${(result === 'known' ? 1 : -1) * window.innerWidth}px) rotate(${result === 'known' ? 20 : -20}deg)`;
    setTimeout(() => {
      swipe.el.classList.remove('animate');
      swipe.el.style.opacity = '0';
      setSwipe(0, 0);
      answer(result);
      setTimeout(() => {
        swipe.el.classList.add('animate');
        swipe.el.style.opacity = '';
      }, 240);
    }, 200);
  }
}

swipe.el.addEventListener('pointerup', endSwipe);
swipe.el.addEventListener('pointercancel', endSwipe);

// Makes a deck the one being practised, with its own progress.
async function loadDeck(deck) {
  activeDeck = deck;
  cards = db ? await getCards(db, deck.id) : await fetchDeck(BUILTIN_DECK);
  const ids = new Set(cards.map(c => c.id));
  progress = new Map();
  if (db) (await getProgress(db)).forEach(p => { if (ids.has(p.id)) progress.set(p.id, p); });
  document.getElementById('page-flashcards').dataset.title = deck.name;
  if (!document.getElementById('page-flashcards').hidden) menu.title.textContent = deck.name;
  if (!cards.length) throw new Error('Aucun mot trouvé');
  current = null;
  persist(fillFirstBox());
  els.card.disabled = false;
  showNext();
}

async function start() {
  try {
    let deck = BUILTIN_DECK;
    try {
      db = await openDb();
      await importBuiltinDeck(db, BUILTIN_DECK);
      decks = [BUILTIN_DECK, ...await getDecks(db)];
      const activeId = await getMeta(db, 'activeDeck');
      deck = decks.find(d => d.id === activeId) || BUILTIN_DECK;
      // Ask Safari not to evict our data when the phone runs low on space.
      navigator.storage?.persist?.().catch(() => {});
    } catch (err) {
      // Safari can refuse IndexedDB (private browsing, blocked cookies…): read the CSV directly instead.
      console.warn('[DB] IndexedDB indisponible, lecture directe du CSV', err);
      db = null;
      showToast('⚠︎ Progression non sauvegardée sur cet appareil', 4000);
    }
    await loadDeck(deck);
  } catch (err) {
    els.front.textContent = '⚠︎';
    els.counter.textContent = err.message;
    console.error(err);
  }
}

// ------------------------------
// Menu and pages
// ------------------------------
const menu = {
  panel: document.getElementById('menu'),
  backdrop: document.getElementById('menu-backdrop'),
  open: document.getElementById('menu-btn'),
  close: document.getElementById('menu-close'),
  items: document.querySelectorAll('.menu-item'),
  title: document.getElementById('page-title'),
  version: document.getElementById('sw-version'),
};

function toggleMenu(show) {
  menu.panel.hidden = menu.backdrop.hidden = !show;
  menu.open.setAttribute('aria-expanded', String(show));
}

// Fills a list with "label … n cartes" rows, like the Progression and Decks pages.
function renderRows(list, rows) {
  list.replaceChildren(...rows.map(([label, n]) => {
    const li = document.createElement('li');
    li.append(Object.assign(document.createElement('span'), { textContent: label }),
      Object.assign(document.createElement('span'), { textContent: `${n} carte${n > 1 ? 's' : ''}` }));
    return li;
  }));
}

function renderBoxCounts() {
  const counts = {};
  progress.forEach(p => { counts[p.box] = (counts[p.box] || 0) + 1; });
  const rows = [];
  // Boxes 0 to 4 are always listed, higher ones once a card reaches them.
  const lastBox = Math.max(5, ...[...progress.values()].map(p => p.box));
  for (let box = 1; box <= lastBox; box++) rows.push([boxName(box), counts[box] || 0]);
  rows.push(['Pas encore vues', cards.length - progress.size]);
  document.getElementById('boxes-deck').textContent = `Deck : ${activeDeck.name}`;
  renderRows(document.getElementById('box-counts'), rows);
}

// One row per deck: tap it to practise it; imported decks also get a delete button.
async function renderDecks() {
  const list = document.getElementById('deck-list');
  const counts = await Promise.all(decks.map(d => (d === activeDeck || !db ? cards.length : countCards(db, d.id))));
  list.replaceChildren(...decks.map((deck, i) => {
    const li = document.createElement('li');
    li.classList.toggle('active', deck === activeDeck);
    const select = Object.assign(document.createElement('button'), { type: 'button', className: 'deck-select' });
    select.append(Object.assign(document.createElement('span'), { textContent: deck === activeDeck ? `✓ ${deck.name}` : deck.name }),
      Object.assign(document.createElement('span'), { textContent: `${counts[i]} carte${counts[i] > 1 ? 's' : ''}` }));
    select.addEventListener('click', () => chooseDeck(deck));
    li.append(select);
    if (deck !== BUILTIN_DECK) {
      const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn deck-delete', textContent: '✕' });
      remove.setAttribute('aria-label', `Supprimer ${deck.name}`);
      remove.addEventListener('click', () => removeDeck(deck));
      li.append(remove);
    }
    return li;
  }));
}

async function chooseDeck(deck) {
  if (deck !== activeDeck) {
    await loadDeck(deck);
    if (db) await setMeta(db, 'activeDeck', deck.id);
  }
  renderDecks();
}

async function removeDeck(deck) {
  if (!confirm(`Supprimer le deck « ${deck.name} » et sa progression ?`)) return;
  await deleteDeck(db, deck.id);
  decks = decks.filter(d => d !== deck);
  if (deck === activeDeck) {
    await loadDeck(BUILTIN_DECK);
    await setMeta(db, 'activeDeck', BUILTIN_DECK.id);
  }
  renderDecks();
  showToast('✅ Deck supprimé');
}

const deckFile = document.getElementById('deck-file');

document.getElementById('import-deck').addEventListener('click', () => {
  if (!db) { showToast('⚠︎ Import impossible : stockage indisponible'); return; }
  deckFile.click();
});

deckFile.addEventListener('change', async () => {
  const file = deckFile.files[0];
  deckFile.value = '';   // so picking the same file again still fires "change"
  if (!file) return;
  try {
    const id = `deck-${Date.now()}`;
    const deckCards = cardsFromCsv(await file.text(), id);
    if (!deckCards.length) { showToast('⚠︎ Aucune carte trouvée dans ce fichier'); return; }
    const name = prompt('Nom du deck', file.name.replace(/\.[^.]+$/, ''))?.trim();
    if (!name) return;
    const deck = { id, name };
    await saveDeck(db, deck, deckCards);
    decks.push(deck);
    renderDecks();
    showToast(`✅ ${deckCards.length} cartes importées`);
  } catch (err) {
    console.error('[IMPORT] Erreur', err);
    showToast('⚠︎ Import impossible');
  }
});

function showPage(name) {
  document.querySelectorAll('.page').forEach(page => {
    page.hidden = page.id !== `page-${name}`;
    if (!page.hidden) menu.title.textContent = page.dataset.title;
  });
  menu.items.forEach(item => {
    if (item.dataset.page === name) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  els.counter.hidden = name !== 'flashcards';
  document.body.classList.toggle('no-scroll', name === 'flashcards');
  if (name === 'boxes') renderBoxCounts();
  if (name === 'decks') renderDecks();
  if (name === 'maintenance') navigator.serviceWorker?.controller?.postMessage({ type: 'GET_VERSION' });
  toggleMenu(false);
}

menu.open.addEventListener('click', () => toggleMenu(menu.panel.hidden));
menu.close.addEventListener('click', () => toggleMenu(false));
menu.backdrop.addEventListener('click', () => toggleMenu(false));
menu.items.forEach(item => item.addEventListener('click', () => showPage(item.dataset.page)));
showPage('flashcards');

function showToast(msg, duration = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// Clearing the cache offline would leave nothing to reload the app from, so both
// reset tools first check that the server answers (navigator.onLine is unreliable on iOS).
async function serverReachable() {
  try {
    const res = await fetch(`sw.js?check=${Date.now()}`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureOnline() {
  if (await serverReachable()) return true;
  showToast('📶 Connecte-toi à Internet d\'abord');
  return false;
}

async function clearCache() {
  if (!confirm('Vider le cache de l\'application ?')) return;
  if (!(await ensureOnline())) return;
  const keys = await caches.keys();
  for (const key of keys) await caches.delete(key);
  showToast('✅ Cache vidé');
}

// Full reset: update, activate any waiting SW, empty every cache, unregister, reload.
// IndexedDB is left alone, so the words stay on the phone.
async function hardResetPWA() {
  if (!confirm('Réinitialiser complètement l\'application ?')) return;
  if (!(await ensureOnline())) return;
  console.log('[RESET] Réinitialisation complète…');
  const reg = await navigator.serviceWorker?.getRegistration();

  try {
    // 1) Forcer une mise à jour (échoue hors ligne, on continue quand même)
    try { await reg?.update(); } catch (err) { console.warn('[RESET] update() impossible', err); }

    // 2) Forcer skipWaiting si un SW est en attente, sans bloquer plus de 3 s
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      await new Promise(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        setTimeout(resolve, 3000);
      });
    }

    // 3) Vider tous les caches
    for (const key of await caches.keys()) await caches.delete(key);

    // 4) Désenregistrer le SW
    await reg?.unregister();
  } catch (err) {
    console.error('[RESET] Erreur', err);
  }

  // 5) Reload final
  window.location.reload();
}

async function resetProgress() {
  if (!confirm(`Réinitialiser la progression du deck « ${activeDeck.name} » ? Toutes ses cartes redeviendront « pas encore vues ».`)) return;
  try {
    if (db) await clearProgress(db, cards.map(c => c.id));
  } catch (err) {
    console.error('[DB] Réinitialisation impossible', err);
    showToast('⚠︎ Réinitialisation impossible');
    return;
  }
  progress.clear();
  current = null;
  persist(fillFirstBox());
  showNext();
  showToast('✅ Progression réinitialisée');
}

document.getElementById('reset-progress').addEventListener('click', async () => {
  await resetProgress();
  renderBoxCounts();
});

// Theme color, remembered on this phone (orange is the default).
const swatches = document.querySelectorAll('.swatch');

function applyColor(color) {
  if (color === 'orange') delete document.documentElement.dataset.color;
  else document.documentElement.dataset.color = color;
  swatches.forEach(s => s.setAttribute('aria-pressed', String(s.dataset.color === color)));
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', accent);
}

swatches.forEach(s => s.addEventListener('click', () => {
  applyColor(s.dataset.color);
  try { localStorage.setItem('color', s.dataset.color); } catch {}
}));
applyColor(document.documentElement.dataset.color || 'orange');
document.getElementById('clear-cache').addEventListener('click', clearCache);
document.getElementById('hard-reset').addEventListener('click', hardResetPWA);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SW_VERSION') menu.version.textContent = `Service Worker ${event.data.version}`;
  });
  navigator.serviceWorker.register('sw.js');
}

start();
