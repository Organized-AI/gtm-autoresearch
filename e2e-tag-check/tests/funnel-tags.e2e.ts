import { test, expect } from 'e2e';

// Every GA4, Meta Pixel and server-side GTM request the page sends, recorded and then let through unchanged.
const sgtm = process.env.SGTM_HOST ? process.env.SGTM_HOST.replace(/\./g, '\\.') : null;
const TAGS = new RegExp(['/g/collect', 'facebook\\.com/tr[/?]', ...(sgtm ? [sgtm] : [])].join('|'));

test('adding to cart fires GA4 add_to_cart and Meta AddToCart', async ({ app, agent, browser }) => {
  const hits: string[] = [];
  await browser.route(TAGS, async (route) => {
    hits.push(`${route.request.url} ${route.request.postData ?? ''}`);
    await route.continue();
  });

  await app.open('/');
  await agent.act('Open any product page and add the product to the cart.');
  await agent.assert('The cart shows at least one item.');

  // Code, not the model, decides whether the tags fired.
  expect(hits.some((h) => /(^|[?&\s])en=add_to_cart(&|\s|$)/.test(h)), 'GA4 add_to_cart was sent').toBeTruthy();
  expect(hits.some((h) => /(^|[?&\s])ev=AddToCart(&|\s|$)/.test(h)), 'Meta AddToCart was sent').toBeTruthy();
});
