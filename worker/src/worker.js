/* bz-blog worker — accounts, hard vote guard, karma, discussions, feedback, terminal API
 * ============================================================================
 * Free-tier Cloudflare Workers + KV. No raw IPs ever stored (salted hash only).
 *
 * KV data model (binding: BZ_KV)
 *   user:<name>            {hash,salt,created,role}          PBKDF2-SHA256 100k
 *   sess:<token>           {u,role}                          TTL 30d
 *   votes:<slug>           {u,dn,reads}                      counters
 *   vstate:<slug>:<voter>  {d,t}                             voter = u:<name> | ip:<hash16>
 *   rd:<slug>:<voter>      1                                 TTL 24h (read dedupe)
 *   karma:<slug>           [[ymd,score],...]                 cap 180 days
 *   rec:<name>:<6hex>      sha256(name:code)                 recovery codes, TTL 365d
 *   disc:<slug>            [{id,u,t,body,iph}]               cap 500
 *   reg:<iph> log:<iph> fb:<iph>                        rate counters
 *   idx                    {t, data}                         origin index cache
 */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
};
const TXT_HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  'access-control-allow-origin': '*',
};
const DAY = 86400;

const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), { status, headers: JSON_HEADERS });
const text = (str, status = 200) => new Response(str, { status, headers: TXT_HEADERS });
const enc = new TextEncoder();

/* ── crypto helpers ────────────────────────────────────────────────────── */
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function pbkdf2(password, salt, iters = 100000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: iters }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const tok = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');

/* ── kv helpers ────────────────────────────────────────────────────────── */
const kvGet = (env, k, type) => env.BZ_KV.get(k, type);
const kvPut = (env, k, v, ttl) => env.BZ_KV.put(k, typeof v === 'string' ? v : JSON.stringify(v), ttl ? { expirationTtl: ttl } : undefined);

/* ── recovery codes (hashed at rest, shown exactly once) ───────────────── */
async function genRecoveryCodes(env, name, n) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const raw = [...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, '0')).join('');
    const h = await sha256hex(name + ':' + raw);
    let k = 'rec:' + name + ':' + h.slice(0, 6);
    if (await kvGet(env, k, 'text')) k = 'rec:' + name + ':' + h.slice(6, 12);
    if (await kvGet(env, k, 'text')) continue; // astronomically unlikely; skip rather than double-store
    await kvPut(env, k, h, 365 * DAY);
    codes.push(raw);
  }
  return codes;
}
async function revokeSessions(env, name) {
  let cursor = '';
  do {
    const page = await env.BZ_KV.list({ prefix: 'sess:', cursor });
    for (const key of page.keys) {
      const s = await env.BZ_KV.get(key.name, 'json');
      if (s && s.u === name) await env.BZ_KV.delete(key.name);
    }
    cursor = page.list_complete ? '' : page.cursor;
  } while (cursor);
}

/* ── auth ──────────────────────────────────────────────────────────────── */
async function userFromReq(env, req) {
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  const sess = await kvGet(env, 'sess:' + t, 'json');
  if (!sess) return null;
  return { name: sess.u, role: sess.role || 'user', token: t };
}
async function voterKey(env, req, user) {
  if (user) return 'u:' + user.name;
  const ip = req.headers.get('cf-connecting-ip') || '0.0.0.0';
  const pepper = env.IP_PEPPER || 'dev-pepper';
  return 'ip:' + (await sha256hex(ip + ':' + pepper)).slice(0, 16);
}

/* ── rate limit (fixed window counters, no raw IP stored) ─────────────── */
async function rateOk(env, req, bucket, limit, ttl) {
  const ip = req.headers.get('cf-connecting-ip') || '0.0.0.0';
  const k = bucket + ':' + (await sha256hex(ip + ':' + (env.IP_PEPPER || 'dev'))).slice(0, 16);
  const n = Number((await kvGet(env, k, 'text')) || 0);
  if (n >= limit) return false;
  await kvPut(env, k, String(n + 1), ttl);
  return true;
}

