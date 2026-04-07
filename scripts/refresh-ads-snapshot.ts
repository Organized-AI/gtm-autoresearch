#!/usr/bin/env npx tsx
/**
 * Refresh Ads Snapshot
 *
 * Pulls fresh conversion data from Meta Ads API + Google Ads API,
 * computes funnel ratios, writes enriched snapshot.
 *
 * Usage:
 *   npx tsx scripts/refresh-ads-snapshot.ts
 *   npx tsx scripts/refresh-ads-snapshot.ts --meta-only
 *   npx tsx scripts/refresh-ads-snapshot.ts --google-only
 *
 * Requires env vars (see .env.example):
 *   Meta:  META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_PIXEL_ID
 *   Google: GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_DEVELOPER_TOKEN,
 *           GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN
 */

import "dotenv/config";
import { writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type {
  EnrichedAdsSnapshot,
  MetaAdsConversionEvent,
  GoogleAdsSnapshot,
  GoogleAdsConversionAction,
  FunnelRatio,
} from "../evals/eval_gtm_signal_quality.js";

const PROJECT_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const OUTPUT_PATH = path.resolve(PROJECT_ROOT, "data/signals/ads-snapshot-enriched.json");

const META_API_VERSION = "v21.0";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// ── Retry helper ────────────────────────────────────────────────────────────

function sanitizeErrorBody(body: string): string {
  return body
    .slice(0, 500)
    .replace(/"(client_secret|access_token|refresh_token)"\s*:\s*"[^"]*"/gi, '"$1":"<redacted>"');
}

function safeParseFloat(value: unknown, fallback = 0): number {
  const parsed = parseFloat(String(value ?? "0"));
  return isNaN(parsed) ? fallback : parsed;
}

async function fetchWithRetry(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);

      if (res.ok) return res;

      // Don't retry 4xx errors (except 429 rate limit)
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        const body = await res.text();
        throw new Error(`API error ${res.status}: ${sanitizeErrorBody(body)}`);
      }

      // Retry on 429 or 5xx
      if (attempt < MAX_RETRIES) {
        let delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
        const retryAfter = res.headers.get("Retry-After");
        if (retryAfter) {
          const retrySeconds = parseInt(retryAfter, 10);
          if (!isNaN(retrySeconds)) delayMs = retrySeconds * 1000;
        }
        console.log(`[Retry] ${res.status} on attempt ${attempt + 1}/${MAX_RETRIES + 1}, waiting ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      const body = await res.text();
      throw new Error(`API error ${res.status} after ${MAX_RETRIES + 1} attempts: ${sanitizeErrorBody(body)}`);
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES && (err as Error).message?.includes("fetch failed")) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(`[Retry] Network error on attempt ${attempt + 1}/${MAX_RETRIES + 1}, waiting ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("fetchWithRetry exhausted");
}

// ── Funnel step definitions (Shopify ecom benchmarks) ───────────────────────

const FUNNEL_STEPS: Array<{
  from: string;
  to: string;
  expected_low: number;
  expected_high: number;
}> = [
  { from: "view_content", to: "add_to_cart", expected_low: 0.08, expected_high: 0.25 },
  { from: "add_to_cart", to: "initiate_checkout", expected_low: 0.30, expected_high: 0.75 },
  { from: "initiate_checkout", to: "add_payment_info", expected_low: 0.40, expected_high: 0.95 },
  { from: "add_payment_info", to: "purchase", expected_low: 0.50, expected_high: 0.95 },
  { from: "initiate_checkout", to: "purchase", expected_low: 0.25, expected_high: 0.70 },
];

// ── Meta Ads API fetchers ───────────────────────────────────────────────────

async function fetchMetaInsights(
  accountId: string,
  token: string,
): Promise<{
  spend: number;
  events: Array<{ event: string; count_7d: number; count_1d: number; count_1d_view: number; value_7d: number }>;
  dateRange: { since: string; until: string };
}> {
  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = until.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    access_token: token,
    fields: "spend,actions,action_values",
    time_range: JSON.stringify({ since: sinceStr, until: untilStr }),
    level: "account",
  });

  const url = `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights?${params}`;
  const res = await fetchWithRetry(url);
  const json = await res.json();
  const data = json.data?.[0];

  if (!data) {
    console.log("[Meta] No insights data returned for period");
    return { spend: 0, events: [], dateRange: { since: sinceStr, until: untilStr } };
  }

  const spend = safeParseFloat(data.spend);

  // Map standard conversion events from actions array
  const eventMap = new Map<string, { count_7d: number; count_1d: number; count_1d_view: number; value_7d: number }>();

  // Meta reports actions with action_type names like "offsite_conversion.fb_pixel_purchase"
  const metaEventNames: Record<string, string> = {
    "offsite_conversion.fb_pixel_view_content": "view_content",
    "offsite_conversion.fb_pixel_add_to_cart": "add_to_cart",
    "offsite_conversion.fb_pixel_initiate_checkout": "initiate_checkout",
    "offsite_conversion.fb_pixel_add_payment_info": "add_payment_info",
    "offsite_conversion.fb_pixel_purchase": "purchase",
    "offsite_conversion.fb_pixel_search": "search",
    "offsite_conversion.fb_pixel_lead": "lead",
    "offsite_conversion.fb_pixel_complete_registration": "complete_registration",
    "offsite_conversion.fb_pixel_add_to_wishlist": "add_to_wishlist",
  };

  for (const action of (data.actions ?? [])) {
    const eventName = metaEventNames[action.action_type];
    if (!eventName) continue;
    const existing = eventMap.get(eventName) ?? { count_7d: 0, count_1d: 0, count_1d_view: 0, value_7d: 0 };
    // Default attribution window in actions is 7d_click + 1d_view
    existing.count_7d = Math.max(0, parseInt(action.value ?? "0", 10) || 0);
    eventMap.set(eventName, existing);
  }

  // Map action values
  for (const av of (data.action_values ?? [])) {
    const eventName = metaEventNames[av.action_type];
    if (!eventName) continue;
    const existing = eventMap.get(eventName);
    if (existing) {
      existing.value_7d = safeParseFloat(av.value);
    }
  }

  const events = Array.from(eventMap.entries()).map(([event, data]) => ({
    event,
    ...data,
  }));

  return { spend, events, dateRange: { since: sinceStr, until: untilStr } };
}

