import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1500,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('https://atlas.organizedai.vip/'); await pg.wait_for_timeout(1500)
        await pg.click('#sample'); await pg.click('#siteForm button[type=submit]'); await pg.click('#sample3')
        await pg.wait_for_selector('#compare:not([hidden])', timeout=8000); await pg.click('#cmpClose'); await pg.wait_for_timeout(300)
        for i in range(60):
            await pg.wait_for_timeout(2000)
            st = await pg.inner_text('#jevStatus')
            if st.startswith('Reviewed'): break
        print('status:', st, '| chips on page:', len(await pg.query_selector_all('.rv-jevbtn')))
        print('accept btn:', await pg.is_visible('#jevAccept') and await pg.inner_text('#jevAccept'))
        await pg.screenshot(path='/home/claude/atlas/test/live-jev2.png')
        if await pg.is_visible('#jevAccept'):
            await pg.click('#jevAccept'); await pg.wait_for_timeout(500)
            print('after accept:', await pg.inner_text('#rvCount'))
        await pg.goto('https://atlas.organizedai.vip/build'); await pg.wait_for_timeout(1200); await pg.screenshot(path='/home/claude/atlas/test/live-build2.png', full_page=True)
        print('ERRORS', errs); await b.close()
asyncio.run(main())
