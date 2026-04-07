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
  // Enriched fields (optional for backward compat with legacy snapshots)
  count_browser?: number;    // browser pixel event count in period
  count_server?: number;     // CAPI (server-side) event count in period
  dedup_rate?: number;       // fraction of events deduplicated (0-1)
  emq_score?: number;        // Event Match Quality 0-10 from pixel diagnostics
}

export interface MetaAdsSnapshot {
  account_id: string;
  account_name: string;
  pixel_id: string;
  currency: string;
  spend: number;
  conversion_events: MetaAdsConversionEvent[];
}

// ── Google Ads types ────────────────────────────────────────────────────────

export interface GoogleAdsConversionAction {
  id: string;
  name: string;
  category: string;          // "PURCHASE", "LEAD", "PAGE_VIEW", etc.
  status: "ENABLED" | "REMOVED" | "HIDDEN";
  counting_type: string;     // "ONE_PER_CLICK" | "MANY_PER_CLICK"
  click_through_lookback_window_days: number;
  conversion_count_30d: number;
  conversion_value_30d: number;
  tag_snippets: string[];    // e.g. ["AW-123/abcXYZ"]
}

export interface GoogleAdsSnapshot {
  customer_id: string;
  customer_name: string;
  currency: string;
  conversion_actions: GoogleAdsConversionAction[];
}

// ── Funnel analysis types ───────────────────────────────────────────────────

export interface FunnelRatio {
  from_event: string;
  to_event: string;
  ratio: number;             // to_count / from_count (0-1)
  expected_low: number;
  expected_high: number;
  status: "normal" | "low" | "high";
}

// ── Enriched snapshot (superset of MetaAdsSnapshot) ─────────────────────────

