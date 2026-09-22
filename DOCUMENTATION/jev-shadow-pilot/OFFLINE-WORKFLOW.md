# Offline Jev workflow

## Run modes

- `JEV_MODE=off` is default and has no judge process.
- `JEV_MODE=shadow` invokes `scripts/jev_worker.py` only after deterministic validation and scoring. Its proposed route is logged and cannot alter the legacy action.

Use `npm run demo:jev-shadow` for a network-free fake-judge replay. It includes no mutation provider, Linear posting, GTM import/publish, client export upload, provider credential, or paid evaluation.

## Worker protocol

The TypeScript adapter runs Python with an argument array, sends one JSON request on stdin, consumes one bounded JSON result from stdout, and keeps diagnostics on stderr. It validates output status, evidence hash, frozen definition hash, requested model identity, finite numeric fields, and answer enums. Timeouts, missing `jev_align`, malformed output, oversized output, and wrong identities become unavailable/error records and route to review.

`scripts/jev_worker.py` calls `jev_align.AIFunction.load` only after a reviewed definition and isolated dependency are installed. GEPA and reflection are absent from the live worker. No OpenShell policy is installed by this pilot.

## Labels, calibration, and holdout

`jev-offline.ts` exports prediction/provenance separately from optional reviewer labels. Labels never enter `compactJudgeInput`. Split by `containerGroup`/lineage before calibration; the external holdout must stay unseen by GEPA. The built-in jev-align holdout must not be relied on unless its importer preserves those precomputed groups.

BLADE is used only to exercise generic web/server JSON-shape compatibility. The included fixtures and labels are synthetic software tests, not business or evaluation truth. Before any promotion, collect reviewed production examples, pin the definition/model/preprocessing and provider configuration, inspect proposed definition changes, replay an untouched grouped holdout, and approve explicit thresholds. The report exposes denominators, harmful proposed keeps, valid-fix rejection, review rate, latency, and unavailable cost rather than claiming calibration from fixtures.

## Synthetic GTM drift lab adapter

The separate `synthetic-gtm-lab` repository is consumed read-only through `scripts/synthetic-lab-adapter.ts`. It filters data-layer events, network deliveries, and platform snapshots by the explicit decision time, preserves the single manifest lineage group, and states that normalized Meta/Google snapshots are not existing enriched-snapshot inputs. It never reads `ground-truth/`, `ORACLE-REPORT.md`, scenario labels, or the private report-arrival schedule.

Run `SYNTHETIC_GTM_LAB_PATH='/absolute/path/to/synthetic-gtm-lab' npm run demo:synthetic-lab`. The lab contains a shared topology and generator-defined synthetic cases, including healthy and benign controls, transport outages, business/traffic changes, collection faults, and reporting delays. It establishes neither causality from ratios nor generalization, calibration, or enforcement readiness.

`buildSyntheticReplayRows` exposes all 12 cases as unlabeled synthetic replay rows. Because `demo-v1` declares one shared lineage group, the deterministic splitter places all 12 in exactly one bucket; empty validation/holdout buckets are reported as insufficient rather than silently mixing cases across partitions.


## Frozen worker manifest

`JEV_DEFINITION_PATH` must point to a JSON manifest. Its `manifestHash` is the SHA-256 of the canonical JSON payload with `manifestHash` omitted: recursively sorted object keys, original array order, UTF-8, and no ASCII escaping. It binds `definitionHash`, `requestedModel`, `preprocessingVersion`, `policyVersion`, and both atomic function specifications. Each function requires `path`, `definitionHash` (the canonical SHA-256 of the loaded private `_definition`), `provider`, and `model`. The worker loads and validates both definitions before invoking either one.

A valid manifest is a frozen **seed snapshot**, not a calibration or promotion decision. The policy therefore records review for all seed-manifest outcomes. It does not enable keep/enforcement. A second, explicitly approved acceptance workflow is required before changing that behavior.

```json
{
  "definitionHash": "seed-definition-content-hash",
  "requestedModel": "pinned-provider-model",
  "preprocessingVersion": "compact-evidence-v1",
  "policyVersion": "tracking-shadow-policy-v1",
  "functions": {
    "evidenceSufficient": { "path": "/secure/frozen/evidence", "definitionHash": "…", "provider": "…", "model": "…" },
    "trackingBehaviorPreserved": { "path": "/secure/frozen/tracking", "definitionHash": "…", "provider": "…", "model": "…" }
  },
  "manifestHash": "canonical-payload-sha256"
}
```
