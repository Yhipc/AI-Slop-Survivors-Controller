# Quin69 Command Deck

A web app that:

- embeds Quin69's Twitch stream + chat,
- lets a viewer log in with their **own** Twitch account, and
- gives them buttons that send chat commands **as themselves**.

> **▶ Live app:** <https://yhipc.github.io/AI-Slop-Survivors-Controller/>
> **❓ Help / Safety FAQ:** <https://yhipc.github.io/AI-Slop-Survivors-Controller/help.html>
> — how your account stays safe, the one Twitch permission it uses, and every
> command it can send. Feedback: <https://forms.gle/j34L3B4mDeXkwNPP8>

**Secure by design:** auth uses Twitch's **Authorization Code flow**. A tiny
Cloudflare Worker holds the client secret and does the code→token swap, so the
browser (and the address bar) **never** sees a usable token — only a single-use
`?code=` that's worthless without the secret. Safe to use on stream.

```
GitHub Pages (frontend)  ──login──▶  Twitch  ──?code=──▶  GitHub Pages
                                                              │ POST code
                                                              ▼
                                              Cloudflare Worker (holds secret)
                                                              │ returns token
                                                              ▼
                                              browser stores token (never in URL)
```

## Layout

| Path | What |
|------|------|
| `index.html`, `app.js`, `styles.css` | Static frontend → GitHub Pages |
| `worker/` | Cloudflare Worker (token exchange) → deployed separately |

---

## Setup

### 1. Register a Twitch application

1. <https://dev.twitch.tv/console/apps> → **Register Your Application**.
2. **OAuth Redirect URLs** (exact match, incl. trailing slash):
   - Local: `http://localhost:8000/`
   - Prod:  `https://yhipc.github.io/AI-Slop-Survivors-Controller/`
3. **Category:** Website Integration → **Create**.
4. Copy the **Client ID**, and click **New Secret** to get a **Client Secret**.
   (The secret goes in the Worker only — never in the frontend.)

### 2. Deploy the Cloudflare Worker

Free account: <https://dash.cloudflare.com/sign-up>. Then, from `worker/`:

```bash
cd worker
# 1. Put your public Client ID + your Pages origin in wrangler.toml [vars]
#      TWITCH_CLIENT_ID = "..."
#      ALLOWED_ORIGIN   = "https://yhipc.github.io"
# 2. Store the secret (encrypted, prompts you to paste it):
npx wrangler secret put TWITCH_CLIENT_SECRET
# 3. Deploy:
npx wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://q69-twitch-auth.<your-subdomain>.workers.dev`. Copy it.

> `ALLOWED_ORIGIN` is the **origin** only (scheme + host, no path):
> `https://yhipc.github.io`. It locks the Worker to your site.

### 3. Configure the frontend

Edit `app.js`:

```js
const CONFIG = {
  CLIENT_ID: "your-client-id",
  WORKER_URL: "https://q69-twitch-auth.<your-subdomain>.workers.dev",
  CHANNEL: "quin69",
  ...
```

### 4. Test locally

```bash
python3 -m http.server 8000     # from the repo root
```

Open <http://localhost:8000/>, log in, click a button → it posts to chat as you.
(For local testing, temporarily set `ALLOWED_ORIGIN = "http://localhost:8000"`
in the Worker and redeploy, or run a second Worker for dev.)

### 5. Deploy the frontend to GitHub Pages

Repo **Settings → Pages → Source: Deploy from a branch → `main` / root**.
Live at `https://yhipc.github.io/AI-Slop-Survivors-Controller/`.

---

## Editing the buttons

Each command is just a chat message — edit `COMMANDS` in `app.js`:

```js
COMMANDS: [
  { label: "Lurk", text: "!lurk" },
  { label: "Hype", text: "PogChamp" },
],
```

## Things to know

- **Rate limits** are enforced by Twitch, per user, server-side. Each viewer has
  their own bucket; the button cooldown is only UX.
- **Duplicate messages** are silently dropped by Twitch; the app shows the drop
  reason.
- **Channel modes** (slow / followers-only / sub-only / unique-chat) are set by
  the streamer and can cause drops you don't control.
- **Tokens stay logged in** — the Worker returns a refresh token and the app
  refreshes automatically on `401`. Tokens live in `localStorage`, never in a URL.
- **Scope is `user:write:chat` only** — the worst a leaked token can do is post
  chat as that user, until revoked (Twitch → Settings → Connections).
- **The secret lives only in the Worker** (via `wrangler secret`), never in the
  repo or the browser.
