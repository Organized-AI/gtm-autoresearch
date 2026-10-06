# GTM Container Atlas

Import a GTM export, confirm the website, add the sGTM export or skip, then review every finding checkpoint by checkpoint and download a PDF and Markdown report. Live at **atlas.organizedai.vip**; the build kit is at **/build**.

| Level | What it does | Needs |
|---|---|---|
| 1 · Audit | Static audit of web + server containers, web → server signal flow, guided review with decisions, report format, PDF and Markdown | A browser |
| 1b · Site scan | Crawls the live site's page source (sitemap + internal links, robots.txt respected) and compares it with the export: GTM coverage, second containers, tags hard-coded outside GTM, dataLayer events no trigger hears, consent | This Worker (Queues + D1) |
| 2 · Drift | Saves the audited export as a baseline; a daily cron compares it with the published `gtm.js` | This Worker (D1 + cron) |
| 3 · Fix | Turns accepted fixes into a GTM workspace and version; publishes only on request | GTM MCP (Stape) in Claude Code or Codex |

Jev runs on Workers AI inside the Worker and reviews every finding as soon as the audit is built; the question pack is in [`../jev-gtm`](../jev-gtm).

## Layout

```
src/            page source: engine (audit), scan (page-source detectors + live-site comparison), report (PDF/MD), drift digests, atlas client, intake + review
fixtures/       fictional Skyline Charters web + server exports (make.mjs regenerates them)
worker/         Cloudflare Worker: static assets + /api/watch, /api/judge, /api/scan (queue consumer), daily cron
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

## Site scan

Step 2 offers **Also scan the live site** when the Worker reports `scan: true` on `/api/health`. Only the domain is sent:

```
POST /api/scan {website, maxPages}  →  seed message: robots.txt + sitemap → pick pages across templates
queue atlas-site-scan               →  one message per page: fetch source, GTM_SCAN.detect, store in D1, add unseen internal links
GET  /api/scan/:id?t=token          →  progress, every page, GTM_SCAN.summarize(pages)
browser                             →  GTM_SCAN.compare(summary, export) → "Site scan" findings in review, PDF and Markdown
```

`src/scan.js` is the single source; `build.py` writes `worker/src/scan-detect.js` from it. Setup: `npx wrangler queues create atlas-site-scan`, re-run `npm run db:init` (adds `scans` and `scan_pages`). Without a queue binding the Worker crawls inline (local dev). Tests: `node test/scan.cjs`, `python3 test/scan-e2e.py`. A preview config (`worker/wrangler.preview.jsonc`) deploys the branch to workers.dev with its own D1 and queue.

The scan reads page source only. Tags GTM fires at runtime are not in the source; a rendered scan with Browser Rendering is the next phase.