async function fetchPixelStats(
  pixelId: string,
  token: string,
): Promise<Map<string, { count_browser: number; count_server: number; dedup_rate: number }>> {
  const result = new Map<string, { count_browser: number; count_server: number; dedup_rate: number }>();

  // Fetch pixel stats — this endpoint may not be available for all pixels
  const params = new URLSearchParams({
    access_token: token,
    aggregation: "event",
  });

  const url = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/stats?${params}`;

  try {
    const res = await fetchWithRetry(url);
    const json = await res.json();
    for (const stat of (json.data ?? [])) {
      const event = stat.event?.toLowerCase();
      if (!event) continue;
      result.set(event, {
        count_browser: safeParseFloat(stat.count_browser_events),
        count_server: safeParseFloat(stat.count_server_events),
        dedup_rate: stat.deduplicated_percentage ? safeParseFloat(stat.deduplicated_percentage) / 100 : 0,
      });
    }
  } catch (err) {
    console.log(`[Meta] Pixel stats fetch failed: ${(err as Error).message}`);
  }

  return result;
}

async function fetchPixelEMQ(
  pixelId: string,
  token: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  const url = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}?fields=data_use_setting,server_events_diagnostics&access_token=${token}`;

  try {
    const res = await fetchWithRetry(url);
    const json = await res.json();
    const diagnostics = json.server_events_diagnostics ?? [];
    for (const diag of diagnostics) {
      if (diag.event_name && diag.event_match_quality !== undefined) {
        const emq = safeParseFloat(diag.event_match_quality, -1);
        if (emq >= 0) result.set(diag.event_name.toLowerCase(), emq);
      }
    }
  } catch (err) {
    console.log(`[Meta] EMQ fetch failed: ${(err as Error).message}`);
  }

  return result;
}

// ── Google Ads API fetcher ──────────────────────────────────────────────────

async function getGoogleAdsAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Google Ads OAuth credentials");
  }

  const res = await fetchWithRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const json = await res.json();
  return json.access_token;
}

