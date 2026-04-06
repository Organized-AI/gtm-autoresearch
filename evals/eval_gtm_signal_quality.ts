/**
 * GTM Signal Quality Evaluator
 *
 * Pure structural scorer: takes parsed GTM container JSON → returns 0-1 composite
 * score + per-dimension breakdown + issue list.
 *
 * 9 dimensions (weights sum to 1.0):
 *   1. Tag coverage       (0.18) — all 8 ecom events + GA4 Config + Linker + GAds conversion
 *   2. Parameter complete  (0.13) — required params per tag type
 *   3. Deduplication       (0.10) — event ID generator variable + referenced in Meta tags
 *   4. Consent settings    (0.13) — Consent Mode v2 init + per-tag consentStatus = NEEDED
 *   5. Naming conventions  (0.08) — Platform - Event tags, CE - event triggers, prefix vars
 *   6. Variable hygiene    (0.08) — no orphans, no missing refs, DLV version 2
 *   7. Trigger quality     (0.10) — EQUALS filters, no orphan/duplicate triggers
 *   8. Folder organization (0.08) — all entities assigned to correct logical folders
 *   9. Meta Ads alignment  (0.12) — container covers events actually firing in Meta Ads, weighted by value
 *
 * CLI: npx tsx evals/eval_gtm_signal_quality.ts <container.json>
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GtmContainer {
  exportFormatVersion: number;
  containerVersion: {
    tag?: GtmTag[];
    trigger?: GtmTrigger[];
    variable?: GtmVariable[];
    folder?: GtmFolder[];
    builtInVariable?: Array<{ type: string; name: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GtmTag {
  tagId: string;
  name: string;
  type: string;
  parameter?: GtmParam[];
  firingTriggerId?: string[];
  consentSettings?: { consentStatus: string };
  parentFolderId?: string;
  tagFiringOption?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface GtmTrigger {
  triggerId: string;
  name: string;
  type: string;
  customEventFilter?: Array<{
    type: string;
    parameter?: GtmParam[];
  }>;
  parentFolderId?: string;
  [key: string]: unknown;
}

export interface GtmVariable {
  variableId: string;
  name: string;
  type: string;
  parameter?: GtmParam[];
  parentFolderId?: string;
  [key: string]: unknown;
}

export interface GtmFolder {
  folderId: string;
  name: string;
  [key: string]: unknown;
}

export interface GtmParam {
  type: string;
  key: string;
  value?: string;
  list?: GtmParam[];
  map?: GtmParam[];
  [key: string]: unknown;
}

export type IssueSeverity = "error" | "warning" | "info";

export interface GtmIssue {
  dimension: string;
  severity: IssueSeverity;
  entity: string;
  message: string;
}

export interface DimensionScore {
  name: string;
  weight: number;
  score: number;
  issues: GtmIssue[];
}

export interface GtmSignalQualityResult {
  combinedScore: number;
  dimensions: DimensionScore[];
  issues: GtmIssue[];
  tagCount: number;
  triggerCount: number;
  variableCount: number;
  folderCount: number;
}

export interface MetaAdsConversionEvent {
  event: string;
  count_7d_click: number;
  count_1d_click: number;
  count_1d_view: number;
  value_7d_click: number;
}

export interface MetaAdsSnapshot {
  account_id: string;
  account_name: string;
  pixel_id: string;
  currency: string;
  spend: number;
  conversion_events: MetaAdsConversionEvent[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const REQUIRED_ECOM_EVENTS = [
  "view_item",
  "view_item_list",
  "select_item",
  "add_to_cart",
  "view_cart",
  "begin_checkout",
  "add_payment_info",
  "purchase",
];

const REQUIRED_INFRA_TAGS = [
  { pattern: /GA4.*Config/i, label: "GA4 Config" },
  { pattern: /Conversion\s*Linker|gclidw/i, label: "Conversion Linker" },
  { pattern: /GAds.*Conversion|awct/i, label: "GAds Conversion" },
];

const TAG_PARAM_REQUIREMENTS: Record<string, string[]> = {
  gaawe: ["sendEcommerceData", "eventName", "measurementIdOverride"],
  awct: ["conversionId", "conversionLabel", "conversionValue", "currencyCode"],
  googtag: ["tagId"],
};

const VAR_PREFIX_MAP: Record<string, string> = {
  c: "Const",
  v: "DLV",
  jsm: "CJS",
  k: "Cookie",
};

const FOLDER_TAG_MAP: Record<string, RegExp> = {
  GA4: /^GA4\s*-/,
  Meta: /^Meta\s*-/,
  "Google Ads": /^GAds\s*-/,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getParamValue(params: GtmParam[] | undefined, key: string): string | undefined {
  if (!params) return undefined;
  const p = params.find((p) => p.key === key);
  return p?.value;
}

function extractVariableRefs(text: string): string[] {
  const refs: string[] = [];
  const re = /\{\{([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    refs.push(m[1]);
  }
  return refs;
}

function allVariableRefs(tag: GtmTag): string[] {
  const refs: string[] = [];
  const walk = (params: GtmParam[] | undefined) => {
    if (!params) return;
    for (const p of params) {
      if (p.value) refs.push(...extractVariableRefs(p.value));
      if (p.list) walk(p.list);
      if (p.map) walk(p.map);
    }
  };
  walk(tag.parameter);
  return refs;
}

// ── Dimension scorers ────────────────────────────────────────────────────────

function scoreTagCoverage(tags: GtmTag[]): DimensionScore {
  const issues: GtmIssue[] = [];
  const tagNames = tags.map((t) => t.name.toLowerCase());
  const tagTypes = tags.map((t) => t.type);

  // Check ecom events via GA4 event tags
  let ecomHits = 0;
  for (const event of REQUIRED_ECOM_EVENTS) {
    const found = tags.some(
      (t) =>
        t.type === "gaawe" &&
        getParamValue(t.parameter, "eventName") === event,
    );
    if (found) {
      ecomHits++;
    } else {
      issues.push({
        dimension: "tagCoverage",
        severity: "error",
        entity: event,
        message: `Missing GA4 event tag for "${event}"`,
      });
    }
  }

  // Check infra tags
  let infraHits = 0;
  for (const req of REQUIRED_INFRA_TAGS) {
    const found = tags.some(
      (t) => req.pattern.test(t.name) || req.pattern.test(t.type),
    );
    if (found) {
      infraHits++;
    } else {
      issues.push({
        dimension: "tagCoverage",
        severity: "error",
        entity: req.label,
        message: `Missing required tag: ${req.label}`,
      });
    }
  }

  const total = REQUIRED_ECOM_EVENTS.length + REQUIRED_INFRA_TAGS.length;
  const score = (ecomHits + infraHits) / total;

  return { name: "tagCoverage", weight: 0.20, score, issues };
}

function scoreParameterCompleteness(tags: GtmTag[]): DimensionScore {
  const issues: GtmIssue[] = [];
  let checks = 0;
  let passes = 0;

  for (const tag of tags) {
    const reqs = TAG_PARAM_REQUIREMENTS[tag.type];
    if (!reqs) continue;

    for (const key of reqs) {
      checks++;
      const val = getParamValue(tag.parameter, key);
      if (val !== undefined && val !== "") {
        passes++;
      } else {
        issues.push({
          dimension: "paramCompleteness",
          severity: "warning",
          entity: tag.name,
          message: `Missing required param "${key}"`,
        });
      }
    }
  }

  const score = checks > 0 ? passes / checks : 1;
  return { name: "paramCompleteness", weight: 0.15, score, issues };
}

function scoreDeduplication(tags: GtmTag[], variables: GtmVariable[]): DimensionScore {
  const issues: GtmIssue[] = [];
  let score = 0;

  // Check for event ID generator variable
  const hasEventIdVar = variables.some(
    (v) => /event\s*id/i.test(v.name) && v.type === "jsm",
  );
  if (hasEventIdVar) {
    score += 0.5;
  } else {
    issues.push({
      dimension: "deduplication",
      severity: "error",
      entity: "variables",
      message: "Missing CJS Event ID Generator variable",
    });
  }

  // Check Meta tags reference the event ID generator
  const metaTags = tags.filter((t) => /meta/i.test(t.name));
  if (metaTags.length === 0) {
    score += 0.5; // No meta tags = no dedup needed
  } else {
    let metaWithEventId = 0;
    for (const tag of metaTags) {
      const refs = allVariableRefs(tag);
      if (refs.some((r) => /event\s*id/i.test(r))) {
        metaWithEventId++;
      } else {
        issues.push({
          dimension: "deduplication",
          severity: "warning",
          entity: tag.name,
          message: "Meta tag does not reference Event ID Generator",
        });
      }
    }
    score += 0.5 * (metaWithEventId / metaTags.length);
  }

  return { name: "deduplication", weight: 0.10, score, issues };
}

function scoreConsentSettings(tags: GtmTag[]): DimensionScore {
  const issues: GtmIssue[] = [];
  let score = 0;

  // Check for consent init tag (Consent Mode v2)
  const hasConsentInit = tags.some(
    (t) =>
      /consent/i.test(t.name) &&
      (/init/i.test(t.name) || t.type === "consent_init"),
  );

  if (hasConsentInit) {
    score += 0.4;
  } else {
    issues.push({
      dimension: "consentSettings",
      severity: "error",
      entity: "container",
      message: "Missing Consent Mode v2 initialization tag",
    });
  }

  // Check per-tag consentStatus
  const trackingTags = tags.filter(
    (t) =>
      t.type !== "consent_init" &&
      !/consent/i.test(t.name),
  );

  if (trackingTags.length === 0) {
    score += 0.6;
  } else {
    let consentSet = 0;
    for (const tag of trackingTags) {
      const status = tag.consentSettings?.consentStatus;
      if (status === "NEEDED") {
        consentSet++;
      } else {
        issues.push({
          dimension: "consentSettings",
          severity: status === "NOT_SET" ? "error" : "warning",
          entity: tag.name,
          message: `consentStatus is "${status ?? "missing"}" — should be "NEEDED"`,
        });
      }
    }
    score += 0.6 * (consentSet / trackingTags.length);
  }

  return { name: "consentSettings", weight: 0.15, score, issues };
}

function scoreNamingConventions(
  tags: GtmTag[],
  triggers: GtmTrigger[],
  variables: GtmVariable[],
): DimensionScore {
  const issues: GtmIssue[] = [];
  let checks = 0;
  let passes = 0;

  // Tags: "Platform - Event" pattern
  for (const tag of tags) {
    checks++;
    if (/^\w[\w\d]*\s*-\s*.+/.test(tag.name)) {
      passes++;
    } else {
      issues.push({
        dimension: "namingConventions",
        severity: "warning",
        entity: tag.name,
        message: `Tag name does not follow "Platform - Event" pattern`,
      });
    }
  }

  // Triggers: "CE - event" for custom event triggers
  for (const trigger of triggers) {
    if (trigger.type !== "CUSTOM_EVENT") continue;
    checks++;
    if (/^CE\s*-\s*.+/.test(trigger.name)) {
      passes++;
    } else {
      issues.push({
        dimension: "namingConventions",
        severity: "warning",
        entity: trigger.name,
        message: `Custom event trigger should use "CE - event" pattern`,
      });
    }
  }

  // Variables: prefix by type
  for (const v of variables) {
    const expectedPrefix = VAR_PREFIX_MAP[v.type];
    if (!expectedPrefix) continue;
    checks++;
    if (v.name.startsWith(`${expectedPrefix} -`) || v.name.startsWith(`${expectedPrefix} `)) {
      passes++;
    } else {
      issues.push({
        dimension: "namingConventions",
        severity: "warning",
        entity: v.name,
        message: `Variable should start with "${expectedPrefix} -"`,
      });
    }
  }

  const score = checks > 0 ? passes / checks : 1;
  return { name: "namingConventions", weight: 0.10, score, issues };
}

function scoreVariableHygiene(
  tags: GtmTag[],
  variables: GtmVariable[],
): DimensionScore {
  const issues: GtmIssue[] = [];
  let checks = 0;
  let passes = 0;

  // Collect all variable references from tags
  const allRefs = new Set<string>();
  for (const tag of tags) {
    for (const ref of allVariableRefs(tag)) {
      allRefs.add(ref);
    }
  }

  const varNames = new Set(variables.map((v) => v.name));

  // Check for orphan variables (defined but never referenced)
  for (const v of variables) {
    checks++;
    if (allRefs.has(v.name)) {
      passes++;
    } else {
      issues.push({
        dimension: "variableHygiene",
        severity: "info",
        entity: v.name,
        message: "Variable defined but not referenced by any tag",
      });
      passes += 0.5; // Minor penalty
    }
  }

  // Check for missing refs (referenced but not defined)
  const builtInPrefixes = ["_event", "Page URL", "Page Hostname", "Page Path", "Referrer", "Event"];
  for (const ref of allRefs) {
    if (varNames.has(ref)) continue;
    if (builtInPrefixes.includes(ref)) continue;
    checks++;
    issues.push({
      dimension: "variableHygiene",
      severity: "error",
      entity: ref,
      message: `Variable "{{${ref}}}" referenced but not defined`,
    });
  }

  // DLV version check
  const dlvVars = variables.filter((v) => v.type === "v");
  for (const v of dlvVars) {
    checks++;
    const version = getParamValue(v.parameter, "dataLayerVersion");
    if (version === "2") {
      passes++;
    } else {
      issues.push({
        dimension: "variableHygiene",
        severity: "warning",
        entity: v.name,
        message: `DLV dataLayerVersion is "${version}" — should be "2"`,
      });
    }
  }

  const score = checks > 0 ? passes / checks : 1;
  return { name: "variableHygiene", weight: 0.10, score: Math.min(1, score), issues };
}

function scoreTriggerQuality(
  tags: GtmTag[],
  triggers: GtmTrigger[],
): DimensionScore {
  const issues: GtmIssue[] = [];
  let checks = 0;
  let passes = 0;

  // Check EQUALS filter on custom event triggers
  for (const trigger of triggers) {
    if (trigger.type !== "CUSTOM_EVENT") continue;
    checks++;
    const hasEquals = trigger.customEventFilter?.some((f) => f.type === "EQUALS");
    if (hasEquals) {
      passes++;
    } else {
      issues.push({
        dimension: "triggerQuality",
        severity: "error",
        entity: trigger.name,
        message: "Custom event trigger missing EQUALS filter",
      });
    }
  }

  // Check for orphan triggers (not referenced by any tag)
  const usedTriggerIds = new Set<string>();
  for (const tag of tags) {
    for (const tid of tag.firingTriggerId ?? []) {
      usedTriggerIds.add(tid);
    }
  }

  for (const trigger of triggers) {
    checks++;
    if (usedTriggerIds.has(trigger.triggerId)) {
      passes++;
    } else {
      issues.push({
        dimension: "triggerQuality",
        severity: "warning",
        entity: trigger.name,
        message: "Trigger not used by any tag",
      });
    }
  }

  // Check for duplicate triggers (same event name)
  const eventNames = new Map<string, string[]>();
  for (const trigger of triggers) {
    if (trigger.type !== "CUSTOM_EVENT") continue;
    const eventFilter = trigger.customEventFilter?.find((f) => f.type === "EQUALS");
    const eventName = eventFilter?.parameter?.find((p) => p.key === "arg1")?.value;
    if (eventName) {
      const existing = eventNames.get(eventName) ?? [];
      existing.push(trigger.name);
      eventNames.set(eventName, existing);
    }
  }
  for (const [event, names] of eventNames) {
    if (names.length > 1) {
      checks++;
      issues.push({
        dimension: "triggerQuality",
        severity: "warning",
        entity: names.join(", "),
        message: `Duplicate triggers for event "${event}"`,
      });
    }
  }

  const score = checks > 0 ? passes / checks : 1;
  return { name: "triggerQuality", weight: 0.10, score, issues };
}

function scoreFolderOrganization(
  tags: GtmTag[],
  variables: GtmVariable[],
  folders: GtmFolder[],
): DimensionScore {
  const issues: GtmIssue[] = [];
  let checks = 0;
  let passes = 0;

  const folderMap = new Map(folders.map((f) => [f.folderId, f.name]));

  // Check tags are in correct folders
  for (const tag of tags) {
    checks++;
    if (!tag.parentFolderId) {
      issues.push({
        dimension: "folderOrganization",
        severity: "warning",
        entity: tag.name,
        message: "Tag not assigned to any folder",
      });
      continue;
    }

    const folderName = folderMap.get(tag.parentFolderId);
    let correct = false;
    for (const [expectedFolder, pattern] of Object.entries(FOLDER_TAG_MAP)) {
      if (pattern.test(tag.name)) {
        if (folderName === expectedFolder) {
          correct = true;
        } else {
          issues.push({
            dimension: "folderOrganization",
            severity: "warning",
            entity: tag.name,
            message: `Tag in "${folderName}" folder — expected "${expectedFolder}"`,
          });
        }
        break;
      }
    }
    if (correct || !Object.values(FOLDER_TAG_MAP).some((p) => p.test(tag.name))) {
      passes++; // Correct folder or no matching rule
    }
  }

  // Check variables have folders
  for (const v of variables) {
    checks++;
    if (v.parentFolderId) {
      passes++;
    } else {
      issues.push({
        dimension: "folderOrganization",
        severity: "info",
        entity: v.name,
        message: "Variable not assigned to any folder",
      });
    }
  }

  const score = checks > 0 ? passes / checks : 1;
  return { name: "folderOrganization", weight: 0.10, score, issues };
}

// ── Meta Ads alignment scorer ────────────────────────────────────────────────

// Maps Meta Ads event names → expected GTM Meta tag name patterns
const META_EVENT_TO_TAG_PATTERN: Record<string, RegExp> = {
  view_content: /meta.*view\s*content/i,
  add_to_cart: /meta.*add\s*to\s*cart/i,
  initiate_checkout: /meta.*initiate\s*checkout/i,
  add_payment_info: /meta.*add\s*payment/i,
  purchase: /meta.*purchase/i,
  search: /meta.*search/i,
  lead: /meta.*lead/i,
  add_to_wishlist: /meta.*wishlist/i,
  complete_registration: /meta.*registration/i,
};

function scoreMetaAdsAlignment(
  tags: GtmTag[],
  snapshot: MetaAdsSnapshot,
): DimensionScore {
  const issues: GtmIssue[] = [];
  const events = snapshot.conversion_events;

  if (events.length === 0) {
    return { name: "metaAdsAlignment", weight: 0.12, score: 1, issues };
  }

  // Calculate total conversion value for weighting
  const totalValue = events.reduce((s, e) => s + e.value_7d_click, 0);
  const totalCount = events.reduce((s, e) => s + e.count_7d_click, 0);

  let weightedCovered = 0;
  let weightedTotal = 0;

  for (const event of events) {
    // Weight by conversion value if available, fall back to count proportion
    const eventWeight =
      totalValue > 0
        ? event.value_7d_click / totalValue
        : event.count_7d_click / totalCount;

    weightedTotal += eventWeight;

    const pattern = META_EVENT_TO_TAG_PATTERN[event.event];
    if (!pattern) {
      // Unknown event type — give partial credit (not a GTM concern)
      weightedCovered += eventWeight * 0.5;
      issues.push({
        dimension: "metaAdsAlignment",
        severity: "info",
        entity: event.event,
        message: `Meta event "${event.event}" has no known GTM tag pattern (${event.count_7d_click} events, $${event.value_7d_click.toLocaleString()})`,
      });
      continue;
    }

    const hasTag = tags.some((t) => pattern.test(t.name));
    if (hasTag) {
      weightedCovered += eventWeight;
    } else {
      const severity = event.value_7d_click > 0 ? "error" : "warning";
      issues.push({
        dimension: "metaAdsAlignment",
        severity,
        entity: event.event,
        message: `Meta fires "${event.event}" (${event.count_7d_click} events, $${event.value_7d_click.toLocaleString()} value) but no GTM Meta tag found`,
      });
    }
  }

  const score = weightedTotal > 0 ? weightedCovered / weightedTotal : 1;
  return { name: "metaAdsAlignment", weight: 0.12, score, issues };
}

// ── Main evaluator ───────────────────────────────────────────────────────────

export function evaluateGtmSignalQuality(
  container: GtmContainer,
  metaAdsSnapshot?: MetaAdsSnapshot,
): GtmSignalQualityResult {
  const cv = container.containerVersion;
  const tags = cv.tag ?? [];
  const triggers = cv.trigger ?? [];
  const variables = cv.variable ?? [];
  const folders = cv.folder ?? [];

  const dimensions: DimensionScore[] = [
    scoreTagCoverage(tags),
    scoreParameterCompleteness(tags),
    scoreDeduplication(tags, variables),
    scoreConsentSettings(tags),
    scoreNamingConventions(tags, triggers, variables),
    scoreVariableHygiene(tags, variables),
    scoreTriggerQuality(tags, triggers),
    scoreFolderOrganization(tags, variables, folders),
  ];

  // When Meta Ads snapshot is provided, rebalance weights and add 9th dimension
  if (metaAdsSnapshot) {
    // Rebalance: shave from structural dims to make room for Meta alignment
    const rebalancedWeights: Record<string, number> = {
      tagCoverage: 0.18,
      paramCompleteness: 0.13,
      deduplication: 0.10,
      consentSettings: 0.13,
      namingConventions: 0.08,
      variableHygiene: 0.08,
      triggerQuality: 0.10,
      folderOrganization: 0.08,
    };
    for (const dim of dimensions) {
      dim.weight = rebalancedWeights[dim.name] ?? dim.weight;
    }
    dimensions.push(scoreMetaAdsAlignment(tags, metaAdsSnapshot));
  }

  const combinedScore = dimensions.reduce(
    (sum, d) => sum + d.weight * d.score,
    0,
  );

  const issues = dimensions.flatMap((d) => d.issues);

  return {
    combinedScore: Number(combinedScore.toFixed(4)),
    dimensions,
    issues,
    tagCount: tags.length,
    triggerCount: triggers.length,
    variableCount: variables.length,
    folderCount: folders.length,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const metaFlagIdx = args.indexOf("--meta-snapshot");
  let metaSnapshotPath: string | undefined;
  if (metaFlagIdx !== -1) {
    metaSnapshotPath = args[metaFlagIdx + 1];
    args.splice(metaFlagIdx, 2);
  }

  const filePath = args[0];
  if (!filePath) {
    console.error("Usage: npx tsx evals/eval_gtm_signal_quality.ts <container.json> [--meta-snapshot <snapshot.json>]");
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  const raw = await readFile(absPath, "utf-8");
  const container: GtmContainer = JSON.parse(raw);

  let metaSnapshot: MetaAdsSnapshot | undefined;
  if (metaSnapshotPath) {
    const metaRaw = await readFile(path.resolve(metaSnapshotPath), "utf-8");
    metaSnapshot = JSON.parse(metaRaw) as MetaAdsSnapshot;
    console.log(`[Meta] Loaded snapshot: ${metaSnapshot.account_name} (${metaSnapshot.conversion_events.length} events)`);
  }

  const result = evaluateGtmSignalQuality(container, metaSnapshot);

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

main().catch((err) => {
  console.error("[EvalGTM] Error:", err.message);
  process.exit(1);
});
