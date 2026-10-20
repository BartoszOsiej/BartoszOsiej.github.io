// bo-now-playing — Last.fm-only JSON endpoint for the bo.hartwell-labs.pl widget.
// No Spotify credentials needed: reads PUBLIC Last.fm data with the public API key
// (the same key already embedded in the page source). Nothing to hand over.
//
// Priority:
//   1) recent scrobble with nowplaying="true"          → NOW PLAYING
//   2) recent scrobble younger than 5 min              → NOW PLAYING (grace window)
//   3) top tracks, last 7 days                         → ON ROTATION (mode: top_tracks)
//   4) nothing                                          → idle { playing: false }
const LASTFM_USER = "thelightgalaxy";
const LASTFM_KEY = "8a0fd44970b496e5199772f6bfe2ad9c";
const RECENT_WINDOW_MS = 5 * 60 * 1000;

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
      return json({ service: "bo-now-playing", ok: true, source: "last.fm", endpoints: ["/now-playing"] });
    }

    const cache = caches.default;
    const cKey = new Request(url.toString(), { method: "GET", headers: req.headers });
    const hit = await cache.match(cKey);
    if (hit) return hit;

    let state;
    try {
      state = await buildState();
    } catch (e) {
      state = { playing: false, error: String((e && e.message) || e).slice(0, 160), fetched_at: new Date().toISOString() };
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

async function lastfm(method, params = {}) {
  try {
    const qs = new URLSearchParams({ method, user: LASTFM_USER, api_key: LASTFM_KEY, format: "json", ...params });
    const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + qs);
    if (r.ok) return await r.json();
  } catch {}
  return null;
}

async function buildState() {
  const now = Date.now();

  // 1) latest scrobble
  const recent = await lastfm("user.getrecenttracks", { limit: "2" });
  let t = (recent && recent.recenttracks && recent.recenttracks.track) || [];
  t = Array.isArray(t) ? t[0] : t;

  if (t && t.name) {
    const isLive = t["@attr"] && t["@attr"].nowplaying === "true";
    const uts = t.date && t.date.uts ? Number(t.date.uts) * 1000 : 0;
    if (isLive || (uts && now - uts < RECENT_WINDOW_MS)) {
      return {
        playing: true,
        title: t.name,
        artist: artistOf(t.artist),
        artwork: imgOf(t.image),
        url: t.url || "",
        source: "last.fm",
        fetched_at: new Date(now).toISOString(),
      };
    }
  }

  // 2) on rotation — top tracks of the week
  const top = await lastfm("user.gettoptracks", { limit: "5", period: "7day" });
  let items = (top && top.toptracks && top.toptracks.track) || [];
  items = Array.isArray(items) ? items : [items];
  if (items.length) {
    return {
      mode: "top_tracks",
      tracks: items.map(x => ({
        title: x.name,
        artist: artistOf(x.artist),
        artwork: imgOf(x.image),
        url: x.url || "",
      })),
      source: "last.fm",
      fetched_at: new Date(now).toISOString(),
    };
  }

  return { playing: false, source: "last.fm", fetched_at: new Date(now).toISOString() };
}

function artistOf(a) {
  if (!a) return "";
  if (typeof a === "string") return a;
  return a["#text"] || a.name || "";
}

function imgOf(images) {
  const last = (images || []).slice(-1)[0];
  return (last && last["#text"]) || "";
}