async function fetchGoogleConversionActions(
  customerId: string,
  accessToken: string,
  developerToken: string,
  loginCustomerId?: string,
): Promise<GoogleAdsSnapshot> {
  const query = `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.category,
      conversion_action.status,
      conversion_action.counting_type,
      conversion_action.click_through_lookback_window_days,
      conversion_action.tag_snippets,
      metrics.conversions,
      metrics.conversions_value
    FROM conversion_action
    WHERE conversion_action.status != 'REMOVED'
  `;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (loginCustomerId) {
    headers["login-customer-id"] = loginCustomerId;
  }

  const url = `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:searchStream`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });

  const json = await res.json();
  const actions: GoogleAdsConversionAction[] = [];

  for (const batch of (json ?? [])) {
    for (const result of (batch.results ?? [])) {
      const ca = result.conversionAction;
      if (!ca) continue;

      // Extract tag snippets (conversion labels)
      const snippets: string[] = [];
      for (const snippet of (ca.tagSnippets ?? [])) {
        if (snippet.eventSnippet) {
          const match = snippet.eventSnippet.match(/AW-[\w/-]+/);
          if (match) snippets.push(match[0]);
        }
      }

      actions.push({
        id: ca.id ?? "",
        name: ca.name ?? "",
        category: ca.category ?? "DEFAULT",
        status: ca.status ?? "ENABLED",
        counting_type: ca.countingType ?? "ONE_PER_CLICK",
        click_through_lookback_window_days: ca.clickThroughLookbackWindowDays ?? 30,
        conversion_count_30d: safeParseFloat(result.metrics?.conversions),
        conversion_value_30d: safeParseFloat(result.metrics?.conversionsValue),
        tag_snippets: snippets,
      });
    }
  }

  return {
    customer_id: customerId,
    customer_name: `Google Ads ${customerId}`,
    currency: "USD",
    conversion_actions: actions,
  };
}

// ── Funnel computation ──────────────────────────────────────────────────────

