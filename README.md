# Quin69 Command Deck

A zero-backend static web app that:

- embeds Quin69's Twitch stream + chat,
- lets a viewer log in with their **own** Twitch account, and
- gives them buttons that send chat commands **as themselves**.

No server, no database, no client secret. Auth uses Twitch's **Implicit grant
flow**; the user's access token lives only in their browser's `sessionStorage`.

---

## Setup (5 minutes)

### 1. Register a Twitch application

1. Go to <https://dev.twitch.tv/console/apps> → **Register Your Application**.
2. **Name:** anything (e.g. "Quin69 Command Deck").
3. **OAuth Redirect URLs:** add the exact URL the site will be served from.
   It must match character-for-character, including the trailing slash.
   - Local testing: `http://localhost:8000/`
   - GitHub Pages: `https://<your-username>.github.io/<repo-name>/`
   - (You can add both.)
4. **Category:** Website Integration. Click **Create**.
5. Open the app and copy the **Client ID**. (There is *no* secret to copy — we
   don't use one.)

### 2. Drop in your Client ID

Edit `app.js`:

```js
const CONFIG = {
  CLIENT_ID: "paste-your-client-id-here",
  CHANNEL: "quin69",
  ...
```

### 3. Test locally

From this folder:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000/>, click **Log in with Twitch**, approve, then click
a command button. It should appear in chat as you.

### 4. Deploy to GitHub Pages

1. Push this folder to a GitHub repo.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a
   branch**, branch `main`, folder `/ (root)`.
3. Wait for the green check, then visit
   `https://<your-username>.github.io/<repo-name>/`.
4. Make sure that **exact** URL is in your Twitch app's Redirect URLs (step 1.3).

---

## Editing the buttons

Each command is just a chat message. Edit the `COMMANDS` array in `app.js`:

```js
COMMANDS: [
  { label: "Lurk",   text: "!lurk" },
  { label: "Hype",   text: "PogChamp PogChamp" },
],
```

---

## Things to know

- **Rate limits are enforced by Twitch**, per user, server-side. Each viewer has
  their own limit, so the app never hits a global wall. The per-button cooldown
  (`BUTTON_COOLDOWN_MS`) is only UX.
- **Duplicate messages are dropped by Twitch** — clicking the same button twice
  quickly, the second one silently won't post. The app surfaces the drop reason.
- **Channel modes** (slow / followers-only / sub-only / unique-chat) are set by
  the streamer and can cause `drop_reason`s you don't control.
- **Tokens expire** and there's no refresh in implicit flow — the user just logs
  in again. The app handles `401` by prompting re-login.
- Requires scope `user:write:chat`; the viewer approves this on first login.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Layout: player, chat, command deck |
| `app.js`     | Auth, Helix API calls, button logic (all config at top) |
| `styles.css` | Twitch-ish dark theme |
