#!/usr/bin/env npx tsx
/** A bounded local hygiene benchmark. It never calls GTM, ads, or a provider. */
import { createHash } from "node:crypto";
import { open, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyOperations, validateCandidate, type MutationOp } from "./gtm-container-mutations.js";
import { createScoredGtmExport } from "./gtm-scored-export.js";
import { evaluateGtmSignalQuality, type GtmContainer } from "../evals/eval_gtm_signal_quality.js";

const ROOT = path.resolve(decodeURIComponent(new URL(".", import.meta.url).pathname), "..");
const BASELINE = path.join(ROOT, "content/gtm-templates/BLADE/seed/blade-web.json");
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const nowName = () => new Date().toISOString().replace(/[:.]/g, "-");
type State = { schemaVersion: "blade-daily-benchmark-v1"; baselineSha256: string; bestSha256: string; bestScore: number; exportDir: string; evidenceSha256: string | null; };

function nextFolderId(container: GtmContainer): string {
  const ids = (container.containerVersion.folder ?? []).map((folder) => Number(folder.folderId)).filter(Number.isInteger);
  return String((ids.length ? Math.max(...ids) : 0) + 1);
}
function safeTagName(container: GtmContainer, name: string): boolean {
  // Any other occurrence may be a setup/teardown/custom-template reference.
  return JSON.stringify(container).split(name).length === 2;
}
function platform(name: string): "GA4" | "Meta" | "Google Ads" | undefined {
  if (/ga4/i.test(name)) return "GA4";
  if (/meta|facebook/i.test(name)) return "Meta";
  if (/google|gads|ads|^aw_/i.test(name)) return "Google Ads";
  return undefined;
}
export function buildHygieneOperations(container: GtmContainer): MutationOp[] {
  const folders = container.containerVersion.folder ?? [];
  const folderIds = new Map(folders.map((folder) => [folder.name, folder.folderId]));
  const additions: MutationOp[] = [];
  let id = Number(nextFolderId(container));
  for (const name of ["GA4", "Meta", "Google Ads"]) if (!folderIds.has(name)) { folderIds.set(name, String(id++)); additions.push({ op: "add_folder", entity: { name } }); }
  const renames = (container.containerVersion.tag ?? []).flatMap((tag) => {
    if (/^\w[\w\d]*\s*-\s*.+/.test(tag.name) || !safeTagName(container, tag.name)) return [];
    const label = platform(tag.name) === "Google Ads" ? "GAds" : platform(tag.name) ?? "Tag";
    return [{ tagId: tag.tagId, newName: `${label} - ${tag.name}` }];
  });
  const assignments = (container.containerVersion.tag ?? []).flatMap((tag) => {
    const label = platform(/^\w[\w\d]*\s*-\s*(.+)$/.exec(tag.name)?.[1] ?? tag.name);
    const folderId = label ? folderIds.get(label) : undefined;
    return folderId && tag.parentFolderId !== folderId ? [{ tagId: tag.tagId, folderId }] : [];
  });
  return [...additions, ...(renames.length ? [{ op: "rename_tags", renames } as MutationOp] : []), ...(assignments.length ? [{ op: "assign_folders", assignments } as MutationOp] : [])];
}

