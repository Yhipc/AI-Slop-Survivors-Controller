"use strict";

/* =========================================================================
 * CONFIG — edit these, then everything else works.
 * ========================================================================= */
const CONFIG = {
  // Public Client ID from https://dev.twitch.tv/console (safe to expose).
  CLIENT_ID: "",

  // Your deployed Cloudflare Worker base URL (no trailing slash).
  // e.g. "https://q69-twitch-auth.yourname.workers.dev"
  WORKER_URL: "",

  // Channel to embed + send commands into.
  CHANNEL: "quin69",

  // Scopes requested from the viewer. Keep minimal — this caps the blast radius.
  SCOPES: "user:write:chat",

  // Command buttons. A "command" is just a chat message. Edit freely.
  COMMANDS: [
    { label: "Lurk",    text: "!lurk" },
    { label: "Uptime",  text: "!uptime" },
    { label: "Socials", text: "!socials" },
    { label: "Discord", text: "!discord" },
    { label: "+2",      text: "+2" },
    { label: "-2",      text: "-2" },
  ],

  // Per-button UX cooldown (Twitch drops identical repeats anyway).
  BUTTON_COOLDOWN_MS: 3000,
};

/* =========================================================================
 * State + storage
 * ========================================================================= */
const state = { me: null, broadcasterId: null };
const $ = (s) => document.querySelector(s);
const redirectUri = () => location.origin + location.pathname;

const store = {
  get tokens() {
    try { return JSON.parse(localStorage.getItem("twitch_tokens")); }
    catch { return null; }
  },
  set tokens(t) {
    if (t) localStorage.setItem("twitch_tokens", JSON.stringify(t));
    else localStorage.removeItem("twitch_tokens");
  },
};

/* =========================================================================
 * Auth — Authorization Code flow via the Worker.
 * The browser only ever holds tokens (in storage), never in the URL.
 * ========================================================================= */
function randHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function login() {
  if (!CONFIG.CLIENT_ID || !CONFIG.WORKER_URL) {
    setStatus("Set CONFIG.CLIENT_ID and CONFIG.WORKER_URL in app.js first (see README).", "err");
    return;
  }
  const stateParam = randHex();
  sessionStorage.setItem("oauth_state", stateParam);
  const params = new URLSearchParams({
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: CONFIG.SCOPES,
    state: stateParam,
  });
  location.href = "https://id.twitch.tv/oauth2/authorize?" + params.toString();
}

function logout() {
  store.tokens = null;
  state.me = null;
  state.broadcasterId = null;
  render();
}

