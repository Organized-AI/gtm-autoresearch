# Direct Cloudflare verification — 2026-09-22

The direct integration is verified against Cloudflare's `typesafe/jev` model, resolving to `jev-1.13.0`. It remains default-off and shadow-only. BLADE exports remain JSON-shape references. No GTM publishing, loop acceptance changes, calibration, holdout access, or merge occurred.

The real provider response differed from the model page's example: the standard Cloudflare envelope contained a second gateway wrapper with `state: "Completed"` and `result: {model, answers, usage}`. The adapter now accepts that observed shape, the standard single envelope, and the documented direct response. Pending/failed gateway responses and API errors are rejected.

## Request accounting

Run ID: `cloudflare-training-pilot-v1-20260922`. Frozen seed manifest hash: `331c3903fd93776d167e50f3382b1059df09a7bcf4d22dc9b49b219435538ab2`.

| Attempts | Outcome |
| --- | --- |
| 1–12 | First atomic question for each pilot row. Initial parser rejected the missing top-level model. Responses were not retained; predictions and usage are unavailable. |
| 13 | Previously unattempted second question on row 1. Original response preserved; parser rejected it. After the fix, offline revalidation recovered a valid answer without a new request. The original error journal entry is preserved. |
| 14 | Previously unattempted second question on row 2. Corrected direct adapter returned a valid answer and actual metadata. |

Exactly 14 attempts are recorded in the original durable journal; no consumed key was replayed. The two diagnostic questions were reserved under the same journal lock and 24-attempt cap. The driver now stops after the first direct error, preserving other rows for explicit resume.

## Observed metadata

| Field | Attempt 13, recovered locally | Attempt 14, live adapter success |
| --- | --- | --- |
| Function | trackingBehaviorPreserved | trackingBehaviorPreserved |
| Model | jev-1.13.0 | jev-1.13.0 |
| Choice | pass | fail |
| Reported confidence | 0.28 | 0.97 |
| Probabilities, pass / fail / insufficient | 0.52 / 0.44 / 0.04 | 0.01 / 0.99 / 0 |
| Input / output tokens | 7,637 / 49 | 14,123 / 49 |
| Transport latency | Not retained | 875.749 ms |
| Request ID | Not retained | a3f2f3dff88745ee-DFW |

These are model outputs, not correctness claims. Confidence need not equal the winning probability. Usage for the first 12 attempts is unavailable; neither total token usage nor total cost is known. No price or dollar limit is inferred.

## Evidence and limits

Local artifacts are in `/private/tmp/gtm-jev-cloudflare-live-20260922/`. Journal SHA256: `b332db234287652a836e7e22f33cb0fbf73072c0677de96722cc83b695cbda07`. Preserved attempt-13 response SHA256: `8ef09a61c13e5cdb4b4948490d26772e78e40fd474483d4bd6a7aa59c4a97298`. The recovery artifact omits unrecorded latency and request ID.

The original 12 paired result records remain errors because their first atomic answers were not retained. No synthetic-label score was calculated; a fresh complete paired pilot is still needed. Synthetic expected labels remain generator-defined and unreviewed. Validation and holdout inputs/truth were not opened.

Verification: 29 Python tests, 37 TypeScript tests, and TypeScript typecheck passed. The loopback redirect test requires local socket access. Live verification used the approved Wrangler OAuth token through process memory/environment, without writing credentials to the repository or command arguments.
