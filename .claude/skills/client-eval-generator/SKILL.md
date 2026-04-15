---
name: client-eval-generator
description: Generate a client-specific GTM eval + profile from Meta Ads insights and GTM/sGTM container exports. Run when a new client is added to the autoresearch engine, or when an existing client's business classification needs to be redone. Trigger phrases include "add a new client", "onboard <client>", "generate eval for <client>", "new client profile", "client-eval-generator".
---

# Client Eval Generator

Every client has a different business model (ecom / lead-gen / subscription /
high-ticket services / marketplace / SaaS). A single canned eval produces
noise, not signal. This skill produces a **client-specific eval module + profile**
by reading the client's Meta ad data and container exports.

## When to run

Invoke this skill when **any** of the following happen:

- A new client directory appears under `content/clients/<id>/`
- A new Meta ad snapshot appears under `data/clients/<id>/meta-ads-snapshot.json`
- The user says *"add a new client"*, *"onboard <name>"*, *"generate eval for <client>"*
- An existing client's profile.md is missing or stale (business model changed)
- The user references this skill by name (`client-eval-generator`)

Do NOT skip the profile step. A good eval depends on the classification.

## Inputs the skill expects to find

```
content/clients/<id>/
  <any>.json                  # one or more GTM/sGTM container exports
data/clients/<id>/
  meta-ads-snapshot.json      # Meta Ads insights (or pull live via Pipeboard MCP)
```

If the Meta snapshot is missing, use the `mcp__claude_ai_Pipeboard_Meta__*`
tools to pull it: `get_ad_accounts` → locate client → `get_pixels` + `get_insights`
with `action_attribution_windows: ["7d_click", "1d_click", "1d_view"]` and write the snapshot
to disk following the format in `data/clients/hre-beauty/meta-ads-snapshot.json`.

## Outputs the skill must produce

1. `content/clients/<id>/profile.md` — business classification + reasoning
2. `evals/clients/<id>.ts` — client-specific eval with a `default export` that matches:
   ```ts
   (container: GtmContainer, meta?: MetaAdsSnapshot) => GtmSignalQualityResult
   ```
3. Entry in `DOCUMENTATION/loops/gtm-autoresearch/program.md` under the **Clients** section with fields:
   - Template path
   - Meta snapshot path
   - Eval path

Split web and server into **separate clients** (e.g., `<id>-web`, `<id>-server`) —
they need different dimension sets.

## Step-by-step workflow

### 1. Classify the business

Read the Meta snapshot and container(s). Determine the model by cross-referencing:

| Signal | Classification clue |
|---|---|
| 8 standard ecom events (view_item → purchase) present | Ecommerce (Shopify / WooCommerce / Magento) |
| `lead` count > `purchase` count | Lead-gen |
| AOV > $500 | High-ticket / services / B2B |
| Many custom conversions (`offsite_conversion.custom.*`) | Custom business logic — not canned ecom |
| `complete_registration` + `purchase` both significant | Account-gated purchases (subscription / membership / booking) |
| Tag names reference `Charter`, `Booking`, `Appointment`, `Consult` | Services / travel / healthcare |
| Multiple locales in tag names (`FR_`, `DE_`, etc.) | Multi-region — naming conventions won't be uniform |
| sGTM container present | Server-side forwarding — separate eval needed |

Write `content/clients/<id>/profile.md` with these sections (see
`content/clients/hre-beauty/profile.md` and `content/clients/blade/profile.md`
for reference):

- **Business** — 1-2 sentence classification
- **Evidence** — numbers from the Meta account that justify the classification
- **What That Implies for Tracking** — 5-8 bullets of concrete implications
- **Container Inventory** — tags / triggers / variables / folders counts
- **Eval Module** — path(s) to the generated eval(s)

### 2. Pick dimensions based on classification

Don't reuse a canned dimension list. Pick 7-9 dimensions that map to the
client's actual KPIs. Weights must sum to 1.00.

Reference dimension patterns by classification:

**Ecommerce (Shopify-style)** → use `evaluateGtmSignalQuality` from the base
eval. It already covers the 8 ecom events + Meta/GA4/Google Ads + Consent.
A thin wrapper eval is enough (see `evals/clients/hre_beauty.ts`).

