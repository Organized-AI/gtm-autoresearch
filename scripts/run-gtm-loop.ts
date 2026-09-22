/**
 * GTM Autoresearch Loop
 *
 * Karpathy-style autonomous experimentation loop that optimizes GTM container
 * configurations via structural scoring + LLM mutations.
 *
 * Loop: score → build prompt → mutate via LLM → validate → keep/revert → repeat
 *
 * Mutation providers:
 *   MUTATION_PROVIDER=claude  (default) — uses Claude CLI, authenticated via your Claude plan
 *   MUTATION_PROVIDER=openai  — uses OpenAI API (GPT-5.4, GPT-4o, etc.), requires OPENAI_API_KEY
 *
 * Usage:
 *   npx tsx scripts/run-gtm-loop.ts [program.md path]
 *   npx tsx scripts/run-gtm-loop.ts   (defaults to content/gtm-templates/HRE/program.md)
 */

import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { postAutoresearchRun } from "./post-to-linear.js";
import {
  buildEvidence,
  freezeSeedDefinition,
  PythonJevJudge,
  shadowPolicy,
  writeEvidence,
  hash,
  type ShadowOutcome,
} from "./jev-shadow.js";
import {
  applyOperations,
  assertValidOperations,
  validateCandidate,
  type MutationResponse,
} from "./gtm-container-mutations.js";
import {
  evaluateGtmSignalQuality,
  type GtmContainer,
  type GtmTag,
  type GtmSignalQualityResult,
  type GtmIssue,
  type MetaAdsSnapshot,
  type EnrichedAdsSnapshot,
} from "../evals/eval_gtm_signal_quality.js";

const PROJECT_ROOT = path.resolve(
  decodeURIComponent(new URL(".", import.meta.url).pathname),
  "..",
);

const CLAUDE_PATH =
  process.env.CLAUDE_PATH ?? "/Users/supabowl/.local/bin/claude";
const CODEX_PATH =
  process.env.CODEX_PATH ?? "codex";
const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS ?? "30", 10);
const PLATEAU_SCORE = 0.92;
const PLATEAU_STREAK = 3;
const MAX_REGRESSIONS = 3;
const MAX_JSON_FAILURES = 5;
const MUTATION_BUDGET = 3;
const JEV_MODE = process.env.JEV_MODE === "shadow" ? "shadow" : "off";
const JEV_PYTHON = process.env.JEV_PYTHON ?? "python3";
const JEV_WORKER_PATH = process.env.JEV_WORKER_PATH ?? path.join(PROJECT_ROOT, "scripts/jev_worker.py");
const JEV_DEFINITION_PATH = process.env.JEV_DEFINITION_PATH ?? "";

// Mutation provider config
// "claude" = Claude Code CLI (authenticated via Claude plan)
// "codex"  = OpenAI Codex CLI (authenticated via Codex plan)
const MUTATION_PROVIDER = process.env.MUTATION_PROVIDER ?? "claude";
const MUTATION_MODEL = process.env.MUTATION_MODEL ?? (MUTATION_PROVIDER === "codex" ? "o4-mini" : "sonnet");

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
  shadow?: ShadowOutcome;
}

interface ClientManifest {
  client?: string;
  platform?: string;
  container_type?: string;
  container_public_id?: string;
  integrations?: string[];
  meta_ad_account_id?: string;
  meta_pixel_id?: string;
  google_ads_customer_id?: string;
  ads_snapshot?: string;
  [key: string]: unknown;
}

interface NamedEntityDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

interface TagChangeSummary {
  consentOnly: number;
  folderOnly: number;
  consentAndFolder: number;
  other: string[];
}

// ── Parse program.md ─────────────────────────────────────────────────────────

