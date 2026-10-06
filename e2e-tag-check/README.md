# e2e tag check (feature branch)

The container audit reads the export. It cannot tell you whether the tags actually fire on the site.
This adds that check with [e2e](https://github.com/tester-army/e2e) by TesterArmy: an agent drives the real
funnel in a browser, and the test asserts that the expected GA4 and Meta requests went out.

```
agent.act("open a product and add it to the cart")   ← the agent clicks through the site
browser.route(...)                                    ← code records every GA4 / Meta / sGTM hit
expect(hits).toContain add_to_cart / AddToCart       ← code decides pass or fail
```

e2e replays a passing run with no model calls until the site changes, so a nightly check is cheap.
It fills the "what this audit did not check" section of the Container Atlas report.

## Run

```sh
cd e2e-tag-check
npm install
SITE_URL=https://your-site.example npx e2e test
```

Set `SGTM_HOST` if the site sends to a server-side GTM domain (for example `sst.example.com`).
The agent's model is read from `E2E_MODEL` through the Vercel AI Gateway (`AI_GATEWAY_API_KEY`).

## Jev

e2e can drive steps with Jev instead of an LLM agent (`@e2e-dev/decision`): Jev picks the next action as
a `choice` from the page's elements, never free text. That executor calls TypeSafe directly, and in this
stack every Jev call goes through jev-gateway. So this branch starts with an LLM agent, and switches to
Jev once jev-gateway has a route the decision executor can use.

## Status

Scaffold. Not yet run against a real site. Tag detection uses URL patterns (`/g/collect`, `facebook.com/tr`,
the sGTM host); verify them against your own setup.
