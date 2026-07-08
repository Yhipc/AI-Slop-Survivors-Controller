"use strict";

/* =========================================================================
 * CONFIG — edit these, then everything else works.
 * ========================================================================= */
const CONFIG = {
  // Public Client ID from https://dev.twitch.tv/console (safe to expose).
  CLIENT_ID: "ismfx1nxhhn4a65mg2zvnv63r88267",

  // Your deployed Cloudflare Worker base URL (no trailing slash).
  // e.g. "https://q69-twitch-auth.yourname.workers.dev"
  WORKER_URL: "https://q69-twitch-auth.ciphyishere.workers.dev",

  // Channel to embed + send commands into.
  CHANNEL: "quin69",

  // Scopes requested from the viewer. Keep minimal — this caps the blast radius.
  SCOPES: "user:write:chat",

  // The hotkey frame image (transparent PNG), fitted across the player bottom.
  FRAME_SRC: "Q69ASShotkeys.png",

  // Clickable hotspots over each tile. x/y/w/h are % of the frame image, so
  // they scale with it. Coordinates come from calibrate.html.
  COMMANDS: [
    // top row
    { text: "!join",             x: 15,   y: 21.5, w: 7,    h: 23 },
    { text: "!spawn",            x: 23,   y: 21.5, w: 7,    h: 23 },
    { text: "!flee",             x: 30.5, y: 21.5, w: 7,    h: 23 },
    { text: "!aoe",              x: 38.5, y: 21.5, w: 7,    h: 23 },
    { text: "!dmg",              x: 46,   y: 21.5, w: 7,    h: 23 },
    { text: "!hp",               x: 54,   y: 21.5, w: 7,    h: 23 },
    { text: "!speed",            x: 62,   y: 21.5, w: 7,    h: 23 },
    { text: "!boost",            x: 69.5, y: 21.5, w: 7,    h: 23 },
    { text: "!explode",          x: 77.5, y: 21.5, w: 7,    h: 23 },
    // bottom row
    { text: "!invulnerability",  x: 15,   y: 48,   w: 11,   h: 28.3 },
    { text: "!fart",             x: 26,   y: 48,   w: 8,    h: 28.3 },
    { text: "!evolveKevin",      x: 34,   y: 48,   w: 11.5, h: 28.3 },
    { text: "!thorns",           x: 45.5, y: 48,   w: 8,    h: 28.3 },
    { text: "!evolvesuccubus",   x: 53.5, y: 48,   w: 12.5, h: 28.3 },
    { text: "!succ",             x: 66,   y: 48,   w: 8,    h: 28.3 },
    { text: "!evolvewoodlandjoe",x: 74,   y: 48,   w: 11,   h: 28.3 },
  ],

  // Per-tile cooldown lives in styles.css as --cooldown-s (default 30).
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

// Size the stream window so it spans only the tile band of the frame and its
// bottom sits at the top of the hotkeys (dragons flank it; page bg around it).
function layoutStream() {
  const left = document.querySelector(".left");
  const inner = document.querySelector(".hud-inner");
  const player = $("#player");
  if (!left || !inner || !player) return;
  const fr = inner.getBoundingClientRect();
  if (!fr.width) return;
  const lr = left.getBoundingClientRect();
  const cs = getComputedStyle(document.documentElement);
  const TL = parseFloat(cs.getPropertyValue("--tile-left")) || 0.15;
  const TR = parseFloat(cs.getPropertyValue("--tile-right")) || 0.85;
  const TT = parseFloat(cs.getPropertyValue("--tile-top")) || 0.18;
  const fx = fr.left - lr.left, fy = fr.top - lr.top;
  player.style.left = fx + TL * fr.width + "px";
  player.style.top = "0px";
  player.style.width = (TR - TL) * fr.width + "px";
  player.style.height = Math.max(0, fy + TT * fr.height) + "px";
}

function buildHotspots() {
  const frame = $("#hudFrame");
  frame.addEventListener("load", layoutStream);
  frame.src = CONFIG.FRAME_SRC;
  const wrap = $("#hotspots");
  wrap.innerHTML = "";
  for (const cmd of CONFIG.COMMANDS) {
    const b = document.createElement("button");
    b.className = "hotspot";
    b.dataset.cmd = cmd.text;
    b.title = cmd.text;
    b.setAttribute("aria-label", cmd.text);
    b.style.left = cmd.x + "%";
    b.style.top = cmd.y + "%";
    b.style.width = cmd.w + "%";
    b.style.height = cmd.h + "%";
    b.addEventListener("click", () => onCommand(b, cmd));
    wrap.appendChild(b);
  }
}

// Put a tile on a radial cooldown: unclickable + sweep + seconds countdown.
function startCooldown(button) {
  const secs = parseInt(
    getComputedStyle(document.documentElement).getPropertyValue("--cooldown-s")
  ) || 30;
  button.style.setProperty("--cd-dur", secs + "s");
  button.classList.add("cooling");
  button.disabled = true;
  let left = secs;
  button.dataset.cd = left;
  const iv = setInterval(() => {
    if (--left <= 0) {
      clearInterval(iv);
      button.classList.remove("cooling");
      button.disabled = false;
      delete button.dataset.cd;
    } else {
      button.dataset.cd = left;
    }
  }, 1000);
}

async function onCommand(button, cmd) {
  // Not logged in yet? A click starts the Twitch login instead of doing nothing.
  if (!store.tokens) {
    setStatus("Opening Twitch login…");
    login();
    return;
  }
  startCooldown(button);            // 30s cooldown begins the moment it's used
  try {
    await sendMessage(cmd.text);
  } catch (_) {
    /* helix() already surfaced the error */
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
  // Hotspots stay clickable at all times; a click while logged out triggers
  // login (see onCommand). Just reflect state in the tooltip.
  document.querySelectorAll(".hotspot").forEach((b) => {
    b.title = loggedIn ? b.dataset.cmd : b.dataset.cmd + " — log in to send";
  });
}

/* =========================================================================
 * Boot
 * ========================================================================= */
async function init() {
  const params = new URLSearchParams(location.search);
  // ?cal=1 outlines the hotspots so you can eyeball alignment on the frame.
  if (params.has("cal")) document.body.classList.add("cal");
  buildHotspots();
  // ?cddemo previews the cooldown visuals without needing to log in.
  if (params.has("cddemo")) {
    document.querySelectorAll(".hotspot").forEach((b, i) => { if (i % 3 === 0) startCooldown(b); });
  }
  loadEmbeds();
  $("#loginBtn").addEventListener("click", login);
  $("#logoutBtn").addEventListener("click", logout);

  // Keep the stream window sized to the tile band on any layout change.
  layoutStream();
  window.addEventListener("resize", layoutStream);
  new ResizeObserver(layoutStream).observe(document.querySelector(".left"));

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
