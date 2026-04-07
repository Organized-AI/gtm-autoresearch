# auto-research-engine

## What This Is
A self-improvement engine that watches Claude Code session logs, extracts tool/MCP/package usage signals, fires the Apify plugin watcher actor, scores adjacency gaps, and auto-generates Obsidian experiment notes + skill stubs + plugin marketplace entries.

This runs quietly in the background on the MacBook (supabowl). It is NOT part of OpenClaw. It is a personal dev intelligence tool.

## Project Path
`/Users/supabowl/Library/Mobile Documents/com~apple~CloudDocs/BHT Promo iCloud/Organized AI/Windsurf/Autoresearch Engine`

## Machine
MacBook M1 Pro — username: supabowl

## Tech Stack
- TypeScript (tsx runner, no compile step needed for scripts)
- Node.js 18+
- fswatch (already installed at /opt/homebrew/bin/fswatch)
- Apify API (REST, no SDK needed)
- Cloudflare Worker (webhook receiver only)
- Anthropic API (claude-haiku-4-5 for self-eval gate)

## Key Paths (read-only references, never write to these)
- Claude Code logs: `~/.claude/projects/**/*.jsonl`
- Existing skills: `/mnt/skills/user/` (cross-reference only)
- Plugin marketplace: `/Users/supabowl/Documents/repos/plugin-marketplace/`
- Obsidian vault: `$OBSIDIAN_VAULT_PATH` (from .env)

## Output Paths (this engine writes here)
- Obsidian experiments: `$OBSIDIAN_VAULT_PATH/Planning/experiments/`
- Skill stubs: `.claude/skills/[tool-name]/SKILL.md`
- Marketplace stubs: `/Users/supabowl/Documents/repos/plugin-marketplace/[tool-name]/`

## Pipeline Order
```
fswatch → significance-check → run-actor (+ ad-hoc webhook) → [Cloudflare KV] → fetch-dataset → analyze-adjacency → generate-experiments
```

## Conventions
- All scripts in `scripts/` run via `npx tsx scripts/[name].ts`
- Errors logged to `data/errors/{timestamp}.log`, never crash silently
- All outputs are idempotent — re-running never duplicates
- Console logs use phase prefix: `[Phase0]`, `[Phase1]`, etc.
- Every run writes a run manifest to `data/signals/run-history.json`
- `scripts/run-all.sh` chains the full pipeline in order

## Environment
See `.env.example` for all required variables. Copy to `.env` before running.

## Phase Execution
```bash
cd /Users/supabowl/Library/Mobile\ Documents/com~apple~CloudDocs/BHT\ Promo\ iCloud/Organized\ AI/Windsurf/Autoresearch\ Engine
claude --dangerously-skip-permissions
# Then: "Read PLANNING/CLAUDE-CODE-EXECUTION-RUNBOOK.md and execute the next phase"
```

## Experiment Logger (Phase 1 — Fine-tune Pipeline)

Local SQLite-backed experiment store for structured training data.

### Schema
`src/types/experiment.ts` — Zod-validated `ExperimentRecord` with id, client_id, run_id, problem, solution, score (0.0–1.0), timestamp, account_snapshot, sources_used.

### Key Files
- `src/experiment-logger/db.ts` — SQLite writer (better-sqlite3, WAL mode, INSERT OR IGNORE)
- `src/experiment-logger/logger.ts` — `ExperimentLogger` class (save, saveBatch, query, export, count)
- `scripts/experiment-logger.ts` — CLI: `export --client`, `count --client`, `import --file --client`
- `evals/eval_experiment_logger.ts` — Tests: schema, score clamping, round-trip, JSONL, idempotency, filtering

### Database
- Path: `data/experiments.sqlite`
- Indexed on `(client_id, run_id)`
- Idempotent: duplicate IDs silently ignored

### CLI
```bash
npx tsx scripts/experiment-logger.ts export --client hre    # JSONL to stdout
npx tsx scripts/experiment-logger.ts count --client hre     # count records
npx tsx scripts/experiment-logger.ts import --file data.json --client hre  # bulk import
```

## Meta Ads Capture (Phase 2 — Live Data)

Pulls Meta Ads campaign + creative data from Pipeboard MCP tools into the experiment logger.

### Key Files
- `src/meta-ads/transform.ts` — `MetaAdRaw` / `CaptureMetadata` interfaces, `calculateScore`, `buildProblem`, `buildSolution`, `transformAdsToExperiments`
- `scripts/extract-meta-ads.ts` — Extracts from Pipeboard MCP result file → staging JSON → ready for import
- `evals/eval_meta_ads_transform.ts` — 27 tests: scoring, filtering, schema compliance
- `.claude/commands/capture-meta-ads.md` — Slash command `/capture-meta-ads` for live capture

### Score Formula
`ROAS/5.0 (60%) + CTR/3.0 (20%) + convRate/0.05 (20%)`, clamped 0–1. HRE average ≈ 0.2, top performers 0.5–1.0.

### Data Flow
```
Pipeboard MCP → bulk_get_insights (ad level, last 30d) → extract-meta-ads.ts → data/signals/meta-ads-experiments.json → CLI import → SQLite
```

### Account
- HRE Beauty: `act_645790768357540`
- Client ID: `hre`

### CLI
```bash
npx tsx scripts/experiment-logger.ts count --client hre     # check record count
/capture-meta-ads                                            # full capture via slash command
```

## Agent Conventions
- Read this file first on every session
- Check `AGENT-HANDOFF/CURRENT-STATE.md` before starting any work
- Write `AGENT-HANDOFF/CURRENT-STATE.md` after completing any phase
- Never modify files in data/signals/known-*.json manually — these are auto-maintained
