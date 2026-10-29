# HSK Flashcards

An offline flashcard PWA for learning HSK 3.0 Chinese vocabulary (French meanings), built for iPhone.

> J'ai créé cette app parce que j'en avais marre des applications freemium qui tentent de nous faire payer pour la moindre option. Maintenant j'ai ma propre appli, et je suis ravi si d'autres veulent l'utiliser aussi. Elle est gratuite, sans compte, sans publicité, et fonctionne entièrement hors ligne.

- Plain HTML/CSS/JS, no build step. GitHub Pages serves the repo root.
- On first launch, the built-in decks are imported into IndexedDB: `data/hsk1.csv` (HSK 1, Chinese) and `data/english-c1.csv` (300 C1-C2 English words with French meanings and IPA pronunciation). Other decks can be imported from the Decks page as CSV files with two columns, front then back, plus an optional third column for the pronunciation shown on the back (a cell may span several lines; `,` or `;` separator; optional `Recto,Verso,Prononciation` header row). One deck is practised at a time, each with its own progress.
- Learning follows the Leitner system: unlimited boxes (shown numbered from 0; the code and the saved progress number them from 1), answered by swiping once the card is flipped (right: "Je savais" moves it up one box; left: "À revoir" sends it back to box 1; down: it stays in its box). Each card is drawn at random, a card in box n+1 being half as likely as one in box n, so on average box n+1 is reviewed once every 2 reviews of box n. Never-seen cards are added to box 1 at random while it holds fewer than 10 cards. Progress is stored in IndexedDB.
- A service worker (`sw.js`) caches every file, so the app works in airplane mode.

## Use it on iPhone

1. Open the GitHub Pages URL in Safari.
2. Share → **Add to Home Screen**.
3. Launch it once while online. After that it works offline.

## Updating the app

When you change any file, bump `CACHE_VERSION` in `sw.js` so the phone downloads the new version.

The app checks for a new `sw.js` each time it comes back to the foreground (and every hour while open). The new version installs in the background, then a banner "Une nouvelle version est disponible" appears; tapping **Mettre à jour** activates it and reloads the page. No manual hard reset needed.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.
