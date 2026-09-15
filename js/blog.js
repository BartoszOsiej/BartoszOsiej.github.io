(function(){
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* ── BLOG ENGINE: real votes (Abacus API) + reads + HOT/NEW + j/k/v ── */
  var posts = Array.prototype.slice.call(document.querySelectorAll('.post[data-slug]'));
  if (posts.length) {
    var NS = 'bartoszosiej.github.io';
    var LS = 'bz-votes';
    var store = {};
    try { store = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { store = {}; }
    var online = navigator.onLine !== false;
    // BZ_API: workers.dev URL injected at deploy time (data-bz-api on body) — empty = Abacus-only mode
    var BZ_API = document.body.getAttribute('data-bz-api') || '';
    var bzToken = null;
    try { bzToken = localStorage.getItem('bz-token'); } catch (e) {}
    function bz(path, opts) {
      opts = opts || {};
      opts.headers = Object.assign({}, opts.headers || {},
        bzToken ? { authorization: 'Bearer ' + bzToken } : {});
      return fetch(BZ_API + path, opts).then(function (r) {
        if (r.status === 401 && bzToken) { try { localStorage.removeItem('bz-token'); } catch (e) {} bzToken = null; }
        return r;
      });
    }

    function saveStore(){ try { localStorage.setItem(LS, JSON.stringify(store)); } catch (e) {} }
    function abacus(path){
      return fetch('https://abacus.jasoncameron.dev' + path, { method: 'GET', cache: 'no-store' })
        .then(function(r){ if (!r.ok) throw new Error('abacus ' + r.status); return r.json(); })
        .then(function(d){ if (typeof d.value !== 'number') throw new Error('abacus shape'); return d.value; });
    }

    var sortState = { mode: 'hot', up: {}, dn: {}, reads: {}, els: {} };
    var inflight = {};   // slug → vote op in progress; kills the click race
    posts.forEach(function (p) {
      var slug = p.dataset.slug;
      sortState.els[slug] = {
        root: p,
        score: p.querySelector('[data-score]'),
        up: p.querySelector('[data-up]'),
        down: p.querySelector('[data-down]'),
        reads: p.querySelector('[data-reads]')
      };
    });

    function paintVotes(slug){
      var e = sortState.els[slug];
      var mine = store[slug] || 0;
      // server net (up − dn) already includes my persisted vote — every local
      // transition was synced as increments; offline/fresh = my local state only
      var hasServer = online && typeof sortState.up[slug] === 'number';
      var net = hasServer ? (sortState.up[slug] - (sortState.dn[slug] || 0)) : mine;
      e.score.textContent = String(net);
      e.up.setAttribute('aria-pressed', mine === 1 ? 'true' : 'false');
      e.down.setAttribute('aria-pressed', mine === -1 ? 'true' : 'false');
      e.up.classList.toggle('on', mine === 1);
      e.down.classList.toggle('on', mine === -1);
      e.up.disabled = !online || !!inflight[slug];
      e.down.disabled = !online || !!inflight[slug];
    }

    function flash(el, txt){
      if (reduce) return;
      var r = el.getBoundingClientRect();
      var f = document.createElement('span');
      f.className = 'flash';
      f.textContent = txt;
      f.style.left = (r.left + r.width / 2 - 8) + 'px';
      f.style.top = (r.top - 6) + 'px';
      document.body.appendChild(f);
      setTimeout(function(){ f.remove(); }, 700);
    }

    function bump(el){
      if (reduce) return;
      el.classList.add('bump');
      setTimeout(function(){ el.classList.remove('bump'); }, 140);
    }

    // votes go direct to Abacus (free tier); client-side budget keeps us inside 30req/10s
    function hitCounter(key){ return abacus('/hit/' + NS + '/' + key); }

    function vote(slug, dir){
      var e = sortState.els[slug];
      if (inflight[slug]) return;                    // one op at a time per post
      if (!online) { flash(e.score, 'OFFLINE'); return; }
      var mine = store[slug] || 0;
      var target = (mine === dir) ? 0 : dir;         // same arrow again → retract
      var d = target - mine;
      if (!d) return;
      if (BZ_API) {
        // server-enforced path: API is authoritative (1 net vote per voter, KV-backed)
        inflight[slug] = true; e.up.disabled = true; e.down.disabled = true;
        store[slug] = target; saveStore();
        bz('/vote/' + slug, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: target }) })
          .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
          .then(function (res) {
            if (res.status !== 200) throw new Error((res.j && res.j.error) || 'vote failed');
            sortState.up[slug] = res.j.u; sortState.dn[slug] = res.j.dn;
            paintVotes(slug); paintSignals(); bump(e.score);
            flash(e.score, d > 0 ? '+1' : '−1');
          })
          .catch(function () {
            store[slug] = mine; saveStore();
            flash(e.score, 'SYNC_ERR');
          })
          .then(function () { inflight[slug] = false; paintVotes(slug); });
        return;
      }
      if (!budgetOk(Math.abs(d))) { flash(e.score, 'SLOW_DOWN'); return; }
      // optimistic: apply locally now, reconcile when the network answers —
      // rapid clicks can never re-read a stale state because of the inflight lock
      store[slug] = target;
      saveStore();
      if (typeof sortState.up[slug] === 'number') sortState.up[slug] += d;
      paintVotes(slug);
      flash(e.score, d > 0 ? '+' + d : String(d).replace('-', '−'));
      bump(e.score);
      inflight[slug] = true;
      e.up.disabled = true;
      e.down.disabled = true;
      var ops = [];
      for (var i = 0; i < d;  i++) ops.push(hitCounter('vote_' + slug + '_up'));
      for (var j = 0; j < -d; j++) ops.push(hitCounter('vote_' + slug + '_dn'));
      Promise.all(ops)
        .then(function () {
          spend(Math.abs(d));
          paintSignals();
        })
        .catch(function () {
          // roll the optimistic apply back — the server did not accept it
          store[slug] = mine;
          saveStore();
          if (typeof sortState.up[slug] === 'number') sortState.up[slug] -= d;
          flash(e.score, 'SYNC_ERR');
        })
        .then(function () {
          inflight[slug] = false;
          paintVotes(slug);   // repaint + re-enable per online/inflight state
        });
    }

    posts.forEach(function (p) {
      var slug = p.dataset.slug;
      var e = sortState.els[slug];
      e.up.addEventListener('click', function(){ vote(slug, 1); });
      e.down.addEventListener('click', function(){ vote(slug, -1); });

      // reads: one count per visitor per post, fired on first click-through
      var link = p.querySelector('.ptlink');
      if (link) link.addEventListener('click', function () {
        if (store['read_' + slug] || !online) return;
        store['read_' + slug] = 1;
        saveStore();
        if (BZ_API) {
          bz('/read/' + slug, { method: 'POST' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              if (j && typeof j.reads === 'number') {
                sortState.reads[slug] = j.reads;
                var r = e.reads; if (r) r.textContent = 'READS ' + j.reads;
                paintSignals();
              }
            }).catch(function () {});
          return;
        }
        abacus('/hit/' + NS + '/reads_' + slug)
          .then(function (v) {
            sortState.reads[slug] = v;
            var r = e.reads;
            if (r) r.textContent = 'READS ' + v;
            paintSignals();
          })
          .catch(function () {});
      });
    });

    // mirror status: read real state from blog/mirror.json (updated by crier CI)
    (function () {
      var CK = 'bz-mirror', cached = null;
      try { cached = JSON.parse(sessionStorage.getItem(CK) || 'null'); } catch (e) {}
      function render(mirror) {
        var display = { devto: 'DEV_TO', mastodon: 'MASTODON', hashnode: 'HASHNODE', bluesky: 'BLUESKY' };
        posts.forEach(function (p) {
          var el = p.querySelector('[data-mirror]'); if (!el) return;
          var slug = p.dataset.slug, entry = (mirror.posts || {})[slug];
          if (!entry) { el.innerHTML = 'MIRROR ▸ no data'; return; }
          var parts = [];
          Object.keys(display).forEach(function (k) {
            var v = entry[k], label = display[k];
            if (v && v.url) parts.push('<a class="ok" href="' + v.url + '" target="_blank" rel="noopener">' + label + ': LIVE ↗</a>');
            else if (v && v.error) parts.push('<span class="err">' + label + ': FAIL</span>');
            else parts.push(label + ': —');
          });
          el.innerHTML = 'MIRROR ▸ ' + parts.join(' · ');
        });
      }
      if (cached && Date.now() - cached.t < 3600000) { render(cached.data); return; }
      fetch('/blog/mirror.json?' + Date.now())
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d) return;
          try { sessionStorage.setItem(CK, JSON.stringify({ t: Date.now(), data: d })); } catch (e) {}
          render(d);
        }).catch(function () {});
    })();

    // ship meter: real commit history per post from the GitHub API (1h sessionStorage cache)
    posts.forEach(function (p) {
      var slug = p.dataset.slug;
      var el = p.querySelector('[data-ship]');
      if (!el) return;
      var ck = 'bz-ship-' + slug, c = null;
      try { c = JSON.parse(sessionStorage.getItem(ck) || 'null'); } catch (e) {}
      if (c && Date.now() - c.t < 3600000) { el.innerHTML = c.v; return; }
      fetch('https://api.github.com/repos/BartoszOsiej/BartoszOsiej.github.io/commits?per_page=100&path=' + encodeURIComponent('content/' + slug + '.md'))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (list) {
          if (!list || !list.length) return;
          var v = 'SHIP_METER ▸ <b>COMMITS: ' + list.length + '</b> · FIRST ' + list[list.length - 1].commit.author.date.slice(0, 10) + ' · LAST ' + list[0].commit.author.date.slice(0, 10);
          el.innerHTML = v;
          try { sessionStorage.setItem(ck, JSON.stringify({ t: Date.now(), v: v })); } catch (e) {}
        }).catch(function () {});
    });

    // bootstrap: pull real counters; LIVE lights up only after sync
    var netmode = document.querySelector('[data-netmode]');
    var synced = false;
    function setMode(){
      if (!netmode) return;
      netmode.innerHTML = !online ? 'OFFLINE // <b>LOCAL_ONLY</b>'
        : synced ? 'LIVE // <b>REAL VOTES</b>'
        : 'SYNCING // VOTE_STATE';
    }
    setMode();
    // instant honest paint from local state (my vote) before server numbers land
    posts.forEach(function (p) { paintVotes(p.dataset.slug); });
    if (BZ_API) {
      // worker backend: authoritative counters + discussion counts in one call
      bz('/votes').then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
        if (!v) { setMode(); return; }
        posts.forEach(function (p) {
          var s = p.dataset.slug, d = v[s];
          if (!d) return;
          sortState.up[s] = d.u; sortState.dn[s] = d.dn; sortState.reads[s] = d.reads;
          var r = sortState.els[s].reads; if (r) r.textContent = 'READS ' + d.reads;
          if (d.disc) { var m = p.querySelector('[data-disc]'); if (m) m.textContent = d.disc + '_COMMENTS'; }
        });
        synced = true;
        posts.forEach(function (p) { paintVotes(p.dataset.slug); });
        resort(); paintSignals(); setMode();
      }).catch(function () { setMode(); });
    } else {
      var pending = posts.map(function (p) {
      var slug = p.dataset.slug;
      return abacus('/get/' + NS + '/vote_' + slug + '_up')
        .then(function (v) { sortState.up[slug] = v; })
        .catch(function () {})
        .then(function () {
          return abacus('/get/' + NS + '/vote_' + slug + '_dn')
            .then(function (v) { sortState.dn[slug] = v; })
            .catch(function () {});
        })
        .then(function () {
          return abacus('/get/' + NS + '/reads_' + slug)
            .then(function (v) {
              sortState.reads[slug] = v;
              var r = sortState.els[slug].reads;
              if (r) r.textContent = 'READS ' + v;
            })
            .catch(function () {});
        });
    });
    // client-side rate guard: Abacus free tier = 30 req/10s; bootstrap uses ~7,
    // so voting may spend at most 8 ops per 10s window before SLOW_DOWN
    var opTimes = [];
    function budgetOk(ops) {
      var now = Date.now();
      opTimes = opTimes.filter(function (t) { return now - t < 10000; });
      return opTimes.length + ops <= 8;
    }
    function spend(ops) { for (var i = 0; i < ops; i++) opTimes.push(Date.now()); }

    Promise.all(pending).then(function () {
      synced = true;
      posts.forEach(function (p) { paintVotes(p.dataset.slug); });
      resort();
      paintSignals();
      setMode();
    });
    }

    // aggregate signal total from numbers already in memory — zero extra requests
    function paintSignals(){
      if (!netmode) return;
      var total = 0;
      posts.forEach(function (p) {
        var s = p.dataset.slug;
        total += (sortState.up[s] || 0) + (sortState.dn[s] || 0) + (sortState.reads[s] || 0);
      });
      if (!synced) return;
      netmode.innerHTML = online
        ? 'LIVE // <b>REAL VOTES</b> · SIGNALS: ' + total
        : 'OFFLINE // <b>LOCAL_ONLY</b>';
    }

    // HOT/NEW: gravity sort like reddit's default
    function epoch(iso){ return Date.parse(iso + 'T12:00:00Z') / 3600000; }
    function resort(){
      var now = Date.now() / 3600000;
      var list = posts.slice().sort(function (a, b) {
        if (sortState.mode === 'new') {
          return b.dataset.date.localeCompare(a.dataset.date);
        }
        var sa = (sortState.up[a.dataset.slug] || 0) - (sortState.dn[a.dataset.slug] || 0) + (sortState.reads[a.dataset.slug] || 0);
        var sb = (sortState.up[b.dataset.slug] || 0) - (sortState.dn[b.dataset.slug] || 0) + (sortState.reads[b.dataset.slug] || 0);
        var ha = (sa + 1) / Math.pow(now - epoch(a.dataset.date) + 2, 1.5);
        var hb = (sb + 1) / Math.pow(now - epoch(b.dataset.date) + 2, 1.5);
        return hb - ha;
      });
      var wrap = document.getElementById('postlist');
      list.forEach(function (p) { wrap.appendChild(p); });
    }
    document.querySelectorAll('.sortbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        sortState.mode = b.dataset.sort;
        document.querySelectorAll('.sortbtn').forEach(function (x) {
          x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        });
        resort();
      });
    });

    // keyboard: j/k move, v votes (reddit muscle memory, minus the arrows)
    document.addEventListener('keydown', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      var t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      var k = ev.key.toLowerCase();
      if (k !== 'j' && k !== 'k' && k !== 'v') return;
      var boxes = posts.map(function (p) { return p.getBoundingClientRect(); });
      var mid = window.innerHeight / 2;
      var cur = -1, best = 1e9;
      boxes.forEach(function (r, i) {
        var d = Math.abs(r.top + r.height / 2 - mid);
        if (d < best) { best = d; cur = i; }
      });
      if (cur < 0) return;
      if (k === 'v') {
        // toggle upvote: vote() retracts when dir === current state
        vote(posts[cur].dataset.slug, 1);
      } else {
        var next = Math.min(Math.max(cur + (k === 'j' ? 1 : -1), 0), posts.length - 1);
        var el = sortState.els[posts[next].dataset.slug].root;
        el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      }
    });

    window.addEventListener('online',  function(){ online = true;  setMode(); posts.forEach(function(p){ paintVotes(p.dataset.slug); }); });
    window.addEventListener('offline', function(){ online = false; setMode(); });
  }

  /* ── ACCOUNTS: login/register/logout (active only when BZ_API is injected) ── */
  (function () {
    var bar = document.querySelector('[data-authbar]');
    if (!bar) return;
    var api = document.body.getAttribute('data-bz-api') || '';
    if (!api) { bar.hidden = true; return; }
    function req(path, body) {
      var t = null; try { t = localStorage.getItem('bz-token'); } catch (e) {}
      return fetch(api + path, {
        method: body ? 'POST' : 'GET',
        headers: Object.assign({ 'content-type': 'application/json' }, t ? { authorization: 'Bearer ' + t } : {}),
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); });
    }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function paint(name, role) {
      var st = document.getElementById('auth-status');
      if (!st) return;
      var rb = bar.querySelector('[data-regen]');
      if (name) {
        st.innerHTML = '// ACCOUNT: <b>' + esc(name) + '</b>' + (role === 'admin' ? ' · ADMIN' : '') + ' — you can discuss under every post';
        var btn = bar.querySelector('[data-auth-open]');
        if (btn) btn.textContent = 'LOGOUT';
        if (rb) rb.hidden = false;
      } else {
        st.textContent = '// ACCOUNT: ANON — voting is open, discussions need an account';
        var btn2 = bar.querySelector('[data-auth-open]');
        if (btn2) btn2.textContent = 'LOGIN/REGISTER';
        if (rb) rb.hidden = true;
      }
    }
    var t0 = null; try { t0 = localStorage.getItem('bz-token'); } catch (e) {}
    if (t0) req('/auth/me').then(function (r) {
      if (r.status === 200) paint(r.j.username, r.j.role);
      else { try { localStorage.removeItem('bz-token'); } catch (e) {} }
    }).catch(function () {});
    bar.querySelector('[data-auth-open]').addEventListener('click', function () {
      var t = null; try { t = localStorage.getItem('bz-token'); } catch (e) {}
      if (t) {  // button acts as LOGOUT when logged in
        try { localStorage.removeItem('bz-token'); } catch (e) {}
        paint(null);
        return;
      }
      var box = document.getElementById('authbox');
      if (box) box.hidden = !box.hidden;
    });
    var form = document.getElementById('auth-form');
    if (form) form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var mode = ev.submitter && ev.submitter.getAttribute('data-auth-mode') || 'login';
      var u = document.getElementById('auth-user').value.trim();
      var p = document.getElementById('auth-pass').value;
      var msg = document.getElementById('auth-msg');
      if (msg) msg.textContent = '// ' + (mode === 'register' ? 'registering' : 'logging in') + '…';
      fetch(api + '/auth/' + mode, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
      }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
        .then(function (res) {
          if (res.status === 200 && res.j.token) {
            try { localStorage.setItem('bz-token', res.j.token); } catch (e) {}
            paint(res.j.username, res.j.role);
            var box = document.getElementById('authbox'); if (box) box.hidden = true;
            if (res.j.recovery_codes && res.j.recovery_codes.length) renderCodes(res.j.recovery_codes);
          } else if (msg) {
            msg.textContent = '// ERR: ' + (res.j && res.j.error || 'failed');
          }
        })
        .catch(function () { if (msg) msg.textContent = '// ERR: network'; });
    });
    function renderCodes(codes) {
      var old = document.getElementById('codesbox'); if (old) old.remove();
      var box = document.createElement('div');
      box.id = 'codesbox'; box.className = 'authbox'; box.style.borderColor = '#F15A24';
      box.innerHTML =
        '<div class="authrow" style="margin:0 0 8px"><span class="lab text-[11px]" style="color:#F15A24">// RECOVERY_CODES — save them NOW, each works once, shown only this once</span></div>' +
        '<pre class="codespre" id="codespre"></pre>' +
        '<div class="authrow" style="margin:8px 0 0"><button type="button" class="sortbtn" data-codes-copy>COPY</button><button type="button" class="sortbtn" data-codes-done>DONE_SAVED</button></div>';
      box.querySelector('#codespre').textContent = codes.join('\n');
      var anchor = document.getElementById('authbox');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
      box.querySelector('[data-codes-copy]').addEventListener('click', function () {
        var t = codes.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () {}, function () {});
        else { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }
        this.textContent = 'COPIED';
      });
      box.querySelector('[data-codes-done]').addEventListener('click', function () { box.remove(); });
    }
    var rf = document.getElementById('reset-form');
    var forgot = bar.querySelector('[data-forgot]');
    if (forgot && rf) forgot.addEventListener('click', function () {
      rf.hidden = !rf.hidden;
      if (!rf.hidden) rf.querySelector('input').focus();
    });
    var regenBtn = bar.querySelector('[data-regen]');
    if (regenBtn) regenBtn.addEventListener('click', function () {
      if (!confirm('generate 6 NEW recovery codes? old codes stay valid until used — save the new set now')) return;
      req('/auth/recovery/regen', {}).then(function (r) {
        if (r.status === 200 && r.j.recovery_codes) renderCodes(r.j.recovery_codes);
      }).catch(function () {});
    });
    if (rf) rf.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var m = document.getElementById('auth-msg');
      if (m) m.textContent = '// resetting…';
      fetch(api + '/auth/reset', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: document.getElementById('reset-user').value.trim(), recovery_code: document.getElementById('reset-code').value.trim(), new_password: document.getElementById('reset-pass').value })
      }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
        .then(function (res) {
          if (res.status === 200) {
            try { localStorage.removeItem('bz-token'); } catch (e) {}
            paint(null);
            rf.hidden = true;
            if (m) m.textContent = '// ' + (res.j.msg || 'password reset — log in with the new password');
          } else if (m) m.textContent = '// ERR: ' + (res.j && res.j.error || 'failed');
        })
        .catch(function () { if (m) m.textContent = '// ERR: network'; });
    });
  })();

  // site sessions: real visits, one hit per tab session (sessionStorage guard)
  var sessEl = document.querySelector('[data-sessions]');
  if (sessEl && navigator.onLine !== false && !sessionStorage.getItem('bz-session-counted')) {
    fetch('https://abacus.jasoncameron.dev/hit/bartoszosiej.github.io/site_sessions', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && typeof d.value === 'number') {
          sessionStorage.setItem('bz-session-counted', '1');
          sessEl.textContent = String(d.value);
        }
      }).catch(function () {});
  } else if (sessEl) {
    fetch('https://abacus.jasoncameron.dev/get/bartoszosiej.github.io/site_sessions', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && typeof d.value === 'number') sessEl.textContent = String(d.value); })
      .catch(function () {});
  }

  // mobile nav (hamburger)
})();