async function atomicWrite(file: string, value: string | Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`; await writeFile(tmp, value); await rename(tmp, file);
}
export async function runDailyBenchmark(stateDir: string, evidencePath?: string): Promise<Record<string, unknown>> {
  await mkdir(stateDir, { recursive: true });
  const lockPath = path.join(stateDir, "run.lock");
  let lock;
  try { lock = await open(lockPath, "wx"); } catch { throw new Error(`Benchmark is already running for ${stateDir}`); }
  try {
    const baselineBytes = await readFile(BASELINE); const baselineSha256 = sha(baselineBytes);
    const baseline = JSON.parse(baselineBytes.toString("utf8")) as GtmContainer;
    const statePath = path.join(stateDir, "state.json");
    let state: State | undefined;
    try { state = JSON.parse(await readFile(statePath, "utf8")) as State; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (state && (state.schemaVersion !== "blade-daily-benchmark-v1" || state.baselineSha256 !== baselineSha256)) throw new Error("Saved benchmark state is bound to a different BLADE baseline; create a new --state-dir");
    const beforeBytes = state ? await readFile(path.join(state.exportDir, "container.json")) : baselineBytes;
    if (state && sha(beforeBytes) !== state.bestSha256) throw new Error("Saved benchmark export does not match state hash; refusing poisoned state");
    const before = JSON.parse(beforeBytes.toString("utf8")) as GtmContainer;
    const beforeScore = evaluateGtmSignalQuality(before).combinedScore;
    const operations = buildHygieneOperations(before);
    const evaluated: Array<{ operations: MutationOp[]; score: number; accepted: boolean; reason?: string }> = [];
    let accepted = false, candidate = before, candidateBytes = beforeBytes;
    const evidenceSha256 = evidencePath ? sha(await readFile(evidencePath)) : null;
    const evidenceChanged = evidenceSha256 !== (state?.evidenceSha256 ?? null);
    if (operations.length) {
      try {
        const proposed = applyOperations(before, operations); const policy = validateCandidate(before, proposed, operations);
        if (!policy.valid) throw new Error(policy.reason);
        const score = evaluateGtmSignalQuality(proposed).combinedScore;
        accepted = score > beforeScore; evaluated.push({ operations, score, accepted, reason: accepted ? undefined : "score did not improve" });
        if (accepted) { candidate = proposed; candidateBytes = Buffer.from(`${JSON.stringify(proposed, null, 2)}\n`); }
      } catch (error) { evaluated.push({ operations, score: beforeScore, accepted: false, reason: error instanceof Error ? error.message : String(error) }); }
    }
    const afterScore = evaluateGtmSignalQuality(candidate).combinedScore;
    const stamp = nowName(); const candidateSha256 = sha(candidateBytes);
    const exportDir = path.join(stateDir, "exports", `${stamp}-${candidateSha256.slice(0, 12)}`);
    const exported = await createScoredGtmExport({ containerBytes: candidateBytes, baselineBytes, outputDir: exportDir, sourceKind: "optimization-winner", sourceName: accepted ? "deterministic-offline-hygiene-candidate" : "carried-forward-best", createdAt: new Date().toISOString() });
    const next: State = { schemaVersion: "blade-daily-benchmark-v1", baselineSha256, bestSha256: candidateSha256, bestScore: afterScore, exportDir, evidenceSha256 };
    const history = { schemaVersion: "blade-daily-benchmark-v1", status: "deterministic offline hygiene benchmark", baselineSha256, evidence: evidencePath ? { sha256: evidenceSha256, changed: evidenceChanged } : null, before: { sha256: sha(beforeBytes), score: beforeScore }, after: { sha256: next.bestSha256, score: afterScore }, outcome: exported.report.readiness.status !== "ready-for-import-review" ? "needs-review" : accepted ? "improved" : "unchanged", acceptedOperations: accepted && exported.report.readiness.status === "ready-for-import-review" ? operations : [], evaluatedOperations: evaluated, exportDir, exportReadiness: exported.report.readiness.status, limitations: "No visitor, ads, GTM, provider, or behavioral evaluation was performed." };
    const historyDir = path.join(stateDir, "history"); await mkdir(historyDir, { recursive: true });
    await writeFile(path.join(historyDir, `${stamp}-${next.bestSha256.slice(0, 12)}.json`), `${JSON.stringify(history, null, 2)}\n`, { flag: "wx" });
    if (exported.report.readiness.status !== "ready-for-import-review") return history;
    await atomicWrite(path.join(stateDir, "best.json"), candidateBytes);
    await atomicWrite(statePath, `${JSON.stringify(next, null, 2)}\n`);
    return history;
  } finally { await lock?.close(); await rm(lockPath, { force: true }); }
}

async function main() { const stateDir = arg("--state-dir"); if (!stateDir) throw new Error("Usage: --state-dir DIR [--evidence FILE]"); console.log(JSON.stringify(await runDailyBenchmark(path.resolve(stateDir), arg("--evidence") ? path.resolve(arg("--evidence")!) : undefined), null, 2)); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`[daily-benchmark] ${error.message}`); process.exit(1); });
