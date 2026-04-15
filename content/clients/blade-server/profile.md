# BLADE — Client Profile

## Business

**BLADE Air Mobility** — helicopter/short-haul aviation charter service.
Not ecommerce. Revenue model is **lead-gen → consultation → high-ticket booking**,
with charters, flights, and subscriptions sold as scheduled services.

## Evidence (from Meta ad account `act_1385707951714513`)

- **Spend:** $48,168 / 30 days
- **Purchases:** 405 events totaling $425,217 → **AOV ≈ $1,050** (high-ticket)
- **Leads:** 260 events (`fb_pixel_lead`) totaling $1,970 in declared value
- **Complete registrations:** 166 (bookings requiring account creation)
- **Add to cart:** only 44 — a step in the flow, not the goal
- **Custom Meta conversions:**
  - `Purchase-New` / `Purchase-Repeat` (retention segmentation)
  - 6 other custom conversions handling different booking types (charters, scheduled flights, etc.)
- **Container warnings referencing real tags:**
  - `Google_Leads_ChartersConfirmed` — confirmed-charter conversion
  - `AW_GoogleAds_ATC` — Google Ads add-to-cart
  - `WITHIN_GoogleAds_ATC` — separate Within-app cart
  - `Google_Ads_FR_Paiement_initié` — French-locale initiate checkout

## What That Implies for Tracking

1. **Leads matter as much as purchases.** Meta `Lead` events should be first-class, not an afterthought
2. **Custom conversions are the real KPI** — not the standard 8 ecommerce events. Loop must check those, not a canned Shopify list
3. **High AOV means server-side (CAPI) is critical** — browser pixel attribution leak at $1K AOV is very expensive
4. **Multi-locale (at least EN + FR)** — tag naming won't follow a single convention
5. **Subscription/repeat tracking** — `Purchase-Repeat` vs `Purchase-New` requires tag-level logic, not just firing on `purchase`
6. **No Shopify DataLayer assumptions** — BLADE has a custom web app; DataLayer schemas won't match `view_item_list` / `select_item` patterns

## Container Inventory

| Container | ID | Tags | Triggers | Variables | Folders |
|---|---|---|---|---|---|
| Web | `GTM-W9S77T7` | 105 | 42 | 72 | 4 |
| Server | `GTM-KJHX6KJ7` | 7 | 9 | 17 | 1 |

Server container is small because sGTM has fewer but larger entities — `customTemplate` clients for GA4/Meta/TikTok plus `transformation` objects for PII hashing.

## Eval Modules

- Web: `evals/clients/blade_web.ts`
- Server: `evals/clients/blade_server.ts`
