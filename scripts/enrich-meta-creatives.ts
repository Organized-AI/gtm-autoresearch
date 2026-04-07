/**
 * Enrich Meta Ads experiment records with creative text from bulk_get_ad_creatives result files.
 *
 * Reads creative result files, extracts body/title/CTA, and updates the staging JSON.
 *
 * Usage: npx tsx scripts/enrich-meta-creatives.ts <creative-result-file...> --staging <staging-file>
 *   or:  npx tsx scripts/enrich-meta-creatives.ts <creative-result-file1> <file2> <file3> ...
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { ExperimentRecord } from "../src/types/experiment.js";
import {
  enrichExperimentRecords,
  extractCreativeText,
  type CreativeResult,
} from "../src/meta-ads/enrich.js";

const args = process.argv.slice(2);
const stagingIdx = args.indexOf("--staging");
let stagingFile = "data/signals/meta-ads-experiments.json";
let creativeFiles: string[];

if (stagingIdx >= 0) {
  stagingFile = args[stagingIdx + 1];
  creativeFiles = [...args.slice(0, stagingIdx), ...args.slice(stagingIdx + 2)];
} else {
  creativeFiles = args;
}

if (creativeFiles.length === 0) {
  console.error("Usage: npx tsx scripts/enrich-meta-creatives.ts <creative-result-file...> [--staging <file>]");
  process.exit(1);
}

// Parse all creative result files
const allCreativeResults: CreativeResult[] = [];
for (const cf of creativeFiles) {
  const raw = JSON.parse(readFileSync(cf, "utf-8"));
  const data = JSON.parse(raw[0].text);
  allCreativeResults.push(...data.results);
  console.log(`[Enrich] Loaded ${data.results.length} creatives from ${cf.split("/").pop()}`);
}
console.log(`[Enrich] Total creative results: ${allCreativeResults.length}`);

// Build lookup map
const creativeMap = new Map<string, ReturnType<typeof extractCreativeText>>();
let withText = 0;
for (const r of allCreativeResults) {
  if (r.status === "success") {
    const text = extractCreativeText(r);
    creativeMap.set(r.ad_id, text);
    if (text.body || text.title) withText++;
  }
}
console.log(`[Enrich] ${withText}/${allCreativeResults.length} have body or title text`);

const records: ExperimentRecord[] = JSON.parse(readFileSync(stagingFile, "utf-8"));
console.log(`[Enrich] Loaded ${records.length} experiment records from ${stagingFile}`);

const enrichedRecords = enrichExperimentRecords(records, allCreativeResults);
const enriched = enrichedRecords.filter((record, index) => record.solution !== records[index]?.solution).length;

console.log(`[Enrich] Enriched ${enriched}/${records.length} records with creative text`);

// Write back
writeFileSync(stagingFile, JSON.stringify(enrichedRecords, null, 2));
console.log(`[Enrich] Updated ${stagingFile}`);

// Show a sample
const sample = enrichedRecords.find((r) => r.solution.includes("headline:"));
if (sample) {
  console.log(`\n[Enrich] Sample enriched solution:`);
  console.log(`  ${sample.solution.slice(0, 300)}`);
}