export interface EnrichedAdsSnapshot {
  generated_at: string;      // ISO 8601 timestamp
  partial?: boolean;         // true if some API calls failed during refresh
  meta?: {
    account_id: string;
    account_name: string;
    pixel_id: string;
    currency: string;
    spend: number;
    date_range: { since: string; until: string };
    conversion_events: MetaAdsConversionEvent[];
  };
  google_ads?: GoogleAdsSnapshot;
  funnel: FunnelRatio[];
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

// ── Google Ads category → GTM tag pattern map ───────────────────────────────

const GOOGLE_ADS_CATEGORY_TO_TAG_PATTERN: Record<string, RegExp> = {
  PURCHASE: /GAds.*(?:Conversion|Purchase)|awct/i,
  ADD_TO_CART: /GAds.*(?:Cart|AddToCart)/i,
  BEGIN_CHECKOUT: /GAds.*(?:Checkout)/i,
  LEAD: /GAds.*Lead/i,
  PAGE_VIEW: /GAds.*(?:Page.*View|Remarketing)/i,
  SIGNUP: /GAds.*(?:Signup|Registration)/i,
  DEFAULT: /GAds.*Conversion/i,
};

// ── Funnel step definitions (Shopify ecom benchmarks) ───────────────────────

const FUNNEL_STEPS: Array<{
  from: string;
  to: string;
  expected_low: number;
  expected_high: number;
}> = [
  { from: "view_content", to: "add_to_cart", expected_low: 0.08, expected_high: 0.25 },
  { from: "add_to_cart", to: "initiate_checkout", expected_low: 0.30, expected_high: 0.75 },
  { from: "initiate_checkout", to: "add_payment_info", expected_low: 0.40, expected_high: 0.95 },
  { from: "add_payment_info", to: "purchase", expected_low: 0.50, expected_high: 0.95 },
  { from: "initiate_checkout", to: "purchase", expected_low: 0.25, expected_high: 0.70 },
];

// ── Weight profiles based on available data ─────────────────────────────────

type WeightProfile = Record<string, number>;

const WEIGHT_PROFILES: Record<string, WeightProfile> = {
  // 8 structural dimensions only (no ads data)
  structural: {
    tagCoverage: 0.20, paramCompleteness: 0.15, deduplication: 0.10,
    consentSettings: 0.15, namingConventions: 0.10, variableHygiene: 0.10,
    triggerQuality: 0.10, folderOrganization: 0.10,
  },
  // 9 dims: + metaAdsAlignment (legacy compat)
  meta_only_legacy: {
    tagCoverage: 0.18, paramCompleteness: 0.13, deduplication: 0.10,
    consentSettings: 0.13, namingConventions: 0.08, variableHygiene: 0.08,
    triggerQuality: 0.10, folderOrganization: 0.08, metaAdsAlignment: 0.12,
  },
  // 11 dims: meta enriched (+ capiCoverage, funnelIntegrity)
  meta_enriched: {
    tagCoverage: 0.15, paramCompleteness: 0.11, deduplication: 0.07,
    consentSettings: 0.12, namingConventions: 0.07, variableHygiene: 0.07,
    triggerQuality: 0.08, folderOrganization: 0.06,
    metaAdsAlignment: 0.10, capiCoverage: 0.08, funnelIntegrity: 0.09,
  },
  // 12 dims: full enriched (meta + google ads)
  full: {
    tagCoverage: 0.14, paramCompleteness: 0.10, deduplication: 0.07,
    consentSettings: 0.11, namingConventions: 0.06, variableHygiene: 0.06,
    triggerQuality: 0.08, folderOrganization: 0.06,
    metaAdsAlignment: 0.09, capiCoverage: 0.08, funnelIntegrity: 0.07,
    googleAdsAlignment: 0.08,
  },
  // 9 dims: structural + google ads only
  google_only: {
    tagCoverage: 0.17, paramCompleteness: 0.13, deduplication: 0.09,
    consentSettings: 0.13, namingConventions: 0.08, variableHygiene: 0.08,
    triggerQuality: 0.10, folderOrganization: 0.08, googleAdsAlignment: 0.14,
  },
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

// ── CAPI Coverage scorer ────────────────────────────────────────────────────

function scoreCapiCoverage(
  tags: GtmTag[],
  variables: GtmVariable[],
  metaEvents: MetaAdsConversionEvent[],
): DimensionScore {
  const issues: GtmIssue[] = [];

  if (metaEvents.length === 0) {
    return {
      name: "capiCoverage", weight: 0.08, score: 0.5,
      issues: [{ dimension: "capiCoverage", severity: "info", entity: "snapshot", message: "No Meta conversion events in snapshot — cannot assess CAPI coverage" }],
    };
  }

  const totalValue = metaEvents.reduce((s, e) => s + e.value_7d_click, 0);
  const totalCount = metaEvents.reduce((s, e) => s + e.count_7d_click, 0);

  // Guard against division by zero when all counts are 0
  if (totalValue === 0 && totalCount === 0) {
    return {
      name: "capiCoverage", weight: 0.08, score: 0.5,
      issues: [{ dimension: "capiCoverage", severity: "warning", entity: "snapshot", message: "All Meta events have zero counts — cannot compute CAPI coverage" }],
    };
  }

  let weightedScore = 0;
  let weightedTotal = 0;

  // Check _fbc and _fbp cookie variables exist (needed for CAPI matching)
  const varNames = variables.map((v) => v.name.toLowerCase());
  const hasFbc = varNames.some((n) => n.includes("_fbc") || n.includes("fbc"));
  const hasFbp = varNames.some((n) => n.includes("_fbp") || n.includes("fbp"));

  if (!hasFbc) {
    issues.push({
      dimension: "capiCoverage",
      severity: "warning",
      entity: "variables",
      message: "Missing Cookie - _fbc variable (needed for CAPI click ID matching)",
    });
  }
  if (!hasFbp) {
    issues.push({
      dimension: "capiCoverage",
      severity: "warning",
      entity: "variables",
      message: "Missing Cookie - _fbp variable (needed for CAPI browser ID matching)",
    });
  }

  for (const event of metaEvents) {
    const eventWeight =
      totalValue > 0
        ? event.value_7d_click / totalValue
        : event.count_7d_click / totalCount;

    weightedTotal += eventWeight;

    const pattern = META_EVENT_TO_TAG_PATTERN[event.event];
    const hasBrowserTag = pattern
      ? tags.some((t) => pattern.test(t.name))
      : false;

    // Check if enriched data is available
    const hasEnrichedData =
      event.count_browser !== undefined || event.count_server !== undefined;

    if (!hasEnrichedData) {
      // No enriched data — fall back to checking browser tag existence
      if (hasBrowserTag) {
        weightedScore += eventWeight;
      } else if (pattern) {
        issues.push({
          dimension: "capiCoverage",
          severity: "warning",
          entity: event.event,
          message: `No browser pixel tag found for "${event.event}"`,
        });
      }
      continue;
    }

    let eventScore = 0;

    // Browser tag check (40% of event score)
    if (hasBrowserTag) {
      eventScore += 0.4;
    } else {
      issues.push({
        dimension: "capiCoverage",
        severity: (event.count_server ?? 0) > 0 ? "warning" : "error",
        entity: event.event,
        message: `No browser pixel tag for "${event.event}" — ${(event.count_server ?? 0) > 0 ? "relying solely on CAPI via sGTM" : "no events reaching Meta"}`,
      });
    }

    // CAPI delivery check (30% of event score)
    if ((event.count_browser ?? 0) > 0 && (event.count_server ?? 0) === 0) {
      issues.push({
        dimension: "capiCoverage",
        severity: "error",
        entity: event.event,
        message: `"${event.event}" has ${event.count_browser} browser events but 0 server events — sGTM not forwarding to CAPI (check GA4 event tag exists)`,
      });
    } else if ((event.count_server ?? 0) > 0) {
      eventScore += 0.3;
    }

    // Dedup check (15% of event score)
    if (event.dedup_rate !== undefined && event.dedup_rate >= 0) {
      if ((event.count_browser ?? 0) > 0 && (event.count_server ?? 0) > 0) {
        if (event.dedup_rate >= 0.10) {
          eventScore += 0.15;
        } else {
          issues.push({
            dimension: "capiCoverage",
            severity: "warning",
            entity: event.event,
            message: `Low dedup rate (${(event.dedup_rate * 100).toFixed(0)}%) for "${event.event}" — event_id may not be matching between browser + CAPI`,
          });
          eventScore += 0.15 * (event.dedup_rate / 0.10);
        }
      } else {
        eventScore += 0.15; // Only one source, dedup not applicable
      }
    } else {
      eventScore += 0.15; // No dedup data, skip
    }

    // EMQ check (15% of event score)
    if (event.emq_score !== undefined && event.emq_score >= 0) {
      if (event.emq_score >= 6.0) {
        eventScore += 0.15;
      } else {
        const emqPenalty = event.value_7d_click > 0 ? "warning" : "info";
        issues.push({
          dimension: "capiCoverage",
          severity: emqPenalty,
          entity: event.event,
          message: `Low EMQ (${event.emq_score.toFixed(1)}/10) for "${event.event}" — web container may not be passing sufficient user data (em, ph, fbc, fbp) to sGTM`,
        });
        eventScore += 0.15 * (event.emq_score / 6.0);
      }
    } else {
      eventScore += 0.15; // No EMQ data, skip
    }

    weightedScore += eventWeight * Math.min(1, eventScore);
  }

  // Cookie variable penalty (up to 10% reduction)
  const cookiePenalty = (!hasFbc ? 0.05 : 0) + (!hasFbp ? 0.05 : 0);
  const finalScore = weightedTotal > 0
    ? Math.max(0, (weightedScore / weightedTotal) - cookiePenalty)
    : 1;

  return { name: "capiCoverage", weight: 0.08, score: finalScore, issues };
}

// ── Funnel Integrity scorer ─────────────────────────────────────────────────

function scoreFunnelIntegrity(
  funnel: FunnelRatio[],
): DimensionScore {
  const issues: GtmIssue[] = [];

  if (funnel.length === 0) {
    return {
      name: "funnelIntegrity", weight: 0.07, score: 0.5,
      issues: [{ dimension: "funnelIntegrity", severity: "info", entity: "funnel", message: "No funnel steps computed — verify snapshot has sufficient conversion events" }],
    };
  }

  let normalSteps = 0;
  let totalSteps = 0;

  for (const step of funnel) {
    totalSteps++;

    if (step.status === "normal") {
      normalSteps++;
    } else if (step.status === "low") {
      const severityThreshold = step.expected_low * 0.5;
      if (step.ratio < severityThreshold) {
        issues.push({
          dimension: "funnelIntegrity",
          severity: "error",
          entity: `${step.from_event} → ${step.to_event}`,
          message: `Funnel ratio ${(step.ratio * 100).toFixed(0)}% is severely below expected range (${(step.expected_low * 100).toFixed(0)}-${(step.expected_high * 100).toFixed(0)}%) — likely tracking gap or broken tag`,
        });
      } else {
        issues.push({
          dimension: "funnelIntegrity",
          severity: "warning",
          entity: `${step.from_event} → ${step.to_event}`,
          message: `Funnel ratio ${(step.ratio * 100).toFixed(0)}% is below expected range (${(step.expected_low * 100).toFixed(0)}-${(step.expected_high * 100).toFixed(0)}%)`,
        });
        normalSteps += 0.5; // Partial credit
      }
    } else if (step.status === "high") {
      issues.push({
        dimension: "funnelIntegrity",
        severity: "warning",
        entity: `${step.from_event} → ${step.to_event}`,
        message: `Funnel ratio ${(step.ratio * 100).toFixed(0)}% is above expected range (${(step.expected_low * 100).toFixed(0)}-${(step.expected_high * 100).toFixed(0)}%) — possible duplicate event firing`,
      });
      normalSteps += 0.5; // Partial credit
    }
  }

  const score = totalSteps > 0 ? normalSteps / totalSteps : 1;
  return { name: "funnelIntegrity", weight: 0.07, score, issues };
}

// ── Google Ads Alignment scorer ─────────────────────────────────────────────

function scoreGoogleAdsAlignment(
  tags: GtmTag[],
  snapshot: GoogleAdsSnapshot,
): DimensionScore {
  const issues: GtmIssue[] = [];
  const actions = snapshot.conversion_actions.filter(
    (a) => a.status === "ENABLED",
  );

  if (actions.length === 0) {
    return {
      name: "googleAdsAlignment", weight: 0.08, score: 0.5,
      issues: [{ dimension: "googleAdsAlignment", severity: "info", entity: "google_ads", message: "No enabled Google Ads conversion actions found — cannot assess alignment" }],
    };
  }

  const totalValue = actions.reduce((s, a) => s + a.conversion_value_30d, 0);
  const totalCount = actions.reduce((s, a) => s + a.conversion_count_30d, 0);

  let weightedCovered = 0;
  let weightedTotal = 0;

  for (const action of actions) {
    // Skip dormant actions (0 conversions in 30 days)
    if (action.conversion_count_30d === 0) {
      issues.push({
        dimension: "googleAdsAlignment",
        severity: "info",
        entity: action.name,
        message: `Google Ads conversion "${action.name}" (${action.category}) has 0 conversions in 30 days — dormant`,
      });
      continue;
    }

    const actionWeight =
      totalValue > 0
        ? action.conversion_value_30d / totalValue
        : action.conversion_count_30d / totalCount;

    weightedTotal += actionWeight;

    // Look up the tag pattern for this category
    const pattern =
      GOOGLE_ADS_CATEGORY_TO_TAG_PATTERN[action.category] ??
      GOOGLE_ADS_CATEGORY_TO_TAG_PATTERN.DEFAULT;

    // Check for matching GTM tag by name pattern
    const matchingTag = tags.find((t) => pattern.test(t.name));

    if (matchingTag) {
      // Bonus: check if conversionId + conversionLabel match tag_snippets
      const configuredId = getParamValue(matchingTag.parameter, "conversionId");
      const configuredLabel = getParamValue(matchingTag.parameter, "conversionLabel");
      const expectedSnippet = action.tag_snippets[0]; // e.g. "AW-123/abcXYZ"

      if (expectedSnippet && configuredId && configuredLabel) {
        const fullTag = `${configuredId}/${configuredLabel}`;
        if (fullTag === expectedSnippet) {
          weightedCovered += actionWeight; // Perfect match
        } else {
          weightedCovered += actionWeight * 0.7; // Tag exists but IDs don't match
          issues.push({
            dimension: "googleAdsAlignment",
            severity: "warning",
            entity: action.name,
            message: `GTM tag "${matchingTag.name}" found but conversion label "${fullTag}" doesn't match expected "${expectedSnippet}"`,
          });
        }
      } else {
        weightedCovered += actionWeight * 0.8; // Tag exists, can't verify snippet
      }
    } else {
      const severity = action.conversion_value_30d > 0 ? "error" : "warning";
      issues.push({
        dimension: "googleAdsAlignment",
        severity,
        entity: action.name,
        message: `Google Ads conversion "${action.name}" (${action.category}, ${action.conversion_count_30d} conversions, $${action.conversion_value_30d.toLocaleString()}) has no matching GTM tag`,
      });
    }
  }

  const score = weightedTotal > 0 ? weightedCovered / weightedTotal : 1;
  return { name: "googleAdsAlignment", weight: 0.08, score, issues };
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
  adsSnapshot?: EnrichedAdsSnapshot | MetaAdsSnapshot,
): GtmSignalQualityResult {
  const cv = container.containerVersion;
  const tags = cv.tag ?? [];
  const triggers = cv.trigger ?? [];
  const variables = cv.variable ?? [];
  const folders = cv.folder ?? [];

  // Normalize legacy MetaAdsSnapshot into EnrichedAdsSnapshot shape
  let enriched: EnrichedAdsSnapshot | undefined;
  if (adsSnapshot) {
    if ("funnel" in adsSnapshot) {
      // Already an EnrichedAdsSnapshot
      enriched = adsSnapshot as EnrichedAdsSnapshot;
    } else {
      // Legacy MetaAdsSnapshot — wrap it
      const legacy = adsSnapshot as MetaAdsSnapshot;
      enriched = {
        generated_at: new Date().toISOString(),
        meta: {
          ...legacy,
          date_range: { since: "", until: "" },
        },
        funnel: [],
      };
    }
  }

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

  // Determine which weight profile to use and add platform-specific dimensions
  let profileKey = "structural";

  if (enriched?.meta && enriched?.google_ads) {
    profileKey = "full";
    dimensions.push(scoreMetaAdsAlignment(tags, enriched.meta));
    dimensions.push(scoreCapiCoverage(tags, variables, enriched.meta.conversion_events));
    dimensions.push(scoreFunnelIntegrity(enriched.funnel));
    dimensions.push(scoreGoogleAdsAlignment(tags, enriched.google_ads));
  } else if (enriched?.meta) {
    // Check if enriched data is available (count_browser/count_server fields)
    const hasEnrichedFields = enriched.meta.conversion_events.some(
      (e) => e.count_browser !== undefined || e.count_server !== undefined,
    );
    if (hasEnrichedFields || enriched.funnel.length > 0) {
      profileKey = "meta_enriched";
      dimensions.push(scoreMetaAdsAlignment(tags, enriched.meta));
      dimensions.push(scoreCapiCoverage(tags, variables, enriched.meta.conversion_events));
      dimensions.push(scoreFunnelIntegrity(enriched.funnel));
    } else {
      profileKey = "meta_only_legacy";
      dimensions.push(scoreMetaAdsAlignment(tags, enriched.meta));
    }
  } else if (enriched?.google_ads) {
    profileKey = "google_only";
    dimensions.push(scoreGoogleAdsAlignment(tags, enriched.google_ads));
  }

  // Apply weight profile
  const weights = WEIGHT_PROFILES[profileKey];
  for (const dim of dimensions) {
    if (weights[dim.name] !== undefined) {
      dim.weight = weights[dim.name];
    }
  }

  // Validate weight sum ≈ 1.0 (catch future misconfigurations)
  const weightSum = dimensions.reduce((s, d) => s + d.weight, 0);
  if (Math.abs(weightSum - 1.0) > 0.01) {
    console.error(`[EvalGTM] Weight sum is ${weightSum.toFixed(4)} (profile: ${profileKey}) — expected 1.0. Scoring may be incorrect.`);
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
const isDirectRun = process.argv[1]?.includes("eval_gtm_signal_quality");
if (isDirectRun) {
  main().catch((err) => {
    console.error("[EvalGTM] Error:", err.message);
    process.exit(1);
  });
}
