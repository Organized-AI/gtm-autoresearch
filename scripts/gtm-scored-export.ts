/** Local-only scored GTM export bundles. This module never contacts Google. */
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  evaluateGtmSignalQuality,
  type EnrichedAdsSnapshot,
  type GtmContainer,
  type GtmSignalQualityResult,
  type MetaAdsSnapshot,
} from "../evals/eval_gtm_signal_quality.js";

type JsonRecord = Record<string, unknown>;
const SYSTEM_TRIGGER_IDS = new Set(["2147479553", "2147479572", "2147479573"]);
const SYSTEM_VARIABLE_NAMES = new Set(["_event", "_gtm", "_containerId", "_pageLoadTime"]);
const KNOWN_INVALID_TRIGGER_TYPES = new Set(["CONSENT_INITIALIZATION_ALL_PAGES"]);
const USAGE_CONTEXTS = new Set(["WEB", "SERVER", "AMP", "web", "server", "amp", "android", "ios", "androidSdk5", "iosSdk5"]);
export type ExportSourceKind = "saved-container" | "optimization-winner" | "synthetic-demo";
export interface ExportValidation { status: "passed" | "blocked"; errors: string[]; warnings: string[]; }
export interface ScoredExportReport {
  schemaVersion: "gtm-scored-export-v1";
  container: { name: string | null; publicId: string | null; usageContext: string[] };
  source: { kind: ExportSourceKind; name: string | null; sha256: string; adsSnapshotSha256: string | null };
  scoring: { profile: string; candidate: GtmSignalQualityResult; baseline: GtmSignalQualityResult | null; baselineSha256: string | null };
  validation: ExportValidation;
  readiness: { status: "ready-for-import-review" | "blocked"; blockers: string[] };
  jev: { status: "not-evaluated" };
  createdAt: string;
}
export interface CreateScoredExportOptions {
  containerBytes: Buffer | string;
  sourceKind: ExportSourceKind;
  outputDir: string;
  sourceName?: string;
  baselineBytes?: Buffer | string;
  adsSnapshot?: EnrichedAdsSnapshot | MetaAdsSnapshot;
  createdAt?: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sha256(bytes: Buffer | string): string { return createHash("sha256").update(bytes).digest("hex"); }
function array(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.filter(isRecord) : []; }
function text(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }

function profileFor(result: GtmSignalQualityResult): string {
  const names = new Set(result.dimensions.map((dimension) => dimension.name));
  if (names.has("googleAdsAlignment") && names.has("metaAdsAlignment")) return "full";
  if (names.has("googleAdsAlignment")) return "google_only";
  if (names.has("capiCoverage")) return "meta_enriched";
  if (names.has("metaAdsAlignment")) return "meta_only_legacy";
  return "structural";
}

function references(value: unknown, names: Set<string>, unknown: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
      const name = match[1].trim();
      if (name && !names.has(name) && !SYSTEM_VARIABLE_NAMES.has(name)) unknown.add(name);
    }
  } else if (Array.isArray(value)) for (const item of value) references(item, names, unknown);
  else if (isRecord(value)) for (const item of Object.values(value)) references(item, names, unknown);
}