function parseProgram(content: string): ProgramConfig {
  const templateMatch = content.match(/Template file:\s*`([^`]+)`/);
  const templatePath = templateMatch?.[1] ?? "content/gtm-templates/HRE/seed/shopify-ecom-web.json";

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

function formatPercent(score: number, digits = 1): string {
  return `${(score * 100).toFixed(digits)}%`;
}

function humanizeDimension(name: string): string {
  const labels: Record<string, string> = {
    tagCoverage: "Tag coverage",
    paramCompleteness: "Parameter completeness",
    deduplication: "Deduplication",
    consentSettings: "Consent settings",
    namingConventions: "Naming conventions",
    variableHygiene: "Variable hygiene",
    triggerQuality: "Trigger quality",
    folderOrganization: "Folder organization",
    metaAdsAlignment: "Meta Ads alignment",
    capiCoverage: "CAPI coverage",
    funnelIntegrity: "Funnel integrity",
    googleAdsAlignment: "Google Ads alignment",
  };
  return labels[name] ?? name;
}

function toMermaidLabel(value: string): string {
  return value.replace(/"/g, "'").replace(/[{}[\]<>]/g, "").replace(/\n/g, " ");
}

async function loadClientManifest(clientDir: string): Promise<ClientManifest | undefined> {
  const manifestPath = path.join(clientDir, "manifest.json");
  try {
    return JSON.parse(await readFile(manifestPath, "utf-8")) as ClientManifest;
  } catch {
    return undefined;
  }
}

function diffEntitiesByName<T extends { name?: string }>(
  before: T[] = [],
  after: T[] = [],
): NamedEntityDiff {
  const beforeMap = new Map(
    before.filter((item) => item.name).map((item) => [item.name as string, item]),
  );
  const afterMap = new Map(
    after.filter((item) => item.name).map((item) => [item.name as string, item]),
  );

  const added = [...afterMap.keys()].filter((name) => !beforeMap.has(name)).sort();
  const removed = [...beforeMap.keys()].filter((name) => !afterMap.has(name)).sort();
  const changed = [...beforeMap.keys()]
    .filter((name) => afterMap.has(name))
    .filter(
      (name) =>
        JSON.stringify(beforeMap.get(name)) !== JSON.stringify(afterMap.get(name)),
    )
    .sort();

  return { added, removed, changed };
}

function collectDiffPaths(a: unknown, b: unknown, base = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) {
    return [];
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    const paths: string[] = [];
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      paths.push(...collectDiffPaths(a[i], b[i], `${base}${base ? "." : ""}${i}`));
    }
    return paths.length > 0 ? paths : [base || "(root)"];
  }

  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const paths: string[] = [];
    const keys = new Set([
      ...Object.keys(a as Record<string, unknown>),
      ...Object.keys(b as Record<string, unknown>),
    ]);
    for (const key of keys) {
      const nextBase = `${base}${base ? "." : ""}${key}`;
      paths.push(
        ...collectDiffPaths(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          nextBase,
        ),
      );
    }
    return paths.length > 0 ? paths : [base || "(root)"];
  }

  return [base || "(root)"];
}

function classifyTagChanges(beforeTags: GtmTag[] = [], afterTags: GtmTag[] = []): TagChangeSummary {
  const beforeMap = new Map(beforeTags.map((tag) => [tag.name, tag]));
  const afterMap = new Map(afterTags.map((tag) => [tag.name, tag]));

  let consentOnly = 0;
  let folderOnly = 0;
  let consentAndFolder = 0;
  const other: string[] = [];

  for (const [name, beforeTag] of beforeMap.entries()) {
    const afterTag = afterMap.get(name);
    if (!afterTag) {
      continue;
    }
    if (JSON.stringify(beforeTag) === JSON.stringify(afterTag)) {
      continue;
    }

    const diffPaths = [...new Set(collectDiffPaths(beforeTag, afterTag))].sort();
    const isConsentOnly = diffPaths.every((diffPath) => diffPath === "consentSettings.consentStatus");
    const isFolderOnly = diffPaths.every((diffPath) => diffPath === "parentFolderId");
    const isConsentAndFolder =
      diffPaths.every(
        (diffPath) =>
          diffPath === "consentSettings.consentStatus" || diffPath === "parentFolderId",
      ) && !isConsentOnly && !isFolderOnly;

    if (isConsentOnly) {
      consentOnly++;
    } else if (isFolderOnly) {
      folderOnly++;
    } else if (isConsentAndFolder) {
      consentAndFolder++;
    } else {
      other.push(name);
    }
  }

  return { consentOnly, folderOnly, consentAndFolder, other: other.sort() };
}

function opportunityHint(name: string): string {
  switch (name) {
    case "tagCoverage":
      return "Add missing GA4, Meta, or Google Ads event tags.";
    case "paramCompleteness":
      return "Fill required params on existing tags.";
    case "deduplication":
      return "Wire a stable event_id into Meta browser and server events.";
    case "consentSettings":
      return "Add Consent Mode init and require consent on all tracking tags.";
    case "namingConventions":
      return "Normalize tags and triggers to readable naming patterns.";
    case "variableHygiene":
      return "Remove orphan refs and standardize variable definitions.";
    case "triggerQuality":
      return "Replace weak pageview fallbacks with explicit custom-event triggers.";
    case "folderOrganization":
      return "Assign tags to platform folders and reduce sprawl.";
    case "metaAdsAlignment":
      return "Cover the Meta events that are actually appearing in ads data.";
    case "capiCoverage":
      return "Improve browser/server event parity and CAPI plumbing.";
    case "funnelIntegrity":
      return "Fix missing or misfiring funnel steps before conversion.";
    case "googleAdsAlignment":
      return "Match GTM conversion tags to active Google Ads actions.";
    default:
      return "Investigate and target this dimension directly.";
  }
}

function buildOpportunityList(
  beforeScores: GtmSignalQualityResult,
  afterScores: GtmSignalQualityResult,
): Array<{
  name: string;
  before: number;
  after: number;
  topIssue: string;
  hint: string;
}> {
  const afterMap = new Map(afterScores.dimensions.map((dimension) => [dimension.name, dimension]));
  return [...beforeScores.dimensions]
    .sort((a, b) => {
      const aGap = (1 - a.score) * a.weight;
      const bGap = (1 - b.score) * b.weight;
      return bGap - aGap;
    })
    .slice(0, 5)
    .map((dimension) => {
      const after = afterMap.get(dimension.name)?.score ?? dimension.score;
      const topIssue =
        dimension.issues.find((issue) => issue.severity === "error")?.message ??
        dimension.issues[0]?.message ??
        "No specific issue text recorded.";
      return {
        name: dimension.name,
        before: dimension.score,
        after,
        topIssue,
        hint: opportunityHint(dimension.name),
      };
    });
}

function buildOpportunityMermaid(
  opportunities: Array<{ name: string; before: number; after: number; hint: string }>,
): string {
  if (opportunities.length === 0) {
    return `flowchart LR\n  A["No material opportunities identified"]`;
  }

  const lines = [
    "flowchart LR",
    "  subgraph Before",
  ];

  opportunities.forEach((opportunity, index) => {
    lines.push(
      `    B${index}["${toMermaidLabel(`${humanizeDimension(opportunity.name)} ${formatPercent(opportunity.before, 0)}`)}"]`,
    );
  });

  lines.push("  end", "  subgraph Changes");

  opportunities.forEach((opportunity, index) => {
    lines.push(
      `    C${index}["${toMermaidLabel(opportunity.hint)}"]`,
    );
  });

  lines.push("  end", "  subgraph After");

  opportunities.forEach((opportunity, index) => {
    lines.push(
      `    A${index}["${toMermaidLabel(`${humanizeDimension(opportunity.name)} ${formatPercent(opportunity.after, 0)}`)}"]`,
    );
  });

  lines.push("  end");

  opportunities.forEach((_, index) => {
    lines.push(`  B${index} --> C${index} --> A${index}`);
  });

  return lines.join("\n");
}

function buildChangeMermaid(args: {
  before: GtmSignalQualityResult;
  after: GtmSignalQualityResult;
  tagDiff: NamedEntityDiff;
  triggerDiff: NamedEntityDiff;
  variableDiff: NamedEntityDiff;
  folderDiff: NamedEntityDiff;
  tagChangeSummary: TagChangeSummary;
}): string {
  const { before, after, tagDiff, triggerDiff, variableDiff, folderDiff, tagChangeSummary } = args;
  return [
    "flowchart TD",
    `  Seed["Seed container\\n${before.tagCount} tags / ${before.triggerCount} triggers / ${before.variableCount} vars / ${before.folderCount} folders"]`,
    `  AddTags["+${tagDiff.added.length} tags added"]`,
    `  AddTriggers["+${triggerDiff.added.length} triggers added"]`,
    `  AddVars["+${variableDiff.added.length} variables added"]`,
    `  UpdateConsent["${tagChangeSummary.consentOnly} consent-only tag updates"]`,
    `  UpdateMixed["${tagChangeSummary.consentAndFolder} consent + folder updates"]`,
    `  UpdateOther["${tagChangeSummary.other.length} other tag rewires"]`,
    `  FolderChanges["${folderDiff.changed.length} folder changes"]`,
    `  Winner["Winning container\\n${after.tagCount} tags / ${after.triggerCount} triggers / ${after.variableCount} vars / ${after.folderCount} folders"]`,
    "  Seed --> AddTags --> Winner",
    "  Seed --> AddTriggers --> Winner",
    "  Seed --> AddVars --> Winner",
    "  Seed --> UpdateConsent --> Winner",
    "  Seed --> UpdateMixed --> Winner",
    "  Seed --> UpdateOther --> Winner",
    "  Seed --> FolderChanges --> Winner",
  ].join("\n");
}

function listMarkdown(items: string[], fallback = "None"): string {
  if (items.length === 0) {
    return fallback;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function buildDataAuditReport(args: {
  manifest?: ClientManifest;
  config: ProgramConfig;
  snapshotLabel: string;
  beforeContainer: GtmContainer;
  afterContainer: GtmContainer;
  beforeScores: GtmSignalQualityResult;
  afterScores: GtmSignalQualityResult;
  results: RoundResult[];
  winningPath: string;
  logPath: string;
  notesPath: string;
  auditPath: string;
}): string {
  const {
    manifest,
    config,
    snapshotLabel,
    beforeContainer,
    afterContainer,
    beforeScores,
    afterScores,
    results,
    winningPath,
    logPath,
    notesPath,
    auditPath,
  } = args;

  const tagDiff = diffEntitiesByName(beforeContainer.containerVersion.tag, afterContainer.containerVersion.tag);
  const triggerDiff = diffEntitiesByName(
    beforeContainer.containerVersion.trigger,
    afterContainer.containerVersion.trigger,
  );
  const variableDiff = diffEntitiesByName(
    beforeContainer.containerVersion.variable,
    afterContainer.containerVersion.variable,
  );
  const folderDiff = diffEntitiesByName(
    beforeContainer.containerVersion.folder,
    afterContainer.containerVersion.folder,
  );
  const tagChangeSummary = classifyTagChanges(
    beforeContainer.containerVersion.tag,
    afterContainer.containerVersion.tag,
  );

  const opportunities = buildOpportunityList(beforeScores, afterScores);
  const afterMap = new Map(afterScores.dimensions.map((dimension) => [dimension.name, dimension]));
  const dimensionTable = beforeScores.dimensions
    .map((dimension) => {
      const after = afterMap.get(dimension.name)?.score ?? dimension.score;
      return `| ${humanizeDimension(dimension.name)} | ${formatPercent(dimension.score, 0)} | ${formatPercent(after, 0)} | ${((after - dimension.score) * 100).toFixed(1)}pp |`;
    })
    .join("\n");

  const improvedRounds = results.filter((result) => result.action === "improved").length;
  const revertedRounds = results.filter((result) => result.action === "reverted").length;
  const validationFails = results.filter((result) => result.action === "validation_fail").length;
  const jsonFails = results.filter((result) => result.action === "json_fail").length;
  const afterErrors = afterScores.issues.filter((issue) => issue.severity === "error");
  const afterWarnings = afterScores.issues.filter((issue) => issue.severity === "warning");
  const unresolved = afterScores.dimensions
    .filter((dimension) => dimension.score < 0.8)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map(
      (dimension) =>
        `${humanizeDimension(dimension.name)} (${formatPercent(dimension.score, 0)}): ${opportunityHint(dimension.name)}`,
    );

  return `# ${manifest?.client ?? "Client"} Data Audit — Before vs After

