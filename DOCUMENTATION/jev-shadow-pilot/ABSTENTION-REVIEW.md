# Abstention review — v2 preparation

This is a training-only review of the three paired-pilot disagreements recorded in the existing audit artifact. It read no validation or holdout observation, made no provider call, and does not amend the frozen v1 rubric, inputs, labels, results, or journal.

The three expected pairs are generator-defined and **unreviewed by a human**. This review records whether their abstention rationale is coherent with the supplied facts; it does not convert them into human ground truth.

## Reviewed evidence

1. The first observation has no available corresponding platform snapshot. Its current-window delivery and integrity summaries show successful requests, no denied-consent requests, no duplicate route, and no paired Meta event-ID divergence. That rules out the concrete faults visible in the supplied facts, but it does not establish conversion matching. The unreviewed expected pair is `insufficient` / `insufficient`; retain it.
2. The second observation has the same material gap: no available corresponding platform snapshot, alongside successful observed delivery and no supplied concrete fault. Its unreviewed expected pair is `insufficient` / `insufficient`; retain it.
3. The third observation has available snapshots but an unresolved current-window purchase coverage gap: observed deliveries show 14 unique events per route, while the relevant Meta browser/server and Google Ads reports each show 13. The supplied summaries show no failed delivery, denied-consent dispatch, duplicate route, or paired-ID divergence. The one-event shortfall is unresolved reporting evidence, not a demonstrated collection fault. Its unreviewed expected pair is `insufficient` / `insufficient`; retain it.

## Review decision

The existing three labels remain unreviewed and unchanged. They collectively support one rubric clarification: absent or unresolved platform reporting blocks positive preservation, while a separately observed concrete fault may still support a tracking failure without reports. The review does not support treating missing reports as a fault, revising labels to fit prior predictions, or tuning a confidence threshold. Reported model confidence is not calibrated correctness evidence.

The v2 seed therefore makes the precedence explicit: internal contradiction or invalid evidence first; then a concrete observed fault; then positive preservation requiring observed matching platform coverage; otherwise insufficient. The v1 material remains the historical baseline.
