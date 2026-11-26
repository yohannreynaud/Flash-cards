# HSK Flashcards

An offline flashcard PWA for learning HSK 3.0 Chinese vocabulary (French meanings), built for iPhone.

> J'ai créé cette app parce que j'en avais marre des applications freemium qui tentent de nous faire payer pour la moindre option. Maintenant j'ai ma propre appli, et je suis ravi si d'autres veulent l'utiliser aussi. Elle est gratuite, sans compte, sans publicité, et fonctionne entièrement hors ligne.

- Plain HTML/CSS/JS, no build step. GitHub Pages serves the repo root.
- On first launch, the built-in decks are imported into IndexedDB: `data/hsk1.csv` (HSK 1, Chinese) and `data/english-c1.csv` (300 C1-C2 English words with French meanings, IPA pronunciation and an example sentence with its French translation). Other decks can be imported from the Decks page as CSV files with two columns, front then back, then optional columns: the pronunciation shown on the back, an example using the word, its translation, the word's notable elements, one per line as `element : explanation`, and the example's pronunciation (pinyin), shown under the example (a cell may span several lines; `,` or `;` separator). With an optional `Recto,Verso,Prononciation,Exemple,Traduction,Éléments,Pinyin de l'exemple` header row, columns are matched by name, so any optional one can be left out or reordered. Swiping the back of a card up opens a sheet with its example and elements, and the other cards of the deck sharing one of its Chinese characters, grouped by character; tapping one opens it in the sheet, with a way back. One deck is practised at a time, each with its own progress. The Search page finds a card of the current deck by its characters, its pinyin (tones typed with marks, digits, wrong ones or none), its rōmaji or its French meaning, ignoring case and accents; tapping a result opens the card in the same sheet.
- Learning follows the Leitner system: unlimited boxes (shown numbered from 0; the code and the saved progress number them from 1), answered by swiping once the card is flipped (right: "Je savais" moves it up one box; left: "À revoir" sends it back to box 1; down: it stays in its box). A mistaken answer can be undone until the next card is flipped, by swiping that next card the opposite way (left after "Je savais", right after "À revoir", up after "Garder"): the previous card comes back on its back with its earlier box and failure streak, to be answered again. Each card is drawn at random, a card in box n+1 being half as likely as one in box n, so on average box n+1 is reviewed once every 2 reviews of box n. Never-seen cards are added to box 1 at random while it holds fewer than 10 cards. Progress is stored in IndexedDB.
- A **mode** menu next to the deck name picks the review mode: **Normal** (the Leitner review above), or **Boîte 0**, **Boîtes 0-2** or **Boîtes 0-3**: only the cards that were in those boxes when the mode was entered come up, in virtual boxes of their own: they all start in virtual box 0, "Je savais" moves a card up one virtual box (so it comes up half as often), "À revoir" sends it back to 0. The real boxes, the score, chart and failure streaks are untouched. Going back to Normal (or switching mode or deck) wipes the virtual boxes, so every card starts again in virtual box 0 next time. **Évaluation complète** shows every card already studied once and only once, in random order (the button counts them), answered as in Normal mode, so boxes and score change; never-seen cards are left out. When all are done, a popup says so and a new pass starts; leaving the mode (through the menu) ends the pass. The mode is remembered on the phone; when its boxes are empty, the app falls back to Normal. The boxes a mode doesn't review (and the new cards) are greyed out in the chart under the card.
- When a card isn't known, the lightbulb **Indice** button under the word on the front shows the card's example sentence in place of the button, without its translation or pronunciation. Every card of the built-in decks has an example sentence. Using a hint doesn't change how the card is answered or scored. The button is hidden on cards of imported decks that have no example.
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
