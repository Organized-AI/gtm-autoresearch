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

## Agent Conventions
- Read this file first on every session
- Check `AGENT-HANDOFF/CURRENT-STATE.md` before starting any work
- Write `AGENT-HANDOFF/CURRENT-STATE.md` after completing any phase
- Never modify files in data/signals/known-*.json manually — these are auto-maintained
