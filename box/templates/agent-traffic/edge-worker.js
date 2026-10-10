// Edge layer for agent and bot traffic: the part a web GTM container can't see.
// Run as a Cloudflare Worker route in front of the client's site. It never blocks
// or changes the response; it classifies each request and records it.
//
//   - AI crawlers and user-triggered fetchers (GPTBot, ClaudeBot, ChatGPT-User, ...)
//     usually fetch HTML without running JavaScript, so GTM never fires for them.
//   - Signed agents (ChatGPT's cloud browser, others using Web Bot Auth) send
//     Signature, Signature-Input and Signature-Agent headers (RFC 9421). Page
//     JavaScript can't read request headers; the edge can.
//
// Records go to Workers Analytics Engine (binding AGENT_LOG). Optionally each
// HTML hit is also sent to GA4 as an ai_crawler_hit event through the Measurement
// Protocol (GA4_MEASUREMENT_ID + GA4_API_SECRET), so web and edge traffic share
// one report. This header check names the claimed agent; verifying the signature
// against the agent's published key directory is a separate, stronger step
// (Cloudflare's verified bots / signed agents do it for you).

const UA_CLASSES = [
  [/GPTBot|OAI-SearchBot|ChatGPT-User/i, "ai_openai"],
  [/ClaudeBot|Claude-SearchBot|Claude-User/i, "ai_anthropic"],
  [/PerplexityBot|Perplexity-User/i, "ai_perplexity"],
  [/Meta-ExternalAgent|meta-externalfetcher/i, "ai_meta"],
  [/Amazonbot|Applebot|Bytespider|CCBot/i, "ai_other"],
  [/HeadlessChrome|Puppeteer|Playwright|PhantomJS|Selenium/i, "automation"],
  [/bot|crawl|spider|slurp/i, "bot_other"],
];

export function classify(req) {
  const ua = req.headers.get("user-agent") || "";
  const signer = (req.headers.get("signature-agent") || "").replace(/"/g, "");
  const signed = Boolean(req.headers.get("signature") && req.headers.get("signature-input"));
  if (signed && signer) return { traffic_class: "ai_signed_agent", agent: signer, signed, ua };
  for (const [re, cls] of UA_CLASSES) if (re.test(ua)) return { traffic_class: cls, agent: (ua.match(re) || [cls])[0], signed, ua };
  return { traffic_class: "human", agent: "", signed, ua };
}

export default {
  async fetch(req, env, ctx) {
    const res = await fetch(req);
    const c = classify(req);
    if (c.traffic_class !== "human") {
      const url = new URL(req.url);
      const html = (res.headers.get("content-type") || "").includes("text/html");
      ctx.waitUntil(record(env, c, url, res.status, html));
    }
    return res;
  },
};

async function record(env, c, url, status, html) {
  env.AGENT_LOG?.writeDataPoint({
    blobs: [c.traffic_class, c.agent, url.hostname, url.pathname, c.signed ? "signed" : "unsigned"],
    doubles: [status],
    indexes: [c.traffic_class],
  });
  if (!html || !env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) return;
  const endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${env.GA4_MEASUREMENT_ID}&api_secret=${env.GA4_API_SECRET}`;
  await fetch(endpoint, {
    method: "POST",
    body: JSON.stringify({
      client_id: `edge.${c.traffic_class}`,
      events: [{ name: "ai_crawler_hit", params: { traffic_class: c.traffic_class, agent: c.agent.slice(0, 100), page_location: url.href, signed: c.signed ? "yes" : "no" } }],
    }),
  });
}
