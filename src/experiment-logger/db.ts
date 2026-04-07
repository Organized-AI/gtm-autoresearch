import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";
import type { ExperimentRecord } from "../types/experiment.js";

const DEFAULT_DB_PATH = path.resolve(
  import.meta.dirname,
  "../../data/experiments.sqlite",
);

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  problem TEXT NOT NULL,
  solution TEXT NOT NULL,
  score REAL NOT NULL,
  timestamp TEXT NOT NULL,
  account_snapshot TEXT NOT NULL,
  sources_used TEXT NOT NULL
);
`;

const CREATE_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_experiments_client_run
  ON experiments (client_id, run_id);
`;

export function openDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? DEFAULT_DB_PATH;
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.exec(CREATE_TABLE_SQL);
  db.exec(CREATE_INDEX_SQL);
  return db;
}

const INSERT_SQL = `
INSERT OR IGNORE INTO experiments
  (id, client_id, run_id, problem, solution, score, timestamp, account_snapshot, sources_used)
VALUES
  (@id, @client_id, @run_id, @problem, @solution, @score, @timestamp, @account_snapshot, @sources_used)
`;

export function insertRecord(db: Database.Database, record: ExperimentRecord): void {
  const stmt = db.prepare(INSERT_SQL);
  stmt.run({
    ...record,
    account_snapshot: JSON.stringify(record.account_snapshot),
    sources_used: JSON.stringify(record.sources_used),
  });
}

export function insertBatch(db: Database.Database, records: ExperimentRecord[]): void {
  const stmt = db.prepare(INSERT_SQL);
  const tx = db.transaction((recs: ExperimentRecord[]) => {
    for (const record of recs) {
      stmt.run({
        ...record,
        account_snapshot: JSON.stringify(record.account_snapshot),
        sources_used: JSON.stringify(record.sources_used),
      });
    }
  });
  tx(records);
}

export interface QueryOpts {
  client_id?: string;
  min_score?: number;
  since?: string;
}

export function queryRecords(db: Database.Database, opts: QueryOpts): ExperimentRecord[] {
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (opts.client_id) {
    conditions.push("client_id = @client_id");
    params.client_id = opts.client_id;
  }
  if (opts.min_score !== undefined) {
    conditions.push("score >= @min_score");
    params.min_score = opts.min_score;
  }
  if (opts.since) {
    conditions.push("timestamp >= @since");
    params.since = opts.since;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM experiments ${where} ORDER BY timestamp DESC`;
  const rows = db.prepare(sql).all(params) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    ...row,
    account_snapshot: JSON.parse(row.account_snapshot as string),
    sources_used: JSON.parse(row.sources_used as string),
  })) as ExperimentRecord[];
}

export function countRecords(db: Database.Database, client_id: string): number {
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM experiments WHERE client_id = ?")
    .get(client_id) as { cnt: number };
  return row.cnt;
}
