# Local GTM run interface

Run from the repository checkout:

```sh
python3 scripts/gtm_run_view.py \
  --run-dir /private/tmp/gtm-jev-cloudflare-rubric-v2-run-20260922 \
  --package data/jev-shadow/training-pilot-rubric-v2-prepared \
  --baseline-run-dir /private/tmp/gtm-jev-cloudflare-paired-v2-20260922 \
  --baseline-package data/jev-shadow/training-pilot-v1-final \
  --port 8765
```

Open http://127.0.0.1:8765. The server stays in the foreground; stop with Ctrl-C. It needs only the Python standard library. Generated packages and recorded results are local artifacts, not bundled with the repository. Use the package matching the selected journal.

The diagram separates the conceptual GTM optimizer from the recorded Jev shadow pipeline. Play, pause, step, reset, or scrub through the finite recorded journal. Highlighting follows actual journal events: run start, atomic request start, and durable results. Offline comparison is displayed separately; a record-finished event does not claim scoring happened at that point. The Judgments tab shows both answers, unreviewed synthetic expected labels, disagreement, probabilities, model, request ID, latency and token usage.

The interface polls every three seconds. It reports complete, partial, unavailable, or an observed writer lock; a lock is evidence of an active journal writer, not proof of provider progress. Replay makes no provider calls. Future authorized runs can be viewed by starting this same server with their run directory and matching package.

The server binds only to loopback, exposes fixed read-only routes, rejects unrelated Host/Origin values and path queries, and projects limited journal metadata. It does not read credentials or expose raw observations. Label comparison requires a completed, unlocked journal, matching score predictions and a verified training package. Missing or invalid data is shown explicitly.

Current v2 replay: 12 rows, 24 successful requests, paired agreement 9/12 against **unreviewed synthetic generator labels**, and two insufficient answers. The Comparison tab shows v1 versus v2 evidence agreement (9/12 → 11/12), unchanged tracking/paired agreement (9/12), fixed fail/pass retention, expected-insufficient results and runtime coverage. Both baseline options must be supplied together; omit both for a single-run viewer. Comparison requires distinct frozen rubric identities, exact record-ID/input-hash correspondence, unchanged expected answers and independently score-verified completed journals. This is research agreement, not human accuracy or calibration. No optimizer loop or GTM publication is running through this interface.

## Private Tailscale access

The viewer still binds to loopback. For access from another Tailscale device, pass the exact private origin with `--allow-origin` (repeatable), then proxy through Tailscale Serve on a dedicated port:

```sh
python3 scripts/gtm_run_view.py \
  --run-dir /private/tmp/gtm-jev-cloudflare-rubric-v2-run-20260922 \
  --package data/jev-shadow/training-pilot-rubric-v2-prepared \
  --baseline-run-dir /private/tmp/gtm-jev-cloudflare-paired-v2-20260922 \
  --baseline-package data/jev-shadow/training-pilot-v1-final \
  --port 8765 \
  --allow-origin http://YOUR-HOST.YOUR-TAILNET.ts.net:8765

tailscale serve --bg --http=8765 http://127.0.0.1:8765
```

Open that private origin from a connected Tailscale device. HTTP travels inside the encrypted Tailscale network. This uses Serve, not public Funnel. Host and Origin checks remain exact; no wildcard access is enabled. The viewer process must remain running. Stop just this route with `tailscale serve --http=8765 off`; do not reset other services.

On macOS with the GUI app installed, the CLI may be `/Applications/Tailscale.app/Contents/MacOS/Tailscale`.

## Visual design

The viewer follows the [OrganizedAI Jev field guide](https://talk.organizedai.vip/jev/): warm near-black surfaces, cream text, JetBrains Mono headings, gold emphasis, restrained cyan and fine borders. Typography is bundled locally under `dashboard/fonts/` with SIL Open Font licenses; the browser does not need Google Fonts access. Diagram/replay, judgment data and frozen comparison checks retain their existing behavior.
