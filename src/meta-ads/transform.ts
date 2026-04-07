/**
 * Meta Ads → ExperimentRecord transformer
 *
 * Converts raw Meta Ads campaign/creative data into ExperimentRecord format
 * for the fine-tune pipeline experiment logger.
 */

import { v5 as uuidv5 } from "uuid";
import type { ExperimentRecord } from "../types/experiment.js";

/** Namespace UUID for deterministic ID generation (RFC 4122 v5) */
const META_ADS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

/**
 * Generate a deterministic UUID from ad_id + date_range.
 * Same inputs always produce the same UUID → INSERT OR IGNORE deduplicates.
 */
export function generateDeterministicId(adId: string, dateRange: string): string {
  return uuidv5(`${adId}:${dateRange}`, META_ADS_NAMESPACE);
}

export interface MetaAdRaw {
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign_name: string;
  campaign_objective: string;
  adset_name: string;
  creative_body?: string;
  creative_title?: string;
  creative_cta?: string;
  creative_image_url?: string;
  creative_video_url?: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  purchases: number;
  purchase_value: number;
  purchase_roas: number;
  add_to_carts: number;
  initiates_checkout: number;
}

export interface CaptureMetadata {
  account_id: string;
  account_name: string;
  capture_date: string;
  date_range: string;
  total_spend: number;
  total_purchases: number;
  campaign_count: number;
  active_ad_count: number;
}

export interface CreativeFields {
  creative_body?: string;
  creative_title?: string;
  creative_cta?: string;
  creative_image_url?: string;
  creative_video_url?: string;
}

/**
 * Creative completeness: 0.0–1.0 based on presence of body, title, CTA, media URL.
 * Each field is worth 0.25.
 */
export function creativeCompleteness(ad: CreativeFields): number {
  let score = 0;
  if (ad.creative_body) score += 0.25;
  if (ad.creative_title) score += 0.25;
  if (ad.creative_cta) score += 0.25;
  if (ad.creative_image_url || ad.creative_video_url) score += 0.25;
  return score;
}

/**
 * Composite score: ROAS/5.0 (60%) + CTR/3.0 (20%) + convRate/0.05 (20%)
 * Clamped to 0–1. Zero-spend ads always score 0.
 */
export function calculateScore(ad: MetaAdRaw): number {
  if (ad.spend <= 0 || ad.impressions <= 0) return 0;

  const roasComponent = Math.min(ad.purchase_roas / 5.0, 1.0) * 0.6;
  const ctrComponent = Math.min(ad.ctr / 3.0, 1.0) * 0.2;

  const convRate = ad.clicks > 0 ? ad.purchases / ad.clicks : 0;
  const convComponent = Math.min(convRate / 0.05, 1.0) * 0.2;

  const raw = roasComponent + ctrComponent + convComponent;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Build the "problem" field describing the advertising objective.
 */
export function buildProblem(ad: MetaAdRaw): string {
  return `Drive ${ad.campaign_objective} for HRE Beauty via campaign "${ad.campaign_name}", ad set "${ad.adset_name}"`;
}

/**
 * Build the "solution" field describing the creative approach + performance.
 */
export function buildSolution(ad: MetaAdRaw): string {
  const format = ad.creative_video_url
    ? "video"
    : ad.creative_image_url
      ? "image"
      : "unknown";
  const parts = [`Ad "${ad.ad_name}"`];

  if (ad.creative_title) parts.push(`headline: "${ad.creative_title}"`);
  if (ad.creative_body) parts.push(`copy: "${ad.creative_body}"`);
  if (ad.creative_cta) parts.push(`CTA: ${ad.creative_cta}`);
  parts.push(`format: ${format}`);
  parts.push(`spend: $${ad.spend.toFixed(2)}, ROAS: ${ad.purchase_roas.toFixed(2)}, CTR: ${ad.ctr.toFixed(2)}%`);

  return parts.join("; ");
}

/**
 * Percentile-rank normalization stored as additive metadata.
 * Top-level score remains the absolute calibrated metric.
 */
export function normalizeScores(records: ExperimentRecord[]): ExperimentRecord[] {
  if (records.length === 0) return records;
  if (records.length === 1) {
    const [record] = records;
    return [
      {
        ...record,
        account_snapshot: {
          ...(record.account_snapshot as Record<string, unknown>),
          raw_score: record.score,
          score_percentile: 1,
          score_rank: 1,
        },
      },
    ];
  }

  // Sort by raw score to compute percentile ranks
  const indexed = records.map((r, i) => ({ record: r, rawScore: r.score, originalIndex: i }));
  indexed.sort((a, b) => a.rawScore - b.rawScore);

  // Assign percentile ranks (handle ties by averaging)
  const result = new Array<ExperimentRecord>(records.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].rawScore === indexed[i].rawScore) j++;
    const avgRank = (i + j - 1) / 2;
    const percentile = avgRank / (indexed.length - 1);
    for (let k = i; k < j; k++) {
      const { record, rawScore, originalIndex } = indexed[k];
      result[originalIndex] = {
        ...record,
        account_snapshot: {
          ...(record.account_snapshot as Record<string, unknown>),
          raw_score: rawScore,
          score_percentile: Math.max(0, Math.min(1, percentile)),
          score_rank: indexed.length - avgRank,
        },
      };
    }
    i = j;
  }
  return result;
}

/**
 * Transform raw Meta Ads data into ExperimentRecord[].
 * Filters out zero-spend ads and adds additive rank metadata.
 */
export function transformAdsToExperiments(
  ads: MetaAdRaw[],
  meta: CaptureMetadata,
): ExperimentRecord[] {
  const activeAds = ads.filter((ad) => ad.spend > 0);

  const raw = activeAds.map((ad) => ({
    id: generateDeterministicId(ad.ad_id, meta.date_range),
    client_id: "hre",
    run_id: `meta-ads-${meta.capture_date}`,
    problem: buildProblem(ad),
    solution: buildSolution(ad),
    score: calculateScore(ad),
    timestamp: new Date().toISOString(),
    account_snapshot: {
      account_id: meta.account_id,
      account_name: meta.account_name,
      date_range: meta.date_range,
      total_spend: meta.total_spend,
      total_purchases: meta.total_purchases,
      campaign_count: meta.campaign_count,
      active_ad_count: meta.active_ad_count,
      ad_id: ad.ad_id,
      campaign_id: ad.campaign_id,
      spend: ad.spend,
      impressions: ad.impressions,
      clicks: ad.clicks,
      purchases: ad.purchases,
      purchase_value: ad.purchase_value,
      purchase_roas: ad.purchase_roas,
      creative_completeness: creativeCompleteness(ad),
    },
    sources_used: ["meta_ads", "pipeboard_mcp"],
  }));

  return normalizeScores(raw);
}
