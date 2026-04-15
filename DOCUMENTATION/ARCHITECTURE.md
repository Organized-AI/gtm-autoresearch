# gtm-autoresearch — Architecture

Karpathy-style autonomous experimentation loop applied to Google Tag Manager
container configs. Mutate → score → keep/revert → repeat, until a plateau is hit
or the round budget is spent.

**Two-tier model strategy**

- **Exploration** (score < 0.92): Claude Sonnet drives mutations — cheap, broad coverage
- **Escalation** (score ≥ 0.92): Claude Opus 4.6 takes over — deeper reasoning to extract the last gains
- Escalation is one-way per run; plateau detection only begins *after* escalating

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OPERATOR (you)                                 │
│                    npx tsx scripts/run-gtm-loop.ts                          │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ reads
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           program.md  (human input)                         │
│   DOCUMENTATION/loops/gtm-autoresearch/program.md                           │
│   ──────────────────────────────────────────────────────                    │
│   • clients[]   → id, template, meta snapshot, eval path                    │
│   • strategyOrder[]   (mutation priorities)                                 │
│   • constraints[]     (never-break rules)                                   │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ parsed into ProgramConfig
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     RUN-GTM-LOOP  (orchestrator)                            │
│                     scripts/run-gtm-loop.ts                                 │
│                                                                             │
│   for each client:                                                          │
│     ┌──────────────────────────────────────────────────────────────────┐    │
│     │  ROUND LOOP  (max 30 rounds)                                     │    │
│     │                                                                  │    │
│     │  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────────┐     │    │
│     │  │  SCORE   │──▶│  PROMPT  │──▶│  MUTATE  │──▶│ VALIDATE   │──┐  │    │
│     │  │  (eval)  │   │  (build) │   │ (Claude) │   │ + keep/rev │  │  │    │
│     │  └──────────┘   └──────────┘   └────┬─────┘   └────────────┘  │  │    │
│     │        ▲                             │                        │  │    │
│     │        │                             ▼                        │  │    │
│     │        │                  ┌──────────────────────┐            │  │    │
│     │        │                  │  MODEL ROUTER        │            │  │    │
│     │        │                  │  score < 0.92:       │            │  │    │
│     │        │                  │    → Claude Sonnet   │            │  │    │
│     │        │                  │  first cross of 0.92:│            │  │    │
│     │        │                  │    → ESCALATE        │            │  │    │
│     │        │                  │  score ≥ 0.92:       │            │  │    │
│     │        │                  │    → Claude Opus 4.6 │            │  │    │
│     │        │                  └──────────────────────┘            │  │    │
│     │        └──────────────── next round ◀─────────────────────────┘  │    │
│     │                                                                  │    │
│     │  Stop when (after escalation):                                   │    │
│     │    score ≥ 0.92 for 3× on Opus │ 30 rounds │ 3 regressions       │    │
│     └──────────────────────────────────────────────────────────────────┘    │
└──┬────────────┬───────────────┬──────────────────┬──────────────────┬───────┘
   │            │               │                  │                  │
   │ invokes    │ loads         │ loads            │ spawns           │ writes
   ▼            ▼               ▼                  ▼                  ▼
┌────────┐  ┌──────────┐  ┌────────────┐  ┌─────────────────┐  ┌──────────────┐
│ EVAL   │  │ TEMPLATE │  │ META ADS   │  │  TWO-TIER MODEL │  │  KV / R2     │
│ (eval) │  │  (JSON)  │  │  SNAPSHOT  │  │  (subprocess)   │  │  store       │
│        │  │          │  │   (JSON)   │  │                 │  │              │
│ evals/ │  │ content/ │  │  data/     │  │ < 0.92:         │  │ scripts/lib/ │
│ eval_  │  │ clients/ │  │  clients/  │  │   Claude Sonnet │  │ kv-store.ts  │
│ gtm_   │  │ <id>/    │  │  <id>/     │  │ ≥ 0.92:         │  │              │
│ signal_│  │ shopify- │  │  meta-ads- │  │   Claude Opus   │  │ • seed       │
│ quality│  │ ecom-web │  │  snapshot  │  │   4.6           │  │ • rounds     │
│  .ts   │  │  .json   │  │   .json    │  │                 │  │ • manifest   │
│        │  │          │  │            │  │ CLAUDE_PATH=    │  │              │
│        │  │          │  │            │  │ ~/.local/bin/   │  │              │
│        │  │          │  │            │  │ claude          │  │              │
│        │  │          │  │            │  │ mutates 1 file: │  │              │
│        │  │          │  │            │  │ container JSON  │  │              │
└────────┘  └──────────┘  └────────────┘  └─────────────────┘  └──────┬───────┘
     │                                                                │
     │ returns GtmSignalQualityResult                                  │ CF R2
     │  { score, dimensions{9}, issues[] }                             │ winning-
     ▼                                                                 │ config
