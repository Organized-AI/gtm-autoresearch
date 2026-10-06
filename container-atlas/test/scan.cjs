// Site scan: detect → summarize → compare, on hand-written pages against the Skyline Charters sample.
const fs = require('fs'), assert = require('assert');
const SCAN = require('../src/scan.js');
const vm = require('vm'), ctx = { console, URL, Math, JSON, Date }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../src/gtm-auto.js', 'utf8') + '\n;globalThis.GTM_AUTO=GTM_AUTO;', ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../src/engine.js', 'utf8') + '\n;globalThis.GTM_ENGINE=GTM_ENGINE;', ctx);
const E = ctx.GTM_ENGINE, web = E.parseExport(fs.readFileSync(__dirname + '/../fixtures/sample-web.json', 'utf8'));
const site = 'skylinecharters.com', origin = 'https://www.skylinecharters.com';
const SNIP = id => `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>`;
const STAPE = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://load.sst.skylinecharters.com/abcdefgh.js?'+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','st=aWQ9R1RNLVNLWTdRMkw%3D');</script>`;
const pages = {
  '/': `<html><head><title>Skyline Charters</title>${SNIP('GTM-SKY7Q2L')}
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-SKY4H7Q2LP"></script><script>gtag('config','G-SKY4H7Q2LP');gtag('consent','default',{ad_storage:'denied'});</script>
    <script src="https://cdn.cookielaw.org/scripttemplates/otSDKStub.js"></script></head><body>
    <a href="/charters">Charters</a> <a href="/charters/bahamas?utm_source=x#top">Bahamas</a> <a href="https://other.com/">x</a> <a href="/brochure.pdf">pdf</a> <a href="/quote">Quote</a>
    <script>!function(f,b,e,v,n,t,s){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '481920375512334');fbq('track','PageView');</script>
    <script>window.dataLayer.push({ event: 'quote_request', value: 1 });</script>
    <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-SKY7Q2L"></iframe></noscript>${'<p>Fly private across the islands. </p>'.repeat(20)}</body></html>`,
  '/charters': `<html><head><title>Charters</title></head><body>${SNIP('GTM-SKY7Q2L')}${SNIP('GTM-SKY7Q2L')}${SNIP('GTM-OTHER99')}<script src="https://www.google-analytics.com/analytics.js"></script><script>ga('create','UA-1234567-1','auto');</script>${'<p>text </p>'.repeat(80)}</body></html>`,
  '/quote': `<html><head><title>Quote</title>${STAPE}<script>ttq.load('C4ABCDEFGHIJKLMNOP12');</script></head><body><div id="root"></div></body></html>`,
};

// detect
const home = SCAN.detect(pages['/'], origin + '/');
assert.deepStrictEqual(home.gtm.map(g => g.id), ['GTM-SKY7Q2L']);
assert.ok(home.gtm[0].head, 'snippet is in <head>');
assert.deepStrictEqual([...new Set(home.gtag.map(g => g.id))], ['G-SKY4H7Q2LP']);
assert.deepStrictEqual(home.pixels.map(p => p.vendor + ':' + p.id), ['Meta:481920375512334']);
assert.deepStrictEqual(home.events, ['quote_request']);
assert.deepStrictEqual(home.consent.cmp, ['OneTrust']); assert.strictEqual(home.consent.defaults, 1);
assert.ok(home.links.includes(origin + '/charters/bahamas'), 'tracking params and hash dropped: ' + home.links.join(' '));
assert.deepStrictEqual(home.noscript, ['GTM-SKY7Q2L']);
const quote = SCAN.detect(pages['/quote'], origin + '/quote');
assert.deepStrictEqual(quote.loaders.map(l => l.host), ['load.sst.skylinecharters.com']);
assert.strictEqual(quote.gtm[0].via, 'custom loader');
const ch = SCAN.detect(pages['/charters'], origin + '/charters');
assert.strictEqual(ch.gtm.filter(g => g.id === 'GTM-SKY7Q2L').length, 2);
assert.strictEqual(ch.gtm[0].head, false);
assert.strictEqual(ch.legacy[0].id, 'UA-1234567-1');

