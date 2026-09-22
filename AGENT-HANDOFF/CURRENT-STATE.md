# Current State — 2026-09-22 (bounded execution driver)

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
