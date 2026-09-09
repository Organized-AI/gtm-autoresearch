import type { GtmContainer } from "./evaluator.ts";

function extractPlaceholders(json: string): string[] {
  const matches = json.match(/%%[A-Z_]+%%/g) ?? [];
  return [...new Set(matches)];
}

// ── 3-tier validation gate ───────────────────────────────────────────────────

export function validateMutation(
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

// ── Operation types for JSON-patch mutations ────────────────────────────────

export interface MutationOp {
  op: "add_tag" | "add_trigger" | "add_variable" | "modify_tag" | "set_consent_all" | "rename_tags" | "assign_folders";
  entity?: Record<string, unknown>;
  tagId?: string;
  /** For modify_tag: partial merge into existing tag */
  merge?: Record<string, unknown>;
  /** For rename_tags: array of {tagId, newName} pairs */
  renames?: Array<{ tagId: string; newName: string }>;
  /** For assign_folders: array of {tagId, folderId} pairs */
  assignments?: Array<{ tagId: string; folderId: string }>;
}

export interface MutationResponse {
  operations: MutationOp[];
  summary: string;
}

// ── Apply mutation operations to container ──────────────────────────────────

export function applyOperations(
  container: GtmContainer,
  ops: MutationOp[],
): GtmContainer {
  // Deep clone
  const result: GtmContainer = JSON.parse(JSON.stringify(container));
  const cv = result.containerVersion;

  for (const op of ops) {
    switch (op.op) {
      case "add_tag":
        if (op.entity) cv.tag = [...(cv.tag ?? []), op.entity as any];
        break;
      case "add_trigger":
        if (op.entity) cv.trigger = [...(cv.trigger ?? []), op.entity as any];
        break;
      case "add_variable":
        if (op.entity) cv.variable = [...(cv.variable ?? []), op.entity as any];
        break;
      case "modify_tag":
        if (op.tagId && op.merge) {
          const idx = (cv.tag ?? []).findIndex((t) => t.tagId === op.tagId);
          if (idx >= 0) {
            cv.tag![idx] = { ...cv.tag![idx], ...op.merge } as any;
          }
        }
        break;
      case "set_consent_all":
        // Set consentStatus to "NEEDED" on all tags that don't already have it
        for (const tag of cv.tag ?? []) {
          if (!tag.consentSettings || tag.consentSettings.consentStatus === "NOT_SET") {
            (tag as any).consentSettings = { consentStatus: "NEEDED" };
          }
        }
        break;
      case "rename_tags":
        // Bulk rename: apply naming convention fixes to many tags at once
        if (op.renames) {
          for (const { tagId, newName } of op.renames) {
            const idx = (cv.tag ?? []).findIndex((t) => t.tagId === tagId);
            if (idx >= 0) {
              (cv.tag![idx] as any).name = newName;
            }
          }
        }
        break;
      case "assign_folders":
        // Bulk folder assignment: move tags into correct logical folders
        if (op.assignments) {
          for (const { tagId, folderId } of op.assignments) {
            const idx = (cv.tag ?? []).findIndex((t) => t.tagId === tagId);
            if (idx >= 0) {
              (cv.tag![idx] as any).parentFolderId = folderId;
            }
          }
        }
        break;
    }
  }

  return result;
}
