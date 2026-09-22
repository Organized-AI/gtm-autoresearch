# Current State — 2026-09-22 (scored container export)

- Product direction clarified: user explicitly selected BLADE as the benchmark baseline for daily improvement. See `DOCUMENTATION/daily-container-improvement.md`. New `run-daily-benchmark.ts` begins from the original BLADE web seed, carries forward accepted hygiene changes, records immutable history, and binds state to baseline/export hashes. It does not access live BLADE or use paid inference. `run-daily-benchmark-service.py` can install its result into the private viewer. Synthetic behavioral evaluation and immediate change watching remain next-stage work.
- Daily heartbeat `daily-blade-container-benchmark` is ACTIVE at 09:00 local America/Chicago, attached to this task; quiet on unchanged runs, reports improvements/failures. It uses persistent code at `~/Library/Application Support/GTM Autoresearch/benchmark/code-7b17914` and state at `benchmark/state`. When updating executable code, install a new reviewed version and update this existing automation instead of adding a duplicate.
- First installed benchmark run improved 0.4277 → 0.4894 through deterministic hygiene only; exact behavior-field preservation and protected tag-name references tested. The dashboard now serves this NEW benchmark artifact (SHA-256 `fb26f9bdcf727ca528bb3187f7b4b38313216ccba4dbcf1acea708f1758ee33a`), replacing the historical April 29 example below. Its lower score than that archive reflects a new baseline-bound lineage without the archive's behavior changes, not a regression within this run. Tailscale download hash verified against committed benchmark state.
- Verification for daily stage: all 47 TypeScript tests, typecheck, and 26 simulator regression tests pass. Simulator tests are suite verification, not execution/QA of the BLADE candidate. The installed service wrapper ran successfully with zero provider calls. Do not reset hash-mismatched state or automatically remove a stale lock; diagnose and preserve the last served artifact.

- User approved current dashboard design and requested a scored GTM JSON deliverable for manual/programmatic import. Selected an existing saved optimization winner if valid. Terra implemented export packaging; root integrated and verified the dashboard/download service.
- Added `scripts/prepare-gtm-export.ts` and `scripts/gtm-scored-export.ts`. Output is byte-preserving `container.json`, separate `report.json`, and SHA-256 `manifest.json`. Loop now packages the selected winner automatically beside its saved JSON. No GTM/API writes, paid inference, or changes to Jev decisions.
- Attached archive `content/gtm-templates/BLADE/winning/2026-04-29T143650-blade-web.json`, with `BLADE/seed/blade-web.json` as baseline and no ads snapshot. Structural scores 0.7617 vs 0.4277; 115 tags / 49 triggers / 72 variables. This is the old saved winner, not a new optimization or Jev-approved output; original BLADE destinations remain. Candidate SHA-256 `fd920df13c8466b3e4807c05bb9dad9d7142f1d5e3fe0b336a5eb8747c9d98e3`.
- Offline checks pass for import review. Google backend acceptance and runtime QA remain unverified; introduced type `googtag_init_consent` is explicitly flagged for import-preview review. April 8 BLADE winner is blocked by `CONSENT_INITIALIZATION_ALL_PAGES`; HRE winners retain hydration placeholders. No original containers were modified or hydrated with invented values.
- Container export tab uses the existing Jev design. Fixed read-only routes `/api/export`, `/exports/container.json`, `/exports/report.json`, `/exports/manifest.json` share the existing Host/Origin allowlist. Downloads verify manifest and score binding; blocked containers get 409; missing/tampered artifacts get 404. Programmatic retrieval is documented; Google's API has no bulk JSON import endpoint.
- Stable managed service includes the scored bundle under `~/Library/Application Support/GTM Autoresearch/current/export/`. `--export-bundle` updates it; reinstall without the option retains it. Added bounded retry for macOS's asynchronous launchd unload timing, verified by real reinstall.
- Verification: 41 TypeScript tests and typecheck, 15 Python viewer/download tests, JS syntax/diff checks; browser confirms original pilot plus export tab; actual Tailscale attachment is 603,783 bytes and hashes to the original winner. No provider calls or publishing.
- Next: use GTM import preview to check the saved artifact, or supply a current target container to generate a client-specific export. Do not claim historical BLADE export is configured for another client. Existing Jev pilot constraints below remain in force.

