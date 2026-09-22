# Bounded Jev shadow-pilot execution driver

`scripts/jev_pilot_execute.py` is the default-off driver for the frozen training package. It remains shadow-only: its outputs are research records for `scripts/jev_pilot.py score`; they cannot change a GTM container, the mutation loop, or deployment decisions.

Preflight reads `checksums.json`, then verifies every executable package file: `rubric.json`, `pilot-inputs.jsonl`, and `manifest.json`, plus the frozen seed manifest and each saved function's `state.json`. It deliberately does not stat, open, hash, parse, or project label, holdout, validation, or synthetic-truth inventory entries. Before any provider call it verifies the executable-file checksums, training-only input projection, rubric identity, outer seed-manifest hash, both persisted native definitions, their `selected_columns: ["observation"]` contract, and the common provider/model binding.

```sh
python3 scripts/jev_pilot_execute.py preflight \
  --package data/jev-shadow/training-pilot-v1-final \
  --seed-manifest /secure/jev-seeds/tracking-v1/manifest.json
```

Preflight makes zero provider calls. The `run` command remains default-off until `--execute` is supplied. Its execution configuration binds only the frozen shadow provider and model. It never supplies a price, spend ceiling, or provider account limit; those are not available in the Jev response contract.

```json
{"schemaVersion":"jev-pilot-execution-config-v1","mode":"shadow","provider":"cloudflare","model":"typesafe/jev"}
```

Direct Cloudflare use and its no-retry/killable transport contract are documented in `DIRECT-CLOUDFLARE.md`.



For every atomic function, the driver fsyncs an `attempt-started` journal entry before dispatch and never retries that attempt. The direct Cloudflare transport runs in a separate process that the parent kills and reaps on a 60-second timeout or interruption. Terminating the local process does not cancel work already accepted by Cloudflare. The exclusive journal lock and immutable run header bind inputs, seed, configuration, and transport. A resumed started-but-unfinished attempt becomes an error result instead of another request. Result files are atomically rebuilt from completed journal events. Actual provider metadata is retained; confidence, cost, usage, and predictions are never fabricated.

The direct transport permits at most 12 inputs and 24 reserved atomic attempts, with at most one HTTP POST per attempt and no redirects or retries. Timeouts and errors consume an attempt. This is not a dollar cap; prices and account limits are not verified by the runner. Generic native execution remains unavailable from the CLI; its injected test path reports only logical attempts. The pinned TypeSafe SDK route remains refused because it has hidden retries.

Use the same explicit `--run-id`, journal, results, seed and configuration when resuming. A changed transport or identity is rejected. Journals from the earlier offline-only driver lack a transport binding and cannot be resumed by this version; preserve those artifacts separately.

Validate a completed artifact without giving the executor access to labels:

```sh
python3 scripts/jev_pilot.py score \
  --package /path/to/pilot-package \
  --results /secure/jev-results.jsonl
```

The score is agreement with unreviewed synthetic generator labels. It is not calibration, human accuracy, a provider evaluation, or permission to promote the shadow route.