**Date:** ${new Date().toISOString().slice(0, 10)}
**Template:** ${config.templatePath}
**Ads Data:** ${snapshotLabel}
**Meta Account:** ${manifest?.meta_ad_account_id ?? "n/a"}
**Meta Pixel:** ${manifest?.meta_pixel_id ?? "n/a"}
**Google Ads Customer:** ${manifest?.google_ads_customer_id ?? "n/a"}
**Audit Source:** Automated post-win GTM audit

---

## Executive Summary

**Before:** ${formatPercent(beforeScores.combinedScore)}
**After:** ${formatPercent(afterScores.combinedScore)}
**Improvement:** +${((afterScores.combinedScore - beforeScores.combinedScore) * 100).toFixed(1)}pp

**Loop Outcomes**
- Improved rounds: ${improvedRounds}
- Reverted rounds: ${revertedRounds}
- Validation failures: ${validationFails}
- JSON failures: ${jsonFails}

**Bottom Line**
The winning container improved structural and ads-aligned tracking quality from ${formatPercent(beforeScores.combinedScore)} to ${formatPercent(afterScores.combinedScore)}. The main gains came from consent remediation, missing event coverage, and selective trigger additions, while the remaining risk is concentrated in lower-scoring structural debt dimensions after the loop.

## Before vs After Scorecard

