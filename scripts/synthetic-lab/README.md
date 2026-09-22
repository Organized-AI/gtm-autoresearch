# Offline synthetic GTM lab

These are the canonical, portable simulator sources. Python's standard library is sufficient; no credentials, network, provider or vendor API is used. All identities, payloads and metrics are fictional. BLADE's role in the project is JSON-shape compatibility only; this generator contains no BLADE tag contents, IDs, visitors or ad data.

## Generate and replay

From the repository root:

```sh
python3 -m unittest discover -s scripts/synthetic-lab -p 'test_*.py' -v
python3 scripts/synthetic-lab/generate_multi.py --output data/jev-shadow/multi-topology-v2
node --import tsx scripts/synthetic-lab-demo.ts \
  --dataset data/jev-shadow/multi-topology-v2 \
  --output data/jev-shadow/multi-topology-replay
```

Output directories must be new. Repeat `--seed` to specify populations; defaults are 20260921 and 20260922, with eight sessions per hour over 48 hours. Drift starts at hour 24. Reports are observed at hours 24, 30, 48 and 60. The replay defaults to decision times at hours 12, 30 and 60.

`generate.py` preserves the original single-topology v1 generator. `generate_multi.py` produces schema v2. `report.py DATASET` produces an **oracle-only** report with injected answers; do not send that report to a model.

## Three authored architectures

| Family | Tracking graph | Architecture-specific injected fault | Predeclared split |
|---|---|---|---|
| Retail | Separate event triggers; browser GA4, Meta and Google conversion tags; independently fed server Meta tags | Checkout trigger mismatch, while purchases continue | Train |
| Lead generation | Shared regex trigger and dynamic event names; explicit consent blocking triggers; server consumes successful browser GA4 events | Server client no longer claims the forwarded transport | Validation |
| Subscription | Browser conversion branches by monthly/annual plan; forwarded GA4 and separate billing server clients; Google conversions are server-only | Removing a plan filter duplicates browser GA4 subscriptions | Holdout |

The funnels end in `purchase`, `generate_lead` and `subscribe`, respectively. Subscription conversion Meta events are server-only; earlier funnel events are paired browser/server. A server event-ID fault therefore affects demonstrable deduplication on earlier events, rather than pretending the server-only conversion has a browser counterpart.

Each family contains 12 shared scenarios and one architecture-specific fault, generated with two independent populations: **78 cases across six lineages**, producing **234 evidence rows** at three cutoffs. Shared scenarios cover healthy and renamed controls, missing references, wrong conversion triggers/labels, divergent Meta IDs, consent bypass, missing match data, server outage, business decline, reporting delay and paid-to-organic traffic shifts.

Tests verify different routing behavior: disabling browser GA4 leaves retail's independent server feed intact, stops lead-generation server traffic, and leaves only subscription billing conversions intact. They also check deduplication, consent, actual reference validity, plan-filter duplicates and settled reporting.

## Provenance and evaluation isolation

Every v2 manifest case declares an opaque case ID, observation directory, container group, seed lineage, topology group and planned split. Container groups hash both baseline exports and remain stable across seeds. All seeds and variants of a topology stay in one split. The assignments above are authored before generation; they are not tuned to labels, model performance or random split occupancy.

Observation directories contain before/after exports, content-hashed container history, site events, network deliveries and normalized Meta/Google snapshots. The simulator's report-arrival schedule is removed from public network records. Ground truth remains in a separate directory with provenance `synthetic_generator_rule_not_human_reviewed`. The adapter excludes case/group/split metadata, ground truth and future evidence from model state.

The same source, configuration and seeds produce identical bytes and a checksum inventory. V2 manifests also record hashes of the generator source files so changes in simulation rules are distinguishable from changes in seeds. Case order is shuffled deterministically; IDs do not encode scenario order. Paired scenarios have byte-identical pre-drift observations within a lineage.

## Modeling limits

These are GTM export-shape fixtures with non-executable custom-template placeholders. They are not certified for GTM import. The simulator interprets only the exact/regex triggers, simple filters, consent checks, variable substitutions and client transport rules authored here. It does not execute GTM JavaScript, arbitrary templates or real server clients.

Meta's simulated unique count deduplicates by event name and payload ID. Google's simulated count filters by the expected conversion label and counts unique event IDs; this is a simplified action-matching model, not Google's full counting/attribution algorithm. Attribution includes only consented visits from that platform's paid channel; organic events can still be collected. Spend uses a fixed synthetic CPC. The EMQ proxy is `2 + 6 × server requests with matching fields / server requests`; it is not Meta's EMQ formula. Conversion values, including lead values, are illustrative, not revenue claims. One-hour normal/eight-hour delayed reporting is illustrative.

Three deliberately different architectures improve coverage, but there is only one topology family per partition. Funnel/business type and partition are therefore confounded. Most fault recipes, the engine and attribution assumptions are shared. More seeds do not add architectures. This corpus cannot establish live judge accuracy, calibrated confidence, causal inference, readiness for automatic acceptance, or broad generalization. A future evaluation needs more independently authored families/recipes, independently reviewed cases and a frozen judge. QA remains absent and no provider is called by the offline replay.