function computeFunnelRatios(events: MetaAdsConversionEvent[]): FunnelRatio[] {
  const countMap = new Map<string, number>();
  for (const e of events) {
    countMap.set(e.event, e.count_7d_click);
  }

  const ratios: FunnelRatio[] = [];
  for (const step of FUNNEL_STEPS) {
    const fromCount = countMap.get(step.from);
    const toCount = countMap.get(step.to);

    if (fromCount === undefined || toCount === undefined || fromCount === 0) {
      continue; // Skip steps where we don't have both events
    }

    const ratio = toCount / fromCount;
    let status: "normal" | "low" | "high" = "normal";
    if (ratio < step.expected_low) status = "low";
    else if (ratio > step.expected_high) status = "high";

    ratios.push({
      from_event: step.from,
      to_event: step.to,
      ratio: Number(ratio.toFixed(4)),
      expected_low: step.expected_low,
      expected_high: step.expected_high,
      status,
    });
  }

  return ratios;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const metaOnly = args.includes("--meta-only");
  const googleOnly = args.includes("--google-only");

  console.log("[RefreshSnapshot] Starting enriched ads snapshot refresh");

  const snapshot: EnrichedAdsSnapshot = {
    generated_at: new Date().toISOString(),
    funnel: [],
    partial: false,
  };

  let metaFailed = false;
  let googleFailed = false;

  // ── Meta section ──

  if (!googleOnly) {
    const token = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;
    const pixelId = process.env.META_PIXEL_ID;

    if (!token || !accountId) {
      console.log("[Meta] Missing META_ACCESS_TOKEN or META_AD_ACCOUNT_ID — skipping Meta");
    } else {
      try {
        console.log(`[Meta] Fetching insights for ${accountId}...`);
        const insights = await fetchMetaInsights(accountId, token);
        console.log(`[Meta] Spend: $${insights.spend.toLocaleString()}, ${insights.events.length} event types`);

        // Fetch pixel-level stats for CAPI/browser split
        let pixelStats = new Map<string, { count_browser: number; count_server: number; dedup_rate: number }>();
        let emqScores = new Map<string, number>();

        if (pixelId) {
          console.log(`[Meta] Fetching pixel stats for ${pixelId}...`);
          pixelStats = await fetchPixelStats(pixelId, token);
          console.log(`[Meta] Pixel stats: ${pixelStats.size} events with browser/server split`);

          console.log(`[Meta] Fetching EMQ scores for ${pixelId}...`);
          emqScores = await fetchPixelEMQ(pixelId, token);
          console.log(`[Meta] EMQ scores: ${emqScores.size} events`);
        }

        // Merge insights + pixel stats + EMQ into conversion events
        const conversionEvents: MetaAdsConversionEvent[] = insights.events.map((e) => {
          const stats = pixelStats.get(e.event);
          const emq = emqScores.get(e.event);

          return {
            event: e.event,
            count_7d_click: e.count_7d,
            count_1d_click: e.count_1d,
            count_1d_view: e.count_1d_view,
            value_7d_click: e.value_7d,
            count_browser: stats?.count_browser,
            count_server: stats?.count_server,
            dedup_rate: stats?.dedup_rate,
            emq_score: emq,
          };
        });

        snapshot.meta = {
          account_id: accountId,
          account_name: process.env.META_ACCOUNT_NAME ?? accountId,
          pixel_id: pixelId ?? "",
          currency: "USD",
          spend: insights.spend,
          date_range: insights.dateRange,
          conversion_events: conversionEvents,
        };

        // Compute funnel ratios from Meta events
        snapshot.funnel = computeFunnelRatios(conversionEvents);
        console.log(`[Meta] Funnel: ${snapshot.funnel.length} steps computed`);
        for (const step of snapshot.funnel) {
          const flag = step.status === "normal" ? "✓" : step.status === "low" ? "↓" : "↑";
          console.log(`  ${flag} ${step.from_event} → ${step.to_event}: ${(step.ratio * 100).toFixed(0)}% (expected ${(step.expected_low * 100).toFixed(0)}-${(step.expected_high * 100).toFixed(0)}%)`);
        }
      } catch (err) {
        console.error(`[Meta] Error: ${(err as Error).message}`);
        metaFailed = true;
      }
    }
  }

  // ── Google Ads section ──

  if (!metaOnly) {
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

    if (!customerId || !developerToken) {
      console.log("[GoogleAds] Missing GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_DEVELOPER_TOKEN — skipping Google Ads");
    } else {
      try {
        console.log(`[GoogleAds] Fetching conversion actions for ${customerId}...`);
        const accessToken = await getGoogleAdsAccessToken();
        const googleSnapshot = await fetchGoogleConversionActions(
          customerId,
          accessToken,
          developerToken,
          process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
        );
        snapshot.google_ads = googleSnapshot;
        console.log(`[GoogleAds] ${googleSnapshot.conversion_actions.length} conversion actions found`);
        for (const action of googleSnapshot.conversion_actions) {
          if (action.conversion_count_30d > 0) {
            console.log(`  ${action.name} (${action.category}): ${action.conversion_count_30d} conversions, $${action.conversion_value_30d.toLocaleString()}`);
          }
        }
      } catch (err) {
        console.error(`[GoogleAds] Error: ${(err as Error).message}`);
        googleFailed = true;
      }
    }
  }

  // ── Set partial flag ──

  if (metaFailed || googleFailed) {
    snapshot.partial = true;
    console.warn(`[RefreshSnapshot] Partial failure: meta=${metaFailed ? "FAILED" : "ok"}, google=${googleFailed ? "FAILED" : "ok"}`);
  }

  // ── Atomic write (temp → rename) ──

  const tempPath = OUTPUT_PATH + ".tmp";
  await writeFile(tempPath, JSON.stringify(snapshot, null, 2));
  await rename(tempPath, OUTPUT_PATH);
  console.log(`\n[RefreshSnapshot] Written to: ${OUTPUT_PATH}`);
  console.log(`[RefreshSnapshot] Meta: ${snapshot.meta ? "ok" : "missing"}, Google Ads: ${snapshot.google_ads ? "ok" : "missing"}, Funnel steps: ${snapshot.funnel.length}${snapshot.partial ? " [PARTIAL]" : ""}`);
}

main().catch((err) => {
  console.error("[RefreshSnapshot] Fatal error:", err.message);
  process.exit(1);
});
