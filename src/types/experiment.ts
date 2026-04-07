import { z } from "zod";

export const ExperimentRecordSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().min(1),
  run_id: z.string().min(1),
  problem: z.string(),
  solution: z.string(),
  score: z.number().min(0).max(1),
  timestamp: z.string().datetime(),
  account_snapshot: z.record(z.unknown()),
  sources_used: z.array(z.string()),
});

export type ExperimentRecord = z.infer<typeof ExperimentRecordSchema>;