/* ── origin content ────────────────────────────────────────────────────── */
async function getIndex(env) {
  const cached = await kvGet(env, 'idx:v2', 'json');
  if (cached && Date.now() - cached.t < 600000) return cached.data;
  const origin = env.ORIGIN || 'https://bartoszosiej.github.io';
  const r = await fetch(origin + '/blog/index.json', { cf: { cacheTtl: 300 } });
  if (!r.ok) throw new Error('origin index ' + r.status);
  const data = await r.json();
  const list = Array.isArray(data) ? data : (data.posts || []);
  if (!list.length) throw new Error('origin index empty');
  /* merge gated writing samples (same slug/counters machinery, /writing/ list) */
  try {
    const w = await fetch(origin + '/writing/index.json', { cf: { cacheTtl: 300 } });
    if (w.ok) {
      const wd = await w.json();
      const ws = Array.isArray(wd) ? wd : (wd.posts || []);
      list.unshift(...ws);
    }
  } catch (e) { /* writing section optional — blog keeps working */ }
  await kvPut(env, 'idx:v2', { t: Date.now(), data: list }, 600);
  return list;
}

/* ── counters ──────────────────────────────────────────────────────────── */
async function getCounts(env, slug) {
  return (await kvGet(env, 'votes:' + slug, 'json')) || { u: 0, dn: 0, reads: 0 };
}
async function putCounts(env, slug, c) { await kvPut(env, 'votes:' + slug, c); }

