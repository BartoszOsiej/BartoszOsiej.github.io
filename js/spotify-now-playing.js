/**
 * spotify-now-playing.js
 * ═══════════════════════════════════════════════════════════════
 * Real-time "Now Playing" Spotify module for bartoszosiej.github.io
 *
 * TWO MODES (auto-detected):
 *   A) JSON mode (default) — polls now-playing.json (same origin),
 *      which .github/workflows/refresh-spotify.yml regenerates every
 *      5 minutes straight from the Spotify Web API. No Discord needed.
 *   B) Lanyard mode — if window.SPOTIFY_DISCORD_ID is set, uses the
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
    // Mode B only — Discord user ID (Lanyard). Empty = JSON mode.
    discordId: (typeof window !== 'undefined' && window.SPOTIFY_DISCORD_ID) || '',
    // Mode A — static JSON published by refresh-spotify.yml
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
        '</div>' +
        '<div class="np-track-info">' +
          '<div class="np-marquee-wrapper">' +
            '<span class="np-marquee">Connecting to audio stream...</span>' +
          '</div>' +
          '<div class="np-artist"></div>' +
        '</div>' +
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

  // ─── UI Update ──────────────────────────────────────────────
  function updateUI(track) {
    if (!container) return;

    const equalizer = container.querySelector('.np-equalizer');
    const marquee = container.querySelector('.np-marquee');
    const artistEl = container.querySelector('.np-artist');
    const fallback = container.querySelector('.np-fallback');
    const trackInfo = container.querySelector('.np-track-info');
    const label = container.querySelector('.np-label');

    if (track && track.title && track.artist) {
      isPlaying = true;
      currentTrack = track;

      container.classList.add('np-playing');
      container.classList.remove('np-idle');

      equalizer.style.display = '';

      marquee.textContent = track.title;
      marquee.classList.add('np-marquee--active');

      artistEl.textContent = track.artist;

      fallback.style.display = 'none';
      trackInfo.style.display = '';

      label.textContent = '[ SYSTEM_AUDIO // ACTIVE ]';
      label.classList.add('np-label--active');

      container.setAttribute('aria-label', 'Now Playing: ' + track.title + ' by ' + track.artist);
    } else {
      isPlaying = false;
      currentTrack = null;

      container.classList.remove('np-playing');
      container.classList.add('np-idle');

      equalizer.style.display = 'none';

      marquee.textContent = '';
      marquee.classList.remove('np-marquee--active');

      artistEl.textContent = '';

      fallback.style.display = '';
      trackInfo.style.display = 'none';

      label.textContent = '[ SYSTEM_AUDIO // SPOTIFY ]';
      label.classList.remove('np-label--active');

      container.setAttribute('aria-label', 'Spotify: No track playing');
    }
  }

  // ─── MODE A: JSON polling (Spotify Web API via GitHub Action) ──
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
      clearInterval(jsonTimer);
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

    if (CONFIG.discordId) {
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
      // ── Mode A: JSON polling (default; no Discord involved) ──
      startJsonPolling();
    }
  }

  // ─── Lazy Load ──────────────────────────────────────────────
  function schedule() {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(init);
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
