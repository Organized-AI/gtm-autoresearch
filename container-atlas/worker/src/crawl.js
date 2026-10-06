// Site scan crawler: Worker fetch + Queues + D1.
//   POST /api/scan          { website, maxPages }      start a crawl, returns { id, token }
//   GET  /api/scan/:id?t=   progress, every page, and the site summary
// A "seed" message reads robots.txt and the sitemap and picks pages that cover different templates;
// each "page" message fetches one page's source, runs GTM_SCAN.detect, stores the result and adds
// unseen internal links until the page budget is spent. Only the website is sent here: the container
// export never leaves the browser, which compares it with this summary itself.
import SCAN from './scan-detect.js';

export const AGENT = 'OrganizedAI-AtlasScan';
const UA = 'Mozilla/5.0 (compatible; ' + AGENT + '/1.0; +https://atlas.organizedai.vip/build)';
const MAX_BYTES = 1500000;
const STALE_MS = 180000;

async function get(url, accept) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: accept || 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en-US,en;q=0.8' }, signal: AbortSignal.timeout(15000), cf: { cacheTtl: 0 } });
  let text = '';
  if (res.body) {
    const reader = res.body.getReader(), dec = new TextDecoder(); let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; text += dec.decode(value, { stream: true }); if (n > MAX_BYTES) { reader.cancel().catch(() => {}); break; } }
  }
  return { status: res.status, url: res.url || url, type: res.headers.get('content-type') || '', text };
}

// Reserve a slot for url in this scan. Returns false when the budget is spent, the URL was seen,
// it is off-site, or robots.txt disallows it.
async function claim(env, scan, url) {
  const u = SCAN.normalize(url);
  if (!u || !SCAN.crawlable(u, scan.website)) return null;
  const rules = scan.robots ? JSON.parse(scan.robots) : [];
  const path = new URL(u).pathname + new URL(u).search;
  if (!SCAN.allowed(rules, path)) return null;
  const slot = await env.DB.prepare('UPDATE scans SET queued = queued + 1, updated_at = ?2 WHERE id = ?1 AND queued < max_pages').bind(scan.id, Date.now()).run();
  if (!slot.meta.changes) return null;
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO scan_pages (scan_id, url, status, queued_at) VALUES (?1, ?2, 'queued', ?3)").bind(scan.id, u, Date.now()).run();
  if (!ins.meta.changes) { await env.DB.prepare('UPDATE scans SET queued = queued - 1 WHERE id = ?1').bind(scan.id).run(); return null; }
  return u;
}
async function send(env, scanId, urls) {
  if (!urls.length) return;
  const msgs = urls.map(url => ({ body: { t: 'page', scan: scanId, url } }));
  if (env.SCAN_QUEUE) { for (let i = 0; i < msgs.length; i += 100) await env.SCAN_QUEUE.sendBatch(msgs.slice(i, i + 100)); }
  else for (const m of msgs) await page(env, m.body); // no queue bound (local dev): crawl inline
}

