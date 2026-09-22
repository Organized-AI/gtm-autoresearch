# Jev shadow-pilot contract

## Modes

`JEV_MODE=off` is the default. `JEV_MODE=shadow` records a proposed route after deterministic validation and scoring. It never changes the existing keep/revert decision, winning JSON, termination conditions, publishing, or Linear behavior.

## Seed purchase rubric

`purchase-behavior-seed-v1` asks two atomic questions:

1. Is the supplied evidence sufficient to assess purchase-event behavior?
2. Does the candidate preserve the stated purchase behavior relative to its parent?

Answers are `pass`, `fail`, or `insufficient`. A failed or absent preview is not a pass. Variable presence alone does not demonstrate browser/server event-ID sharing. Missing server evidence cannot demonstrate delivery or matching. This seed rubric is not calibrated, optimized, or approved for enforcement.

## Data boundaries

The judge input includes only a compact evidence projection: identities and hashes, operation list, targeted issue, stable entity changes, dimension deltas, deterministic validation, snapshot state, and QA state. It excludes labels, legacy outcomes, mutation-model summaries, full container scripts, and source text. Full baseline/candidate exports are retained locally only in a run directory and linked by hashes.

## Frozen identity

Every run freezes the seed definition content hash, preprocessing version, backend/model request, and shadow-policy version. Pending or modified definitions are rejected. Worker output must echo evidence and frozen definition identities. Provider uncertainty is recorded only when supplied; it is never invented.