| Dimension | Before | After | Delta |
|-----------|--------|-------|-------|
${dimensionTable}

## Opportunities Identified

${opportunities
  .map(
    (opportunity, index) =>
      `${index + 1}. **${humanizeDimension(opportunity.name)}**: ${formatPercent(opportunity.before, 0)} → ${formatPercent(opportunity.after, 0)}. ${opportunity.topIssue} Suggested action: ${opportunity.hint}`,
  )
  .join("\n")}

## Mermaid — Opportunities Before to After

\`\`\`mermaid
${buildOpportunityMermaid(opportunities)}
\`\`\`

## Changes Made

### GTM Entity Delta

- Tags: ${beforeScores.tagCount} → ${afterScores.tagCount} (${tagDiff.added.length} added, ${tagDiff.changed.length} changed, ${tagDiff.removed.length} removed)
- Triggers: ${beforeScores.triggerCount} → ${afterScores.triggerCount} (${triggerDiff.added.length} added, ${triggerDiff.changed.length} changed, ${triggerDiff.removed.length} removed)
- Variables: ${beforeScores.variableCount} → ${afterScores.variableCount} (${variableDiff.added.length} added, ${variableDiff.changed.length} changed, ${variableDiff.removed.length} removed)
- Folders: ${beforeScores.folderCount} → ${afterScores.folderCount} (${folderDiff.added.length} added, ${folderDiff.changed.length} changed, ${folderDiff.removed.length} removed)

### Change Summary

- Consent-only tag updates: ${tagChangeSummary.consentOnly}
- Folder-only tag updates: ${tagChangeSummary.folderOnly}
- Consent + folder tag updates: ${tagChangeSummary.consentAndFolder}
- Other rewired tags: ${tagChangeSummary.other.length}

### Added Tags

${listMarkdown(tagDiff.added.slice(0, 20), "None")}

### Added Triggers

${listMarkdown(triggerDiff.added.slice(0, 20), "None")}

### Other Rewired Tags

${listMarkdown(tagChangeSummary.other.slice(0, 20), "None")}

## Mermaid — Change Flow

\`\`\`mermaid
${buildChangeMermaid({
    before: beforeScores,
    after: afterScores,
    tagDiff,
    triggerDiff,
    variableDiff,
    folderDiff,
    tagChangeSummary,
  })}
\`\`\`

## Critical Findings

### Strengths
- ${humanizeDimension(opportunities[0]?.name ?? "consentSettings")} was materially improved during the run.
- No GTM entities were removed from the seed container.
- The winning JSON exists as a standalone pre-upload artifact with a matching experiment log.

### Remaining Risks
- Errors remaining: ${afterErrors.length}
- Warnings remaining: ${afterWarnings.length}
- Lowest remaining dimensions:
${listMarkdown(unresolved, "None")}

## Action Plan

### Phase 1: Pre-Upload Validation
- Compare seed vs winning JSON at the raw export level.
- Run the \`data-audit\` skill against the linked Meta account and pixel.
- Import only into staging and verify browser/server event behavior.

### Phase 2: Structural Debt Cleanup
- Address the still-low naming and folder organization dimensions.
- Review deduplication and CAPI coverage for browser/server parity.
- Re-run the loop after any large manual tidy pass.

### Phase 3: Ads-Side Verification
- Validate that the GTM changes actually map to better event capture in Meta and Google Ads.
- Confirm funnel step ratios after deployment.
- Use the post-deployment audit as the next baseline for another optimization pass.

## Files

- Winning config: \`${path.relative(PROJECT_ROOT, winningPath)}\`
- Experiment log: \`${path.relative(PROJECT_ROOT, logPath)}\`
- Run notes: \`${path.relative(PROJECT_ROOT, notesPath)}\`
- This audit: \`${path.relative(PROJECT_ROOT, auditPath)}\`
`;
}

