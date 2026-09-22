# Time-bounded synthetic replay

The synthetic-lab adapter accepts the separate lab's normalized observation streams. BLADE remains a separate JSON-shape compatibility reference. This integration uses no BLADE business rules or private visitor/platform data.

## Reproduce

Generate the lab dataset using its README, then run from this repository:

```sh
SYNTHETIC_GTM_LAB_PATH='/absolute/path/to/synthetic-gtm-lab' \
  node --import tsx scripts/synthetic-lab-demo.ts \
  --output data/jev-shadow/my-synthetic-replay
```

For a v2 dataset, give the dataset root explicitly; its `manifest.json` is read from that directory.

```sh
npm run demo:synthetic-lab -- \
  --dataset '/absolute/path/to/dataset-root' \
  --output data/jev-shadow/my-synthetic-replay
```

For a v1 lab root, the adapter retains the compatibility path `datasets/demo-v1`.

The default decisions occur at hours 12, 30 and 60: before the simulated change, shortly after it, and after report settlement. Repeat `--decision-time` to choose other explicit UTC/offset timestamps. Output paths must not already exist.

The command writes `evidence.jsonl`, grouped `train.jsonl`, `validation.jsonl`, `holdout.jsonl`, `report.json` and `REPORT.md`. Output directories under `data/jev-shadow` are ignored by git. Each row has separate input, prediction and provenance fields. `input.observation` is the bounded model-facing state. Predictions explicitly say unavailable: this replay does not call a model or use an oracle to imitate one.

## Evidence guarantees

- Time comparisons use parsed instants with explicit timezones.
- Visitor events, request dispatches, event occurrence, platform as-of timestamps and container effective times are filtered against the decision time.
- Before a changed export is effective, its file is not opened. Selected exports must match the history's content hashes.
- Container evidence includes before/after changed entities, reference-shape checks and identity preservation. Checks are scoped to simulator shapes, not a full GTM import validator.
- Network counts are separated by platform, source and event; browser requests are not all counted as conversions. HTTP failures, denied-consent requests and observed Meta event-ID divergence are retained.
- Platform snapshots retain values, attribution definition, action labels, event window and observation time. An observation cannot be used as a later settled outcome.
- Exact case IDs and grouping metadata stay outside model state. The adapter never opens the ground-truth directory or oracle report.
- A v2 manifest requires nonempty lineage, container, and topology groups plus a declared `train`, `validation`, or `holdout` split for every case. Components connect through any of those groups, and incomplete or conflicting declarations fail before replay output is written.
- QA remains absent: simulated delivery is not browser/GTM preview validation.
- Normalized synthetic metrics are not blindly cast into the production enriched-snapshot type.

## Verified sample

The default dataset produces 36 observations from 12 cases. All 12 pre-change observations have no changed entities and no recorded HTTP/consent/ID-pairing faults. The missing-trigger case fails the scoped structural checks at both post-change decision times. At hour 30 the evidence includes 21 divergent Meta ID pairs, 3 denied-consent requests, and 221 server failures in their respective cases; none requires revealing injected labels to compute.

The v1 corpus shares one lineage and topology, so all observations stay in one split. Empty validation/holdout files are intentional and are reported as insufficient evaluation coverage. A v2 corpus can declare multiple topologies and planned splits, but shared simulator recipes only provide synthetic coverage; they do not establish prediction accuracy, probability calibration, causal inference, generalization, or readiness for automatic acceptance.

Portable tests create their own tiny fixtures in a temporary directory; they do not depend on a developer's local dataset or home directory. They cover future-version exclusion, full metric preservation, equivalent timezone offsets, hash mismatches, oracle-path rejection, reference checks, and lineage retention.
