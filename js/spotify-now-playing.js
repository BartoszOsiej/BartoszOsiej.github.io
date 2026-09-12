/**
 * spotify-now-playing.js
 * ═══════════════════════════════════════════════════════════════
 * Real-time "Now Playing" Spotify module for bartoszosiej.github.io
 *
 * Architecture:
 *   - Lanyard WebSocket API (real-time, no polling)
 *   - CSS-only equalizer animation (zero JS animation frames)
 *   - CSS text marquee for track title
 *   - Cyber-Noir fallback when offline/silent
 *   - Lazy-loaded, deferred, no Lighthouse impact
 *
 * API: https://api.lanyard.rest/
 * Requires: Discord ID (window.SPOTIFY_DISCORD_ID, set in index.html)
 *           + Spotify connected to Discord + user inside the Lanyard
 *           Discord guild (discord.gg/lanyard) so Lanyard can observe it.
 *
 * Performance budget: <3KB gzipped, 0 layout shifts, 0 main-thread animation
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ─── Configuration ──────────────────────────────────────────
  const CONFIG = {
    // Discord user ID — set in index.html: window.SPOTIFY_DISCORD_ID = "123...";
    discordId: (typeof window !== 'undefined' && window.SPOTIFY_DISCORD_ID) || '',
    // Lanyard endpoints
    restUrl: 'https://api.lanyard.rest/v1/users/',
    wsUrl: 'wss://api.lanyard.rest/socket',
    // Reconnection (exponential backoff)
    reconnectBaseMs: 1000,
    reconnectMaxMs: 30000,
    // Heartbeat fallback interval (real value arrives in Lanyard Hello frame)
    heartbeatIntervalMs: 30000,
    // DOM
    containerId: 'now-playing',
  };

  // ─── State ──────────────────────────────────────────────────
  let ws = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
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
      // ── Playing state ──
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
      // ── Idle/sleep state ──
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

  // ─── Lanyard REST (initial fetch) ───────────────────────────
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

  // ─── Lanyard WebSocket (real-time) ──────────────────────────
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
            // Initialize: subscribe to Bartosz's presence
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

  // ─── Presence Handler ───────────────────────────────────────
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

  // ─── Heartbeat (Lanyard: client responds with op 3) ─────────
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

  // ─── Reconnection ───────────────────────────────────────────
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

    if (!CONFIG.discordId) {
      console.warn('[spotify-np] No Discord ID set (window.SPOTIFY_DISCORD_ID). Showing idle state.');
      showFallback();
      return;
    }

    // Initial REST fetch (fast, non-blocking)
    fetchInitialState();

    // WebSocket for real-time updates
    connectWebSocket();

    // Pause the socket when the tab is hidden, resume when visible
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (ws) ws.close(1000, 'Tab hidden');
        stopHeartbeat();
      } else {
        connectWebSocket();
      }
    });
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
      if (ws) ws.close(1000, 'Destroyed');
      stopHeartbeat();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (container) container.remove();
    },
  };
})();
