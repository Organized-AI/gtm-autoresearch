/**
 * Extract Meta Ads data from Pipeboard MCP result file and transform to ExperimentRecord[].
 *
 * Usage: npx tsx scripts/extract-meta-ads.ts <result-file> [output-file]
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  transformAdsToExperiments,
} from "../src/meta-ads/transform.js";
import { parsePipeboardResultEnvelope } from "../src/meta-ads/extract.js";

const resultFile = process.argv[2];
const outputFile = process.argv[3] || "data/signals/meta-ads-experiments.json";

if (!resultFile) {
  console.error("Usage: npx tsx scripts/extract-meta-ads.ts <result-file> [output-file]");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(resultFile, "utf-8"));
const { ads, meta, total_ads } = parsePipeboardResultEnvelope(raw);

console.log(`[MetaAds] Account: ${meta.account_name} (${meta.account_id})`);
console.log(`[MetaAds] Total ads in response: ${total_ads}`);

console.log(`[MetaAds] Active ads (spend > 0): ${meta.active_ad_count}`);
console.log(`[MetaAds] Zero-spend ads filtered: ${ads.length - meta.active_ad_count}`);
console.log(`[MetaAds] Total spend: $${meta.total_spend.toLocaleString()}`);
console.log(`[MetaAds] Total purchases: ${meta.total_purchases}`);
console.log(`[MetaAds] Campaigns: ${meta.campaign_count}`);

// Transform
const records = transformAdsToExperiments(ads, meta);

// Sort by score desc and show top 5
const sorted = [...records].sort((a, b) => b.score - a.score);
console.log(`\n[MetaAds] Top 5 ads by score:`);
for (const r of sorted.slice(0, 5)) {
  const snap = r.account_snapshot as Record<string, unknown>;
  console.log(`  ${r.score.toFixed(3)} | ROAS ${Number(snap.purchase_roas).toFixed(2)} | $${Number(snap.spend).toFixed(0)} spend | ${r.solution.split(";")[0]}`);
}

// Write output
writeFileSync(outputFile, JSON.stringify(records, null, 2));
console.log(`\n[MetaAds] Wrote ${records.length} records to ${outputFile}`);
