import type Database from "better-sqlite3";
import { ExperimentRecordSchema, type ExperimentRecord } from "../types/experiment.js";
import { openDb, insertRecord, insertBatch, queryRecords, countRecords, type QueryOpts } from "./db.js";

export class ExperimentLogger {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = openDb(dbPath);
  }

  save(record: ExperimentRecord): void {
    const validated = this.validate(record);
    insertRecord(this.db, validated);
    console.log(`[Phase1] Saved experiment ${validated.id} (client=${validated.client_id}, score=${validated.score})`);
  }

  saveBatch(records: ExperimentRecord[]): void {
    const validated = records.map((r) => this.validate(r));
    insertBatch(this.db, validated);
    console.log(`[Phase1] Saved batch of ${validated.length} experiments`);
  }

  query(opts: QueryOpts): ExperimentRecord[] {
    return queryRecords(this.db, opts);
  }

  export(client_id: string): string {
    const records = queryRecords(this.db, { client_id });
    return records.map((r) => JSON.stringify(r)).join("\n");
  }

  count(client_id: string): number {
    return countRecords(this.db, client_id);
  }

  close(): void {
    this.db.close();
  }

  private validate(record: ExperimentRecord): ExperimentRecord {
    // Clamp score to 0.0–1.0 with warning
    if (record.score < 0 || record.score > 1) {
      console.warn(`[Phase1] Score ${record.score} out of range for ${record.id}, clamping to 0.0–1.0`);
      record = { ...record, score: Math.max(0, Math.min(1, record.score)) };
    }
    return ExperimentRecordSchema.parse(record);
  }
}
