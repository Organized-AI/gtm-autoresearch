// GTM Container Atlas Worker.
//   /api/watch            POST  save a baseline digest, check the published container now
//   /api/watch/:id        GET   history for one watch (token required)
//   /api/watch/:id/check  POST  check again now
//   /api/watch/:id        DELETE stop watching
//   /api/judge            POST  Jev verdicts for findings, through jev-gateway (rubric RUB-S1-JEV-ATLAS-FINDING). Same-origin page calls are limited per network;
//                               other atlases call it with "Authorization: Bearer jev_..." (hosted Jev-gateway)
//   /api/jev/trial        POST  issue a hosted Jev-gateway key, free for TRIAL_DAYS
//   /api/jev/key          GET   status of the bearer key (plan, days left, calls)
//   /api/runs             POST  start a GTM auto (autoresearch) run for a container
//   /api/runs/:id/rounds  POST  store one round, accepted or rejected (token required)
//   /api/runs/:id         GET   the run and every round (token required)
//   cron (daily)                re-check every watch against the published gtm.js
// Everything else is the static atlas in ./public.
import DRIFT from './drift.js';
import { DEMO } from './demo.js';
import { judgeFindings } from './jev.js';

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

// The fictional Skyline Charters sample is not published anywhere; its drift is simulated (worker/src/demo.js) and labelled as such.
class LiveError extends Error {}
async function fetchLive(publicId) {
  // The fictional sample container has a simulated published version, so the demo never depends on Google.
  if (DEMO[publicId]) return DEMO[publicId];
  let res;
  try { res = await fetch('https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(publicId), { cf: { cacheTtl: 300 } }); }
  catch (e) { throw new LiveError('Google Tag Manager could not be reached just now. The next daily check will try again.'); }
  if (res.status === 404) throw new LiveError(publicId + ' has no published version that Google serves. Publish the container once in GTM, or check that the ID matches the container on the site.');
  if (!res.ok) throw new LiveError('Google Tag Manager answered ' + res.status + ' for ' + publicId + '. The next daily check will try again.');
  let live;
  try { live = DRIFT.fromGtmJs(await res.text()); }
  catch (e) { throw new LiveError('The published ' + publicId + ' could not be read. It may use a format this check does not support yet.'); }
  // For IDs it does not know, Google sometimes serves an empty placeholder (version 1, no tags) instead of a 404.
  if (!Object.keys(live.tags).length) throw new LiveError('Google serves an empty container for ' + publicId + ', which means it has never been published or the ID is wrong. Publish the container once in GTM, or check that the ID matches the container on the site.');
  return live;
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
    id: w.id, publicId: w.public_id, demo: !!DEMO[w.public_id], label: w.label, website: w.website, createdAt: w.created_at, lastChecked: w.last_checked,
    baselineVersion: JSON.parse(w.baseline).version,
    checks: results.map(r => ({ checkedAt: r.checked_at, version: r.version, changes: JSON.parse(r.changes || '[]'), newChanges: JSON.parse(r.new_changes || '[]'), error: r.error })),
  };
}

/* ---------- Jev, through jev-gateway (see jev.js) ---------- */
const DAY = 86400000;
async function keyFor(env, req) {
  const m = /^Bearer\s+(jev_[A-Za-z0-9_-]{20,80})$/.exec(req.headers.get('authorization') || '');
  if (!m) return null;
  const row = await env.DB.prepare('SELECT * FROM jev_keys WHERE key_hash = ?1').bind(await sha('jev|' + m[1])).first();
  return row || { invalid: true };
}
function keyStatus(env, k) {
  const now = Date.now(), active = k.plan === 'paid' ? (!k.expires_at || k.expires_at > now) : k.expires_at > now;
  return { plan: k.plan, active, expiresAt: k.expires_at, daysLeft: k.expires_at ? Math.max(0, Math.ceil((k.expires_at - now) / DAY)) : null, calls: k.calls, upgradeUrl: env.UPGRADE_URL || null };
}
async function judge(env, req) {
  const key = await keyFor(env, req);
  if (key && key.invalid) return fail(401, 'bad_key', 'This Jev key is not recognised. Check JEV_KEY, or get a new trial key.');
  if (key) {
    const st = keyStatus(env, key);
    if (!st.active) return json({ error: 'trial_ended', message: 'The free Jev-gateway trial for this key has ended. Upgrade to keep hosted Jev, or switch your atlas to its own Workers AI.', upgradeUrl: st.upgradeUrl }, 402);
    if (!(await limit(env, req, 'judge-key:' + key.id, Number(env.KEY_DAILY_CALLS || 3000), 86400))) return fail(429, 'rate_limited', 'This key has reached its daily Jev limit.');
    await env.DB.prepare('UPDATE jev_keys SET calls = calls + 1, last_used = ?2 WHERE id = ?1').bind(key.id, Date.now()).run();
  } else if (!(await limit(env, req, 'judge', 600, 3600))) return fail(429, 'rate_limited', 'Too many Jev requests from this network. Try again in a few minutes.');
  const body = await req.json().catch(() => null), findings = body && Array.isArray(body.findings) ? body.findings.slice(0, 15) : [];
  if (!findings.length) return fail(400, 'no_findings', 'Send up to 15 findings.');
  // An atlas without its own gateway token forwards to the hosted atlas with its Jev key.
  if (!env.JEV_GATEWAY_TOKEN && env.JEV_KEY) {
    const r = await fetch(env.JEV_URL || 'https://atlas.organizedai.vip/api/judge', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.JEV_KEY }, body: JSON.stringify({ findings, website: body.website }) });
    return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (!env.JEV_GATEWAY_TOKEN) return fail(503, 'jev_not_connected', 'Jev is not connected to this atlas yet. Every finding stays with you to decide.');
  try {
    const out = await judgeFindings(env, findings, String(body.website || '').slice(0, 120));
    return json({ provider: 'jev-gateway', ...out });
  } catch (e) {
    return fail(502, 'jev_unavailable', 'Jev could not be reached. Every finding stays with you to decide.');
  }
}
async function trial(env, req) {
  if (!env.JEV_GATEWAY_TOKEN) return fail(404, 'not_offered', 'This atlas does not offer hosted Jev keys.');
  if (!(await limit(env, req, 'trial', 5, 86400))) return fail(429, 'rate_limited', 'Too many trial keys from this network today.');
  const b = await req.json().catch(() => null), email = String((b && b.email) || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) || email.length > 200) return fail(400, 'bad_email', 'A valid email is needed for the trial key.');
  const live = await env.DB.prepare('SELECT * FROM jev_keys WHERE email = ?1 AND expires_at > ?2 LIMIT 1').bind(email, Date.now()).first();
  if (live) return fail(409, 'has_key', 'This email already has an active Jev key (' + keyStatus(env, live).daysLeft + ' days left). Use the key you saved; to replace a lost key, contact Organized AI.');
  const days = Number(env.TRIAL_DAYS || 30), key = 'jev_' + rid(24), id = rid(9), now = Date.now();
  await env.DB.prepare('INSERT INTO jev_keys (id, key_hash, email, label, plan, created_at, expires_at, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
    .bind(id, await sha('jev|' + key), email, String((b && b.label) || '').slice(0, 120), 'trial', now, now + days * DAY, await ipHash(req)).run();
  return json({ key, plan: 'trial', expiresAt: now + days * DAY, daysLeft: days, url: new URL(req.url).origin + '/api/judge', upgradeUrl: env.UPGRADE_URL || null });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      if (path === '/api/published' && req.method === 'GET') {
        const id = url.searchParams.get('id') || '';
        if (!/^GTM-[A-Z0-9]{4,12}$/.test(id)) return fail(400, 'bad_container', 'A container ID like GTM-ABC1234 is required.');
        try { const live = await fetchLive(id); return json({ published: true, sample: !!DEMO[id], version: live.version }); }
        catch (e) { return json({ published: false, message: e.message }); }
      }
      if (path === '/api/health') return json({ ok: true, drift: true, runs: true, jev: !!(env.JEV_GATEWAY_TOKEN || env.JEV_KEY), jevMode: env.JEV_GATEWAY_TOKEN ? 'jev-gateway' : env.JEV_KEY ? 'hosted' : 'off' });
      if (path === '/api/judge' && req.method === 'POST') return await judge(env, req);
      if (path === '/api/jev/trial' && req.method === 'POST') return await trial(env, req);
      if (path === '/api/jev/key' && req.method === 'GET') { const k = await keyFor(env, req); if (!k || k.invalid) return fail(401, 'bad_key', 'Send a Jev key as Authorization: Bearer jev_...'); return json(keyStatus(env, k)); }
      if (path === '/api/watch' && req.method === 'POST') {
        if (!(await limit(env, req, 'watch', 20, 86400))) return fail(429, 'rate_limited', 'This network has created the maximum number of watches today.');
        const b = await req.json().catch(() => null);
        if (!b || !/^GTM-[A-Z0-9]{4,12}$/.test(b.publicId || '')) return fail(400, 'bad_container', 'A web container ID like GTM-ABC1234 is required.');
        const baseline = JSON.stringify(b.baseline || {}), names = JSON.stringify(b.names || {});
        if (baseline.length > 300000 || names.length > 200000 || !b.baseline || !b.baseline.tags) return fail(400, 'bad_baseline', 'The baseline is missing or too large.');
        // Check the published container first, so a watch is only saved when it can work.
        try { await fetchLive(b.publicId); } catch (e) { return fail(409, 'not_published', e.message); }
        const id = rid(9), token = rid(18);
        await env.DB.prepare('INSERT INTO watches (id, public_id, label, website, token_hash, baseline, names, created_at, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
          .bind(id, b.publicId, String(b.label || '').slice(0, 120), String(b.website || '').slice(0, 120), await sha(token), baseline, names, Date.now(), await ipHash(req)).run();
        const w = await env.DB.prepare('SELECT * FROM watches WHERE id = ?1').bind(id).first();
        const first = await runCheck(env, w);
        return json({ id, token, link: url.origin + '/drift?w=' + id + '&t=' + token, first });
      }
      if (path === '/api/runs' && req.method === 'POST') {
        if (!(await limit(env, req, 'runs', 60, 86400))) return fail(429, 'rate_limited', 'This network has started the maximum number of GTM auto runs today.');
        const b = await req.json().catch(() => null);
        if (!b || !/^GTM-[A-Z0-9]{4,12}$/.test(b.publicId || '')) return fail(400, 'bad_container', 'A container ID like GTM-ABC1234 is required.');
        const id = rid(9), token = rid(18), now = Date.now();
        await env.DB.prepare('INSERT INTO runs (id, public_id, label, website, token_hash, watch_id, baseline_score, best_score, created_at, updated_at, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?8, ?9)')
          .bind(id, b.publicId, String(b.label || '').slice(0, 120), String(b.website || '').slice(0, 120), await sha(token), b.watchId ? String(b.watchId).slice(0, 40) : null, Number.isFinite(b.baselineScore) ? Math.round(b.baselineScore) : null, now, await ipHash(req)).run();
        return json({ id, token, link: url.origin + '/runs?r=' + id + '&t=' + token });
      }
      const rm = /^\/api\/runs\/([A-Za-z0-9_-]+)(\/rounds)?$/.exec(path);
      if (rm) {
        const run = await env.DB.prepare('SELECT * FROM runs WHERE id = ?1').bind(rm[1]).first();
        const tok = url.searchParams.get('t') || req.headers.get('x-run-token');
        if (!run || !tok || run.token_hash !== await sha(tok)) return fail(404, 'not_found', 'No GTM auto run matches that link.');
        if (rm[2] && req.method === 'POST') {
          const e = await req.json().catch(() => null);
          if (!e || !Number.isInteger(e.round) || e.round < 1 || e.round > 500) return fail(400, 'bad_round', 'A round number is required.');
          const ops = JSON.stringify(e.operations || []), dims = JSON.stringify(e.dimensions || {});
          if (ops.length > 200000) return fail(400, 'too_large', 'This round has too many operations to store.');
          const now = Date.now(), acc = e.accepted ? 1 : 0, score = Number.isFinite(e.score) ? Math.round(e.score) : null;
          await env.DB.batch([
            env.DB.prepare('INSERT OR REPLACE INTO rounds (run_id, round, accepted, score, critical, source, idea, why, reason, error, operations, dimensions, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)')
              .bind(run.id, e.round, acc, score, Number.isFinite(e.criticalCount) ? e.criticalCount : null, String(e.source || '').slice(0, 40), String(e.idea || '').slice(0, 120), String(e.why || '').slice(0, 600), String(e.reason || '').slice(0, 600), e.error ? String(e.error).slice(0, 300) : null, ops, dims, now),
            env.DB.prepare('UPDATE runs SET rounds = (SELECT COUNT(*) FROM rounds WHERE run_id = ?1), accepted = (SELECT COUNT(*) FROM rounds WHERE run_id = ?1 AND accepted = 1), best_score = MAX(COALESCE(best_score, 0), CASE WHEN ?2 = 1 THEN COALESCE(?3, 0) ELSE 0 END), updated_at = ?4 WHERE id = ?1').bind(run.id, acc, score, now),
          ]);
          return json({ stored: true, round: e.round });
        }
        const { results } = await env.DB.prepare('SELECT round, accepted, score, critical, source, idea, why, reason, error, operations, dimensions, created_at FROM rounds WHERE run_id = ?1 ORDER BY round').bind(run.id).all();
        return json({ id: run.id, publicId: run.public_id, label: run.label, website: run.website, watchId: run.watch_id, baselineScore: run.baseline_score, bestScore: run.best_score, createdAt: run.created_at, updatedAt: run.updated_at,
          rounds: results.map(r => ({ round: r.round, accepted: !!r.accepted, score: r.score, criticalCount: r.critical, source: r.source, idea: r.idea, why: r.why, reason: r.reason, error: r.error, operations: JSON.parse(r.operations || '[]'), dimensions: JSON.parse(r.dimensions || '{}'), createdAt: r.created_at })) });
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