/* ═════════════════════════════════ router ══════════════════════════════ */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS });

      /* ---- accounts ---- */
      if (p === '/auth/register' && req.method === 'POST') {
        if (!(await rateOk(env, req, 'reg', 10, DAY))) return json({ error: 'registration limit reached, try tomorrow' }, 429);
        const b = await req.json().catch(() => ({}));
        const name = String(b.username || '');
        if (!/^[a-zA-Z0-9_]{3,24}$/.test(name)) return json({ error: 'username: 3-24 chars, a-z0-9_' }, 400);
        if (String(b.password || '').length < 8) return json({ error: 'password: min 8 chars' }, 400);
        if (await kvGet(env, 'user:' + name, 'json')) return json({ error: 'username taken' }, 409);
        const salt = tok().slice(0, 24);
        const role = name === (env.ADMIN_USER || 'bartoszosiej') ? 'admin' : 'user';
        await kvPut(env, 'user:' + name, { hash: await pbkdf2(b.password, salt), salt, created: new Date().toISOString(), role });
        const codes = await genRecoveryCodes(env, name, 6);
        const t = tok();
        await kvPut(env, 'sess:' + t, { u: name, role }, 30 * DAY);
        return json({ ok: true, token: t, username: name, role, recovery_codes: codes });
      }
      if (p === '/auth/login' && req.method === 'POST') {
        if (!(await rateOk(env, req, 'log', 10, 600))) return json({ error: 'too many attempts, cool down' }, 429);
        const b = await req.json().catch(() => ({}));
        const name = String(b.username || '');
        const u = await kvGet(env, 'user:' + name, 'json');
        if (u && safeEq(await pbkdf2(String(b.password || ''), u.salt), u.hash)) {
          const t = tok();
          await kvPut(env, 'sess:' + t, { u: name, role: u.role }, 30 * DAY);
          return json({ ok: true, token: t, username: name, role: u.role });
        }
        return json({ error: 'invalid credentials' }, 401);
      }
      if (p === '/auth/me' && req.method === 'GET') {
        const user = await userFromReq(env, req);
        if (!user) return json({ error: 'unauthorized' }, 401);
        return json({ username: user.name, role: user.role });
      }
      if (p === '/auth/password' && req.method === 'POST') {
        const user = await userFromReq(env, req);
        if (!user) return json({ error: 'unauthorized' }, 401);
        if (!(await rateOk(env, req, 'pw', 5, 3600))) return json({ error: 'too many attempts, cool down' }, 429);
        const b = await req.json().catch(() => ({}));
        const row = await kvGet(env, 'user:' + user.name, 'json');
        if (!row || !safeEq(await pbkdf2(String(b.old_password || ''), row.salt), row.hash))
          return json({ error: 'old password incorrect' }, 403);
        if (String(b.new_password || '').length < 8) return json({ error: 'new password: min 8 chars' }, 400);
        row.hash = await pbkdf2(b.new_password, row.salt);
        await kvPut(env, 'user:' + user.name, row);
        await revokeSessions(env, user.name);
        const t = tok();
        await kvPut(env, 'sess:' + t, { u: user.name, role: row.role }, 30 * DAY);
        return json({ ok: true, token: t });
      }

      /* ---- password reset via recovery code (identity = possession of code) ---- */
      if (p === '/auth/reset' && req.method === 'POST') {
        if (!(await rateOk(env, req, 'rst', 5, 3600))) return json({ error: 'too many attempts, cool down' }, 429);
        const b = await req.json().catch(() => ({}));
        const name = String(b.username || '');
        const code = String(b.recovery_code || '').toLowerCase().replace(/[^0-9a-f]/g, '');
        const np = String(b.new_password || '');
        if (!/^[a-zA-Z0-9_]{3,24}$/.test(name)) return json({ error: 'bad username' }, 400);
        if (np.length < 8) return json({ error: 'new password: min 8 chars' }, 400);
        if (code.length !== 20) return json({ error: 'invalid recovery code' }, 401);
        const u = await kvGet(env, 'user:' + name, 'json');
        if (!u) return json({ error: 'invalid recovery code' }, 401);
        const h = await sha256hex(name + ':' + code);
        for (const off of [0, 6]) {
          const k = 'rec:' + name + ':' + h.slice(off, off + 6);
          if (await kvGet(env, k, 'text')) {
            await env.BZ_KV.delete(k);
            u.hash = await pbkdf2(np, u.salt);
            await kvPut(env, 'user:' + name, u);
            await revokeSessions(env, name);
            return json({ ok: true, msg: 'password changed — all previous sessions revoked, log in again' });
          }
        }
        return json({ error: 'invalid recovery code' }, 401);
      }
      if (p === '/auth/recovery/regen' && req.method === 'POST') {
        const user = await userFromReq(env, req);
        if (!user) return json({ error: 'unauthorized' }, 401);
        const codes = await genRecoveryCodes(env, user.name, 6);
        return json({ ok: true, recovery_codes: codes });
      }

      /* ---- writing samples (gated portfolio at /writing/; independent of /blog/) ----
       * Frontend: fetch /api/writing/auth-check → { authenticated } → locked view if false.
       * Full article bodies are ONLY served here, after session check. */
      if (p === '/api/writing/auth-check' && req.method === 'GET') {
        const user = await userFromReq(env, req);
        return json({ authenticated: !!user, username: user ? user.name : null });
      }
      const wm = p.match(/^\/api\/writing\/sample\/([a-z0-9-]+)$/);
      if (wm && req.method === 'GET') {
        const user = await userFromReq(env, req);
        if (!user) return json({ error: 'login required — full articles are for authenticated readers' }, 401);
        if (!(await rateOk(env, req, 'ws', 120, 3600))) return json({ error: 'slow down' }, 429);
        /* source order: KV override `ws:<slug>` (private, upload via wrangler kv put)
         * → raw.githubusercontent (public repo — see gate limitation note in
         *   content/writing-samples/index.md). GitHub Pages renders the .md URL as
         *   the stub HTML page, so origin fetch is useless for markdown bodies. */
        let raw = await kvGet(env, 'ws:' + wm[1], 'text');
        if (!raw) {
          const r = await fetch('https://raw.githubusercontent.com/BartoszOsiej/BartoszOsiej.github.io/main/content/writing-samples/' + wm[1] + '.md', { cf: { cacheTtl: 300 } });
          if (!r.ok) return json({ error: 'no such sample' }, 404);
          raw = await r.text();
        }
        const fmm = raw.match(/^---\n([\s\S]*?)\n---\n/);
        if (!fmm) return json({ error: 'malformed sample' }, 500);
        const fm = {};
        for (const line of fmm[1].split('\n')) {
          const ci = line.indexOf(':');
          if (ci < 1) continue;
          const k = line.slice(0, ci).trim();
          let v = line.slice(ci + 1).trim();
          if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          else v = v.replace(/^["']|["']$/g, '');
          fm[k] = v;
        }
        if (String(fm.published).toLowerCase() !== 'true')
          return json({ error: 'sample not cleared for reading yet (client approval pending)' }, 403);
        return json({ ok: true, article: {
          slug: wm[1],
          title: fm.title || wm[1],
          client: fm.client || '',
          date: fm.date || '',
          tags: Array.isArray(fm.tags) ? fm.tags : [],
          canonical_url: fm.canonical_url || '',
          body: raw.slice(fmm[0].length),
        }});
      }
      if (p === '/admin/unlock' && req.method === 'POST') {
        const user = await userFromReq(env, req);
        if (!user || user.role !== 'admin') return json({ error: 'admin only' }, 403);
        const b = await req.json().catch(() => ({}));
        const name = String(b.username || '');
        if (!/^[a-zA-Z0-9_]{3,24}$/.test(name)) return json({ error: 'bad username' }, 400);
        const u = await kvGet(env, 'user:' + name, 'json');
        if (!u) return json({ error: 'no such user' }, 404);
        await revokeSessions(env, name);
        await env.BZ_KV.delete('user:' + name);
        return json({ ok: true, msg: 'account deleted — username is free for re-registration with fresh codes' });
      }

      /* ---- votes (server-enforced: one net vote per voter, exact retract/flip) ---- */
      if (p === '/votes' && req.method === 'GET') {
        const idx = await getIndex(env);
        const out = {};
        for (const post of idx) {
          const c = await getCounts(env, post.slug);
          c.disc = ((await kvGet(env, 'disc:' + post.slug, 'json')) || []).length;
          out[post.slug] = c;
        }
        return json(out);
      }
      let m = p.match(/^\/vote\/([a-z0-9-]+)$/);
      if (m && req.method === 'POST') {
        const slug = m[1];
        if (!(await getIndex(env)).find(x => x.slug === slug)) return json({ error: 'unknown post' }, 404);
        const user = await userFromReq(env, req);
        const vk = await voterKey(env, req, user);
        const b = await req.json().catch(() => ({}));
        let dir = Number(b.dir);
        if (![1, 0, -1].includes(dir)) return json({ error: 'dir ∈ {1,0,-1}' }, 400);
        if (dir !== 0 && !user && !(await rateOk(env, req, 'vt', 20, 600))) return json({ error: 'slow down' }, 429);
        const sk = `vstate:${slug}:${vk}`;
        const prev = (await kvGet(env, sk, 'json')) || { d: 0 };
        const delta = dir - (prev.d || 0);
        const c = await getCounts(env, slug);
        c.u += delta > 0 ? delta : 0;
        c.dn += delta < 0 ? -delta : 0;
        await putCounts(env, slug, c);
        await kvPut(env, sk, { d: dir, t: Date.now() }, 365 * DAY);
        return json({ ok: true, mine: dir, u: c.u, dn: c.dn, net: c.u - c.dn });
      }
      m = p.match(/^\/read\/([a-z0-9-]+)$/);
      if (m && req.method === 'POST') {
        const slug = m[1];
        const vk = await voterKey(env, req, await userFromReq(env, req));
        const rk = `rd:${slug}:${vk}`;
        if (await kvGet(env, rk, 'text')) return json({ ok: true, deduped: true });
        const c = await getCounts(env, slug);
        c.reads += 1;
        await putCounts(env, slug, c);
        await kvPut(env, rk, '1', DAY);
        return json({ ok: true, reads: c.reads });
      }

      /* ---- karma (cron-built series) ---- */
      m = p.match(/^\/karma\/([a-z0-9-]+)$/);
      if (m && req.method === 'GET') {
        const slug = m[1];
        const series = (await kvGet(env, 'karma:' + slug, 'json')) || [];
        const today = new Date().toISOString().slice(0, 10);
        const cur = series.length ? series[series.length - 1][1] : 0;
        const yst = series.length > 1 ? series[series.length - 2][1] : cur;
        return json({ slug, series, today, score: cur, delta24h: cur - yst });
      }

      /* ---- discussions (accounts required; author or admin may delete) ---- */
      m = p.match(/^\/disc\/([a-z0-9-]+)$/);
      if (m && req.method === 'GET') {
        const list = (await kvGet(env, 'disc:' + m[1], 'json')) || [];
        return json({ slug: m[1], count: list.length, comments: list });
      }
      if (m && req.method === 'POST') {
        const user = await userFromReq(env, req);
        if (!user) return json({ error: 'login required to discuss' }, 401);
        if (!(await rateOk(env, req, 'cm', 10, 3600))) return json({ error: 'comment limit, try later' }, 429);
        const b = await req.json().catch(() => ({}));
        const body = String(b.body || '').trim();
        if (body.length < 2 || body.length > 1000) return json({ error: 'body: 2-1000 chars' }, 400);
        const ip = req.headers.get('cf-connecting-ip') || '';
        const iph = (await sha256hex(ip + ':' + (env.IP_PEPPER || 'dev'))).slice(0, 12);
        const slug = m[1];
        const list = (await kvGet(env, 'disc:' + slug, 'json')) || [];
        const c = { id: tok().slice(0, 12), u: user.name, t: Math.floor(Date.now() / 1000), body, iph };
        list.unshift(c);
        if (list.length > 500) list.length = 500;
        await kvPut(env, 'disc:' + slug, list);
        return json({ ok: true, comment: c });
      }
      m = p.match(/^\/disc\/([a-z0-9-]+)\/([a-f0-9]+)$/);
      if (m && req.method === 'DELETE') {
        const user = await userFromReq(env, req);
        if (!user) return json({ error: 'unauthorized' }, 401);
        const slug = m[1], id = m[2];
        const list = (await kvGet(env, 'disc:' + slug, 'json')) || [];
        const target = list.find(c => c.id === id);
        if (!target) return json({ error: 'no such comment' }, 404);
        if (user.role !== 'admin' && target.u !== user.name) return json({ error: 'not yours' }, 403);
        await kvPut(env, 'disc:' + slug, list.filter(c => c.id !== id));
        return json({ ok: true });
      }

      /* ---- feedback → GitHub issue ---- */
      if (p === '/feedback' && req.method === 'POST') {
        if (!(await rateOk(env, req, 'fb', 5, DAY))) return json({ error: 'feedback limit reached today' }, 429);
        if (!env.GH_TOKEN) return json({ error: 'feedback backend not configured (GH_TOKEN secret missing)' }, 503);
        const b = await req.json().catch(() => ({}));
        const title = String(b.title || '').trim().slice(0, 120);
        const body = String(b.body || '').trim().slice(0, 4000);
        if (title.length < 4 || body.length < 4) return json({ error: 'title & body: min 4 chars' }, 400);
        const user = await userFromReq(env, req);
        const r = await fetch('https://api.github.com/repos/BartoszOsiej/BartoszOsiej.github.io/issues', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + env.GH_TOKEN, 'user-agent': 'bz-blog-worker', 'content-type': 'application/json' },
          body: JSON.stringify({ title: '[FEEDBACK] ' + title, body: body + '\n\n— ' + (user ? user.name : 'anon'), labels: ['feedback'] }),
        });
        if (!r.ok) return json({ error: 'github rejected issue' }, 502);
        const d = await r.json();
        return json({ ok: true, issue: d.html_url });
      }

      /* ---- terminal API: the blog as a filesystem ---- */
      if (p === '/help') {
        return text(
          'bz blog // terminal client\n' +
          '  GET /ls            list posts (slug · date · score · reads · comments)\n' +
          '  GET /top           ranked by HOT (gravity)\n' +
          '  GET /cat/<slug>    full post as plaintext\n' +
          '  GET /karma/<slug>  score history series\n' +
          '  POST /vote/<slug>  {"dir":1|-1|0}   (0 = retract)\n' +
          '  GET /disc/<slug>   discussion thread\n' +
          '  register/login:    POST /auth/register {"username","password"}\n');
      }
      if (p === '/ls' || p === '/top' || p === '/') {
        const idx = await getIndex(env);
        const rows = [];
        for (const post of idx) {
          const c = await getCounts(env, post.slug);
          const disc = ((await kvGet(env, 'disc:' + post.slug, 'json')) || []).length;
          rows.push({ post, score: c.u - c.dn, reads: c.reads, disc });
        }
        if (p === '/top') {
          const nowH = Date.now() / 3600000;
          rows.sort((a, b) =>
            ((b.score + b.reads + 1) / Math.pow(nowH - Date.parse(b.post.date + 'T12:00:00Z') / 3600000 + 2, 1.5)) -
            ((a.score + a.reads + 1) / Math.pow(nowH - Date.parse(a.post.date + 'T12:00:00Z') / 3600000 + 2, 1.5)));
        }
        let out = (p === '/top' ? 'TOP // HOT RANKING' : 'BLOG // ALL POSTS') + '\n' + '─'.repeat(64) + '\n';
        out += 'SLUG'.padEnd(36) + 'DATE'.padEnd(12) + 'SCORE'.padEnd(7) + 'READS'.padEnd(7) + 'DISC\n';
        for (const r of rows) {
          out += r.post.slug.slice(0, 34).padEnd(36) + r.post.date.padEnd(12) +
            String(r.score).padEnd(7) + String(r.reads).padEnd(7) + r.disc + '\n';
        }
        out += '─'.repeat(64) + '\n' + rows.length + ' posts · curl ' + url.origin + '/cat/<slug> | less\n';
        return text(out);
      }
      m = p.match(/^\/cat\/([a-z0-9-]+)$/);
      if (m) {
        const slug = m[1];
        const origin = env.ORIGIN || 'https://bartoszosiej.github.io';
        const r = await fetch(origin + '/blog/' + slug + '.txt', { cf: { cacheTtl: 300 } });
        if (!r.ok) return text('cat: no such post: ' + slug + '\ntry: curl ' + url.origin + '/ls\n', 404);
        const c = await getCounts(env, slug);
        const disc = ((await kvGet(env, 'disc:' + slug, 'json')) || []).length;
        const body = await r.text();
        return text('SCORE ' + (c.u - c.dn) + ' (▲' + c.u + ' ▼' + c.dn + ') · READS ' + c.reads + ' · COMMENTS ' + disc +
          '\nVOTE:  curl -X POST ' + url.origin + '/vote/' + slug + ' -d \'{"dir":1}\'\nDISC:  curl ' + url.origin + '/disc/' + slug + '\n\n' + body);
      }

      return json({ error: 'not found', hint: url.origin + '/help' }, 404);
    } catch (e) {
      return json({ error: 'internal', detail: String(e && e.message) }, 500);
    }
  },

  /* daily karma snapshot — 00:05 UTC */
  async scheduled(event, env) {
    const idx = await getIndex(env);
    const ymd = new Date().toISOString().slice(0, 10);
    for (const post of idx) {
      const c = await getCounts(env, post.slug);
      const score = c.u - c.dn + c.reads;
      const k = 'karma:' + post.slug;
      const series = (await kvGet(env, k, 'json')) || [];
      const last = series[series.length - 1];
      if (last && last[0] === ymd) last[1] = score;
      else series.push([ymd, score]);
      if (series.length > 180) series.splice(0, series.length - 180);
      await kvPut(env, k, series);
    }
  },
};
