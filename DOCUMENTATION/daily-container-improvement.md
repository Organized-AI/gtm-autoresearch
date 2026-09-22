# Daily container improvement

Status: implementation plan; no daily execution or change watcher has been enabled.

The product should reassess tracking every day and after relevant changes, then produce a scored GTM JSON when it finds a verified improvement. A successful day can also conclude that the current container should be retained. The saved BLADE winner currently downloadable from the dashboard is an example artifact, not an active daily baseline.

## Run contract

1. Read the selected container's current published version and any explicitly selected source workspace. Capture complete exports, IDs, fingerprints, timestamps and content hashes. Keep published, staged and proposed state distinct. For paired web/server containers, capture both as one topology with separate import files.
2. Collect site-event evidence and Meta/Google Ads snapshots with explicit reporting windows, data maturity and collection status. Never substitute zeros for missing reports or quietly change scoring profiles after collection failure.
3. Compare against the last observation: GTM version/entity changes, site release or event-schema changes, conversion-action changes and tracking regressions. A new report timestamp alone is not a configuration change. Record what changed and why another run is warranted.
4. Re-score the current baseline and any still-applicable prior best candidate against the same frozen evidence and evaluator version. External edits invalidate a candidate derived from the old baseline. Reapply reviewed typed operations to the new baseline and validate again; never overwrite edits by carrying yesterday's full JSON forward.
5. Generate bounded typed mutations targeted at observed problems. Enforce a configured attempt, duration and spend limit. Preserve fields outside the operation scope and audit each proposal, rejection and accepted change.
6. Validate format, resource references, templates, consent behavior and event contracts. Exercise candidates against replay fixtures and available preview QA. Jev can annotate evidence/risk in shadow mode; its answer alone cannot promote a candidate. A better structural score alone does not establish improved live tracking or conversion lift.
7. Keep a candidate only when the defined objective improves without regression in protected checks. Report `improved`, `unchanged`, `insufficient-evidence`, `needs-review` or `failed`; do not create arbitrary changes to satisfy a daily quota.
8. Write a versioned container/report/checksum bundle plus its baseline identity, change summary, evidence window, evaluation identity and QA results. Update the dashboard's latest complete result atomically. Preserve history and the exact previously delivered artifacts.

## Scheduling and changes

- Run one scheduled daily evaluation at a configured local time. Reuse a thread heartbeat for the recurring task once the target and executable workflow are configured.
- Also enqueue evaluation when a configured GTM version, site deployment/event contract or ads conversion definition changes. Polling intervals and event sources must be explicit; a daily schedule alone does not imply immediate change detection.
- Coalesce related changes, lock by container/topology, and avoid overlapping runs or duplicate inference for identical inputs. If a change occurs during evaluation, mark the result as superseded and evaluate the newer baseline.
- Check data maturity before drawing conclusions immediately after deployments. Structural inspection can run immediately; behavioral comparisons may need more observations.
- In-app follow-up should be quiet when nothing actionable changes and report a meaningful improvement, regression, failure or required decision. Posting to Linear or other external services is separately configured; the legacy loop's automatic Linear posting must not be inherited accidentally.

## Daily dashboard

- Current deployed version and observed changes since the prior run.
- Last completed evaluation, next scheduled check, evidence freshness and run outcome.
- Current baseline and candidate scores computed under the same evaluation conditions.
- Proposed changes, protected checks, QA results and unresolved findings.
- Downloadable web/server JSON, report and checksums, with historical versions.
- Separate labels for deployed state, proposed state and recorded Jev experiments.

## Delivery and publishing

The existing scored-export bundle is the output contract. Manual users import the JSON through GTM's import preview. Programmatic deployment needs a separate workspace adapter that maps resources, resolves IDs and conflicts, and rechecks the source version before writing; the Google API does not offer a bulk JSON-import endpoint. Daily improvement does not authorize automatic publishing.

New or unverified resource types, including the consent-tag type flagged in the saved example, require actual import/preview verification before an unattended workflow can call a candidate ready. A historical winner's offline score is not sufficient evidence for daily promotion.

## Implementation order and verification

1. Configure the target topology, evidence sources, daily time and bounded mutation/Jev budget. BLADE remains a shape reference unless explicitly chosen as the operational target. Prior Cloudflare pilot allowances are exhausted.
2. Implement read-only daily intake, change fingerprints and persistent run history. Test unchanged inputs, outside edits, missing/stale/partial evidence, idempotency and restart recovery without provider calls.
3. Connect bounded mutation execution and candidate QA. Test improvements, score-only regressions, no improvement, insufficient evidence, interrupted runs and baseline changes during a run using synthetic fixtures first.
4. Connect daily results to the existing dashboard and immutable export bundles. Verify checksum identity, blocked downloads, historical attribution and that no result claims deployment.
5. Enable the scheduled task and configured change detection after a complete dry run. A scheduled run must use the explicit target rather than the loop's current default HRE program.

Current implementation already supplies deterministic scoring, typed mutations, per-run keep/revert, shadow research and scored export bundles. Live container intake, durable daily orchestration, change-triggered runs and behavioral candidate QA are still required.
