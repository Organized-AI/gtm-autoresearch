# GTM Autoresearch Loop — Program Contract

## Clients

The loop iterates all clients below back-to-back. Per-client outputs are written to
`content/clients/<client>/winning/` and `DOCUMENTATION/loops/gtm-autoresearch/loop-results/<client>/`.

- **HRE Beauty** (`hre-beauty`)
  - Template: `content/clients/hre-beauty/shopify-ecom-web.json`
  - Meta snapshot: `data/clients/hre-beauty/meta-ads-snapshot.json`
  - Eval: `evals/clients/hre_beauty.ts`
  - Profile: `content/clients/hre-beauty/profile.md`
- **BLADE Web** (`blade-web`)
  - Template: `content/clients/blade-web/web-GTM-W9S77T7.json` (container `GTM-W9S77T7`)
  - Meta snapshot: `data/clients/blade-web/meta-ads-snapshot.json`
  - Eval: `evals/clients/blade_web.ts`
  - Profile: `content/clients/blade-web/profile.md`
- **BLADE Server** (`blade-server`)
  - Template: `content/clients/blade-server/server-GTM-KJHX6KJ7.json` (container `GTM-KJHX6KJ7`)
  - Meta snapshot: `data/clients/blade-server/meta-ads-snapshot.json`
  - Eval: `evals/clients/blade_server.ts`
  - Profile: `content/clients/blade-server/profile.md`

Clients whose template file is missing are skipped with a warning. See
`content/clients/blade/README.md` for how to populate BLADE's GTM exports.

## Eval Dimensions & Weights

| # | Dimension | Weight | What it checks |
|---|-----------|--------|----------------|
| 1 | Tag coverage | 0.20 | All 8 ecom events + GA4 Config + Linker + GAds conversion |
| 2 | Parameter completeness | 0.15 | Required params per tag type (sendEcommerceData, conversionId, eventID, etc.) |
| 3 | Deduplication | 0.10 | Event ID generator variable + referenced in Meta tags |
| 4 | Consent settings | 0.15 | Consent Mode v2 init tag + per-tag consentStatus = NEEDED |
| 5 | Naming conventions | 0.10 | `Platform - Event` tags, `CE - event` triggers, `Const/DLV/CJS/Cookie -` vars |
| 6 | Variable hygiene | 0.10 | No orphans, no missing refs, DLV version 2 |
| 7 | Trigger quality | 0.10 | EQUALS filters, no orphan/duplicate triggers |
| 8 | Folder organization | 0.10 | All entities assigned to correct logical folders |

## Edit Strategy (priority order)

1. **Consent first** — Add Consent Mode v2 init tag, set all existing tags to `consentStatus: "NEEDED"`
2. **Meta coverage** — Add missing Meta event tags (AddPaymentInfo, ViewContent for view_item_list)
3. **Parameters** — Fill missing required params on existing tags
4. **Deduplication** — Ensure all Meta tags reference `{{CJS - Event ID Generator}}`
5. **Naming** — Fix any naming convention violations
6. **Folders** — Assign unfoldered entities to correct folders

## Constraints (INVARIANTS — mutations that violate these are rejected)

- Never remove existing tags — only add or modify
- Never break `%%PLACEHOLDER%%` tokens — all `%%...%%` strings must survive mutation
- Never change `exportFormatVersion`
- Never change `accountId`, `containerId` patterns
- Never remove folders
- All JSON must remain valid GTM container export format
- Tag IDs must remain unique strings
- Trigger IDs must remain unique strings
- Variable IDs must remain unique strings

## Mutation Budget

- Max 3 entities changed per round (tags added/modified, variables added, triggers added)
- One "entity change" = adding a new tag/trigger/variable OR modifying params of an existing one

## Model Escalation

- **Rounds with score < 0.92**: Claude Sonnet drives mutations (cheap exploration)
- **First time score ≥ 0.92**: loop escalates to **Claude Opus 4.6** for the remaining rounds — stronger reasoning to extract the last gains on an already-good config
- Escalation is one-way per client: once on Opus, we stay on Opus for the rest of the run

## Stop Conditions

- Score ≥ 0.92 on **Opus 4.6** sustained for 3 consecutive rounds → **plateau stop** (Sonnet hitting 0.92 escalates — it does not stop)
- Round 30 reached → **max rounds stop**
- 3 consecutive regressions (score decreases) → **regression stop**
- 5 consecutive invalid JSON responses from the active model → **failure stop** (switch to smaller mutation prompt)

## Cost Estimate

- ~30 rounds × ~2K tokens input + ~1K output = ~90K tokens total per client
- Claude Sonnet (exploration phase): ~$0.60 per client for the pre-escalation rounds
- Claude Opus 4.6 (escalation phase): only the final few rounds after score ≥ 0.92 — usually 3–6 rounds before plateau
