import asyncio, pathlib
from playwright.async_api import async_playwright
html = pathlib.Path('container-atlas.html').read_text()
doc = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"></head><body>' + html + '</body></html>'
pathlib.Path('test/page.html').write_text(doc)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':1500,'height':900}, accept_downloads=True)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
        await pg.goto('file://'+str(pathlib.Path('test/page.html').resolve()))
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path='test/s0-intake.png')
        await pg.click('#sample'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='test/s1-site.png')
        await pg.click('#siteForm button[type=submit]'); await pg.wait_for_timeout(300)
        await pg.click('#sample3'); await pg.wait_for_timeout(3500)
        await pg.screenshot(path='test/s2-atlas.png')
        # decide first two findings
        btns = await pg.query_selector_all('.rv-dec button[data-d=fix]')
        await btns[0].click(); 
        await pg.click('#rvNext'); await pg.wait_for_timeout(300)
        b2 = await pg.query_selector_all('.rv-dec button[data-d=keep]'); await b2[0].click()
        await pg.fill('.rv-note:not([hidden])', 'Pixel ID moves to the constant in the next publish')
        names = await pg.query_selector_all('.rv-name'); await names[0].click(); await pg.wait_for_timeout(900)
        await pg.screenshot(path='test/s3-review.png')
        await pg.click('#rvNext'); await pg.wait_for_timeout(300)
        names = await pg.query_selector_all('.rv-name'); await names[0].click(); await pg.wait_for_timeout(1200)
        await pg.screenshot(path='test/s4-flow.png')
        async with pg.expect_download() as d: await pg.click('#pdfBtn')
        dl = await d.value; await dl.save_as('test/browser.pdf')
        async with pg.expect_download() as d: await pg.click('#mdBtn')
        dl = await d.value; await dl.save_as('test/browser.md')
        print('rvCount', await pg.inner_text('#rvCount'))
        print('ERRORS', errs)
        await b.close()
asyncio.run(main())
