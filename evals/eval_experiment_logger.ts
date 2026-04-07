/**
 * Experiment Logger Evaluator
 *
 * Tests: schema validation, score normalization, SQLite round-trip,
 * JSONL export, idempotency, client filtering.
 *
 * CLI: npx tsx evals/eval_experiment_logger.ts
 */

import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { ExperimentRecordSchema, type ExperimentRecord } from "../src/types/experiment.js";
import { ExperimentLogger } from "../src/experiment-logger/logger.js";

const TEST_DB = path.join(tmpdir(), `test-experiments-${Date.now()}.sqlite`);

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}`);
    failed++;
  }
}

function makeRecord(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    id: uuidv4(),
    client_id: "test",
    run_id: "exp-2026-04-07-001",
    problem: "Test problem",
    solution: "Test solution",
    score: 0.85,
    timestamp: new Date().toISOString(),
    account_snapshot: { tags: 12, triggers: 5 },
    sources_used: ["gtm", "google_ads"],
    ...overrides,
  };
}

// ── Test: Schema validation ────────────────────────────────────────────────

console.log("\n=== Schema Validation ===\n");

{
  const valid = makeRecord();
  const result = ExperimentRecordSchema.safeParse(valid);
  assert(result.success, "Valid record passes schema");
}

{
  const missing = { id: "not-a-uuid", client_id: "" };
  const result = ExperimentRecordSchema.safeParse(missing);
  assert(!result.success, "Missing fields fail schema");
}

{
  const badScore = makeRecord({ score: 1.5 });
  const result = ExperimentRecordSchema.safeParse(badScore);
  assert(!result.success, "Score > 1.0 fails schema validation");
}

{
  const negScore = makeRecord({ score: -0.1 });
  const result = ExperimentRecordSchema.safeParse(negScore);
  assert(!result.success, "Score < 0.0 fails schema validation");
}

// ── Test: Score normalization in logger ─────────────────────────────────────

console.log("\n=== Score Normalization ===\n");

{
  const logger = new ExperimentLogger(TEST_DB);
  try {
    // 0.75 passes without warning
    const rec = makeRecord({ score: 0.75 });
    logger.save(rec);
    const queried = logger.query({ client_id: "test" });
    const found = queried.find((r) => r.id === rec.id);
    assert(found?.score === 0.75, "Score 0.75 saved as-is");

    // 1.1 gets clamped to 1.0
    const overRange = makeRecord({ score: 1.1 as unknown as number });
    // Bypass zod by going through logger which clamps first
    logger.save(overRange);
    const found2 = logger.query({ client_id: "test" }).find((r) => r.id === overRange.id);
    assert(found2?.score === 1.0, "Score 1.1 clamped to 1.0");

    // -0.5 gets clamped to 0.0
    const underRange = makeRecord({ score: -0.5 as unknown as number });
    logger.save(underRange);
    const found3 = logger.query({ client_id: "test" }).find((r) => r.id === underRange.id);
    assert(found3?.score === 0.0, "Score -0.5 clamped to 0.0");
  } finally {
    logger.close();
  }
}

// ── Test: SQLite round-trip ─────────────────────────────────────────────────

console.log("\n=== SQLite Round-Trip ===\n");

{
  // Use fresh DB for clean round-trip test
  const rtDb = path.join(tmpdir(), `test-rt-${Date.now()}.sqlite`);
  const logger = new ExperimentLogger(rtDb);
  try {
    const rec = makeRecord({
      client_id: "hre",
      problem: "Low purchase tracking",
      solution: "Added GA4 purchase tag with ecommerce DL",
      score: 0.92,
      account_snapshot: { tags: 15, triggers: 8, purchase_value: 12500 },
      sources_used: ["gtm", "google_ads", "meta"],
    });
    logger.save(rec);

    const results = logger.query({ client_id: "hre" });
    assert(results.length === 1, "Query returns 1 record");

    const r = results[0];
    assert(r.id === rec.id, "ID matches");
    assert(r.client_id === "hre", "client_id matches");
    assert(r.problem === rec.problem, "problem matches");
    assert(r.solution === rec.solution, "solution matches");
    assert(r.score === 0.92, "score matches");
    assert(Array.isArray(r.account_snapshot) === false && typeof r.account_snapshot === "object", "account_snapshot is object");
    assert((r.account_snapshot as Record<string, unknown>).tags === 15, "account_snapshot.tags matches");
    assert(Array.isArray(r.sources_used) && r.sources_used.length === 3, "sources_used round-trips as array");
    assert(r.sources_used.includes("meta"), "sources_used contains 'meta'");
  } finally {
    logger.close();
    if (existsSync(rtDb)) unlinkSync(rtDb);
  }
}

// ── Test: JSONL export ──────────────────────────────────────────────────────

console.log("\n=== JSONL Export ===\n");

{
  const jlDb = path.join(tmpdir(), `test-jl-${Date.now()}.sqlite`);
  const logger = new ExperimentLogger(jlDb);
  try {
    logger.save(makeRecord({ client_id: "jltest" }));
    logger.save(makeRecord({ client_id: "jltest" }));

    const jsonl = logger.export("jltest");
    const lines = jsonl.split("\n").filter(Boolean);
    assert(lines.length === 2, "Export produces 2 lines");

    let allValid = true;
    for (const line of lines) {
      try {
        JSON.parse(line);
      } catch {
        allValid = false;
      }
    }
    assert(allValid, "Each JSONL line is valid JSON");
  } finally {
    logger.close();
    if (existsSync(jlDb)) unlinkSync(jlDb);
  }
}

// ── Test: Idempotency ───────────────────────────────────────────────────────

console.log("\n=== Idempotency ===\n");

{
  const idDb = path.join(tmpdir(), `test-idem-${Date.now()}.sqlite`);
  const logger = new ExperimentLogger(idDb);
  try {
    const rec = makeRecord({ client_id: "idem" });

    logger.save(rec);
    logger.save(rec); // duplicate
    logger.save(rec); // triple

    const count = logger.count("idem");
    assert(count === 1, "Saving same record 3 times produces 1 row");
  } finally {
    logger.close();
    if (existsSync(idDb)) unlinkSync(idDb);
  }
}

// ── Test: Client filtering ──────────────────────────────────────────────────

console.log("\n=== Client Filtering ===\n");

{
  const cfDb = path.join(tmpdir(), `test-cf-${Date.now()}.sqlite`);
  const logger = new ExperimentLogger(cfDb);
  try {
    logger.save(makeRecord({ client_id: "alpha" }));
    logger.save(makeRecord({ client_id: "alpha" }));
    logger.save(makeRecord({ client_id: "beta" }));

    const alpha = logger.query({ client_id: "alpha" });
    assert(alpha.length === 2, "Query client 'alpha' returns 2 records");

    const beta = logger.query({ client_id: "beta" });
    assert(beta.length === 1, "Query client 'beta' returns 1 record");

    const all = logger.query({});
    assert(all.length === 3, "Query with no filter returns all 3 records");

    const highScore = logger.query({ min_score: 0.9 });
    assert(
      highScore.every((r) => r.score >= 0.9),
      "min_score filter returns only records >= 0.9",
    );
  } finally {
    logger.close();
    if (existsSync(cfDb)) unlinkSync(cfDb);
  }
}

// ── Test: Batch save ────────────────────────────────────────────────────────

console.log("\n=== Batch Save ===\n");

{
  const bDb = path.join(tmpdir(), `test-batch-${Date.now()}.sqlite`);
  const logger = new ExperimentLogger(bDb);
  try {
    const records = Array.from({ length: 50 }, () => makeRecord({ client_id: "batch" }));
    logger.saveBatch(records);
    assert(logger.count("batch") === 50, "Batch save of 50 records works");
  } finally {
    logger.close();
    if (existsSync(bDb)) unlinkSync(bDb);
  }
}

// ── Cleanup & Summary ───────────────────────────────────────────────────────

if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