async function seed(env, scanId) {
  const scan = await env.DB.prepare('SELECT * FROM scans WHERE id = ?1').bind(scanId).first();
  if (!scan || scan.status !== 'seeding') return;
  try {
    const home = await get('https://' + scan.website + '/');
    const origin = new URL(home.url).origin;
    if (SCAN.rootDomain(new URL(home.url).host) !== scan.website) throw new Error(scan.website + ' redirects to ' + new URL(home.url).host + ', which is another site. Scan that domain instead.');
    let rules = [], maps = [];
    try { const r = await get(origin + '/robots.txt', 'text/plain'); if (r.status === 200) { const p = SCAN.robots(r.text, AGENT); rules = p.rules; maps = p.sitemaps; } } catch (e) { /* no robots.txt: everything allowed */ }
    await env.DB.prepare('UPDATE scans SET robots = ?2, origin = ?3, updated_at = ?4 WHERE id = ?1').bind(scanId, JSON.stringify(rules), origin, Date.now()).run();
    scan.robots = JSON.stringify(rules);
    // sitemap: robots.txt entries first, then /sitemap.xml; one level of sitemap index
    let locs = [];
    const tried = {};
    for (const sm of (maps.length ? maps : [origin + '/sitemap.xml']).slice(0, 3)) {
      if (tried[sm]) continue; tried[sm] = 1;
      try {
        const x = await get(sm, 'application/xml,text/xml;q=0.9,*/*;q=0.5'); if (x.status !== 200) continue;
        const l = SCAN.sitemapLocs(x.text);
        if (/<sitemapindex/i.test(x.text)) {
          for (const child of l.slice(0, 3)) { try { const c = await get(child, 'application/xml'); if (c.status === 200) locs = locs.concat(SCAN.sitemapLocs(c.text)); } catch (e) { /* skip one child */ } if (locs.length > 3000) break; }
        } else locs = locs.concat(l);
      } catch (e) { /* no sitemap */ }
      if (locs.length > 3000) break;
    }
    const pick = SCAN.sample([home.url].concat(locs.filter(u => SCAN.crawlable(u, scan.website))), scan.max_pages);
    const claimed = [];
    for (const u of pick) { const c = await claim(env, scan, u); if (c) claimed.push(c); }
    // 'running' only once pages are claimed, so a poll in between never sees an empty, finished scan
    await env.DB.prepare("UPDATE scans SET sitemap_urls = ?2, status = ?3, error = ?4, updated_at = ?5 WHERE id = ?1")
      .bind(scanId, locs.length, claimed.length ? 'running' : 'failed', claimed.length ? null : 'No page on ' + scan.website + ' could be scanned: robots.txt disallows them or none are HTML pages.', Date.now()).run();
    await send(env, scanId, claimed);
  } catch (e) {
    await env.DB.prepare("UPDATE scans SET status = 'failed', error = ?2, updated_at = ?3 WHERE id = ?1").bind(scanId, String(e.message || e).slice(0, 300), Date.now()).run();
  }
}

async function page(env, m) {
  const scan = await env.DB.prepare('SELECT * FROM scans WHERE id = ?1').bind(m.scan).first();
  if (!scan || scan.status === 'failed') return;
  const row = await env.DB.prepare('SELECT status FROM scan_pages WHERE scan_id = ?1 AND url = ?2').bind(m.scan, m.url).first();
  if (!row || row.status !== 'queued') return; // already handled (queue redelivery)
  let status = 'failed', http = null, finalUrl = null, result = null, error = null, links = [];
  try {
    const r = await get(m.url); http = r.status; finalUrl = r.url;
    if (r.status >= 400) error = r.status === 403 || r.status === 503 ? 'Refused (' + r.status + '), likely bot protection.' : 'HTTP ' + r.status;
    else if (!/html/i.test(r.type) && !/^\s*</.test(r.text)) error = 'Not an HTML page (' + (r.type || 'unknown type') + ').';
    else if (SCAN.rootDomain(new URL(r.url).host) !== scan.website) error = 'Redirected off-site to ' + new URL(r.url).host + '.';
    else {
      const d = SCAN.detect(r.text, r.url);
      links = d.links; delete d.links;
      result = JSON.stringify(d); status = 'ok';
      if (/cf-chl|challenge-platform|Just a moment\.\.\.|captcha/i.test(r.text.slice(0, 20000)) && d.textChars < 600) { status = 'failed'; result = null; error = 'Bot challenge page instead of content.'; http = 403; }
    }
  } catch (e) { error = e.name === 'TimeoutError' ? 'Timed out after 15 s.' : String(e.message || e).slice(0, 200); }
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE scan_pages SET status = ?3, http_status = ?4, final_url = ?5, result = ?6, error = ?7, fetched_at = ?8 WHERE scan_id = ?1 AND url = ?2').bind(m.scan, m.url, status, http, finalUrl, result, error, now),
    env.DB.prepare('UPDATE scans SET ' + (status === 'ok' ? 'done = done + 1' : 'failed = failed + 1') + ', updated_at = ?2 WHERE id = ?1').bind(m.scan, now),
  ]);
  // follow links into templates the crawl has not seen yet first
  if (links.length) {
    const fresh = await env.DB.prepare('SELECT queued, max_pages FROM scans WHERE id = ?1').bind(m.scan).first();
    if (fresh && fresh.queued < fresh.max_pages) {
      const { results } = await env.DB.prepare('SELECT url FROM scan_pages WHERE scan_id = ?1').bind(m.scan).all();
      const seen = new Set(results.map(x => x.url)), keys = new Set(results.map(x => SCAN.template(x.url).key));
      // unseen templates first, localised copies last
      const rank = u => { const t = SCAN.template(u); return (t.localized ? 2 : 0) + (keys.has(t.key) ? 1 : 0); };
      const cand = links.filter(u => !seen.has(u) && SCAN.crawlable(u, scan.website)).sort((a, b) => rank(a) - rank(b));
      const claimed = [];
      for (const u of cand.slice(0, Math.min(40, (fresh.max_pages - fresh.queued) * 3))) { const c = await claim(env, scan, u); if (c) claimed.push(c); }
      await send(env, m.scan, claimed);
    }
  }
}

