# New Horizons — Map Generator

A browser-based tool for recolouring the political territories and editing the place-name
labels on the New Horizons campaign map. Pick a territory, choose a colour, move and rename
text — and publish one shared, version-controlled map that everyone sees.

Runs entirely on Cloudflare (static site + serverless functions + KV storage). No build step,
no framework.

---

## Features

- **Recolour territories** — pick any of the ~50 territories and set a hex colour; the original
  Photoshop *Inner Glow* look (colour glowing in from the borders, transparent in the centre) is
  reproduced 1:1.
- **Editable place names** — rendered at full resolution in the map's font (Cinzel-Bold) with an
  outline. Per-label **text, size, rotation, curve (arc), outline, colour, hide and delete**.
- **Zoom & pan** — scroll-wheel zoom toward the cursor, drag to pan, reset view.
- **Export** — download a transparent PNG overlay (territories + optional borders/numbers/names)
  to drop onto the base map.
- **Shared & versioned** — one live map for everyone, with full **version history** (who edited,
  when) and **restore**.
- **Password-protected editing** — separate **admin** and **editor** passwords; viewing is open
  to anyone with the link. Moving text is admin-only.

---

## Deploy to Cloudflare Pages (via GitHub)

You need a free Cloudflare account (https://dash.cloudflare.com/sign-up).

### 1. Push this repo to GitHub
Create a repo and push the project as-is.

### 2. Create a KV namespace
In the Cloudflare dashboard: **Workers & Pages -> KV -> Create a namespace** (name it anything).
Copy its **ID**, then paste it into `wrangler.toml`:

    [[kv_namespaces]]
    binding = "MAP"
    id = "your-kv-namespace-id"

Commit and push that change.

### 3. Connect the repo to Pages
**Workers & Pages -> Create -> Pages -> Connect to Git** -> pick your repo, then set:

| Setting                | Value             |
|------------------------|-------------------|
| Framework preset       | None              |
| Build command          | (leave empty)     |
| Build output directory | public            |

The API in `functions/` is detected automatically.

### 4. Bind the KV namespace to the project
**Your Pages project -> Settings -> Functions -> KV namespace bindings -> Add binding**
- Variable name: `MAP`
- KV namespace: the one you created

### 5. Set the passwords (optional)
The starting passwords ship in `wrangler.toml` (`INIT_ADMIN_PASSWORD`, `INIT_EDITOR_PASSWORD`) so
it works out of the box. To override them, add **Settings -> Environment variables**:
`INIT_ADMIN_PASSWORD` and `INIT_EDITOR_PASSWORD`. They're read once on first run, then stored in
KV — an admin can change both in-app (gear icon) anytime afterwards.

> Security note: values in `wrangler.toml` are visible to anyone with repo access. For a
> public repo, set the passwords as Pages **environment variables / secrets** instead and change
> the admin password in-app after the first deploy.

### 6. Deploy
Trigger the deploy (it runs automatically on push). You'll get a `https://<project>.pages.dev`
URL. Open it -> **Edit** -> enter a password -> recolour / move text -> **Save** to publish a
version. **History** lists every version with restore.

---

## Deploy via CLI (alternative)

    npm install
    npx wrangler login
    npx wrangler kv namespace create MAP   # paste the id into wrangler.toml
    npm run deploy                         # wrangler pages deploy public

## Run locally

    npm install
    npm run dev:cf          # full app + API + simulated KV at http://127.0.0.1:8788

Or, without the backend (static, per-browser only — no shared state or passwords):

    npm start               # http://localhost:5173

---

## Updating the map artwork

The web assets in `public/assets/` are pre-generated from the source PSD. If the underlying map
changes, regenerate them:

    PSD_PATH="path/to/NH_TerritoryMap.psd" npm run bake

Then redeploy. Saved versions in KV are unaffected.

---

## How it works

| Path                | What it is                                                                                   |
|---------------------|----------------------------------------------------------------------------------------------|
| public/             | The static web app (index.html, app.js, style.css) + baked map assets                        |
| public/assets/      | base.jpg (parchment), overlay-lines.png (borders + numbers), per-territory inner-glow masks, |
|                     | fonts/Cinzel-Bold.ttf, manifest.json                                                         |
| functions/api/      | Pages Functions: state, versions, save, restore, auth, config                                |
| wrangler.toml       | KV binding + initial passwords                                                                |
| bake.mjs            | One-time PSD -> web-assets preprocessor                                                       |
| server.mjs / share.mjs | Local static server / temporary tunnel helper                                             |

Passwords are stored only as salted SHA-256 hashes in KV — never in plaintext at runtime. The
free Cloudflare tier is more than enough for a private group.

---

## Credits & licence

- Type: **Cinzel** by Natanael Gama — SIL Open Font License 1.1 (https://scripts.sil.org/OFL).
- Map artwork (c) its respective creator.

made by bastion
