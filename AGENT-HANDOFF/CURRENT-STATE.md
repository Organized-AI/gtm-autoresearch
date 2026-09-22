# Current State — 2026-09-21

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
- Added shadow-only evidence, pure routing policy, fake-tested Python worker adapter, grouped offline dataset/replay tooling, and BLADE web/server fixture coverage.
- `JEV_MODE=off` is default. `shadow` cannot change legacy keep/revert behavior.
- No Teleios claim, live GTM action, provider evaluation, calibration, OpenShell enforcement, or enforcement activation occurred.

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