┌──────────────────────────┐                                           │ .json
│  9-DIMENSION SCORER      │                                           ▼
│  ─────────────────────── │                                    ┌──────────────┐
│  1. Tag coverage         │                                    │  MORNING     │
│  2. Param completeness   │                                    │  DELIVER-    │
│  3. Deduplication        │                                    │  ABLES       │
│  4. Consent Mode v2      │                                    │ ──────────── │
│  5. Naming conventions   │                                    │ • staging    │
│  6. Variable hygiene     │                                    │   workspace  │
│  7. Trigger quality      │                                    │ • versioned  │
│  8. Folder organization  │                                    │   JSON in R2 │
│  9. Meta Ads alignment   │                                    │ • experiment │
│     (weighted by $)      │                                    │   log        │
└──────────────────────────┘                                    │ • Playwright │
                                                                │   QA report  │
                                                                └──────────────┘
```

## Per-round data flow

```
  container.json ──▶ [EVAL]  ──▶ score + issues
                                      │
                                      ▼
       strategyOrder + constraints + issues
                                      │
                                      ▼
                     [BUILD PROMPT]  (mutation budget: 3 edits)
                                      │
                                      ▼
            ┌─────────────────────────┴────────────────────────┐
            │            [MODEL ROUTER]                        │
            │  currentModel === "sonnet"  &&  score < 0.92     │
            │        └──▶  Claude Sonnet (exploration)         │
            │  score ≥ 0.92 on first cross                     │
            │        └──▶  ESCALATE — switch to Opus 4.6       │
            │  currentModel === "opus"                         │
            │        └──▶  Claude Opus 4.6 (escalation)        │
            └─────────────────────────┬────────────────────────┘
                                      │
                                      ▼
                     [model subprocess]  ── returns JSON Patch
                                      │
                                      ▼
                        [RE-EVAL on mutated container]
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
                   score improved              score dropped
                         │                         │
                         ▼                         ▼
                    KEEP patch              REVERT to prior
                  write round rec           increment regression
                         │                         │
                         └────────────┬────────────┘
                                      ▼
                             putRound(KV) → next
