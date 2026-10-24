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
    const db = await openDb();
    await importLevel(db, LEVEL, CSV_URL);
    cards = await getCards(db, LEVEL);
    if (!cards.length) throw new Error('Aucun mot trouvé');
    els.card.disabled = els.next.disabled = false;
    showNext();
  } catch (err) {
    els.hanzi.textContent = '⚠︎';
    els.counter.textContent = err.message;
    console.error(err);
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

start();
