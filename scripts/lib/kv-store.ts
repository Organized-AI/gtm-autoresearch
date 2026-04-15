/**
 * Cloudflare KV store for GTM container version history.
 *
 * Key layout (namespace: GTM_AUTORESEARCH_VERSIONS):
 *   seed:<clientId>                     → full seed container JSON (pristine baseline)
 *   run:<clientId>:<runId>:manifest     → { startTime, endTime, seedScore, bestScore, finalScore, totalRounds, outcomes }
 *   run:<clientId>:<runId>:r<round>     → { round, action, patch, scoreBefore, scoreAfter, dimensions, timestamp }
 *
 * Drift = apply ordered patches from rounds 0..N to the seed.
 *
 * Auth: relies on local `wrangler` being logged in (user's existing CF account).
 */

import { spawnSync } from "node:child_process";
import { writeFile, mkdtemp, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID ?? "6f5fb8b431b246fa9204459e5543df80";

function runWrangler(args: string[], stdin?: string): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync("wrangler", args, {
    encoding: "utf-8",
    input: stdin,
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  return {
    ok: r.status === 0,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

export async function kvPut(key: string, value: unknown): Promise<void> {
  // Use a temp file so large values (seed containers ~700 KB) don't hit ENV/argv limits
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "gtm-kv-"));
  const tmpFile = path.join(tmpDir, "value.json");
  await writeFile(tmpFile, JSON.stringify(value));

  try {
    const r = runWrangler([
      "kv",
      "key",
      "put",
      "--remote",
      `--namespace-id=${NAMESPACE_ID}`,
      key,
      "--path",
      tmpFile,
    ]);
    if (!r.ok) {
      throw new Error(`wrangler kv put failed for ${key}: ${r.stderr.slice(0, 200)}`);
    }
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

export function kvGet<T>(key: string): T | null {
  const r = runWrangler([
    "kv",
    "key",
    "get",
    "--remote",
    `--namespace-id=${NAMESPACE_ID}`,
    key,
  ]);
  if (!r.ok) {
    // wrangler exits 1 for 'key not found' with message on stderr
    if (/not found/i.test(r.stderr)) return null;
    throw new Error(`wrangler kv get failed for ${key}: ${r.stderr.slice(0, 200)}`);
  }
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    return null;
  }
}

export function kvList(prefix: string): string[] {
  const r = runWrangler([
    "kv",
    "key",
    "list",
    "--remote",
    `--namespace-id=${NAMESPACE_ID}`,
    `--prefix=${prefix}`,
  ]);
  if (!r.ok) {
    throw new Error(`wrangler kv list failed: ${r.stderr.slice(0, 200)}`);
  }
  try {
    const parsed = JSON.parse(r.stdout) as Array<{ name: string }>;
    return parsed.map((p) => p.name);
  } catch {
    return [];
  }
}

// ── Typed helpers ────────────────────────────────────────────────────────────

export interface RoundRecord {
  round: number;
  action: "improved" | "reverted" | "validation_fail" | "json_fail";
  patch: unknown[] | null; // array of JsonPatchOp, null when not applied
  scoreBefore: number;
  scoreAfter: number | null;
  dimensions: Record<string, number>;
  timestamp: string;
  mutationSummary: string;
}

export interface RunManifest {
  runId: string;
  clientId: string;
  startTime: string;
  endTime: string;
  seedScore: number;
  bestScore: number;
  finalScore: number;
  totalRounds: number;
  outcomes: {
    improved: number;
    reverted: number;
    validationFails: number;
    jsonFails: number;
  };
  templatePath: string;
  evalPath: string | undefined;
}

export const keys = {
  seed: (clientId: string) => `seed:${clientId}`,
  round: (clientId: string, runId: string, round: number) =>
    `run:${clientId}:${runId}:r${String(round).padStart(3, "0")}`,
  manifest: (clientId: string, runId: string) =>
    `run:${clientId}:${runId}:manifest`,
};

export async function putSeedIfMissing(
  clientId: string,
  container: unknown,
): Promise<"wrote" | "already_exists"> {
  const existing = kvGet<unknown>(keys.seed(clientId));
  if (existing) return "already_exists";
  await kvPut(keys.seed(clientId), container);
  return "wrote";
}

export async function putRound(
  clientId: string,
  runId: string,
  record: RoundRecord,
): Promise<void> {
  await kvPut(keys.round(clientId, runId, record.round), record);
}

export async function putManifest(
  clientId: string,
  runId: string,
  manifest: RunManifest,
): Promise<void> {
  await kvPut(keys.manifest(clientId, runId), manifest);
}

// ── Reconstruction ──────────────────────────────────────────────────────────

// Local copy of patch apply — keeps this module independent of run-gtm-loop
function parsePointer(p: string): string[] {
  if (p === "") return [];
  if (!p.startsWith("/")) throw new Error(`bad pointer ${p}`);
  return p
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function applyOps(doc: unknown, ops: Array<{ op: string; path: string; value: unknown }>): unknown {
  const result = structuredClone(doc);
  for (const op of ops) {
    const parts = parsePointer(op.path);
    if (parts.length === 0) throw new Error("empty path");
    let parent: unknown = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (Array.isArray(parent)) parent = parent[parseInt(seg, 10)];
      else if (parent && typeof parent === "object")
        parent = (parent as Record<string, unknown>)[seg];
      else throw new Error(`path not found: ${op.path}`);
    }
    const last = parts[parts.length - 1];
    if (Array.isArray(parent)) {
      if (last === "-") parent.push(op.value);
      else {
        const idx = parseInt(last, 10);
        if (op.op === "add") parent.splice(idx, 0, op.value);
        else (parent as unknown[])[idx] = op.value;
      }
    } else if (parent && typeof parent === "object") {
      (parent as Record<string, unknown>)[last] = op.value;
    }
  }
  return result;
}

export function reconstructVersion(
  clientId: string,
  runId: string,
  upToRound: number,
): {
  container: unknown;
  appliedRounds: number[];
  skippedRounds: number[];
  seedScore: number | undefined;
} {
  const seed = kvGet<unknown>(keys.seed(clientId));
  if (!seed) throw new Error(`No seed in KV for client "${clientId}"`);

  const manifest = kvGet<RunManifest>(keys.manifest(clientId, runId));
  const seedScore = manifest?.seedScore;

  let working: unknown = structuredClone(seed);
  const applied: number[] = [];
  const skipped: number[] = [];

  for (let r = 0; r <= upToRound; r++) {
    const record = kvGet<RoundRecord>(keys.round(clientId, runId, r));
    if (!record) {
      skipped.push(r);
      continue;
    }
    if (record.action === "improved" && Array.isArray(record.patch)) {
      working = applyOps(
        working,
        record.patch as Array<{ op: string; path: string; value: unknown }>,
      );
      applied.push(r);
    } else {
      skipped.push(r);
    }
  }

  return { container: working, appliedRounds: applied, skippedRounds: skipped, seedScore };
}
