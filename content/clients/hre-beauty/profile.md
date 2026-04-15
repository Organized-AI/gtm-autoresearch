# HRE Beauty — Client Profile

## Business

**HRE Beauty** — direct-to-consumer beauty brand on **Shopify**.
Classic ecommerce: browse → add-to-cart → checkout → purchase, with
newsletter lead capture as a secondary funnel.

## Evidence (from Meta ad account `act_645790768357540`)

- **Location:** Scottsdale, AZ
- **Spend:** $51,628 / 30 days
- **Purchases:** 1,231 events totaling $51,062 → **AOV ≈ $41** (mid-ticket beauty)
- **Full ecom funnel present:**
  - `view_content`: 20,777 (top-of-funnel product views)
  - `add_to_cart`: 3,537 (17% of views → cart)
  - `initiate_checkout`: 2,221 (63% of carts → checkout)
  - `add_payment_info`: 343 (15% of checkouts → payment)
  - `purchase`: 1,231
- **Secondary:** `search` 67, `lead` 622 (list building)
- **No custom Meta conversions** — standard ecom events only
- **Pixel:** `CV | HRE Pixel | Created 03.29.2025`

## What That Implies for Tracking

1. **Shopify DataLayer conventions** — `view_item`, `view_item_list`, `select_item`, `add_to_cart`, `view_cart`, `begin_checkout`, `add_payment_info`, `purchase` are the 8 events that matter
2. **GA4 Config + Google Ads conversion + Meta pixel** — the three-platform standard for DTC ecom
3. **Consent Mode v2** — GDPR matters for EU traffic, but primary US market
4. **Event ID dedup** — critical because Meta browser pixel + server-side CAPI both fire
5. **Tag naming convention** — `Platform - Event` (e.g., `Meta - Purchase`, `GA4 - add_to_cart`), `CE - event` for custom triggers, `DLV/CJS/Cookie/Const -` for variables
6. **Folder organization** — one folder per platform (GA4, Meta, Google Ads) plus Utility/Consent

## Container Inventory

| Container | ID | Tags | Triggers | Variables | Folders |
|---|---|---|---|---|---|
| Web template | `%%CONTAINER_PUBLIC_ID%%` | 17 | 8 | 14 | 6 |

HRE's container is a **reusable template** with `%%PLACEHOLDER%%` tokens for
client-specific IDs. The loop must preserve placeholders across mutations.

## Eval Module

`evals/clients/hre_beauty.ts` — delegates to the original `evaluateGtmSignalQuality`
which is tuned for Shopify ecom web containers (8 ecom events, GA4 Config,
Google Ads awct, Meta pixel with event ID dedup, Consent Mode v2).
