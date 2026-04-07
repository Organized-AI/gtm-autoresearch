/**
 * Experiment Logger CLI
 *
 * Usage:
 *   npx tsx scripts/experiment-logger.ts export --client hre
 *   npx tsx scripts/experiment-logger.ts count --client hre
 *   npx tsx scripts/experiment-logger.ts import --file experiments.json --client hre
 */

import { readFileSync } from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { ExperimentLogger } from "../src/experiment-logger/index.js";
import type { ExperimentRecord } from "../src/types/experiment.js";

const args = process.argv.slice(2);
const command = args[0];

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const logger = new ExperimentLogger();

try {
  switch (command) {
    case "export": {
      const client = getFlag("--client");
      if (!client) {
        console.error("[Phase1] --client required for export");
        process.exit(1);
      }
      const jsonl = logger.export(client);
      if (jsonl) {
        process.stdout.write(jsonl + "\n");
      } else {
        console.log(`[Phase1] No records found for client "${client}"`);
      }
      break;
    }

    case "count": {
      const client = getFlag("--client");
      if (!client) {
        console.error("[Phase1] --client required for count");
        process.exit(1);
      }
      const n = logger.count(client);
      console.log(`[Phase1] ${n} records for client "${client}"`);
      break;
    }

    case "import": {
      const file = getFlag("--file");
      const client = getFlag("--client");
      if (!file || !client) {
        console.error("[Phase1] --file and --client required for import");
        process.exit(1);
      }
      const raw = readFileSync(file, "utf-8");
      const data: unknown[] = JSON.parse(raw);
      const records: ExperimentRecord[] = data.map((item) => ({
        id: (item as Record<string, unknown>).id as string || uuidv4(),
        client_id: client,
        run_id: (item as Record<string, unknown>).run_id as string || `imp-${Date.now()}`,
        problem: (item as Record<string, unknown>).problem as string || "",
        solution: (item as Record<string, unknown>).solution as string || "",
        score: Number((item as Record<string, unknown>).score) || 0,
        timestamp: (item as Record<string, unknown>).timestamp as string || new Date().toISOString(),
        account_snapshot: (item as Record<string, unknown>).account_snapshot as Record<string, unknown> || {},
        sources_used: (item as Record<string, unknown>).sources_used as string[] || [],
      }));
      logger.saveBatch(records);
      console.log(`[Phase1] Imported ${records.length} records for client "${client}"`);
      break;
    }

    default:
      console.error(
        "Usage: npx tsx scripts/experiment-logger.ts <export|count|import> [options]\n" +
        "  export --client <id>                Export JSONL to stdout\n" +
        "  count  --client <id>                Count records\n" +
        "  import --file <path> --client <id>  Bulk import JSON array",
      );
      process.exit(1);
  }
} finally {
  logger.close();
}
