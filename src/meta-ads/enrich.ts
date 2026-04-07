import type { ExperimentRecord } from "../types/experiment.js";
import { creativeCompleteness } from "./transform.js";

export interface CreativeResult {
  ad_id: string;
  status: string;
  creative?: {
    asset_feed_spec?: {
      bodies?: Array<{ text: string }>;
      titles?: Array<{ text: string }>;
      call_to_action_types?: string[];
      videos?: unknown[];
    };
    object_story_spec?: {
      link_data?: {
        message?: string;
        name?: string;
        call_to_action?: { type: string };
        image_hash?: string;
        picture?: string;
      };
      video_data?: {
        message?: string;
        title?: string;
        call_to_action?: { type: string };
      };
    };
  };
}

export interface ExtractedCreativeText {
  body?: string;
  title?: string;
  cta?: string;
  hasVideo: boolean;
}

export function extractCreativeText(result: CreativeResult): ExtractedCreativeText {
  const c = result.creative;
  if (!c) return { hasVideo: false };

  const afs = c.asset_feed_spec;
  const oss = c.object_story_spec;

  let body: string | undefined;
  let title: string | undefined;
  let cta: string | undefined;
  let hasVideo = false;

  if (afs) {
    body = afs.bodies?.[0]?.text;
    title = afs.titles?.[0]?.text;
    cta = afs.call_to_action_types?.[0];
    hasVideo = (afs.videos?.length ?? 0) > 0;
  }

  if (!body && oss) {
    const ld = oss.link_data;
    const vd = oss.video_data;
    body = ld?.message || vd?.message;
    title = ld?.name || vd?.title;
    cta = ld?.call_to_action?.type || vd?.call_to_action?.type;
    hasVideo = Boolean(vd || afs?.videos?.length);
  }

  return { body, title, cta, hasVideo };
}

export function enrichExperimentRecords(
  records: ExperimentRecord[],
  creativeResults: CreativeResult[],
): ExperimentRecord[] {
  const creativeMap = new Map<string, ExtractedCreativeText>();
  for (const result of creativeResults) {
    if (result.status === "success") {
      creativeMap.set(result.ad_id, extractCreativeText(result));
    }
  }

  return records.map((record) => {
    const snapshot = { ...(record.account_snapshot as Record<string, unknown>) };
    const adId = String(snapshot.ad_id);
    const creative = creativeMap.get(adId);

    if (!creative) {
      return record;
    }

    const creativeFields = {
      creative_body: creative.body,
      creative_title: creative.title,
      creative_cta: creative.cta,
      creative_image_url: creative.hasVideo ? undefined : "enriched:image",
      creative_video_url: creative.hasVideo ? "enriched:video" : undefined,
    };

    const format = creative.hasVideo ? "video" : "image";
    const parts = [`Ad "${record.solution.match(/^Ad "([^"]+)"/)?.[1] || "Unknown"}"`];
    if (creative.title) parts.push(`headline: "${creative.title}"`);
    if (creative.body) parts.push(`copy: "${creative.body.slice(0, 200)}"`);
    if (creative.cta) parts.push(`CTA: ${creative.cta}`);
    parts.push(`format: ${format}`);
    parts.push(
      `spend: $${Number(snapshot.spend).toFixed(2)}, ROAS: ${Number(snapshot.purchase_roas).toFixed(2)}, CTR: ${((Number(snapshot.clicks) / Number(snapshot.impressions)) * 100).toFixed(2)}%`,
    );

    return {
      ...record,
      solution: parts.join("; "),
      account_snapshot: {
        ...snapshot,
        creative_title: creative.title,
        creative_body: creative.body,
        creative_body_present: Boolean(creative.body),
        creative_cta: creative.cta,
        creative_format: format,
        creative_completeness: creativeCompleteness(creativeFields),
      },
    };
  });
}