# Previous State — 2026-09-22 (rubric v2 comparison completed)

- Checkout `/private/tmp/gtm-jev-execution-20260922`, branch `feat/jev-shadow-pilot`, draft PR #5 stacked on unmerged #4. Do not merge, publish GTM, or activate enforcement.
- User authorized the proposed 12-row / max 24 paid rubric v2 run by saying “Continue.” Root executed exactly 24 successful requests with frozen v2 questions and unchanged observations. No retries/errors; allowance exhausted. Runtime model `jev-1.13.0` throughout. Actual usage 365,362 input +1,158 output tokens. All 62 requests across diagnostic/v1/v2; all-run usage remains incomplete due to first 12 diagnostic responses.
- Evidence agreement 11/12 vs 9/12 baseline; tracking and paired agreement 9/12 unchanged. Retained 6/6 failures and 3/3 passes. Expected-insufficient evidence 2/3, tracking 0/3, both 0/3. Two pairs say insufficient evidence and tracking pass; retain these raw results unchanged.
- New run: `/private/tmp/gtm-jev-cloudflare-rubric-v2-run-20260922/` with journal/results/score/audit/comparison/execution-status and Terra independent REVIEW.md. Root and Terra independently verified exact journal projection, score, same canonical inputs/expected labels except rubricHash, 24 unique request IDs and frozen seed identity. V1 and diagnostic artifacts unchanged; validation and holdout unopened.
- See `DOCUMENTATION/jev-shadow-pilot/RUBRIC-V2-RESULTS.md` for outcomes/confusion/usage/hashes and `RUN-VIEW.md` for the comparison viewer command. Main run is now v2 with v1 baseline options; the browser diagram replays real v2 events and the Comparison tab separates outcomes.
- Visual redesign now follows the user-selected Jev field guide at `https://talk.organizedai.vip/jev/`: warm near-black/cream/gold, local JetBrains Mono and Inter fonts, fine borders and compact mobile metrics. Typography/assets are bundled with OFL licenses. Existing run data and comparison semantics are preserved.
- Availability fix: the foreground task process exited and Tailscale returned HTTP 502. The viewer now runs as per-user LaunchAgent `com.organizedai.gtm-run-view`, with KeepAlive/RunAtLoad and versioned code/data/font copies under `~/Library/Application Support/GTM Autoresearch/`. It no longer depends on a task process or `/tmp` artifacts. Use `scripts/install_gtm_run_view.py` (see RUN-VIEW.md) after future changes to update the installed copy. Recovery after a deliberate service termination was verified over Tailscale.
- Private route remains `http://jordans-mac-mini.tailb35295.ts.net:8765/`; viewer binds loopback and permits only explicit local/Tailscale origins. Existing Serve routes retained; no Funnel. launchd manages the viewer process. Retain the explicit `--allow-origin` settings when reinstalling.
- Verification: 13 viewer tests pass, plus JavaScript syntax and diff checks. Browser verified v2 metrics, the Comparison tab, unchanged tracking/paired agreement, and raw inconsistent pairs over the private Tailscale URL. No execution adapter or TypeScript implementation changed in this step.
- Next: review independent-question inconsistency and evidence-gap semantics offline. A separately defined evidence gate is a design choice, not a retroactive Jev result. Broaden training fixtures for missing reports coexisting with real faults and contradictory evidence before another bounded experiment. No rubric v3, further paid calls, confidence relabeling or promotion is authorized by this result.

---

# Previous State — 2026-09-22 (run interface and rubric v2 prepared)

