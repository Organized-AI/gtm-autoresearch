import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1500,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8787/'); await pg.wait_for_timeout(1200)
        await pg.click('#sample'); await pg.click('#siteForm button[type=submit]'); await pg.click('#sample3'); await pg.wait_for_timeout(3000)
        print('status:', await pg.inner_text('#jevStatus'), '| setup hidden:', await pg.is_hidden('#jevSetup'))
        await pg.click('#jevChange'); await pg.select_option('#jevProvider','openrouter'); await pg.wait_for_timeout(200)
        print('openrouter status:', await pg.inner_text('#jevStatus'), '| connect visible:', await pg.is_visible('#jevConnect'))
        await pg.select_option('#jevProvider','cloudflare')
        await pg.screenshot(path='/home/claude/atlas/test/jev-bar.png', clip={'x':1100,'y':150,'width':400,'height':400})
        print('ERRORS', errs); await b.close()
asyncio.run(main())
