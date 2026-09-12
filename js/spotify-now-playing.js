/**
 * spotify-now-playing.js
 * ═══════════════════════════════════════════════════════════════
 * Real-time "Now Playing" Spotify module for bartoszosiej.github.io
 *
 * THREE MODES (auto-detected, first match wins):
 *   A) Last.fm mode — if window.SPOTIFY_LASTFM_USER is set, polls the
 *      public Last.fm API (CORS-enabled, api key embeds safely) for the
 *      user's now-playing/recent scrobbles. Free Spotify accounts work —
 *      scrobbling is client-side, no Premium Web API needed.
 *   B) JSON mode — polls now-playing.json (same origin), written by the
 *      refresh-spotify.yml workflow (Spotify Web API; needs Premium).
 *   C) Lanyard mode — if window.SPOTIFY_DISCORD_ID is set, uses the
 *      Lanyard WebSocket for real-time Discord presence push.
 *
 * UI: CSS-only equalizer + marquee, Cyber-Noir fallback when idle.
 * Performance budget: <3KB gzipped, 0 layout shifts, 0 main-thread animation.
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ─── Configuration ──────────────────────────────────────────
  const CONFIG = {
    // Mode A — Last.fm (free accounts; set BOTH of these in index.html)
    lastfmUser: (typeof window !== 'undefined' && window.SPOTIFY_LASTFM_USER) || '',
    lastfmKey: (typeof window !== 'undefined' && window.SPOTIFY_LASTFM_KEY) || '',
    // Adaptive polling: fast while music is playing, slow when idle.
    lastfmPollMs: 3000,      // nowplaying → detect track change fast (avg ~1.5s, worst ~4s)
    lastfmIdlePollMs: 15000, // nothing playing → relax
    lastfmErrorPollMs: 45000,// consecutive errors → back off
    // Mode B — Discord user ID (Lanyard). Empty = skip.
    discordId: (typeof window !== 'undefined' && window.SPOTIFY_DISCORD_ID) || '',
    // Mode C — static JSON published by refresh-spotify.yml
    jsonUrl: 'now-playing.json',
    jsonPollMs: 60000,
    // Mode B — Lanyard endpoints
    restUrl: 'https://api.lanyard.rest/v1/users/',
    wsUrl: 'wss://api.lanyard.rest/socket',
    reconnectBaseMs: 1000,
    reconnectMaxMs: 30000,
    heartbeatIntervalMs: 30000,
    // DOM
    containerId: 'now-playing',
  };

  // ─── State ──────────────────────────────────────────────────
  let ws = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let jsonTimer = null;
  let isPlaying = false;
  let currentTrack = null;
  let container = null;
  let lastTitle = null;
  let lastPollState = 'idle'; // 'playing' | 'idle' | 'error'

  // ─── DOM Creation ───────────────────────────────────────────
  function createContainer() {
    if (document.getElementById(CONFIG.containerId)) {
      container = document.getElementById(CONFIG.containerId);
      return;
    }

    container = document.createElement('div');
    container.id = CONFIG.containerId;
    container.className = 'now-playing';
    container.setAttribute('aria-label', 'Now Playing on Spotify');
    container.setAttribute('role', 'status');

    container.innerHTML =
      '<div class="np-label">[ SYSTEM_AUDIO // SPOTIFY ]</div>' +
      '<div class="np-status">' +
        '<div class="np-equalizer" aria-hidden="true">' +
          '<span class="eq-bar"></span>' +
          '<span class="eq-bar"></span>' +
          '<span class="eq-bar"></span>' +
          '<span class="eq-bar"></span>' +
          '<span class="eq-bar"></span>' +
          '<span class="eq-bar"></span>' +
          '<span class="eq-bar"></span>' +
        '</div>' +
        '<div class="np-track-info">' +
          '<div class="np-marquee-wrapper">' +
            '<span class="np-marquee">Connecting to audio stream...</span>' +
          '</div>' +
          '<div class="np-artist"></div>' +
        '</div>' +
        '<img class="np-art-thumb" alt="" referrerpolicy="no-referrer" style="display:none">' +
      '</div>' +
      '<div class="np-fallback" style="display:none;">' +
        '<span class="np-fallback-icon">◉</span>' +
        '<span class="np-fallback-text">AUDIO // SLEEP_MODE</span>' +
      '</div>';

    // Attach to a dedicated rail if the page defines one; otherwise
    // fall back to a fixed bottom mini-player (root page has no rail).
    const rail = document.querySelector('.aegis-nav-rail, .nav-rail');
    if (rail) {
      rail.appendChild(container);
    } else {
      container.classList.add('now-playing--fixed');
      document.body.appendChild(container);
    }
  }

  // ─── Mood engine: track tags → accent color + genre label ───
  // Public track.toptags (api_key only). First regex hit wins.
  const MOODS = [
    [/hip[- ]?hop|\brap\b|trap|drill/, '#c084fc', 'RAP'],
    [/metal|\brock\b|punk|grunge/, '#ef4444', 'ROCK'],
    [/\bpop\b|disco/, '#ec4899', 'POP'],
    [/jazz|blues|soul|funk|r&b|rnb/, '#e3b341', 'JAZZ'],
    [/techno|house|edm|electro|trance|drum.and.bass|\bdnb\b|\bidm\b/, '#22d3ee', 'ELECTRONIC'],
    [/classical|klasyka|piano|orchestr|soundtrack/, '#e8e6e3', 'CINEMATIC'],
    [/indie|alternative|shoegaze|post[- ]rock/, '#22c55e', 'INDIE'],
    [/folk|country|acoustic/, '#a16207', 'FOLK'],
    [/ambient|lo-?fi|chill/, '#7dd3fc', 'AMBIENT'],
  ];
  const MOOD_DEFAULT = { color: '#F15A24', label: 'AUDIO' };

  const MOOD_CACHE_VER = 'v2';
  const MOOD_CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 days

  function moodCacheGet(key) {
    try {
      const c = JSON.parse(localStorage.getItem('np-moods-' + MOOD_CACHE_VER) || '{}');
      const e = c[key];
      if (!e) return null;
      if (Date.now() - e.t > MOOD_CACHE_TTL) return null; // expired
      return e.m;
    } catch (e) { return null; }
  }

  function moodCacheSet(key, value) {
    try {
      const store = 'np-moods-' + MOOD_CACHE_VER;
      const c = JSON.parse(localStorage.getItem(store) || '{}');
      c[key] = { m: value, t: Date.now() };
      // keep it bounded: max 200 entries, drop the oldest
      const keys = Object.keys(c);
      if (keys.length > 200) {
        keys.sort((a, b) => c[a].t - c[b].t).slice(0, keys.length - 200).forEach((k) => delete c[k]);
      }
      localStorage.setItem(store, JSON.stringify(c));
    } catch (e) { /* private mode — no cache, still works */ }
  }

  function moodForTags(tags) {
    for (const m of MOODS) {
      for (const t of tags) {
        if (m[0].test(t)) return { color: m[1], label: m[2] };
      }
    }
    return null;
  }

  let moodKey = null;

  const MOOD_TIMEOUT_MS = 3500;

  function fetchWithTimeout(url, ms) {
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), ms);
    const p = fetch(url, Object.assign({ cache: 'no-store' }, ctrl ? { signal: ctrl.signal } : {}));
    return p.finally(() => clearTimeout(timer));
  }

  async function fetchTags(method, params) {
    const q = new URLSearchParams(Object.assign({ method: method, api_key: CONFIG.lastfmKey, format: 'json' }, params));
    q.set('_', Date.now());
    const res = await fetchWithTimeout('https://ws.audioscrobbler.com/2.0/?' + q, MOOD_TIMEOUT_MS);
    if (!res.ok) return [];
    const data = await res.json();
    return ((data && data.toptags && data.toptags.tag) || []).map((t) => (t.name || '').toLowerCase());
  }

  function applyMoodStyles(mood, track) {
    if (!container) return;
    // Apply only if this track is still the current one (no race overwrites)
    if (currentTrack && track && currentTrack.title !== track.title) return;
    container.style.setProperty('--np-accent', mood.color);
    container.style.setProperty('--np-accent-soft', mood.color + '66');
    container.style.setProperty('--np-accent-faint', mood.color + '12');
    const label = container.querySelector('.np-label');
    if (label) {
      if (mood.label && mood.label !== 'AUDIO') {
        label.dataset.genre = mood.label;
      } else {
        delete label.dataset.genre; // neutral mood → no stale genre text
      }
      // Re-render the label with the genre when it's in plain ACTIVE state
      if (isPlaying && label.dataset.genre &&
          (label.textContent === '[ SYSTEM_AUDIO // ACTIVE ]' ||
           label.textContent.indexOf('SYSTEM_AUDIO // ' + label.dataset.genre) !== -1)) {
        label.textContent = '[ SYSTEM_AUDIO // ' + label.dataset.genre + ' ]';
      }
    }
  }

  const moodAttempts = {}; // key → retries so far (retry: a failed tag fetch
                           // must not lock the track into the neutral color)
  const MOOD_MAX_ATTEMPTS = 4;

  async function applyMood(track) {
    if (!container || !track || !track.title) return;
    const key = ((track.artist || '') + '|' + track.title).toLowerCase();
    if (key === moodKey) return; // already resolved for this track

    // 1) Instant hit from cache → zero-delay color switch on track change
    const cached = moodCacheGet(key);
    if (cached) {
      moodKey = key;
      applyMoodStyles(cached, track);
      return;
    }

    // 2) Resolve tags, guarded end-to-end: a hanging or failed request can
    //    never leave the previous track's genre color frozen on screen.
    try {
      // Chain: track tags → artist tags (Polish/obscure tracks often lack
      // track-level tags) → neutral default. Each step has a hard timeout.
      let tags = [];
      try {
        tags = await fetchTags('track.getTopTags', { artist: track.artist || '', track: track.title });
      } catch (e) { tags = []; }
      if (!tags.length) {
        try {
          tags = await fetchTags('artist.getTopTags', { artist: track.artist || '' });
        } catch (e) { tags = []; }
      }
      moodKey = key; // resolved (one way or another) for this track
      const mood = moodForTags(tags) || MOOD_DEFAULT;
      if (tags.length) {
        moodCacheSet(key, mood); // cache only real resolutions
        delete moodAttempts[key];
      }
      console.debug('[spotify-np] mood ' + mood.label + ' ' + mood.color +
        ' (tags: ' + (tags.slice(0, 4).join(', ') || 'none') + ')');
      applyMoodStyles(mood, track);
    } catch (err) {
      // Total failure → neutral color NOW so a stale genre color never sticks
      applyMoodStyles(MOOD_DEFAULT, track);
      // ...and allow a retry on a later poll (up to MOOD_MAX_ATTEMPTS)
      const n = (moodAttempts[key] || 0) + 1;
      moodAttempts[key] = n;
      if (n < MOOD_MAX_ATTEMPTS) moodKey = null;
      console.debug('[spotify-np] mood fetch failed, retry ' + n + '/' + MOOD_MAX_ATTEMPTS);
    }
  }

  // ─── Artwork: a cover is ALWAYS shown, never a hole ────────
  // Chain: last.fm image → iTunes Search API (CORS-open, no key, good
  // for obscure/Polish releases) → generated letter avatar (data URI).
  const ART_TIMEOUT_MS = 3500;
  const artInflight = {}; // per-track guard against duplicate hunts

  function letterAvatar(title, artist) {
    // Deterministic hue from artist+title: same track → same color, always.
    const seed = ((artist || '') + '|' + (title || '?')).toLowerCase();
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    const letter = (title || '?').trim().charAt(0).toUpperCase() || '?';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">' +
      '<rect width="96" height="96" fill="hsl(' + hue + ',45%,22%)"/>' +
      '<text x="48" y="63" font-family="system-ui,sans-serif" font-size="42" ' +
      'font-weight="700" text-anchor="middle" fill="hsl(' + hue + ',80%,72%)">' +
      letter + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  async function fetchArtworkFromItunes(artist, title) {
    try {
      const q = new URLSearchParams({ term: ((artist || '') + ' ' + (title || '')).trim(), entity: 'song', limit: '1' });
      const res = await fetchWithTimeout('https://itunes.apple.com/search?' + q, ART_TIMEOUT_MS);
      if (!res.ok) return null;
      const data = await res.json();
      const url = data && data.results && data.results[0] && data.results[0].artworkUrl100;
      return url ? url.replace(/100x100/, '200x200') : null;
    } catch (e) {
      return null;
    }
  }

  function setArtwork(el, src, alt) {
    if (!el) return;
    el.onerror = () => {
      // Even the provided URL failed → guaranteed letter avatar
      el.onerror = null;
      el.src = letterAvatar(currentTrack && currentTrack.title, currentTrack && currentTrack.artist);
    };
    el.alt = alt || 'cover art';
    el.src = src;
    el.style.display = '';
  }

  async function resolveArtwork(track) {
    const key = ((track.artist || '') + '|' + (track.title || '')).toLowerCase();
    if (artInflight[key]) return;
    artInflight[key] = true;
    let url = null;
    if (track.artist) url = await fetchArtworkFromItunes(track.artist, track.title);
    // Apply only if this track is still current AND still missing a cover
    const thumb = container && container.querySelector('.np-art-thumb');
    if (url && thumb && thumb.dataset.nofallback === key &&
        currentTrack && currentTrack.title === track.title) {
      delete thumb.dataset.nofallback;
      setArtwork(thumb, url, track.album ? track.album + ' — cover' : 'cover art');
    }
    delete artInflight[key];
  }

  // ─── UI Update ──────────────────────────────────────────────
  // Fit-or-scroll: static text when it fits (short titles stay fully
  // visible instead of drifting away); seamless duplicated marquee
  // (translate -50% = exactly one chunk) only when it overflows.
  function setMarquee(marquee, wrapper, text) {
    marquee.classList.remove('np-marquee--loop');
    wrapper.classList.remove('is-looping');
    marquee.textContent = text;
    if (marquee.scrollWidth > wrapper.clientWidth + 2) {
      const chunk = text + '\u00A0\u00A0\u2022\u00A0\u00A0';
      const c1 = document.createElement('span');
      c1.className = 'np-m-chunk';
      c1.textContent = chunk;
      marquee.textContent = '';
      marquee.appendChild(c1);
      marquee.appendChild(c1.cloneNode(true));
      marquee.classList.add('np-marquee--loop');
      wrapper.classList.add('is-looping');
    }
  }

  function updateUI(track) {
    if (!container) return;

    // Song-change detection → flash + slide animation
    const changed = !!(track && track.title && track.title !== lastTitle);
    lastTitle = (track && track.title) || null;
    if (changed) {
      container.classList.remove('np-track-change');
      void container.offsetWidth; // force reflow so the animation retriggers
      container.classList.add('np-track-change');
      // Auto-remove after the flash so lingering styles can't win the cascade
      clearTimeout(updateUI._flashTimer);
      updateUI._flashTimer = setTimeout(() => container.classList.remove('np-track-change'), 1500);
    }

    const equalizer = container.querySelector('.np-equalizer');
    const marquee = container.querySelector('.np-marquee');
    const marqueeWrapper = container.querySelector('.np-marquee-wrapper');
    const artistEl = container.querySelector('.np-artist');
    const fallback = container.querySelector('.np-fallback');
    const trackInfo = container.querySelector('.np-track-info');
    const label = container.querySelector('.np-label');
    if (changed && label) {
      // New track: drop the previous genre immediately (cached moods re-apply
      // synchronously in applyMood; uncached resolve within ~3.5s) so the OLD
      // genre never bleeds onto the new track's label.
      delete label.dataset.genre;
    }

    if (track && track.title && track.artist) {
      isPlaying = true;
      currentTrack = track;

      container.classList.add('np-playing');
      container.classList.remove('np-idle');

      // Last.fm knows the difference between "scrobbling now" and
      // "last scrobbled" — freeze the equalizer for the latter (honest UI).
      if (track.live === false) {
        container.classList.add('np-paused');
        label.textContent = '[ AUDIO // LAST_SCROBBLED ]';
      } else {
        container.classList.remove('np-paused');
      }

      equalizer.style.display = '';

      setMarquee(marquee, marqueeWrapper, track.title);

      artistEl.textContent = track.artist;

      const thumb = container.querySelector('.np-art-thumb');
      if (track.artwork) {
        delete thumb.dataset.nofallback;
        setArtwork(thumb, track.artwork, track.album ? track.album + ' — cover' : 'cover art');
      } else {
        // No image from last.fm (common for obscure tracks) → hunt a
        // fallback cover; until then show the letter avatar, never a hole.
        const trackKey = ((track.artist || '') + '|' + track.title).toLowerCase();
        thumb.dataset.nofallback = trackKey;
        setArtwork(thumb, letterAvatar(track.title, track.artist), 'cover art');
        resolveArtwork(track);
      }

      fallback.style.display = 'none';
      trackInfo.style.display = '';

      if (track.live !== false) {
        // Genre-aware label: applyMood early-returns for an already-resolved
        // track, so this is the place that must carry the genre forward —
        // otherwise every poll resets the label to plain ACTIVE.
        label.textContent = label.dataset.genre
          ? '[ SYSTEM_AUDIO // ' + label.dataset.genre + ' ]'
          : '[ SYSTEM_AUDIO // ACTIVE ]';
      }
      label.classList.add('np-label--active');

      container.classList.toggle('np-clickable', !!track.url);

      container.setAttribute('aria-label', 'Now Playing: ' + track.title + ' by ' + track.artist);
    } else {
      isPlaying = false;
      currentTrack = null;

      container.classList.remove('np-playing');
      container.classList.add('np-idle');
      if (label) delete label.dataset.genre;

      equalizer.style.display = 'none';

      marquee.textContent = '';
      marquee.classList.remove('np-marquee--loop');

      artistEl.textContent = '';

      fallback.style.display = '';
      trackInfo.style.display = 'none';

      const thumb = container.querySelector('.np-art-thumb');
      if (thumb) thumb.style.display = 'none';

      label.textContent = '[ SYSTEM_AUDIO // SPOTIFY ]';
      label.classList.remove('np-label--active');
      container.classList.remove('np-track-change');

      container.setAttribute('aria-label', 'Spotify: No track playing');
    }
  }

  // ─── MODE A: Last.fm (public API, CORS-open, works with free Spotify) ──
  function scheduleNextPoll() {
    const delay = lastPollState === 'playing' ? CONFIG.lastfmPollMs
                : lastPollState === 'error' ? CONFIG.lastfmErrorPollMs
                : CONFIG.lastfmIdlePollMs;
    jsonTimer = setTimeout(pollLastfm, delay);
  }

  async function pollLastfm() {
    if (jsonTimer) { clearTimeout(jsonTimer); jsonTimer = null; }
    if (document.hidden) {
      // Tab in background: do nothing, re-check in 30s (visibilitychange
      // fires an instant poll the moment the user comes back).
      jsonTimer = setTimeout(pollLastfm, 30000);
      return;
    }
    try {
      const q = new URLSearchParams({
        method: 'user.getrecenttracks',
        user: CONFIG.lastfmUser,
        api_key: CONFIG.lastfmKey,
        format: 'json',
        limit: '1',
        extended: '1',
      });
      q.set('_', Date.now()); // cache-buster: last.fm CDN caches identical URLs
      const res = await fetch('https://ws.audioscrobbler.com/2.0/?' + q, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const t = data && data.recenttracks && data.recenttracks.track;
      const track = Array.isArray(t) ? t[0] : t;
      if (track && track.name) {
        const nowplaying = track['@attr'] && track['@attr'].nowplaying === 'true';
        lastPollState = nowplaying ? 'playing' : 'idle';
        const images = track.image || [];
        const art = images.length ? images[images.length - 1]['#text'] : null;
      updateUI({
        title: track.name,
        artist: (track.artist && (track.artist.name || track.artist['#text'])) || '',
        album: track.album && track.album['#text'] || '',
        artwork: art || null,
        url: track.url || null,
        live: nowplaying,
      });
      applyMood({
        title: track.name,
        artist: (track.artist && (track.artist.name || track.artist['#text'])) || '',
        live: nowplaying,
      });
      } else {
        lastPollState = 'idle';
        showFallback();
      }
    } catch (err) {
      // network/API hiccup — back off, retry on next tick
      lastPollState = 'error';
    }
    scheduleNextPoll();
  }

  function startLastfmPolling() {
    pollLastfm();
  }

  // ─── MODE C: JSON polling (Spotify Web API via GitHub Action) ──
  async function pollJson() {
    try {
      const res = await fetch(CONFIG.jsonUrl + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data && data.playing && data.title) {
        updateUI({
          title: data.title,
          artist: data.artist || '',
          album: data.album || '',
          artwork: data.artwork || null,
          url: data.url || null,
        });
      } else {
        showFallback();
      }
    } catch (err) {
      // 404 = secrets not configured yet, or transient network issue.
      // Stay idle silently; the next poll will retry.
    }
  }

  function startJsonPolling() {
    pollJson();
    jsonTimer = setInterval(pollJson, CONFIG.jsonPollMs);
  }

  function stopJsonPolling() {
    if (jsonTimer) {
      clearTimeout(jsonTimer);
      jsonTimer = null;
    }
  }

  // ─── MODE B: Lanyard REST (initial fetch) ───────────────────
  async function fetchInitialState() {
    try {
      const res = await fetch(CONFIG.restUrl + CONFIG.discordId);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      handlePresence(json && json.data);
    } catch (err) {
      console.warn('[spotify-np] REST fetch failed:', err.message);
      showFallback();
    }
  }

  // ─── MODE B: Lanyard WebSocket (real-time) ──────────────────
  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }

    try {
      ws = new WebSocket(CONFIG.wsUrl);
    } catch (err) {
      console.warn('[spotify-np] WebSocket creation failed:', err.message);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log('[spotify-np] WebSocket connected');
      reconnectAttempts = 0;
      // NOTE: don't send Initialize here — wait for the Hello frame (op 1)
      // which carries the authoritative heartbeat_interval.
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.op) {
          case 1: { // Hello — server tells us the heartbeat interval
            const interval = (msg.d && msg.d.heartbeat_interval) || CONFIG.heartbeatIntervalMs;
            CONFIG.heartbeatIntervalMs = interval;
            startHeartbeat();
            ws.send(JSON.stringify({
              op: 2,
              d: { subscribe_to_id: CONFIG.discordId },
            }));
            break;
          }
          case 0: // Dispatch — INIT state / PRESENCE_UPDATE
            handlePresence(msg.d);
            break;
          case 4: // Reconnect request
            if (ws) ws.close(4000, 'Reconnect requested');
            break;
          default:
            break;
        }
      } catch (err) {
        console.warn('[spotify-np] Message parse error:', err);
      }
    };

    ws.onclose = (event) => {
      console.log('[spotify-np] WebSocket closed: ' + event.code + ' ' + event.reason);
      stopHeartbeat();
      scheduleReconnect();
    };

    ws.onerror = () => {
      console.warn('[spotify-np] WebSocket error');
      // onclose fires right after this
    };
  }

  // ─── Presence Handler (Mode B) ──────────────────────────────
  function handlePresence(data) {
    if (!data) {
      showFallback();
      return;
    }

    const spotify = data.spotify;

    if (spotify && spotify.track) {
      updateUI({
        title: spotify.track,
        artist: spotify.artist || spotify.artists || '',
        album: spotify.album || '',
        artwork: spotify.album_art_url || null,
        songId: spotify.song_id || null,
        timestamps: spotify.timestamps || null,
      });
    } else {
      showFallback();
    }
  }

  function showFallback() {
    updateUI(null);
  }

  // ─── Heartbeat (Mode B; Lanyard: client responds with op 3) ─
  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, CONFIG.heartbeatIntervalMs);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function sendHeartbeat() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: 3 }));
    }
  }

  // ─── Reconnection (Mode B) ──────────────────────────────────
  function scheduleReconnect() {
    if (reconnectTimer) return;

    const delay = Math.min(
      CONFIG.reconnectBaseMs * Math.pow(2, reconnectAttempts),
      CONFIG.reconnectMaxMs
    );
    reconnectAttempts++;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWebSocket();
    }, delay);
  }

  // ─── Initialization ─────────────────────────────────────────
  function init() {
    createContainer();
    // diagnostics: confirms which build the browser is actually running
    console.info('[spotify-np] build 20260912d — mood engine + artwork fallback active');

    // Click-to-open the currently playing track (last.fm page)
    container.addEventListener('click', () => {
      const u = currentTrack && currentTrack.url;
      if (u) window.open(u, '_blank', 'noopener');
    });

    if (CONFIG.lastfmUser && CONFIG.lastfmKey) {
      // ── Mode A: Last.fm — free Spotify accounts, no Premium needed ──
      startLastfmPolling();
    } else if (CONFIG.discordId) {
      // ── Mode B: Lanyard real-time ──
      // ── Mode B: Lanyard real-time ──
      fetchInitialState();
      connectWebSocket();

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          if (ws) ws.close(1000, 'Tab hidden');
          stopHeartbeat();
        } else {
          connectWebSocket();
        }
      });
    } else {
      // ── Mode C: JSON polling (no external config present) ──
      startJsonPolling();
    }

    // Refresh instantly when the user comes back to the tab
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (CONFIG.lastfmUser && CONFIG.lastfmKey) {
        pollLastfm();
      } else if (!CONFIG.discordId) {
        pollJson();
      }
    });
  }

  // ─── Lazy Load ──────────────────────────────────────────────
  function schedule() {
    if (typeof requestIdleCallback === 'function') {
      // timeout guard: rIC alone can stall for ages in background tabs
      requestIdleCallback(init, { timeout: 2000 });
    } else {
      setTimeout(init, 0);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }

  // ─── Public API ─────────────────────────────────────────────
  window.SpotifyNowPlaying = {
    getTrack: () => currentTrack,
    isPlaying: () => isPlaying,
    reconnect: () => connectWebSocket(),
    destroy: () => {
      stopJsonPolling();
      if (ws) ws.close(1000, 'Destroyed');
      stopHeartbeat();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (container) container.remove();
    },
  };
})();
