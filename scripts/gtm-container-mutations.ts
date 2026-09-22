/**
 * Deterministic GTM container mutation layer.
 *
 * The exported GTM container is the structural carrier. Callers can request
 * narrow operations, but this module owns cloning, identifier allocation,
 * reference checks, and preservation of fields the operation did not name.
 */

import type { GtmContainer } from "../evals/eval_gtm_signal_quality.js";

type JsonRecord = Record<string, unknown>;
type Collection = "tag" | "trigger" | "variable" | "folder";

export type MutationOp =
  | { op: "add_tag"; entity: JsonRecord }
  | { op: "add_trigger"; entity: JsonRecord }
  | { op: "add_variable"; entity: JsonRecord }
  | { op: "add_folder"; entity: JsonRecord }
  | { op: "modify_tag"; tagId: string; changes: TagChanges }
  | { op: "set_consent_all" }
  | { op: "rename_tags"; renames: Array<{ tagId: string; newName: string }> }
  | { op: "assign_folders"; assignments: Array<{ tagId: string; folderId: string }> };

export interface TagChanges {
  name?: string;
  parameter?: unknown[];
  firingTriggerId?: string[];
  blockingTriggerId?: string[];
  parentFolderId?: string;
  consentSettings?: JsonRecord;
  tagFiringOption?: string;
  notes?: string;
}

export interface MutationResponse {
  operations: MutationOp[];
  summary?: string;
}

export interface ValidationResult {
  valid: boolean;
  reason: string;
  changedEntityIds: Record<Collection, string[]>;
}

const COLLECTION_ID: Record<Collection, string> = {
  tag: "tagId",
  trigger: "triggerId",
  variable: "variableId",
  folder: "folderId",
};

const ADDITION_IDENTITY_FIELDS = new Set([
  "accountId",
  "containerId",
  "tagId",
  "triggerId",
  "variableId",
  "folderId",
  "fingerprint",
]);

const TAG_CHANGE_FIELDS = new Set<keyof TagChanges>([
  "name",
  "parameter",
  "firingTriggerId",
  "blockingTriggerId",
  "parentFolderId",
  "consentSettings",
  "tagFiringOption",
  "notes",
]);

const SYSTEM_TRIGGER_ID_MINIMUM = 2_147_470_000;
const TEMPLATE_REFERENCE = /{{([^{}]+)}}/g;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertOnlyKeys(value: JsonRecord, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`${label} contains unsupported field '${key}'`);
    }
  }
}

