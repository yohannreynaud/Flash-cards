// Shipped with the app and always available; the first one is the default. Imported decks
// are kept in IndexedDB. Bump a deck's version when its CSV changes, so phones re-import it.
const BUILTIN_DECKS = [
  { id: 'hsk1', name: 'HSK 1', url: 'data/hsk1.csv', version: 6 },
  { id: 'english-c1', name: 'Anglais C1-C2', url: 'data/english-c1.csv', version: 1 },
];
const DEFAULT_DECK = BUILTIN_DECKS[0];

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
  backBox: document.getElementById('back-box'),
  aidsHint: document.getElementById('aids-hint'),
  newCards: document.getElementById('new-cards'),
  boxChart: document.getElementById('box-chart'),
};

let db = null;               // null when IndexedDB is unavailable: progress then lives in memory only
let decks = [...BUILTIN_DECKS];
let activeDeck = DEFAULT_DECK;
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

// Stack of cards, for the cards not in any box yet.
const CARDS_SVG = '<svg viewBox="0 0 56 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" aria-hidden="true">'
  + '<rect x="11" y="3" width="34" height="42" rx="4" transform="rotate(12 28 24)"/><rect x="11" y="3" width="34" height="42" rx="4" fill="var(--bg)"/></svg>';
els.newCards.querySelector('.box-icon').insertAdjacentHTML('afterbegin', CARDS_SVG);

// Bar chart below the card: boxes 0 to 3 always, higher ones once a card reaches them.
// Bars are scaled to the fullest box. Nothing marks the current card's box, so the answer
// isn't hinted at; only the box a card just landed in gets a "+1".
const CHART_MIN_BOXES = 4;

function renderChart(arrivedBox) {
  const counts = {};
  progress.forEach(p => { counts[p.box] = (counts[p.box] || 0) + 1; });
  const lastBox = Math.max(CHART_MIN_BOXES, ...Object.keys(counts).map(Number));
  const chart = els.boxChart;
  // Bars are kept from one render to the next, so their height changes are animated.
  while (chart.children.length < lastBox) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="bar-count"></span><span class="bar-track"><span class="bar"></span></span><span class="bar-label"></span>';
    chart.append(li);
  }
  while (chart.children.length > lastBox) chart.lastChild.remove();
  const max = Math.max(1, ...Object.values(counts));
  [...chart.children].forEach((li, i) => {
    const box = i + 1;
    const n = counts[box] || 0;
    li.setAttribute('aria-label', `${boxName(box)} : ${n} carte${n > 1 ? 's' : ''}`);
    li.querySelector('.bar-count').textContent = n;
    li.querySelector('.bar').style.height = `${(n / max) * 100}%`;
    li.querySelector('.bar-label').textContent = box - 1;
  });
  els.newCards.querySelector('.box-count').textContent = cards.length - progress.size;
  if (arrivedBox) {
    const plus = Object.assign(document.createElement('span'), { className: 'plus-one', textContent: '+1' });
    chart.children[arrivedBox - 1].append(plus);
    setTimeout(() => plus.remove(), 1350);
  }
}

// Mastery score: each card counts its box number as shown (box 0 counts nothing).
// Passing a new ten for the first time on this deck is celebrated.
let bestScore = 0;

function masteryScore() {
  let score = 0;
  progress.forEach(p => { score += p.box - 1; });
  return score;
}

function renderScore() {
  const score = masteryScore();
  const previous = Number(els.counter.dataset.score);
  els.counter.dataset.score = score;
  els.counter.textContent = `Maîtrise ${score}`;
  if (score > previous) {
    els.counter.classList.remove('pop');
    void els.counter.offsetWidth;   // restart the animation
    els.counter.classList.add('pop');
  }
  if (score > bestScore) {
    if (Math.floor(score / 10) > Math.floor(bestScore / 10)) celebrate(`🎉 Maîtrise ${Math.floor(score / 10) * 10} !`);
    bestScore = score;
    if (db) setMeta(db, `bestScore:${activeDeck.id}`, bestScore).catch(() => {});
  }
}

function celebrate(message) {
  const layer = Object.assign(document.createElement('div'), { className: 'confetti' });
  const colors = ['var(--accent)', '#f9a825', '#2e7d32', '#1e5bb8', '#c2185b', '#6a3fb5'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('span');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    piece.style.setProperty('--x', `${(Math.random() - 0.5) * 160}px`);
    piece.style.setProperty('--r', `${(Math.random() - 0.5) * 1080}deg`);
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2600);
  showToast(message);
}

