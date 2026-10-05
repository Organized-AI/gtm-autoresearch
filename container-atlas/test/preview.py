import asyncio, pathlib
from playwright.async_api import async_playwright
html = pathlib.Path('container-atlas.html').read_text()
pathlib.Path('test/page.html').write_text('<!doctype html><html><head><meta charset=utf8></head><body>' + html + '</body></html>')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1440,'height':900}, accept_downloads=True)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://'+str(pathlib.Path('test/page.html').resolve())); await pg.wait_for_timeout(800)
        await pg.click('#sample'); await pg.click('#siteForm button[type=submit]'); await pg.click('#sample3'); await pg.wait_for_timeout(2500)
        await pg.click('#previewBtn'); await pg.wait_for_timeout(6000)
        print('meta:', await pg.inner_text('#pvMeta'), '| msg:', await pg.inner_text('#pvMsg'), '| canvases:', len(await pg.query_selector_all('#pvPages canvas')))
        await pg.screenshot(path='test/pv.png')
        async with pg.expect_download() as d: await pg.click('#pvDownload')
        print('download:', (await d.value).suggested_filename)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300); print('closed:', await pg.is_hidden('#pv'))
        await pg.set_viewport_size({'width':390,'height':844}); await pg.click('#previewBtn'); await pg.wait_for_timeout(5000); await pg.screenshot(path='test/pv-phone.png')
        print('ERRORS', errs); await b.close()
asyncio.run(main())
