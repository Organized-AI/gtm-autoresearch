# GTM Container Atlas

Import a GTM export, confirm the website, add the sGTM export or skip, then review every finding checkpoint by checkpoint and download a PDF and Markdown report. Live at **atlas.organizedai.vip**; the build kit is at **/build**.

| Level | What it does | Needs |
|---|---|---|
| 1 · Audit | Static audit of web + server containers, web → server signal flow, guided review with decisions, report format, PDF and Markdown | A browser |
| 2 · Drift | Saves the audited export as a baseline; a daily cron compares it with the published `gtm.js` | This Worker (D1 + cron) |
| 3 · Fix | Turns accepted fixes into a GTM workspace and version; publishes only on request | GTM MCP (Stape) in Claude Code or Codex |

Jev suggestions come from [`../jev-gtm`](../jev-gtm).

## Layout

```
src/            page source: engine (audit), report (PDF/MD), drift digests, atlas client, intake + review
fixtures/       fictional Skyline Charters web + server exports (make.mjs regenerates them)
worker/         Cloudflare Worker: static assets + /api/watch, /api/judge, daily cron
build.py        assembles the single-file page and worker/public/
test/           node engine test, Playwright end-to-end scripts
```

## Run it

```bash
npm install && npm run build      # writes container-atlas.html and worker/public/
cd worker && npm install
npx wrangler d1 create gtm-container-atlas   # paste database_id into wrangler.jsonc
npm run db:init && npm run deploy
```
