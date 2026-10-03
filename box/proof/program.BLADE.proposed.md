# GTM Autoresearch Loop — Program Contract (BLADE)

## Target
- Template file: `content/gtm-templates/BLADE/seed/blade-web.json`
- Enriched Ads snapshot: `data/signals/blade-ads-snapshot-enriched.json`
- Meta Ads snapshot: (none — using enriched format)
- Template type: BLADE helicopter/aviation web container (GA4 + Meta + GAds + Bing + LinkedIn + DoubleClick + Twitter + CTV)

## Eval Dimensions & Weights

When enriched snapshot is available (full profile — Meta + Google Ads):

| # | Dimension | Weight | What it checks |
|---|-----------|--------|----------------|
| 1 | Tag coverage | 0.14 | All ecom events + GA4 Config + Linker + GAds conversion |
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
2. **Meta coverage** — Add missing Meta event tags
3. **CAPI coverage** — Ensure browser tags + GA4 event tags exist for all Meta events (GA4 feeds sGTM → CAPI)
4. **Parameters** — Fill missing required params on existing tags
5. **Deduplication** — Ensure all Meta tags reference event ID generator
6. **Google Ads alignment** — Add missing GAds conversion tags for active conversion actions
7. **Naming** — Fix any naming convention violations
8. **Folders** — Assign unfoldered entities to correct folders

### Learned habits (AutoLoop, review before merging)

- Before targeting a dimension, count the entity changes its fix needs. If it needs more than the mutation budget (3), skip it for this run, write it to the run notes for a human, and take the next dimension. (Evidence: BLADE 2026-04-29T143650.json rounds 6–29, triggerQuality needed 6.)
- After 3 reverts in a row on the same target, switch to the dimension with the largest weighted gap (1 − score) × weight instead of the lowest raw score. (Evidence: same run; folderOrganization 5.2pp was never targeted.)
- When a tag gets consentStatus NEEDED, list the consent types it depends on in the same edit: ad_storage (and ad_user_data, ad_personalization) for ad pixels and conversion tags, analytics_storage for GA4. NEEDED with no types is a high-severity audit finding. (Evidence: BLADE 2026-04-29T143650-blade-web.json, 114 tags.)
- Before adding a trigger, look for an existing trigger with the same name or the same filter and reuse it. (Evidence: BLADE 2026-04-29T143650-blade-web.json, duplicate CE - add_payment_info.)

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
- 5 consecutive invalid JSON responses → **failure stop**

## Pre-Upload Gate

Before importing any winning JSON into GTM:

1. Compare `seed/blade-web.json` vs the candidate winning export at the raw JSON level
2. Confirm all newly added triggers are wired to at least one tag and no new orphan triggers were introduced
3. Run the `data-audit` skill against the linked Meta account (`act_1385707951714513`) and pixel (`311227299268737`) to verify ads-side event coverage, Pixel/CAPI health, and tracking infrastructure before upload
4. Only then import the winning JSON into a staging workspace for browser QA and publish review

## Notes

- BLADE container is significantly larger than HRE (105 tags vs 17) — mutations must be surgical
- Multiple ad platforms (Meta, Google, Bing, LinkedIn, DoubleClick, Twitter, CTV) — consent fix has wider blast radius
- Ads snapshot is structural-only until API tokens are configured — 4 ads-driven dimensions will fall back to structural scoring
- sGTM container also available at `content/gtm-templates/BLADE/seed/blade-sgtm.json` (not optimized in this loop)
