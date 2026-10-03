# GTM Autoresearch Loop — Program Contract

## Target
- Template file: `content/gtm-templates/HRE/seed/shopify-ecom-web.json`
- Enriched Ads snapshot: `data/signals/ads-snapshot-enriched.json`
- Meta Ads snapshot: `data/signals/meta-ads-snapshot.json`
- Template type: Shopify ecommerce web container (GA4 + Meta + GAds)

## Eval Dimensions & Weights

When enriched snapshot is available (full profile — Meta + Google Ads):

| # | Dimension | Weight | What it checks |
|---|-----------|--------|----------------|
| 1 | Tag coverage | 0.14 | All 8 ecom events + GA4 Config + Linker + GAds conversion |
| 2 | Parameter completeness | 0.10 | Required params per tag type (sendEcommerceData, conversionId, eventID, etc.) |
| 3 | Deduplication | 0.07 | Event ID generator variable + referenced in Meta tags |
| 4 | Consent settings | 0.11 | Consent Mode v2 init tag + per-tag consentStatus = NEEDED |
| 5 | Naming conventions | 0.06 | `Platform - Event` tags, `CE - event` triggers, `Const/DLV/CJS/Cookie -` vars |
| 6 | Variable hygiene | 0.06 | No orphans, no missing refs, DLV version 2 |
| 7 | Trigger quality | 0.08 | EQUALS filters, no orphan/duplicate triggers |
| 8 | Folder organization | 0.06 | All entities assigned to correct logical folders |
| 9 | Meta Ads alignment | 0.09 | Container covers events actually firing in Meta Ads, weighted by value |
| 10 | CAPI coverage | 0.08 | Browser + server tags exist, dedup rate healthy, EMQ > 6, _fbc/_fbp cookies present |
| 11 | Funnel integrity | 0.07 | Funnel drop-off ratios within expected norms (flags tracking gaps) |
| 12 | Google Ads alignment | 0.08 | GTM conversion tags match active Google Ads conversion actions |

Falls back to 8-dimension structural scoring when no ads snapshot is provided.

## Edit Strategy (priority order)

1. **Consent first** — Add Consent Mode v2 init tag, set all existing tags to `consentStatus: "NEEDED"`
2. **Meta coverage** — Add missing Meta event tags (AddPaymentInfo, ViewContent for view_item_list)
3. **CAPI coverage** — Ensure browser tags + GA4 event tags exist for all Meta events (GA4 feeds sGTM → CAPI)
4. **Parameters** — Fill missing required params on existing tags
5. **Deduplication** — Ensure all Meta tags reference `{{CJS - Event ID Generator}}`
6. **Google Ads alignment** — Add missing GAds conversion tags for active conversion actions
7. **Naming** — Fix any naming convention violations
8. **Folders** — Assign unfoldered entities to correct folders

### Learned habits (AutoLoop, review before merging)

- Prefer edits that leave every dimension at or above its current score. When an edit lowers one, say which and by how much in the round record. (Evidence: HRE, 4 kept rounds lowered folderOrganization, triggerQuality, namingConventions.)
- Before round 0, send the mutation provider a one-line ping and stop the run if it doesn't answer, so a dead provider costs one call instead of five rounds. (Evidence: HRE, 7 silent rounds in 2 runs.)
- When a tag gets consentStatus NEEDED, list the consent types it depends on in the same edit: ad_storage (and ad_user_data, ad_personalization) for ad pixels and conversion tags, analytics_storage for GA4. NEEDED with no types is a high-severity audit finding. (Evidence: HRE best-95.7pct-2026-04-08.json, 20 tags.)
- Don't add Custom HTML tags or Custom JavaScript variables. Use a built-in tag type or a gallery template; if neither fits, skip the change and note it for a human. (Evidence: HRE best-95.7pct-2026-04-08.json, +2 opaque entities.)

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

## Stop Conditions

- Score >= 0.92 sustained for 3 consecutive rounds → **plateau stop**
- Round 30 reached → **max rounds stop**
- 3 consecutive regressions (score decreases) → **regression stop**
- 5 consecutive invalid JSON responses from Haiku → **failure stop** (switch to smaller mutation prompt)

## Pre-Loop Data Refresh

Before running the loop, refresh the enriched ads snapshot:
```bash
npx tsx scripts/refresh-ads-snapshot.ts
```

This pulls fresh data from Meta Ads API (insights + pixel diagnostics + EMQ) and Google Ads API (conversion actions), then computes funnel ratios. Output: `data/signals/ads-snapshot-enriched.json`.

## Cost Estimate

- ~30 rounds × ~2K tokens input + ~1K output = ~90K tokens total
- Claude Haiku: ~$0.15 for full run
