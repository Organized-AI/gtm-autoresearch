// Autoresearch in a Box: suite Worker.
// Serves the guide (/) and run view (/run/) from Assets, takes run events from
// `arb` over POST /api/events, and streams them to any viewer over SSE at
// /api/stream. The stream is the proof: every check, ledger round and AutoLoop habit
// a client sees arrived from a real `arb` run, in order, with its run_id.

const KINDS = new Set(["run.start", "check", "run.end", "loop.stage", "loop.round", "autoloop.habit", "autoloop.proposal", "approval"]);

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, url);
    } catch (err) {
      return json({ error: "internal_error", detail: String(err?.message || err) }, 500);
    }
  },

  // Nightly: dispatch box.yml in the repo, which runs `arb check all` and
  // `arb autoloop` and streams both here. The GTM loop itself still runs on the
  // Mac, because it needs the Claude CLI and the MCP-fed ads snapshot.
  async scheduled(_e, env, ctx) {
    if (!env.GITHUB_TOKEN || !env.LOOP_REPO) return;
    ctx.waitUntil(fetch(`https://api.github.com/repos/${env.LOOP_REPO}/actions/workflows/box.yml/dispatches`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "autoresearch-in-a-box" },
      body: JSON.stringify({ ref: "main" }),
    }));
  },
};

async function api(req, env, url) {
  const p = url.pathname, m = req.method;

  if (m === "GET" && p === "/api/health") return json({ ok: true, at: new Date().toISOString() });
  if (m === "GET" && p === "/api/status") return json(await status(env));
  if (m === "GET" && p === "/api/events") return json(await since(env, Number(url.searchParams.get("after") || 0), 500));
  if (m === "GET" && p === "/api/stream") return stream(req, env, Number(url.searchParams.get("after") || 0));

  if (m === "POST" && p === "/api/events") {
    const auth = req.headers.get("authorization") || "";
    if (!env.ARB_INGEST_TOKEN || auth !== `Bearer ${env.ARB_INGEST_TOKEN}`) {
      return json({ error: "unauthorized", fix: "Send Authorization: Bearer $ARB_INGEST_TOKEN" }, 401);
    }
    const ev = await req.json();
    if (!ev.run_id || !KINDS.has(ev.kind)) return json({ error: "bad_event", fix: `kind must be one of ${[...KINDS].join(", ")}` }, 400);
    // An approval can only come from the token holder, never from the browser.
    const r = await env.DB.prepare(
      "INSERT INTO events (run_id, seq, at, kind, body) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (run_id, seq) DO NOTHING RETURNING id",
    ).bind(ev.run_id, ev.seq ?? 0, ev.at || new Date().toISOString(), ev.kind, JSON.stringify(ev)).first();
    return json({ ok: true, id: r?.id ?? null }, 201);
  }

  return json({ error: "not_found" }, 404);
}

async function since(env, after, limit) {
  const { results } = await env.DB.prepare("SELECT id, body FROM events WHERE id > ?1 ORDER BY id LIMIT ?2").bind(after, limit).all();
  return results.map((r) => ({ id: r.id, ...JSON.parse(r.body) }));
}

// SSE: replay everything after `after`, then poll D1 for new rows. Each SSE id
// is the D1 row id, so a reconnecting EventSource resumes via Last-Event-ID.
function stream(req, env, after) {
  const last = Number(req.headers.get("last-event-id") || after || 0);
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  (async () => {
    let cursor = last;
    const deadline = Date.now() + 25_000; // Workers cap a request; EventSource reconnects on its own.
    await w.write(enc.encode(`retry: 2000\n: autoresearch-in-a-box stream\n\n`));
    while (Date.now() < deadline) {
      const rows = await since(env, cursor, 100);
      for (const r of rows) {
        cursor = r.id;
        await w.write(enc.encode(`id: ${r.id}\nevent: ${r.kind}\ndata: ${JSON.stringify(r)}\n\n`));
      }
      if (!rows.length) await w.write(enc.encode(`: ping\n\n`));
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    await w.close();
  })().catch(() => w.abort());
  return new Response(readable, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" },
  });
}

async function status(env) {
  const latest = await env.DB.prepare(
    "SELECT run_id, MAX(at) AS at FROM events WHERE kind = 'run.end' GROUP BY run_id ORDER BY at DESC LIMIT 1",
  ).first();
  if (!latest) return { runs: 0, latest: null, checks: [] };
  const { results } = await env.DB.prepare("SELECT body FROM events WHERE run_id = ?1 AND kind = 'check' ORDER BY seq").bind(latest.run_id).all();
  const checks = results.map((r) => {
    const b = JSON.parse(r.body);
    return { gate: b.gate, check_id: b.check_id, result: b.result, reason: b.reason };
  });
  const runs = (await env.DB.prepare("SELECT COUNT(DISTINCT run_id) AS n FROM events").first()).n;
  return { runs, latest, checks };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}
