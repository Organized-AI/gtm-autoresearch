<p align="center">
  <img src="logo.png" width="200" alt="gtm-autoresearch" />
</p>

# gtm-autoresearch

**Autoresearch for tracking optimization**

Karpathy's autonomous experimentation loop — applied to GTM configs instead of neural nets.

```
Pull ads data → Score config → Mutate via Claude → Validate → Keep/revert → Repeat
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
| **Data audit** | Automatic before/after markdown audit with Mermaid diagrams for opportunities identified and GTM changes made |
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

Up to 12-dimension scorer evaluates GTM container quality, with dimensions activated based on available ads data:

**Structural (always on):**

1. Tag coverage (ecom events + infra tags)
2. Parameter completeness
3. Deduplication (event ID generator)
4. Consent Mode v2 settings
5. Naming conventions
6. Variable hygiene
7. Trigger quality
8. Folder organization

**Ads-driven (with enriched snapshot):**

9. Meta Ads alignment — GTM tags cover events actually firing in Meta, weighted by conversion value
10. CAPI coverage — browser pixel + GA4 event tags exist for sGTM forwarding, dedup rates healthy, EMQ > 6, `_fbc`/`_fbp` cookies present
11. Funnel integrity — conversion funnel ratios within Shopify ecom norms (catches tracking gaps)
12. Google Ads alignment — GTM conversion tags match active Google Ads conversion actions by category + label

Each round: score → build prompt → mutate via Claude → validate → keep/revert → repeat.

## Container safety architecture

Every run treats the selected GTM export as its baseline, then applies typed operations to a deep clone. Deterministic code allocates IDs, preserves unmodified and unknown fields, and verifies references before a candidate can be scored. The mutation provider never emits a full container document.

See [the container mutation policy](DOCUMENTATION/container-mutation-policy.md) for the operation boundary, Jev's post-validation judge role, and the planned OpenShell execution boundary.

The implemented shadow-pilot contract, offline replay workflow, and operational limits are in [Jev shadow-pilot documentation](DOCUMENTATION/jev-shadow-pilot/CONTRACT.md).

## Ads data feedback loop

The enriched snapshot pulls live data from Meta and Google Ads APIs before each loop run, giving the optimizer real signals to work with:

```
Meta Ads API ──→ conversion counts, EMQ scores, CAPI/browser split, dedup rates
Google Ads API ──→ conversion actions, labels, attribution windows
                          ↓
              compute funnel ratios
                          ↓
              ads-snapshot-enriched.json
                          ↓
                   run-gtm-loop.ts
                   (score + mutate)
                          ↓
                   winning config
```

**What the loop catches with ads data:**
- Events firing in Meta but missing GTM tags (revenue leakage)
- Browser events with zero CAPI delivery (sGTM not forwarding)
- Low EMQ scores (web container not passing user data to sGTM)
- Funnel drop-off anomalies (e.g., 15% add_payment_info/initiate_checkout = likely broken tag)
- Google Ads conversion actions with no matching GTM tag

## Usage

### Get the scored GTM JSON

The final deliverable is a GTM export-format-v2 `container.json`, with its deterministic score and validation findings in a separate `report.json`. The container itself has no added score fields. `manifest.json` binds both files by SHA-256. The optimization loop now packages its saved winner this way as well.

To score and package a saved winner without running a model or contacting GTM:

```bash
npx tsx scripts/prepare-gtm-export.ts \
  --container path/to/winning-config.json \
  --baseline path/to/seed.json \
  --output /tmp/gtm-scored-export
```

Omit `--baseline` for a standalone score. To include ads alignment, explicitly supply `--enriched-snapshot path/to/snapshot.json` or `--meta-snapshot path/to/meta.json`. With neither, scoring is structural only. Use a new output directory for each bundle. Unresolved hydration placeholders or broken references are reported as blockers; a high score does not override them.

The run dashboard's **Container export** tab offers the JSON, report and checksums for an attached bundle. The export is separate from the recorded Jev pilot: pilot agreement is not a container score or an approval to import. To attach a bundle to the managed dashboard, add `--export-bundle /tmp/gtm-scored-export` to [the installer command](DOCUMENTATION/jev-shadow-pilot/RUN-VIEW.md).

**Manual import:** download `container.json`, open **GTM → Admin → Import Container**, select the matching web/server container and a review workspace, inspect the merge/overwrite preview, and confirm the import. Preview and test tracking before publishing. Offline validation does not certify Google backend acceptance or runtime behavior.

**Programmatic use:** fetch the report and the same JSON artifact from the private dashboard, checking readiness and the hash before passing it to your importer:

```bash
curl --fail http://jordans-mac-mini.tailb35295.ts.net:8765/exports/report.json -o report.json
jq -e '.readiness.status == "ready-for-import-review"' report.json && \
  curl --fail http://jordans-mac-mini.tailb35295.ts.net:8765/exports/container.json -o container.json
