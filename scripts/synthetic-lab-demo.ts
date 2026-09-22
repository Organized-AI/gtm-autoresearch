/** Offline, no-provider evidence replay. Results must not be described as Jev accuracy. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSyntheticReplayRows } from "./synthetic-lab-adapter.js";
import { splitByGroup, assertGroupDisjoint, replayReport, exportJsonl } from "./jev-offline.js";

type Json = Record<string, unknown>;
const args = process.argv.slice(2);
const cutoffs: string[] = [];
let output: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--decision-time" && args[i + 1]) cutoffs.push(args[++i]);
  else if (args[i] === "--output" && args[i + 1]) output = args[++i];
  else throw new Error(`Unknown/incomplete argument: ${args[i]}`);
}
if (!cutoffs.length) cutoffs.push("2026-01-01T12:00:00Z", "2026-01-02T06:00:00Z", "2026-01-03T12:00:00Z");
const root = process.env.SYNTHETIC_GTM_LAB_PATH ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../synthetic-gtm-lab");
const rows = (await Promise.all(cutoffs.map(t => buildSyntheticReplayRows(root, t)))).flat();
const split = splitByGroup(rows); assertGroupDisjoint(split);
const summaries = rows.map((row, index) => {
  const observation = row.input.observation as Json, facts = observation.facts as Json;
  const containers = Object.values(facts.containers as Record<string, Json>);
  const active = containers.map(c => c.activeValidation as { valid: boolean; issues: string[] });
  const counts = facts.networkCounts as Array<{ failedRequests: number; deniedConsentRequests: number }>;
  return { row: index + 1, decisionTime: observation.decisionTime,
    shapeValid: active.every(c => c.valid), shapeIssues: active.flatMap(c => c.issues),
    changedEntities: containers.reduce((n, c) => n + (c.changedEntities as unknown[]).length, 0),
    visitorEvents: facts.visitorEvents, networkDeliveries: facts.networkDeliveries,
    availableSnapshots: (facts.availablePlatformSnapshots as unknown[]).length,
    failedRequests: counts.reduce((n, c) => n + c.failedRequests, 0),
    deniedConsentRequests: counts.reduce((n, c) => n + c.deniedConsentRequests, 0),
    mismatchedMetaPayloadIds: (facts.metaObservedPairing as Json).mismatchedPayloadEventIds,
    judgeStatus: row.prediction.status, proposedRoute: "review" };
});
const summary = {
  mode: "offline-evidence-only", providerCalls: 0, observations: rows.length,
  decisionTimes: cutoffs, lineageGroups: [...new Set(rows.map(r => r.provenance.lineageGroup))],
  splitCounts: Object.fromEntries(Object.entries(split).map(([key, value]) => [key, value.length])),
  evaluationReadiness: "Insufficient: one shared topology/lineage; no judge predictions or independently reviewed labels.",
  report: replayReport(rows.map(row => ({ ...row, route: "review" as const }))),
  measurements: summaries,
};
if (output) {
  const destination = path.resolve(output);
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination); // Fail on existing output; never overwrite an earlier replay.
  await writeFile(path.join(destination, "evidence.jsonl"), exportJsonl(rows));
  for (const [name, records] of Object.entries(split)) await writeFile(path.join(destination, `${name}.jsonl`), records.length ? exportJsonl(records) : "");
  await writeFile(path.join(destination, "report.json"), JSON.stringify(summary, null, 2) + "\n");
  const table = summaries.map(s => `| ${s.row} | ${s.decisionTime} | ${s.shapeValid ? "pass" : "fail"} | ${s.changedEntities} | ${s.failedRequests} | ${s.deniedConsentRequests} | ${s.mismatchedMetaPayloadIds} |`).join("\n");
  await writeFile(path.join(destination, "REPORT.md"), `# Synthetic evidence replay\n\n${rows.length} observations across ${cutoffs.length} decision times. No provider was called. Ground-truth labels were not read. All proposed routes remain review because no Jev judgment is available. These are deterministic measurements, not model predictions.\n\n${summary.evaluationReadiness}\n\n| Row | Decision time | Reference shape | Changed entities | Failed requests | Denied-consent requests | Meta ID mismatches |\n|---|---|---|---:|---:|---:|---:|\n${table}\n\nFull windowed platform metrics, entity changes and event counts are in evidence.jsonl. Only each row's input field is intended as model state; grouping and predictions remain separate.\n`);
  console.log(JSON.stringify({ output: destination, observations: rows.length, providerCalls: 0, splitCounts: summary.splitCounts, shapeFailures: summaries.filter(s => !s.shapeValid).length, evaluationReadiness: summary.evaluationReadiness }, null, 2));
} else console.log(JSON.stringify(summary, null, 2));