**Lead-gen / high-ticket services** (see `evals/clients/blade_web.ts`):
- Lead capture quality (form tag + fbclid/fbp/fbc + user_data hashing)
- Booking/purchase conversion tracking (value + currency + dedup)
- Custom conversion parity (every significant Meta custom conversion → GTM tag)
- Meta CAPI dedup
- Google Ads conversion parity
- Consent Mode v2
- Trigger/variable/naming hygiene (at lower weight)

**Server-side (sGTM)** (see `evals/clients/blade_server.ts`):
- Data client coverage (GA4 client, Meta client, optional TikTok/Pinterest)
- CAPI config quality (event_id, action_source, user_data fields: em/ph/fn/ln/ct/zp/country)
- PII hashing (transformation or per-tag sha256 before forwarding)
- Consent forwarding (consent_state / ad_storage / analytics_storage in event model)
- Event name normalization (significant Meta events handled)
- Custom template safety (permissions block, no eval/new Function)
- Request routing (taggingServerUrls set)
- Variable/naming hygiene

**Subscription / SaaS**:
- Trial start / activation / upgrade / churn events
- Refund handling
- Lifetime value forwarding
- Cookie-based identity (logged-in user_id stitching)

**Marketplace / multi-sided**:
- Both buyer and seller conversion paths
- GMV vs take-rate value forwarding
- Listing create / listing view distinct from purchase

### 3. Write the eval

Each dimension is a function returning `DimensionScore`. Combine with
weighted average. See the BLADE evals for the pattern.

Shape must be:
```ts
import type { GtmContainer, GtmSignalQualityResult, MetaAdsSnapshot } from "../eval_gtm_signal_quality.js";

export function evaluate<ClientName>(
  container: GtmContainer,
  meta?: MetaAdsSnapshot,
): GtmSignalQualityResult {
  const dimensions: DimensionScore[] = [ /* ... */ ];
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const combinedScore =
    dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight;
  return {
    combinedScore,
    dimensions,
    issues: dimensions.flatMap((d) => d.issues),
    tagCount: (container.containerVersion.tag ?? []).length,
    triggerCount: (container.containerVersion.trigger ?? []).length,
    variableCount: (container.containerVersion.variable ?? []).length,
    folderCount: (container.containerVersion.folder ?? []).length,
  };
}

export default evaluate<ClientName>;
```

The loop does `const mod = await import(evalPath); mod.default(container, meta)`.
The `default` export is load-bearing.

### 4. Register in program.md

Append a clients entry under the **Clients** section:

```markdown
- **<Display Name>** (`<id>`)
  - Template: `content/clients/<id>/<container-file>.json`
  - Meta snapshot: `data/clients/<id>/meta-ads-snapshot.json`
  - Eval: `evals/clients/<id>.ts`
  - Profile: `content/clients/<id>/profile.md`
```

If the client has both web and server containers, create TWO entries (`<id>-web`,
`<id>-server`) pointing at the respective container files and eval modules.

### 5. Typecheck + smoke-test

Run `npm run typecheck` after writing the eval. Then invoke the loop for
the new client:

```bash
npm run gtm-loop -- --client <id>
```

Report the baseline score and top 3 issues so the user can sanity-check the
eval before committing to a full 30-round run.

## Anti-patterns to avoid

- **Don't copy another client's eval verbatim.** The weights and dimensions
  must reflect THIS client's business. Copy structure, rewrite logic.
- **Don't score dimensions that are irrelevant.** If a client has no
  subscription tier, don't include a "subscription event coverage" dimension.
- **Don't assume ecom.** If Meta shows `lead >> purchase`, start from the
  lead-gen template, not the ecom one.
- **Don't invent custom conversion names.** Pull them from the Meta data
  (`offsite_conversion.custom.<id>`) and match them in the container by
  tag name.
- **Don't weight naming/hygiene heavily.** These are style dimensions; cap
  them at 0.15 combined. The big weights belong to business-critical
  tracking (lead/purchase/dedup).

## References

- `content/clients/hre-beauty/profile.md` — ecom reference profile
- `content/clients/blade/profile.md` — lead-gen / high-ticket services profile
- `evals/eval_gtm_signal_quality.ts` — base types and the ecom reference eval
- `evals/clients/hre_beauty.ts` — thin-wrapper example (reuses base eval)
- `evals/clients/blade_web.ts` — lead-gen / services web eval
- `evals/clients/blade_server.ts` — sGTM eval
- `scripts/run-gtm-loop.ts` — consumes the eval via dynamic import
