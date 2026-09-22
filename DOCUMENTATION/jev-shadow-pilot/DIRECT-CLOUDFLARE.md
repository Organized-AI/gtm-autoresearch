# Direct Cloudflare Jev transport

The pilot can use Cloudflare Workers AI directly with the official `typesafe/jev` REST model. It does not use the TypeSafe SDK, a generic LLM endpoint, or a deployed worker.

The frozen seed must bind `provider: "cloudflare"` and `model: "typesafe/jev"`. A shadow execution configuration contains that same explicit binding:

```json
{"schemaVersion":"jev-pilot-execution-config-v1","mode":"shadow","provider":"cloudflare","model":"typesafe/jev"}
```

After preflight, an authorized run uses the explicit direct transport:

```sh
python3 scripts/jev_pilot_execute.py run --execute --direct-cloudflare \
  --package /secure/training-pilot-v1-final \
  --seed-manifest /secure/jev-seeds/tracking-v1/manifest.json \
  --execution-config /secure/jev-execution.json \
  --results /secure/jev-results.jsonl --journal /secure/jev-journal.jsonl
```

Each reserved atomic attempt starts a child process, which sends exactly one `POST` to `https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run`. Redirects and client retries are disabled. The request contains exactly the frozen atomic `choice` question and `{ "observation": ... }` as state. The parent kills the child process on timeout; an error or timeout remains consumed in the durable attempt journal.

The response must contain a resolved Jev model, the requested choice answer, calibrated confidence, probabilities for every frozen label, and nonnegative integer input/output token usage. The journal and scorer-compatible result records preserve actual resolved-model, request-ID header when available, latency, confidence, probabilities, and usage. No cost is computed or claimed: Cloudflare pricing and any account limit are dashboard controls, not response fields.

`--execute` is still explicit and the route stays shadow-only. It cannot publish GTM or influence the loop. Expected labels, holdout inputs, validation inputs, and synthetic truth remain unopened by this driver.
