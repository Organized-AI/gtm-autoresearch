import asyncio, pathlib, sys
from playwright.async_api import async_playwright
html = pathlib.Path('container-atlas.html').read_text()
pathlib.Path('test/page.html').write_text('<!doctype html><html><head><meta charset=utf8></head><body>' + html + '</body></html>')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1500,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://'+str(pathlib.Path('test/page.html').resolve())); await pg.wait_for_timeout(800)
        await pg.click('#sample'); await pg.click('#siteForm button[type=submit]'); await pg.click('#sample3'); await pg.wait_for_timeout(2500)
        await pg.wait_for_selector('#compare:not([hidden])', timeout=8000); await pg.click('#cmpClose'); await pg.wait_for_timeout(300)
        await pg.click('#rvClose'); await pg.wait_for_timeout(800)
        for v in ['structured','spatial','axonometric']:
            await pg.click('button:text-is("%s")' % {'structured':'Structured','spatial':'Free-form','axonometric':'Axonometric'}[v]); await pg.wait_for_timeout(900)
            z = await pg.inner_text('#zoomLevel') if await pg.query_selector('#zoomLevel') else '?'
            print(v, z); await pg.screenshot(path=f'test/c-{v}.png')
        tabs = await pg.query_selector_all('.tabs button, #tabs button')
        for t in tabs:
            if 'Server flow' in (await t.inner_text()): await t.click(); await pg.wait_for_timeout(1200)
        print('flow', await pg.inner_text('#zoomLevel') if await pg.query_selector('#zoomLevel') else '?')
        await pg.screenshot(path='test/c-flow.png')
        print('ERRORS', errs); await b.close()
asyncio.run(main())
