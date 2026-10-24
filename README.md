# HSK Flashcards

An offline flashcard PWA for learning HSK 3.0 Chinese vocabulary (French meanings), built for iPhone.

- Plain HTML/CSS/JS, no build step. GitHub Pages serves the repo root.
- On first launch, `data/hsk1.csv` is imported into IndexedDB.
- Learning follows the Leitner system: 5 boxes, two answers ("Je savais" moves a card up one box, "À revoir" sends it back to box 1). Cards are reviewed in rounds: box 1 every round, and box n+1 once every 2 reviews of box n (box 2 every 2 rounds, box 3 every 4, box 5 every 16). Never-seen cards are added to box 1 at random while it holds fewer than 20 cards. Progress is stored in IndexedDB.
- A service worker (`sw.js`) caches every file, so the app works in airplane mode.

## Use it on iPhone

1. Open the GitHub Pages URL in Safari.
2. Share → **Add to Home Screen**.
3. Launch it once while online. After that it works offline.

## Updating the app

When you change any file, bump `CACHE_VERSION` in `sw.js` so the phone downloads the new version.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.
