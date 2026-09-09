# GTM Autoresearch in Claude through Chumbo

This optional connection uses the **existing standalone GTM Autoresearch evaluator**, extracted into `src/evaluator.ts`. It is separate from the smaller six-dimension audit runtime in the plugin marketplace. The source CLI still works; hosted tools do not import its process runner.

## Desktop flow

After a project owner deploys this connection and a participant signs in through Claude's connector settings:

1. Supply a complete GTM container export. Claude calls **Check a GTM container** and opens the Organized AI report.
2. Inspect dimension scores and evaluator findings. Optionally supply an enriched ads snapshot to activate the related dimensions.
3. Claude proposes a complete candidate. **Test a proposed GTM revision** retrieves the stored baseline and evaluates both versions with the exact same saved ads snapshot.
4. Inspect the side-by-side exports and scores. Save findings for review, accept them, dismiss with a reason, or reopen. Return later to inspect private saved history.

The assistant supplies the reasoning and proposed candidate; server tools perform deterministic evaluation and persistence. No model API key or local Claude/Codex CLI is needed by this service. There is no unattended background loop or scheduled ads-data refresh in this connected release. The original local CLI remains the unattended loop option.

**Nothing here imports, applies, or publishes a GTM container.** An eligible candidate is a possible basis for another comparison, not an approved or installed version. Findings and review decisions never alter scores. No GTM credentials are embedded in HTML.

## What the scores mean

Scores are the existing ecommerce-oriented heuristics on supplied JSON, not a live tracking certification or observed business lift. Naming can improve a heuristic without changing real measurement. Up to twelve dimensions run depending on supplied ads data. Baseline and candidate are always evaluated against the same snapshot, with all dimension regressions and new evaluator errors blocking review eligibility. New missing trigger, variable, sequence and folder references also block eligibility.

Snapshots are supplied evidence: the service does not authenticate their source or refresh old data. Historical scores should not be compared blindly when snapshots, containers, or evaluator versions differ. The report exposes the snapshot, input identities, parent record and evaluator digest. An older engine version is labeled historical rather than represented as freshly verified.

Inputs require explicit `tag`, `trigger`, `variable`, `folder` and `builtInVariable` arrays in `containerVersion`. Empty arrays are valid only when the export is actually empty for that resource; do not invent them for an incomplete export. Each container/snapshot is limited to 250 KB, nesting to 30 levels, and saved records to 700 KB including **both versions, snapshot, and score details**. A large baseline can fit while its comparison does not; oversized comparisons fail without changing saved evidence. This is bounded structural validation, not full GTM API schema validation or custom-template execution.

## Local Supabase + Wrangler

Prerequisites: Node 22+, Deno, Supabase CLI, Docker with a responsive daemon, and Wrangler. From the repository root:

```sh
npm ci
npm run sync:chumbo
cd storage/chumbo
npm ci
npm run build
supabase start
supabase db reset
cp local-env.example .env.local
supabase functions serve gtm-autoresearch --no-verify-jwt --env-file .env.local
```

`supabase db reset` is **only for a fresh disposable local development database**. It deletes existing local data. Do not use it on a database you need to preserve. Use migrations appropriately for an existing database.

In a second terminal, from `storage/chumbo`:

```sh
wrangler dev --config cloudflare/wrangler.toml --env local
```

The local Worker proxies `/mcp` to the local Supabase Edge Function. Authentication remains enforced by Chumbo even though the Supabase gateway JWT check is disabled for OAuth discovery. The Worker preserves the individual caller's authorization header and does not add a service-role key.

The database migration reuses the tested `skill_loop_history`, `skill_loop_findings` and `skill_loop_review_events` schema and owner-isolation rules from the Skill Loop connector. Use a fresh local project to apply this migration as-is. If sharing an existing Skill Loop database, **do not replay the create-table migration**; verify compatible schema/functions first. These names allow a future shared archive; this branch does not configure that automatically.

A hosted Worker cannot reach your laptop's loopback Supabase service. Regular Claude's hosted connector also cannot reach local-only URLs. Local development verifies code and transport; a real desktop OAuth rehearsal requires publicly reachable services and configured Supabase OAuth/DCR.

## Hosted deployment

Use a chosen Supabase project, enable the OAuth server and dynamic client registration required by Chumbo, apply the migration safely, and deploy the `gtm-autoresearch` Edge Function with the bundled static file. Set `MCP_PUBLIC_URL` to the public Worker `/mcp` URL. Set `MCP_UPSTREAM` in the Wrangler configuration to that project's Edge Function URL and keep `LOCAL_DEVELOPMENT=false`. Then deploy with Wrangler and add the public connector URL in Claude, signing in as a real participant.

No production project, OAuth application, or hosted connector is provisioned automatically. The Supabase user client enforces row-level security. User histories are separate; records are append-only and review decisions have an optimistic revision check and audit trail. History has no six-month expiry; storage quotas, backups, and retention remain the project owner's responsibility.

## Verification

From the repository root:

```sh
npm test
npm run typecheck
npm run check:bundle
deno test --allow-env --allow-read --allow-net --config storage/chumbo/supabase/functions/gtm-autoresearch/deno.json storage/chumbo/tests/server_test.ts storage/chumbo/tests/proxy_test.ts
python3 storage/chumbo/tests/database.py
```

From `storage/chumbo`:

```sh
npm run test:ui
npm run check
npm run build
wrangler deploy --config cloudflare/wrangler.toml --dry-run
```

The database test uses an isolated local PostgreSQL cluster and synthetic auth identities; it is not the full Supabase Docker stack. Chumbo transport tests use fixture authentication and an owner-filtered database client, alongside separate real PostgreSQL RLS tests. The UI test executes the actual report DOM with a mocked host bridge. These checks do not substitute for a real Claude connector login.

Before calling the connected experience participant-ready: verify real OAuth in Claude, score a synthetic export, test a candidate, make and reopen a review decision, reload history, and verify a second account cannot read the first account's records. This branch has not completed that hosted rehearsal.
