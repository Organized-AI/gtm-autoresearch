# Blade Pre-Upload Diff

Compared files:

- `content/gtm-templates/BLADE/seed/blade-web.json`
- `content/gtm-templates/BLADE/winning/best-76.8pct-2026-04-08.json`

## Summary

- Same container: `www.blade.com` / `GTM-W9S77T7`
- Seed counts: `105` tags, `42` triggers, `72` variables, `4` folders
- Best counts: `115` tags, `46` triggers, `72` variables, `4` folders
- Net change: `+10` tags, `+4` triggers, `0` variables, `0` removals

## Added Tags

- `Consent - Consent Mode v2 Init`
- `GA4 - Config`
- `GA4 - purchase`
- `GA4 - add_to_cart`
- `GA4 - view_item`
- `GA4 - begin_checkout`
- `GA4 - view_item_list`
- `GA4_event_select_item`
- `GA4_event_view_cart`
- `GA4_event_add_payment_info`

## Added Triggers

- `Consent Initialization - All Pages`
- `CE - view_item`
- `CE - view_item_list`
- `CE - select_item`

## Existing Tag Changes

The dominant in-place change is consent metadata:

- `105` legacy tags changed from `consentSettings.consentStatus = "NOT_SET"` to `"NEEDED"`

The only other in-place changes found:

- `AW_Google_Purchase_90dWindow` gained `parentFolderId = "32"`
- `Google_Leads_ChartersConfirmed` gained `parentFolderId = "32"`
- `Google_Leads_ChartersPriceEstimator` gained `parentFolderId = "32"`

## Pre-Upload Fix Applied

One wiring issue existed in the winning JSON:

- `GA4_event_select_item` was firing on legacy trigger `104` instead of the newly added custom event trigger `389` (`CE - select_item`)

That has been corrected in the local pre-upload export so the new trigger is no longer orphaned.

## Remaining Risk

`GA4_event_add_payment_info` still fires on trigger `297` (`AW_Initiate_Checkout_v2`), the same pageview trigger used by `GA4 - begin_checkout`. That may be semantically incorrect for GA4 funnel reporting, but it was not changed because the correct downstream event mapping is not provable from the JSON alone.

## Required Pre-Upload Checks

1. Re-run this JSON diff against the final candidate export.
2. Confirm every newly added trigger is referenced by at least one tag.
3. Run the `data-audit` skill against Meta account `act_1385707951714513` and pixel `311227299268737`.
4. Import only into staging first, then do browser QA before any publish.