function assertAddition(entity: unknown, collection: Collection): asserts entity is JsonRecord {
  if (!isRecord(entity)) throw new Error(`add_${collection} requires an entity object`);
  nonEmptyString(entity.name, `add_${collection}.entity.name`);
  if (collection !== "folder") nonEmptyString(entity.type, `add_${collection}.entity.type`);

  for (const field of ADDITION_IDENTITY_FIELDS) {
    if (field in entity) {
      throw new Error(`add_${collection}.entity must not supply '${field}'; IDs and container identity are assigned by code`);
    }
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
}

function assertTagChanges(value: unknown): asserts value is TagChanges {
  if (!isRecord(value)) throw new Error("modify_tag.changes must be an object");
  if (Object.keys(value).length === 0) throw new Error("modify_tag.changes cannot be empty");

  for (const [key, field] of Object.entries(value)) {
    if (!TAG_CHANGE_FIELDS.has(key as keyof TagChanges)) {
      throw new Error(`modify_tag.changes cannot alter '${key}'`);
    }
    if (["name", "parentFolderId", "tagFiringOption", "notes"].includes(key)) {
      nonEmptyString(field, `modify_tag.changes.${key}`);
    }
    if (["firingTriggerId", "blockingTriggerId"].includes(key)) {
      assertStringArray(field, `modify_tag.changes.${key}`);
    }
    if (key === "parameter" && !Array.isArray(field)) {
      throw new Error("modify_tag.changes.parameter must be an array");
    }
    if (key === "consentSettings" && !isRecord(field)) {
      throw new Error("modify_tag.changes.consentSettings must be an object");
    }
  }
}

function assertPairs(
  value: unknown,
  label: string,
  secondKey: "newName" | "folderId",
): asserts value is Array<{ tagId: string; [key: string]: string }> {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`);
  for (const item of value) {
    if (!isRecord(item)) throw new Error(`${label} entries must be objects`);
    assertOnlyKeys(item, ["tagId", secondKey], `${label} entry`);
    nonEmptyString(item.tagId, `${label}.tagId`);
    nonEmptyString(item[secondKey], `${label}.${secondKey}`);
  }
}

/** Validate untrusted model output before applying it. */
export function assertValidOperations(operations: unknown, maxCostlyOperations = 3): asserts operations is MutationOp[] {
  if (!Array.isArray(operations)) throw new Error("operations must be an array");
  let costlyOperations = 0;

  for (const operation of operations) {
    if (!isRecord(operation) || typeof operation.op !== "string") {
      throw new Error("Each operation must be an object with an op");
    }

    switch (operation.op) {
      case "add_tag":
      case "add_trigger":
      case "add_variable":
      case "add_folder": {
        assertOnlyKeys(operation, ["op", "entity"], operation.op);
        const collection = operation.op.slice(4) as Collection;
        assertAddition(operation.entity, collection);
        costlyOperations++;
        break;
      }
      case "modify_tag":
        assertOnlyKeys(operation, ["op", "tagId", "changes"], operation.op);
        nonEmptyString(operation.tagId, "modify_tag.tagId");
        assertTagChanges(operation.changes);
        costlyOperations++;
        break;
      case "set_consent_all":
        assertOnlyKeys(operation, ["op"], operation.op);
        costlyOperations++;
        break;
      case "rename_tags":
        assertOnlyKeys(operation, ["op", "renames"], operation.op);
        assertPairs(operation.renames, "rename_tags.renames", "newName");
        break;
      case "assign_folders":
        assertOnlyKeys(operation, ["op", "assignments"], operation.op);
        assertPairs(operation.assignments, "assign_folders.assignments", "folderId");
        break;
      default:
        throw new Error(`Unsupported operation '${operation.op}'`);
    }
  }

  if (costlyOperations > maxCostlyOperations) {
    throw new Error(`At most ${maxCostlyOperations} add, modify, or consent operations are allowed per round`);
  }
}

function entityArray(container: GtmContainer, collection: Collection): JsonRecord[] {
  return ((container.containerVersion[collection] ?? []) as JsonRecord[]);
}

function nextId(container: GtmContainer, collection: Collection): string {
  const idField = COLLECTION_ID[collection];
  const numericIds = entityArray(container, collection)
    .map((entity) => Number(entity[idField]))
    .filter((id) => Number.isInteger(id) && id >= 0);
  return String((numericIds.length === 0 ? 0 : Math.max(...numericIds)) + 1);
}

function identityFor(container: GtmContainer, collection: Collection, id: string): JsonRecord {
  const cv = container.containerVersion as JsonRecord;
  const nearby = entityArray(container, collection)[0] ?? entityArray(container, "tag")[0];
  const identity: JsonRecord = { [COLLECTION_ID[collection]]: id };
  const accountId = nearby?.accountId ?? cv.accountId;
  const containerId = nearby?.containerId ?? cv.containerId;
  if (typeof accountId === "string") identity.accountId = accountId;
  if (typeof containerId === "string") identity.containerId = containerId;
  return identity;
}

function addEntity(container: GtmContainer, collection: Collection, supplied: JsonRecord): void {
  const id = nextId(container, collection);
  const entity = { ...identityFor(container, collection, id), ...clone(supplied) };
  const cv = container.containerVersion as JsonRecord;
  cv[collection] = [...entityArray(container, collection), entity];
}

function findTag(container: GtmContainer, tagId: string): JsonRecord {
  const tag = entityArray(container, "tag").find((entity) => entity.tagId === tagId);
  if (!tag) throw new Error(`Unknown tagId '${tagId}'`);
  return tag;
}

/**
 * Applies operations to a deep clone. It never mutates the supplied baseline.
 */
export function applyOperations(container: GtmContainer, operations: unknown): GtmContainer {
  assertValidOperations(operations);
  const result = clone(container);

  for (const operation of operations) {
    switch (operation.op) {
      case "add_tag": addEntity(result, "tag", operation.entity); break;
      case "add_trigger": addEntity(result, "trigger", operation.entity); break;
      case "add_variable": addEntity(result, "variable", operation.entity); break;
      case "add_folder": addEntity(result, "folder", operation.entity); break;
      case "modify_tag": {
        const tag = findTag(result, operation.tagId);
        Object.assign(tag, clone(operation.changes));
        break;
      }
      case "set_consent_all":
        for (const tag of entityArray(result, "tag")) {
          const consent = isRecord(tag.consentSettings) ? tag.consentSettings : {};
          if (consent.consentStatus === "NOT_SET" || tag.consentSettings === undefined) {
            tag.consentSettings = { ...consent, consentStatus: "NEEDED" };
          }
        }
        break;
      case "rename_tags":
        for (const { tagId, newName } of operation.renames) findTag(result, tagId).name = newName;
        break;
      case "assign_folders":
        for (const { tagId, folderId } of operation.assignments) findTag(result, tagId).parentFolderId = folderId;
        break;
    }
  }

  const validation = validateCandidate(container, result, operations);
  if (!validation.valid) throw new Error(validation.reason);
  return result;
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mapsById(container: GtmContainer, collection: Collection): Map<string, JsonRecord> {
  const idField = COLLECTION_ID[collection];
  const map = new Map<string, JsonRecord>();
  for (const entity of entityArray(container, collection)) {
    const id = entity[idField];
    if (typeof id !== "string" || id === "") throw new Error(`${collection} has an invalid ${idField}`);
    if (map.has(id)) throw new Error(`Duplicate ${collection} ID '${id}'`);
    map.set(id, entity);
  }
  return map;
}

function refsIn(value: unknown, results = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(TEMPLATE_REFERENCE)) results.add(match[1].trim());
  } else if (Array.isArray(value)) {
    for (const item of value) refsIn(item, results);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) refsIn(item, results);
  }
  return results;
}

function addedIds(before: Map<string, JsonRecord>, after: Map<string, JsonRecord>): string[] {
  return [...after.keys()].filter((id) => !before.has(id));
}

function allowedTagChanges(operations: MutationOp[]): Map<string, Set<string>> {
  const allowed = new Map<string, Set<string>>();
  const add = (tagId: string, fields: string[]) => {
    const current = allowed.get(tagId) ?? new Set<string>();
    fields.forEach((field) => current.add(field));
    allowed.set(tagId, current);
  };

  for (const operation of operations) {
    if (operation.op === "modify_tag") add(operation.tagId, Object.keys(operation.changes));
    if (operation.op === "rename_tags") operation.renames.forEach(({ tagId }) => add(tagId, ["name"]));
    if (operation.op === "assign_folders") operation.assignments.forEach(({ tagId }) => add(tagId, ["parentFolderId"]));
    if (operation.op === "set_consent_all") {
      // This is further limited below to consentStatus changes for tags that need it.
      add("*", ["consentSettings"]);
    }
  }
  return allowed;
}

function changedFields(before: JsonRecord, after: JsonRecord): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !equal(before[key], after[key]));
}

function isSystemTriggerId(value: string): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= SYSTEM_TRIGGER_ID_MINIMUM;
}

function placeholdersIn(value: unknown): Set<string> {
  const serialized = JSON.stringify(value);
  return new Set(serialized.match(/%%[A-Z_]+%%/g) ?? []);
}

function expectedAddedIds(baseline: GtmContainer, operations: MutationOp[]): Record<Collection, string[]> {
  const next: Record<Collection, number> = { tag: 0, trigger: 0, variable: 0, folder: 0 };
  for (const collection of ["tag", "trigger", "variable", "folder"] as const) {
    const values = entityArray(baseline, collection)
      .map((entity) => Number(entity[COLLECTION_ID[collection]]))
      .filter((id) => Number.isInteger(id) && id >= 0);
    next[collection] = (values.length === 0 ? 0 : Math.max(...values)) + 1;
  }
  const expected: Record<Collection, string[]> = { tag: [], trigger: [], variable: [], folder: [] };
  for (const operation of operations) {
    if (operation.op.startsWith("add_")) {
      const collection = operation.op.slice(4) as Collection;
      expected[collection].push(String(next[collection]++));
    }
  }
  return expected;
}

function validateReferences(
  before: GtmContainer,
  candidate: GtmContainer,
  changed: Record<Collection, string[]>,
): string | undefined {
  const baselineRefs = new Set<string>();
  for (const collection of ["tag", "trigger", "variable"] as const) {
    for (const entity of entityArray(before, collection)) refsIn(entity, baselineRefs);
  }
  const variableNames = new Set(entityArray(candidate, "variable").map((entity) => String(entity.name)));
  const triggerIds = new Set(entityArray(candidate, "trigger").map((entity) => String(entity.triggerId)));
  const folderIds = new Set(entityArray(candidate, "folder").map((entity) => String(entity.folderId)));

  for (const collection of ["tag", "trigger", "variable"] as const) {
    const candidates = mapsById(candidate, collection);
    for (const id of changed[collection]) {
      const entity = candidates.get(id)!;
      for (const reference of refsIn(entity)) {
        if (!variableNames.has(reference) && !baselineRefs.has(reference)) {
          return `${collection} '${id}' references unknown variable '{{${reference}}}'`;
        }
      }
      const folderId = entity.parentFolderId;
      if (typeof folderId === "string" && !folderIds.has(folderId)) {
        return `${collection} '${id}' references unknown folderId '${folderId}'`;
      }
      if (collection === "tag") {
        for (const field of ["firingTriggerId", "blockingTriggerId"]) {
          const triggerRefs = entity[field];
          if (triggerRefs !== undefined) {
            if (!Array.isArray(triggerRefs) || triggerRefs.some((value) => typeof value !== "string")) {
              return `tag '${id}' has invalid ${field}`;
            }
            for (const triggerId of triggerRefs) {
              if (!triggerIds.has(triggerId) && !isSystemTriggerId(triggerId)) {
                return `tag '${id}' references unknown ${field} '${triggerId}'`;
              }
            }
          }
        }
      }
    }
  }
  return undefined;
}

/**
 * Checks that a candidate preserves the supplied baseline except for the exact
 * fields authorized by its operation list. This can also validate a candidate
 * produced outside applyOperations.
 */
export function validateCandidate(
  baseline: GtmContainer,
  candidate: unknown,
  operations: unknown,
): ValidationResult {
  const emptyChanges: Record<Collection, string[]> = { tag: [], trigger: [], variable: [], folder: [] };
  try {
    assertValidOperations(operations);
    if (!isRecord(candidate) || !isRecord(candidate.containerVersion)) {
      return { valid: false, reason: "Candidate is not a GTM container export", changedEntityIds: emptyChanges };
    }
    const parsed = candidate as GtmContainer;
    if (parsed.exportFormatVersion !== baseline.exportFormatVersion) {
      return { valid: false, reason: "exportFormatVersion changed", changedEntityIds: emptyChanges };
    }

    for (const collection of ["tag", "trigger", "variable", "folder"] as const) {
      if (!Array.isArray((parsed.containerVersion as JsonRecord)[collection])) {
        return { valid: false, reason: `Missing containerVersion.${collection} array`, changedEntityIds: emptyChanges };
      }
    }
    for (const placeholder of placeholdersIn(baseline)) {
      if (!placeholdersIn(parsed).has(placeholder)) {
        return { valid: false, reason: `Placeholder ${placeholder} was removed`, changedEntityIds: emptyChanges };
      }
    }

    const baselineCopy = clone(baseline) as JsonRecord;
    const candidateCopy = clone(parsed) as JsonRecord;
    delete baselineCopy.containerVersion;
    delete candidateCopy.containerVersion;
    if (!equal(baselineCopy, candidateCopy)) {
      return { valid: false, reason: "Top-level export fields changed", changedEntityIds: emptyChanges };
    }

    const beforeCv = baseline.containerVersion as JsonRecord;
    const afterCv = parsed.containerVersion as JsonRecord;
    for (const key of new Set([...Object.keys(beforeCv), ...Object.keys(afterCv)])) {
      if (!["tag", "trigger", "variable", "folder"].includes(key) && !equal(beforeCv[key], afterCv[key])) {
        return { valid: false, reason: `containerVersion.${key} changed`, changedEntityIds: emptyChanges };
      }
    }

    const before: Record<Collection, Map<string, JsonRecord>> = {
      tag: mapsById(baseline, "tag"), trigger: mapsById(baseline, "trigger"),
      variable: mapsById(baseline, "variable"), folder: mapsById(baseline, "folder"),
    };
    const after: Record<Collection, Map<string, JsonRecord>> = {
      tag: mapsById(parsed, "tag"), trigger: mapsById(parsed, "trigger"),
      variable: mapsById(parsed, "variable"), folder: mapsById(parsed, "folder"),
    };
    const changed: Record<Collection, string[]> = {
      tag: addedIds(before.tag, after.tag), trigger: addedIds(before.trigger, after.trigger),
      variable: addedIds(before.variable, after.variable), folder: addedIds(before.folder, after.folder),
    };

    for (const collection of ["tag", "trigger", "variable", "folder"] as const) {
      for (const [id, entity] of before[collection]) {
        const actual = after[collection].get(id);
        if (!actual) return { valid: false, reason: `Baseline ${collection} '${id}' was removed`, changedEntityIds: changed };
        if (collection !== "tag" && !equal(entity, actual)) {
          return { valid: false, reason: `Baseline ${collection} '${id}' was modified`, changedEntityIds: changed };
        }
      }
    }

    const expectedAdditions = expectedAddedIds(baseline, operations);
    for (const collection of ["tag", "trigger", "variable", "folder"] as const) {
      if (changed[collection].length !== expectedAdditions[collection].length ||
          !equal(changed[collection].sort(), expectedAdditions[collection].sort())) {
        return { valid: false, reason: `Unexpected ${collection} addition`, changedEntityIds: changed };
      }
      for (const id of expectedAdditions[collection]) {
        const entity = after[collection].get(id)!;
        const requiredIdentity = identityFor(baseline, collection, id);
        if (Object.entries(requiredIdentity).some(([key, value]) => !equal(entity[key], value))) {
          return { valid: false, reason: `Added ${collection} '${id}' has invalid container identity`, changedEntityIds: changed };
        }
      }
    }

    for (const operation of operations) {
      const tagIds = operation.op === "modify_tag" ? [operation.tagId]
        : operation.op === "rename_tags" ? operation.renames.map(({ tagId }) => tagId)
        : operation.op === "assign_folders" ? operation.assignments.map(({ tagId }) => tagId)
        : [];
      if (tagIds.some((tagId) => !before.tag.has(tagId))) {
        return { valid: false, reason: "Operation targets an unknown baseline tag", changedEntityIds: changed };
      }
    }

    const tagPermissions = allowedTagChanges(operations);
    for (const [id, oldTag] of before.tag) {
      const newTag = after.tag.get(id)!;
      const permitted = new Set([...(tagPermissions.get(id) ?? []), ...(tagPermissions.get("*") ?? [])]);
      const fields = changedFields(oldTag, newTag);
      if (fields.some((field) => !permitted.has(field))) {
        return { valid: false, reason: `Tag '${id}' changed an unauthorized field`, changedEntityIds: changed };
      }
      if (fields.length > 0) changed.tag.push(id);
    }

    const referenceError = validateReferences(baseline, parsed, changed);
    if (referenceError) return { valid: false, reason: referenceError, changedEntityIds: changed };

    return { valid: true, reason: "OK", changedEntityIds: changed };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : String(error),
      changedEntityIds: emptyChanges,
    };
  }
}
