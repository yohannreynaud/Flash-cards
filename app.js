const LEVEL = 1;
const CSV_URL = 'data/hsk1.csv';

// Leitner boxes with a weighted random draw: a card in box n+1 is half as likely to come up
// as a card in box n, so on average box n+1 is reviewed once every 2 reviews of box n.
// "Je savais" moves a card up one box, "À revoir" sends it back to box 1.
const LAST_BOX = 5;
// Never-seen cards are only added to box 1 while it holds fewer than this many cards.
// Cards falling back from other boxes ignore the cap.
const FIRST_BOX_CAP = 20;

const els = {
  card: document.getElementById('card'),
  counter: document.getElementById('counter'),
  hanzi: document.getElementById('hanzi'),
  hanziBack: document.getElementById('hanzi-back'),
  pinyin: document.getElementById('pinyin'),
  french: document.getElementById('french'),
  again: document.getElementById('again'),
  known: document.getElementById('known'),
  storage: document.getElementById('storage-status'),
};

let db = null;               // null when IndexedDB is unavailable: progress then lives in memory only
let cards = [];
let progress = new Map();    // card id -> { id, box }
let current = null;

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

function setAnswerButtons(enabled) {
  els.again.disabled = els.known.disabled = !enabled;
}

function render(card) {
  els.hanzi.textContent = card.hanzi;
  els.hanziBack.textContent = card.hanzi;
  els.pinyin.textContent = card.pinyin;
  els.french.textContent = card.french;
  els.counter.textContent = `Boîte ${progress.get(card.id).box}`;
}

function showNext() {
  current = drawCard();
  setAnswerButtons(false);
  if (els.card.classList.contains('flipped')) {
    // Swap content once the card has turned back, so the answer never flashes on the front.
    els.card.classList.remove('flipped');
    setTimeout(() => render(current), 220);
  } else {
    render(current);
  }
}

function answer(knew) {
  if (!current) return;
  const p = progress.get(current.id);
  p.box = knew ? Math.min(p.box + 1, LAST_BOX) : 1;
  persist([p, ...fillFirstBox()]);
  showNext();
}

els.card.addEventListener('click', () => {
  els.card.classList.toggle('flipped');
  if (current) setAnswerButtons(true);   // stay enabled once the answer has been seen
});
els.again.addEventListener('click', () => answer(false));
els.known.addEventListener('click', () => answer(true));

async function start() {
  try {
    try {
      db = await openDb();
      await importLevel(db, LEVEL, CSV_URL);
      cards = await getCards(db, LEVEL);
      (await getProgress(db)).forEach(p => progress.set(p.id, p));
      els.storage.textContent = '✅ Disponible : ta progression est enregistrée sur le téléphone.';
      // Ask Safari not to evict our data when the phone runs low on space.
      navigator.storage?.persist?.().catch(() => {});
    } catch (err) {
      // Safari can refuse IndexedDB (private browsing, blocked cookies…): read the CSV directly instead.
      console.warn('[DB] IndexedDB indisponible, lecture directe du CSV', err);
      db = null;
      cards = await fetchLevel(LEVEL, CSV_URL);
      els.storage.textContent = '⚠︎ Indisponible : ta progression sera perdue à la fermeture de l\'app.';
      showToast('⚠︎ Progression non sauvegardée sur cet appareil', 4000);
    }
    if (!cards.length) throw new Error('Aucun mot trouvé');
    // Drop progress that no longer matches a card, in case the word list changed.
    progress.forEach((p, id) => { if (!cards.some(c => c.id === id)) progress.delete(id); });
    persist(fillFirstBox());
    els.card.disabled = false;
    showNext();
  } catch (err) {
    els.hanzi.textContent = '⚠︎';
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

function renderBoxCounts() {
  const counts = {};
  progress.forEach(p => { counts[p.box] = (counts[p.box] || 0) + 1; });
  const rows = [];
  for (let box = 1; box <= LAST_BOX; box++) rows.push([`Boîte ${box}`, counts[box] || 0]);
  rows.push(['Pas encore vues', cards.length - progress.size]);
  document.getElementById('box-counts').replaceChildren(...rows.map(([label, n]) => {
    const li = document.createElement('li');
    li.append(Object.assign(document.createElement('span'), { textContent: label }),
      Object.assign(document.createElement('span'), { textContent: `${n} carte${n > 1 ? 's' : ''}` }));
    return li;
  }));
}

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
  if (name === 'boxes') renderBoxCounts();
  if (name === 'settings') navigator.serviceWorker?.controller?.postMessage({ type: 'GET_VERSION' });
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

document.getElementById('clear-cache').addEventListener('click', clearCache);
document.getElementById('hard-reset').addEventListener('click', hardResetPWA);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SW_VERSION') menu.version.textContent = `Service Worker ${event.data.version}`;
  });
  navigator.serviceWorker.register('sw.js');
}

start();