- Active checkout `/private/tmp/gtm-jev-execution-20260922`, branch `feat/jev-shadow-pilot`, draft PR #5 stacked on unmerged PR #4. Preserve the original cloud-offloaded workspace; do not merge or enable enforcement.
- Two Terra agents implemented the diagram frontend, abstention review, revised rubric, and viewer validation; root reviewed and verified integration.
- Private Tailscale route enabled on port 8765: `http://jordans-mac-mini.tailb35295.ts.net:8765/`, proxying the local viewer. Start the viewer with `--allow-origin http://jordans-mac-mini.tailb35295.ts.net:8765 --allow-origin http://100.86.248.8:8765`. Existing Serve routes retained; no Funnel enabled. Private URL and API verified; direct MBP SSH verification unavailable because login was rejected. Viewer suite now passes 10 tests.
- Local read-only interface: `http://127.0.0.1:8765`. Launch instructions and behavior in `DOCUMENTATION/jev-shadow-pilot/RUN-VIEW.md`. It replays the actual completed shadow journal and labels the GTM optimizer architecture conceptual. No fake live optimization or provider controls.
- Reviewed three abstention disagreements in `ABSTENTION-REVIEW.md`. Rubric v2 is frozen and offline comparison package prepared: `data/jev-shadow/training-pilot-rubric-v2-prepared`; native seed `/private/tmp/gtm-jev-cloudflare-rubric-v2-seed-20260922/manifest.json`. Instructions, hashes and preflight results in `RUBRIC-V2-COMPARISON-PLAN.md`.
- Same 12 training inputs and unreviewed expected answers, zero new provider calls. Existing pilot/diagnostic journals preserved. Validation/holdout unopened. Rubric v2 remains unevaluated.
- Verification: 32 Jev Python tests, 9 viewer tests, 37 TypeScript tests, typecheck and JavaScript syntax checks pass. Chrome verification covered real metrics, replay playback/pause/step/reset, node highlighting and disagreement metadata. Original journal/result/score hashes are unchanged.
- Next evaluation requires a new bounded authorization for at most 24 v2 attempts; the prior allowance is exhausted. Compare abstention and retention strata using prediction-first scoring, without calibration/promotion claims.

---

# Previous State — 2026-09-22 (complete paired pilot scored)

- Same active checkout `/private/tmp/gtm-jev-execution-20260922`, branch `feat/jev-shadow-pilot`, draft PR #5 stacked on unmerged PR #4. Do not merge or enable enforcement.
- Following explicit user approval, a fresh run `cloudflare-training-paired-v2-20260922` completed 12 paired observations / 24 requests without errors or retries, all `jev-1.13.0`. Root launched the authenticated run; Terra scored/reviewed; root independently checked journal identity, result projection and score.
- Actual new-run usage: 361,858 input tokens + 1,152 output tokens. No dollar cost calculated. Prior diagnostic run remains intact at 14 attempts; total requests across both runs: 38. Prior incomplete usage prevents a combined total usage/cost claim.
- Both atomic questions match 9/12 unreviewed generator labels; both match together on the same 9/12 rows. Tracking answers match all six expected failures and three expected passes. All three expected `insufficient` rows disagree on both questions; Jev returned no `insufficient` answers.
- Read `DOCUMENTATION/jev-shadow-pilot/PAIRED-PILOT-RESULTS.md` for evidence review, usage and checksums. Artifacts: `/private/tmp/gtm-jev-cloudflare-paired-v2-20260922/` (journal/results/score/audit and Terra review). No rubric, label or execution code changed during this evaluation. The executor read no labels; offline scoring read training expected labels after execution; validation and holdout remain unopened.
- Next: review the three abstention disagreements, then draft separately versioned rubric instructions/examples and a bounded comparison plan. Preserve concrete-fault detection, keep original results/labels frozen, and do not treat training agreement as human accuracy or calibration. No further paid run was launched after the 24-request allowance was consumed.

---

# Previous State — 2026-09-22 (direct Cloudflare Jev verified)