// ── Deterministic container mutation policy ───────────────────────────────
//
// The model emits operations. scripts/gtm-container-mutations.ts owns cloning,
// ID allocation, reference checks, and baseline field preservation.

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

  // Show example tag for pattern reference (prefer GA4 gaawe, then Meta, then first tag)
  const exampleTag = (container.containerVersion.tag ?? []).find(t => t.type === "gaawe")
    ?? (container.containerVersion.tag ?? []).find(t => t.name?.includes("Meta"))
    ?? container.containerVersion.tag?.[0];
  const exampleSnippet = exampleTag ? JSON.stringify(exampleTag, null, 2) : "none";

  // If no GA4 gaawe tag exists in the container, provide a reference template
  const hasGa4Event = (container.containerVersion.tag ?? []).some(t => t.type === "gaawe");
  const ga4ReferenceTag = !hasGa4Event ? `
## GA4 Event tag reference (type "gaawe" — container has none, use this pattern for new GA4 event tags):
{
  "name": "GA4 - event_name - DataLayer",
  "type": "gaawe",
  "parameter": [
    { "type": "BOOLEAN", "key": "sendEcommerceData", "value": "true" },
    { "type": "TEMPLATE", "key": "eventName", "value": "event_name" },
    { "type": "TAG_REFERENCE", "key": "measurementId", "value": "GA4 Config Tag Name" },
    { "type": "TEMPLATE", "key": "measurementIdOverride", "value": "G-XXXXXXXXXX" }
  ],
  "firingTriggerId": ["TRIGGER_ID"],
  "consentSettings": { "consentStatus": "NEEDED" },
  "parentFolderId": "FOLDER_ID",
  "tagFiringOption": "ONCE_PER_EVENT",
  "monitoringMetadata": { "type": "MAP" }
}
` : "";

  // Show existing entity names for context (truncate large containers to keep prompt reasonable)
  const allTags = (container.containerVersion.tag ?? []).map(t => `  - "${t.name}" (tagId: ${t.tagId}, type: ${t.type})`);
  const tagList = allTags.length > 40
    ? allTags.slice(0, 40).join("\n") + `\n  ... and ${allTags.length - 40} more tags`
    : allTags.join("\n");
  const allTriggers = (container.containerVersion.trigger ?? []).map(t => `  - "${t.name}" (triggerId: ${t.triggerId})`);
  const triggerList = allTriggers.length > 30
    ? allTriggers.slice(0, 30).join("\n") + `\n  ... and ${allTriggers.length - 30} more triggers`
    : allTriggers.join("\n");
  const allVars = (container.containerVersion.variable ?? []).map(v => `  - "${v.name}" (variableId: ${v.variableId})`);
  const varList = allVars.length > 30
    ? allVars.slice(0, 30).join("\n") + `\n  ... and ${allVars.length - 30} more variables`
    : allVars.join("\n");

  const smallerScope = consecutiveJsonFails >= 3
    ? "\nIMPORTANT: Previous mutations had JSON errors. Output ONLY 1 operation this round.\n"
    : "";

  return `You are optimizing a GTM container. Output a JSON operations object — NOT the full container.
Round ${round}. Current score: ${(scores.combinedScore * 100).toFixed(1)}%.
${smallerScope}
## Scores:
${dimSummary}

## Errors to fix:
${topIssues || "  None"}

## Warnings:
${warningIssues || "  None"}

## Strategy focus: ${strategy}

## Existing entities:
Tags:
${tagList}
Triggers:
${triggerList}
Variables:
${varList}

## Example tag (use as pattern for new tags):
${exampleSnippet}
${ga4ReferenceTag}
## Existing folders:
${(container.containerVersion.folder ?? []).map(f => `  - "${f.name}" (folderId: ${f.folderId})`).join("\n")}

## Output format — respond with ONLY valid JSON (no markdown fences or comments):
{
  "operations": [
    {"op": "set_consent_all"},
    {"op": "add_tag", "entity": {"name": "Meta - Purchase", "type": "cvt_123456_1", "parameter": [], "firingTriggerId": ["42"], "parentFolderId": "4"}},
    {"op": "add_trigger", "entity": {"name": "CE - purchase", "type": "CUSTOM_EVENT", "customEventFilter": []}},
    {"op": "add_variable", "entity": {"name": "DLV - Event ID", "type": "v", "parameter": []}},
    {"op": "add_folder", "entity": {"name": "Meta"}},
    {"op": "modify_tag", "tagId": "123", "changes": {"parameter": []}},
    {"op": "rename_tags", "renames": [{"tagId": "5", "newName": "Bing - All Pages"}]},
    {"op": "assign_folders", "assignments": [{"tagId": "5", "folderId": "4"}]}
  ],
  "summary": "Brief description of changes"
}

## Rules:
- Output operations only. Never output, edit, reconstruct, or repair a full container JSON document.
- The deterministic mutation layer allocates IDs and copies account/container identity. Do not supply accountId, containerId, tagId, triggerId, variableId, folderId, or fingerprint in an add entity.
- Max ${MUTATION_BUDGET} add, modify, or consent operations per round. Rename and folder batches do not count toward that limit.
- For modify_tag, changes may contain only name, parameter, firingTriggerId, blockingTriggerId, parentFolderId, consentSettings, tagFiringOption, and notes. Never change tag type or other fields.
- Refer only to listed trigger IDs, folder IDs, and existing variable names. Preserve all %%PLACEHOLDER%% tokens exactly.
- Use naming: "Platform - Event" for tags and "CE - event" for triggers.
- For consent focus: use set_consent_all plus an optional Consent Mode v2 initialization tag that references an existing Consent Initialization trigger.
- For Meta tags: match an existing Meta template type and include eventID referencing {{CJS - Event ID Generator}} when that variable exists.
- For folders: use add_folder to create a folder, then assign_folders with its code-assigned ID in a later round; do not invent its ID.`;
}

