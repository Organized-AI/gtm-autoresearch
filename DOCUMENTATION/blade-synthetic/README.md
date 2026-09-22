# BLADE-informed synthetic journeys

This is a separate **training-only** corpus grounded in read-only inspection of six BLADE public pages on September 22, 2026. `site-observations.json` records the observed controls and source URLs. No forms, purchases or accounts were submitted, and no real visitor data was collected.

| Observed surface | Modeled journey and proposed events |
|---|---|
| Airport search controls and route navigation | Service view → flight search → selection → checkout → purchase |
| Charter cost estimator fields | Service view → form start → inquiry submission |
| Account creation form | Page view → form start → signup |
| Store download links | Page view → app outbound click (not an install or purchase) |

Search results, checkout and successful submissions were not inspected. All event names, completions, IDs, timestamps, values, conversion actions and ad statistics are invented contracts. Public fares are not used as measured transaction values. The estimator resolved to the main BLADE site; cross-domain loss is a stress assumption, not a site finding.

## Corpus

Thirteen paired cases share 192 seeded visitor sessions over 48 hours. A change boundary at hour 24 leaves each case's earlier sessions, site events and deliveries identical. Journey dropoffs, source, device and consent vary reproducibly with the seed. Each case contains:

- `sessions.jsonl`: fictional sessions on `.invalid` hosts, including consent and acquisition source.
- `site-events.jsonl`: proposed page, funnel and outcome events, including events not delivered to ads platforms.
- `network-deliveries.jsonl`: modeled Meta browser/server and Google deliveries with occurrence and reporting-availability timestamps.
- `meta-ads.json` and `google-ads.json`: separate campaign/action reports at hours 24, 30 and 60, split into pre/post windows, with clicks, spend, attributed conversions and values.
- `modeled-gtm-before.json` and `modeled-gtm-after.json`: GTM-shaped **fictional simulation configs**, using model-specific tag types. These are not importable GTM files and do not execute BLADE's real container.
- `context.json`: observation range and when the after-container becomes available.

Coverage includes healthy and harmless naming controls; missing purchase routing; renamed site events; duplicate purchases; Meta ID mismatch; wrong Google labels; consent bypass; lost attribution; delayed reports; reduced demand; reduced airport availability; and server forwarding outage. Scenario-to-case mappings and generator truth remain in the local `truth/` directory, outside the public download. Labels are unreviewed simulator truth, not human judgments.

Business and availability controls retain the full session period and reduce completions after the boundary. Browser collection and platform routing remain healthy. The observed temporary airport service notice inspired the availability control; its modeled magnitude is invented. Server outage is an infrastructure fault, and site-event renaming is a site contract fault; neither is mislabeled as a container edit.

Meta deduplication uses event name plus event ID across browser/server deliveries. Google attribution requires its expected action label. Paid attribution requires granted consent and a matching same-session source; organic/referral conversions are not paid conversions. Spend comes from acquisition clicks independently of conversion delivery. These simplified rules omit real platform view-through, cross-device and cookieless modeled conversion behavior.

## Generate and validate

```sh
python3 scripts/synthetic-lab/generate_blade_journeys.py \
  --site-observations DOCUMENTATION/blade-synthetic/site-observations.json \
  --output /private/tmp/blade-journeys-new --seed 20260923
python3 -m unittest discover -s scripts/synthetic-lab -p 'test_blade_journeys.py' -v
python3 scripts/prepare_blade_synthetic.py \
  --dataset /private/tmp/blade-journeys-new \
  --output /private/tmp/blade-download-new
```

Outputs refuse overwrite. Manifests bind source observations, generator bytes and per-case file hashes; a separate full checksum inventory includes local truth. The public ZIP contains only observations, factual sources, manifest, this guide and a public checksum inventory. It excludes oracle labels and mappings.

Raw files contain the complete 48-hour experiment, including future arrivals. Before giving a decision model an observation, filter events by occurrence and availability, select only reports available at that cutoff, and hide the after-container before hour 24. Whole ZIPs are for offline analysis, not decision-time prompts.

## Daily benchmark boundary

The existing daily BLADE benchmark still performs deterministic container hygiene. This corpus is prepared training evidence; it is not yet connected to behavioral candidate evaluation, Jev inference or keep/revert. Passing the manifest to the existing `--evidence` flag only records its hash. Next work is a cutoff-safe adapter and an explicitly defined behavioral comparison against the same paired sessions. Frozen Jev pilots and reserved validation/holdout data remain unchanged.