## Active work
- Checkout `/private/tmp/gtm-jev-execution-20260922`, branch `feat/jev-shadow-pilot`, draft PR #5 stacked on unmerged PR #4. Preserve the original cloud-offloaded workspace. Do not merge or enable enforcement.
- User chose direct Cloudflare Jev and approved Workers AI access. Wrangler OAuth now includes `ai:write`; credentials remain outside the repository. Terra implemented the direct adapter and first-error stop; root reviewed, fixed gateway parsing, verified, and ran live requests.
- Direct REST uses `typesafe/jev` at `/accounts/{account_id}/ai/run`, one question per request, structured observation only, no redirects/retries, killable worker, durable journal, transport-bound resume, actual response metadata and sanitized errors. No verified dollar cap is claimed.
- Checked-in configuration: `DOCUMENTATION/jev-shadow-pilot/cloudflare-execution.json`. Native seed: `/private/tmp/gtm-jev-cloudflare-seed-20260922/manifest.json`. Run instructions: `DOCUMENTATION/jev-shadow-pilot/DIRECT-CLOUDFLARE.md`.

## Verified live outcome
- Original pilot consumed 12 first-question attempts, all rejected by the initial parser because Cloudflare adds a completed gateway envelope. Those responses were not retained and are not reissued.
- Attempt 13 used an unattempted second question and preserved its response. The observed wrapper is `{result:{state:"Completed",result:{model,answers,usage},gatewayMetadata},success:true,errors:[],messages:[]}`. Parser fixed and regression tested; attempt 13 was revalidated offline, without a request, in a separate recovery artifact.
- Attempt 14 used a different unattempted second question and succeeded through the corrected direct adapter: resolved model `jev-1.13.0`, 14,123 input tokens and 49 output tokens, request ID `a3f2f3dff88745ee-DFW`.
- Total 14 of 24 requests consumed, no replay. The initial 12 paired result records remain errors; there are no complete paired predictions for scoring. Usage is known for attempts 13 and 14 only; total usage/cost is unknown. See `DOCUMENTATION/jev-shadow-pilot/CLOUDFLARE-LIVE-VERIFICATION.md`.

## Verification and next step
- 29 Python tests, 37 TypeScript tests, and TypeScript typecheck pass. Includes real loopback redirect refusal, worker kill/reap, shared concurrent budget, no replay, secret redaction, gateway wrapper, and stop-on-first-direct-error resume.
- Credentials and real integration are working. A fresh complete paired pilot is the next evaluation step; preserve the original journal and never replay consumed keys as a resume. The 12 original error records cannot support agreement/calibration claims. No label, validation or holdout data was read during this live integration.
- Live artifacts: `/private/tmp/gtm-jev-cloudflare-live-20260922/` (`journal.jsonl`, `results.jsonl`, `attempt-13-response.txt`, `attempt-13-recovered.json`). Journal SHA256: `b332db234287652a836e7e22f33cb0fbf73072c0677de96722cc83b695cbda07`.

---

# Previous State — 2026-09-22 (bounded execution driver)

## Branch
`feat/jev-shadow-pilot` — draft PR #5 against `feat/baseline-preserving-container-policy`.

## Active checkout
Execution work is in `/private/tmp/gtm-jev-execution-20260922`; the original workspace Git metadata is cloud-offloaded and could not be read. The original workspace was not rewritten. Use this checkout or recover the pushed branch from GitHub before continuing. The regenerated training pilot is under this checkout at `data/jev-shadow/training-pilot-v1-final`.

## What changed
- Added `scripts/jev_pilot_execute.py`, a default-off, shadow-only driver for the frozen 12-row Jev training pilot.
- It preflights executable package bytes, two native saved definitions, rubric/provider/model/seed identities, and only projects `input.observation`; expected-label bytes are not opened or parsed.
- A durable exclusive journal records each of at most 24 logical atomic attempts before dispatch. Timeouts/errors consume attempts; interruption is never retried; result artifacts are rebuilt atomically from authoritative completed journal records.
- The pinned TypeSafe route is blocked because its SDK has hidden retries. CLI execution is also blocked until a reviewed, verifiable provider-side spend-control adapter exists. No provider calls, spend settings, usage, predictions, GTM actions, or promotion were introduced.

## Verification
- Real final package preflight against a native frozen Cloudflare placeholder seed: 12 records, 24 attempt cap, 0 calls.
- 18 package/driver Python tests pass with fakes; native seed save/load test passes in the pinned runtime.
- Independent root verification: all 19 native/package/driver Python tests, all 37 TypeScript tests via `node --import tsx --test tests/*.test.ts`, and TypeScript typecheck pass.
- Full native runtime now resolves: `pip check` passes; all 18 installed Jev source files match the pinned commit. See `DOCUMENTATION/jev-shadow-pilot/PROVIDER-RUNTIME-REVIEW.md`.

