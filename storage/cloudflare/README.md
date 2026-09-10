# Bring-your-own-account deployment (in progress)

Each operator owns their Google Cloud project and Cloudflare account. No Organized AI shared API project or quota is assumed. Chumbo/Supabase remains an alternative owned by the operator, not a required dependency.

The optional official gcloud MCP onboarding helper is configured in onboarding/mcp.example.json. It requires Node20+ and the gcloud CLI; sign-in remains interactive. Inspect/select the intended project, enable the GTM API, configure the OAuth client and approved callback URLs, and verify readonly GTM access. Do not auto-create paid resources or overwrite existing desktop MCP settings. The example uses upstream current package; pin the tested release before distribution.

Runtime target resolution must use the operator's authenticated, fully paginated GTM container listing. Do not accept an authorized-target list supplied by the model or caller. Client aliases can match multiple containers; require explicit selection on ambiguity. Store the resolved account/container path in every scheduled job and reauthorize before execution.

src/authorized.ts wraps evaluation/comparison with exact target/export checks. This is a tested building block, not a deployed authentication boundary. schema.sql defines immutable run history linked to client/container ownership; database keys alone do not enforce caller authorization.

Pending for end-to-end release: OAuth lifecycle and secure token storage; authenticated MCP transport; D1/R2 write/readback adapter; scheduled handler with per-project quota pacing, idempotency and backoff; notifications; revoked-access and cross-client integration tests; deployment wizard and live rehearsal. No scheduled run or cloud deployment is active from this scaffold.

## Compact workshop history

`src/cloudflare-summary.ts` creates a bounded (12 KB) uncompressed QA summary and connector-ready setup, insert and readback SQL. `verifySummary` requires exact returned content, SHA-256 and all four identity fields. Repeated identical saves are idempotent; an occupied run ID with different content fails verification. Use a new run ID, never overwrite evidence. The table is separate from Skill Loop history.

Run `node --import tsx scripts/summary-demo.ts /path/to/output` for synthetic SQL and expected evidence. The HTML save handoff embeds the same plan. The backend remains not connected until the assistant executes and verifies actual readback. This is summary history, not a container backup; no JSON restoration, scheduled run, live GTM authorization or Chumbo save is implied.

Targets must be selected from the authenticated user's authorized listing before calling this module. Identity checks prevent accidental mismatches; this SQL is not a multi-user authentication layer. The user's own D1 account controls database access.

## Complete container persistence (file-backed API)

`src/cloudflare-container.ts` and `scripts/container-store.ts` save BOTH original and candidate complete JSON strings in `gtm_container_files`. Keys include client, account, container, run and original/candidate version. Retrieval verifies actual UTF-8 SHA-256 and all identities, then writes original.json and candidate.json byte-for-byte. This is full container storage, distinct from compact QA summaries.

Usage: `node --import tsx scripts/container-store.ts target.json run-id original.json candidate.json restored-dir` with `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, and `CLOUDFLARE_API_TOKEN` in the process environment. Never put credentials in HTML or prompts. The authenticated target must come from the user's allowed containers. Current conservative limit is **20,000 UTF-8 bytes per version** to bound inline SQL; larger exports fail explicitly and need an R2/parameterized-content implementation. No truncation occurs.

Live synthetic full original/candidate save and exact file restoration passed against the verification D1 database on September 10, 2026. Fifteen local tests pass. This API CLI is deterministic file transfer, not a verified regular Claude Chat connector flow. The artifact prepares a request and keeps connection state unverified; a chat without the API execution tool must report unsupported full transfer. No actual GTM import/publish was tested or performed.