// crawl helpers
assert.ok(SCAN.crawlable(origin + '/charters', site)); assert.ok(!SCAN.crawlable('https://other.com/', site)); assert.ok(!SCAN.crawlable(origin + '/brochure.pdf', site)); assert.ok(!SCAN.crawlable(origin + '/cart', site));
const rb = SCAN.robots('User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: GPTBot\nDisallow: /\nSitemap: https://x.com/sitemap.xml', 'OrganizedAI-AtlasScan');
assert.ok(!SCAN.allowed(rb.rules, '/private/a')); assert.ok(SCAN.allowed(rb.rules, '/private/ok')); assert.ok(SCAN.allowed(rb.rules, '/charters'));
assert.deepStrictEqual(rb.sitemaps, ['https://x.com/sitemap.xml']);
assert.deepStrictEqual(SCAN.sample(['https://a.com/', 'https://a.com/blog/1', 'https://a.com/blog/2', 'https://a.com/p/1', 'https://a.com/blog/3'], 3), ['https://a.com/', 'https://a.com/blog/1', 'https://a.com/p/1']);
assert.deepStrictEqual(SCAN.sample(['https://a.com/', 'https://a.com/de', 'https://a.com/fr', 'https://a.com/pricing', 'https://a.com/de/pricing', 'https://a.com/blog/x'], 4), ['https://a.com/', 'https://a.com/pricing', 'https://a.com/blog/x', 'https://a.com/de']);

// summarize + compare
const rows = Object.keys(pages).map(p => ({ url: origin + p, final_url: origin + p, http_status: 200, result: (r => { delete r.links; return r; })(SCAN.detect(pages[p], origin + p)) }));
rows.push({ url: origin + '/blocked', http_status: 403, result: null, error: 'Refused' });
const S = SCAN.summarize(rows);
const items = SCAN.compare(S, web, null, site);
for (const i of items) console.log(i.severity.padEnd(8), (i.name || '').padEnd(28), i.message.slice(0, 130));
const has = (code, sev) => assert.ok(items.some(i => i.key.includes('|' + code) && (!sev || i.severity === sev)), 'expected ' + code + ' ' + (sev || ''));
has('gtm-mixed', 'info'); assert.ok(!items.some(i => i.key.includes('|gtm-partial|')), 'loader page is not counted as missing'); has('gtm-double', 'review'); has('gtm-body', 'info'); has('gtm-other', 'review');
has('dup-G-SKY4H7Q2LP', 'critical'); has('dup-Meta|481920375512334', 'critical'); has('hard-TikTok', 'review'); has('legacy-', 'review');
has('event-quote_request', 'review'); has('blocked', 'info');
assert.ok(!items.some(i => i.key.includes('|consent|')), 'consent default present, no consent finding');
assert.strictEqual(new Set(items.map(i => i.key)).size, items.length, 'keys are unique');
assert.ok(items.filter(i => i.nodeId).every(i => /^tag:\d+$/.test(i.nodeId)));
const B = SCAN.brief(S, web); assert.strictEqual(B.coverage, 2);
// a page with no GTM at all is reported missing
const S2 = SCAN.summarize(rows.concat([{ url: origin + '/lp', final_url: origin + '/lp', http_status: 200, result: (r => { delete r.links; return r; })(SCAN.detect('<html><head></head><body>landing</body></html>', origin + '/lp')) }]));
assert.ok(SCAN.compare(S2, web, null, site).some(i => i.key.includes('|gtm-partial|') && /Missing on \/lp/.test(i.message))); assert.strictEqual(B.ok, 3);

// nothing readable
assert.strictEqual(SCAN.compare(SCAN.summarize([{ url: 'x', http_status: 403 }]), web, null, site)[0].key.includes('unreadable'), true);

// report writers include the scan section
const REP = require('../src/report.js');
const D = E.build({ web, website: site }); D.report.items = D.report.items.concat(items); D.report.scan = Object.assign(B, { website: site, webId: 'GTM-SKY7Q2L', sitemapUrls: 12, pages: rows.map(r => ({ url: r.url, status: r.result ? 'ok' : 'failed', error: r.error, title: r.result && r.result.title })) });
const md = REP.markdown(D.report); assert.ok(/## Live site scan: skylinecharters.com/.test(md) && /\| Meta \| 481920375512334 \| 1 \|/.test(md));
const { jsPDF } = require('jspdf'); require('jspdf-autotable'); const pdf = REP.pdf(D.report, jsPDF); assert.ok(pdf.byteLength > 5000);
fs.writeFileSync(__dirname + '/scan-out.md', md);
console.log('scan tests passed:', items.length, 'findings');
