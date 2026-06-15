# New Horizons — Map Generator

A simple web tool to recolour the political territories on the New Horizons campaign map.
Pick a territory, choose a hex colour, and the map updates live with the proper **Inner Glow**
look (colour glowing in from the borders, transparent in the centre). Download the result as a
**transparent PNG of just the territories** to drop on top of your own map.

100% client-side HTML/JS — it can be hosted as a static site or shared via a temporary
Cloudflare link.

## How the map works (for reference)

The source `NH_TerritoryMap.psd` is 6000×6000 with ~385 layers. Each territory's colour comes
from **one layer effect** — the *Inner Glow* on its `Shape - Territory N` layer (in the
`Colors` group); the fills themselves are invisible (`fillOpacity 0`). The bake step reads
those shapes, computes the inner-glow gradient from each territory's edges, and turns them into
lightweight web assets.

## Setup (one time)

You need [Node.js](https://nodejs.org) (v18+). In this folder:

```
npm install
npm run bake
```

`npm run bake` reads the big PSD once and writes the web assets into `public/assets/`
(`base.jpg` parchment, `overlay-lines.png` dashed borders + numbers, one gradient mask per
territory, the place names extracted as **editable text labels** in `manifest.json`, plus the
bundled `fonts/Cinzel-Bold.woff2`). Re-run it only if the PSD's shapes/artwork change.

> By default the bake looks for `NH_TerritoryMap.psd` in this folder. If your PSD is elsewhere,
> point to it: `set PSD_PATH=path\to\NH_TerritoryMap.psd && npm run bake` (or edit the top of
> `bake.mjs`).

## Run it locally

```
npm start
```

Open **http://localhost:5173**.

- **Quick recolor:** pick a territory, enter a hex (or use the swatch), hit **Generate**.
- **All territories:** the right-hand list sets every territory's colour, filters by
  name/number, and resets any one with ⟲.
- **Zoom** with the scroll wheel (zooms toward the cursor) or the +/− buttons; drag an empty
  area of the map to pan, and ⤢ resets the view.
- Colours auto-save in the browser, so you can close and come back.
- **Place-name text** is rendered on a canvas at full resolution (1:1 with the PSD) in the map's
  own font (Cinzel-Bold) with a black outline. Use the **Text labels** tab: click a label to
  select it, then the editor panel gives **text, size, rotation, curve (arc), outline width,
  fill & outline colour, hide and delete**. Double-click a label on the map to edit its text.
  Dragging to move is **admin-only** in shared mode. **＋ Add** drops a new label.
- **⬇ Download overlay PNG** — a transparent 6000×6000 PNG (1:1 with the source map) you drop on
  top of your base map. Place-name text is rendered at full resolution in the exact font
  (Cinzel-Bold), colour and tracking of the original — no quality loss.
  Use the **borders + numbers** and **place names** checkboxes to choose what's baked into the
  export (coloured territories are always included; borders + numbers are on by default).

## Share it (temporary public Cloudflare link)

```
npm run share
```

This serves the app and opens a **Cloudflare quick tunnel**, printing a
`https://<random>.trycloudflare.com` link. Anyone can open it while the window stays running on
your PC. Close the window to take it down. (`cloudflared.exe` is bundled in this folder.)

## Two ways to host it

**A) Shared + versioned (recommended for a group) — Cloudflare Pages.**
One live map everyone sees, with version history (who edited, when) and admin + editor
passwords. Runs entirely on Cloudflare, never on anyone's PC. Full steps in **[DEPLOY.md](DEPLOY.md)**.
In short: `npx wrangler login`, create a KV namespace, set two password secrets, `npm run deploy`.
Test locally first with `npm run dev:cf` (→ http://127.0.0.1:8788).

**B) Simple static (no backend) — Netlify Drop / any static host.**
The `public/` folder is a plain static site. Drag `nh-map-site.zip` onto
**https://app.netlify.com/drop** for an instant `*.netlify.app` URL. The editor, zoom and text
tools all work, but edits live only in each visitor's own browser — **no shared state or
version history**. Good for personal use or a quick share.

The app auto-detects which mode it's in: if the Cloudflare API is present it loads the shared
map and shows the version/Edit/History controls; otherwise it runs locally per-browser.

## Notes

- Territories 5, 23, 43 and 44 are hidden on the live map, so they stay off until you give them
  a colour.
- The exported PNG never includes the parchment — only the coloured territories plus whatever
  you tick (borders + numbers, place names) — so it layers cleanly over your existing map.

## Files

| File | What it is |
|------|------------|
| `bake.mjs` | One-time PSD → web assets preprocessor (needs the PSD) |
| `server.mjs` | Tiny static file server (local preview / tunnel) |
| `share.mjs` | Serves the app + opens a temporary Cloudflare tunnel |
| `cloudflared.exe` | Cloudflare tunnel binary (bundled) |
| `public/` | The static web app (`index.html`, `app.js`, `style.css`) + baked `assets/` |
