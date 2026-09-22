# Multi-topology offline replay

The second corpus expands the original single-topology fixture into three authored architectures. It tests whether evidence collection and evaluation isolation still work when the funnel, trigger graph and server ingestion path change.

| Partition | Architecture | Seed lineages | Cases | Decision-time observations |
|---|---|---:|---:|---:|
| Train | Retail: separate event triggers and independent server feed | 2 | 26 | 78 |
| Validation | Lead generation: shared event triggers and GA4-forwarded server feed | 2 | 26 | 78 |
| Holdout | Subscription: plan-specific triggers and a separate billing client | 2 | 26 | 78 |
| Total | 3 families | 6 | 78 | 234 |

With seeds 20260921 and 20260922 at eight sessions per hour, the corpus contains 86,730 visitor-event records and 210,312 request records across paired cases. These repeated observations are not independent samples. Each architecture has 12 common scenarios plus one distinct routing fault. Assignment to a partition is authored before generation, not chosen from model results or fault labels.

## Verified behavior

- Disabling browser GA4 leaves retail server delivery intact, stops lead-generation server delivery, and preserves only subscription billing events. This tests architecture behavior rather than superficial renaming.
- Healthy conversion counts equal the consent-eligible site conversions under the simplified simulation. Retail purchases, generated leads and subscriptions use separate event names and Google conversion labels.
- Missing trigger references are the only intended structural failures. The final replay reports 12 invalid observations: six affected cases at two post-change decision times.
- Before the change, all model inputs within each of the six paired lineages are identical. Future exports and observations, ground-truth labels and bookkeeping identifiers are excluded.
- Group isolation links declared container, lineage and topology groups, plus identities derived from verified baseline hashes. Relabeling an identical baseline cannot put it in a different partition.
- The replay calls no provider. All predictions are explicitly unavailable and routes remain review; no model accuracy or calibration statistic is claimed.

## Reproduce

The portable generator source and Python tests are included at [`scripts/synthetic-lab`](../../scripts/synthetic-lab/README.md). Generated corpora and replay files remain local and ignored by git. See [SYNTHETIC-REPLAY.md](SYNTHETIC-REPLAY.md) for the generation and replay commands.

Run the simulator checks with `python3 -m unittest discover -s scripts/synthetic-lab -p 'test_*.py' -v`. They cover both the original corpus and the expanded architectures. Run the repository's TypeScript test suite and typecheck for the adapter and split checks.

## What this supports

This establishes offline coverage across three distinct tracking layouts and usable, isolated train/validation/holdout files. It does not establish a reliable live judge. Each partition contains only one authored architecture; business type and partition are confounded, and most failure recipes and simulation assumptions are shared. Additional reviewed architectures and cases are needed before a generalization claim. A live evaluation still requires pinned Jev functions and provider configuration; loading a seed manifest cannot promote it to an accepted definition.
