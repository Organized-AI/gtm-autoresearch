# Current State — September 9, 2026

## Branch

codex/chumbo-integration — standalone GTM Autoresearch, separate from the marketplace six-dimension audit runtime.

## Implemented

- Extracted original evaluator and mutation validation into shared import-safe modules; source CLI reexports/imports them.
- Chumbo/Supabase tools score complete supplied exports, compare candidates against owner-scoped saved baselines under identical snapshots, and persist immutable evidence. No model subprocess or GTM writes in hosted tools.
- Candidate gating blocks dimension regressions, new errors, identity changes, removed entities, new missing references. Eligibility is not approval.
- Organized AI / Jordaaan connected report shows separate records, dimension scores, before/after JSON, and accept/dismiss/reopen findings.
- Local Worker proxy, owner-isolated database migration, bundled UI and verification scripts.

## Verification

Seven Node checks include parity against pre-extraction golden outputs for four scoring profiles, input/invariant tests and inherited-property crash regressions. Chumbo transport, OAuth challenge and proxy tests; isolated PostgreSQL ownership and decision tests; UI DOM tests; type checks and UI build are included. Independent review cleared the scoped changes. See storage/chumbo/README.md for exact commands and boundaries.

## Remaining

Docker daemon remains unresponsive, so full local Supabase stack and real Claude connector sign-in are not verified. No production backend deployed. Data-source authentication, live GTM behavior, scheduled execution and a complete hosted participant rehearsal remain outside current verification. Source CLI behavior is preserved; original unattended acceptance criteria were not replaced with hosted criteria.

## Do not conflate

The earlier twenty passing marketplace tests belong to the smaller audit runtime. This branch uses the existing standalone evaluator with up to twelve dimensions. Never describe heuristic score improvement as measured tracking improvement, nor review eligibility as permission to publish.
