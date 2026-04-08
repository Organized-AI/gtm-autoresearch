---
name: gtm-autoresearch-loop
description: Run a Karpathy-style autonomous optimization loop on a GTM container for a specific client. Scores across 12 dimensions (structural + ads-driven), mutates via Claude CLI, validates invariants, and saves winning configs.
triggers:
  - "run gtm loop"
  - "autoresearch loop"
  - "optimize GTM container"
  - "run the loop for"
  - "gtm experiment"
---

# GTM Autoresearch Loop Skill

Autonomous GTM container optimization using structural scoring + LLM mutations.

## What It Does

Takes a client's GTM container export JSON and enriched ads snapshot, then runs an iterative improve-or-revert loop:

1. **Score** — Evaluate the container across 12 weighted dimensions
2. **Prompt** — Build a targeted mutation prompt focusing on the lowest-scoring dimension
3. **Mutate** — Call Claude CLI to generate JSON operations (add tags, set consent, etc.)
4. **Validate** — 3-tier gate: JSON parse, GTM schema, invariant constraints
5. **Keep/Revert** — Accept improvements, reject regressions
6. **Repeat** — Until plateau (92%+ for 3 rounds), max rounds, or failure limit

## Prerequisites

### Per-Client Setup

Each client needs a directory under `content/gtm-templates/{CLIENT}/`:

```
content/gtm-templates/{CLIENT}/
  seed/
    {template-name}.json          # GTM container export (from GTM > Admin > Export)
  winning/                        # Auto-populated by the loop
  manifest.json                   # Created after first successful run
```

Each client needs an ads snapshot at `data/signals/{client}-ads-snapshot-enriched.json`.

Each client needs a program contract at `content/gtm-templates/{client}-program.md`.

### Ads Snapshot Format

The enriched ads snapshot JSON must have this structure:

```json
{
  "generated_at": "ISO timestamp",
  "partial": false,
  "meta": {
    "account_id": "act_...",
    "account_name": "...",
    "pixel_id": "...",
    "conversion_events": [
      { "event_name": "...", "count": N, "value": N, "currency": "USD" }
    ],
    "browser_server_split": { "event_name": { "browser": N, "server": N } },
    "emq_scores": { "event_name": N },
    "dedup_rates": { "event_name": N }
  },
  "google_ads": {
    "customer_id": "...",
    "account_name": "...",
    "conversion_actions": [
      { "name": "...", "category": "...", "status": "ENABLED", "count": N, "value": N }
    ]
  },
  "funnel": [
    { "from": "event_a", "to": "event_b", "ratio": 0.85 }
  ]
}
```

If Meta/Google data is unavailable, the loop falls back to 8-dimension structural-only scoring.

### Program Contract Format

Copy from `content/gtm-templates/program.md` and update:

- `Template file:` path to the client's seed template
- `Enriched Ads snapshot:` path to the client's enriched snapshot
- `Meta Ads snapshot:` path to the client's legacy meta snapshot (optional)

The strategy order, constraints, weights, and mutation budget stay the same across clients.

## Execution

### Step 0: Export GTM Container via MCP (Stape GTM Server)

If the Stape GTM MCP server is connected, export directly without leaving Claude Code:

1. **List accounts**: `gtm_account(action: "list", accountId: "all")`
2. **List containers**: `gtm_container(action: "list", accountId: "ACCOUNT_ID")`
3. **Pull live version** (paginated — repeat for each resource type):
   ```
   gtm_version(action: "live", accountId: "...", containerId: "...",
     resourceType: "tag", itemsPerPage: 20, page: 1, includeSummary: true)
   ```
   Resource types to collect: `tag`, `trigger`, `variable`, `folder`, `builtInVariable`, `customTemplate`, `zone`, `transformation`
4. **Assemble** all pages into GTM export JSON (exportFormatVersion: 2)
5. **Save** to `content/gtm-templates/{CLIENT}/seed/{publicId}-live.json`

Assembly script: `npx tsx scripts/export-gtm-container.ts <dump.json> <CLIENT>`

### Step 1: Prepare Client Data

```bash
# Create client directory
mkdir -p content/gtm-templates/{CLIENT}/seed content/gtm-templates/{CLIENT}/winning

# Place the GTM export in seed/ (or use Step 0 MCP export)
cp /path/to/export.json content/gtm-templates/{CLIENT}/seed/{template-name}.json

# Place or create the enriched ads snapshot
# (manual creation or via refresh-ads-snapshot.ts with correct env vars)
cp /path/to/snapshot.json data/signals/{client}-ads-snapshot-enriched.json

# Create the program contract
cp content/gtm-templates/program.md content/gtm-templates/{client}-program.md
# Edit to update template/snapshot paths
```

### Step 2: Run the Loop

```bash
# Default (5 rounds, claude/sonnet)
npx tsx scripts/run-gtm-loop.ts content/gtm-templates/{client}-program.md

# Full 30-round run
MAX_ROUNDS=30 npx tsx scripts/run-gtm-loop.ts content/gtm-templates/{client}-program.md
```

### Step 3: Review and Catalog Results

Outputs are saved automatically to the client directory:
- **Winning config** → `content/gtm-templates/{CLIENT}/winning/{timestamp}-{template}.json`
- **Experiment log** → `content/gtm-templates/{CLIENT}/loop-results/{timestamp}.json`

After the run:
- Rename the best winning config: `best-{score}pct-{date}.json`
- Create/update `manifest.json` with client metadata, scores, and improvements

### Step 4: Validate the Winner

```bash
npx tsx evals/eval_gtm_signal_quality.ts content/gtm-templates/{CLIENT}/winning/best-*.json \
  --enriched-snapshot data/signals/{client}-ads-snapshot-enriched.json
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MUTATION_PROVIDER` | `claude` | `claude` or `codex` |
| `MUTATION_MODEL` | `sonnet` | Model for mutations |
| `CLAUDE_PATH` | `/Users/jordaaan/.local/bin/claude` | Path to Claude CLI |
| `MAX_ROUNDS` | `30` | Maximum optimization rounds |

## Architecture Notes

- **Mutations use JSON operations**, not full container output. The LLM returns `add_tag`, `modify_tag`, `set_consent_all` ops that get applied programmatically. This avoids the 35KB+ output timeout.
- **Validation is against the original seed**, not the previous round. This prevents drift.
- **The loop is idempotent** — re-running starts fresh from the seed template.
- **Strategy auto-selects** the lowest-scoring dimension with errors each round.

## Scoring Dimensions (12)

| # | Dimension | Weight | Requires Ads Data |
|---|-----------|--------|-------------------|
| 1 | Tag coverage | 0.14 | No |
| 2 | Parameter completeness | 0.10 | No |
| 3 | Deduplication | 0.07 | No |
| 4 | Consent settings | 0.11 | No |
| 5 | Naming conventions | 0.06 | No |
| 6 | Variable hygiene | 0.06 | No |
| 7 | Trigger quality | 0.08 | No |
| 8 | Folder organization | 0.06 | No |
| 9 | Meta Ads alignment | 0.09 | Yes |
| 10 | CAPI coverage | 0.08 | Yes |
| 11 | Funnel integrity | 0.07 | Yes |
| 12 | Google Ads alignment | 0.08 | Yes |
