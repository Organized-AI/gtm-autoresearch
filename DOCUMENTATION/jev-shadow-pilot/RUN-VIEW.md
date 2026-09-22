# Local GTM run interface

Run from the repository checkout:

```sh
python3 scripts/gtm_run_view.py \
  --run-dir /private/tmp/gtm-jev-cloudflare-paired-v2-20260922 \
  --package data/jev-shadow/training-pilot-v1-final \
  --port 8765
```

Open http://127.0.0.1:8765. The server stays in the foreground; stop with Ctrl-C. It needs only the Python standard library. Generated packages and recorded results are local artifacts, not bundled with the repository. Use the package matching the selected journal.

The diagram separates the conceptual GTM optimizer from the recorded Jev shadow pipeline. Play, pause, step, reset, or scrub through the finite recorded journal. Highlighting follows actual journal events: run start, atomic request start, and durable results. Offline comparison is displayed separately; a record-finished event does not claim scoring happened at that point. The Judgments tab shows both answers, unreviewed synthetic expected labels, disagreement, probabilities, model, request ID, latency and token usage.

The interface polls every three seconds. It reports complete, partial, unavailable, or an observed writer lock; a lock is evidence of an active journal writer, not proof of provider progress. Replay makes no provider calls. Future authorized runs can be viewed by starting this same server with their run directory and matching package.

The server binds only to loopback, exposes fixed read-only routes, rejects unrelated Host/Origin values and path queries, and projects limited journal metadata. It does not read credentials or expose raw observations. Label comparison requires a completed, unlocked journal, matching score predictions and a verified training package. Missing or invalid data is shown explicitly.

Current recorded baseline: 12 rows, 24 successful requests, paired agreement 9/12 against **unreviewed synthetic generator labels**, and zero insufficient answers. This is research agreement, not human accuracy or calibration. No optimizer loop or GTM publication is running through this interface.
