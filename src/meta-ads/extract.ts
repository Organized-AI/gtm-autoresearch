import type { CaptureMetadata, MetaAdRaw } from "./transform.js";

interface PipeboardAdInsight {
  ad_id: unknown;
  ad_name: unknown;
  campaign_id: unknown;
  campaign_name: unknown;
  adset_name: unknown;
  spend: unknown;
  impressions: unknown;
  clicks: unknown;
  roas: unknown;
  purchase_conversions: unknown;
  date_start?: unknown;
  date_stop?: unknown;
}

interface PipeboardAccountResult {
  account_id: string;
  account_name: string;
  insights: PipeboardAdInsight[];
}

export interface ParsedMetaAdsCapture {
  ads: MetaAdRaw[];
  meta: CaptureMetadata;
  total_ads: number;
}

function todayIsoDate(): string {
  return new Date().toISOString().split("T")[0];
}

export function inferObjective(campaignName: string): string {
  const lower = campaignName.toLowerCase();
  if (lower.includes("retarget") || lower.includes("remarket")) return "REMARKETING";
  if (lower.includes("prospect") || lower.includes("cold")) return "PROSPECTING";
  if (lower.includes("testing") || lower.includes("test")) return "TESTING";
  if (lower.includes("brand")) return "BRAND_AWARENESS";
  if (lower.includes("conversion") || lower.includes("purchase")) return "CONVERSIONS";
  return "OUTCOME_SALES";
}

function mapInsightToMetaAd(ad: PipeboardAdInsight): MetaAdRaw {
  const spend = Number(ad.spend) || 0;
  const impressions = Number(ad.impressions) || 0;
  const clicks = Number(ad.clicks) || 0;
  const roas = Number(ad.roas) || 0;
  const purchases = Number(ad.purchase_conversions) || 0;

  return {
    ad_id: String(ad.ad_id),
    ad_name: String(ad.ad_name),
    campaign_id: String(ad.campaign_id),
    campaign_name: String(ad.campaign_name),
    campaign_objective: inferObjective(String(ad.campaign_name)),
    adset_name: String(ad.adset_name),
    spend,
    impressions,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    purchases,
    purchase_value: spend * roas,
    purchase_roas: roas,
    add_to_carts: 0,
    initiates_checkout: 0,
  };
}

export function parsePipeboardInsightsPayload(
  payload: unknown,
  captureDate = todayIsoDate(),
): ParsedMetaAdsCapture {
  const accountResult = (payload as { results?: PipeboardAccountResult[] }).results?.[0];
  if (!accountResult) {
    throw new Error("Invalid Pipeboard payload: missing results[0]");
  }

  const campaigns = new Map<string, string>();
  for (const ad of accountResult.insights) {
    campaigns.set(String(ad.campaign_id), String(ad.campaign_name));
  }

  const ads = accountResult.insights.map(mapInsightToMetaAd);
  const activeAds = ads.filter((ad) => ad.spend > 0);
  const totalSpend = activeAds.reduce((sum, ad) => sum + ad.spend, 0);
  const totalPurchases = activeAds.reduce((sum, ad) => sum + ad.purchases, 0);
  const firstInsight = accountResult.insights[0];

  return {
    ads,
    total_ads: accountResult.insights.length,
    meta: {
      account_id: accountResult.account_id,
      account_name: accountResult.account_name,
      capture_date: captureDate,
      date_range: `${String(firstInsight?.date_start || "unknown")} to ${String(firstInsight?.date_stop || "unknown")}`,
      total_spend: Math.round(totalSpend * 100) / 100,
      total_purchases: totalPurchases,
      campaign_count: campaigns.size,
      active_ad_count: activeAds.length,
    },
  };
}

export function parsePipeboardResultEnvelope(
  envelope: unknown,
  captureDate = todayIsoDate(),
): ParsedMetaAdsCapture {
  const first = (envelope as Array<{ text?: string }>)[0];
  if (!first?.text) {
    throw new Error("Invalid Pipeboard envelope: missing first text payload");
  }

  return parsePipeboardInsightsPayload(JSON.parse(first.text), captureDate);
}
