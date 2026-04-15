/**
 * GTM Autoresearch Loop
 *
 * Karpathy-style autonomous experimentation loop that optimizes GTM container
 * configurations via structural scoring + a two-tier Claude model strategy:
 *
 *   • Exploration (score < 0.92): Claude Sonnet — cheap, broad mutation coverage
 *   • Escalation  (score ≥ 0.92): Claude Opus 4.6 — deeper reasoning to squeeze
 *                                 the last points out of an already-good config
 *
 * Loop: score → build prompt → mutate via current model → validate → keep/revert
 *       → (on hitting ESCALATION_SCORE, swap Sonnet → Opus) → repeat
 *
 * Usage:
 *   npx tsx scripts/run-gtm-loop.ts [program.md path]
 *   npx tsx scripts/run-gtm-loop.ts   (defaults to DOCUMENTATION/loops/gtm-autoresearch/program.md)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateGtmSignalQuality,
  type GtmContainer,
  type GtmSignalQualityResult,
  type MetaAdsSnapshot,
} from "../evals/eval_gtm_signal_quality.js";
import {
  putSeedIfMissing,
  putRound,
  putManifest,
  type RoundRecord,
  type RunManifest,
} from "./lib/kv-store.js";

type EvalFn = (
  container: GtmContainer,
  meta?: MetaAdsSnapshot,
) => GtmSignalQualityResult;

async function loadEval(
  evalPath: string | undefined,
  clientId: string,
): Promise<EvalFn> {
  if (!evalPath) {
    console.log(
      `[${clientId}] No Eval path in program.md — falling back to base ecom eval`,
    );
    return evaluateGtmSignalQuality;
  }
  const absPath = path.resolve(PROJECT_ROOT, evalPath);
  try {
    const mod = await import(absPath);
    const fn = mod.default ?? mod.evaluate;
    if (typeof fn !== "function") {
      throw new Error(
        `Eval module at ${evalPath} has no default export or 'evaluate' function`,
      );
    }
    console.log(`[${clientId}] Eval: ${evalPath}`);
    return fn as EvalFn;
  } catch (err) {
    console.log(
      `[${clientId}] Eval load failed (${(err as Error).message}) — falling back to base ecom eval`,
    );
    return evaluateGtmSignalQuality;
  }
}

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const CLAUDE_PATH =
  process.env.CLAUDE_PATH ?? `${process.env.HOME}/.local/bin/claude`;
const MAX_ROUNDS = 30;
// Once combined score hits this, swap the mutation model from Sonnet → Opus 4.6
// to squeeze extra gains. Below this bar, Sonnet handles the exploration.
const ESCALATION_SCORE = 0.92;
// After escalation, plateau stop triggers once we hold ≥ ESCALATION_SCORE for
// PLATEAU_STREAK consecutive rounds without Opus finding further improvement.
const PLATEAU_STREAK = 3;
const MAX_REGRESSIONS = 3;
const MAX_JSON_FAILURES = 5;
const MUTATION_BUDGET = 3;

type MutationModel = "sonnet" | "opus";

// ── Types ────────────────────────────────────────────────────────────────────

interface ClientConfig {
  id: string;
  label: string;
  templatePath: string;
  metaSnapshotPath: string | undefined;
  evalPath: string | undefined;
}

interface ProgramConfig {
  clients: ClientConfig[];
  strategyOrder: string[];
  constraints: string[];
}

interface RoundResult {
  round: number;
  score: number;
  dimensions: Record<string, number>;
  issueCount: number;
  action: "improved" | "reverted" | "validation_fail" | "json_fail";
  mutationSummary: string;
}

// ── Parse program.md ─────────────────────────────────────────────────────────

function parseProgram(content: string): ProgramConfig {
  const clients: ClientConfig[] = [];
  const clientPattern = /- \*\*([^*]+)\*\* \(`([^`]+)`\)([\s\S]*?)(?=\n- \*\*|\n##|$)/g;
  let match: RegExpExecArray | null;
  while ((match = clientPattern.exec(content)) !== null) {
    const [, label, id, block] = match;
    const templateMatch = block.match(/Template:\s*`([^`]+)`/);
    const metaMatch = block.match(/Meta snapshot:\s*`([^`]+)`/);
    const evalMatch = block.match(/Eval:\s*`([^`]+)`/);
    if (templateMatch) {
      clients.push({
        id: id.trim(),
        label: label.trim(),
        templatePath: templateMatch[1],
        metaSnapshotPath: metaMatch?.[1],
        evalPath: evalMatch?.[1],
      });
    }
  }

  const strategyOrder = [
    "consent",
    "meta_coverage",
    "parameters",
    "deduplication",
    "naming",
    "folders",
  ];

  const constraints = [
    "never_remove_tags",
    "preserve_placeholders",
    "preserve_export_format",
    "unique_ids",
  ];

  return { clients, strategyOrder, constraints };
}

// ── Placeholder extraction ───────────────────────────────────────────────────

function extractPlaceholders(json: string): string[] {
  const matches = json.match(/%%[A-Z_]+%%/g) ?? [];
  return [...new Set(matches)];
}

// ── 3-tier validation gate ───────────────────────────────────────────────────

function validateMutation(
  mutated: unknown,
  original: GtmContainer,
  originalJson: string,
): { valid: boolean; reason: string } {
  // Tier 1: Valid JSON (handled by caller's JSON.parse)
  if (!mutated || typeof mutated !== "object") {
    return { valid: false, reason: "Not a valid object" };
  }

  const m = mutated as GtmContainer;

  // Tier 2: Has required GTM schema
  if (!m.exportFormatVersion) {
    return { valid: false, reason: "Missing exportFormatVersion" };
  }
  if (m.exportFormatVersion !== original.exportFormatVersion) {
    return { valid: false, reason: "exportFormatVersion changed" };
  }
  if (!m.containerVersion) {
    return { valid: false, reason: "Missing containerVersion" };
  }
  if (!Array.isArray(m.containerVersion.tag)) {
    return { valid: false, reason: "Missing containerVersion.tag array" };
  }
  if (!Array.isArray(m.containerVersion.trigger)) {
    return { valid: false, reason: "Missing containerVersion.trigger array" };
  }
  if (!Array.isArray(m.containerVersion.variable)) {
    return { valid: false, reason: "Missing containerVersion.variable array" };
  }

  // Tier 3: Invariant checks
  const mutatedJson = JSON.stringify(m);

  // Placeholder preservation
  const originalPlaceholders = extractPlaceholders(originalJson);
  const mutatedPlaceholders = extractPlaceholders(mutatedJson);
  for (const ph of originalPlaceholders) {
    if (!mutatedPlaceholders.includes(ph)) {
      return { valid: false, reason: `Placeholder ${ph} was removed` };
    }
  }

  // No tag removal
  const origTagIds = new Set(
    (original.containerVersion.tag ?? []).map((t) => t.tagId),
  );
  for (const id of origTagIds) {
    if (!m.containerVersion.tag!.some((t) => t.tagId === id)) {
      return { valid: false, reason: `Original tag ${id} was removed` };
    }
  }

  // No folder removal
  const origFolderIds = new Set(
    (original.containerVersion.folder ?? []).map((f) => f.folderId),
  );
  for (const id of origFolderIds) {
    if (!(m.containerVersion.folder ?? []).some((f) => f.folderId === id)) {
      return { valid: false, reason: `Original folder ${id} was removed` };
    }
  }

  // Unique tag IDs
  const tagIds = m.containerVersion.tag!.map((t) => t.tagId);
  if (new Set(tagIds).size !== tagIds.length) {
    return { valid: false, reason: "Duplicate tag IDs" };
  }

  // Unique trigger IDs
  const triggerIds = (m.containerVersion.trigger ?? []).map((t) => t.triggerId);
  if (new Set(triggerIds).size !== triggerIds.length) {
    return { valid: false, reason: "Duplicate trigger IDs" };
  }

  // Unique variable IDs
  const varIds = (m.containerVersion.variable ?? []).map((v) => v.variableId);
  if (new Set(varIds).size !== varIds.length) {
    return { valid: false, reason: "Duplicate variable IDs" };
  }

  return { valid: true, reason: "OK" };
}

// ── JSON Patch (RFC 6902, subset: add + replace only) ────────────────────────

interface JsonPatchOp {
  op: "add" | "replace";
  path: string;
  value: unknown;
}

function parseJsonPointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`Invalid JSON Pointer (must start with '/'): ${pointer}`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function navigate(
  doc: unknown,
  parts: string[],
): { parent: unknown; key: string | number } {
  let parent: unknown = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (Array.isArray(parent)) {
      parent = parent[parseInt(p, 10)];
    } else if (parent && typeof parent === "object") {
      parent = (parent as Record<string, unknown>)[p];
    } else {
      throw new Error(`Path traversal hit non-object at segment "${p}"`);
    }
    if (parent === undefined) {
      throw new Error(`Path not found: segment "${p}"`);
    }
  }
  const last = parts[parts.length - 1];
  const key = Array.isArray(parent) && last !== "-" ? parseInt(last, 10) : last;
  return { parent, key };
}

function applyJsonPatch(doc: unknown, ops: JsonPatchOp[]): unknown {
  const result = structuredClone(doc);
  for (const op of ops) {
    if (op.op !== "add" && op.op !== "replace") {
      throw new Error(`Unsupported patch op: ${op.op}`);
    }
    const parts = parseJsonPointer(op.path);
    if (parts.length === 0) {
      throw new Error("Empty patch path not allowed (would replace whole doc)");
    }
    const { parent, key } = navigate(result, parts);
    if (Array.isArray(parent)) {
      if (key === "-") {
        parent.push(op.value);
      } else if (typeof key === "number") {
        if (op.op === "add") parent.splice(key, 0, op.value);
        else parent[key] = op.value;
      }
    } else if (parent && typeof parent === "object") {
      (parent as Record<string, unknown>)[key as string] = op.value;
    } else {
      throw new Error(`Cannot apply op at path ${op.path}`);
    }
  }
  return result;
}

// Reject patches that target invariants we protect
function preValidatePatch(ops: JsonPatchOp[]): { valid: boolean; reason: string } {
  const forbidden = [
    /^\/exportFormatVersion/,
    /^\/containerVersion\/container\/accountId/,
    /^\/containerVersion\/container\/containerId/,
    /^\/containerVersion\/container\/publicId/,
  ];
  for (const op of ops) {
    for (const re of forbidden) {
      if (re.test(op.path)) {
        return {
          valid: false,
          reason: `patch op targets protected path: ${op.path}`,
        };
      }
    }
    // Replacing a full tag/trigger/variable/folder array wholesale is forbidden
    // (risks removing existing entities).
    if (
      op.op === "replace" &&
      /^\/containerVersion\/(tag|trigger|variable|folder)$/.test(op.path)
    ) {
      return {
        valid: false,
        reason: `patch tries to replace full ${op.path} array (would remove entities)`,
      };
    }
  }
  return { valid: true, reason: "OK" };
}

// ── Build mutation prompt (JSON Patch mode, right-sized) ─────────────────────

function summarizeTag(i: number, t: GtmContainer["containerVersion"]["tag"] extends (infer U)[] | undefined ? U : never): string {
  const consent = t.consentSettings?.consentStatus ?? "NOT_SET";
  const folder = t.parentFolderId ?? "-";
  return `  [${i}] ${t.tagId} "${t.name}" type=${t.type} consent=${consent} folder=${folder}`;
}

function buildMutationPrompt(
  container: GtmContainer,
  scores: GtmSignalQualityResult,
  round: number,
  strategy: string,
  consecutiveJsonFails: number,
): string {
  const tags = container.containerVersion.tag ?? [];
  const triggers = container.containerVersion.trigger ?? [];
  const variables = container.containerVersion.variable ?? [];
  const folders = container.containerVersion.folder ?? [];

  const dimSummary = scores.dimensions
    .map(
      (d) =>
        `  ${d.name}: ${(d.score * 100).toFixed(0)}% (weight ${d.weight})`,
    )
    .join("\n");

  const errors = scores.issues.filter((i) => i.severity === "error");
  const warnings = scores.issues.filter((i) => i.severity === "warning");
  const topIssues = errors
    .slice(0, 10)
    .map((i) => `  [error] ${i.entity}: ${i.message}`)
    .join("\n");
  const warningIssues = warnings
    .slice(0, 5)
    .map((i) => `  [warning] ${i.entity}: ${i.message}`)
    .join("\n");

  const smallerScope =
    consecutiveJsonFails >= 3
      ? "\nIMPORTANT: Previous mutations had JSON errors. Output ONLY 1 patch operation this round.\n"
      : "";

  // Compact index tables — one line per entity, just enough to locate by path
  const tagIndex = tags.map((t, i) => summarizeTag(i, t)).join("\n");
  const triggerIndex = triggers
    .map((t, i) => `  [${i}] ${t.triggerId} "${t.name}" type=${t.type}`)
    .join("\n");
  const variableIndex = variables
    .map((v, i) => `  [${i}] ${v.variableId} "${v.name}" type=${v.type}`)
    .join("\n");
  const folderIndex = folders
    .map((f, i) => `  [${i}] ${f.folderId} "${f.name}"`)
    .join("\n");

  // Select entities referenced by the top errors — include full JSON so the
  // model can read current param shapes and know how to mutate them
  const errorEntityNames = new Set(errors.slice(0, 20).map((i) => i.entity));
  const referencedTags = tags
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => errorEntityNames.has(t.name))
    .slice(0, 10);

  // If strategy is consent, also include tags missing consentStatus=NEEDED
  const tagsMissingConsent =
    strategy === "consent" || strategy === "consentSettings"
      ? tags
          .map((t, i) => ({ t, i }))
          .filter(
            ({ t }) =>
              !t.consentSettings ||
              t.consentSettings.consentStatus !== "NEEDED",
          )
          .slice(0, 8)
      : [];

  const relevantTagBlocks = [
    ...referencedTags,
    ...tagsMissingConsent.filter(
      ({ i }) => !referencedTags.some((r) => r.i === i),
    ),
  ]
    .slice(0, 12)
    .map(
      ({ t, i }) =>
        `### Tag index ${i} (path prefix: /containerVersion/tag/${i})\n${JSON.stringify(t, null, 2)}`,
    )
    .join("\n\n");

  // Schema examples (one of each) so the model can mirror existing shape
  const schemaExamples = [
    tags[0] &&
      `### Tag schema example (index 0):\n${JSON.stringify(tags[0], null, 2)}`,
    triggers[0] &&
      `### Trigger schema example (index 0):\n${JSON.stringify(triggers[0], null, 2)}`,
    variables[0] &&
      `### Variable schema example (index 0):\n${JSON.stringify(variables[0], null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const containerMeta = container.containerVersion.container as
    | { publicId?: string; accountId?: string; containerId?: string }
    | undefined;

  return `You are optimizing a Google Tag Manager container by producing JSON Patch operations (RFC 6902).
Round ${round}. Current score: ${(scores.combinedScore * 100).toFixed(1)}%.
${smallerScope}
## Container
- exportFormatVersion: ${container.exportFormatVersion}
- publicId: ${containerMeta?.publicId ?? "?"}
- counts: tag=${tags.length}, trigger=${triggers.length}, variable=${variables.length}, folder=${folders.length}

## Current scores
${dimSummary}

## Priority errors
${topIssues || "  none"}

## Warnings
${warningIssues || "  none"}

## Strategy focus: ${strategy}

## Output format — CRITICAL

Output ONLY a JSON array of patch operations. Nothing else. No markdown fences. No commentary. No prose, no "insight" blocks.
Each op shape: {"op": "add" | "replace", "path": "/json/pointer", "value": ...}

Example — add a consent init tag at the end of the tag array:
[{"op":"add","path":"/containerVersion/tag/-","value":{"tagId":"9001","name":"CMP - Consent Mode Init","type":"cm","parameter":[{"type":"TEMPLATE","key":"command","value":"init"}],"firingTriggerId":["2147479553"]}}]

Example — set consentStatus=NEEDED on the tag at index 5:
[{"op":"replace","path":"/containerVersion/tag/5/consentSettings","value":{"consentStatus":"NEEDED"}}]

## Rules

- Output ONLY the JSON patch array
- Only "add" and "replace" are supported. "remove" is FORBIDDEN
- Never target /exportFormatVersion, /containerVersion/container/accountId, /containerVersion/container/containerId, or /containerVersion/container/publicId
- Never replace full /containerVersion/tag, /trigger, /variable, or /folder arrays
- Append with path ending "/-" (e.g. "/containerVersion/tag/-")
- Max ${MUTATION_BUDGET} ops per round
- Preserve all %%PLACEHOLDER%% tokens
- New entity IDs (tagId/triggerId/variableId/folderId) should be above 9000 to avoid collision

## Tag index (${tags.length})
${tagIndex}

## Trigger index (${triggers.length})
${triggerIndex}

## Variable index (${variables.length})
${variableIndex}

## Folder index (${folders.length})
${folderIndex || "  (none)"}

## Schema examples

${schemaExamples}

${relevantTagBlocks ? "## Entities referenced by current errors\n\n" + relevantTagBlocks : ""}`;
}

// ── Call Claude (Sonnet for exploration, Opus 4.6 for escalation) ───────────

// Maps our internal model tag to the exact `--model` alias the claude CLI expects.
// Sonnet = default exploration model. Opus 4.6 kicks in after ESCALATION_SCORE.
const MODEL_CLI_ALIAS: Record<MutationModel, string> = {
  sonnet: "sonnet",
  opus: "claude-opus-4-6",
};

function callModel(prompt: string, model: MutationModel): string | null {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  const cliModel = MODEL_CLI_ALIAS[model];
  const label = model === "opus" ? "Opus" : "Sonnet";

  const result = spawnSync(
    CLAUDE_PATH,
    ["-p", "--output-format", "text", "--model", cliModel, prompt],
    {
      encoding: "utf-8",
      timeout: 180000,
      maxBuffer: 5 * 1024 * 1024,
      env,
    },
  );

  // CLI may exit non-zero due to session-end hook failures even when the
  // model's response is intact in stdout. Trust stdout if it's non-empty.
  const stdout = result.stdout ?? "";
  if (stdout.trim().length > 0) {
    if (result.status !== 0) {
      console.log(
        `  [${label}] CLI exit ${result.status} (hook error) but stdout present — using it`,
      );
    }
    return stdout;
  }

  console.log(`  [${label}] CLI error (no stdout): ${result.stderr?.slice(0, 200)}`);
  return null;
}

// ── Determine strategy focus ─────────────────────────────────────────────────

function pickStrategy(scores: GtmSignalQualityResult): string {
  // Pick the lowest-scoring dimension with errors
  const withErrors = scores.dimensions.filter((d) => d.issues.some((i) => i.severity === "error"));
  if (withErrors.length > 0) {
    withErrors.sort((a, b) => a.score - b.score);
    return withErrors[0].name;
  }

  // Otherwise pick lowest scoring dimension
  const sorted = [...scores.dimensions].sort((a, b) => a.score - b.score);
  return sorted[0].name;
}

// ── Per-client loop ──────────────────────────────────────────────────────────

interface ClientSummary {
  client: ClientConfig;
  skipped: boolean;
  reason?: string;
  rounds?: number;
  startScore?: number;
  bestScore?: number;
  finalScore?: number;
  improved?: number;
  reverted?: number;
  valFails?: number;
  jsonFails?: number;
}

async function runClient(client: ClientConfig): Promise<ClientSummary> {
  const banner = "█".repeat(60);
  console.log(`\n${banner}`);
  console.log(`█  CLIENT: ${client.label} (${client.id})`.padEnd(60, " "));
  console.log(`${banner}\n`);

  const templatePath = path.resolve(PROJECT_ROOT, client.templatePath);

  // Check template exists — skip client if missing
  let seedJson: string;
  try {
    seedJson = await readFile(templatePath, "utf-8");
  } catch (err) {
    const reason = `Template not found at ${client.templatePath}`;
    console.log(`[${client.id}] SKIP — ${reason}`);
    console.log(`[${client.id}] ${(err as Error).message}`);
    return { client, skipped: true, reason };
  }

  // Load optional Meta Ads snapshot
  let metaSnapshot: MetaAdsSnapshot | undefined;
  if (client.metaSnapshotPath) {
    const metaPath = path.resolve(PROJECT_ROOT, client.metaSnapshotPath);
    try {
      const metaRaw = await readFile(metaPath, "utf-8");
      metaSnapshot = JSON.parse(metaRaw) as MetaAdsSnapshot;
      console.log(
        `[${client.id}] Meta Ads snapshot: ${metaSnapshot.account_name} (${metaSnapshot.conversion_events.length} events)`,
      );
    } catch (err) {
      console.log(
        `[${client.id}] Meta snapshot unreadable — proceeding with structural-only scoring`,
      );
    }
  }

  console.log(`[${client.id}] Template: ${templatePath}`);
  console.log(`[${client.id}] Max rounds: ${MAX_ROUNDS}`);
  console.log(
    `[${client.id}] Escalation (Sonnet → Opus 4.6) at ≥ ${(ESCALATION_SCORE * 100).toFixed(0)}%`,
  );

  const evaluate = await loadEval(client.evalPath, client.id);

  const seed: GtmContainer = JSON.parse(seedJson);
  let working: GtmContainer = JSON.parse(seedJson);
  let workingJson = seedJson;

  // Generate run ID and seed KV (no-op if seed already uploaded for this client)
  const runId = new Date().toISOString().slice(0, 19).replace(/:/g, "");
  const runStartIso = new Date().toISOString();
  try {
    const status = await putSeedIfMissing(client.id, seed);
    console.log(`[${client.id}] KV seed: ${status}`);
    console.log(`[${client.id}] KV runId: ${runId}`);
  } catch (err) {
    console.log(
      `[${client.id}] KV seed put failed (${(err as Error).message}) — continuing without KV`,
    );
  }
  console.log();

  const results: RoundResult[] = [];
  let plateauCount = 0;
  let regressionCount = 0;
  let consecutiveJsonFails = 0;
  let bestScore = 0;
  let bestJson = seedJson;
  let prevScore = 0;
  // Start every client on Sonnet — Opus only gets called after escalation.
  let currentModel: MutationModel = "sonnet";
  const seedScore = evaluate(seed, metaSnapshot).combinedScore;

  // Helper: push to in-memory results AND mirror to KV as a single call site.
  // KV failures are non-fatal — warn and continue.
  async function recordRound(
    roundResult: RoundResult,
    patch: JsonPatchOp[] | null,
    scoreAfter: number | null,
  ): Promise<void> {
    results.push(roundResult);
    try {
      const kvRecord: RoundRecord = {
        round: roundResult.round,
        action: roundResult.action,
        patch,
        scoreBefore: prevScore,
        scoreAfter,
        dimensions: roundResult.dimensions,
        timestamp: new Date().toISOString(),
        mutationSummary: roundResult.mutationSummary,
      };
      await putRound(client.id, runId, kvRecord);
    } catch (err) {
      console.log(
        `  [KV] putRound round ${roundResult.round} failed: ${(err as Error).message}`,
      );
    }
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`[${client.id}] ROUND ${round}/${MAX_ROUNDS}`);
    console.log(`${"═".repeat(60)}`);

    // Score current state
    const scores = evaluate(working, metaSnapshot);

    console.log(
      `[Score] Combined: ${(scores.combinedScore * 100).toFixed(1)}%`,
    );
    for (const dim of scores.dimensions) {
      const bar = "█".repeat(Math.round(dim.score * 10)).padEnd(10, "░");
      console.log(
        `  ${dim.name.padEnd(22)} ${bar} ${(dim.score * 100).toFixed(0).padStart(3)}%`,
      );
    }

    const errors = scores.issues.filter((i) => i.severity === "error");
    const warnings = scores.issues.filter((i) => i.severity === "warning");
    console.log(`[Issues] ${errors.length} errors, ${warnings.length} warnings`);

    // Track best
    if (scores.combinedScore > bestScore) {
      bestScore = scores.combinedScore;
      bestJson = workingJson;
    }

    // ── Escalation + stop conditions ──

    // First time we cross the escalation bar, swap Sonnet → Opus 4.6 so the
    // remaining rounds use a stronger model to squeeze out the last gains.
    // Plateau counting only begins once we're already on Opus — before that,
    // hitting 0.92 triggers escalation, not a stop.
    if (scores.combinedScore >= ESCALATION_SCORE) {
      if (currentModel === "sonnet") {
        currentModel = "opus";
        plateauCount = 0;
        console.log(
          `\n[Escalate] Score ${(scores.combinedScore * 100).toFixed(1)}% ≥ ${(ESCALATION_SCORE * 100).toFixed(0)}% — switching mutation model: Sonnet → Opus 4.6`,
        );
      } else {
        plateauCount++;
        if (plateauCount >= PLATEAU_STREAK) {
          console.log(
            `\n[Stop] PLATEAU at ${(bestScore * 100).toFixed(1)}% for ${PLATEAU_STREAK} rounds on Opus 4.6`,
          );
          break;
        }
      }
    } else {
      plateauCount = 0;
    }

    // Regression check
    if (round > 0 && scores.combinedScore < prevScore) {
      regressionCount++;
      if (regressionCount >= MAX_REGRESSIONS) {
        console.log(
          `\n[Stop] ${MAX_REGRESSIONS} consecutive regressions — stopping`,
        );
        break;
      }
    } else {
      regressionCount = 0;
    }

    prevScore = scores.combinedScore;

    // Perfect score
    if (scores.combinedScore >= 1.0) {
      console.log("\n[Stop] PERFECT SCORE");
      break;
    }

    // ── Mutate ──

    const strategy = pickStrategy(scores);
    console.log(`[Mutate] Strategy focus: ${strategy}`);

    const prompt = buildMutationPrompt(
      working,
      scores,
      round,
      strategy,
      consecutiveJsonFails,
    );

    const modelLabel = currentModel === "opus" ? "Claude Opus 4.6" : "Claude Sonnet";
    console.log(`[Mutate] Calling ${modelLabel}...`);
    const response = callModel(prompt, currentModel);

    if (!response) {
      console.log(`[Mutate] No response from ${modelLabel}`);
      consecutiveJsonFails++;
      results.push({
        round,
        score: scores.combinedScore,
        dimensions: Object.fromEntries(
          scores.dimensions.map((d) => [d.name, d.score]),
        ),
        issueCount: scores.issues.length,
        action: "json_fail",
        mutationSummary: `No response from ${modelLabel}`,
      });

      if (consecutiveJsonFails >= MAX_JSON_FAILURES) {
        console.log(`\n[Stop] ${MAX_JSON_FAILURES} consecutive JSON failures`);
        break;
      }
      continue;
    }

    // Parse response as JSON Patch array + apply to working
    let mutated: GtmContainer;
    let patchSummary = "";
    let appliedPatch: JsonPatchOp[] | null = null;
    try {
      // Strip fences, then extract the first top-level JSON array [...]
      let cleaned = response
        .replace(/^```(?:json)?\s*/m, "")
        .replace(/```\s*$/m, "")
        .trim();
      const firstBracket = cleaned.indexOf("[");
      const lastBracket = cleaned.lastIndexOf("]");
      if (firstBracket === -1 || lastBracket === -1 || lastBracket < firstBracket) {
        throw new Error("no JSON array found in response");
      }
      cleaned = cleaned.slice(firstBracket, lastBracket + 1);

      const ops = JSON.parse(cleaned) as JsonPatchOp[];
      if (!Array.isArray(ops)) {
        throw new Error("response is not an array of patch ops");
      }
      if (ops.length === 0) {
        throw new Error("empty patch array");
      }
      if (ops.length > MUTATION_BUDGET) {
        throw new Error(
          `${ops.length} patch ops exceeds MUTATION_BUDGET (${MUTATION_BUDGET})`,
        );
      }

      const pre = preValidatePatch(ops);
      if (!pre.valid) throw new Error(pre.reason);

      mutated = applyJsonPatch(working, ops) as GtmContainer;
      appliedPatch = ops;
      patchSummary = ops
        .map((o) => `${o.op} ${o.path}`)
        .join(" | ");
      console.log(`[Mutate] Applied ${ops.length} patch op(s): ${patchSummary}`);
      consecutiveJsonFails = 0;
    } catch (err) {
      console.log(`[Mutate] Patch failed: ${(err as Error).message}`);
      consecutiveJsonFails++;
      await recordRound(
        {
          round,
          score: scores.combinedScore,
          dimensions: Object.fromEntries(
            scores.dimensions.map((d) => [d.name, d.score]),
          ),
          issueCount: scores.issues.length,
          action: "json_fail",
          mutationSummary: `Patch failed: ${(err as Error).message}`,
        },
        null,
        null,
      );

      if (consecutiveJsonFails >= MAX_JSON_FAILURES) {
        console.log(`\n[Stop] ${MAX_JSON_FAILURES} consecutive patch failures`);
        break;
      }
      continue;
    }

    // Post-patch validation (invariants: placeholders preserved, no tag removal, unique IDs)
    const validation = validateMutation(mutated, seed, seedJson);
    if (!validation.valid) {
      console.log(`[Validate] REJECTED: ${validation.reason}`);
      await recordRound(
        {
          round,
          score: scores.combinedScore,
          dimensions: Object.fromEntries(
            scores.dimensions.map((d) => [d.name, d.score]),
          ),
          issueCount: scores.issues.length,
          action: "validation_fail",
          mutationSummary: `Validation failed: ${validation.reason} (patch: ${patchSummary})`,
        },
        appliedPatch,
        null,
      );
      continue;
    }

    // Re-score mutated version
    const mutatedScores = evaluate(mutated, metaSnapshot);
    console.log(
      `[Mutate] New score: ${(mutatedScores.combinedScore * 100).toFixed(1)}% ` +
        `(was ${(scores.combinedScore * 100).toFixed(1)}%)`,
    );

    if (mutatedScores.combinedScore > scores.combinedScore) {
      // Keep improvement
      console.log("[Mutate] IMPROVED — keeping mutation");
      working = mutated;
      workingJson = JSON.stringify(mutated, null, 2);
      await recordRound(
        {
          round,
          score: mutatedScores.combinedScore,
          dimensions: Object.fromEntries(
            mutatedScores.dimensions.map((d) => [d.name, d.score]),
          ),
          issueCount: mutatedScores.issues.length,
          action: "improved",
          mutationSummary: `Score ${(scores.combinedScore * 100).toFixed(1)}% → ${(mutatedScores.combinedScore * 100).toFixed(1)}%`,
        },
        appliedPatch,
        mutatedScores.combinedScore,
      );
    } else {
      // Revert
      console.log("[Mutate] No improvement — reverting");
      await recordRound(
        {
          round,
          score: scores.combinedScore,
          dimensions: Object.fromEntries(
            scores.dimensions.map((d) => [d.name, d.score]),
          ),
          issueCount: scores.issues.length,
          action: "reverted",
          mutationSummary: `${(mutatedScores.combinedScore * 100).toFixed(1)}% <= ${(scores.combinedScore * 100).toFixed(1)}%, reverted`,
        },
        appliedPatch,
        mutatedScores.combinedScore,
      );
    }
  }

  // ── Save winning config (per-client) ──

  const winningDir = path.join(
    PROJECT_ROOT,
    `content/clients/${client.id}/winning`,
  );
  await mkdir(winningDir, { recursive: true });
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "");
  const templateBasename = path.basename(
    client.templatePath,
    path.extname(client.templatePath),
  );
  const winningPath = path.join(
    winningDir,
    `${timestamp}-${templateBasename}.json`,
  );
  await writeFile(winningPath, bestJson);
  console.log(`\n[${client.id}] Winning config → ${winningPath}`);

  // ── Write experiment log (per-client) ──

  const logDir = path.join(
    PROJECT_ROOT,
    `DOCUMENTATION/loops/gtm-autoresearch/loop-results/${client.id}`,
  );
  await mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, `${timestamp}.json`);
  const improved = results.filter((r) => r.action === "improved").length;
  const reverted = results.filter((r) => r.action === "reverted").length;
  const valFails = results.filter((r) => r.action === "validation_fail").length;
  const jsonFails = results.filter((r) => r.action === "json_fail").length;
  await writeFile(
    logPath,
    JSON.stringify(
      {
        startTime: new Date().toISOString(),
        client: { id: client.id, label: client.label },
        templatePath: client.templatePath,
        metaSnapshotPath: client.metaSnapshotPath,
        rounds: results.length,
        bestScore,
        startScore: results[0]?.score ?? 0,
        finalScore: results[results.length - 1]?.score ?? 0,
        outcomes: { improved, reverted, valFails, jsonFails },
        results,
      },
      null,
      2,
    ),
  );
  console.log(`[${client.id}] Experiment log → ${logPath}`);

  // ── Write run manifest to KV ──
  try {
    const manifest: RunManifest = {
      runId,
      clientId: client.id,
      startTime: runStartIso,
      endTime: new Date().toISOString(),
      seedScore,
      bestScore,
      finalScore: results[results.length - 1]?.score ?? 0,
      totalRounds: results.length,
      outcomes: {
        improved,
        reverted,
        validationFails: valFails,
        jsonFails,
      },
      templatePath: client.templatePath,
      evalPath: client.evalPath,
    };
    await putManifest(client.id, runId, manifest);
    console.log(`[${client.id}] KV manifest → run:${client.id}:${runId}:manifest`);
  } catch (err) {
    console.log(
      `[${client.id}] KV manifest put failed (${(err as Error).message})`,
    );
  }

  // ── Per-client summary ──

  console.log(`\n--- ${client.label} (${client.id}) summary ---`);
  console.log(`Rounds: ${results.length}`);
  console.log(`Start score: ${((results[0]?.score ?? 0) * 100).toFixed(1)}%`);
  console.log(`Best score: ${(bestScore * 100).toFixed(1)}%`);
  console.log(
    `Final score: ${((results[results.length - 1]?.score ?? 0) * 100).toFixed(1)}%`,
  );
  console.log(
    `Outcomes: ${improved} improved, ${reverted} reverted, ${valFails} validation fails, ${jsonFails} JSON fails`,
  );

  return {
    client,
    skipped: false,
    rounds: results.length,
    startScore: results[0]?.score ?? 0,
    bestScore,
    finalScore: results[results.length - 1]?.score ?? 0,
    improved,
    reverted,
    valFails,
    jsonFails,
  };
}

// ── Main (iterates clients) ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const clientFlagIdx = args.indexOf("--client");
  let clientFilter: string | undefined;
  if (clientFlagIdx !== -1) {
    clientFilter = args[clientFlagIdx + 1];
    args.splice(clientFlagIdx, 2);
  }

  const programPath =
    args[0] ??
    path.join(PROJECT_ROOT, "DOCUMENTATION/loops/gtm-autoresearch/program.md");

  const absProgram = path.resolve(programPath);
  const programContent = await readFile(absProgram, "utf-8");
  const config = parseProgram(programContent);

  let clients = config.clients;
  if (clientFilter) {
    clients = config.clients.filter((c) => c.id === clientFilter);
    if (clients.length === 0) {
      console.error(
        `[GTMLoop] --client "${clientFilter}" matched no clients in program.md. Available: ${config.clients.map((c) => c.id).join(", ")}`,
      );
      process.exit(1);
    }
  }

  console.log("\n[GTMLoop] Starting GTM Autoresearch Loop");
  console.log(`[GTMLoop] Program: ${absProgram}`);
  console.log(`[GTMLoop] Clients: ${clients.map((c) => c.label).join(", ")}${clientFilter ? " (filtered by --client)" : ""}\n`);

  if (clients.length === 0) {
    console.error("[GTMLoop] No clients parsed from program.md — aborting");
    process.exit(1);
  }

  const summaries: ClientSummary[] = [];
  for (const client of clients) {
    const summary = await runClient(client);
    summaries.push(summary);
  }

  // ── Overall summary ──

  console.log(`\n${"═".repeat(60)}`);
  console.log("GTM Autoresearch Loop — All Clients Summary");
  console.log(`${"═".repeat(60)}`);
  for (const s of summaries) {
    if (s.skipped) {
      console.log(`  ✗ ${s.client.label.padEnd(15)} SKIPPED — ${s.reason}`);
    } else {
      console.log(
        `  ✓ ${s.client.label.padEnd(15)} ${((s.startScore ?? 0) * 100).toFixed(1)}% → ${((s.bestScore ?? 0) * 100).toFixed(1)}% (${s.rounds} rounds, ${s.improved} improved)`,
      );
    }
  }
}

main().catch((err) => {
  console.error("[GTMLoop] Error:", err.message);
  process.exit(1);
});