function render(card) {
  els.front.textContent = card.front;
  // Short fronts (a few characters) are shown big; longer words and phrases get smaller.
  els.front.classList.toggle('long', card.front.length > 4);
  els.frontBack.textContent = card.front;
  els.frontBack.classList.toggle('long', card.front.length > 4);
  els.back.textContent = card.back;
  els.pronunciation.textContent = card.pronunciation || '';
  // Only on the back: seeing the box before answering would bias the answer.
  els.backBox.textContent = boxName(progress.get(card.id).box);
  els.aidsHint.hidden = !hasAids(card);
  renderAids(card);
}

// ------------------------------
// Comprehension aids: a sheet rising from the bottom when the back is swiped up.
// ------------------------------
const aids = {
  sheet: document.getElementById('aids'),
  backdrop: document.getElementById('aids-backdrop'),
  grab: document.getElementById('aids-grab'),
  close: document.getElementById('aids-close'),
  word: document.getElementById('aids-word'),
  pronunciation: document.getElementById('aids-pronunciation'),
  exampleBlock: document.getElementById('aids-example-block'),
  example: document.getElementById('aids-example'),
  translation: document.getElementById('aids-translation'),
  elementsBlock: document.getElementById('aids-elements-block'),
  elements: document.getElementById('aids-elements'),
  startY: null,
  dy: 0,
};

function renderAids(card) {
  aids.word.textContent = card.front;
  aids.pronunciation.textContent = card.pronunciation || '';
  aids.example.textContent = card.example || '';
  aids.translation.textContent = card.exampleTranslation || '';
  aids.exampleBlock.hidden = !card.example && !card.exampleTranslation;
  aids.elements.replaceChildren(...(card.elements || []).flatMap(({ item, explanation }) => [
    Object.assign(document.createElement('dt'), { textContent: item }),
    Object.assign(document.createElement('dd'), { textContent: explanation }),
  ]));
  aids.elementsBlock.hidden = !card.elements?.length;
}

function aidsOpen() {
  return aids.sheet.classList.contains('open');
}

function openAids() {
  aids.sheet.querySelector('.sheet-body').scrollTop = 0;
  aids.backdrop.hidden = false;
  aids.sheet.style.transform = '';
  aids.sheet.classList.add('open');
  aids.sheet.setAttribute('aria-hidden', 'false');
}

function closeAids() {
  aids.sheet.style.transform = '';
  aids.sheet.classList.remove('open');
  aids.sheet.setAttribute('aria-hidden', 'true');
  aids.backdrop.hidden = true;
}

aids.close.addEventListener('click', closeAids);
aids.backdrop.addEventListener('click', closeAids);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && aidsOpen()) closeAids(); });

// Dragging the top of the sheet down closes it.
aids.grab.addEventListener('pointerdown', event => {
  aids.startY = event.clientY;
  aids.dy = 0;
  aids.grab.setPointerCapture(event.pointerId);
  aids.sheet.classList.add('dragging');
});
aids.grab.addEventListener('pointermove', event => {
  if (aids.startY === null) return;
  aids.dy = Math.max(0, event.clientY - aids.startY);
  aids.sheet.style.transform = `translateY(${aids.dy}px)`;
});
function endAidsDrag() {
  if (aids.startY === null) return;
  aids.startY = null;
  aids.sheet.classList.remove('dragging');
  if (aids.dy > SWIPE_THRESHOLD) closeAids();
  else aids.sheet.style.transform = '';
}
aids.grab.addEventListener('pointerup', endAidsDrag);
aids.grab.addEventListener('pointercancel', endAidsDrag);

// arrivedBox: the box the card just answered moved to, if it moved.
function showNext(arrivedBox) {
  current = drawCard();
  revealed = false;
  renderChart(arrivedBox);
  renderScore();
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
  const before = p.box;
  if (result === 'known') p.box++;
  if (result === 'again') p.box = 1;
  persist([p, ...fillFirstBox()]);
  showNext(p.box !== before ? p.box : undefined);
}

els.card.addEventListener('click', () => {
  if (swipe.dragged) return;   // the end of a swipe is not a tap
  els.card.classList.toggle('flipped');
  if (current) revealed = true;   // stays true once the answer has been seen
});

// Once the answer has been seen: swipe right for "Je savais", left for "À revoir",
// down to leave the card in its box, up on the back to open the card's comprehension aids.
const SWIPE_THRESHOLD = 80;
const swipe = { el: document.getElementById('swipe'), startX: null, startY: null, dx: 0, dy: 0, dragged: false };

