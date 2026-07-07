"use strict";

/* =========================================================================
 * CONFIG — edit these two lines, then everything else works.
 * ========================================================================= */
const CONFIG = {
  // Paste the Client ID from https://dev.twitch.tv/console  (Register Your Application)
  CLIENT_ID: "",

  // The channel to embed + send commands into.
  CHANNEL: "quin69",

  // Implicit-flow scopes. user:write:chat lets the user's token post messages.
  SCOPES: "user:write:chat",

  // The command buttons. Edit freely — a "command" is just a chat message.
  COMMANDS: [
    { label: "Lurk",     text: "!lurk" },
    { label: "Uptime",   text: "!uptime" },
    { label: "Socials",  text: "!socials" },
    { label: "Discord",  text: "!discord" },
    { label: "+2",       text: "+2" },
    { label: "-2",       text: "-2" },
  ],

  // Per-button cooldown so a user can't machine-gun the same string
  // (Twitch silently drops identical repeats anyway — this is just UX).
  BUTTON_COOLDOWN_MS: 3000,
};

/* =========================================================================
 * State
 * ========================================================================= */
const state = {
  token: null,        // user access token
  me: null,           // { id, login, display_name }
  broadcasterId: null // quin69's user id
};

const $ = (sel) => document.querySelector(sel);
const redirectUri = () => location.origin + location.pathname;

/* =========================================================================
 * Auth (Implicit grant flow — no backend, no secret)
 * ========================================================================= */
function login() {
  if (!CONFIG.CLIENT_ID) {
    setStatus("Set CONFIG.CLIENT_ID in app.js first (see README).", "err");
    return;
  }
  const params = new URLSearchParams({
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "token",
    scope: CONFIG.SCOPES,
  });
  location.href = "https://id.twitch.tv/oauth2/authorize?" + params.toString();
}

function logout() {
  sessionStorage.removeItem("twitch_token");
  state.token = null;
  state.me = null;
  render();
}

// Pull an access_token (or error) out of the URL fragment after redirect back.
function consumeRedirect() {
  if (!location.hash) return;
  const frag = new URLSearchParams(location.hash.slice(1));
  const err = frag.get("error");
  if (err) {
    setStatus(`Twitch login failed: ${frag.get("error_description") || err}`, "err");
  }
  const token = frag.get("access_token");
  if (token) {
    sessionStorage.setItem("twitch_token", token);
  }
  // Wipe the fragment so the token isn't left sitting in the address bar / history.
  history.replaceState(null, "", redirectUri());
}

/* =========================================================================
 * Twitch Helix API
 * ========================================================================= */
async function helix(path, opts = {}) {
  const res = await fetch("https://api.twitch.tv/helix/" + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + state.token,
      "Client-Id": CONFIG.CLIENT_ID,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    // Token expired or revoked — force a fresh login.
    logout();
    setStatus("Session expired — please log in again.", "err");
    throw new Error("unauthorized");
  }
  return res;
}

async function fetchMe() {
  const res = await helix("users");
  const { data } = await res.json();
  return data && data[0];
}

async function fetchBroadcasterId() {
  const res = await helix("users?login=" + encodeURIComponent(CONFIG.CHANNEL));
  const { data } = await res.json();
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
    // e.g. duplicate message, followers-only mode, slow mode, sub-only…
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
  if (!state.token) { setStatus("Log in first.", "err"); return; }
  button.disabled = true;
  try {
    await sendMessage(cmd.text);
  } catch (_) {
    /* helix() already surfaced the error */
  } finally {
    // Cooldown regardless of outcome.
    setTimeout(() => { button.disabled = false; }, CONFIG.BUTTON_COOLDOWN_MS);
  }
}

function loadEmbeds() {
  const parent = location.hostname || "localhost";
  $("#player").src =
    `https://player.twitch.tv/?channel=${CONFIG.CHANNEL}&parent=${parent}`;
  $("#chat").src =
    `https://www.twitch.tv/embed/${CONFIG.CHANNEL}/chat?parent=${parent}&darkpopout`;
}

function render() {
  const loggedIn = !!state.token;
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
  consumeRedirect();

  $("#loginBtn").addEventListener("click", login);
  $("#logoutBtn").addEventListener("click", logout);

  state.token = sessionStorage.getItem("twitch_token");
  render();

  if (state.token) {
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
