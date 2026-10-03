# Contributing to PanelPath

Two great ways to help: **fix/extend a reading order**, or **improve the app**. Both are welcome.

## Adding or fixing a reading order

Reading orders are plain JSON files in `data/orders/`. One file per comic line. The app picks up every `*.json` in that folder at startup — no code changes needed.

**Shortcut:** you can build the order in the app first (**+ New order** on the home page). The builder writes a valid order file into your data directory under `orders/` — paste that file into your PR. ComicVine search inside the builder fills in the ids and labels for you as you add issues.

### The format

```json
{
  "id": "my-series",
  "title": "My Series",
  "subtitle": "One line about the run",
  "credit": "Where this order comes from (guides, deluxe editions, your own reading)",
  "sections": [
    {
      "id": "S1",
      "name": "Part One",
      "years": "#1–10",
      "color": "#43a047",
      "tagline": "optional flavor line",
      "items": [
        {
          "id": "my-001",
          "label": "My Series #1",
          "title": "Issue title (optional)",
          "series": "MS",
          "seriesName": "My Series (2020)",
          "num": "1",
          "cv": { "v": 123456, "i": 7890123 }
        }
      ]
    }
  ]
}
```

- `id` (order): lowercase letters, numbers, hyphens. The filename must match: `my-series.json`.
- `items[].id`: unique within the order (e.g. `my-001`). Used for progress + cover filenames — don't change it once people have read the order.
- `cv`: optional but recommended — the ComicVine **volume id** (`v`) and **issue id** (`i`) power the cover fetcher. Items without it render a styled placeholder.
- Sections with `"kind": "extras"` render as "read anytime" side stories.

### Finding ComicVine ids

1. Search at [comicvine.gamespot.com](https://comicvine.gamespot.com).
2. Open the volume (series) page — the URL looks like `/volume/4050-123456/...` → volume id = `123456`.
3. Open an issue — `/issue/4000-7890123/...` → issue id = `7890123`.

### Testing locally

```bash
npm install
node server.js        # http://localhost:5175
```

- Your order appears on the home screen; open it and click around.
- To test the cover fetcher, get a free ComicVine API key (Settings → paste → "Fetch missing covers"). Note the free tier is rate-limited; the fetcher handles this politely.
- Keep orders **sequential by reading experience**, not by publication date, where the two differ — and say so in `credit` if the order is opinionated. Corrections with sources are very welcome.

### Submitting

Open a PR with: the new/updated order file and a one-line note on your sources. If you're fixing an existing order, briefly explain what was wrong. For big restructures, open an issue first.

## Improving the app

- Requirements: Node 22+. No build step, no frameworks — Express server (`server.js`) + vanilla JS frontend (`public/`). Keep it that way if you can.
- House style: no emoji in the UI; mobile-first; any CSS/JS change should bump the asset version (`?v=N` in `public/index.html` and `ASSET_V` in `public/app.js`).
- Run `node --check server.js` before committing.
- Small, focused PRs are easiest to review.

## Ground rules

- PanelPath is an **unofficial fan project** — no copyrighted pages or covers belong in the repo (the fetcher handles art locally, per user).
- Reading orders are community work; credit your sources in the file.

Thanks for helping!
