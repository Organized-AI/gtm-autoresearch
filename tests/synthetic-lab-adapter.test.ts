import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSyntheticReplayRows, compactSyntheticJudgeInput, observeSyntheticCase, validateSyntheticShape, loadManifest } from "../scripts/synthetic-lab-adapter.js";
import { assertGroupDisjoint, splitByGroup } from "../scripts/jev-offline.js";
import { buildEvidence, compactJudgeInput, FakeJudge, shadowPolicy } from "../scripts/jev-shadow.js";
import { evaluateGtmSignalQuality, type GtmContainer } from "../evals/eval_gtm_signal_quality.js";

type Json = Record<string, unknown>;
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Json)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const hash = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
const BEFORE = "2026-01-01T00:00:00Z", CHANGE = "2026-01-02T00:00:00Z", CUTOFF = "2026-01-02T06:00:00Z";
function container(name: string, badReference = false) {
  return { exportFormatVersion: 2, containerVersion: { accountId: "1", containerId: "2", containerVersionId: name,
    container: { accountId: "1", containerId: "2", usageContext: ["WEB"] },
    tag: [{ tagId: "1", name, type: "gaawe", firingTriggerId: [badReference ? "999" : "1"], parameter: [] }],
    trigger: [{ triggerId: "1", type: "CUSTOM_EVENT" }], variable: [], folder: [] } };
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "gtm-lab-test-")), dataset = path.join(root, "datasets/demo-v1");
  const base = path.join(dataset, "observations/case-001"); await mkdir(base, { recursive: true });
  const write = async (file: string, value: unknown) => writeFile(path.join(base, file), JSON.stringify(value));
  const writeRows = async (file: string, rows: Json[]) => writeFile(path.join(base, file), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
  const a = container("baseline"), b = container("current", true);
  for (const side of ["web", "server"]) { await write(`${side}-before.json`, a); await write(`${side}-after.json`, b); }
  await write("container-history.json", [
    { effective_at: BEFORE, web_hash: hash(a), server_hash: hash(a) },
    { effective_at: CHANGE, web_hash: hash(b), server_hash: hash(b) },
    { effective_at: "2026-01-03T00:00:00Z", web_hash: "future-secret-hash", server_hash: "future-secret-hash" },
  ]);
  const event = (at: string, id: string): Json => ({ occurred_at: at, event_name: "purchase", event_id: id, channel: "meta", consent: { ad_storage: "granted", analytics_storage: "granted" } });
  const rows = [event("2026-01-01T01:00:00Z", "a"), event("2026-01-02T05:00:00Z", "b"), event("2026-01-02T07:00:00Z", "future-event")];
  await writeRows("data-layer.jsonl", rows);
  const request = (row: Json, platform: string, source: string): Json => ({ ...row, dispatched_at: row.occurred_at, logical_event_id: row.event_id, platform, source, http_status: 200, match_fields_present: true, conversion_label: null });
  const network = [request(rows[0], "meta", "browser"), request(rows[1], "meta", "browser"), { ...request(rows[1], "meta", "server"), event_id: "b-server" }, request(rows[1], "google_ads", "browser"),
    { ...request(rows[0], "ga4", "browser"), dispatched_at: "2026-01-02T07:00:00Z" }, request(rows[2], "meta", "browser")];
  await writeRows("network-events.jsonl", network);
  const snapshot = (at: string, count: number): Json => ({ platform: "meta", observed_at: at, event_window: "before", window_start: BEFORE, window_end_exclusive: CHANGE,
    synthetic_clicks: 1, synthetic_spend: 1.2, conversion_actions: [], futureOracle: "never-include-this",
    events: [{ event_name: "purchase", received_requests: count * 2, unique_events: count, attributed_conversions: count, simulated_emq_proxy: 8 }] });
  await writeRows("platform-snapshots.jsonl", [snapshot(CHANGE, 1), snapshot(CUTOFF, 2), snapshot("2026-01-03T00:00:00Z", 9999)]);
  await writeFile(path.join(dataset, "manifest.json"), JSON.stringify({ schema_version: "1.0.0", lineage_group: "single-lineage", synthetic: true, cases: [{ case_id: "case-001", directory: "observations/case-001" }] }));
  return { root, base, dataset, a, b, write, writeRows, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("time cutoff covers history, active export, visitors, dispatches and full platform payloads", async () => {
  const f = await fixture();
  try {
    const observation = await observeSyntheticCase(f.root, "case-001", CUTOFF);
    assert.equal(observation.facts.visitorEvents, 2); assert.equal(observation.facts.networkDeliveries, 4);
    assert.equal((observation.facts.containerHistory as unknown[]).length, 2);
    const snapshots = observation.facts.availablePlatformSnapshots as Array<{ events: Array<{ uniqueEvents: number }> }>;
    assert.deepEqual(snapshots.map(s => s.events[0].uniqueEvents), [1, 2]);
    const serialized = JSON.stringify(observation);
    for (const secret of ["future-secret-hash", "future-event", "never-include-this", "9999"]) assert.ok(!serialized.includes(secret), secret);
    const containers = observation.facts.containers as Record<string, { activeValidation: { valid: boolean }; changedEntities: Json[] }>;
    assert.equal(containers.web.activeValidation.valid, false); assert.equal(containers.web.changedEntities.length, 1);
    assert.deepEqual(observation.facts.metaObservedPairing, { bothSources: 1, mismatchedPayloadEventIds: 1 });
    const counts = observation.facts.networkCounts as Json[];
    assert.equal(counts.find(c => c.platform === "meta" && c.source === "browser")?.requests, 2);
    assert.equal(counts.find(c => c.platform === "google_ads")?.requests, 1);
  } finally { await f.cleanup(); }
});

test("future mutations are not opened before their effective time", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.base, "web-after.json"), "invalid-future-json");
    await writeFile(path.join(f.base, "server-after.json"), "invalid-future-json");
    const observation = await observeSyntheticCase(f.root, "case-001", "2026-01-01T12:00:00Z");
    const containers = observation.facts.containers as Record<string, { activeHash: string; changedEntities: unknown[] }>;
    assert.equal(containers.web.activeHash, hash(f.a)); assert.deepEqual(containers.web.changedEntities, []);
    assert.equal((observation.facts.containerHistory as unknown[]).length, 1);
    assert.equal((observation.facts.availablePlatformSnapshots as unknown[]).length, 0);
  } finally { await f.cleanup(); }
});

