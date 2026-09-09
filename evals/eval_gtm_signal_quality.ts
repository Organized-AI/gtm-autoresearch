import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateGtmSignalQuality, type GtmContainer, type EnrichedAdsSnapshot, type MetaAdsSnapshot } from "../src/evaluator.js";
export * from "../src/evaluator.js";

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse --enriched-snapshot flag (new, preferred)
  const enrichedFlagIdx = args.indexOf("--enriched-snapshot");
  let enrichedSnapshotPath: string | undefined;
  if (enrichedFlagIdx !== -1) {
    enrichedSnapshotPath = args[enrichedFlagIdx + 1];
    args.splice(enrichedFlagIdx, 2);
  }

  // Parse --meta-snapshot flag (legacy compat)
  const metaFlagIdx = args.indexOf("--meta-snapshot");
  let metaSnapshotPath: string | undefined;
  if (metaFlagIdx !== -1) {
    metaSnapshotPath = args[metaFlagIdx + 1];
    args.splice(metaFlagIdx, 2);
  }

  const filePath = args[0];
  if (!filePath) {
    console.error("Usage: npx tsx evals/eval_gtm_signal_quality.ts <container.json> [--enriched-snapshot <enriched.json>] [--meta-snapshot <snapshot.json>]");
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  const raw = await readFile(absPath, "utf-8");
  const container: GtmContainer = JSON.parse(raw);

  let snapshot: EnrichedAdsSnapshot | MetaAdsSnapshot | undefined;

  if (enrichedSnapshotPath) {
    const enrichedRaw = await readFile(path.resolve(enrichedSnapshotPath), "utf-8");
    const enriched = JSON.parse(enrichedRaw) as EnrichedAdsSnapshot;
    console.log(`[Enriched] Loaded: meta=${!!enriched.meta}, google_ads=${!!enriched.google_ads}, funnel_steps=${enriched.funnel.length}`);
    if (enriched.meta) {
      console.log(`[Enriched] Meta: ${enriched.meta.account_name} (${enriched.meta.conversion_events.length} events)`);
    }
    if (enriched.google_ads) {
      console.log(`[Enriched] Google Ads: ${enriched.google_ads.customer_name} (${enriched.google_ads.conversion_actions.length} actions)`);
    }
    snapshot = enriched;
  } else if (metaSnapshotPath) {
    const metaRaw = await readFile(path.resolve(metaSnapshotPath), "utf-8");
    const metaSnapshot = JSON.parse(metaRaw) as MetaAdsSnapshot;
    console.log(`[Meta] Loaded snapshot: ${metaSnapshot.account_name} (${metaSnapshot.conversion_events.length} events)`);
    snapshot = metaSnapshot;
  }

  const result = evaluateGtmSignalQuality(container, snapshot);

  console.log("\n=== GTM Signal Quality Eval ===\n");
  console.log(`Container: ${absPath}`);
  console.log(`Tags: ${result.tagCount} | Triggers: ${result.triggerCount} | Variables: ${result.variableCount} | Folders: ${result.folderCount}`);
  console.log(`\nCombined Score: ${(result.combinedScore * 100).toFixed(1)}%\n`);

  for (const dim of result.dimensions) {
    const bar = "█".repeat(Math.round(dim.score * 20)).padEnd(20, "░");
    console.log(
      `  ${dim.name.padEnd(22)} ${bar} ${(dim.score * 100).toFixed(0).padStart(3)}% (w=${dim.weight})`,
    );
  }

  if (result.issues.length > 0) {
    console.log(`\nIssues (${result.issues.length}):\n`);
    const errors = result.issues.filter((i) => i.severity === "error");
    const warnings = result.issues.filter((i) => i.severity === "warning");
    const infos = result.issues.filter((i) => i.severity === "info");

    for (const issue of [...errors, ...warnings, ...infos]) {
      const sev = issue.severity === "error" ? "ERR" : issue.severity === "warning" ? "WRN" : "INF";
      console.log(`  [${sev}] ${issue.entity}: ${issue.message}`);
    }
  }

  console.log("");
}

// Only run CLI when executed directly (not when imported)
const isDirectRun = Boolean(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href);
if (isDirectRun) {
  main().catch((err) => {
    console.error("[EvalGTM] Error:", err.message);
    process.exit(1);
  });
}
