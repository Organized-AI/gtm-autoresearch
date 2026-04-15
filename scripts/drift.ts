/**
 * drift.ts — diff any two container versions tracked in KV.
 *
 * Usage:
 *   npx tsx scripts/drift.ts <clientId> <runId> <fromRound> <toRound>
 *   npx tsx scripts/drift.ts blade-web 2026-04-14T184147 0 5
 *   npx tsx scripts/drift.ts blade-web --runs             # list runs for this client
 *   npx tsx scripts/drift.ts blade-web --seed-vs-best     # reconstruct best round from latest run, diff against seed
 *
 * "Round -1" is shorthand for seed (pre-round-0).
 */

import {
  kvGet,
  kvList,
  keys,
  reconstructVersion,
  type RunManifest,
} from "./lib/kv-store.js";

interface GtmContainer {
  containerVersion?: {
    tag?: Array<{ tagId: string; name: string; type: string; [k: string]: unknown }>;
    trigger?: Array<{ triggerId: string; name: string; type: string }>;
    variable?: Array<{ variableId: string; name: string; type: string }>;
    folder?: Array<{ folderId: string; name: string }>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

function usage(): never {
  console.error(`Usage:
  npx tsx scripts/drift.ts <clientId> <runId> <fromRound> <toRound>
  npx tsx scripts/drift.ts <clientId> --runs
  npx tsx scripts/drift.ts <clientId> --seed-vs-best`);
  process.exit(1);
}

function diffArrays<T extends { [k: string]: unknown }>(
  a: T[],
  b: T[],
  idKey: keyof T,
): { added: T[]; removed: T[]; changed: Array<{ before: T; after: T }> } {
  const aMap = new Map(a.map((x) => [x[idKey], x]));
  const bMap = new Map(b.map((x) => [x[idKey], x]));
  const added = [...bMap.values()].filter((x) => !aMap.has(x[idKey]));
  const removed = [...aMap.values()].filter((x) => !bMap.has(x[idKey]));
  const changed: Array<{ before: T; after: T }> = [];
  for (const [id, before] of aMap) {
    const after = bMap.get(id);
    if (after && JSON.stringify(before) !== JSON.stringify(after)) {
      changed.push({ before, after });
    }
  }
  return { added, removed, changed };
}

async function listRuns(clientId: string): Promise<void> {
  const keysList = kvList(`run:${clientId}:`);
  const runIds = [
    ...new Set(
      keysList
        .map((k) => k.split(":")[2])
        .filter((x): x is string => typeof x === "string"),
    ),
  ].sort();

  if (runIds.length === 0) {
    console.log(`No runs in KV for client "${clientId}"`);
    return;
  }

  console.log(`Runs for ${clientId}:`);
  for (const runId of runIds) {
    const manifest = kvGet<RunManifest>(keys.manifest(clientId, runId));
    if (!manifest) {
      console.log(`  ${runId}  (no manifest — in progress or aborted)`);
      continue;
    }
    const delta = (manifest.bestScore - manifest.seedScore) * 100;
    const sign = delta >= 0 ? "+" : "";
    console.log(
      `  ${runId}  ${(manifest.seedScore * 100).toFixed(1)}% → ${(manifest.bestScore * 100).toFixed(1)}% (${sign}${delta.toFixed(1)})  rounds=${manifest.totalRounds}`,
    );
  }
}

async function diffRounds(
  clientId: string,
  runId: string,
  fromRound: number,
  toRound: number,
): Promise<void> {
  console.log(`\nDrift: ${clientId} / ${runId}  round ${fromRound} → ${toRound}\n`);

  const before =
    fromRound < 0
      ? { container: kvGet<GtmContainer>(keys.seed(clientId)), appliedRounds: [], skippedRounds: [] }
      : reconstructVersion(clientId, runId, fromRound);
  const after =
    toRound < 0
      ? { container: kvGet<GtmContainer>(keys.seed(clientId)), appliedRounds: [], skippedRounds: [] }
      : reconstructVersion(clientId, runId, toRound);

  if (!before.container) {
    console.error(`Could not reconstruct round ${fromRound}`);
    process.exit(1);
  }
  if (!after.container) {
    console.error(`Could not reconstruct round ${toRound}`);
    process.exit(1);
  }

  console.log(
    `before applied rounds: [${before.appliedRounds.join(", ") || "(seed)"}]`,
  );
  console.log(
    `after  applied rounds: [${after.appliedRounds.join(", ") || "(seed)"}]\n`,
  );

  const bCv = (before.container as GtmContainer).containerVersion ?? {};
  const aCv = (after.container as GtmContainer).containerVersion ?? {};

  const tagDiff = diffArrays(bCv.tag ?? [], aCv.tag ?? [], "tagId");
  const trigDiff = diffArrays(bCv.trigger ?? [], aCv.trigger ?? [], "triggerId");
  const varDiff = diffArrays(bCv.variable ?? [], aCv.variable ?? [], "variableId");
  const folderDiff = diffArrays(bCv.folder ?? [], aCv.folder ?? [], "folderId");

  function section<T extends { name: string }>(
    label: string,
    diff: { added: T[]; removed: T[]; changed: Array<{ before: T; after: T }> },
  ) {
    if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
      console.log(`${label}: no change`);
      return;
    }
    console.log(
      `${label}: +${diff.added.length} / -${diff.removed.length} / Δ${diff.changed.length}`,
    );
    for (const t of diff.added.slice(0, 20)) console.log(`  + "${t.name}"`);
    for (const t of diff.removed.slice(0, 20)) console.log(`  - "${t.name}"`);
    for (const { before, after } of diff.changed.slice(0, 20)) {
      const changedKeys = Object.keys({ ...before, ...after }).filter(
        (k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((after as Record<string, unknown>)[k]),
      );
      console.log(`  Δ "${before.name}" — fields: ${changedKeys.join(", ")}`);
    }
  }

  section("Tags", tagDiff);
  section("Triggers", trigDiff);
  section("Variables", varDiff);
  section("Folders", folderDiff);
}

async function seedVsBest(clientId: string): Promise<void> {
  const keysList = kvList(`run:${clientId}:`);
  const runIds = [
    ...new Set(
      keysList
        .map((k) => k.split(":")[2])
        .filter((x): x is string => typeof x === "string"),
    ),
  ].sort();
  if (runIds.length === 0) {
    console.error(`No runs for client ${clientId}`);
    process.exit(1);
  }
  const latest = runIds[runIds.length - 1];
  const manifest = kvGet<RunManifest>(keys.manifest(clientId, latest));
  if (!manifest) {
    console.error(`Latest run ${latest} has no manifest`);
    process.exit(1);
  }
  console.log(
    `Latest run: ${latest}  seed=${(manifest.seedScore * 100).toFixed(1)}%  best=${(manifest.bestScore * 100).toFixed(1)}%`,
  );
  await diffRounds(clientId, latest, -1, manifest.totalRounds - 1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();
  const clientId = args[0];

  if (args[1] === "--runs") {
    await listRuns(clientId);
    return;
  }
  if (args[1] === "--seed-vs-best") {
    await seedVsBest(clientId);
    return;
  }

  if (args.length < 4) usage();
  const runId = args[1];
  const fromRound = parseInt(args[2], 10);
  const toRound = parseInt(args[3], 10);
  await diffRounds(clientId, runId, fromRound, toRound);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