test("timezone offsets represent the same decision boundary; invalid cutoffs fail", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await observeSyntheticCase(f.root, "case-001", CUTOFF), await observeSyntheticCase(f.root, "case-001", "2026-01-02T01:00:00-05:00"));
    for (const t of ["bad", "2026-01-02T06:00:00", "2025-12-31T00:00:00Z"]) await assert.rejects(observeSyntheticCase(f.root, "case-001", t));
  } finally { await f.cleanup(); }
});

test("container content hashes are verified", async () => {
  const f = await fixture();
  try { await f.write("web-after.json", container("tampered")); await assert.rejects(observeSyntheticCase(f.root, "case-001", CUTOFF), /active hash mismatch/); }
  finally { await f.cleanup(); }
});

test("model state excludes case identity and ground truth; replay preserves one lineage", async () => {
  const f = await fixture();
  try {
    const observation = await observeSyntheticCase(f.root, "case-001", CUTOFF);
    const input = compactSyntheticJudgeInput(observation);
    assert.ok(!JSON.stringify(input).includes("case-001")); assert.ok(!JSON.stringify(input).includes("single-lineage"));
    const rows = await buildSyntheticReplayRows(f.root, CUTOFF), split = splitByGroup(rows);
    assertGroupDisjoint(split); assert.equal(Object.values(split).filter(s => s.length > 0).length, 1);
    assert.equal(rows[0].label, undefined); assert.equal(rows[0].prediction.status, "unavailable");
  } finally { await f.cleanup(); }
});

test("manifest cannot redirect observations to an oracle directory", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.dataset, "manifest.json"), JSON.stringify({ schema_version: "1", lineage_group: "one", synthetic: true, cases: [{ case_id: "case-001", directory: "../ground-truth" }] }));
    await assert.rejects(observeSyntheticCase(f.root, "case-001", CUTOFF), /invalid observation directory/);
  } finally { await f.cleanup(); }
});

test("reference-shape validation detects duplicate IDs and broken relationships", () => {
  assert.equal(validateSyntheticShape(container("ok")).valid, true);
  assert.equal(validateSyntheticShape(container("wrong", true)).valid, false);
  const duplicate = container("duplicate"); duplicate.containerVersion.tag.push(duplicate.containerVersion.tag[0]);
  assert.ok(validateSyntheticShape(duplicate).issues.includes("tag: duplicate IDs"));
});

test("bounded synthetic evidence reaches the shadow contract without asserting real QA", async () => {
  const f = await fixture();
  try {
    const observation = await observeSyntheticCase(f.root, "case-001", "2026-01-01T12:00:00Z");
    const container = f.a as unknown as GtmContainer;
    const scores = evaluateGtmSignalQuality(container);
    const state = compactSyntheticJudgeInput(observation);
    const evidence = buildEvidence({ parentId: "synthetic-parent", baseline: container, candidate: container,
      operations: [], targetedIssue: "Assess tracking behavior from the supplied observations",
      before: scores, after: scores, supportingEvidence: state,
      validation: { valid: true, reason: "fixture checks passed", changedEntityIds: { tag: [], trigger: [], variable: [], folder: [] } } });
    assert.deepEqual(compactJudgeInput(evidence).supportingEvidence, state);
    assert.equal(evidence.qa.status, "absent");
    const result = await new FakeJudge().judge(evidence);
    assert.equal(result.status, "success");
    assert.equal(shadowPolicy(evidence, result).route, "review");
  } finally { await f.cleanup(); }
});