/** Conservative structural checks: warnings preserve reviewability; errors block import review. */
export function validateGtmContainer(container: unknown): ExportValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(container)) return { status: "blocked", errors: ["Container must be a JSON object"], warnings };
  if (container.exportFormatVersion !== 2) errors.push("exportFormatVersion must be 2 for a GTM v2 import export");
  if (!isRecord(container.containerVersion)) {
    errors.push("containerVersion must be an object");
    return { status: "blocked", errors, warnings };
  }
  const cv = container.containerVersion;
  if (!isRecord(cv.container)) errors.push("containerVersion.container must be an object");
  else {
    if (!text(cv.container.name)) errors.push("containerVersion.container.name must be a non-empty string");
    if (!text(cv.container.publicId)) errors.push("containerVersion.container.publicId must be a non-empty string");
    if (!Array.isArray(cv.container.usageContext) || cv.container.usageContext.length === 0 || cv.container.usageContext.some((entry) => !text(entry) || !USAGE_CONTEXTS.has(entry))) errors.push("containerVersion.container.usageContext must be a non-empty array of recognized GTM usage contexts");
  }
  const collections: Array<[string, string]> = [["tag", "tagId"], ["trigger", "triggerId"], ["variable", "variableId"], ["folder", "folderId"]];
  const ids = new Map<string, Set<string>>();
  for (const [collection, idField] of collections) {
    const values = cv[collection];
    if (values !== undefined && !Array.isArray(values)) errors.push(`containerVersion.${collection} must be an array when present`);
    if (Array.isArray(values) && values.some((entity) => !isRecord(entity))) errors.push(`containerVersion.${collection} must contain only object entities`);
    const seen = new Set<string>(); ids.set(collection, seen);
    for (const entity of array(values)) {
      const id = entity[idField];
      if (!text(id)) errors.push(`${collection} has a missing ${idField}`);
      else if (seen.has(id)) errors.push(`Duplicate ${collection} ID '${id}'`);
      else seen.add(id);
      if (!text(entity.name)) errors.push(`${collection} '${String(id ?? "unknown")}' has a missing name`);
      if (collection !== "folder" && !text(entity.type)) errors.push(`${collection} '${String(id ?? "unknown")}' has a missing type`);
    }
  }
  for (const trigger of array(cv.trigger)) if (KNOWN_INVALID_TRIGGER_TYPES.has(String(trigger.type))) errors.push(`Trigger '${String(trigger.name ?? trigger.triggerId ?? "unknown")}' uses unsupported type '${String(trigger.type)}'; use GTM consentInit or the system trigger instead`);
  const triggerIds = ids.get("trigger")!;
  const folderIds = ids.get("folder")!;
  for (const tag of array(cv.tag)) {
    for (const field of ["firingTriggerId", "blockingTriggerId"]) {
      if (tag[field] !== undefined && !Array.isArray(tag[field])) errors.push(`Tag '${String(tag.name ?? tag.tagId ?? "unknown")}' has malformed ${field}; expected an array`);
      for (const id of Array.isArray(tag[field]) ? tag[field] : []) {
        if (!text(id) || (!triggerIds.has(id) && !SYSTEM_TRIGGER_IDS.has(id))) errors.push(`Tag '${String(tag.name ?? tag.tagId ?? "unknown")}' references missing ${field} '${String(id)}'`);
      }
    }
  }
  for (const [collection] of collections.slice(0, 3)) for (const entity of array(cv[collection])) {
    if (entity.parentFolderId !== undefined && (!text(entity.parentFolderId) || !folderIds.has(entity.parentFolderId))) errors.push(`${collection} '${String(entity.name ?? "unknown")}' references missing parentFolderId '${String(entity.parentFolderId)}'`);
  }
  const variableNames = new Set([...array(cv.variable), ...array(cv.builtInVariable)].map((entity) => entity.name).filter(text));
  const missingVariables = new Set<string>();
  for (const collection of ["tag", "trigger", "variable"]) for (const entity of array(cv[collection])) references(entity, variableNames, missingVariables);
  for (const name of missingVariables) errors.push(`Reference to missing GTM variable '{{${name}}}'`);
  const templateIds = new Set(array(cv.customTemplate).map((template) => template.templateId).filter(text));
  const templateRefs: Array<{ value: unknown; label: string }> = [];
  const visitTemplates = (value: unknown, label: string): void => {
    if (Array.isArray(value)) value.forEach((item) => visitTemplates(item, label));
    else if (isRecord(value)) for (const [key, item] of Object.entries(value)) {
      if (/customTemplateId|templateId/i.test(key)) templateRefs.push({ value: item, label });
      visitTemplates(item, label);
    }
  };
  for (const collection of ["tag", "trigger", "variable"]) for (const entity of array(cv[collection])) visitTemplates(entity, `${collection} '${String(entity.name ?? "unknown")}'`);
  for (const ref of templateRefs) if (text(ref.value) && !templateIds.has(ref.value)) errors.push(`${ref.label} references missing custom template '${ref.value}'`);
  for (const collection of ["tag", "trigger", "variable"]) for (const entity of array(cv[collection])) {
    if (!text(entity.type) || !entity.type.startsWith("cvt_")) continue;
    const numericRef = entity.type.match(/^cvt_(?:\d+_)?(\d+)$/)?.[1];
    if (numericRef && !templateIds.has(numericRef)) errors.push(`${collection} '${String(entity.name ?? "unknown")}' type '${entity.type}' references missing custom template '${numericRef}'`);
    else if (!numericRef) warnings.push(`${collection} '${String(entity.name ?? "unknown")}' has opaque custom template type '${entity.type}'; verify its provider/native template during import review`);
  }
  const serialized = JSON.stringify(container);
  const placeholders = [...serialized.matchAll(/%%[A-Z0-9_]+%%/g)].map((match) => match[0]);
  if (placeholders.length) warnings.push(`Unresolved hydration placeholders: ${[...new Set(placeholders)].join(", ")}`);
  warnings.push("Schema checks are offline only; Google Tag Manager has not accepted or QA-verified this container");
  return { status: errors.length ? "blocked" : "passed", errors, warnings };
}

