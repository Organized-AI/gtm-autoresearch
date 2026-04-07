/**
 * Meta Ads Transform Evaluator
 *
 * Tests: calculateScore, buildProblem, buildSolution, transformAdsToExperiments,
 * schema compliance, zero-spend filtering, score clamping.
 *
 * CLI: npx tsx evals/eval_meta_ads_transform.ts
 */

import { ExperimentRecordSchema } from "../src/types/experiment.js";
import {
  calculateScore,
  buildProblem,
  buildSolution,
  transformAdsToExperiments,
  generateDeterministicId,
  creativeCompleteness,
  normalizeScores,
  type MetaAdRaw,
  type CaptureMetadata,
} from "../src/meta-ads/transform.js";
import {
  inferObjective,
  parsePipeboardInsightsPayload,
} from "../src/meta-ads/extract.js";
import {
  enrichExperimentRecords,
  type CreativeResult,
} from "../src/meta-ads/enrich.js";
import { z } from "zod";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}`);
    failed++;
  }
}

function makeAd(overrides: Partial<MetaAdRaw> = {}): MetaAdRaw {
  return {
    ad_id: "123456",
    ad_name: "Test Ad",
    campaign_id: "camp_001",
    campaign_name: "Spring Sale",
    campaign_objective: "CONVERSIONS",
    adset_name: "Women 25-45",
    creative_body: "Shop our spring collection",
    creative_title: "Spring Sale - 20% Off",
    creative_cta: "SHOP_NOW",
    creative_image_url: "https://example.com/image.jpg",
    spend: 500,
    impressions: 25000,
    clicks: 750,
    ctr: 3.0,
    cpc: 0.67,
    purchases: 25,
    purchase_value: 2500,
    purchase_roas: 5.0,
    add_to_carts: 80,
    initiates_checkout: 40,
    ...overrides,
  };
}

function makeMeta(overrides: Partial<CaptureMetadata> = {}): CaptureMetadata {
  return {
    account_id: "act_645790768357540",
    account_name: "HRE Beauty",
    capture_date: "2026-04-07",
    date_range: "2026-03-08 to 2026-04-07",
    total_spend: 51000,
    total_purchases: 1200,
    campaign_count: 5,
    active_ad_count: 20,
    ...overrides,
  };
}

// ── Test: calculateScore ────────────────────────────────────────────────────

console.log("\n=== calculateScore ===\n");

{
  const zeroSpend = makeAd({ spend: 0 });
  assert(calculateScore(zeroSpend) === 0, "Zero-spend ads score 0");
}

{
  const zeroImpressions = makeAd({ impressions: 0 });
  assert(calculateScore(zeroImpressions) === 0, "Zero-impression ads score 0");
}

{
  // ROAS=5 → 0.6, CTR=3 → 0.2, convRate=25/750=0.0333/0.05 → 0.667*0.2=0.133
  const excellent = makeAd({ purchase_roas: 5.0, ctr: 3.0, purchases: 25, clicks: 750 });
  const score = calculateScore(excellent);
  assert(score > 0.9, `Excellent metrics score > 0.9 (got ${score.toFixed(3)})`);
}

{
  // ROAS=10 → capped at 1*0.6, CTR=5 → capped at 1*0.2, convRate=0.1 → capped at 1*0.2
  const overMax = makeAd({ purchase_roas: 10, ctr: 5, purchases: 50, clicks: 500 });
  const score = calculateScore(overMax);
  assert(score === 1.0, `Over-max metrics clamp to 1.0 (got ${score.toFixed(3)})`);
}

{
  // ~1.0 ROAS (HRE average) should score low
  const average = makeAd({ purchase_roas: 1.0, ctr: 1.0, purchases: 5, clicks: 750 });
  const score = calculateScore(average);
  assert(score < 0.3, `Account-average metrics score < 0.3 (got ${score.toFixed(3)})`);
}

{
  const noClicks = makeAd({ clicks: 0, purchases: 0 });
  const score = calculateScore(noClicks);
  assert(score >= 0, "No clicks still produces non-negative score");
}

// ── Test: buildProblem ──────────────────────────────────────────────────────

console.log("\n=== buildProblem ===\n");

{
  const ad = makeAd({ campaign_objective: "CONVERSIONS", campaign_name: "Spring Sale" });
  const problem = buildProblem(ad);
  assert(problem.includes("CONVERSIONS"), "Problem includes objective");
  assert(problem.includes("Spring Sale"), "Problem includes campaign name");
  assert(problem.includes("HRE Beauty"), "Problem includes client name");
  assert(problem.includes("Women 25-45"), "Problem includes adset name");
}

// ── Test: buildSolution ─────────────────────────────────────────────────────

console.log("\n=== buildSolution ===\n");

{
  const ad = makeAd();
  const solution = buildSolution(ad);
  assert(solution.includes("Test Ad"), "Solution includes ad name");
  assert(solution.includes("Spring Sale - 20% Off"), "Solution includes headline");
  assert(solution.includes("Shop our spring collection"), "Solution includes copy");
  assert(solution.includes("SHOP_NOW"), "Solution includes CTA");
  assert(solution.includes("image"), "Solution includes format (image)");
}

{
  const videoAd = makeAd({ creative_video_url: "https://example.com/video.mp4", creative_image_url: undefined });
  const solution = buildSolution(videoAd);
  assert(solution.includes("video"), "Video ad solution shows video format");
}

{
  const minimalAd = makeAd({
    creative_title: undefined,
    creative_body: undefined,
    creative_cta: undefined,
    creative_image_url: undefined,
    creative_video_url: undefined,
  });
  const solution = buildSolution(minimalAd);
  assert(solution.includes("Test Ad"), "Minimal ad still includes ad name");
  assert(!solution.includes("headline"), "Minimal ad omits headline");
  assert(solution.includes("format: unknown"), "Minimal ad uses unknown format without creative media");
}

// ── Test: transformAdsToExperiments ─────────────────────────────────────────

console.log("\n=== transformAdsToExperiments ===\n");

{
  const ads = [makeAd(), makeAd({ spend: 0, ad_id: "zero" }), makeAd({ ad_id: "active2" })];
  const records = transformAdsToExperiments(ads, makeMeta());
  assert(records.length === 2, "Filters out zero-spend ads (3 input → 2 output)");
}

{
  const ads = [makeAd()];
  const records = transformAdsToExperiments(ads, makeMeta());
  const rec = records[0];
  assert(rec.client_id === "hre", "client_id is 'hre'");
  assert(rec.run_id.startsWith("meta-ads-"), "run_id starts with 'meta-ads-'");
  assert(rec.sources_used.includes("meta_ads"), "sources_used includes 'meta_ads'");
  assert(rec.sources_used.includes("pipeboard_mcp"), "sources_used includes 'pipeboard_mcp'");
}

{
  const ads = [makeAd()];
  const records = transformAdsToExperiments(ads, makeMeta());
  const result = ExperimentRecordSchema.safeParse(records[0]);
  assert(result.success, "Output record passes ExperimentRecordSchema.parse()");
  if (!result.success) {
    console.error("  Schema errors:", result.error.issues);
  }
}

{
  const ads = [makeAd()];
  const records = transformAdsToExperiments(ads, makeMeta());
  const snapshot = records[0].account_snapshot as Record<string, unknown>;
  assert(snapshot.account_id === "act_645790768357540", "account_snapshot includes account_id");
  assert(snapshot.total_spend === 51000, "account_snapshot includes total_spend");
  assert(snapshot.ad_id === "123456", "account_snapshot includes per-ad data");
}

{
  const ad = makeAd({ purchase_roas: 1.0, ctr: 1.0, purchases: 5, clicks: 750 });
  const records = transformAdsToExperiments([ad], makeMeta());
  assert(
    Math.abs(records[0].score - calculateScore(ad)) < 0.000001,
    "Top-level score remains the absolute calibrated score",
  );
}

// ── Test: generateDeterministicId ────────────────────────────────────────────

console.log("\n=== generateDeterministicId ===\n");

{
  const id1 = generateDeterministicId("ad_123", "2026-04-07");
  const id2 = generateDeterministicId("ad_123", "2026-04-07");
  assert(id1 === id2, "Same input → same UUID");
}

{
  const id1 = generateDeterministicId("ad_123", "2026-04-07");
  const id2 = generateDeterministicId("ad_456", "2026-04-07");
  assert(id1 !== id2, "Different ad_id → different UUID");
}

{
  const id1 = generateDeterministicId("ad_123", "2026-03-08 to 2026-04-07");
  const id2 = generateDeterministicId("ad_123", "2026-03-09 to 2026-04-08");
  assert(id1 !== id2, "Different date_range → different UUID");
}

{
  const id = generateDeterministicId("ad_123", "2026-03-08 to 2026-04-07");
  const result = z.string().uuid().safeParse(id);
  assert(result.success, "Output is a valid UUID");
}

// ── Test: creativeCompleteness ──────────────────────────────────────────────

console.log("\n=== creativeCompleteness ===\n");

{
  const full = makeAd({
    creative_body: "body",
    creative_title: "title",
    creative_cta: "CTA",
    creative_image_url: "https://example.com/img.jpg",
  });
  assert(creativeCompleteness(full) === 1.0, "Full creative → 1.0");
}

{
  const empty = makeAd({
    creative_body: undefined,
    creative_title: undefined,
    creative_cta: undefined,
    creative_image_url: undefined,
    creative_video_url: undefined,
  });
  assert(creativeCompleteness(empty) === 0.0, "Empty creative → 0.0");
}

{
  const partial = makeAd({
    creative_body: "body",
    creative_title: undefined,
    creative_cta: undefined,
    creative_image_url: undefined,
    creative_video_url: undefined,
  });
  assert(creativeCompleteness(partial) === 0.25, "One field → 0.25");
}

{
  const sparseAd = makeAd({
    creative_body: undefined,
    creative_title: undefined,
    creative_cta: undefined,
    creative_image_url: undefined,
    creative_video_url: undefined,
    purchase_roas: 5.0,
    ctr: 3.0,
    purchases: 25,
    clicks: 750,
  });
  const fullAd = makeAd({
    purchase_roas: 5.0,
    ctr: 3.0,
    purchases: 25,
    clicks: 750,
  });
  const sparseScore = calculateScore(sparseAd);
  const fullScore = calculateScore(fullAd);
  assert(Math.abs(sparseScore - fullScore) < 0.000001, "Creative sparsity does not change absolute score");
}

// ── Test: normalizeScores ───────────────────────────────────────────────────

console.log("\n=== normalizeScores ===\n");

{
  const result = normalizeScores([]);
  assert(result.length === 0, "Empty array returns empty");
}

{
  const records = transformAdsToExperiments([makeAd()], makeMeta());
  const single = normalizeScores(records);
  assert(single.length === 1, "Single record returns single record");
  assert(single[0].score === records[0].score, "Single record normalization leaves top-level score unchanged");
}

{
  const rawRecords = [
    {
      id: z.string().uuid().parse(generateDeterministicId("low", "range-a")),
      client_id: "hre",
      run_id: "meta-ads-2026-04-07",
      problem: "p1",
      solution: "s1",
      score: 0.1,
      timestamp: new Date().toISOString(),
      account_snapshot: {},
      sources_used: ["meta_ads"],
    },
    {
      id: z.string().uuid().parse(generateDeterministicId("high", "range-a")),
      client_id: "hre",
      run_id: "meta-ads-2026-04-07",
      problem: "p2",
      solution: "s2",
      score: 0.9,
      timestamp: new Date().toISOString(),
      account_snapshot: {},
      sources_used: ["meta_ads"],
    },
  ];
  const normalized = normalizeScores(rawRecords);
  assert(normalized[0].score === 0.1, "Normalization preserves first top-level score");
  assert(normalized[1].score === 0.9, "Normalization preserves second top-level score");
}

{
  // Verify raw_score is preserved
  const ads = [
    makeAd({ ad_id: "a1", purchase_roas: 1.0, ctr: 1.0, purchases: 5, clicks: 750 }),
    makeAd({ ad_id: "a2", purchase_roas: 5.0, ctr: 3.0, purchases: 25, clicks: 750 }),
  ];
  const records = transformAdsToExperiments(ads, makeMeta());
  for (const r of records) {
    const snap = r.account_snapshot as Record<string, unknown>;
    assert(typeof snap.raw_score === "number", `raw_score preserved in account_snapshot (ad ${snap.ad_id})`);
    assert(typeof snap.score_percentile === "number", `score_percentile preserved in account_snapshot (ad ${snap.ad_id})`);
  }
}

// ── Test: deterministic IDs in transformAdsToExperiments ────────────────────

console.log("\n=== Deterministic IDs (integration) ===\n");

{
  const ads = [makeAd({ ad_id: "dedup_test" })];
  const meta = makeMeta({ capture_date: "2026-04-07", date_range: "2026-03-08 to 2026-04-07" });
  const run1 = transformAdsToExperiments(ads, meta);
  const run2 = transformAdsToExperiments(ads, meta);
  assert(run1[0].id === run2[0].id, "Same ad + same date → same ID across runs");
}

{
  const ads = [makeAd({ ad_id: "dedup_test" })];
  const meta1 = makeMeta({ capture_date: "2026-04-07", date_range: "2026-03-08 to 2026-04-07" });
  const meta2 = makeMeta({ capture_date: "2026-04-08", date_range: "2026-03-08 to 2026-04-07" });
  const run1 = transformAdsToExperiments(ads, meta1);
  const run2 = transformAdsToExperiments(ads, meta2);
  assert(run1[0].id === run2[0].id, "Same ad + same date_range → same ID across capture dates");
}

// ── Test: extraction helpers ────────────────────────────────────────────────

console.log("\n=== extraction helpers ===\n");

{
  assert(inferObjective("HRE_Brand_Testing") === "TESTING", "inferObjective detects testing campaigns");
  assert(inferObjective("My Prospecting Campaign") === "PROSPECTING", "inferObjective detects prospecting campaigns");
}

{
  const parsed = parsePipeboardInsightsPayload({
    results: [
      {
        account_id: "act_1",
        account_name: "Test Account",
        insights: [
          {
            ad_id: "ad_video",
            ad_name: "My Amazing Video Ad",
            campaign_id: "camp_1",
            campaign_name: "Brand Campaign",
            adset_name: "Open Audience",
            spend: 100,
            impressions: 1000,
            clicks: 50,
            roas: 2,
            purchase_conversions: 3,
            date_start: "2026-03-08",
            date_stop: "2026-04-07",
          },
        ],
      },
    ],
  }, "2026-04-07");
  assert(parsed.ads[0].creative_video_url === undefined, "Extraction does not infer video media from ad name");
  assert(parsed.ads[0].creative_image_url === undefined, "Extraction does not infer image media from ad name");
}

// ── Test: enrichment helpers ────────────────────────────────────────────────

console.log("\n=== enrichment helpers ===\n");

{
  const records = transformAdsToExperiments([
    makeAd({
      ad_id: "enrich_1",
      creative_body: undefined,
      creative_title: undefined,
      creative_cta: undefined,
      creative_image_url: undefined,
      creative_video_url: undefined,
    }),
  ], makeMeta());
  const creativeResults: CreativeResult[] = [
    {
      ad_id: "enrich_1",
      status: "success",
      creative: {
        object_story_spec: {
          video_data: {
            message: "Video body",
            title: "Video title",
            call_to_action: { type: "SHOP_NOW" },
          },
        },
      },
    },
  ];
  const enriched = enrichExperimentRecords(records, creativeResults);
  const snapshot = enriched[0].account_snapshot as Record<string, unknown>;
  assert(enriched[0].solution.includes("headline: \"Video title\""), "Enrichment updates solution text");
  assert(snapshot.creative_title === "Video title", "Enrichment updates account_snapshot title");
  assert(snapshot.creative_format === "video", "Enrichment updates account_snapshot format");
  assert(snapshot.creative_body_present === true, "Enrichment updates account_snapshot body presence");
}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
