# Local GTM run interface

## Managed macOS service

The private dashboard is now managed by the per-user LaunchAgent `com.organizedai.gtm-run-view`. The earlier foreground process ended with its task session, causing Tailscale to return HTTP 502. The service starts at login and restarts after exit. It uses a versioned copy of the viewer, fonts, and verified completed-run artifacts under `~/Library/Application Support/GTM Autoresearch/`, outside temporary task storage. The existing Tailscale Serve route is unchanged.

To install or update the managed viewer from a healthy checkout, run:

```sh
/opt/homebrew/bin/python3 scripts/install_gtm_run_view.py \
  --run-dir /private/tmp/gtm-jev-cloudflare-rubric-v2-run-20260922 \
  --package data/jev-shadow/training-pilot-rubric-v2-prepared \
  --baseline-run-dir /private/tmp/gtm-jev-cloudflare-paired-v2-20260922 \
  --baseline-package data/jev-shadow/training-pilot-v1-final \
  --port 8765 \
  --allow-origin http://jordans-mac-mini.tailb35295.ts.net:8765 \
  --allow-origin http://100.86.248.8:8765
```

The installer validates both completed runs before copying a fixed list of scripts and artifacts. It copies no credentials, validation data or holdout data and makes no provider calls. A deployment manifest records copied file hashes. **Rerun the installer after frontend changes or to display a newly completed comparison**; the service serves its installed copy, not the working checkout. It intentionally refuses active or unverified comparisons.

Service definition: `~/Library/LaunchAgents/com.organizedai.gtm-run-view.plist`. Logs: `~/Library/Application Support/GTM Autoresearch/logs/`. Check with `launchctl print gui/$(id -u)/com.organizedai.gtm-run-view`; restart with `launchctl kickstart -k gui/$(id -u)/com.organizedai.gtm-run-view`. To stop it, use `launchctl bootout gui/$(id -u)/com.organizedai.gtm-run-view`. Do not run a second foreground server on its port.

Verified recovery by terminating only the managed viewer process: launchd restarted it with a new PID, and the private page and comparison API returned HTTP 200 again.

## Manual foreground mode

### Scored container downloads

Prepare a bundle with `scripts/prepare-gtm-export.ts` (see README Usage), then pass `--export-bundle /absolute/path/to/bundle` to the installer or foreground viewer. The installer verifies and copies only `container.json`, `report.json` and `manifest.json` into its stable release. Subsequent reinstalls retain the installed bundle when the option is omitted.

The Container export tab is independent of the Jev pilot. It shows the selected container's deterministic score, optional baseline, source identity, validation blockers and import instructions. It never represents pilot agreement as a container score. Routes are fixed and inherit the same exact Host/Origin checks:

- `GET /api/export`: bundle availability, readiness and score report.
- `GET /exports/container.json`: exact scored bytes as an attachment, only when offline checks pass.
- `GET /exports/report.json`: score and validation report, including blocked exports.
- `GET /exports/manifest.json`: artifact checksums.

All artifacts are checksum-verified together on each request; missing or changed bytes disable downloads. The browser clears export links on connection failures. These routes do not call providers or GTM. Offline readiness is for import review; Google's own import preview and tracking QA remain separate.

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

## Synthetic data downloads

Pass `--synthetic-bundle /absolute/path/to/bundle` to the installer after running `scripts/prepare_blade_synthetic.py`. It validates and copies exactly `summary.json` and `dataset.zip`; reinstalls retain the installed bundle when omitted. The Synthetic data tab offers `/synthetic/dataset.zip` and `/synthetic/summary.json`; `/api/synthetic` reports verified availability. These fixed routes inherit the private Host/Origin rules. The ZIP excludes local oracle files. Its GTM-shaped simulation fixtures are distinct from the real scored container in Container export.
