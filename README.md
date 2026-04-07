# gtm-autoresearch

> Automated GTM + tracking research loop for HRE — running 50–100 scored experiments per run, building toward a client-specialized fine-tuned LLM.

**Live Docs →** [gtm-autoresearch-docs.pages.dev](https://gtm-autoresearch-docs.pages.dev)

---

## Overview

This repo contains the autoresearch loop that:
1. Pulls live account state from GTM, Google Ads, and Meta
2. Runs scored experiments (problem → solution, scored 0.0–1.0)
3. Filters high-quality outputs into fine-tune training data (JSONL)
4. Feeds a client-specialized LLM routed through OpenClaw

---

## Branches

| Branch | Purpose |
|---|---|
| `main` | Stable autoresearch loop |
| `feature/finetune-pipeline` | Fine-tune data pipeline (active) |

---

## Fine-Tune Pipeline (feature/finetune-pipeline)

Six-phase architecture for converting autoresearch outputs into a client LLM:

| Phase | Name | Status |
|---|---|---|
| 1 | Experiment Logger Instrumentation | Specced |
| 2 | Account State Collector | Specced |
| 3 | Training Data Pipeline (JSONL) | Specced |
| 4 | Fine-Tune Runner (OpenAI + Ollama) | Specced |
| 5 | OpenClaw Client Brain Integration | Specced |
| 6 | Flywheel Automation | Specced |

**Full architecture and phase prompts →** [gtm-autoresearch-docs.pages.dev](https://gtm-autoresearch-docs.pages.dev)

---

### Architecture

```
╔══════════════════════════════════════════════════════════════╗
║                  CLIENT ACCOUNT DATA SOURCES                ║
╠═══════════════╦════════════════╦═════════════╦══════════════╣
║  GTM Export   ║  Google Ads    ║  Meta MCP   ║  claude-mem  ║
║  Container    ║  Campaigns     ║  Pixel/CAPI ║  SQLite +    ║
║  JSON         ║  Conversions   ║  Audiences  ║  Chroma      ║
╚═══════════════╩═══════╤════════╩═════════════╩══════════════╝
                        │
                        ▼
              ┌──────────────────────┐
              │  ACCOUNT STATE       │
              │  COLLECTOR           │
              │  → AccountState JSON │
              └──────────┬───────────┘
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
  ┌───────────────────┐    ┌───────────────────┐
  │ AUTORESEARCH LOOP │    │ claude-mem HISTORY │
  │ 50-100 experiments│    │ Past fixes,        │
  │ score: 0.0 → 1.0  │    │ decisions, patterns│
  └─────────┬─────────┘    └─────────┬─────────┘
            │                        │
            ▼                        ▼
  ┌────────────────────────────────────────────┐
  │  SCORING FILTER + FORMATTER                │
  │  score ≥ 0.75 → keep │ Dedup │ Inject      │
  │  Output: training.jsonl                    │
  └────────────────────┬───────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
  ┌───────────────────┐   ┌───────────────────────┐
  │ OPENAI FINE-TUNE  │   │ OLLAMA LOCAL           │
  │ gpt-4o-mini       │   │ Llama 3.1 8B / Mistral│
  │ Cloud / fast MVP  │   │ M3 Ultra / no egress  │
  └─────────┬─────────┘   └──────────┬────────────┘
            └────────────┬────────────┘
                         ▼
  ┌────────────────────────────────────────────┐
  │  CLIENT BRAIN AGENT (OpenClaw :18789)      │
  │  Fine-tuned model routed per client_id     │
  │  No 200k context dump — baked into weights │
  └────────────────────────────────────────────┘
                         ▲
                         │  flywheel: more client work → better model
                         └─────────────────────────────────────────
```

---

### Phase 1 — Experiment Logger Instrumentation

Modify the autoresearch loop to persist structured experiment records with score, context, and client_id. Foundation for everything downstream.

**Package:** `packages/experiment-logger/`

**Tasks:**
- `ExperimentRecord` schema: `client_id`, `run_id`, `problem`, `solution`, `score` (float 0–1), `timestamp`, `account_snapshot` (JSON), `sources_used` (string[])
- SQLite writer extending claude-mem DB at `:37777`
- Score normalization: validate 0.0–1.0 range, not pass/fail binary
- Tag each record with data sources used (GTM / Google Ads / Meta)
- CLI: `pnpm experiment-logger export --client bioptimizers` → JSONL to stdout

**Env vars:** `CLAUDE_MEM_DB_PATH`, `EXPERIMENT_LOG_DIR`, `SCORE_THRESHOLD=0.75`

---

### Phase 2 — Account State Collector

Pull and normalize client account data from GTM, Google Ads MCP, and Pipeboard Meta MCP into a versioned `AccountState` JSON object injected as system prompt context into every training record.

**Package:** `packages/account-state-collector/`

**AccountState schema:**
```
AccountState {
  client_id        string       // "bioptimizers" | "teleios" | "rtt"
  snapshot_at      ISO 8601     // when state was captured
  version          semver       // "1.0.0" → bump on meaningful change

  gtm: {
    container_id, workspace_id,
    tags[], triggers[], variables[],
    datalayer_schema[],          // inferred event names from triggers
    published_vs_draft_diff
  }

  google_ads: {
    account_id, campaigns[],
    conversion_actions[],
    enhanced_conversions,
    linked_gtm_containers[],
    performance_flags[]          // e.g. "$0 value on PMAX"
  }

  meta: {
    pixel_id, ad_account_id,
    events_fired[],              // {event_name, source, last_received}
    capi_config{},               // enabled, access_token_set, stape_id, match_rate
    custom_audiences[]
  }

  memory_summary   string       // top 5 past fixes from Chroma
  known_issues     string[]
  system_prompt    string       // pre-rendered, target ≤800 tokens
}
```

**MCP tool calls:**

| Source | MCP Tool | Output Field |
|---|---|---|
| GTM | `export_container` | gtm.tags, triggers, variables |
| GTM | `list_workspaces` | gtm.workspace_id |
| Google Ads | GAQL: campaigns + conversion_actions | google_ads.* |
| Meta | `get_pixels` | meta.pixel_id, events_fired |
| Meta | `get_custom_audiences` | meta.custom_audiences |
| claude-mem | Chroma similarity query | memory_summary |

**GTM normalization transform:** raw export → tag type code mapping → trigger filter extraction → variable parameter mapping → draft diff → system prompt render (≤800 tokens)

**Versioning:** Patch (1.0.x): campaign name changed. Minor (1.x.0): dataLayer schema changed. Major (x.0.0): platform migrated.

**CLI:** `pnpm account-state collect --client bioptimizers`

**Env vars:** `GTM_MCP_URL`, `GOOGLE_ADS_MCP_URL`, `META_MCP_URL`, `CHROMA_URL`, `CLIENT_DATA_DIR`

---

### Phase 3 — JSONL Training Data Pipeline

Filter high-scoring experiments, inject account state into system prompts, and export clean JSONL training files per client.

**Package:** `packages/training-pipeline/`

**Pipeline steps:**

1. **Score filter** — `score ≥ 0.75` (configurable per client), sorted DESC
2. **Deduplication** — Cosine similarity via Chroma (threshold 0.92), prevents model overfitting to repeated problem variants
3. **System prompt injection** — Load `AccountState.system_prompt`, build `messages[0]` = `{role:"system", content: ...}`, token guard ≤800 via tiktoken cl100k_base
4. **Quality gates** before export:
   - Min examples: 50
   - Token ceiling: 800
   - Max dedup rate: 40% (halt if exceeded)
   - Holdout split: 10% withheld for post-fine-tune eval

**JSONL record schema (OpenAI fine-tune format):**
```json
{
  "messages": [
    {"role": "system", "content": "<AccountState.system_prompt>"},
    {"role": "user", "content": "<experiment problem>"},
    {"role": "assistant", "content": "<high-scoring solution>"}
  ],
  "metadata": {
    "client_id": "hre",
    "score": 0.91,
    "run_id": "exp-2026-04-07-047",
    "account_state_version": "1.2.0",
    "sources": ["gtm", "google_ads"],
    "chroma_embedding_id": "..."
  }
}
```

**Output:** `data/clients/{client_id}/v{N}.jsonl` + `v{N}_eval.jsonl` (holdout set)

**CLI:** `pnpm pipeline export --client hre [--threshold 0.75] [--delta]`

**Env vars:** `SCORE_THRESHOLD`, `CHROMA_URL`, `CLIENT_DATA_DIR`, `MIN_TRAINING_EXAMPLES=50`, `TOKEN_CEILING=800`, `HOLDOUT_SPLIT=0.10`

---

### Phase 4 — Fine-Tune Runner (Dual Track)

Two parallel execution paths triggered when a new JSONL version is ready.

**Package:** `packages/fine-tune-runner/`

| | Track A — OpenAI | Track B — Ollama (NoClaw) |
|---|---|---|
| **Target model** | gpt-4o-mini | Llama 3.1 8B / Mistral |
| **Infra** | OpenAI cloud | M3 Ultra 512GB via Tailscale |
| **Data egress** | Training data leaves network | Zero — stays on Tailscale |
| **Cost** | ~$5–15 per run (100 examples) | Electricity only |
| **Best for** | New clients, fast MVP | Sensitive clients, production |

**Track selection:** New client <200 examples → Track A. Mature 500+ → Track B. Healthcare/sensitive → Track B only.

**Track A flow:** Upload JSONL → create fine-tune job → poll status → register model ID

**Track B flow:** Generate Modelfile from `AccountState.system_prompt` + base model → `ollama create {client_id}-client:v{N}` on M3 Ultra → register

**Eval harness:** 10-question holdout set per client, scored on problem recall (exact match %) + solution accuracy (cosine sim). Regression guard: v{N} must exceed v{N-1} - 0.05 tolerance.

**Model registry:** `data/clients/{client_id}/model_registry.json` — tracks versions, eval scores, active flag, track used.

**CLI:**
```bash
pnpm fine-tune submit --client hre --version 3 --track a
pnpm fine-tune eval --client hre --version 3
pnpm fine-tune rollback --client hre --version 2
```

**Env vars:** `OPENAI_API_KEY`, `OLLAMA_HOST`, `CLIENT_DATA_DIR`, `EVAL_REGRESSION_TOLERANCE=0.05`

---

### Phase 5 — OpenClaw Client Brain Integration

Route requests through OpenClaw gateway to the correct client-specialized model. Each `client_id` maps to an active model version.

**Package:** `packages/client-brain-router/`

**Middleware stack:**

| Layer | Name | Description |
|---|---|---|
| 1 | **Auth** | Tailscale IP check + API key validation (existing) |
| 2 | **ClientID** | Extract `x-client-id` → lookup `model_registry.json` → attach `ClientContext` |
| 3 | **ModelRouter** | Route to Track A (OpenAI) or Track B (Ollama) based on `ClientContext.track` |
| 4 | **Telemetry** | Log `client_id`, `model_version`, `track`, latency, tokens to SQLite |
| 5 | **Fallback** | If no active model: inject `AccountState.system_prompt` as RAG context |

**Fallback chain:** Fine-tuned model (preferred) → RAG context injection (client <50 examples) → Base model (no account state available, log warning)

**Per-client config:** `data/clients/{id}/config.json` — `track_preference`, `data_egress_allowed`, `min_examples_to_activate`, `score_threshold`, `openclaw_routing` (fallback mode, response headers)

**Response headers:** `x-model-version`, `x-client-id`, `x-fallback-used`

**CLI:** `pnpm openclaw register --client hre --model {id} --track a`

**Env vars:** `OPENCLAW_PORT=18789`, `OLLAMA_HOST`, `FALLBACK_MODEL=claude-sonnet-4-6`, `CHROMA_URL`, `TELEMETRY_DB_PATH`

---

### Phase 6 — Flywheel Automation

Close the loop. New autoresearch runs automatically trigger re-scoring, JSONL delta append, and retrain when enough new high-quality examples accumulate.

**Package:** `packages/flywheel/`

**The compounding loop:**
```
Client engagement → Autoresearch loop (50-100 experiments)
  → Flywheel watcher (counts new high-score records)
    → delta ≥ 20: trigger JSONL pipeline export
      → Fine-tune runner (Track A or B) → eval → promote
        → OpenClaw brain (new model active, smarter responses)
          → Drift check (telemetry → regression?) ──→ [loop back]
```

**Watcher trigger events:**

| Event | Condition | Action |
|---|---|---|
| New examples gate | New high-score since last export ≥ `RETRAIN_DELTA` | Trigger pipeline export + retrain |
| Scheduled run | After each autoresearch run completes | Check gate, trigger if met |
| Drift detection | Eval score drop > tolerance vs last version | Alert + auto-rollback |
| Account state change | `AccountState` major/minor version bump | Force retrain |
| Manual trigger | `pnpm flywheel run --client hre --force` | Bypass delta gate |

**Drift detection:** Compare eval scores v{N} vs v{N-1}. Auto-rollback if regression exceeds `DRIFT_TOLERANCE` (default 0.05).

**Version pruner:** Keep max 5 versions per client. Delete old OpenAI files / Ollama models.

**Flywheel config:** `data/clients/{id}/flywheel.json`
```json
{
  "retrain_delta": 20,
  "drift_tolerance": 0.05,
  "max_versions": 5,
  "retrain_on_state_change": true,
  "auto_promote": true,
  "auto_rollback": true,
  "notifications": {
    "slack_channel": "#organized-ai-ops",
    "events": ["promote", "rollback", "gate_met", "state_change"]
  },
  "last_export_run_id": "exp-2026-04-07-100",
  "last_retrain_version": "v3"
}
```

**CLI:**
```bash
pnpm flywheel start --client hre       # run once now
pnpm flywheel watch --client hre       # watch mode (post-research hook)
pnpm flywheel status --client hre      # show current state
pnpm flywheel run --client hre --force # bypass delta gate
```

**Env vars:** `CLIENT_DATA_DIR`, `SLACK_WEBHOOK_URL`, `RETRAIN_DELTA=20`, `DRIFT_TOLERANCE=0.05`, `MAX_MODEL_VERSIONS=5`

**After Phase 6:** Full integration test all 6 phases end-to-end with HRE → tag `v1.0.0-finetune-pipeline`

---

## Stack

- **Runtime**: TypeScript / Node.js, pnpm workspaces, Turborepo
- **Memory**: SQLite + Chroma (claude-mem, `:37777`)
- **MCP Tools**: GTM (Stape), Google Ads (TrueClicks), Pipeboard Meta
- **Fine-tune targets**: OpenAI gpt-4o-mini (cloud) · Ollama Llama 3.1 8B (local, M3 Ultra via NoClaw `:11434`)
- **Agent gateway**: OpenClaw (`:18789`)
- **Infra**: Tailscale mesh — M4 Mac Mini · MacBook M1 Pro · M3 Ultra

---

## Docs

Documentation is deployed to Cloudflare Pages from the `docs/` directory.

### Deploy locally

```bash
# Install wrangler if needed
npm install -g wrangler

# Deploy (from repo root)
wrangler pages deploy docs --project-name gtm-autoresearch-docs
```

### Update docs

```bash
# After editing files in docs/
wrangler pages deploy docs --project-name gtm-autoresearch-docs
```

---

## Local Setup

```bash
git clone https://github.com/Organized-AI/gtm-autoresearch
cd gtm-autoresearch
pnpm install

# Copy env template
cp .env.example .env
# Fill in: CLAUDE_MEM_DB_PATH, GTM_MCP_URL, GOOGLE_ADS_MCP_URL, META_MCP_URL
```

### Env vars

| Variable | Description |
|---|---|
| `CLAUDE_MEM_DB_PATH` | Path to claude-mem SQLite DB |
| `EXPERIMENT_LOG_DIR` | Where experiment JSONL logs are written |
| `SCORE_THRESHOLD` | Min score for training data (default: `0.75`) |
| `GTM_MCP_URL` | `https://gtm-mcp.stape.ai/mcp` |
| `GOOGLE_ADS_MCP_URL` | TrueClicks MCP endpoint |
| `META_MCP_URL` | `https://mcp.pipeboard.co/meta-ads-mcp` |
| `CHROMA_URL` | `http://localhost:37777` |
| `CLIENT_DATA_DIR` | `./data/clients` |

---

## Organized AI

Built and maintained by [Organized AI](https://organizedai.vip) · [GitHub](https://github.com/Organized-AI)
