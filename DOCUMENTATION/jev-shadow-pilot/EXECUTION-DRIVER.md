# Bounded Jev shadow-pilot execution driver

`scripts/jev_pilot_execute.py` is the default-off driver for the frozen training package. It remains shadow-only: its outputs are research records for `scripts/jev_pilot.py score`; they cannot change a GTM container, the mutation loop, or deployment decisions.

Preflight reads `checksums.json`, then verifies every executable package file: `rubric.json`, `pilot-inputs.jsonl`, and `manifest.json`, plus the frozen seed manifest and each saved function's `state.json`. It deliberately does not stat, open, hash, parse, or project label, holdout, validation, or synthetic-truth inventory entries. Before any provider call it verifies the executable-file checksums, training-only input projection, rubric identity, outer seed-manifest hash, both persisted native definitions, their `selected_columns: ["observation"]` contract, and the common provider/model binding.

```sh
python3 scripts/jev_pilot_execute.py preflight \
  --package data/jev-shadow/training-pilot-v1-final \
  --seed-manifest /secure/jev-seeds/tracking-v1/manifest.json
```

Preflight makes zero provider calls. The `run` command also makes zero calls unless `--execute` is present. That flag requires an external execution configuration whose provider and model exactly match the frozen seed and that identifies a provider-enforced hard spend control. This configuration is deliberately not checked in and no provider, model, cost, usage, or spend value is supplied by this repository.

```json
{
  "schemaVersion": "jev-pilot-execution-config-v1",
  "mode": "shadow",
  "provider": "EXTERNALLY_APPROVED_PROVIDER",
  "model": "EXTERNALLY_APPROVED_MODEL",
  "providerSpendControl": {
    "kind": "provider-enforced-hard-limit",
    "reference": "EXTERNAL_CONTROL_REFERENCE"
  }
}
```

The reference is an identity check, not evidence that a provider has enforced a limit. Do not claim a dollar ceiling without independently verifiable provider-side controls and provider usage receipts.

The command-line driver has no provider-side spending-control adapter in this milestone. It fails closed even when `--execute` and an externally supplied configuration are present, so it cannot make a live provider call. Its tested execution core accepts an injected, reviewed adapter only; a future integration must supply a verifiable provider-side hard-control check before it can expose a live command.

No command-line invocation is eligible to execute a provider in this milestone. The command below is reserved for a future reviewed adapter and must not be treated as an authorization:

```sh
python3 scripts/jev_pilot_execute.py run \
  --execute \
  --package /path/to/pilot-package \
  --seed-manifest /secure/jev-seeds/tracking-v1/manifest.json \
  --execution-config /secure/jev-execution-config.json \
  --results /secure/jev-results.jsonl \
  --journal /secure/jev-attempt-journal.jsonl \
  --run-id YOUR_RUN_ID
```

For every atomic function, the driver fsyncs an `attempt-started` journal entry before calling the native `AIFunction` and never retries that attempt. It obtains an exclusive journal lock and raises a cooperative 60-second timeout in the driver process; a future live adapter must add a killable process boundary before treating that timeout as a hard transport cutoff. It turns a resumed started-but-unfinished attempt into an error result rather than calling it again. The journal is authoritative; result files are atomically rebuilt from completed journal events, which avoids duplicate dispatch after interruption. It writes exact identity-bound `success` or `error` records for completed rows; it never makes confidence, cost, usage, or prediction fields up.

The hard bound is at most 12 inputs and 24 logical atomic `AIFunction` attempts. Timeouts and errors consume an attempt. It is not an HTTP or dollar cap. The pinned TypeSafe route is refused because its SDK can make hidden transport retries; the Cloudflare and Vercel native routes have no application retry loop at the reviewed source revision, but still lack provider-enforced billing/usage controls in Jev. The driver therefore reports only a logical attempt cap.

Validate a completed artifact without giving the executor access to labels:

```sh
python3 scripts/jev_pilot.py score \
  --package /path/to/pilot-package \
  --results /secure/jev-results.jsonl
```

The score is agreement with unreviewed synthetic generator labels. It is not calibration, human accuracy, a provider evaluation, or permission to promote the shadow route.
