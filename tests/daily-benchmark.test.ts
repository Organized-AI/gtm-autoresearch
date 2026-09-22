import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildHygieneOperations, runDailyBenchmark } from "../scripts/run-daily-benchmark.js";
import { applyOperations } from "../scripts/gtm-container-mutations.js";

test("carries the accepted local best forward and writes immutable history", async () => {
  const state = await mkdtemp(path.join(tmpdir(), "blade-benchmark-"));
  try {
    const first = await runDailyBenchmark(state); const second = await runDailyBenchmark(state);
    assert.equal(first.outcome, "improved"); assert.equal(second.outcome, "unchanged");
    const history = await (await import("node:fs/promises")).readdir(path.join(state, "history"));
    assert.equal(history.length, 2);
  } finally { await rm(state, { recursive: true, force: true }); }
});

test("refuses state bound to another baseline and maintains behavior fields", async () => {
  const state = await mkdtemp(path.join(tmpdir(), "blade-benchmark-"));
  try {
    await writeFile(path.join(state, "state.json"), JSON.stringify({ baselineSha256: "wrong", bestSha256: "x", bestScore: 0 }));
    await assert.rejects(() => runDailyBenchmark(state), /different BLADE baseline/);
    const seed = JSON.parse(await readFile(path.resolve("content/gtm-templates/BLADE/seed/blade-web.json"), "utf8"));
    const ops = buildHygieneOperations(seed);
    assert.ok(ops.every((op) => ["add_folder", "rename_tags", "assign_folders"].includes(op.op)));
  } finally { await rm(state, { recursive: true, force: true }); }
});

test("refuses a concurrent state lock", async () => {
  const state = await mkdtemp(path.join(tmpdir(), "blade-benchmark-"));
  try {
    await writeFile(path.join(state, "run.lock"), "held");
    await assert.rejects(() => runDailyBenchmark(state), /already running/);
  } finally { await rm(state, { recursive: true, force: true }); }
});

test("refuses a tampered authoritative export before a later run", async () => {
  const state = await mkdtemp(path.join(tmpdir(), "blade-benchmark-"));
  try {
    await runDailyBenchmark(state);
    const saved = JSON.parse(await readFile(path.join(state, "state.json"), "utf8"));
    await writeFile(path.join(saved.exportDir, "container.json"), "{}");
    await assert.rejects(() => runDailyBenchmark(state), /does not match state hash/);
  } finally { await rm(state, { recursive: true, force: true }); }
});

test("hygiene leaves all behavior fields intact and protects referenced tag names", async () => {
  const seed = JSON.parse(await readFile(path.resolve("content/gtm-templates/BLADE/seed/blade-web.json"), "utf8"));
  seed.containerVersion.tag[1].name = "Referenced tag";
  const initially = buildHygieneOperations(seed);
  assert.ok(initially.some(op => op.op === "rename_tags" && op.renames.some(r => r.tagId === seed.containerVersion.tag[1].tagId)));
  seed.containerVersion.tag[0].setupTag = [{tagName: "Referenced tag"}];
  const operations = buildHygieneOperations(seed);
  assert.ok(!operations.some(op => op.op === "rename_tags" && op.renames.some(r => r.tagId === seed.containerVersion.tag[1].tagId)));
  const candidate = applyOperations(seed, operations);
  const projection = (container: typeof seed) => {
    const result = structuredClone(container);
    delete result.containerVersion.folder;
    for (const tag of result.containerVersion.tag) { delete tag.name; delete tag.parentFolderId; }
    return result;
  };
  assert.deepEqual(projection(candidate), projection(seed));
  for (const folder of seed.containerVersion.folder) {
    assert.deepEqual(candidate.containerVersion.folder?.find(f => f.folderId === folder.folderId), folder);
  }
});

test("missing evidence leaves the committed best and history unchanged", async () => {
  const state = await mkdtemp(path.join(tmpdir(), "blade-benchmark-"));
  try {
    await runDailyBenchmark(state);
    const before = await readFile(path.join(state, "state.json"));
    await assert.rejects(() => runDailyBenchmark(state, path.join(state, "missing.json")), /ENOENT/);
    assert.deepEqual(await readFile(path.join(state, "state.json")), before);
    const history = await (await import("node:fs/promises")).readdir(path.join(state, "history"));
    assert.equal(history.length, 1);
  } finally { await rm(state, { recursive: true, force: true }); }
});