```

## Key files

| Path | Role |
|---|---|
| `scripts/run-gtm-loop.ts` | Orchestrator — round loop, model router, plateau detection |
| `scripts/lib/kv-store.ts` | Persists seed/rounds/manifest to Cloudflare KV (via wrangler) |
| `scripts/drift.ts` | CLI to list runs, reconstruct any version from seed+patches, and diff two versions |
| `scripts/hydrate-gtm-template.ts` | Fills a template with client-specific values |
| `evals/eval_gtm_signal_quality.ts` | Base 9-dim ecom scorer + shared type definitions (`GtmContainer`, `DimensionScore`, `GtmSignalQualityResult`, etc.) |
| `evals/clients/<id>.ts` | Per-client eval module. Exports `default (container, meta) => GtmSignalQualityResult`. Loaded dynamically per the `Eval:` line in `program.md` |
| `evals/clients/hre_beauty.ts` | Thin wrapper over base ecom eval (Shopify DTC) |
| `evals/clients/blade_web.ts` | BLADE-specific web eval (lead-gen + high-ticket + custom conversions) |
| `evals/clients/blade_server.ts` | BLADE-specific sGTM eval (CAPI, PII hashing, consent forwarding, routing) |
| `content/clients/<id>/*.json` | Pristine seed GTM container per client |
| `content/clients/<id>/profile.md` | Business classification + implications for tracking |
| `content/clients/<id>/winning/*.json` | Best-scoring containers saved per run |
| `data/clients/<id>/meta-ads-snapshot.json` | Meta Ads weighting input |
| `DOCUMENTATION/loops/gtm-autoresearch/program.md` | Human-authored run program — client registry + constraints |
| `DOCUMENTATION/loops/gtm-autoresearch/loop-results/<id>/*.json` | Per-run experiment log (local mirror of KV manifest + rounds) |
| `.claude/skills/client-eval-generator/SKILL.md` | Claude skill that generates a client's profile + eval from Meta + GTM data |

## Model escalation — quick reference

| Phase | Trigger | Model | Purpose |
|---|---|---|---|
| Exploration | score < 0.92 | Claude Sonnet | Broad mutation coverage at low cost |
| Escalation  | first time score ≥ 0.92 | (switch event) | Reset plateau counter, announce swap |
| Refinement  | score ≥ 0.92 thereafter | Claude Opus 4.6 | Deeper reasoning to squeeze last points |

## Stop conditions

- **Plateau** (Opus only): score ≥ `0.92` for `3` consecutive rounds *after* escalation.
  Hitting 0.92 on Sonnet does not stop the run — it escalates.
- **Budget**: `MAX_ROUNDS = 30`
- **Instability**: `MAX_REGRESSIONS = 3` reverts
- **Parse failures**: `MAX_JSON_FAILURES = 5` invalid mutations from the active model

## Invariants

- Loop never publishes to live GTM — staging workspace only.
- Every mutation is idempotent: re-running doesn't duplicate tags/triggers.
- Each round writes a `RoundRecord` to KV; full run writes a `RunManifest`.
- `program.md` is the only human input — clients, strategy, and constraints
  are all declarative there.
- Escalation is one-way per run — once on Opus, stays on Opus.

## Mutation protocol — JSON Patch (RFC 6902)

The model returns a **JSON array of patch operations**, not a regenerated
container. This keeps the output-token requirement bounded (~1 KB instead of
~700 KB) and keeps the invariant contract structural: the model literally cannot
emit a `remove` op, cannot target protected paths, cannot exceed the mutation
budget.

**Supported ops**: `add` and `replace` only. `remove`, `copy`, `move`, `test`
are rejected by `preValidatePatch`.

**Protected paths** (rejected at pre-validate):

- `/exportFormatVersion`
- `/containerVersion/container/accountId`
- `/containerVersion/container/containerId`
- `/containerVersion/container/publicId`
- Wholesale replacement of `/containerVersion/{tag,trigger,variable,folder}`

**Path conventions**:

- Append to an array: `/containerVersion/tag/-` (standard RFC 6902)
- Target an element: `/containerVersion/tag/17/consentSettings`
- Deep edit: `/containerVersion/tag/5/parameter/2/value`

**Post-apply gate**: `validateMutation` runs after patches are applied to a
deep-cloned copy — checks placeholder preservation (`%%…%%`), no tag/folder
removal, and unique `{tagId, triggerId, variableId}`. If the gate rejects, the
round is marked `validation_fail`, the patch is *still* recorded to KV with
`scoreAfter: null`, and the loop reverts to the pre-patch working copy.

## Right-sized mutation prompt

A naive prompt that embeds the full container JSON requires ~200 K input
tokens for BLADE's 700 KB containers — which drives per-round latency past the
CLI subprocess timeout and exposes the run to flaky-hook failures. The prompt
builder instead sends:

- **Counts + public ID** (~100 bytes)
- **Dimension scores + weights** (~500 bytes)
- **Top 10 errors, top 5 warnings** (~1 KB)
- **Compact index tables** — one line per tag/trigger/variable/folder with just
  `[index] id "name" type [consent]` (~6–10 KB for 100+ entities)
- **Schema examples** — the first tag/trigger/variable serialized in full, so
  the model knows the shape to mirror when emitting new entities (~3–5 KB)
- **Error-referenced entities** — up to 10 tags that current errors name,
  serialized in full so the model can read current params (~5 KB)
- **Strategy-specific slice** — e.g. when strategy is `consent`, the prompt
  also includes tags still missing `consentStatus=NEEDED` (~2–4 KB)

Net size: **~12–18 KB regardless of container size** (vs ~700 KB for full
dump). BLADE Server (~800 KB full) compresses to ~12 KB — a 66× reduction —
because most of its bytes live in `customTemplate` sandboxed JS that's
irrelevant to most mutation strategies.

## KV schema — Cloudflare `GTM_AUTORESEARCH_VERSIONS`

Namespace ID: `6f5fb8b431b246fa9204459e5543df80`

```
seed:<clientId>                     → full seed container JSON (pristine baseline, uploaded once per client)
run:<clientId>:<runId>:manifest     → RunManifest
run:<clientId>:<runId>:r<NNN>       → RoundRecord (N = zero-padded round number 000..029)
```

**Why patch-chain, not full snapshots**: storing each round's patch + scores
costs ~500 bytes vs ~700 KB for a full snapshot. Any version N is
reconstructable by applying rounds 0..N to the seed. The run becomes a
**reasoning trace** — not just state — because each record contains the model's
proposed ops, the before/after scores, and which action the loop took
(`improved`, `reverted`, `validation_fail`, `json_fail`).

### RoundRecord

```ts
{
  round: number,
  action: "improved" | "reverted" | "validation_fail" | "json_fail",
  patch: JsonPatchOp[] | null,          // null when action=json_fail
  scoreBefore: number,
  scoreAfter: number | null,            // null when patch wasn't applied
  dimensions: Record<string, number>,
  timestamp: string,
  mutationSummary: string,
}
```

### RunManifest

```ts
{
  runId: string,                        // ISO timestamp, no colons
  clientId: string,
  startTime: string,
  endTime: string,
  seedScore: number,                    // eval(seed) — the baseline
  bestScore: number,
  finalScore: number,
  totalRounds: number,
  outcomes: {
    improved: number,
    reverted: number,
    validationFails: number,
    jsonFails: number,
  },
  templatePath: string,
  evalPath: string | undefined,
}
```

### Write path

`scripts/lib/kv-store.ts` shells out to `wrangler kv key put --remote` with a
temp-file payload. Auth inherits from the user's local wrangler session. Writes
are **non-fatal** to the loop — if KV fails (offline, quota, etc.) the loop
warns and continues, and the local `loop-results/<id>/*.json` mirror remains
the source of truth for that run.

## Drift and reconstruction

```
npx tsx scripts/drift.ts <clientId> --runs
npx tsx scripts/drift.ts <clientId> --seed-vs-best
npx tsx scripts/drift.ts <clientId> <runId> <fromRound> <toRound>
```

Reconstruction algorithm (`reconstructVersion` in `kv-store.ts`):

```
  load seed from KV
  deep-clone as working
  for r in 0..upToRound:
    load run:<client>:<run>:r<r>
    if record.action === "improved" && Array.isArray(record.patch):
      apply record.patch to working
  return working
```

Only `improved` rounds mutate the reconstructed version. `reverted` /
`validation_fail` / `json_fail` rounds are skipped — their patches either
weren't applied or were discarded. This guarantees the reconstruction matches
the trajectory the live loop actually followed.

Drift output sections (per entity type): `+added / -removed / Δchanged`, with
the list of changed field names. Meaningful because GTM containers have stable
IDs on tags/triggers/variables — an "edit" vs "replace+readd" distinction is
unambiguous.

## Client onboarding — `client-eval-generator` skill

`.claude/skills/client-eval-generator/SKILL.md` automates onboarding a new
client. Triggers on `"add a new client"`, `"onboard <name>"`, `"generate eval
for <client>"`, or when a `content/clients/<id>/` dir appears without a
matching eval.

**Workflow:**

1. **Classify** business from Meta snapshot + container structure (ecom /
   lead-gen / subscription / high-ticket services / marketplace / SaaS)
2. **Write** `content/clients/<id>/profile.md` — business, evidence, implications
3. **Write** `evals/clients/<id>.ts` with dimensions matching the classification
   (canned dimension sets per business type are documented in the skill)
4. **Register** the client in `program.md` — template + snapshot + eval paths
5. **Smoke-test** — baseline score + top 3 issues before committing to a full run

Web and server containers are registered as **separate clients** (`<id>-web`,
`<id>-server`) because their eval dimensions differ fundamentally (web →
browser-pixel / GA4 / Google Ads; server → CAPI / PII hashing / consent
forwarding / template safety).

## Hook-tolerant model invocation

The Claude CLI subprocess may exit non-zero due to session-end hook failures
(e.g. an unrelated `auto-sync` script) even when the model's response is
intact in stdout. `callModel` trusts stdout when it's non-empty, logs the hook
exit status as a warning, and only treats truly empty stdout as a "no
response" failure. Without this, transient hook errors in the user's CLI
config cascade into loop-level JSON failures and premature stops.
