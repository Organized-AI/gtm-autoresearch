/** Read-only synthetic observations. Oracle files are never inputs to this adapter. */
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { DatasetRow } from "./jev-offline.js";

type Json = Record<string, unknown>;
export interface LabManifest {
  schema_version: string; lineage_group: string; synthetic: true;
  cases: Array<{ case_id: string; directory: string }>;
}
export interface SyntheticObservation {
  provenance: { source: "synthetic-gtm-lab"; datasetSchema: string; lineageGroup: string; caseId: string; decisionTime: string; synthetic: true };
  facts: Json;
  cautions: string[];
}
function record(value: unknown, context: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context}: expected object`);
  return value as Json;
}
function array(value: unknown, context: string): Json[] {
  if (!Array.isArray(value)) throw new Error(`${context}: expected array`);
  return value.map(item => record(item, context));
}
function timestamp(value: unknown, context: string): number {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error(`${context}: expected timestamp with timezone`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${context}: invalid timestamp`);
  return ms;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function contentHash(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }
async function json(file: string): Promise<unknown> { return JSON.parse(await readFile(file, "utf8")); }
async function jsonl(file: string): Promise<Json[]> {
  return (await readFile(file, "utf8")).split("\n").filter(line => line.trim()).map((line, i) => record(JSON.parse(line), `${path.basename(file)}:${i + 1}`));
}
async function contained(parent: string, child: string): Promise<string> {
  const root = await realpath(parent), target = await realpath(path.resolve(parent, child));
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("dataset path escapes observations directory");
  return target;
}
export async function loadManifest(root: string): Promise<LabManifest> {
  const raw = record(await json(path.join(root, "datasets/demo-v1/manifest.json")), "manifest");
  if (raw.synthetic !== true || typeof raw.schema_version !== "string" || typeof raw.lineage_group !== "string" || !raw.lineage_group) throw new Error("invalid synthetic manifest");
  const cases = array(raw.cases, "manifest cases").map(item => {
    if (typeof item.case_id !== "string" || typeof item.directory !== "string" || !/^observations\/[A-Za-z0-9_-]+$/.test(item.directory)) throw new Error("invalid observation directory");
    return { case_id: item.case_id, directory: item.directory };
  });
  if (new Set(cases.map(c => c.case_id)).size !== cases.length) throw new Error("duplicate case IDs");
  return { schema_version: raw.schema_version, lineage_group: raw.lineage_group, synthetic: true, cases };
}
const COLLECTION_IDS: Record<string, string> = { tag: "tagId", trigger: "triggerId", variable: "variableId", folder: "folderId", client: "clientId", customTemplate: "templateId" };
/** These checks cover the simulator reference shape, not Google's complete import schema. */
export function validateSyntheticShape(container: Json): { valid: boolean; issues: string[]; scope: string } {
  const issues: string[] = [];
  if (container.exportFormatVersion !== 2) issues.push("exportFormatVersion must be 2");
  const cv = record(container.containerVersion, "containerVersion"), identity = record(cv.container, "container identity");
  if (!Array.isArray(identity.usageContext) || !identity.usageContext.some(x => x === "WEB" || x === "SERVER")) issues.push("missing web/server usage context");
  const collections: Record<string, Json[]> = {};
  for (const [name, id] of Object.entries(COLLECTION_IDS)) {
    const rows = cv[name] === undefined ? [] : array(cv[name], name); collections[name] = rows;
    const ids = rows.map(row => row[id]);
    if (ids.some(v => typeof v !== "string" || !v)) issues.push(`${name}: missing string ID`);
    if (new Set(ids).size !== ids.length) issues.push(`${name}: duplicate IDs`);
  }
  for (const required of ["tag", "trigger", "variable"]) if (!Array.isArray(cv[required])) issues.push(`missing ${required} array`);
  const triggerIds = new Set(collections.trigger.map(t => t.triggerId));
  const folderIds = new Set(collections.folder.map(f => f.folderId));
  const templateIds = new Set(collections.customTemplate.map(t => t.templateId));
  for (const tag of collections.tag) for (const field of ["firingTriggerId", "blockingTriggerId"]) {
    if (tag[field] !== undefined && !Array.isArray(tag[field])) { issues.push(`tag ${tag.tagId}: ${field} must be array`); continue; }
    for (const id of (tag[field] ?? []) as unknown[]) if (!triggerIds.has(id)) issues.push(`tag ${tag.tagId}: unresolved trigger ${id}`);
  }
  for (const rows of Object.values(collections)) for (const entity of rows) {
    if (entity.parentFolderId !== undefined && !folderIds.has(entity.parentFolderId)) issues.push(`unresolved folder ${entity.parentFolderId}`);
    const templateId = typeof entity.type === "string" ? /^cvt_\d+_(\d+)$/.exec(entity.type)?.[1] : undefined;
    if (templateId && !templateIds.has(templateId)) issues.push(`unresolved local template ${templateId}`);
  }
  return { valid: issues.length === 0, issues, scope: "synthetic reference-shape and ID checks; not GTM import certification" };
}
function containerEvidence(before: Json, current: Json): Json {
  const a = record(before.containerVersion, "baseline"), b = record(current.containerVersion, "current");
  const changes: Json[] = [];
  for (const [collection, id] of Object.entries(COLLECTION_IDS)) {
    const left = new Map(array(a[collection] ?? [], collection).map(e => [String(e[id]), e]));
    const right = new Map(array(b[collection] ?? [], collection).map(e => [String(e[id]), e]));
    for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
      const old = left.get(key), updated = right.get(key);
      if (stable(old ?? null) !== stable(updated ?? null)) changes.push({ collection, id: key, before: old ?? null, after: updated ?? null });
    }
  }
  return { baselineHash: contentHash(before), activeHash: contentHash(current), baselineValidation: validateSyntheticShape(before), activeValidation: validateSyntheticShape(current),
    baselineVersionId: a.containerVersionId, activeVersionId: b.containerVersionId, usageContext: record(b.container, "container").usageContext,
    identityPreserved: a.accountId === b.accountId && a.containerId === b.containerId && stable(a.container) === stable(b.container),
    inventory: Object.fromEntries(Object.keys(COLLECTION_IDS).map(k => [k, array(b[k] ?? [], k).length])),
    changedEntities: changes.slice(0, 100), omittedChangedEntities: Math.max(0, changes.length - 100) };
}
function tally(rows: Json[], fields: string[]): Json[] {
  const groups = new Map<string, { dimensions: Json; count: number }>();
  for (const row of rows) {
    const dimensions = Object.fromEntries(fields.map(k => [k, row[k]]));
    const key = stable(dimensions), group = groups.get(key) ?? { dimensions, count: 0 };
    group.count++; groups.set(key, group);
  }
  return [...groups.values()].map(g => ({ ...g.dimensions, count: g.count }));
}
function summarize(visitor: Json[], network: Json[]): Json {
  const requestGroups = new Map<string, Json[]>();
  for (const n of network) {
    const key = stable([n.platform, n.source, n.event_name]), rows = requestGroups.get(key) ?? [];
    rows.push(n); requestGroups.set(key, rows);
  }
  const networkCounts = [...requestGroups.values()].map(rows => ({
    platform: rows[0].platform, source: rows[0].source, eventName: rows[0].event_name,
    requests: rows.length, successfulRequests: rows.filter(n => n.http_status === 200).length, failedRequests: rows.filter(n => n.http_status !== 200).length,
    uniqueLogicalEvents: new Set(rows.map(n => n.logical_event_id)).size, uniquePayloadEventIds: new Set(rows.map(n => n.event_id)).size,
    missingMatchFields: rows.filter(n => n.match_fields_present !== true).length,
    deniedConsentRequests: rows.filter(n => record(n.consent, "request consent")[n.platform === "ga4" ? "analytics_storage" : "ad_storage"] === "denied").length,
    conversionLabels: [...new Set(rows.map(n => n.conversion_label).filter(v => v !== null && v !== undefined))] }));
  const byLogical = new Map<string, Json[]>();
  for (const n of network.filter(n => n.platform === "meta" && n.http_status === 200)) {
    const key = stable([n.event_name, n.logical_event_id]), rows = byLogical.get(key) ?? [];
    rows.push(n); byLogical.set(key, rows);
  }
  let bothSources = 0, mismatchedIds = 0;
  for (const rows of byLogical.values()) {
    if (new Set(rows.map(n => n.source)).size < 2) continue;
    bothSources++; if (new Set(rows.map(n => n.event_id)).size > 1) mismatchedIds++;
  }
  return { visitorEvents: visitor.length, networkDeliveries: network.length,
    siteEvents: tally(visitor, ["event_name", "channel"]),
    siteConsent: tally(visitor.map(v => ({ event_name: v.event_name, ...record(v.consent, "consent") })), ["event_name", "ad_storage", "analytics_storage"]),
    networkCounts, metaObservedPairing: { bothSources, mismatchedPayloadEventIds: mismatchedIds }, httpStatuses: tally(network, ["platform", "source", "http_status"]) };
}
export async function observeSyntheticCase(root: string, caseId: string, decisionTime: string): Promise<SyntheticObservation> {
  const cutoff = timestamp(decisionTime, "decision time");
  const manifest = await loadManifest(root), item = manifest.cases.find(c => c.case_id === caseId);
  if (!item) throw new Error(`unknown synthetic case ${caseId}`);
  const dataset = path.join(root, "datasets/demo-v1");
  const base = await contained(path.join(dataset, "observations"), path.basename(item.directory));
  const loadRows = async (file: string) => jsonl(await contained(base, file));
  const [data, network, snapshots, rawHistory] = await Promise.all([loadRows("data-layer.jsonl"), loadRows("network-events.jsonl"), loadRows("platform-snapshots.jsonl"), json(await contained(base, "container-history.json"))]);
  const history = array(rawHistory, "container history").filter(h => timestamp(h.effective_at, "effective time") <= cutoff).sort((a, b) => timestamp(a.effective_at, "effective time") - timestamp(b.effective_at, "effective time"));
  if (history.length === 0) throw new Error("no container was observable at the decision time");
  const visitor = data.filter(row => timestamp(row.occurred_at, "visitor time") <= cutoff);
  const deliveries = network.filter(row => timestamp(row.dispatched_at, "dispatch time") <= cutoff && timestamp(row.occurred_at, "event time") <= cutoff);
  const availableSnapshots = snapshots.filter(row => timestamp(row.observed_at, "snapshot time") <= cutoff);
  const containers: Json = {};
  for (const side of ["web", "server"]) {
    const baseline = record(await json(await contained(base, `${side}-before.json`)), "container");
    if (contentHash(baseline) !== history[0][`${side}_hash`]) throw new Error(`${side} baseline hash mismatch`);
    const activeHash = history[history.length - 1][`${side}_hash`];
    // Never open the future candidate export before its effective time.
    const current = contentHash(baseline) === activeHash ? baseline : record(await json(await contained(base, `${side}-after.json`)), "container");
    if (contentHash(current) !== activeHash) throw new Error(`${side} active hash mismatch`);
    containers[side] = containerEvidence(baseline, current);
  }
  const segments = history.map((h, index) => {
    const start = timestamp(h.effective_at, "segment start"), next = history[index + 1], end = next ? timestamp(next.effective_at, "segment end") : cutoff;
    const within = (row: Json, field: string) => { const t = timestamp(row[field], field); return t >= start && (next ? t < end : t <= end); };
    return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), endInclusive: !next,
      ...summarize(visitor.filter(row => within(row, "occurred_at")), deliveries.filter(row => within(row, "occurred_at"))) };
  });
  // Allowlisted fields prevent arbitrary future metadata or oracle fields from entering model state.
  const platformSnapshots = availableSnapshots.map(s => ({
    platform: s.platform, observedAt: s.observed_at, eventWindow: s.event_window, windowStart: s.window_start, windowEndExclusive: s.window_end_exclusive,
    attributionModel: s.attribution_model, currency: s.currency, syntheticClicks: s.synthetic_clicks, syntheticSpend: s.synthetic_spend,
    conversionActions: array(s.conversion_actions ?? [], "actions").map(a => ({ id: a.id, label: a.label, category: a.category, status: a.status })),
    events: array(s.events, "platform events").map(e => ({ eventName: e.event_name, receivedRequests: e.received_requests, uniqueEvents: e.unique_events,
      browserEvents: e.browser_events, serverEvents: e.server_events, browserServerOverlap: e.browser_server_overlap,
      serverDedupOverlapRate: e.server_dedup_overlap_rate, attributedConversions: e.attributed_conversions, attributedValue: e.attributed_value, simulatedEmqProxy: e.simulated_emq_proxy })) }));
  return { provenance: { source: "synthetic-gtm-lab", datasetSchema: manifest.schema_version, lineageGroup: manifest.lineage_group, caseId, decisionTime: new Date(cutoff).toISOString(), synthetic: true },
    facts: { ...summarize(visitor, deliveries), containers, segments, availablePlatformSnapshots: platformSnapshots,
      containerHistory: history.map(h => ({ effectiveAt: h.effective_at, webHash: h.web_hash, serverHash: h.server_hash })),
      qa: { status: "absent", detail: "simulation observations; no browser/GTM preview executed" } },
    cautions: ["Oracle labels and private report-arrival schedules are not read.",
      "All observations and container versions are selected by decision time; no future evidence is included.",
      "Request counts are separated by platform/source and are not business-conversion counts.",
      "Compare matching event-time windows and as-of report times, not cumulative totals.",
      "Synthetic EMQ is an illustrative matching-field proxy, not Meta's algorithm.",
      "Shape checks cover this simulator only; non-executable templates are not GTM import-certified.",
      "Ratios alone do not establish causality; absent QA and uncertain cases require review.",
      "Normalized snapshots are not the enriched-snapshot API and must not be blindly cast to it."] };
}
/** Only this projection is intended for a model. Case IDs and grouping stay outside it. */
export function compactSyntheticJudgeInput(observation: SyntheticObservation): Json {
  return { schemaVersion: "synthetic-gtm-observation-v2", decisionTime: observation.provenance.decisionTime, synthetic: true, facts: observation.facts, cautions: observation.cautions };
}
export async function buildSyntheticReplayRows(root: string, decisionTime: string): Promise<DatasetRow[]> {
  const manifest = await loadManifest(root);
  return Promise.all(manifest.cases.map(async item => {
    const observation = await observeSyntheticCase(root, item.case_id, decisionTime);
    return { input: { observation: compactSyntheticJudgeInput(observation) }, prediction: { status: "unavailable" as const, reason: "offline evidence replay; Jev was not called" },
      provenance: { containerGroup: manifest.lineage_group, lineageGroup: manifest.lineage_group, synthetic: true, samplingReasons: ["synthetic-corpus-full-enumeration"] } };
  }));
}