// ── Mutation providers ──────────────────────────────────────────────────────

function callClaudeCli(prompt: string): string | null {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  // Pass prompt via stdin to avoid argument length limits (~35KB+ GTM container JSON)
  const result = spawnSync(
    CLAUDE_PATH,
    ["-p", "--output-format", "text", "--model", MUTATION_MODEL],
    {
      input: prompt,
      encoding: "utf-8",
      timeout: 600000,
      maxBuffer: 5 * 1024 * 1024,
      env,
    },
  );

  if (result.status !== 0) {
    console.log(`  [Claude] CLI error (exit ${result.status}): ${result.stderr?.slice(0, 300)}`);
    return null;
  }

  return result.stdout;
}

function callCodexCli(prompt: string): string | null {
  const env = { ...process.env };

  // Codex CLI: codex -q --model <model> "prompt"
  // -q = quiet mode (non-interactive, prints result only)
  // Pass prompt via stdin to avoid argument length limits
  const result = spawnSync(
    CODEX_PATH,
    ["-q", "--model", MUTATION_MODEL],
    {
      input: prompt,
      encoding: "utf-8",
      timeout: 600000,
      maxBuffer: 5 * 1024 * 1024,
      env,
    },
  );

  if (result.status !== 0) {
    console.log(`  [Codex] CLI error (exit ${result.status}): ${result.stderr?.slice(0, 300)}`);
    return null;
  }

  return result.stdout;
}

