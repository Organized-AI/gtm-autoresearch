// Scores one container with the repo's own evaluator and prints JSON.
// The box never reimplements scoring: every number it reports comes from
// evals/eval_gtm_signal_quality.ts, the same file the loop uses.
//   npx tsx box/checks/score.ts <container.json> [enriched-snapshot.json]
import { readFileSync } from "node:fs";
import { evaluateGtmSignalQuality } from "../../evals/eval_gtm_signal_quality.ts";

const [containerPath, snapshotPath] = process.argv.slice(2);
const container = JSON.parse(readFileSync(containerPath, "utf8"));
const snapshot = snapshotPath ? JSON.parse(readFileSync(snapshotPath, "utf8")) : undefined;
const r = evaluateGtmSignalQuality(container, snapshot);
process.stdout.write(JSON.stringify({
  combinedScore: r.combinedScore,
  dimensions: r.dimensions.map((d) => ({
    name: d.name,
    weight: d.weight,
    score: d.score,
    errors: d.issues.filter((i) => i.severity === "error").map((i) => ({ entity: i.entity, message: i.message })),
    warnings: d.issues.filter((i) => i.severity === "warning").length,
  })),
}));
