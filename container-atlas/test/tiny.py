import asyncio, pathlib, json
from playwright.async_api import async_playwright
tiny = {"exportFormatVersion":2,"containerVersion":{"accountId":"100","containerId":"200","container":{"name":"tiny.example.com","publicId":"GTM-TINY200","usageContext":["WEB"]},
 "tag":[{"tagId":"1","name":"purchase tag","type":"gaawe","firingTriggerId":["2"],"parameter":[{"type":"TEMPLATE","key":"eventName","value":"purchase"},{"type":"TEMPLATE","key":"measurementIdOverride","value":"G-ABC1234567"}]}],
 "trigger":[{"triggerId":"2","name":"CE - purchase","type":"CUSTOM_EVENT","customEventFilter":[{"type":"EQUALS","parameter":[{"type":"TEMPLATE","key":"arg0","value":"{{_event}}"},{"type":"TEMPLATE","key":"arg1","value":"purchase"}]}]}],
 "builtInVariable":[{"type":"EVENT","name":"Event"}]}}
pathlib.Path('test/tiny.json').write_text(json.dumps(tiny))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1500,'height':900})
        await pg.goto('file://'+str(pathlib.Path('test/page.html').resolve())); await pg.wait_for_timeout(800)
        await pg.set_input_files('#file1', 'test/tiny.json'); await pg.wait_for_timeout(300)
        await pg.fill('#site','tiny-shop.com'); await pg.click('#siteForm button[type=submit]'); await pg.click('#skip3'); await pg.wait_for_timeout(2500)
        await pg.wait_for_selector('#compare:not([hidden])', timeout=8000); await pg.click('#cmpClose'); await pg.wait_for_timeout(300)
        await pg.click('#rvClose'); await pg.wait_for_timeout(900)
        print(await pg.inner_text('#zoomLevel')); await pg.screenshot(path='test/c-tiny.png')
        await b.close()
asyncio.run(main())