## Remaining live work
Provider/model, credentials and maximum spend remain pending. The current CLI intentionally has no live spending-control adapter. Integrate the chosen provider with a verified hard spending limit, capture actual usage, and add a killable process boundary before any live pilot. Holdout remains reserved; do not merge PR #4 or #5 or promote Jev automatically.

# Current State — 2026-09-21 (frozen offline training pilot)

## Branch
`feat/jev-shadow-pilot` — draft PR #5 against unmerged `feat/baseline-preserving-container-policy` / PR #4. Do not merge or promote automatically.

## Completed
- Froze the two-function seed rubric in `DOCUMENTATION/jev-shadow-pilot/rubric-v1.json`.
- Added `scripts/jev-pilot-dataset.ts`: checksum-verified training inputs/truth only, injection-time generator truth, evidence-only expected answers, equivalent-input consistency check, deterministic selection, and separate input/label artifacts.
- Built `data/jev-shadow/training-pilot-v1-final`: 78 training observations, four reference rejects, 12 selected inputs / proposed 24 atomic evaluation ceiling; zero provider calls. Validation and holdout inputs/truth were not opened by preparation.
- Added actual native Jev save/load helper/test against pinned source; only a placeholder test model was used. Added offline preflight/scorer with explicit unreviewed-label agreement and runtime coverage.
- Independent review found and resolved absent-route false-positive cases; regression tests added.
- BLADE is JSON shape only; Jev remains default-off/shadow-only. No live evaluation, deployment, calibration or promotion.

## Verification
- 37 TypeScript tests and typecheck pass using exact-lockfile dependencies in `/private/tmp/gtm-offline-verification` because macOS offloads workspace files.
- Simulator: 26 Python tests pass. Native save/load and offline preflight/scorer: 8 Python tests pass.
- Real generated pilot preflight: 12 rows, proposed 24 atomic evaluations, zero calls.
- Detailed reproducibility, label coverage and limits: `DOCUMENTATION/jev-shadow-pilot/TRAINING-PILOT.md`.

## Next step / pending settings
- Await provider/model and maximum spend; the existing asynchronous question remains unanswered. No native provider credentials were found in the process environment or project configuration.
- Native backends: typesafe, cloudflare, vercel. Before live work: resolve runtime dependencies, freeze explicit provider/model definitions, enforce parent call limits, provider spending limits and usage recording. The current preflight/scorer does not execute providers.
- Preserve holdout for final evaluation. Expected answers are generator-defined and unreviewed; one topology per partition limits generalization claims.

---

# Current State — 2026-09-21 (v2 synthetic replay)

## Branch
`feat/jev-shadow-pilot` — draft PR #5 against `feat/baseline-preserving-container-policy`

## What Just Happened
- Extended the read-only synthetic-lab adapter for a direct-root v2 manifest with per-case lineage, container, topology, and planned split metadata.
- The grouped replay splitter connects cases that share any declared container, lineage, topology, or verified baseline-pair group, rejects partial/conflicting planned components, and keeps grouping metadata outside model input.
- Added the portable three-family synthetic generator. Its two-default-seed run emits 78 cases and yields 78 rows in each authored replay split across the demo's three cutoffs.
- Independent review caught consent-denied requests entering paid attribution; corrected both generators and added regression tests. V2 manifests now include generator-source hashes.
- Retained the v1 `datasets/demo-v1` compatibility path and ran its 36-observation offline replay successfully.
- Kept Jev shadow-only: no provider calls, labels/oracle access, GTM actions, calibration claims, or enforcement were added.

