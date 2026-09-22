# Rubric v2 training comparison — 2026-09-22

Rubric v2 increased evidence-sufficiency agreement from 9/12 to 11/12 on the same frozen training inputs. Tracking agreement and paired agreement remained 9/12. All six expected tracking failures and three expected passes were retained, but none of the three expected tracking `insufficient` cases returned `insufficient`.

This is a single comparison against unreviewed synthetic generator labels. It does not establish human accuracy, calibrated confidence, generalization or promotion readiness. Rubric v2 was drafted after inspecting the v1 disagreements, so these are development-set results, not an independent evaluation.

## Fixed comparison

| Measure | Rubric v1 | Rubric v2 |
| --- | ---: | ---: |
| Evidence-sufficiency agreement | 9/12 | 11/12 |
| Tracking-behavior agreement | 9/12 | 9/12 |
| Both answers match on the same observation | 9/12 | 9/12 |
| Expected tracking failures retained | 6/6 | 6/6 |
| Expected tracking passes retained | 3/3 | 3/3 |
| Expected insufficient: evidence answer matches | 0/3 | 2/3 |
| Expected insufficient: tracking answer matches | 0/3 | 0/3 |
| Expected insufficient: both answers match | 0/3 | 0/3 |
| Completed paired predictions / coverage | 12/12 | 12/12 |
| Runtime errors / runtime abstentions | 0 / 0 | 0 / 0 |
| Valid insufficient answers across both functions | 0 | 2 |

The exact 12 canonical input records, input hashes, expected answers and label metadata match between packages after excluding rubric identity. The v1 baseline was not rerun. Expected labels were opened for scoring only after v2 execution completed; the executor sent only observations and frozen questions. No validation or holdout data was opened.

## Remaining disagreements

Record IDs are unique 12-character prefixes. The expected pair for each row is `insufficient / insufficient`.

| Record | Evidence gap | v1 evidence / tracking | v2 evidence / tracking |
| --- | --- | --- | --- |
| `13b9187f6adf` | Missing matching platform reports | pass / fail | insufficient / pass |
| `078c55a617e4` | Missing matching platform reports | pass / pass | insufficient / pass |
| `a802115a7e68` | Unresolved platform-report gap | pass / pass | pass / pass |

Two v2 pairs now contain `evidenceSufficient=insufficient` with `trackingBehaviorPreserved=pass`. The questions run independently against the same observation; one question does not condition on the other's answer. These raw outputs are retained unchanged. No confidence threshold, deterministic override or post-hoc label change was used. Jev returns probabilities but no rationale here, so the reason for each choice is unknown.

## V2 confusion matrices

Rows are unreviewed expected labels and columns are model predictions.

Evidence sufficient:

| Expected | pass | fail | insufficient |
| --- | ---: | ---: | ---: |
| pass | 9 | 0 | 0 |
| fail | 0 | 0 | 0 |
| insufficient | 1 | 0 | 2 |

Tracking behavior preserved:

| Expected | pass | fail | insufficient |
| --- | ---: | ---: | ---: |
| pass | 3 | 0 | 0 |
| fail | 0 | 6 | 0 |
| insufficient | 3 | 0 | 0 |

There is no expected `evidenceSufficient=fail` row in this pilot. Contradictory-evidence handling remains untested. Each dataset partition has one authored topology, limiting generalization.

## Execution and identity

- User authorized this run by responding “Continue” to the proposed same-input comparison with up to 24 new paid requests.
- Run ID: `cloudflare-training-rubric-v2-20260922`.
- Code at launch: `116d524`; unchanged execution adapter, direct Cloudflare transport, shadow-only.
- Requested `typesafe/jev`; all 24 responses reported `jev-1.13.0` and unique request IDs.
- Exactly 24 requests, 12 successful pairs, no retries, errors or runtime abstentions. The allowance is exhausted.
- Actual v2 usage: 365,362 input tokens + 1,158 output tokens = 366,520 total. Median transport latency 750.413 ms; maximum 1,679.157 ms. Dollar cost was not calculated.
- Both complete paired runs together used 727,220 input tokens + 2,310 output tokens. Including the earlier diagnostic run, 62 requests have been made; its first 12 requests have unknown usage, so all-run total usage/cost is unknown.
- Rubric hash: `0160e726c0ccf80a7bd095a19bf72e3c1a7f6370a1269852d6d5ce4bd7662de8`.
- Seed-manifest hash: `07e35d2b520ea255a418640c79ce17b20f46e8940b2d5aa380d4e2ce055acf2e`.

Root validated the frozen seed and all 24 durable attempts with the executor's journal identity checks, matched results exactly to the completed journal records, scored offline, and verified unchanged v1 and diagnostic artifact hashes. Terra independently reran the scorer and verified the same journal projection, frozen input/label identity, request IDs and baseline hashes; its review agrees with the saved score. The separate comparison artifact verifies same-input and same-label identity and reports every fixed stratum. No GTM publishing, enforcement, merge or rubric change occurred during evaluation.

## Artifacts and viewer

New run directory: `/private/tmp/gtm-jev-cloudflare-rubric-v2-run-20260922/`, containing journal, results, score, audit, comparison, execution status and independent review. Generated data remains outside version control.

| Artifact | SHA256 |
| --- | --- |
| journal.jsonl | `952762489db58287ee05512a9c30eb323daa5ac963397eca3a7937b82c0f0e4e` |
| results.jsonl | `9c75a14a6ed74d29e447279d4f5b367037fe4371a9f1805fee28f004bb760b0d` |
| score.json | `ef64b07324b6b5d8225193028bfee031dbd3eb43f9b29b37912353f9c6217331` |

The private viewer at `http://jordans-mac-mini.tailb35295.ts.net:8765/` shows v2 replay with the v1 baseline comparison. See [RUN-VIEW.md](RUN-VIEW.md) for launch instructions.

The updated viewer passes 13 tests, including frozen-identity comparison, fixed retention denominators under runtime errors, private origins and API projection. Browser verification over Tailscale confirmed the new run, comparison values and raw disagreement details. JavaScript syntax and whitespace checks pass.

## Next step

Review the two internally inconsistent pairs and the unresolved report-gap observation offline before deciding on another model experiment. Compare a separately defined evidence gate with independent atomic judging as an explicit policy/design choice; do not retroactively present gated outputs as Jev predictions. Add training fixtures for concrete faults coexisting with missing reports and contradictory evidence before claiming those branches work. Preserve original labels/results and the reserved validation/holdout partitions. A further paid run needs a new bounded authorization; this comparison does not justify enabling enforcement.
