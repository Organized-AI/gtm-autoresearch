<p align="center">
  <img src="logo.png" width="200" alt="gtm-autoresearch" />
</p>

# gtm-autoresearch

**Autoresearch for tracking optimization**

Karpathy's autonomous experimentation loop — applied to GTM configs instead of neural nets.

```
Modify config → Deploy → Measure → Keep/revert → Repeat
```

- **Fixed measurement window** — 5-min training budget, 24-hr signal window. Standardized comparison across every config variation.
- **Single metric: signal quality score** — val_bpb → event match quality + dedup rate + conversion parity. One number to beat.
- **Agent modifies one file** — train.py → GTM container JSON. Claude iterates tag configs, trigger rules, variable mappings.
- **program.md → SKILL.md** — Human-curated instructions map to skill files. Domain knowledge guides agent experiments.

> [github.com/karpathy/autoresearch](https://github.com/karpathy/autoresearch) — same loop, different domain. Agent experiments with tracking configs like it experiments with model architectures.

## Results

Wake up to a **validated workspace**.

Run it overnight. Morning deliverables: a staging workspace ready to publish, a versioned config in R2, and a full experiment log.

| Deliverable | What you get |
|---|---|
| **Staging workspace** | GTM workspace with winning config — one-click publish when you're ready |
| **Versioned JSON** | winning-config.json stored in R2 — rollback to any previous night's best |
| **Experiment log** | Every patch tested, scored, and kept or reverted. Full audit trail with diffs |
| **Playwright QA** | Each experiment validated in staging preview — tag firing, parameters, dedup all checked |

~100 experiments over a weekend. Never publishes to live. You review the winner and decide.

```python
# morning deliverables
workspace = gtm.getWorkspace("autoresearch-nightly")
# review what changed
print(workspace.changelog)
# → 14 tags modified  # → score: 0.72 → 0.91
# → 47 experiments run
# happy? one-click publish
gtm.publishWorkspace(workspace)
# or grab the JSON for review
config = r2.get("winning-config.json")
gtm.importContainer(config)
```

## How it works

9-dimension structural scorer evaluates GTM container quality:

1. Tag coverage (ecom events + infra tags)
2. Parameter completeness
3. Deduplication (event ID generator)
4. Consent Mode v2 settings
5. Naming conventions
6. Variable hygiene
7. Trigger quality
8. Folder organization
9. Meta Ads alignment (weighted by conversion value)

Each round: score → build prompt → mutate → validate → keep/revert → repeat.

**Two-tier model strategy** — Claude Sonnet drives exploration while the score is still climbing. Once the combined score hits **0.92**, the loop escalates to **Claude Opus 4.6** to squeeze the last points out of an already-good config. This keeps token spend low during broad optimization and reserves the stronger model for the hard part.

## Usage

```bash
# run the loop
npx tsx scripts/run-gtm-loop.ts

# run the eval standalone
npx tsx evals/eval_gtm_signal_quality.ts content/gtm-templates/shopify-ecom-web.json

# hydrate a template with client values
npx tsx scripts/hydrate-gtm-template.ts client-config.json
```

## Cost

~30 rounds × ~3K tokens ≈ ~90K tokens total per client.

- **Sonnet phase** (score < 0.92): ~$0.60 per client — this is where most rounds live
- **Opus 4.6 phase** (score ≥ 0.92): only runs until plateau (≥0.92 for 3 rounds) or the round budget ends, so usually a small handful of rounds on top

The escalation trigger means you only pay the Opus premium once Sonnet has already done the heavy lifting.
