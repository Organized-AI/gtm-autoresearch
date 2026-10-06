import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1500,'height':900}, accept_downloads=True)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8787/'); await pg.wait_for_timeout(1500)
        await pg.click('#sample'); await pg.click('#siteForm button[type=submit]'); await pg.click('#sample3'); await pg.wait_for_timeout(3000)
        await pg.wait_for_selector('#compare:not([hidden])', timeout=8000); await pg.click('#cmpClose'); await pg.wait_for_timeout(300)
        print('jevbar visible', await pg.is_visible('#rvJev'))
        btns = await pg.query_selector_all('#rvCps button'); await btns[-1].click(); await pg.wait_for_timeout(400)
        await pg.fill('#fmt-title', 'Tracking health check'); await pg.fill('#fmt-preparedBy', 'Organized AI'); await pg.fill('#fmt-preparedFor', 'Skyline Charters')
        sw = await pg.query_selector_all('.rv-swatches button'); await sw[2].click()
        await pg.uncheck('#fmt-s-inventory')
        await pg.click('.rv-watch .btn'); await pg.wait_for_timeout(2500)
        print('watch result:', (await pg.inner_text('.rv-watch'))[-260:])
        await pg.screenshot(path='test/s5-final.png')
        async with pg.expect_download() as d: await pg.click('#pdfBtn')
        await (await d.value).save_as('test/fmt.pdf')
        async with pg.expect_download() as d: await pg.click('#mdBtn')
        await (await d.value).save_as('test/fmt.md')
        print('ERRORS', errs); await b.close()
asyncio.run(main())