// After Twitch redirects back with ?code=&state=, swap the code for tokens.
async function consumeRedirect() {
  const q = new URLSearchParams(location.search);

  if (q.get("error")) {
    setStatus(`Twitch login failed: ${q.get("error_description") || q.get("error")}`, "err");
    history.replaceState(null, "", redirectUri());
    return;
  }

  const code = q.get("code");
  if (!code) return;

  const expected = sessionStorage.getItem("oauth_state");
  sessionStorage.removeItem("oauth_state");
  // Clear the code out of the URL immediately (it's single-use anyway).
  history.replaceState(null, "", redirectUri());

  if (!expected || q.get("state") !== expected) {
    setStatus("Login blocked: state mismatch (possible CSRF).", "err");
    return;
  }

  try {
    const res = await fetch(CONFIG.WORKER_URL + "/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: redirectUri() }),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) throw new Error(data.error || "exchange failed");
    store.tokens = data;
  } catch (e) {
    setStatus("Could not complete login: " + e.message, "err");
  }
}

async function refreshTokens() {
  const t = store.tokens;
  if (!t || !t.refresh_token) return false;
  try {
    const res = await fetch(CONFIG.WORKER_URL + "/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: t.refresh_token }),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) return false;
    store.tokens = data;
    return true;
  } catch {
    return false;
  }
}

/* =========================================================================
 * Twitch Helix API
 * ========================================================================= */
async function helix(path, opts = {}, retried = false) {
  const t = store.tokens;
  if (!t) throw new Error("not logged in");

  const res = await fetch("https://api.twitch.tv/helix/" + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + t.access_token,
      "Client-Id": CONFIG.CLIENT_ID,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });

  if (res.status === 401 && !retried) {
    // Access token expired — refresh once and retry.
    if (await refreshTokens()) return helix(path, opts, true);
    logout();
    setStatus("Session expired — please log in again.", "err");
    throw new Error("unauthorized");
  }
  return res;
}

async function fetchMe() {
  const { data } = await (await helix("users")).json();
  return data && data[0];
}

async function fetchBroadcasterId() {
  const { data } = await (await helix("users?login=" + encodeURIComponent(CONFIG.CHANNEL))).json();
  if (!data || !data[0]) throw new Error("channel not found: " + CONFIG.CHANNEL);
  return data[0].id;
}

async function sendMessage(text) {
  const res = await helix("chat/messages", {
    method: "POST",
    body: JSON.stringify({
      broadcaster_id: state.broadcasterId,
      sender_id: state.me.id,
      message: text,
    }),
  });

  if (res.status === 429) {
    setStatus("Rate limited by Twitch — slow down a moment.", "err");
    return;
  }

  const body = await res.json().catch(() => null);
  const result = body && body.data && body.data[0];

  if (result && result.is_sent) {
    setStatus(`Sent: ${text}`, "ok");
  } else if (result && result.drop_reason) {
    setStatus(`Dropped (${result.drop_reason.message || result.drop_reason.code})`, "err");
  } else {
    setStatus(`Could not send "${text}" (HTTP ${res.status}).`, "err");
  }
}

/* =========================================================================
 * UI
 * ========================================================================= */
function setStatus(msg, kind = "") {
  const el = $("#status");
  el.textContent = msg;
  el.className = "status" + (kind ? " status-" + kind : "");
}

function buildButtons() {
  const wrap = $("#buttons");
  wrap.innerHTML = "";
  for (const cmd of CONFIG.COMMANDS) {
    const b = document.createElement("button");
    b.className = "btn cmd";
    b.textContent = cmd.label;
    b.title = cmd.text;
    b.addEventListener("click", () => onCommand(b, cmd));
    wrap.appendChild(b);
  }
}

async function onCommand(button, cmd) {
  if (!store.tokens) { setStatus("Log in first.", "err"); return; }
  button.disabled = true;
  try {
    await sendMessage(cmd.text);
  } catch (_) {
    /* helix() already surfaced the error */
  } finally {
    setTimeout(() => { button.disabled = false; }, CONFIG.BUTTON_COOLDOWN_MS);
  }
}

function loadEmbeds() {
  const parent = location.hostname || "localhost";
  $("#player").src = `https://player.twitch.tv/?channel=${CONFIG.CHANNEL}&parent=${parent}`;
  $("#chat").src = `https://www.twitch.tv/embed/${CONFIG.CHANNEL}/chat?parent=${parent}&darkpopout`;
}

function render() {
  const loggedIn = !!store.tokens;
  $("#loginBtn").hidden = loggedIn;
  $("#logoutBtn").hidden = !loggedIn;
  const who = $("#whoami");
  who.hidden = !loggedIn;
  who.textContent = state.me ? `@${state.me.display_name || state.me.login}` : "";
  $("#hint").textContent = loggedIn
    ? "Click a button to send that command as you."
    : "Log in to send commands on your own behalf.";
  document.querySelectorAll(".cmd").forEach((b) => (b.disabled = !loggedIn));
}

/* =========================================================================
 * Boot
 * ========================================================================= */
async function init() {
  buildButtons();
  loadEmbeds();
  $("#loginBtn").addEventListener("click", login);
  $("#logoutBtn").addEventListener("click", logout);

  await consumeRedirect();
  render();

  if (store.tokens) {
    try {
      const [me, bid] = await Promise.all([fetchMe(), fetchBroadcasterId()]);
      state.me = me;
      state.broadcasterId = bid;
      render();
      setStatus(`Logged in as @${me.display_name || me.login}. Ready.`, "ok");
    } catch (e) {
      if (e.message !== "unauthorized") setStatus(String(e.message), "err");
    }
  }
}

init();
