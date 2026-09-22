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
