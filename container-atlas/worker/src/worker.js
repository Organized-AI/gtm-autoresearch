// GTM Container Atlas Worker.
//   /api/watch            POST  save a baseline digest, check the published container now
//   /api/watch/:id        GET   history for one watch (token required)
//   /api/watch/:id/check  POST  check again now
//   /api/watch/:id        DELETE stop watching
//   /api/judge            POST  Jev-style suggestions for findings (Workers AI)
//   cron (daily)                re-check every watch against the published gtm.js
// Everything else is the static atlas in ./public.
import DRIFT from './drift.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status, code, message) => json({ error: code, message }, status);
const enc = new TextEncoder();
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function rid(n = 18) { const b = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const ipHash = req => sha('atlas|' + (req.headers.get('cf-connecting-ip') || 'unknown'));

async function limit(env, req, bucket, max, windowSec) {
  const ip = await ipHash(req), w = bucket + ':' + Math.floor(Date.now() / 1000 / windowSec);
  await env.DB.prepare('INSERT INTO hits (ip_hash, bucket, n) VALUES (?1, ?2, 1) ON CONFLICT(ip_hash, bucket) DO UPDATE SET n = n + 1').bind(ip, w).run();
  const row = await env.DB.prepare('SELECT n FROM hits WHERE ip_hash = ?1 AND bucket = ?2').bind(ip, w).first();
  return row.n <= max;
}

async function fetchLive(publicId) {
  const res = await fetch('https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(publicId), { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error('Google returned ' + res.status + ' for ' + publicId + '. Check that the container is published.');
  return DRIFT.fromGtmJs(await res.text());
}

async function runCheck(env, w, liveCache) {
  const now = Date.now();
  let live, error = null, changes = [], fresh = [];
  try {
    live = liveCache && liveCache[w.public_id] ? liveCache[w.public_id] : await fetchLive(w.public_id);
    if (liveCache) liveCache[w.public_id] = live;
    const base = JSON.parse(w.baseline), names = w.names ? JSON.parse(w.names) : {};
    changes = DRIFT.compare(base, live, names);
    const prevLive = w.last_live ? JSON.parse(w.last_live) : null;
    fresh = prevLive ? DRIFT.compare(prevLive, live, names) : changes;
  } catch (e) { error = String(e.message || e).slice(0, 300); }
  await env.DB.prepare('INSERT INTO checks (watch_id, checked_at, version, changes, new_changes, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(w.id, now, live ? live.version : null, JSON.stringify(changes), JSON.stringify(fresh), error).run();
  await env.DB.prepare('UPDATE watches SET last_checked = ?2, last_live = COALESCE(?3, last_live) WHERE id = ?1').bind(w.id, now, live ? JSON.stringify(live) : null).run();
  return { checked_at: now, version: live ? live.version : null, changes, new_changes: fresh, error };
}

async function authed(env, id, token) {
  if (!id || !token) return null;
  const w = await env.DB.prepare('SELECT * FROM watches WHERE id = ?1').bind(id).first();
  if (!w || w.token_hash !== await sha(token)) return null;
  return w;
}
async function history(env, w) {
  const { results } = await env.DB.prepare('SELECT checked_at, version, changes, new_changes, error FROM checks WHERE watch_id = ?1 ORDER BY checked_at DESC LIMIT 60').bind(w.id).all();
  return {
    id: w.id, publicId: w.public_id, label: w.label, website: w.website, createdAt: w.created_at, lastChecked: w.last_checked,
    baselineVersion: JSON.parse(w.baseline).version,
    checks: results.map(r => ({ checkedAt: r.checked_at, version: r.version, changes: JSON.parse(r.changes || '[]'), newChanges: JSON.parse(r.new_changes || '[]'), error: r.error })),
  };
}

/* ---------- Jev-style judging ---------- */
const OPTIONS = { fix: 'Fix it: the finding is a real problem in this container.', intended: 'Intended: the setup is deliberate, keep it as it is.', ask_owner: 'Ask the owner: the export alone cannot settle it.' };
function judgePrompt(findings) {
  return [
    'You review findings from a static Google Tag Manager container audit for a measurement team.',
    'For each finding, give a probability for each decision. Probabilities for one finding must sum to 1. Be calibrated: when the export alone cannot settle it, put weight on ask_owner.',
    'Decisions: ' + Object.entries(OPTIONS).map(([k, v]) => k + ' = ' + v).join(' '),
    'Findings (JSON): ' + JSON.stringify(findings.map(f => ({ key: f.key, element: f.name, kind: f.kind, check: f.check, severity: f.severity, container: f.container, finding: f.message }))),
    'Reply with JSON only: {"results":[{"key":"…","fix":0.0,"intended":0.0,"ask_owner":0.0}]}',
  ].join('\n');
}
function normalize(r) {
  const k = ['fix', 'intended', 'ask_owner'], p = k.map(x => Math.max(0, Number(r[x]) || 0)), s = p.reduce((a, b) => a + b, 0) || 1;
  const probs = Object.fromEntries(k.map((x, i) => [x, p[i] / s])), top = k.reduce((a, b) => (probs[a] >= probs[b] ? a : b));
  return { key: r.key, probabilities: probs, choice: top, confidence: (3 * probs[top] - 1) / 2 };
}
async function judge(env, req) {
  if (!(await limit(env, req, 'judge', 40, 3600))) return fail(429, 'rate_limited', 'Too many Jev requests from this network. Try again later, or switch to OpenRouter with your own key.');
  const body = await req.json().catch(() => null), findings = body && Array.isArray(body.findings) ? body.findings.slice(0, 15) : [];
  if (!findings.length) return fail(400, 'no_findings', 'Send up to 15 findings.');
  const schema = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, fix: { type: 'number' }, intended: { type: 'number' }, ask_owner: { type: 'number' } }, required: ['key', 'fix', 'intended', 'ask_owner'] } } }, required: ['results'] };
  const out = await env.AI.run(env.JEV_MODEL, { messages: [{ role: 'user', content: judgePrompt(findings) }], response_format: { type: 'json_schema', json_schema: schema }, max_tokens: 1600, temperature: 0 });
  let parsed = out && out.response; if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed.replace(/^[^{]*/, '').replace(/[^}]*$/, '')); } catch (e) { parsed = null; } }
  if (!parsed || !Array.isArray(parsed.results)) return fail(502, 'bad_model_output', 'The model did not return usable probabilities. Try again.');
  return json({ provider: 'cloudflare', model: env.JEV_MODEL, thresholds: { auto: Number(env.AUTO_THRESHOLD), ask: Number(env.ASK_THRESHOLD) }, results: parsed.results.map(normalize) });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      if (path === '/api/health') return json({ ok: true, drift: true, jev: !!env.AI });
      if (path === '/api/judge' && req.method === 'POST') return await judge(env, req);
      if (path === '/api/watch' && req.method === 'POST') {
        if (!(await limit(env, req, 'watch', 20, 86400))) return fail(429, 'rate_limited', 'This network has created the maximum number of watches today.');
        const b = await req.json().catch(() => null);
        if (!b || !/^GTM-[A-Z0-9]{4,12}$/.test(b.publicId || '')) return fail(400, 'bad_container', 'A web container ID like GTM-ABC1234 is required.');
        const baseline = JSON.stringify(b.baseline || {}), names = JSON.stringify(b.names || {});
        if (baseline.length > 300000 || names.length > 200000 || !b.baseline || !b.baseline.tags) return fail(400, 'bad_baseline', 'The baseline is missing or too large.');
        const id = rid(9), token = rid(18);
        await env.DB.prepare('INSERT INTO watches (id, public_id, label, website, token_hash, baseline, names, created_at, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
          .bind(id, b.publicId, String(b.label || '').slice(0, 120), String(b.website || '').slice(0, 120), await sha(token), baseline, names, Date.now(), await ipHash(req)).run();
        const w = await env.DB.prepare('SELECT * FROM watches WHERE id = ?1').bind(id).first();
        const first = await runCheck(env, w);
        return json({ id, token, link: url.origin + '/drift?w=' + id + '&t=' + token, first });
      }
      const m = /^\/api\/watch\/([A-Za-z0-9_-]+)(\/check)?$/.exec(path);
      if (m) {
        const w = await authed(env, m[1], url.searchParams.get('t') || req.headers.get('x-watch-token'));
        if (!w) return fail(404, 'not_found', 'No watch matches that link.');
        if (m[2] && req.method === 'POST') {
          if (w.last_checked && Date.now() - w.last_checked < 60000) return fail(429, 'too_soon', 'Checked less than a minute ago.');
          await runCheck(env, w); return json(await history(env, await authed(env, m[1], url.searchParams.get('t') || req.headers.get('x-watch-token'))));
        }
        if (req.method === 'DELETE') { await env.DB.batch([env.DB.prepare('DELETE FROM checks WHERE watch_id = ?1').bind(w.id), env.DB.prepare('DELETE FROM watches WHERE id = ?1').bind(w.id)]); return json({ deleted: true }); }
        return json(await history(env, w));
      }
      return fail(404, 'not_found', 'Unknown API route.');
    } catch (e) {
      console.error('atlas api error', path, e && e.stack || e);
      return fail(500, 'server_error', 'Something went wrong on the server. Try again.');
    }
  },
  async scheduled(event, env, ctx) {
    const cutoff = Date.now() - 20 * 3600 * 1000, cache = {};
    const { results } = await env.DB.prepare('SELECT * FROM watches WHERE last_checked IS NULL OR last_checked < ?1 ORDER BY last_checked LIMIT 200').bind(cutoff).all();
    for (const w of results) { try { await runCheck(env, w, cache); } catch (e) { console.error('drift check failed', w.id, e && e.message); } }
    await env.DB.prepare('DELETE FROM hits WHERE rowid IN (SELECT rowid FROM hits LIMIT 5000)').run().catch(() => {});
    console.log('drift cron checked', results.length, 'watches across', Object.keys(cache).length, 'containers');
  },
};
