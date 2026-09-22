# Native Jev seed setup

`scripts/jev_freeze.py` converts the versioned seed rubric into two saved native `AIFunction` runs. It creates definitions only; it does not evaluate an observation, invoke GEPA, create calibration labels, or mark either function accepted.

Use an isolated environment. The repository pin resolves Jev 0.1.4 at commit `3d997fc76593036655c28d4964de43b55f81fe2c`. Its upstream dependency currently requests `gepa[full]`, which includes optional training, experiment, and provider tooling that the offline freeze flow does not import. The inspected freeze test uses the exact Jev source with its required offline `pydantic` and `rich` imports in `/private/tmp`; a full production environment should install the pinned requirements after its resolver finishes and be recorded separately.

```sh
python3 -m venv /private/tmp/gtm-jev-runtime
/private/tmp/gtm-jev-runtime/bin/pip install -r requirements-jev-shadow.txt
/private/tmp/gtm-jev-runtime/bin/python scripts/jev_freeze.py \
  --rubric DOCUMENTATION/jev-shadow-pilot/rubric-v1.json \
  --output /secure/jev-seeds/tracking-v1 \
  --provider typesafe \
  --model YOUR_APPROVED_MODEL
```

The provider and model are explicit; the command illustrates the typesafe backend, not a recommendation or confirmation that a particular model is available. Tests use the placeholder model `jev-test` only for offline save/load and never evaluate it. The saved state accepts only the `observation` input column. `manifest.json` carries seed status, the rubric hash, native definition hashes, provider/model identities, preprocessing and policy versions, and the outer canonical manifest hash consumed by `scripts/jev_worker.py`. Existing output is refused.

The native backends exposed at this pinned revision are `typesafe`, `cloudflare`, and `vercel`. Credential validation expects, respectively, `TYPESAFE_API_KEY`; `CLOUDFLARE_ACCOUNT_ID` plus `CLOUDFLARE_API_TOKEN`; or `AI_GATEWAY_API_KEY`. Do not set them for the offline freeze step.

This API exposes a GEPA `metric_budget` for optimization sessions but no exposed request, token, or currency cap on an individual `AIFunction` call. A live pilot therefore needs an external hard call limit in the TypeScript parent, a provider-side spend limit, and recorded provider usage telemetry before any bounded evaluation is authorized.