export async function createScoredGtmExport(options: CreateScoredExportOptions): Promise<{ report: ScoredExportReport; outputDir: string }> {
  let exists = false;
  try { await access(options.outputDir); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (exists) throw new Error(`Refusing to overwrite existing output directory: ${options.outputDir}`);
  const bytes = Buffer.isBuffer(options.containerBytes) ? options.containerBytes : Buffer.from(options.containerBytes);
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch (error) { parsed = null; }
  const validation = parsed === null ? { status: "blocked" as const, errors: ["container.json is not valid JSON"], warnings: [] } : validateGtmContainer(parsed);
  const emptyScore: GtmSignalQualityResult = { combinedScore: 0, dimensions: [], issues: [], tagCount: 0, triggerCount: 0, variableCount: 0, folderCount: 0 };
  let candidate = emptyScore;
  if (parsed && isRecord(parsed) && isRecord(parsed.containerVersion)) {
    try { candidate = evaluateGtmSignalQuality(parsed as GtmContainer, options.adsSnapshot); }
    catch (error) { validation.errors.push(`Candidate scoring failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  let baseline: GtmSignalQualityResult | null = null;
  const baselineSha256 = options.baselineBytes ? sha256(options.baselineBytes) : null;
  let baselineContainer: unknown;
  if (options.baselineBytes) {
    try { baselineContainer = JSON.parse(Buffer.from(options.baselineBytes).toString("utf8")); baseline = evaluateGtmSignalQuality(baselineContainer as GtmContainer, options.adsSnapshot); }
    catch { validation.warnings.push("Baseline was not scored because it is not valid GTM JSON"); }
  }
  if (parsed && isRecord(parsed) && isRecord(parsed.containerVersion)) {
    const candidateTypes = new Set(array(parsed.containerVersion.tag).map((tag) => tag.type).filter(text));
    const baselineTypes = isRecord(baselineContainer) && isRecord(baselineContainer.containerVersion)
      ? new Set(array(baselineContainer.containerVersion.tag).map((tag) => tag.type).filter(text)) : new Set<string>();
    // A provider/native opaque template type that is already present in the
    // saved baseline is provenance, not a newly introduced review concern.
    for (const inherited of [...candidateTypes].filter((type) => /^cvt_[^0-9]/.test(type) && baselineTypes.has(type))) {
      validation.warnings = validation.warnings.filter((warning) => !warning.includes(`opaque custom template type '${inherited}'`));
    }
    if (candidateTypes.has("googtag_init_consent")) {
      validation.warnings.push(baselineContainer && !baselineTypes.has("googtag_init_consent")
        ? "Tag type googtag_init_consent was introduced after the baseline and has not been verified against GTM; confirm in import preview"
        : "Tag type googtag_init_consent has not been verified against GTM; confirm in import preview");
    }
  }
  validation.status = validation.errors.length === 0 ? "passed" : "blocked";
  const cv = isRecord(parsed) && isRecord(parsed.containerVersion) ? parsed.containerVersion : {};
  const c = isRecord(cv.container) ? cv.container : {};
  // A hydration token is structurally valid JSON, but it is not safe to offer
  // for import review until a real saved container has supplied the value.
  const blockers = [...validation.errors, ...validation.warnings.filter((warning) => warning.startsWith("Unresolved hydration placeholders:"))];
  const report: ScoredExportReport = {
    schemaVersion: "gtm-scored-export-v1",
    container: { name: text(c.name) ? c.name : null, publicId: text(c.publicId) ? c.publicId : null, usageContext: Array.isArray(c.usageContext) ? c.usageContext.filter(text) : [] },
    source: { kind: options.sourceKind, name: options.sourceName ?? null, sha256: sha256(bytes), adsSnapshotSha256: options.adsSnapshot ? sha256(JSON.stringify(options.adsSnapshot)) : null },
    scoring: { profile: profileFor(candidate), candidate, baseline, baselineSha256 }, validation,
    readiness: { status: validation.status === "passed" && blockers.length === 0 ? "ready-for-import-review" : "blocked", blockers },
    jev: { status: "not-evaluated" }, createdAt: options.createdAt ?? new Date().toISOString(),
  };
  await mkdir(path.dirname(options.outputDir), { recursive: true });
  const temp = await mkdtemp(path.join(path.dirname(options.outputDir), ".gtm-scored-export-"));
  try {
    const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(temp, "container.json"), bytes);
    await writeFile(path.join(temp, "report.json"), reportBytes);
    await writeFile(path.join(temp, "manifest.json"), `${JSON.stringify({ schemaVersion: "gtm-scored-export-v1", files: { "container.json": sha256(bytes), "report.json": sha256(reportBytes) } }, null, 2)}\n`);
    await rename(temp, options.outputDir);
  } catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
  return { report, outputDir: options.outputDir };
}

export async function createScoredGtmExportFromFiles(options: Omit<CreateScoredExportOptions, "containerBytes" | "baselineBytes"> & { containerPath: string; baselinePath?: string }): Promise<{ report: ScoredExportReport; outputDir: string }> {
  return createScoredGtmExport({ ...options, sourceName: options.sourceName ?? path.basename(options.containerPath), containerBytes: await readFile(options.containerPath), baselineBytes: options.baselinePath ? await readFile(options.baselinePath) : undefined });
}