```

Compare the downloaded SHA-256 to `report.source.sha256`. Google's GTM API v2 has no bulk container-JSON import endpoint. An API importer must translate the resources into workspace create/update calls, resolve IDs and references, and handle templates and conflicts. These downloads perform no GTM writes or publishing. The container download returns HTTP 409 when checks are blocked and HTTP 404 when bundle integrity cannot be verified.

### Run optimization

```bash
# 1. refresh ads data (Meta + Google Ads APIs)
npx tsx scripts/refresh-ads-snapshot.ts

# 2. run the optimization loop
npx tsx scripts/run-gtm-loop.ts

# run the eval standalone
npx tsx evals/eval_gtm_signal_quality.ts content/gtm-templates/HRE/seed/shopify-ecom-web.json

# run eval with enriched snapshot
npx tsx evals/eval_gtm_signal_quality.ts content/gtm-templates/HRE/seed/shopify-ecom-web.json \
  --enriched-snapshot data/signals/ads-snapshot-enriched.json

# run eval with legacy Meta snapshot
npx tsx evals/eval_gtm_signal_quality.ts content/gtm-templates/HRE/seed/shopify-ecom-web.json \
  --meta-snapshot data/signals/meta-ads-snapshot.json

# hydrate a template with client values
npx tsx scripts/hydrate-gtm-template.ts client-config.json
```

Before importing a winning JSON into GTM, add one manual gate:

- Compare the seed export to the candidate winning export and run the `data-audit` skill against the linked Meta account/pixel to verify event coverage, Pixel/CAPI health, and ads-side tracking integrity before upload.

After a winning config is established, the loop now also writes a post-win data audit report under the client's `loop-results/data-audits/` directory. The report includes before/after scorecards, GTM entity diffs, and Mermaid diagrams for opportunities identified and changes made.

## Setup

```bash
# install dependencies
npm install

# copy env template and fill in credentials
cp .env.example .env

# required for Meta: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_PIXEL_ID
# required for Google: GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_DEVELOPER_TOKEN,
#   GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN
```

## Hardening

The ads snapshot pipeline includes:

- **Retry with backoff** — 3 retries with exponential backoff on API calls, respects `Retry-After` headers
- **Staleness check** — loop refuses to run if snapshot is >72h old, warns if >24h
- **Partial failure flag** — `snapshot.partial = true` when an API section fails, loop warns accordingly
- **Atomic writes** — temp file + rename prevents corrupt snapshots from mid-write crashes
- **NaN guards** — all metric parsing uses `safeParseFloat` to prevent NaN propagation
- **Weight validation** — asserts dimension weights sum to 1.0 after profile selection
- **Neutral empty scores** — missing data returns 0.5 (not 1.0) to prevent false confidence

## Current gaps (as of 2026-04-07)

First run: 5 rounds, **84.3% → 91.2%**. Two improvements accepted, three reverted.

| Dimension | Score | Status |
|---|---|---|
| Tag coverage | 100% | Solved |
| Parameter completeness | 100% | Solved |
| Deduplication | 100% | Solved |
| Trigger quality | 100% | Solved |
| Folder organization | 100% | Solved |
| Meta Ads alignment | 100% | Solved |
| CAPI coverage | 99.4% | Solved |
| Naming conventions | 97.6% | Near-ceiling |
| Variable hygiene | 87.5% | Orphan/ref issues remain |
| Google Ads alignment | 80% | Missing conversion tags for active GAds actions |
| Funnel integrity | 70% | Drop-off ratios outside Shopify ecom norms — likely tracking gaps |
| Consent settings | 60% | Consent init tag added, but not all tags have `consentStatus: NEEDED` yet |

**Biggest levers for next run:** consent (60% → target 100%), funnel integrity (70%), Google Ads alignment (80%). A 30-round run should push past the 92% plateau target.

## Cost

~30 rounds x ~3K tokens = ~90K tokens total. About $0.15 per full run on Claude Haiku.
