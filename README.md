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
| 1 | Experiment Logger Instrumentation | 🔨 In progress |
| 2 | Account State Collector | 📋 Specced |
| 3 | Training Data Pipeline (JSONL) | 📋 Planned |
| 4 | Fine-Tune Runner (OpenAI + Ollama) | 📋 Planned |
| 5 | OpenClaw Client Brain Integration | 📋 Planned |
| 6 | Flywheel Automation | 📋 Planned |

**Full architecture and phase prompts →** [gtm-autoresearch-docs.pages.dev](https://gtm-autoresearch-docs.pages.dev)

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