export async function consume(batch, env) {
  for (const msg of batch.messages) {
    try { if (msg.body.t === 'seed') await seed(env, msg.body.scan); else await page(env, msg.body); }
    catch (e) { console.error('scan message failed', msg.body, e && e.stack || e); }
    msg.ack();
  }
}

export async function start(env, ctx, body, ipHash, sha, rid) {
  const raw = String((body && body.website) || '').trim();
  const site = SCAN.rootDomain(SCAN.hostOf(raw) || '');
  if (!site || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(site) || /^(localhost|.*\.local|.*\.internal)$/.test(site)) return { error: 'bad_website', message: 'Enter a public domain such as example.com.' };
  const cap = Number(env.SCAN_MAX_PAGES || 50), max = Math.max(1, Math.min(cap, Number(body.maxPages) || 25));
  const id = rid(9), token = rid(18), now = Date.now();
  await env.DB.prepare("INSERT INTO scans (id, website, token_hash, status, max_pages, queued, done, failed, created_at, updated_at, ip_hash) VALUES (?1, ?2, ?3, 'seeding', ?4, 0, 0, 0, ?5, ?5, ?6)")
    .bind(id, site, await sha(token), max, now, ipHash).run();
  if (env.SCAN_QUEUE) await env.SCAN_QUEUE.send({ t: 'seed', scan: id });
  else ctx.waitUntil(seed(env, id));
  return { id, token, website: site, maxPages: max };
}

export async function status(env, id, token, sha) {
  const scan = await env.DB.prepare('SELECT * FROM scans WHERE id = ?1').bind(id).first();
  if (!scan || !token || scan.token_hash !== await sha(token)) return null;
  const { results } = await env.DB.prepare('SELECT url, status, http_status, final_url, result, error, queued_at, fetched_at FROM scan_pages WHERE scan_id = ?1 ORDER BY queued_at').bind(id).all();
  const now = Date.now();
  // a page that never came back (dropped message, Worker limit) does not hold the scan open forever
  const pages = results.map(r => ({ url: r.url, final_url: r.final_url, http_status: r.http_status, error: r.status === 'queued' && now - scan.updated_at > STALE_MS ? 'Not fetched in time.' : r.error, status: r.status === 'queued' && now - scan.updated_at > STALE_MS ? 'failed' : r.status, result: r.result ? JSON.parse(r.result) : null }));
  const pending = pages.filter(p => p.status === 'queued').length;
  const state = scan.status === 'failed' ? 'failed' : scan.status === 'seeding' || !pages.length ? (now - scan.created_at > STALE_MS ? 'failed' : 'seeding') : pending ? 'running' : 'done';
  return {
    id: scan.id, website: scan.website, origin: scan.origin, status: state, error: scan.error || (state === 'failed' && scan.status === 'seeding' ? 'The scan did not start in time. Try again.' : null),
    maxPages: scan.max_pages, queued: pages.length, done: pages.filter(p => p.status === 'ok').length, failed: pages.filter(p => p.status === 'failed').length, sitemapUrls: scan.sitemap_urls,
    createdAt: scan.created_at, updatedAt: scan.updated_at,
    pages: pages.map(p => ({ url: p.url, finalUrl: p.final_url, httpStatus: p.http_status, status: p.status, error: p.error, title: p.result && p.result.title })),
    summary: state === 'done' ? SCAN.summarize(pages) : null,
  };
}
