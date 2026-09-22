#!/usr/bin/env npx tsx
/** Build a local GTM scored-export directory. Google Tag Manager has no bulk JSON-import API. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createScoredGtmExportFromFiles, type ExportSourceKind } from "./gtm-scored-export.js";

function argument(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
const container = argument("--container"); const output = argument("--output");
if (!container || !output) {
  console.error("Usage: npx tsx scripts/prepare-gtm-export.ts --container FILE --output DIRECTORY [--baseline FILE] [--enriched-snapshot FILE | --meta-snapshot FILE] [--source-kind saved-container|optimization-winner|synthetic-demo]");
  process.exit(1);
}
const enriched = argument("--enriched-snapshot"); const meta = argument("--meta-snapshot");
if (enriched && meta) { console.error("Specify at most one snapshot option."); process.exit(1); }
const sourceKind = (argument("--source-kind") ?? "saved-container") as ExportSourceKind;
if (!["saved-container", "optimization-winner", "synthetic-demo"].includes(sourceKind)) { console.error("Invalid --source-kind."); process.exit(1); }
const snapshotPath = enriched ?? meta;
const adsSnapshot = snapshotPath ? JSON.parse(await readFile(path.resolve(snapshotPath), "utf8")) : undefined;
const result = await createScoredGtmExportFromFiles({ containerPath: path.resolve(container), outputDir: path.resolve(output), baselinePath: argument("--baseline") ? path.resolve(argument("--baseline")!) : undefined, adsSnapshot, sourceKind });
console.log(JSON.stringify({ output: result.outputDir, validation: result.report.validation.status, readiness: result.report.readiness.status, score: result.report.scoring.candidate.combinedScore }, null, 2));
