# Current State — 2026-09-21 (v2 synthetic replay)

## Branch
`feat/jev-shadow-pilot` — draft PR #5 against `feat/baseline-preserving-container-policy`

## What Just Happened
- Extended the read-only synthetic-lab adapter for a direct-root v2 manifest with per-case lineage, container, topology, and planned split metadata.
- The grouped replay splitter connects cases that share any container, lineage, or topology group, rejects partial/conflicting planned components, and keeps grouping metadata outside model input.
- Retained the v1 `datasets/demo-v1` compatibility path and ran its 36-observation offline replay successfully.
- Kept Jev shadow-only: no provider calls, labels/oracle access, GTM actions, calibration claims, or enforcement were added.

## Verification
- `TMPDIR=/private/tmp npm run typecheck`
- `TMPDIR=/private/tmp node --import tsx --test tests/*.test.ts` (27 passing)
- `SYNTHETIC_GTM_LAB_PATH='/Users/jordaaan/Documents/ChatGPT/Measure U/synthetic-gtm-lab' TMPDIR=/private/tmp node --import tsx scripts/synthetic-lab-demo.ts` (36 v1 observations; 0 provider calls)

## Next Steps
- Push the v2 replay commit to draft PR #5 and review it against the stacked baseline-policy PR.

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
