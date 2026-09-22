# Jev shadow-pilot contract

## Modes

`JEV_MODE=off` is the default. `JEV_MODE=shadow` records a proposed route after deterministic validation and scoring. It never changes the existing keep/revert decision, winning JSON, termination conditions, publishing, or Linear behavior.

## Seed semantic-drift rubric

`purchase-behavior-seed-v1` is a narrow, temporary atomic example rather than a business-case taxonomy or fixed production rubric. The architecture supports separately versioned semantic questions for container drift, collection integrity, and evidence sufficiency. No question may claim causality from a ratio drop alone.

The included seed asks:

1. Is the supplied evidence sufficient to assess the stated behavior?
2. Does the candidate preserve the stated behavior relative to its parent?

Answers are `pass`, `fail`, or `insufficient`. A failed or absent preview is not a pass. Variable presence alone does not demonstrate browser/server event-ID sharing. Missing server evidence cannot demonstrate delivery or matching. This seed rubric is not calibrated, optimized, or approved for enforcement.

## Synthetic-data boundary

BLADE web and server exports are examples of acceptable GTM JSON shape only. They are not business truth, evaluation truth, or a fixed purchase requirement. Synthetic injected-fault labels are permitted for software testing but are marked `synthetic`, retained outside model inputs, and never presented as reviewed production labels. The separate synthetic lab supplies 12 scenarios covering healthy controls, benign configuration drift, business/traffic changes, collection faults, and reporting delays through the time-bounded adapter described in [SYNTHETIC-REPLAY.md](SYNTHETIC-REPLAY.md).

## Data boundaries

The judge input includes only a compact evidence projection: identities and hashes, operation list, targeted issue, stable entity changes, dimension deltas, deterministic validation, snapshot state, and QA state. It excludes labels, legacy outcomes, mutation-model summaries, full container scripts, and source text. Full baseline/candidate exports are retained locally only in a run directory and linked by hashes.

## Frozen identity

Every run freezes the seed definition content hash, preprocessing version, backend/model request, and shadow-policy version. Pending or modified definitions are rejected. Worker output must echo evidence and frozen definition identities. Provider uncertainty is recorded only when supplied; it is never invented.