function callMutation(prompt: string): string | null {
  if (MUTATION_PROVIDER === "codex") {
    return callCodexCli(prompt);
  }
  return callClaudeCli(prompt);
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
    path.join(PROJECT_ROOT, "content/gtm-templates/HRE/program.md");

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
  console.log(`[GTMLoop] Mutation: ${MUTATION_PROVIDER}/${MUTATION_MODEL}`);
  console.log(`[GTMLoop] Plateau target: ${(PLATEAU_SCORE * 100).toFixed(0)}%\n`);

  // Load seed template (read-only reference)
  const seedJson = await readFile(templatePath, "utf-8");
  const seed: GtmContainer = JSON.parse(seedJson);
  const baselineScores = evaluateGtmSignalQuality(seed, adsSnapshot);

  // Deep copy as working state
  let working: GtmContainer = JSON.parse(seedJson);
  let workingJson = seedJson;

  const results: RoundResult[] = [];
  let plateauCount = 0;
  let regressionCount = 0;
  let consecutiveJsonFails = 0;
  let bestScore = baselineScores.combinedScore;
  let bestJson = seedJson;
  let prevScore = baselineScores.combinedScore;
  const shadowRunId = `shadow-${Date.now()}`;
  const frozenJudgeDefinition = freezeSeedDefinition();

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

    console.log(`[Mutate] Calling ${MUTATION_PROVIDER}/${MUTATION_MODEL}...`);
    const response = callMutation(prompt);

    if (!response) {
      console.log("[Mutate] No response from mutation provider");
      consecutiveJsonFails++;
      results.push({
        round,
        score: scores.combinedScore,
        dimensions: Object.fromEntries(
          scores.dimensions.map((d) => [d.name, d.score]),
        ),
        issueCount: scores.issues.length,
        action: "json_fail",
        mutationSummary: "No response from mutation provider",
      });

      if (consecutiveJsonFails >= MAX_JSON_FAILURES) {
        console.log(`\n[Stop] ${MAX_JSON_FAILURES} consecutive JSON failures`);
        break;
      }
      continue;
    }

    // Parse operations response
    let mutationResp: MutationResponse;
    try {
      // Strip markdown fences if present
      const cleaned = response
        .replace(/^```(?:json)?\s*/m, "")
        .replace(/```\s*$/m, "")
        .trim();
      mutationResp = JSON.parse(cleaned);
      assertValidOperations(mutationResp.operations, MUTATION_BUDGET);
      consecutiveJsonFails = 0;
    } catch (err) {
      console.log(`[Mutate] Invalid operations JSON: ${(err as Error).message}`);
      consecutiveJsonFails++;
      results.push({
        round,
        score: scores.combinedScore,
        dimensions: Object.fromEntries(
          scores.dimensions.map((d) => [d.name, d.score]),
        ),
        issueCount: scores.issues.length,
        action: "json_fail",
        mutationSummary: `Invalid operations JSON: ${(err as Error).message}`,
      });

      if (consecutiveJsonFails >= MAX_JSON_FAILURES) {
        console.log(`\n[Stop] ${MAX_JSON_FAILURES} consecutive JSON failures`);
        break;
      }
      continue;
    }

    console.log(`[Mutate] ${mutationResp.operations.length} operations: ${mutationResp.summary ?? "no summary"}`);

    // Apply operations to current working container
    let mutated: GtmContainer;
    try {
      mutated = applyOperations(working, mutationResp.operations);
    } catch (err) {
      console.log(`[Mutate] Failed to apply operations: ${(err as Error).message}`);
      results.push({
        round,
        score: scores.combinedScore,
        dimensions: Object.fromEntries(
          scores.dimensions.map((d) => [d.name, d.score]),
        ),
        issueCount: scores.issues.length,
        action: "validation_fail",
        mutationSummary: `Apply failed: ${(err as Error).message}`,
      });
      continue;
    }

    // Verify the candidate against this round's baseline before scoring it.
    // Earlier accepted changes remain in working, which is itself derived from the seed.
    const validation = validateCandidate(working, mutated, mutationResp.operations);
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
    let shadowBase: Omit<ShadowOutcome, "actualAction" | "disagreement"> | undefined;
    if (JEV_MODE === "shadow") {
      const evidence = buildEvidence({
        runId: shadowRunId, parentId: hash(working).slice(0, 16), baseline: working, candidate: mutated,
        operations: mutationResp.operations, targetedIssue: strategy, before: scores, after: mutatedScores,
        validation, snapshot: { identity: adsSnapshot ? "loaded-snapshot" : "none", partial: Boolean((adsSnapshot as EnrichedAdsSnapshot | undefined)?.partial) },
        qa: { status: "absent" }, frozen: frozenJudgeDefinition,
      });
      const judge = new PythonJevJudge(JEV_PYTHON, JEV_WORKER_PATH, JEV_DEFINITION_PATH);
      const judgment = await judge.judge(evidence);
      const proposal = shadowPolicy(evidence, judgment);
      shadowBase = { mode: "shadow", proposedRoute: proposal.route, reasonCodes: proposal.reasonCodes, judgment };
      await writeEvidence(path.join(path.dirname(templatePath), "shadow-results", shadowRunId, `${round}-${evidence.candidateId}`), evidence, working, mutated);
    }
    console.log(
      `[Mutate] New score: ${(mutatedScores.combinedScore * 100).toFixed(1)}% ` +
        `(was ${(scores.combinedScore * 100).toFixed(1)}%)`,
    );

    if (mutatedScores.combinedScore > scores.combinedScore) {
      // Keep improvement
      console.log("[Mutate] IMPROVED — keeping mutation");
      working = mutated;
      workingJson = JSON.stringify(mutated, null, 2);
      if (mutatedScores.combinedScore > bestScore) { bestScore = mutatedScores.combinedScore; bestJson = workingJson; }
      results.push({
        round,
        score: mutatedScores.combinedScore,
        dimensions: Object.fromEntries(
          mutatedScores.dimensions.map((d) => [d.name, d.score]),
        ),
        issueCount: mutatedScores.issues.length,
        action: "improved",
        mutationSummary: `Score ${(scores.combinedScore * 100).toFixed(1)}% → ${(mutatedScores.combinedScore * 100).toFixed(1)}%`,
        shadow: shadowBase && { ...shadowBase, actualAction: "improved", disagreement: shadowBase.proposedRoute !== "keep" },
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
        shadow: shadowBase && { ...shadowBase, actualAction: "reverted", disagreement: shadowBase.proposedRoute === "keep" },
      });
    }
  }

  // ── Save winning config ──

  // Save winning config next to the seed template (e.g. HRE/winning/, BLADE/winning/)
  const seedDir = path.dirname(templatePath);
  const clientDir = seedDir.endsWith("/seed") ? path.dirname(seedDir) : seedDir;
  const winningDir = path.join(clientDir, "winning");
  await mkdir(winningDir, { recursive: true });
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "");
  const templateName = path.basename(templatePath);
  const winningPath = path.join(
    winningDir,
    `${timestamp}-${templateName}`,
  );
  await writeFile(winningPath, bestJson);
  console.log(`\n[Save] Winning config → ${winningPath}`);

  // ── Write experiment log ──

  // Save experiment log next to the winning configs
  const logDir = path.join(clientDir, "loop-results");
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
        startScore: baselineScores.combinedScore,
        finalScore: results[results.length - 1]?.score ?? 0,
        startDimensions: Object.fromEntries(
          baselineScores.dimensions.map((d) => [d.name, d.score]),
        ),
        results,
      },
      null,
      2,
    ),
  );
  console.log(`[Save] Experiment log → ${logPath}`);

  // ── Generate markdown notes ──

  const finalContainer = JSON.parse(bestJson) as GtmContainer;
  const finalScores = evaluateGtmSignalQuality(finalContainer, adsSnapshot);
  const notesDir = path.join(logDir, "notes");
  await mkdir(notesDir, { recursive: true });

  const startScore = baselineScores.combinedScore;
  const dimTable = finalScores.dimensions
    .map((d) => `| ${d.name} | ${(d.score * 100).toFixed(0)}% | ${d.weight} | ${d.issues.filter(i => i.severity === "error").length}E / ${d.issues.filter(i => i.severity === "warning").length}W |`)
    .join("\n");
  const roundLog = results
    .map((r) => `| ${r.round} | ${(r.score * 100).toFixed(1)}% | ${r.action} | ${r.mutationSummary} |`)
    .join("\n");
  const remainingErrors = finalScores.issues.filter((i) => i.severity === "error")
    .map((i) => `- **[${i.entity}]** ${i.message}`).join("\n") || "None";
  const warnCount = finalScores.issues.filter(i => i.severity === "warning").length;
  const remainingWarnings = finalScores.issues.filter((i) => i.severity === "warning")
    .slice(0, 20).map((i) => `- [${i.entity}] ${i.message}`).join("\n") || "None";
  const warnTrunc = warnCount > 20 ? `\n- ... and ${warnCount - 20} more warnings` : "";

  const notesPath = path.join(notesDir, `${timestamp}.md`);

  const manualSteps: string[] = [];
  for (const dim of finalScores.dimensions) {
    if (dim.score < 0.5) {
      const pct = `${(dim.score * 100).toFixed(0)}%`;
      switch (dim.name) {
        case "namingConventions":
          manualSteps.push(`- **Naming conventions (${pct})**: Bulk rename legacy tags to "Platform - Event" pattern. Use \`rename_tags\` ops in the next loop run.`); break;
        case "folderOrganization":
          manualSteps.push(`- **Folder organization (${pct})**: Create missing platform folders and assign all tags via \`assign_folders\` ops.`); break;
        case "deduplication":
          manualSteps.push(`- **Deduplication (${pct})**: Add CJS Event ID Generator variable and wire it to all Meta pixel tags.`); break;
        case "capiCoverage":
          manualSteps.push(`- **CAPI coverage (${pct})**: Check sGTM container — ensure server-side forwarding for all browser events via CAPI.`); break;
        default:
          manualSteps.push(`- **${dim.name} (${pct})**: Below 50% — needs targeted intervention.`);
      }
    }
  }

  const notesContent = `# GTM Autoresearch Loop — Run Notes

**Date**: ${new Date().toISOString().slice(0, 10)}
**Template**: ${config.templatePath}
**Ads Data**: ${snapshotLabel}
**Model**: ${MUTATION_PROVIDER}/${MUTATION_MODEL}

## Score Summary

| Metric | Value |
|--------|-------|
| Start Score | ${(startScore * 100).toFixed(1)}% |
| Best Score | ${(bestScore * 100).toFixed(1)}% |
| Improvement | +${((bestScore - startScore) * 100).toFixed(1)}pp |
| Rounds | ${results.length} |
| Improved | ${results.filter(r => r.action === "improved").length} |
| Reverted | ${results.filter(r => r.action === "reverted").length} |

## Final Dimension Scores

| Dimension | Score | Weight | Issues |
|-----------|-------|--------|--------|
${dimTable}

## Round-by-Round Log

| Round | Score | Action | Summary |
|-------|-------|--------|---------|
${roundLog}

## Remaining Errors

${remainingErrors}

## Remaining Warnings (top 20 of ${warnCount})

${remainingWarnings}${warnTrunc}

## Next Steps (Manual / Outside Loop Scope)

${manualSteps.length > 0 ? manualSteps.join("\n") : "All dimensions above 50%. Continue running the loop for incremental improvements."}

## Files

- Winning config: \`${path.relative(PROJECT_ROOT, winningPath)}\`
- Experiment log: \`${path.relative(PROJECT_ROOT, logPath)}\`
- These notes: \`${path.relative(PROJECT_ROOT, notesPath)}\`
`;

  await writeFile(notesPath, notesContent);
  console.log(`[Save] Run notes → ${notesPath}`);

  // ── Generate data audit ──

  const auditDir = path.join(logDir, "data-audits");
  await mkdir(auditDir, { recursive: true });
  const auditPath = path.join(auditDir, `${timestamp}.md`);
  const manifest = await loadClientManifest(clientDir);
  const auditContent = buildDataAuditReport({
    manifest,
    config,
    snapshotLabel,
    beforeContainer: seed,
    afterContainer: finalContainer,
    beforeScores: baselineScores,
    afterScores: finalScores,
    results,
    winningPath,
    logPath,
    notesPath,
    auditPath,
  });
  await writeFile(auditPath, auditContent);
  console.log(`[Save] Data audit → ${auditPath}`);

  // ── Post to Linear (no-op if LINEAR_API_KEY unset) ──

  await postAutoresearchRun({
    client: path.basename(clientDir),
    template: path.basename(templatePath),
    startScore: baselineScores.combinedScore,
    bestScore,
    rounds: results.length,
    improved: results.filter((r) => r.action === "improved").length,
    reverted: results.filter((r) => r.action === "reverted").length,
    notesPath,
    logPath,
    auditPath,
    winningPath,
    projectRoot: PROJECT_ROOT,
    timestamp,
  });

  // ── Summary ──

  console.log("\n=== GTM Autoresearch Loop Summary ===");
  console.log(`Rounds: ${results.length}`);
  console.log(
    `Start score: ${(baselineScores.combinedScore * 100).toFixed(1)}%`,
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
