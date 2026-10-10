# Agent and bot traffic

Two layers, because no single place sees all of it.

| Traffic | Runs the GTM container? | Where it's classified |
| --- | --- | --- |
| People, including people arriving from ChatGPT, Perplexity, Claude, Gemini, Copilot | yes | web GTM: `ai_referrer` |
| Browser agents and automation (cloud browsers, Playwright, Puppeteer, Selenium) | yes | web GTM: `traffic_class` from `navigator.webdriver` and the user agent |
| AI crawlers and user-triggered fetchers (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, PerplexityBot, Perplexity-User, and others) | usually not | edge: `edge-worker.js` |
| Signed agents (Signature-Agent header, Web Bot Auth) | sometimes, but the signature is a request header page JavaScript can't read | edge: `edge-worker.js` |

## Web layer: `gtm-fragment.json`

Eight variables built from GTM's own types (JavaScript Variable, HTTP Referrer, URL, Regex Table, Lookup Table), and two rows on the Google tag:

- `traffic_class` = `{{LT - Traffic Class}}`: human, automation, ai_openai, ai_anthropic, ai_perplexity, ai_meta, ai_other, bot_other
- `ai_referrer` = `{{RT - AI Referrer}}`: chatgpt, perplexity, claude, gemini, copilot, none

No Custom JavaScript or Custom HTML, so it doesn't trip the Jev container guide's opaque-code hard stop. It classifies; it never blocks a tag. In GA4, register both as event-scoped custom dimensions.

GTM Autoresearch scores this as an opt-in 13th dimension, `agentTraffic` (weight 0.08; every other weight × 0.92), switched on by `Agent traffic dimension: on` in a client's program.md. It's off by default, so recorded scores don't move.

| Part | Credit |
| --- | --- |
| JavaScript Variable reading `navigator.webdriver` | 0.20 |
| Regex Table classifying the user agent (AI agents + automation) | 0.25 |
| Google tag sends `traffic_class` from the classifier | 0.20 |
| Regex Table on `utm_source` for AI assistants | 0.05 |
| Regex Table on the referrer for AI assistants | 0.15 |
| Google tag sends `ai_referrer` | 0.15 |

When the loop targets it, the mutation prompt carries a four-round recipe in which every round raises the score, so keep/revert doesn't throw away half-built work. `tests/agent-traffic.test.ts` builds it on BLADE's best container through the real mutation validator: 4 rounds, at most 3 edits each, score up every round, agentTraffic 0% → 100%.

## Edge layer: `edge-worker.js`

A pass-through Cloudflare Worker route in front of the site. It classifies by user agent and the Signature-Agent header, writes each non-human request to Workers Analytics Engine, and can send an `ai_crawler_hit` event to GA4 through the Measurement Protocol so both layers land in one property. It names the claimed agent; verifying the signature (or using Cloudflare's verified bots) is the stronger check.

## Limits

- User agents can be spoofed, and many browser agents present an ordinary Chrome user agent. `navigator.webdriver` catches default automation, not agents that hide it.
- AI referrer detection depends on the referrer or `utm_source` surviving; apps and some browsers strip it.
- The scorer's variable hygiene counts a variable that only other variables reference as an orphan, so the chained tables cost a little hygiene score. Chained lookup tables are normal GTM; that rule is worth fixing in evals/.
- Token lists change. Sources checked 2026-10-10: OpenAI's ChatGPT agent allowlisting page, published AI crawler references.
