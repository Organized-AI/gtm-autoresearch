# Direct Cloudflare Jev transport

The pilot can use Cloudflare Workers AI directly with the official `typesafe/jev` REST model. It does not use the TypeSafe SDK, a generic LLM endpoint, or a deployed worker.

The frozen seed must bind `provider: "cloudflare"` and `model: "typesafe/jev"`. A shadow execution configuration contains that same explicit binding:

```json
{"schemaVersion":"jev-pilot-execution-config-v1","mode":"shadow","provider":"cloudflare","model":"typesafe/jev"}
```

After preflight, an authorized run uses the explicit direct transport:

```sh
python3 scripts/jev_pilot_execute.py run --execute --direct-cloudflare \
  --run-id cloudflare-training-pilot-v1 \
  --package /secure/training-pilot-v1-final \
  --seed-manifest /secure/jev-seeds/tracking-v1/manifest.json \
  --execution-config /secure/jev-execution.json \
  --results /secure/jev-results.jsonl --journal /secure/jev-journal.jsonl
```

Each reserved atomic attempt starts a child process, which sends exactly one `POST` to `https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run`. Redirects and client retries are disabled. The request contains exactly the frozen atomic `choice` question and `{ "observation": ... }` as state. The parent kills the child process on timeout; an error or timeout remains consumed in the durable attempt journal.

The response must contain a resolved Jev model, the requested choice answer, reported confidence, probabilities for every frozen label, and nonnegative integer input/output token usage. The journal and scorer-compatible result records preserve actual resolved-model, request-ID header when available, latency, confidence, probabilities, and usage. Reported confidence does not establish calibration on this GTM dataset. No cost is computed or claimed: Cloudflare pricing and any account limit are dashboard controls, not response fields.

`--execute` is still explicit and the route stays shadow-only. It cannot publish GTM or influence the loop. Expected labels, holdout inputs, validation inputs, and synthetic truth remain unopened by this driver.

## Setup and resume

Provide `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` through the process environment or a secret manager. The token needs Workers AI access for the selected account; an existing Wrangler login without `ai:write` is insufficient. The runner does not discover or refresh credentials. Credentials are passed to the worker environment, never in command arguments or journal entries.

Freeze the real model binding using the pinned Jev runtime (see `NATIVE-SETUP.md`):

```sh
python3 scripts/jev_freeze.py \
  --rubric DOCUMENTATION/jev-shadow-pilot/rubric-v1.json \
  --output /secure/jev-seeds/tracking-v1 \
  --provider cloudflare --model typesafe/jev
```

Use the checked-in `DOCUMENTATION/jev-shadow-pilot/cloudflare-execution.json` as the execution configuration. Reuse the exact run ID and artifact paths to resume; failed or interrupted attempts are never retried. The journal binds the direct transport so a run cannot resume through a different adapter. Local timeout termination does not cancel work already received by Cloudflare.

The direct driver stops after its first error and reports remaining rows. An explicit resume skips the consumed failed row and continues with unattempted rows. Cloudflare's completed gateway envelope is supported; see `CLOUDFLARE-LIVE-VERIFICATION.md` for the observed live response and partial-pilot accounting.

Official contract: [Cloudflare Jev model](https://developers.cloudflare.com/ai/models/typesafe/jev/), [input schema](https://developers.cloudflare.com/ai/models/typesafe/jev/schema-input.json), [output schema](https://developers.cloudflare.com/ai/models/typesafe/jev/schema-output.json). The model alias is `typesafe/jev`, without an `@cf/` prefix. Direct responses and standard successful `result` envelopes are supported. Only sanitized error categories and numeric HTTP/API codes are retained.
