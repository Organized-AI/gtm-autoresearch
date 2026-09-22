# Complete paired Cloudflare pilot — 2026-09-22

The corrected Cloudflare adapter completed all 12 frozen training observations and all 24 atomic judgments without errors or retries. Both questions agreed with the unreviewed synthetic generator labels on 9/12 observations (75%). The same three observations disagreed on both questions; all three were expected to return `insufficient`.

This is training-set agreement, not human accuracy or calibration. The frozen rubric, inputs and labels were unchanged. Jev remains default-off and shadow-only; no container publishing, legacy acceptance change, enforcement activation, merge, validation access or holdout access occurred.

## Execution and verification

- Run ID: `cloudflare-training-paired-v2-20260922`.
- Execution code: `bde18e6b7f2fceb95333f197171c9d32951706b7`.
- Requested model: `typesafe/jev`; all 24 responses resolved to `jev-1.13.0`.
- New-run budget: 24 requests, explicitly authorized after preflight. Used 24, with 24 unique request IDs and 12 complete paired result records. Zero runtime errors, zero runtime abstentions, and zero `insufficient` answers.
- Actual usage for this run: 361,858 input tokens and 1,152 output tokens (363,010 total). Median transport latency: 600.4765 ms; maximum: 1,467.466 ms. Dollar cost was not calculated.
- Rubric hash: `34a5125a67ee3c8013bd87f5ad0def6dc065034fc89578a713e5949fb4e87fde`.
- Frozen seed manifest hash: `331c3903fd93776d167e50f3382b1059df09a7bcf4d22dc9b49b219435538ab2`.

Root launched the authenticated run after explicit user confirmation; Terra scored and reviewed it offline. Root independently validated the journal's immutable identity, 24 successful unique atomic attempts, exact journal-to-result projection, scorer agreement, usage totals and request IDs. The scorer first read expected labels after execution. No new source changes or model calls were needed for scoring/review; the previously passing 29 Python and 37 TypeScript tests plus typecheck remain the implementation verification baseline.

The earlier 14-attempt diagnostic run is preserved separately, including its original errors. This fresh run intentionally reevaluates the frozen observations under a new authorization and run ID; it is not a resume or repair of that old journal. Across the two runs, 38 requests were made. The first run lacks usage for 12 attempts, so combined usage/cost remains unknown.

## Agreement

| Question | Matches | Denominator | Agreement |
| --- | ---: | ---: | ---: |
| Evidence sufficient | 9 | 12 | 75% |
| Tracking behavior preserved | 9 | 12 | 75% |
| Both answers match on the same observation | 9 | 12 | 75% |

For tracking behavior, all six expected `fail` observations returned `fail`, and all three expected `pass` observations returned `pass`. The three expected `insufficient` observations returned two `pass` and one `fail`. Evidence sufficiency returned `pass` on every observation, including all three expected `insufficient` cases. This pilot contains no expected `evidenceSufficient=fail` case, so contradictory-evidence handling is untested.

## Disagreement review

Record IDs below are unique 12-character prefixes; full IDs are retained in the score and audit artifacts.

| Record | Generator reason | Expected pair: evidence / tracking | Jev pair | Tracking confidence |
| --- | --- | --- | --- | ---: |
| `13b9187f6adf` | Missing matching platform reports | insufficient / insufficient | pass / fail | 0.23 |
| `078c55a617e4` | Missing matching platform reports | insufficient / insufficient | pass / pass | 0.42 |
| `a802115a7e68` | Unresolved platform-report gap | insufficient / insufficient | pass / pass | 0.46 |

The first two observations contain no available platform snapshots. Their current-window summaries show zero failed requests, denied-consent requests, duplicate routes or mismatched paired Meta event IDs. Successful delivery alone does not establish platform conversion matching under the frozen rubric.

The third observation includes platform snapshots, but its current purchase deliveries contain 14 unique events per route while the corresponding Meta browser/server counts and Google Ads unique-event report each contain 13. The current-window summaries show no failed delivery, denied-consent dispatch, duplicate route or paired-ID divergence. The generator's expected answer withholds a conclusion for this unresolved reporting gap.

These evidence checks support prioritizing abstention behavior for review. Jev returned choices and probabilities without rationales; the model's reason for each disagreement is unknown. Reported confidence is not a calibrated correctness measure. Do not rewrite the frozen labels or tune a confidence threshold simply to make these 12 rows agree.

## Next evaluation step

1. Review these three evidence/label pairs and the distinction between a concrete observed fault and missing or delayed platform evidence. Keep any label corrections separately versioned with reasons.
2. Draft a new rubric version with explicit precedence: concrete observed fault can support a failure; otherwise missing matching reports or unresolved report gaps require `insufficient`. Include concise training examples and counterexamples so missing reports do not hide real faults.
3. Freeze the revised definitions and a bounded comparison plan before another paid run. Compare both agreement and the ability to abstain while preserving the six fault and three preserved-behavior cases. Reserve validation and holdout for later evaluation; do not promote based on these training results.

## Local artifacts

Directory: `/private/tmp/gtm-jev-cloudflare-paired-v2-20260922/`. Includes `journal.jsonl`, `results.jsonl`, `score.json`, `audit.json`, and Terra's `REVIEW.md`. Generated artifacts remain outside version control.

| Artifact | SHA256 |
| --- | --- |
| journal.jsonl | `e593768573ec100716feec704a6e1befa5bb06eed33c8878759c9eb385ec8fb2` |
| results.jsonl | `04f6b2e7cd055531466c0dc01e0cc6e55d9bd6b5fd9b77b8e8765a14d1cd7591` |
| score.json | `854486e1d6d4b576a3dc68355c43c3b914717c91d9b6cc54a34d3f9b3f4c4c66` |

Prior diagnostic journal remains unchanged at SHA256 `b332db234287652a836e7e22f33cb0fbf73072c0677de96722cc83b695cbda07`.
