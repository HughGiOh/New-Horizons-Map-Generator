# Deploying the shared, versioned map (Cloudflare Pages)

This turns the tool into **one shared map** that everyone sees, with a **version history**
(who edited, when), gated behind **admin + editor passwords**. It runs entirely on Cloudflare —
no one's personal computer is involved.

> Prefer the dead-simple, no-account option instead? The `public/` folder also works as a plain
> static site (drag `nh-map-site.zip` onto https://app.netlify.com/drop). That version has the
> editor, zoom and text tools, but edits stay in each person's own browser — **no shared state or
> versions**. The steps below are only needed for the shared/versioned setup.

## What you need
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Node.js](https://nodejs.org) (v18+) on the machine you deploy from

Everything is driven by `wrangler` (Cloudflare's CLI) via `npx` — nothing to install globally.

## 1. Log in
```
npx wrangler login
```
A browser window opens; approve access.

## 2. Create the storage (KV namespace)
```
npx wrangler kv namespace create MAP
```
It prints something like:
```
[[kv_namespaces]]
binding = "MAP"
id = "abc123def456..."
```
Copy that **id** into `wrangler.toml` (replace `PASTE_YOUR_KV_NAMESPACE_ID_HERE`).

## 3. Set the starting passwords (one time)
These seed the admin + editor passwords on first run (after that, the admin changes them in-app).
Set them as encrypted secrets so they aren't stored in the repo:
```
npx wrangler pages secret put INIT_ADMIN_PASSWORD
npx wrangler pages secret put INIT_EDITOR_PASSWORD
```
(Each prompts you to type the value.)

## 4. Deploy
```
npx wrangler pages deploy public
```
Wrangler uploads the static site **and** the API in `functions/`, and prints your live URL,
e.g. `https://nh-map.pages.dev`. Share that link.

> First deploy may ask to create the Pages project — accept the default name (`nh-map`).

## 5. Use it
- Open the URL → you see the **latest** map (view-only).
- **Edit** → enter the editor (or admin) password → recolor, move/rename text, etc.
- **💾 Save…** → type your name + an optional note → creates a new version.
- **History** → see every version (v#, date, who); **View** any (a banner reminds you you're
  previewing an old one, with *Back to latest*) or **Restore** it.
- The shared map **auto-refreshes** when you return to the tab, and **Save warns you** if someone
  else saved a newer version while you were editing.
- **⚙ Admin** (only after unlocking with the admin password) → change the admin/editor passwords
  anytime.

## Updating the map artwork later
If the underlying PSD changes, re-run `npm run bake` then `npx wrangler pages deploy public`.
Saved versions/state are kept in KV and are unaffected.

## Local testing before deploy
```
npm run dev:cf
```
Runs the whole thing locally (static + API + a simulated KV) at http://127.0.0.1:8788, with
passwords `bastionhasabigfatpeen` (admin) / `editpass` (editor) — set in `wrangler.toml`.

## Notes
- Passwords are stored only as salted SHA-256 hashes in KV — never in plaintext.
- The free Cloudflare tier is far more than enough for a private group.
- Connecting a Git repo to Cloudflare Pages (instead of `wrangler deploy`) also works — set the
  KV binding and the two `INIT_*` variables in the Pages project settings.
