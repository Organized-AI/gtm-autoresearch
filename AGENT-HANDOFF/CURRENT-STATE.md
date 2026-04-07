# Current State — Fine-tune Pipeline

## Last Completed Phase
**Phase 2: Meta Ads Capture** — 2026-04-07

## What Was Done
- Created `src/meta-ads/transform.ts` — MetaAdRaw/CaptureMetadata interfaces, calculateScore (ROAS 60% + CTR 20% + convRate 20%), buildProblem, buildSolution, transformAdsToExperiments
- Created `evals/eval_meta_ads_transform.ts` — 27 tests all passing (scoring, clamping, filtering, schema compliance)
- Created `scripts/extract-meta-ads.ts` — Extracts Pipeboard MCP result files into staging JSON
- Created `.claude/commands/capture-meta-ads.md` — `/capture-meta-ads` slash command for live capture
- Pulled live data from HRE Beauty (`act_645790768357540`) via Pipeboard MCP bulk_get_insights
- Imported 220 experiment records into SQLite (9 zero-spend ads filtered)
- Verified idempotency: re-import stays at 220 records
- Updated CLAUDE.md with Meta Ads capture documentation
- Added `eval:meta-ads` and `capture-meta` scripts to package.json

## Key Metrics (2026-04-07 Capture)
- 229 ads total, 220 active (spend > 0)
- $49,402 total spend, 1,321 purchases
- 10 campaigns
- Top scorer: HRE_Andromeda_Advantage+_Video-Everyday-Gloss (ROAS 12.03, score 1.000)
- Account average score ≈ 0.2 (matches calibration target)

## Branch
`feature/finetune-pipeline`

## Next Phase
**Phase 3: JSONL Formatter** — Convert ExperimentRecord rows into Claude fine-tune JSONL format (system/user/assistant message triples).

## Creative Enrichment
- All 220 records enriched with headline, copy, and CTA from `bulk_get_ad_creatives` (5 batches of 50)
- 225/225 creatives had body or title text (100% match rate)
- Enrichment script: `scripts/enrich-meta-creatives.ts` (accepts multiple creative result files)

## Known Issues
- `add_to_carts` and `initiates_checkout` fields default to 0 in compact mode — not available via bulk_get_insights compact.