// A mostly horizontal drag answers left or right; a mostly downward one keeps the card;
// a mostly upward one on the back opens the aids, when the card has some.
function swipeResult(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return Math.abs(dx) > SWIPE_THRESHOLD ? (dx > 0 ? 'known' : 'again') : null;
  if (dy < -SWIPE_THRESHOLD) return current && hasAids(current) && els.card.classList.contains('flipped') ? 'aids' : null;
  return dy > SWIPE_THRESHOLD ? 'keep' : null;
}

function setSwipe(dx, dy) {
  const down = dy > Math.abs(dx);
  const up = -dy > Math.abs(dx);
  // An upward drag only nudges the card: it doesn't answer, it opens the aids.
  swipe.el.style.transform = !dx && !dy ? ''
    : down ? `translateY(${dy}px)` : up ? `translateY(${Math.max(dy / 4, -40)}px)` : `translateX(${dx}px) rotate(${dx / 20}deg)`;
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
  } else if (result === 'aids') {
    setSwipe(0, 0);
    openAids();
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
  cards = db ? await getCards(db, deck.id) : await fetchDeck(deck);
  const ids = new Set(cards.map(c => c.id));
  progress = new Map();
  if (db) (await getProgress(db)).forEach(p => { if (ids.has(p.id)) progress.set(p.id, p); });
  document.getElementById('page-flashcards').dataset.title = deck.name;
  if (!document.getElementById('page-flashcards').hidden) menu.title.textContent = deck.name;
  if (!cards.length) throw new Error('Aucun mot trouvé');
  current = null;
  persist(fillFirstBox());
  // Start from the best score already reached on this deck, so only new tens are celebrated.
  bestScore = Math.max(masteryScore(), (db && await getMeta(db, `bestScore:${deck.id}`)) || 0);
  delete els.counter.dataset.score;
  els.card.disabled = false;
  showNext();
}

async function start() {
  try {
    let deck = DEFAULT_DECK;
    try {
      db = await openDb();
      for (const builtin of BUILTIN_DECKS) await importBuiltinDeck(db, builtin);
      decks = [...BUILTIN_DECKS, ...await getDecks(db)];
      const activeId = await getMeta(db, 'activeDeck');
      deck = decks.find(d => d.id === activeId) || DEFAULT_DECK;
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
  const counts = await Promise.all(decks.map(d => (d === activeDeck ? cards.length
    : db ? countCards(db, d.id) : fetchDeck(d).then(c => c.length))));
  list.replaceChildren(...decks.map((deck, i) => {
    const li = document.createElement('li');
    li.classList.toggle('active', deck === activeDeck);
    const select = Object.assign(document.createElement('button'), { type: 'button', className: 'deck-select' });
    select.append(Object.assign(document.createElement('span'), { textContent: deck === activeDeck ? `✓ ${deck.name}` : deck.name }),
      Object.assign(document.createElement('span'), { textContent: `${counts[i]} carte${counts[i] > 1 ? 's' : ''}` }));
    select.addEventListener('click', () => chooseDeck(deck));
    li.append(select);
    if (!BUILTIN_DECKS.includes(deck)) {
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
    await loadDeck(DEFAULT_DECK);
    await setMeta(db, 'activeDeck', DEFAULT_DECK.id);
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
  bestScore = 0;
  if (db) setMeta(db, `bestScore:${activeDeck.id}`, 0).catch(() => {});
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

// New version banner (same approach as the Kata app): a new sw.js installs in the
// background and waits; the banner lets the user activate it, then the page reloads.
const updateBanner = document.getElementById('update-banner');
let reloadOnUpdate = false;

function showUpdateBanner(reg) {
  updateBanner.hidden = false;
  document.getElementById('update-btn').onclick = () => {
    if (!reg.waiting) return window.location.reload();
    reloadOnUpdate = true;
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  };
}

async function registerServiceWorker() {
  const reg = await navigator.serviceWorker.register('sw.js');
  // A version installed during an earlier visit and still waiting.
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      // Without a controller this is the very first install, not an update.
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(reg);
    });
  });
  // Only reload when the user asked for it: the first install and the hard reset also change the controller.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnUpdate) window.location.reload();
  });
  // An installed PWA can stay open for days: check for a new version when it comes back
  // to the foreground, and every hour while it stays open.
  const checkForUpdate = () => reg.update().catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  setInterval(checkForUpdate, 60 * 60 * 1000);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SW_VERSION') menu.version.textContent = `Service Worker ${event.data.version}`;
  });
  registerServiceWorker().catch(err => console.error('[SW] Enregistrement impossible', err));
}

start();
