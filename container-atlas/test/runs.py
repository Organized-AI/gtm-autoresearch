import asyncio, json, urllib.request
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1500,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8787/'); await pg.wait_for_timeout(1200)
        await pg.click('#sample'); await pg.click('#siteForm button[type=submit]'); await pg.click('#sample3'); await pg.wait_for_timeout(3000)
        await pg.wait_for_selector('#compare:not([hidden])', timeout=8000); await pg.click('#cmpClose'); await pg.wait_for_timeout(300)
        await pg.click('#rvClose')
        await pg.click('button:text-is("GTM auto")'); await pg.wait_for_timeout(800)
        for _ in range(3):
            await pg.click('#auStep'); await pg.wait_for_timeout(1500)
        await pg.wait_for_timeout(1000)
        print('store:', await pg.inner_text('#auStore'))
        link = await pg.get_attribute('#auStore a', 'href'); print('link', link)
        await pg.screenshot(path='/home/claude/atlas/test/runs-panel.png')
        rid = link.split('r=')[1].split('&')[0]; t = link.split('t=')[1]
        j = json.load(urllib.request.urlopen(f'http://127.0.0.1:8787/api/runs/{rid}?t={t}'))
        print('api rounds', [(r['round'], r['accepted'], r['score'], len(r['operations'])) for r in j['rounds']], j['baselineScore'], j['bestScore'])
        await pg.goto(f'http://127.0.0.1:8787/runs?r={rid}&t={t}'); await pg.wait_for_timeout(1200)
        await pg.screenshot(path='/home/claude/atlas/test/runs-page.png')
        print('ERRORS', errs); await b.close()
asyncio.run(main())
