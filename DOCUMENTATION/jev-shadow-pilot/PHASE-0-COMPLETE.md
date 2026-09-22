# Phase 0 complete

- **Base:** `feat/baseline-preserving-container-policy` at `86b47f6`; PR #4 remains open against `main`. This pilot is stacked on that branch and will declare the dependency in its draft PR.
- **Fixtures:** BLADE web and BLADE server exports are the compatibility fixtures. Teleios is explicitly out of scope for this pilot.
- **Legacy behavior:** a validated, higher-scoring candidate updates `working`, `bestJson`, and the winning export; otherwise the loop reverts it. Shadow outputs may only be logged after validation and scoring, never alter those decisions.
- **Contract:** deterministic mutation validation and scoring remain authoritative. Jev receives a compact, data-only evidence projection and returns a versioned runtime-validated result. Default mode is `off`; `shadow` is opt-in and routes only to a proposed `keep`, `review`, or `revert` record.
- **QA:** `passed`, `failed`, and `absent` are distinct. Missing/stale/partial evidence or unavailable/malformed judgment routes to review.
- **OpenShell:** this pilot defines a subprocess boundary only. OpenShell is not installed or claimed as enforced. No worker receives GTM management credentials.