## Verification
- `TMPDIR=/private/tmp npm run typecheck`
- `node --import tsx --test --test-reporter=dot tests/*.test.ts` (27 passing; ordinary worker tests use the normal ten-second timeout and assert exact protocol errors)
- `python3 -m unittest discover -s scripts/synthetic-lab -p 'test_*.py' -v` (26 passing; provenance/reproducibility case also rerun after adding source hashes)
- `SYNTHETIC_GTM_LAB_PATH='/Users/jordaaan/Documents/ChatGPT/Measure U/synthetic-gtm-lab' TMPDIR=/private/tmp node --import tsx scripts/synthetic-lab-demo.ts` (36 v1 observations; 0 provider calls)
- `python3 scripts/synthetic-lab/generate_multi.py --output /private/tmp/gtm-multi-v2-root` plus the explicit-dataset demo (234 v2 observations; 78/78/78 splits; 0 provider calls)

## Next Steps
- Final corrected corpus: sibling `synthetic-gtm-lab/datasets/multi-topology-v2-final`; replay: `data/jev-shadow/multi-topology-replay-final/REPORT.md`. Source is checked in; generated files are not.
- Review draft PR #5 and its dependency #4. Neither is automatically merged. Before provider evaluation, pin and review the atomic definitions and provider configuration; no calibration or promotion has occurred.

# Previous State — 2026-09-21

## Branch
`feat/baseline-preserving-container-policy`

## What Just Happened
- Added `scripts/gtm-container-mutations.ts`, which applies only typed operations to a deep-cloned GTM export.
- Moved ID allocation, account/container identity, preservation checks, and reference validation into deterministic code.
- Updated the mutation prompt so providers never create full containers or supply IDs.
- Added compatibility tests for HRE web plus BLADE web and server-side exports.
- Documented Jev as a post-validation judge and OpenShell as a future worker sandbox boundary in `DOCUMENTATION/container-mutation-policy.md`.

## Verification
- `npm run typecheck`
- `npm test`
- `npm run eval:gtm -- content/gtm-templates/BLADE/seed/blade-sgtm.json`
- Committed as `e3969d4` and opened as PR #4.

## Next Steps
- Review and merge PR #4.
- Add the post-validation Jev worker and OpenShell worker sandbox only when the runtime execution phase is scheduled.

## Jev Shadow Pilot — 2026-09-21

- Stacked branch: `feat/jev-shadow-pilot`, based on the still-open container-policy PR #4.
- Added shadow-only evidence, pure routing policy, fake-tested Python worker adapter, grouped offline dataset/replay tooling, and BLADE web/server JSON-shape compatibility coverage only.
- `JEV_MODE=off` is default. `shadow` cannot change legacy keep/revert behavior.
- Draft stacked PR #5 is open against `feat/baseline-preserving-container-policy` (PR #4).
- Integrated the read-only synthetic-lab observation adapter: decision-time filtering, whole lineage provenance, and explicit no-oracle/no-causality limits.
- No Teleios claim, live GTM action, provider evaluation, calibration, OpenShell enforcement, enforcement activation, or synthetic-lab label ingestion occurred.

---

# Current State — 2026-04-07

## Branch
`feature/finetune-pipeline` — merged `origin/claude/autoresearch-ads-loop-x7t8v`

## What Just Happened
- Merged the autoresearch loop branch into the finetune pipeline branch
- Resolved README.md merge conflict (kept content from both sides)
- Fixed `import.meta.url` path encoding issue in `run-gtm-loop.ts` (spaces/tildes in iCloud path)
- Created `.env` with minimum viable config (MUTATION_PROVIDER=claude, MAX_ROUNDS=5)
- Ran first successful loop: **5 rounds, score 84.3% → 91.2%**
  - Consent settings improved 32% → 60%
  - Meta alignment hit 100%
  - CAPI coverage at 99.4%
- Winning config saved to `content/gtm-templates/winning/`
- Experiment log saved to `DOCUMENTATION/loops/gtm-autoresearch/loop-results/`

## Working State
- Loop runs end-to-end with seeded snapshot (no live API keys needed)
- Enriched snapshot timestamp updated to avoid staleness check
- All 12 scoring dimensions active

## Next Steps
- Add live API keys to `.env` for `refresh-ads-snapshot.ts`
- Push longer runs (MAX_ROUNDS=30) to hit 92% plateau target
- Consent settings (60%) and funnel integrity (70%) are the biggest improvement opportunities
- Consider committing the merge + fixes
