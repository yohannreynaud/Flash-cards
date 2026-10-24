const LEVEL = 1;
const CSV_URL = 'data/hsk1.csv';

const els = {
  card: document.getElementById('card'),
  next: document.getElementById('next'),
  counter: document.getElementById('counter'),
  hanzi: document.getElementById('hanzi'),
  hanziBack: document.getElementById('hanzi-back'),
  pinyin: document.getElementById('pinyin'),
  french: document.getElementById('french'),
};

let cards = [];
let deck = [];   // shuffled card order; refilled when empty so no card repeats before all are seen
let seen = 0;

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function render(card) {
  els.hanzi.textContent = card.hanzi;
  els.hanziBack.textContent = card.hanzi;
  els.pinyin.textContent = card.pinyin;
  els.french.textContent = card.french;
  els.counter.textContent = `${seen} / ${cards.length}`;
}

function showNext() {
  if (!deck.length) { deck = shuffle(cards); seen = 0; }
  seen++;
  const card = deck.pop();
  if (els.card.classList.contains('flipped')) {
    // Swap content once the card has turned back, so the answer never flashes on the front.
    els.card.classList.remove('flipped');
    setTimeout(() => render(card), 220);
  } else {
    render(card);
  }
}

els.card.addEventListener('click', () => els.card.classList.toggle('flipped'));
els.next.addEventListener('click', showNext);

async function start() {
  try {
    try {
      const db = await openDb();
      await importLevel(db, LEVEL, CSV_URL);
      cards = await getCards(db, LEVEL);
    } catch (err) {
      // Safari can refuse IndexedDB (private browsing, blocked cookies…): read the CSV directly instead.
      console.warn('[DB] IndexedDB indisponible, lecture directe du CSV', err);
      cards = await fetchLevel(LEVEL, CSV_URL);
    }
    if (!cards.length) throw new Error('Aucun mot trouvé');
    els.card.disabled = els.next.disabled = false;
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
