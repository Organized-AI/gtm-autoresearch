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
SITE_URL=https://your-site.example JEV_GATEWAY_TOKEN=... npx e2e run
```

Set `SGTM_HOST` if the site sends to a server-side GTM domain (for example `sst.example.com`).

## Jev, through jev-gateway

Each browser action is a Jev `choice` question (which element moves the goal forward), sent to
jev-gateway's `POST /v1/decide` by `jev-gateway-decision.ts`, an AI SDK decision model with no dependencies.
Jev never writes free text, and nothing in this folder calls TypeSafe directly.

- `JEV_GATEWAY_TOKEN`: the gateway bearer token. `JEV_GATEWAY_URL` overrides the default gateway URL.
- `JEV_DECIDE_MODEL`: a jev-gateway route alias (default `jev-latest`). Point the alias at a tuned decision
  model in the gateway's `DECIDE_ROUTES` and this test follows with no change.
- Every call is logged in AI Gateway and audited in jev-gateway's D1 `decisions` table with consumer
  `e2e-tag-check` (shape and usage only, never page content).
- No text model is set, so the agent never types into fields. Adding to the cart needs only clicks.

## Local check

`npm run check:local` starts `local/fake-gateway.mjs`, a two-page test shop plus a stand-in for
`/v1/decide`, and runs the test against it. It proves the wiring without a real token: e2e drives Chromium,
every action is a choice sent through `jev-gateway-decision.ts`, and code checks the tag requests. The
stand-in picks options by keyword. It is not Jev. Remove the Meta pixel from `local/site/product.html` and the
test fails with "Meta AddToCart was sent: expected false to be truthy".

Needs Node 24.8 or newer (or 22.22.3+), which e2e requires.

## Status

Verified locally against the stand-in gateway: the test passes (5 decision calls, all through the adapter
with consumer `e2e-tag-check`) and fails when the Meta pixel is missing. On a rerun e2e replayed from its
cache with 3 decision calls instead of 5. Not yet run against a real site or real Jev. Tag detection uses URL
patterns (`/g/collect`, `facebook.com/tr`, the sGTM host); verify them against your own setup.
