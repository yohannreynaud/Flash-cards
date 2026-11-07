// Card search: a query is matched against the front (characters), the pronunciation (pinyin)
// and the back (French) of every card, ignoring case, accents and tones.

// Lowercase, without accents: "Nǐ Hǎo" -> "ni hao", "École" -> "ecole", "lǜ" -> "lu".
function foldText(text) {
  return (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Pinyin reduced to its bare letters, so tones (marks or digits), spaces and apostrophes
// don't matter: "nǐ hǎo", "ni3hao3", "nìháo" and "ni hao" all give "nihao". ü can be typed
// u or v.
function pinyinKey(text) {
  return foldText(text).replace(/v/g, 'u').replace(/[^a-z]/g, '');
}

// The ways a card can be found, each prepared once for fast typing.
function searchEntry(card, deck) {
  const back = foldText(card.back);
  return {
    card,
    deck,
    front: foldText(card.front),
    // Only Chinese and Japanese cards (pinyin, or kana followed by its rōmaji): other decks'
    // pronunciations (IPA…) would give meaningless keys.
    pinyin: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(card.front) ? pinyinKey(card.pronunciation) : '',
    back,
    // "je, moi" -> ["je", "moi"]: matching one meaning exactly ranks as an exact match.
    meanings: back.split(/[,;/\n()]+/).map(s => s.trim()).filter(Boolean),
    words: back.split(/[^a-z0-9']+/).filter(Boolean),
  };
}

// How well a card matches, lower is better: 0 exact (word, pinyin or one meaning),
// 1 start of the word or pinyin, 2 start of a French meaning or word, 3 anywhere inside,
// Infinity when it doesn't match.
function matchRank(entry, query) {
  const text = foldText(query);
  if (!text) return Infinity;
  const key = pinyinKey(query);
  let rank = Infinity;
  const consider = (value, target, prefixRank) => {
    if (!target || !value) return;
    if (value === target) rank = Math.min(rank, 0);
    else if (value.startsWith(target)) rank = Math.min(rank, prefixRank);
    else if (value.includes(target)) rank = Math.min(rank, 3);
  };
  consider(entry.front, text, 1);
  consider(entry.pinyin, key, 1);
  consider(entry.back, text, 2);
  if (entry.meanings.includes(text)) rank = 0;
  else if (rank > 2 && (entry.meanings.some(m => m.startsWith(text)) || entry.words.some(w => w.startsWith(text)))) rank = 2;
  return rank;
}

// Matching entries, best first; equal matches keep their deck and card order.
function searchCards(entries, query) {
  return entries
    .map((entry, i) => ({ entry, i, rank: matchRank(entry, query) }))
    .filter(r => r.rank !== Infinity)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(r => r.entry);
}

if (typeof module !== 'undefined') module.exports = { foldText, pinyinKey, searchEntry, matchRank, searchCards };
