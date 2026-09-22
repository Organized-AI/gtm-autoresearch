# Native provider runtime review — 2026-09-22

This review inspected installed source and dependency metadata only. No credentials were retrieved and no provider/model endpoint was called.

## Runtime verification

The environment at `/private/tmp/gtm-jev-runtime` now has a fully resolved installation according to `python -m pip check` (no broken requirements). All 18 installed Jev Python source files match the local source checkout at commit `3d997fc76593036655c28d4964de43b55f81fe2c`. This supersedes the earlier session's report that only minimal offline dependencies had finished installing.

| Package | Inspected version |
|---|---|
| jev-align | 0.1.4 |
| typesafe-sdk | 0.7.1 |
| httpx2 (used by this SDK) | 2.13.0 |
| httpx | 0.28.1 |
| pydantic | 2.12.5 |
| rich | 14.3.4 |
| gepa | 0.1.4 |

Jev `runtime.py` SHA-256: `08d0b6f8b7add5c51272e158c2158341e06644f8ac592a0d74692aaa5548eeab`.

Jev direct-provider adapter `jev.py` SHA-256: `752866446e56ce2e2dc41ac6a0346bedcc74fc054592ee4f3dfc8053a60e3647`.

These are observations of one resolved environment, not a transitive dependency lockfile or proof that a provider accepts a selected model. Future live runs should record the environment they actually use.

## Function attempts, HTTP attempts and usage

The pinned `AIFunction.__call__` creates one story from its selected columns and invokes the backend once. `selected_columns=["observation"]` restricts the native model input. A timeout or exception after dispatch does not establish whether the provider processed or billed the request.

The direct TypeSafe backend creates `AsyncTypeSafeClient(model=...)` and calls `system_one` without overriding its retry policy. Installed SDK 0.7.1 defaults to `max_retries=2`, in addition to the initial attempt; it exposes `RetryPolicy(max_retries=0)` to disable these retries. Thus a ceiling of 24 native function attempts alone could allow up to 72 SDK attempts under that policy. An offline `httpx2.MockTransport` check returning HTTP 500 confirmed three mock dispatches under the default SDK policy and one with `RetryPolicy(max_retries=0)`; both ended with `TypeSafeInternalServerError`, with zero live calls. This is not a measurement of live requests sent. A strict HTTP-request ceiling requires control at the transport boundary and inspection of any additional redirect or retry behavior.

The Cloudflare and Vercel adapters use `urllib.request.urlopen(..., timeout=60)` with no explicit retry loop in their shared `_post_json`. That code-level observation does not establish a provider-side spending guarantee or account for every transport behavior.

The TypeSafe SDK response includes input/output token usage. The pinned Jev adapter normalizes it into `Prediction` and retains the answer, confidence and resolved model, but not the usage. Statements that the *underlying SDK* has no telemetry would be incorrect. Live instrumentation must capture actual provider usage before it is discarded, retain unavailable usage as unavailable, and avoid fabricating costs from labels or confidence. The adapter does not expose a per-call dollar limit.

## Execution requirements

Before dispatch, bind the pilot input hashes, rubric, both native definitions, explicit provider/model and run identity. Reserve attempted work durably before external execution so crashes, timeouts, retries and concurrent resumes cannot reset its allowance. A partially completed pair must preserve what was attempted and must not be silently replayed. Record function-attempt ceilings separately from verified HTTP-request ceilings and monetary limits.

A configuration field asserting that a dollar cap exists does not enforce one. The live path needs an enforceable provider/account spending limit or supported transport-level budget control, plus actual usage recording. The offline dry-run can validate local identities and exercise lifecycle controls without implying those provider controls exist.

The process environment and project configuration checked this session contained no native credentials (`TYPESAFE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN`, `AI_GATEWAY_API_KEY`), and provider/model/maximum spend remain unspecified. BLADE remains a JSON-shape reference only; default-off, shadow-only acceptance is unchanged.

## Checkout used for execution work

Cloud-offloaded Git metadata in the original workspace failed repository discovery and read as empty. The original workspace was left intact. Execution work continues in an isolated checkout of pushed commit `d15b9cb0027903681bc6dc555c51c8ebe05782ed` at `/private/tmp/gtm-jev-execution-20260922` on `feat/jev-shadow-pilot`.

The training pilot was regenerated there from the existing scratch corpus, opening training inputs/truth only. Its compiler source, rubric, source manifest and source inventory hashes match the previous final package. Validation and holdout observations/truth remain reserved.
