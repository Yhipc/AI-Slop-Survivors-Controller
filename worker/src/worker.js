/**
 * Twitch OAuth token-exchange proxy (Cloudflare Worker).
 *
 * Holds the client secret so the browser never sees it. The frontend sends a
 * single-use `code` (or a `refresh_token`); this Worker trades it with Twitch
 * for an access token and returns the token in the JSON body — never in a URL.
 *
 * Env (set in wrangler.toml [vars] + `wrangler secret put`):
 *   TWITCH_CLIENT_ID      public client id
 *   TWITCH_CLIENT_SECRET  SECRET — set via `wrangler secret put TWITCH_CLIENT_SECRET`
 *   ALLOWED_ORIGIN        exact origin allowed to call this, e.g. https://yhipc.github.io
 */

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(env, origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Lock the endpoint to your site so it can't be used as an open proxy.
    if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: "forbidden_origin" }, 403, cors);
    }

    const { pathname } = new URL(request.url);
    try {
      if (request.method === "POST" && pathname === "/exchange") {
        return await exchange(request, env, cors);
      }
      if (request.method === "POST" && pathname === "/refresh") {
        return await refresh(request, env, cors);
      }
      return json({ error: "not_found" }, 404, cors);
    } catch (e) {
      return json({ error: "server_error", detail: String(e) }, 500, cors);
    }
  },
};

async function exchange(request, env, cors) {
  const { code, redirect_uri } = await request.json().catch(() => ({}));
  if (!code || !redirect_uri) return json({ error: "missing_params" }, 400, cors);

  return twitchToken(env, cors, {
    grant_type: "authorization_code",
    code,
    redirect_uri,
  });
}

async function refresh(request, env, cors) {
  const { refresh_token } = await request.json().catch(() => ({}));
  if (!refresh_token) return json({ error: "missing_params" }, 400, cors);

  return twitchToken(env, cors, {
    grant_type: "refresh_token",
    refresh_token,
  });
}

async function twitchToken(env, cors, params) {
  const body = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    ...params,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: "twitch_error", detail: data }, res.status, cors);

  // Return only what the frontend needs — no secret, no extra fields.
  return json(
    {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      scope: data.scope,
    },
    200,
    cors
  );
}

function corsHeaders(env, origin) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
