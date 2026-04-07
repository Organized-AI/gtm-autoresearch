/**
 * GTM Autoresearch Loop
 *
 * Karpathy-style autonomous experimentation loop that optimizes GTM container
 * configurations via structural scoring + Claude Haiku mutations.
 *
 * Loop: score → build prompt → mutate via Haiku → validate → keep/revert → repeat
 *
 * Usage:
 *   npx tsx scripts/run-gtm-loop.ts [program.md path]
 *   npx tsx scripts/run-gtm-loop.ts   (defaults to DOCUMENTATION/loops/gtm-autoresearch/program.md)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  evaluateGtmSignalQuality,
  type GtmContainer,
  type GtmSignalQualityResult,
  type GtmIssue,
  type MetaAdsSnapshot,
  type EnrichedAdsSnapshot,
} from "../evals/eval_gtm_signal_quality.js";

const PROJECT_ROOT = path.resolve(
  new URL(".", import.meta.url).pathname,
  "..",
);

const CLAUDE_PATH =
  process.env.CLAUDE_PATH ?? "/Users/jordaaan/.local/bin/claude";
const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS ?? "30", 10);
const PLATEAU_SCORE = 0.92;
const PLATEAU_STREAK = 3;
const MAX_REGRESSIONS = 3;
const MAX_JSON_FAILURES = 5;
const MUTATION_BUDGET = 3;

// ── Types ────────────────────────────────────────────────────────────────────

interface ProgramConfig {
  templatePath: string;
  metaSnapshotPath: string | undefined;
  enrichedSnapshotPath: string | undefined;
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
  const templateMatch = content.match(/Template file:\s*`([^`]+)`/);
  const templatePath = templateMatch?.[1] ?? "content/gtm-templates/shopify-ecom-web.json";

  const metaMatch = content.match(/Meta Ads snapshot:\s*`([^`]+)`/);
  const metaSnapshotPath = metaMatch?.[1];

  const enrichedMatch = content.match(/Enriched Ads snapshot:\s*`([^`]+)`/);
  const enrichedSnapshotPath = enrichedMatch?.[1];

  const strategyOrder = [
    "consent",
    "meta_coverage",
    "parameters",
    "deduplication",
    "naming",
    "folders",
    "capi_coverage",
    "google_ads_alignment",
  ];

  const constraints = [
    "never_remove_tags",
    "preserve_placeholders",
    "preserve_export_format",
    "unique_ids",
  ];

  return { templatePath, metaSnapshotPath, enrichedSnapshotPath, strategyOrder, constraints };
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

// ── Build mutation prompt ────────────────────────────────────────────────────

function buildMutationPrompt(
  container: GtmContainer,
  scores: GtmSignalQualityResult,
  round: number,
  strategy: string,
  consecutiveJsonFails: number,
): string {
  const dimSummary = scores.dimensions
    .map(
      (d) =>
        `  ${d.name}: ${(d.score * 100).toFixed(0)}% (weight ${d.weight})`,
    )
    .join("\n");

  const topIssues = scores.issues
    .filter((i) => i.severity === "error")
    .slice(0, 10)
    .map((i) => `  [${i.severity}] ${i.entity}: ${i.message}`)
    .join("\n");

  const warningIssues = scores.issues
    .filter((i) => i.severity === "warning")
    .slice(0, 5)
    .map((i) => `  [${i.severity}] ${i.entity}: ${i.message}`)
    .join("\n");

  const smallerScope = consecutiveJsonFails >= 3
    ? "\nIMPORTANT: Previous mutations had JSON errors. Make ONLY 1 small change this round.\n"
    : "";

  return `You are optimizing a Google Tag Manager container JSON for structural quality.
Round ${round}. Current score: ${(scores.combinedScore * 100).toFixed(1)}%.
${smallerScope}
## Current scores by dimension:
${dimSummary}

## Priority errors to fix:
${topIssues || "  None"}

## Warnings:
${warningIssues || "  None"}

## Current strategy focus: ${strategy}

## Rules:
- Output ONLY the complete, valid GTM container JSON — no markdown fences, no commentary
- Never remove existing tags, triggers, variables, or folders
- Preserve ALL %%PLACEHOLDER%% tokens exactly as-is
- Do not change exportFormatVersion, accountId patterns, or containerId patterns
- Keep all IDs unique (tagId, triggerId, variableId)
- Max ${MUTATION_BUDGET} entity changes (add or modify)
- For consent: add a consent init tag and set consentStatus to "NEEDED" on tracking tags
- For Meta coverage: add missing Meta pixel event tags using the existing pattern
- Follow naming conventions: "Platform - Event" for tags, "CE - event" for triggers, "Const/DLV/CJS/Cookie -" for variables

## Current container JSON:
${JSON.stringify(container, null, 2)}`;
}

// ── Call Claude Haiku ────────────────────────────────────────────────────────

function callHaiku(prompt: string): string | null {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  const result = spawnSync(
    CLAUDE_PATH,
    ["-p", "--output-format", "text", "--model", "opus", prompt],
    {
      encoding: "utf-8",
      timeout: 180000,
      maxBuffer: 5 * 1024 * 1024,
      env,
    },
  );

  if (result.status !== 0) {
    console.log(`  [Haiku] CLI error: ${result.stderr?.slice(0, 200)}`);
    return null;
  }

  return result.stdout;
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

// ── Main loop ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const programPath =
    process.argv[2] ??
    path.join(PROJECT_ROOT, "DOCUMENTATION/loops/gtm-autoresearch/program.md");

  const absProgram = path.resolve(programPath);
  const programContent = await readFile(absProgram, "utf-8");
  const config = parseProgram(programContent);

  const templatePath = path.resolve(PROJECT_ROOT, config.templatePath);

  // Load ads snapshot (enriched preferred, legacy Meta fallback)
  let adsSnapshot: EnrichedAdsSnapshot | MetaAdsSnapshot | undefined;

  if (config.enrichedSnapshotPath) {
    const snapPath = path.resolve(PROJECT_ROOT, config.enrichedSnapshotPath);
    try {
      const snapRaw = await readFile(snapPath, "utf-8");
      const enriched = JSON.parse(snapRaw) as EnrichedAdsSnapshot;

      // Staleness check
      if (enriched.generated_at) {
        const ageMs = Date.now() - new Date(enriched.generated_at).getTime();
        const ageHours = ageMs / (1000 * 60 * 60);
        if (ageHours > 72) {
          console.error(`[GTMLoop] Enriched snapshot is ${ageHours.toFixed(0)}h old — too stale for reliable optimization. Run: npx tsx scripts/refresh-ads-snapshot.ts`);
          process.exit(1);
        }
        if (ageHours > 24) {
          console.warn(`[GTMLoop] WARNING: Enriched snapshot is ${ageHours.toFixed(0)}h old — results may not reflect live ads data`);
        }
      }

      // Partial failure warning
      if (enriched.partial) {
        console.warn("[GTMLoop] WARNING: Enriched snapshot was generated with partial API failures — some dimensions may be inaccurate");
      }

      adsSnapshot = enriched;
      console.log(`[GTMLoop] Enriched snapshot: meta=${!!enriched.meta}, google_ads=${!!enriched.google_ads}, funnel_steps=${enriched.funnel.length}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT") || msg.includes("no such file")) {
        console.log(`[GTMLoop] Enriched snapshot not found at ${snapPath} — falling back to legacy`);
      } else {
        console.warn(`[GTMLoop] Failed to parse enriched snapshot: ${msg} — falling back to legacy`);
      }
    }
  }

  if (!adsSnapshot && config.metaSnapshotPath) {
    const metaPath = path.resolve(PROJECT_ROOT, config.metaSnapshotPath);
    const metaRaw = await readFile(metaPath, "utf-8");
    const metaSnapshot = JSON.parse(metaRaw) as MetaAdsSnapshot;
    adsSnapshot = metaSnapshot;
    console.log(`[GTMLoop] Meta Ads snapshot (legacy): ${metaSnapshot.account_name} (${metaSnapshot.conversion_events.length} events)`);
  }

  const snapshotLabel = adsSnapshot
    ? ("meta" in adsSnapshot && "funnel" in adsSnapshot
        ? "enriched"
        : (adsSnapshot as MetaAdsSnapshot).account_name ?? "legacy meta")
    : "none (structural only)";

  console.log("\n[GTMLoop] Starting GTM Autoresearch Loop");
  console.log(`[GTMLoop] Template: ${templatePath}`);
  console.log(`[GTMLoop] Program: ${absProgram}`);
  console.log(`[GTMLoop] Ads data: ${snapshotLabel}`);
  console.log(`[GTMLoop] Max rounds: ${MAX_ROUNDS}`);
  console.log(`[GTMLoop] Plateau target: ${(PLATEAU_SCORE * 100).toFixed(0)}%\n`);

  // Load seed template (read-only reference)
  const seedJson = await readFile(templatePath, "utf-8");
  const seed: GtmContainer = JSON.parse(seedJson);

  // Deep copy as working state
  let working: GtmContainer = JSON.parse(seedJson);
  let workingJson = seedJson;

  const results: RoundResult[] = [];
  let plateauCount = 0;
  let regressionCount = 0;
  let consecutiveJsonFails = 0;
  let bestScore = 0;
  let bestJson = seedJson;
  let prevScore = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`ROUND ${round}/${MAX_ROUNDS}`);
    console.log(`${"═".repeat(60)}`);

    // Score current state
    const scores = evaluateGtmSignalQuality(working, adsSnapshot);

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

    // ── Stop conditions ──

    // Plateau check
    if (scores.combinedScore >= PLATEAU_SCORE) {
      plateauCount++;
      if (plateauCount >= PLATEAU_STREAK) {
        console.log(
          `\n[Stop] PLATEAU at ${(bestScore * 100).toFixed(1)}% for ${PLATEAU_STREAK} rounds`,
        );
        break;
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

    console.log("[Mutate] Calling Claude Haiku...");
    const response = callHaiku(prompt);

    if (!response) {
      console.log("[Mutate] No response from Haiku");
      consecutiveJsonFails++;
      results.push({
        round,
        score: scores.combinedScore,
        dimensions: Object.fromEntries(
          scores.dimensions.map((d) => [d.name, d.score]),
        ),
        issueCount: scores.issues.length,
        action: "json_fail",
        mutationSummary: "No response from Haiku",
      });

      if (consecutiveJsonFails >= MAX_JSON_FAILURES) {
        console.log(`\n[Stop] ${MAX_JSON_FAILURES} consecutive JSON failures`);
        break;
      }
      continue;
    }

    // Parse response JSON
    let mutated: GtmContainer;
    try {
      // Strip markdown fences if present
      const cleaned = response
        .replace(/^```(?:json)?\s*/m, "")
        .replace(/```\s*$/m, "")
        .trim();
      mutated = JSON.parse(cleaned);
      consecutiveJsonFails = 0;
    } catch (err) {
      console.log(`[Mutate] Invalid JSON from Haiku: ${(err as Error).message}`);
      consecutiveJsonFails++;
      results.push({
        round,
        score: scores.combinedScore,
        dimensions: Object.fromEntries(
          scores.dimensions.map((d) => [d.name, d.score]),
        ),
        issueCount: scores.issues.length,
        action: "json_fail",
        mutationSummary: `Invalid JSON: ${(err as Error).message}`,
      });

      if (consecutiveJsonFails >= MAX_JSON_FAILURES) {
        console.log(`\n[Stop] ${MAX_JSON_FAILURES} consecutive JSON failures`);
        break;
      }
      continue;
    }

    // Validate mutation
    const validation = validateMutation(mutated, seed, seedJson);
    if (!validation.valid) {
      console.log(`[Validate] REJECTED: ${validation.reason}`);
      results.push({
        round,
        score: scores.combinedScore,
        dimensions: Object.fromEntries(
          scores.dimensions.map((d) => [d.name, d.score]),
        ),
        issueCount: scores.issues.length,
        action: "validation_fail",
        mutationSummary: `Validation failed: ${validation.reason}`,
      });
      continue;
    }

    // Re-score mutated version
    const mutatedScores = evaluateGtmSignalQuality(mutated, adsSnapshot);
    console.log(
      `[Mutate] New score: ${(mutatedScores.combinedScore * 100).toFixed(1)}% ` +
        `(was ${(scores.combinedScore * 100).toFixed(1)}%)`,
    );

    if (mutatedScores.combinedScore > scores.combinedScore) {
      // Keep improvement
      console.log("[Mutate] IMPROVED — keeping mutation");
      working = mutated;
      workingJson = JSON.stringify(mutated, null, 2);
      results.push({
        round,
        score: mutatedScores.combinedScore,
        dimensions: Object.fromEntries(
          mutatedScores.dimensions.map((d) => [d.name, d.score]),
        ),
        issueCount: mutatedScores.issues.length,
        action: "improved",
        mutationSummary: `Score ${(scores.combinedScore * 100).toFixed(1)}% → ${(mutatedScores.combinedScore * 100).toFixed(1)}%`,
      });
    } else {
      // Revert
      console.log("[Mutate] No improvement — reverting");
      results.push({
        round,
        score: scores.combinedScore,
        dimensions: Object.fromEntries(
          scores.dimensions.map((d) => [d.name, d.score]),
        ),
        issueCount: scores.issues.length,
        action: "reverted",
        mutationSummary: `${(mutatedScores.combinedScore * 100).toFixed(1)}% <= ${(scores.combinedScore * 100).toFixed(1)}%, reverted`,
      });
    }
  }

  // ── Save winning config ──

  const winningDir = path.join(PROJECT_ROOT, "content/gtm-templates/winning");
  await mkdir(winningDir, { recursive: true });
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "");
  const winningPath = path.join(
    winningDir,
    `${timestamp}-shopify-ecom-web.json`,
  );
  await writeFile(winningPath, bestJson);
  console.log(`\n[Save] Winning config → ${winningPath}`);

  // ── Write experiment log ──

  const logDir = path.join(
    PROJECT_ROOT,
    "DOCUMENTATION/loops/gtm-autoresearch/loop-results",
  );
  await mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, `${timestamp}.json`);
  await writeFile(
    logPath,
    JSON.stringify(
      {
        startTime: new Date().toISOString(),
        templatePath: config.templatePath,
        rounds: results.length,
        bestScore,
        startScore: results[0]?.score ?? 0,
        finalScore: results[results.length - 1]?.score ?? 0,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`[Save] Experiment log → ${logPath}`);

  // ── Summary ──

  console.log("\n=== GTM Autoresearch Loop Summary ===");
  console.log(`Rounds: ${results.length}`);
  console.log(
    `Start score: ${((results[0]?.score ?? 0) * 100).toFixed(1)}%`,
  );
  console.log(`Best score: ${(bestScore * 100).toFixed(1)}%`);
  console.log(
    `Final score: ${((results[results.length - 1]?.score ?? 0) * 100).toFixed(1)}%`,
  );

  const improved = results.filter((r) => r.action === "improved").length;
  const reverted = results.filter((r) => r.action === "reverted").length;
  const valFails = results.filter((r) => r.action === "validation_fail").length;
  const jsonFails = results.filter((r) => r.action === "json_fail").length;
  console.log(
    `Outcomes: ${improved} improved, ${reverted} reverted, ${valFails} validation fails, ${jsonFails} JSON fails`,
  );
}

main().catch((err) => {
  console.error("[GTMLoop] Error:", err.message);
  process.exit(1);
});
