# Frozen training pilot — 2026-09-21

This document records the original offline preparation. The same frozen package has since completed a live paired Cloudflare evaluation; see [PAIRED-PILOT-RESULTS.md](PAIRED-PILOT-RESULTS.md) for the 2026-09-22 results and remaining review work.

The offline package is prepared at `data/jev-shadow/training-pilot-v1-final/REPORT.md` (generated files are ignored by git). It contains a versioned seed rubric, time-aware generator labels, and 12 unique training observations. No provider has evaluated these inputs. Jev remains default-off and shadow-only; no judgment can change legacy acceptance.

## Package and selection

The reproducible v2 corpus contains 78 cases over three authored topologies and six seed lineages. This step opens only the retail training partition: **26 cases / 78 observations** at hours 12, 30 and 60. The 26 validation and 26 holdout cases remain reserved. Their grouping metadata and recorded baseline hashes are audited without opening or rehashing their observations or truth.

The compiler verifies the source manifest and every training artifact against the source checksum inventory. Outputs bind the rubric, generator inventory, source manifest, preparation source hashes, exact model input bytes and expected answer identity. Output directories cannot be overwritten. A regression test deletes every reserved observation directory and truth file before compiling successfully.

Selection excludes four deterministic reference failures, deduplicates exact model inputs, and uses seeded hash order with round-robin decision-time buckets. It does not consult expected answers. Pre-drift duplicates collapse to two unique inputs, one per population. The resulting 12 rows would require at most **24 atomic evaluations** if each of the two functions is evaluated once per row; the offline preflight rejects larger packages. This is a proposed live call ceiling, not a provider execution mechanism or dollar limit.

| Expected tracking answer | All training observations | Selected pilot |
|---|---:|---:|
| Pass | 10 | 3 |
| Fail | 30 (including 4 deterministic rejects) | 6 |
| Insufficient | 38 | 3 |

These are **generator-defined, unreviewed expected answers**, not Jev predictions or human annotations. The training labels contain no examples of `evidenceSufficient=fail` (internally contradictory evidence); that rubric branch is not evaluated by this pilot.

## Evidence and labels

`rubric-v1.json` defines `evidenceSufficient` and `trackingBehaviorPreserved`, each with `pass`, `fail`, and `insufficient`. Its canonical SHA-256 is `34a5125a67ee3c8013bd87f5ad0def6dc065034fc89578a713e5949fb4e87fde`.

Generator truth is scoped to the injection timestamp and stored separately from model inputs. Expected answers are derived from observed evidence, independently of the hidden scenario and conversion-event name. Identical model inputs must receive identical expected answers. A latent fault does not force an observed failure. Missing or provisional reports and absent positive conversion coverage produce insufficient evidence. Concrete reference, consent, delivery, ID-pairing, duplicate-dispatch, matching-field, and established-route faults can support failure. Both Meta source counts and Google matching counts must catch up for a positive conclusion.

An external outage can fail tracking while `containerFaultActive=false`. Lower business conversion volume, traffic changes, and benign renames can pass. BLADE remains a JSON-shape reference only. These labeling rules describe the authored simulator's observed routes; they are not a general diagnostic engine for arbitrary GTM topologies or production traffic.

Each input row preserves its exact JavaScript canonical JSON bytes for cross-language hashing. Python validates those bytes and their parsed value without replacing JavaScript number formatting. Saved Jev functions select only the `observation` column. Case IDs, splits, source lineage, expected answers and generator truth remain outside that projection. QA remains absent.

## Reproduce

Use new output directories each time:

```sh
python3 scripts/synthetic-lab/generate_multi.py --output /private/tmp/gtm-pilot-corpus
node --import tsx scripts/jev-pilot-dataset.ts \
  --dataset /private/tmp/gtm-pilot-corpus \
  --output data/jev-shadow/training-pilot-new
python3 scripts/jev_pilot.py preflight --package data/jev-shadow/training-pilot-new
```

See [PILOT-RUNNER.md](PILOT-RUNNER.md) for offline result scoring. It compares externally supplied results with the unreviewed generator labels, reports confusion counts and coverage, and separates runtime errors, runtime abstentions, and valid `insufficient` predictions. Test fixtures are not saved as real pilot predictions.

See [NATIVE-SETUP.md](NATIVE-SETUP.md) for freezing native Jev definitions. Native save/load was tested against the pinned Jev source with `jev-test`, a placeholder model that was never evaluated. Provider/model-specific production definitions have not been created. The minimal offline environment is not a fully resolved live provider installation.

## Verification and live boundary

Verification passed: **37 TypeScript tests, 26 simulator Python tests, 8 native/preflight/scoring Python tests, and TypeScript typecheck**.

TypeScript tests cover observability, equivalent evidence, delayed reports, missing routes, source corruption, split isolation, selection and deterministic bypass. Native Python tests cover save/load without evaluation; separate Python tests cover preflight and scoring. Simulator regressions cover all three architectures.

For this session, macOS cloud placeholders made workspace dependency reads unreliable. Verification used exact-lockfile dependencies installed from the local npm cache under `/private/tmp/gtm-offline-verification`; the source under test remained the repository source. A fresh temporary corpus reproduced 86,730 visitor events and 210,312 requests. Its manifest and inventory hashes are recorded in the generated pilot manifest.

No native backend credentials were present in the process environment or project `.env` configuration when checked. Provider, model and maximum spend remain pending. Before executing the selected rows, configure the chosen native backend, resolve its runtime dependencies, freeze provider-specific definitions, and wire execution to enforce the 24-call ceiling plus a provider-side spend limit and recorded usage. The native Jev API does not itself expose a per-call dollar cap. This package makes no claims of live accuracy, calibrated confidence, broad topology generalization, import certification or promotion readiness. PR #5 stays draft and stacked on unmerged PR #4.
