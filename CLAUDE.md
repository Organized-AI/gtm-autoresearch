# gtm-autoresearch

## What This Is
Karpathy-style autonomous optimization loop for GTM container configs. Scores across 12 dimensions (8 structural + 4 ads-driven), mutates via Claude CLI, validates, keeps or reverts.

## Tech Stack
- TypeScript (tsx runner, no compile step needed for scripts)
- Node.js 18+
- Claude CLI (mutation provider)

## GTM Autoresearch Loop

Karpathy-style autonomous optimization loop for GTM container configs. Scores across 12 dimensions (8 structural + 4 ads-driven), mutates via Claude CLI, validates, keeps or reverts.

### Key Files
- `scripts/run-gtm-loop.ts` — Core loop: score → mutate → validate → keep/revert
- `evals/eval_gtm_signal_quality.ts` — 12-dimension scorer
- `data/signals/ads-snapshot-enriched.json` — Live snapshot with conversion data
- `content/gtm-templates/{CLIENT}/program.md` — Loop contract (dimensions, strategies, constraints)
- `.claude/commands/refresh-ads-snapshot.md` — Slash command to refresh snapshot via MCP
- `data/clients/{client_id}/config.json` — Per-client account IDs

### Data Sources (MCP tools — no API keys needed)

| Source | MCP Server | What it provides |
|---|---|---|
| Meta Ads | Pipeboard Meta | Conversion events, spend, pixel info, attribution windows |
| Google Ads | TrueClicks | Conversion actions, counts, values, tag snippets (GAQL) |
| GTM | google-tag-manager | Live container state (tags, triggers, variables) |

### Running the Loop
```bash
# 1. Refresh snapshot via slash command (uses MCP — no API keys)
/refresh-ads-snapshot hre

# 2. Run the optimization loop
npx tsx scripts/run-gtm-loop.ts
```

### Per-Client Config
Each client has `data/clients/{client_id}/config.json`:
```json
{
  "client_id": "hre",
  "meta": { "ad_account_id": "act_...", "pixel_id": "..." },
  "google_ads": { "customer_id": "...", "login_customer_id": "..." },
  "gtm": { "account_id": "...", "container_id": "...", "workspace_id": "..." },
  "snapshot_path": "data/signals/ads-snapshot-enriched.json",
  "template_path": "content/gtm-templates/HRE/seed/shopify-ecom-web.json"
}
```

### Environment (.env)
```
MUTATION_PROVIDER=claude          # or "codex"
CLAUDE_PATH=/path/to/claude       # claude CLI binary
MAX_ROUNDS=30                     # rounds per run
```

### Outputs
- Winning config: `content/gtm-templates/{CLIENT}/winning/`
- Experiment log: `content/gtm-templates/{CLIENT}/loop-results/{timestamp}.json`

### Stop Conditions
- Score >= 92% sustained for 3 rounds (plateau)
- 3 consecutive regressions
- 5 consecutive JSON parse failures
- Max rounds reached

## Agent Conventions
- Read this file first on every session
- Check `AGENT-HANDOFF/CURRENT-STATE.md` before starting any work
- Write `AGENT-HANDOFF/CURRENT-STATE.md` after completing any phase
- Never modify files in data/signals/known-*.json manually — these are auto-maintained