test("v2 direct dataset roots honor complete declared topology splits and reject conflicts", async () => {
  const f = await fixture();
  try {
    const caseTwo = path.join(f.dataset, "observations/case-002");
    await cp(f.base, caseTwo, { recursive: true });
    const secondBaseline = container("baseline-2"), secondCurrent = container("current-2", true);
    for (const side of ["web", "server"]) {
      await writeFile(path.join(caseTwo, `${side}-before.json`), JSON.stringify(secondBaseline));
      await writeFile(path.join(caseTwo, `${side}-after.json`), JSON.stringify(secondCurrent));
    }
    await writeFile(path.join(caseTwo, "container-history.json"), JSON.stringify([
      { effective_at: BEFORE, web_hash: hash(secondBaseline), server_hash: hash(secondBaseline) },
      { effective_at: CHANGE, web_hash: hash(secondCurrent), server_hash: hash(secondCurrent) },
    ]));
    const manifest = { schema_version: "2.0.0", synthetic: true, cases: [
      { case_id: "case-001", directory: "observations/case-001", lineage_group: "L1", container_group: "C1", topology_group: "retail", split: "train" },
      { case_id: "case-002", directory: "observations/case-002", lineage_group: "L2", container_group: "C2", topology_group: "leadgen", split: "holdout" }
    ] };
    await writeFile(path.join(f.dataset, "manifest.json"), JSON.stringify(manifest));
    assert.equal((await loadManifest(f.dataset)).schema_version, "2.0.0");
    const rows = await buildSyntheticReplayRows(f.dataset, CUTOFF), split = splitByGroup(rows);
    assert.equal(split.train.length, 1); assert.equal(split.holdout.length, 1); assertGroupDisjoint(split);
    assert.ok(!JSON.stringify(rows[0].input).includes("retail"));
    assert.ok(rows[0].provenance.baselineGroup);
    await cp(f.base, caseTwo, { recursive: true, force: true });
    const duplicatedBaselineRows = await buildSyntheticReplayRows(f.dataset, CUTOFF);
    assert.throws(() => splitByGroup(duplicatedBaselineRows), /conflicting or incomplete/);
    manifest.cases[1].topology_group = "retail"; await writeFile(path.join(f.dataset, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(loadManifest(f.dataset), /topology has conflicting/);
  } finally { await f.cleanup(); }
});

test("split components reject partial declarations and hold cross-seed topology together", () => {
  const row = (lineageGroup: string, plannedSplit?: "train"|"validation"|"holdout") => ({ input: {}, prediction: { status: "unavailable" as const, reason: "offline" }, provenance: { containerGroup: `container-${lineageGroup}`, lineageGroup, topologyGroup: "subscription", plannedSplit, synthetic: true, samplingReasons: [] } });
  assert.throws(() => splitByGroup([row("seed-a", "validation"), row("seed-b")]), /conflicting or incomplete/);
  assert.throws(() => splitByGroup([row("seed-a", "validation"), row("seed-b", "holdout")]), /conflicting or incomplete/);
  const independent = { ...row("seed-c"), provenance: { ...row("seed-c").provenance, topologyGroup: "retail" } };
  assert.throws(() => splitByGroup([row("seed-a", "validation"), independent]), /conflicting or incomplete/);
  const split = splitByGroup([row("seed-a", "validation"), row("seed-b", "validation")]);
  assert.equal(split.validation.length, 2); assertGroupDisjoint(split);
});

test("v2 manifests reject incomplete grouping metadata and duplicate case IDs", async () => {
  const f = await fixture();
  try {
    const base = { schema_version: "2.0.0", synthetic: true, cases: [{ case_id: "case-001", directory: "observations/case-001", lineage_group: "L1", container_group: "C1", topology_group: "retail", split: "train" }] };
    await writeFile(path.join(f.dataset, "manifest.json"), JSON.stringify({ ...base, cases: [{ ...base.cases[0], topology_group: "" }] }));
    await assert.rejects(loadManifest(f.dataset), /missing grouping metadata/);
    await writeFile(path.join(f.dataset, "manifest.json"), JSON.stringify({ ...base, cases: [base.cases[0], base.cases[0]] }));
    await assert.rejects(loadManifest(f.dataset), /duplicate case IDs/);
    await writeFile(path.join(f.dataset, "manifest.json"), JSON.stringify({ ...base, cases: [base.cases[0], { ...base.cases[0], case_id: "case-002" }] }));
    await assert.rejects(loadManifest(f.dataset), /duplicate observation directories/);
    await writeFile(path.join(f.dataset, "manifest.json"), JSON.stringify({ ...base, schema_version: "3.0.0" }));
    await assert.rejects(loadManifest(f.dataset), /unsupported synthetic manifest schema/);
  } finally { await f.cleanup(); }
});
