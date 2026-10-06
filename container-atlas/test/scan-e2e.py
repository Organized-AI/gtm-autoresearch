# Intake with the live-site scan, against a mocked Worker: health → POST /api/scan → polling → findings in review and report.
import asyncio, json, pathlib, subprocess
from playwright.async_api import async_playwright
here = pathlib.Path(__file__).parent
index = (here.parent / 'worker/public/index.html').read_text()
# the Worker's summary for three pages, produced by the real detector
summary = json.loads(subprocess.check_output(['node', '-e', '''
const S=require("./src/scan.js"),o="https://www.skylinecharters.com";
const pg={"/":"<html><head><title>Home</title><script>(function(w,d,s,l,i){w[l].push({\\'gtm.start\\':1});j.src=\\'https://www.googletagmanager.com/gtm.js?id=\\'+i})(window,document,\\'script\\',\\'dataLayer\\',\\'GTM-SKY7Q2L\\');</script><script async src=\\"https://www.googletagmanager.com/gtag/js?id=G-SKY4H7Q2LP\\"></script></head><body>x</body></html>","/lp":"<html><head><title>LP</title></head><body>landing</body></html>"};
const rows=Object.keys(pg).map(p=>{const r=S.detect(pg[p],o+p);delete r.links;return{url:o+p,final_url:o+p,http_status:200,result:r}});
console.log(JSON.stringify(S.summarize(rows)));'''], cwd=here.parent))
polls = {'n': 0}
def status():
    polls['n'] += 1
    done = polls['n'] > 2
    pages = [{'url': 'https://www.skylinecharters.com/', 'status': 'ok', 'title': 'Home'}, {'url': 'https://www.skylinecharters.com/lp', 'status': 'ok' if done else 'queued', 'title': 'LP'}]
    return {'id': 'abc', 'website': 'skylinecharters.com', 'status': 'done' if done else 'running', 'maxPages': 25, 'queued': 2, 'done': 2 if done else 1, 'failed': 0, 'sitemapUrls': 40, 'pages': pages, 'summary': summary if done else None}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1500, 'height': 900}, accept_downloads=True)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        sent = []
        async def handle(route, req):
            u = req.url
            if u.endswith('/api/health'): return await route.fulfill(json={'ok': True, 'scan': True, 'scanMaxPages': 25})
            if u.endswith('/api/scan') and req.method == 'POST': sent.append(req.post_data); return await route.fulfill(json={'id': 'abc', 'token': 'tok', 'website': 'skylinecharters.com', 'maxPages': 25})
            if '/api/scan/abc' in u: return await route.fulfill(json=status())
            if '/api/' in u: return await route.fulfill(status=404, json={})
            if u.startswith('https://atlas.test/'): return await route.fulfill(body=index, content_type='text/html')
            return await route.continue_()
        await pg.route('**/*', handle)
        await pg.goto('https://atlas.test/'); await pg.wait_for_timeout(800)
        assert await pg.is_visible('#scanOpt') is False  # step 2 not open yet
        await pg.set_input_files('#file1', str(here.parent / 'fixtures/sample-web.json')); await pg.wait_for_timeout(300)
        assert await pg.is_visible('#scanOpt'), 'scan option shown when the Worker offers it'
        assert await pg.eval_on_selector_all('#scanMax option', 'o => o.map(x => x.value)') == ['10', '25']
        await pg.screenshot(path=str(here / 'scan-1-step2.png'))
        await pg.click('#siteForm button[type=submit]'); await pg.wait_for_timeout(200)
        body = json.loads(sent[0]); assert body == {'website': 'skylinecharters.com', 'maxPages': 25}, body
        assert 'containerVersion' not in sent[0]
        await pg.click('#skip3'); await pg.wait_for_timeout(500)
        await pg.wait_for_selector('#compare:not([hidden])', timeout=8000); await pg.click('#cmpClose'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=str(here / 'scan-2-progress.png'))
        await pg.wait_for_selector('#app:not([hidden])', timeout=15000); await pg.wait_for_timeout(800)
        first = await pg.inner_text('.rv-panel')
        assert 'Live site' in first, first[:400]
        await pg.screenshot(path=str(here / 'scan-3-review.png'))
        rep = await pg.evaluate('window.__report')
        keys = [i['key'] for i in rep['items'] if i['check'] == 'Site scan']
        print('scan items:', keys)
        assert any('|gtm-partial|' in k for k in keys) and any('|dup-G-SKY4H7Q2LP|' in k for k in keys)
        assert rep['scan']['coverage'] == 1 and rep['scan']['ok'] == 2
        async with pg.expect_download() as d: await pg.click('#mdBtn')
        md = pathlib.Path(await (await d.value).path()).read_text()
        assert '## Live site scan: skylinecharters.com' in md and '**Pages read:** 2 of 2' in md
        print('errors:', errs); assert not errs
        await b.close()
asyncio.run(main())
print('scan e2e passed')
