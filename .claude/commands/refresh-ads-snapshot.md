Refresh the enriched ads snapshot for a client. Self-healing: detects missing/stale sections and pulls only what's needed.

## Arguments

$ARGUMENTS = client ID (e.g., `hre`). Defaults to `hre` if empty.

## Instructions

### Step 1: Load client config

Read `data/clients/{client_id}/config.json` to get account IDs for each platform.

### Step 2: Load existing snapshot

Read the file at the client's `snapshot_path`. If it doesn't exist, start with an empty snapshot. Check each section:

- **Meta section**: missing if `meta` key absent, stale if `generated_at` > 24h ago
- **Google Ads section**: missing if `google_ads` key absent
- **Funnel section**: recompute whenever Meta data is refreshed

Log what needs refreshing:
```
[Snapshot] Current state:
  Meta: present (23h old) / missing / stale (72h+)
  Google Ads: present / missing
  Funnel: 5 steps / missing
  Partial: true/false
```

### Step 3: Pull Meta data (if missing or stale)

Only pull if `meta.ad_account_id` is set in client config.

**3a. Account insights** (conversion events + spend):
```
mcp__claude_ai_Pipeboard_Meta__get_insights(
  object_id: "{meta.ad_account_id}",
  time_range: "last_30d",
  level: "account",
  action_attribution_windows: ["7d_click", "1d_click", "1d_view"]
)
```

From the `actions` array, extract events matching these `action_type` prefixes:

| action_type | event name |
|---|---|
| `offsite_conversion.fb_pixel_view_content` | `view_content` |
| `offsite_conversion.fb_pixel_add_to_cart` | `add_to_cart` |
| `offsite_conversion.fb_pixel_initiate_checkout` | `initiate_checkout` |
| `offsite_conversion.fb_pixel_add_payment_info` | `add_payment_info` |
| `offsite_conversion.fb_pixel_purchase` | `purchase` |
| `offsite_conversion.fb_pixel_search` | `search` |
| `offsite_conversion.fb_pixel_lead` | `lead` |
| `offsite_conversion.fb_pixel_complete_registration` | `complete_registration` |

For each event, build:
```json
{
  "event": "<name>",
  "count_7d_click": <from 7d_click>,
  "count_1d_click": <from 1d_click>,
  "count_1d_view": <from 1d_view>,
  "value_7d_click": <from action_values matching same action_type, 7d_click>
}
```

From `action_values`, match by the `offsite_conversion.fb_pixel_*` action_type to get `value_7d_click`.

**3b. Pixel info**:
```
mcp__claude_ai_Pipeboard_Meta__get_pixels(account_id: "{meta.ad_account_id}")
```

Use the first active pixel (where `is_unavailable` is false and `last_fired_time` is recent). Store the pixel_id.

**On failure**: Log the error, keep existing Meta data in snapshot, set `partial: true`.

### Step 4: Pull Google Ads data (if missing and customer_id configured)

Only pull if `google_ads.customer_id` is set (non-empty) in client config.

**4a. Try TrueClicks MCP**:
```
mcp__claude_ai_Google_Ads_MCP_by_TrueClicks__google-ads-download-report(
  customerId: <customer_id as number>,
  loginCustomerId: <login_customer_id as number, or same as customer_id>,
  query: "SELECT conversion_action.id, conversion_action.name, conversion_action.category, conversion_action.status, conversion_action.counting_type, conversion_action.click_through_lookback_window_days, conversion_action.tag_snippets, metrics.conversions, metrics.conversions_value FROM conversion_action WHERE conversion_action.status != 'REMOVED'"
)
```

Transform each result into:
```json
{
  "id": "<conversion_action.id>",
  "name": "<conversion_action.name>",
  "category": "<conversion_action.category>",
  "status": "<conversion_action.status>",
  "counting_type": "<conversion_action.counting_type>",
  "click_through_lookback_window_days": <number>,
  "conversion_count_30d": <metrics.conversions>,
  "conversion_value_30d": <metrics.conversions_value>,
  "tag_snippets": [<extract AW-xxx/yyy patterns from tag_snippets>]
}
```

**On failure**: Log the error, keep existing Google Ads data, set `partial: true`.

### Step 5: Compute funnel ratios (whenever Meta is refreshed)

Using the Meta `count_7d_click` values, compute:

| from_event | to_event | expected_low | expected_high |
|---|---|---|---|
| view_content | add_to_cart | 0.08 | 0.25 |
| add_to_cart | initiate_checkout | 0.30 | 0.75 |
| initiate_checkout | add_payment_info | 0.40 | 0.95 |
| add_payment_info | purchase | 0.50 | 0.95 |
| initiate_checkout | purchase | 0.25 | 0.70 |

For each step where both events exist and from_count > 0:
- `ratio = to_count / from_count` (round to 4 decimal places)
- `status = "low"` if ratio < expected_low, `"high"` if ratio > expected_high, else `"normal"`
- Skip steps where either event has 0 or is missing

### Step 6: Merge and write

Build the final snapshot by merging:
- **New data** overwrites the corresponding section
- **Failed sections** keep existing data from the old snapshot
- **`generated_at`** = current ISO timestamp
- **`partial`** = true if any section failed or is missing

Write to the client's `snapshot_path` (default: `data/signals/ads-snapshot-enriched.json`).

The schema MUST match `EnrichedAdsSnapshot` from `evals/eval_gtm_signal_quality.ts`:
```typescript
{
  generated_at: string;       // ISO 8601
  partial?: boolean;
  meta?: {
    account_id: string;
    account_name: string;
    pixel_id: string;
    currency: string;
    spend: number;
    date_range: { since: string; until: string };
    conversion_events: MetaAdsConversionEvent[];
  };
  google_ads?: GoogleAdsSnapshot;
  funnel: FunnelRatio[];
}
```

### Step 7: Summary

Print a diagnostic table:

```
[Snapshot] Refresh complete for {client_name}
  Generated: {timestamp}
  Meta:       {ok/failed/skipped} — {N} events, ${spend} spend, {date_range}
  Google Ads: {ok/failed/skipped} — {N} conversion actions
  Funnel:     {N} steps — {anomalies}
  Partial:    {true/false}
  Written to: {snapshot_path}

  Funnel diagnostics:
    view_content → add_to_cart:        17.2% (normal)
    add_to_cart → initiate_checkout:   62.5% (normal)
    initiate_checkout → add_payment:   14.8% (LOW — likely broken tag)
    add_payment → purchase:            371%  (HIGH — add_payment undercounted)
    initiate_checkout → purchase:      55.1% (normal)
```

Then: `Ready to run: npx tsx scripts/run-gtm-loop.ts`
