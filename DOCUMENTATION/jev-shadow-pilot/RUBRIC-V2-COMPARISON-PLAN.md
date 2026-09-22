# Rubric v2 comparison plan

## Purpose and boundary

This plan prepares a single bounded, training-only comparison of the v2 seed with the completed v1 paired-pilot baseline. It is zero-call preparation: no provider request, credential use, validation read, holdout read, label edit, or promotion is authorized by this document.

The baseline is the immutable 12-input / 24-atomic-result training run documented in [PAIRED-PILOT-RESULTS.md](PAIRED-PILOT-RESULTS.md). The comparison uses those exact existing 12 training inputs, once each for the two v2 functions. It does not rerun v1. A future v2 execution needs separate explicit authorization and may make at most 24 new atomic attempts; the existing 24 baseline attempts do not authorize additional work.

## Frozen comparison package

Before any execution, freeze `rubric-v2.json` with `scripts/jev_freeze.py` into a new, empty seed directory and prepare a package that:

- preserves the existing 12 canonical training inputs and their hashes unchanged;
- projects only `input.observation` to both v2 functions;
- binds the v2 rubric hash, seed-manifest hash, approved provider/model identity, and a new run ID;
- sets a durable ceiling of 12 rows and 24 atomic attempts, with one attempt per record/function and no replay of a started attempt;
- keeps expected-label records outside the execution projection and unopened by the executor; and
- uses new output paths so neither v1 seed nor v1 result artifact is overwritten.

The package preflight must reject a changed input hash, a non-training provenance claim, a duplicate input or result key, an extra function, more than 12 rows, more than 24 attempts, or a result whose identity does not bind to the frozen v2 seed. These checks are preparation checks only and make zero provider calls.

## Prediction-first scoring

If a future run is explicitly authorized, record each v2 prediction before the scorer opens the separate expected-label artifact. After execution, the scorer must keep these categories separate: successful predictions, runtime errors, runtime abstentions, and valid `insufficient` predictions. It must report agreement against the generator-defined, human-review-status **unreviewed** labels; it must not call this human accuracy, calibration, or improvement.

Report each function's confusion matrix and completed-prediction agreement, paired agreement, runtime coverage, attempt count, unique request IDs, model identity, and recorded usage. Do not use a confidence cutoff or any confidence-based relabeling.

## Required retention reporting

The scorecard must separately show v2 results for all fixed existing training strata:

| Existing unreviewed expected tracking label | Rows | Required report |
| --- | ---: | --- |
| `fail` | 6 | Count v2 tracking `fail` predictions and every deviation. |
| `pass` | 3 | Count v2 tracking `pass` predictions and every deviation. |
| `insufficient` | 3 | Count v2 `insufficient` predictions for both functions and every deviation. |

The baseline contains no expected `evidenceSufficient=fail` row. The comparison must state that contradictory-evidence handling has no training-pilot label coverage; it cannot claim that v2 validates this branch. It must also retain the no-evidence-fail coverage limitation in any conclusion.

## Acceptance criteria

Preparation is complete only when the v2 JSON passes the `jev_freeze.py` schema check with exactly `evidenceSufficient` and `trackingBehaviorPreserved`, each defining nonempty `pass`, `fail`, and `insufficient` labels, and the no-call preflight accepts the unchanged 12-row training package with a 24-attempt ceiling.

A future comparison result is valid only when it has at most one durable attempt per record/function, no attempt over the 24 maximum, exact input/seed/result identity, no replayed v1 result, and separate prediction-first scoring against the unreviewed labels. A runtime failure or incomplete pair remains a coverage result, not a substitute prediction.

No improvement claim is permitted until that future authorized execution completes and the resulting artifacts pass these identity, coverage, and reporting checks. Even then, training agreement alone cannot support promotion, deployment approval, confidence calibration, or a generalization claim. Validation and holdout remain reserved for later work.

## Prepared offline on 2026-09-22

Preparation and native freeze are complete with zero provider calls. The 12 canonical inputs, input hashes, expected answers and original label metadata are unchanged; package rows bind the new rubric identity.

```sh
python3 scripts/jev_prepare_comparison.py \
  --source data/jev-shadow/training-pilot-v1-final \
  --rubric DOCUMENTATION/jev-shadow-pilot/rubric-v2.json \
  --output data/jev-shadow/training-pilot-rubric-v2-prepared
/private/tmp/gtm-jev-runtime/bin/python scripts/jev_freeze.py \
  --rubric DOCUMENTATION/jev-shadow-pilot/rubric-v2.json \
  --output /private/tmp/gtm-jev-cloudflare-rubric-v2-seed-20260922 \
  --provider cloudflare --model typesafe/jev
/private/tmp/gtm-jev-runtime/bin/python scripts/jev_pilot_execute.py preflight \
  --package data/jev-shadow/training-pilot-rubric-v2-prepared \
  --seed-manifest /private/tmp/gtm-jev-cloudflare-rubric-v2-seed-20260922/manifest.json \
  --execution-config DOCUMENTATION/jev-shadow-pilot/cloudflare-execution.json
```

Use fresh output directories when reproducing; preparation refuses overwrites. Preflight accepted 12 rows with a 24-attempt ceiling. Rubric SHA256: `0160e726c0ccf80a7bd095a19bf72e3c1a7f6370a1269852d6d5ce4bd7662de8`. Native manifest SHA256: `07e35d2b520ea255a418640c79ce17b20f46e8940b2d5aa380d4e2ce055acf2e`.

This v2 seed has not been evaluated. The baseline run ID contains `paired-v2`, but that run used rubric v1; run numbering and rubric versions are independent. See [RUN-VIEW.md](RUN-VIEW.md) for the local recorded-run interface.
