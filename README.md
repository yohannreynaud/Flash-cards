# HSK Flashcards

An offline flashcard PWA for learning HSK 3.0 Chinese vocabulary (French meanings), built for iPhone.

- Plain HTML/CSS/JS, no build step. GitHub Pages serves the repo root.
- On first launch, `data/hsk1.csv` is imported into IndexedDB.
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
