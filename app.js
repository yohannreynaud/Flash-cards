const LEVEL = 1;
const CSV_URL = 'data/hsk1.csv';

// Leitner boxes: days before a card answered "Je savais" comes back, by the box it moves to.
// Box 1 is always due; "À revoir" sends a card back to box 1 from any box.
const BOX_INTERVALS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 };
const LAST_BOX = 5;
// Never-seen cards are only added to box 1 while it holds fewer than this many cards.
// Cards falling back from other boxes ignore the cap.
const FIRST_BOX_CAP = 20;

const els = {
  card: document.getElementById('card'),
  counter: document.getElementById('counter'),
  hanzi: document.getElementById('hanzi'),
  hint: document.getElementById('hint'),
  hanziBack: document.getElementById('hanzi-back'),
  pinyin: document.getElementById('pinyin'),
  french: document.getElementById('french'),
  again: document.getElementById('again'),
  known: document.getElementById('known'),
  storage: document.getElementById('storage-status'),
};

let db = null;               // null when IndexedDB is unavailable: progress then lives in memory only
let cards = [];
let progress = new Map();    // card id -> { id, box, due }
let current = null;

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Midnight, `days` days from today: a card due "in 1 day" is back tomorrow morning.
function dayFromNow(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

// Adds random never-seen cards to box 1 up to the cap, and returns them.
function fillFirstBox() {
  const inFirstBox = [...progress.values()].filter(p => p.box === 1).length;
  const room = FIRST_BOX_CAP - inFirstBox;
  if (room <= 0) return [];
  const added = shuffle(cards.filter(c => !progress.has(c.id)))
    .slice(0, room)
    .map(c => ({ id: c.id, box: 1, due: 0 }));
  added.forEach(p => progress.set(p.id, p));
  return added;
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
  els.hint.textContent = 'Touchez pour retourner';
  els.hanziBack.textContent = card.hanzi;
  els.pinyin.textContent = card.pinyin;
  els.french.textContent = card.french;
  els.counter.textContent = `Boîte ${progress.get(card.id).box}`;
}

function renderDone() {
  els.hanzi.textContent = '🎉';
  els.hint.textContent = 'Rien à réviser, reviens demain';
  els.counter.textContent = '';
  els.card.disabled = true;
}

// Picks a random due card, avoiding the one just answered when another is available.
function showNext() {
  const now = Date.now();
  let due = cards.filter(c => progress.get(c.id)?.due <= now);
  if (due.length > 1 && current) due = due.filter(c => c !== current);
  current = due.length ? due[Math.floor(Math.random() * due.length)] : null;
  setAnswerButtons(false);

  const update = () => (current ? render(current) : renderDone());
  if (els.card.classList.contains('flipped')) {
    // Swap content once the card has turned back, so the answer never flashes on the front.
    els.card.classList.remove('flipped');
    setTimeout(update, 220);
  } else {
    update();
  }
  els.card.disabled = !current;
}

function answer(knew) {
  if (!current) return;
  const p = progress.get(current.id);
  p.box = knew ? Math.min(p.box + 1, LAST_BOX) : 1;
  p.due = p.box === 1 ? 0 : dayFromNow(BOX_INTERVALS[p.box]);
  persist([p, ...fillFirstBox()]);
  showNext();
}

els.card.addEventListener('click', () => {
  els.card.classList.toggle('flipped');
  if (current) setAnswerButtons(true);   // stay enabled once the answer has been seen
});
els.again.addEventListener('click', () => answer(false));
els.known.addEventListener('click', () => answer(true));

// An iPhone PWA left open overnight resumes without reloading: pick up cards that became due.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cards.length && !current) showNext();
});

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
    persist(fillFirstBox());
    showNext();
  } catch (err) {
    els.hanzi.textContent = '⚠︎';
    els.counter.textContent = err.message;
    console.error(err);
  }
}

// ------------------------------
// Settings menu (same reset tools as the Kata app)
// ------------------------------
const settings = {
  panel: document.getElementById('settings'),
  backdrop: document.getElementById('settings-backdrop'),
  open: document.getElementById('settings-btn'),
  close: document.getElementById('settings-close'),
  version: document.getElementById('sw-version'),
};

function toggleSettings(show) {
  settings.panel.hidden = settings.backdrop.hidden = !show;
  settings.open.setAttribute('aria-expanded', String(show));
  if (show) navigator.serviceWorker?.controller?.postMessage({ type: 'GET_VERSION' });
}

settings.open.addEventListener('click', () => toggleSettings(settings.panel.hidden));
settings.close.addEventListener('click', () => toggleSettings(false));
settings.backdrop.addEventListener('click', () => toggleSettings(false));

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
    if (event.data?.type === 'SW_VERSION') settings.version.textContent = `Service Worker ${event.data.version}`;
  });
  navigator.serviceWorker.register('sw.js');
}

start();
