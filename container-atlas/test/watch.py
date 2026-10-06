import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1500,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/?v=2'); await pg.wait_for_timeout(1200)
        await pg.click('#sample'); await pg.click('#siteForm button[type=submit]'); await pg.click('#sample3'); await pg.wait_for_timeout(3000)
        await pg.wait_for_selector('#compare:not([hidden])', timeout=8000); await pg.click('#cmpClose'); await pg.wait_for_timeout(300)
        btns = await pg.query_selector_all('#rvCps button'); await btns[-1].click(); await pg.wait_for_timeout(500)
        await pg.click('.rv-watch .btn'); await pg.wait_for_timeout(4000)
        print('panel:', (await pg.inner_text('.rv-watch'))[-330:])
        link = await pg.get_attribute('.rv-wresult a', 'href'); print('link', link)
        if link:
            link = link.replace('http://atlas.organizedai.vip', BASE).replace('https://atlas.organizedai.vip', BASE)
            await pg.goto(link); await pg.wait_for_timeout(1500)
            print('drift:', (await pg.inner_text('main'))[:900])
            await pg.screenshot(path='/home/claude/atlas/test/drift-demo.png')
        print('ERRORS', errs); await b.close()
asyncio.run(main())
