import { test, expect } from 'e2e';

// Every GA4, Meta Pixel and server-side GTM request the page sends, recorded and then let through unchanged.
const sgtm = process.env.SGTM_HOST ? process.env.SGTM_HOST.replace(/\./g, '\\.') : null;
const TAGS = new RegExp(['/g/collect', 'facebook\\.com/tr[/?]', ...(sgtm ? [sgtm] : [])].join('|'));

test('adding to cart fires GA4 add_to_cart and Meta AddToCart', async ({ app, agent, browser }) => {
  const hits: string[] = [];
  // True when a recorded request carries this exact query parameter, in the URL or a batched body line.
  const sent = (param: string) => hits.some((h) => new RegExp(`(^|[?&\\s])${param}(&|\\s|$)`).test(h));
  await browser.route(TAGS, async (route) => {
    hits.push(`${route.request.url} ${route.request.postData ?? ''}`);
    await route.continue();
  });

  await app.open('/');
  await agent.act('Open any product page and add the product to the cart.');
  await agent.assert('The cart shows at least one item.');

  // Code, not the model, decides whether the tags fired.
  expect(sent('en=add_to_cart'), 'GA4 add_to_cart was sent').toBeTruthy();
  expect(sent('ev=AddToCart'), 'Meta AddToCart was sent').toBeTruthy();
});
