// bo-now-playing — single JSON endpoint for the bo.hartwell-labs.pl widget.
// Merges: Spotify currently-playing → Last.fm scrobbles → Spotify top/recent.
// Replaces the refresh-spotify.yml GH workflow (no more bot commits).
const LASTFM_USER = "thelightgalaxy";
const LASTFM_KEY = "8a0fd44970b496e5199772f6bfe2ad9c";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname !== "/now-playing") {
      return json({ service: "bo-now-playing", ok: true, endpoints: ["/now-playing"] });
    }

    const cache = caches.default;
    const cKey = new Request(url.toString(), { method: "GET", headers: req.headers });
    const hit = await cache.match(cKey);
    if (hit) return hit;

    let state;
    try {
      state = await buildState(env);
    } catch (e) {
      state = { playing: false, error: String(e && e.message || e).slice(0, 160), fetched_at: new Date().toISOString() };
    }

    const res = json(state, 200, { "Cache-Control": "public, max-age=45" });
    ctx.waitUntil(cache.put(cKey, res.clone()));
    return res;
  },
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

async function buildState(env) {
  const now = new Date().toISOString();
  const cid = env.SPOTIFY_CLIENT_ID, csec = env.SPOTIFY_CLIENT_SECRET;
  const rtok = (env.NP_KV && (await env.NP_KV.get("refresh_token"))) || env.SPOTIFY_REFRESH_TOKEN;

  let access = null;
  if (cid && csec && rtok) {
    try {
      const r = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + btoa(cid + ":" + csec),
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rtok, client_id: cid }),
      });
      if (r.ok) {
        const t = await r.json();
        access = t.access_token || null;
        if (t.refresh_token && env.NP_KV) await env.NP_KV.put("refresh_token", t.refresh_token);
      }
    } catch {}
  }

  // 1) Spotify — right now (scope: user-read-currently-playing)
  if (access) {
    const cur = await spotifyGet(access, "https://api.spotify.com/v1/me/player/currently-playing?additional_types=track");
    const item = cur && cur.item;
    if (cur && cur.is_playing && item) {
      return track({
        playing: true,
        title: item.name,
        artist: (item.artists || []).map(a => a.name).join(", "),
        album: item.album && item.album.name,
        artwork: art(item.album),
        url: item.external_urls && item.external_urls.spotify,
      }, now);
    }

    // 2) top tracks — "ON ROTATION" (scope: user-top-read; 403 → skip silently)
    const top = await spotifyGet(access, "https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=5");
    if (top && Array.isArray(top.items) && top.items.length) {
      return {
        mode: "top_tracks",
        tracks: top.items.map(t => ({
          title: t.name,
          artist: (t.artists || []).map(a => a.name).join(", "),
          artwork: art(t.album),
          url: t.external_urls && t.external_urls.spotify,
        })),
        fetched_at: now,
      };
    }
  }

  // 3) Last.fm now-playing (public API key; works with zero Spotify tokens)
  try {
    const lf = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({
      method: "user.getrecenttracks", user: LASTFM_USER, api_key: LASTFM_KEY, format: "json", limit: "1",
    }));
    if (lf.ok) {
      const data = await lf.json();
      let t = (data.recenttracks || {}).track || [];
      t = Array.isArray(t) ? t[0] : t;
      if (t && t["@attr"] && t["@attr"].nowplaying === "true") {
        const img = (t.image || []).slice(-1)[0];
        return track({
          playing: true,
          title: t.name,
          artist: t.artist && t.artist["#text"],
          artwork: img && img["#text"],
          url: t.url || "",
        }, now);
      }
    }
  } catch {}

  return { playing: false, fetched_at: now };
}

async function spotifyGet(access, u) {
  try {
    const r = await fetch(u, { headers: { Authorization: "Bearer " + access } });
    if (r.status === 200) return await r.json();
  } catch {}
  return null;
}

function art(album) {
  return album && album.images && album.images.length ? album.images[album.images.length - 1].url : "";
}

function track(o, now) {
  return Object.assign({ playing: false }, o, { fetched_at: now });
}
