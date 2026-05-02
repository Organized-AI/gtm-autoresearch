# Workflows

Cloudflare Workflows is a **durable execution engine** that lets you build multi-step, long-running tasks with automatic retries, persistent state, and fault tolerance. Unlike regular Workers (which must respond within CPU time limits), Workflows can run for hours or days, survive restarts, and recover from failures.

---

## Core Concepts

| Concept | Description |
|---|---|
| **Workflow** | A class definition that describes a sequence of steps. Deployed as part of a Worker. |
| **Instance** | A single execution of a Workflow. Each trigger creates an instance with a unique ID. |
| **Step** | An atomic unit of work inside a Workflow. Each step is retried independently on failure. |
| **Sleep** | A durable timer. The Workflow pauses and resumes after the specified duration, even across restarts. |
| **Event** | An external signal sent to a running instance. Used for human-in-the-loop or async coordination patterns. |

### How Workflows Differ from Regular Workers

| Feature | Worker | Workflow |
|---|---|---|
| Max duration | 30s CPU time | Hours/days |
| State persistence | None (stateless) | Automatic (durable) |
| Retry on failure | Manual | Automatic per-step |
| Sleep/wait | Not possible | Built-in durable sleep |
| External events | Not supported | `sendEvent()` / `waitForEvent()` |

---

## CLI Commands: `wrangler workflows`

### List Workflows

```bash
wrangler workflows list
```

Lists all Workflow definitions deployed in your account.

| Flag | Description |
|---|---|
| `--json` | Output as JSON |

**Example:**

```bash
wrangler workflows list
```

Output:

```
Workflows:
  - order-processing (class: OrderWorkflow, script: order-worker)
  - data-pipeline    (class: DataPipeline, script: pipeline-worker)
  - onboarding-flow  (class: OnboardingFlow, script: onboarding-worker)
```

### Describe a Workflow

```bash
wrangler workflows describe <WORKFLOW_NAME>
```

Shows details about a Workflow definition including its class name, script, and recent instances.

**Example:**

```bash
wrangler workflows describe order-processing
```

### Delete a Workflow

```bash
wrangler workflows delete <WORKFLOW_NAME>
```

Removes a Workflow definition. Running instances are terminated.

### Trigger a Workflow

```bash
wrangler workflows trigger <WORKFLOW_NAME> [--params <JSON>]
```

Creates a new instance of the Workflow and starts execution.

| Flag | Description |
|---|---|
| `--params <JSON>` | JSON payload passed to the Workflow as input parameters |
| `--name <ID>` | Custom instance ID (defaults to auto-generated UUID) |
| `--json` | Output as JSON |

**Examples:**

```bash
# Trigger with no params
wrangler workflows trigger order-processing

# Trigger with params
wrangler workflows trigger order-processing \
  --params '{"orderId": "ORD-12345", "customerId": "CUST-789"}'

# Trigger with a custom instance ID
wrangler workflows trigger data-pipeline \
  --name "pipeline-2026-04-25" \
  --params '{"source": "s3://bucket/data.csv"}'
```

---

## Instance Management: `wrangler workflows instances`

### List Instances

```bash
wrangler workflows instances list <WORKFLOW_NAME>
```

| Flag | Description |
|---|---|
| `--status <STATUS>` | Filter by status: `running`, `paused`, `complete`, `errored`, `terminated`, `waiting` |
| `--limit <N>` | Max number of instances to return |
| `--json` | Output as JSON |

**Example:**

```bash
wrangler workflows instances list order-processing --status running
```

Output:

```
Instances of order-processing:
  ID                                    STATUS    STARTED               TRIGGER
  inst-a1b2c3d4                         running   2026-04-25T10:00:00Z  api
  inst-e5f6g7h8                         running   2026-04-25T10:05:00Z  api
```

### Describe an Instance

```bash
wrangler workflows instances describe <WORKFLOW_NAME> <INSTANCE_ID>
```

Shows detailed state of a specific instance, including completed steps, current step, errors, and output.

**Example:**

```bash
wrangler workflows instances describe order-processing inst-a1b2c3d4
```

Output:

```
Instance: inst-a1b2c3d4
Workflow: order-processing
Status: running
Started: 2026-04-25T10:00:00Z
Params: {"orderId": "ORD-12345", "customerId": "CUST-789"}

Steps:
  1. validate-order     COMPLETE  (0.5s)   output: {"valid": true}
  2. charge-payment     COMPLETE  (2.1s)   output: {"transactionId": "tx-abc"}
  3. fulfill-order      RUNNING   (1.3s)   ...
  4. send-confirmation  PENDING
```

### Pause an Instance

```bash
wrangler workflows instances pause <WORKFLOW_NAME> <INSTANCE_ID>
```

Pauses a running instance. The instance retains its state and can be resumed.

### Resume an Instance

```bash
wrangler workflows instances resume <WORKFLOW_NAME> <INSTANCE_ID>
```

Resumes a paused instance from where it left off.

### Restart an Instance

```bash
wrangler workflows instances restart <WORKFLOW_NAME> <INSTANCE_ID>
```

Restarts an instance from the beginning, re-running all steps.

### Terminate an Instance

```bash
wrangler workflows instances terminate <WORKFLOW_NAME> <INSTANCE_ID>
```

Stops a running instance permanently.

### Terminate All Instances

```bash
wrangler workflows instances terminate-all <WORKFLOW_NAME>
```

Terminates all running instances of a Workflow. Use with caution.

| Flag | Description |
|---|---|
| `--status <STATUS>` | Only terminate instances with this status |
| `--force` | Skip confirmation prompt |

**Example:**

```bash
# Terminate all errored instances
wrangler workflows instances terminate-all order-processing --status errored

# Terminate everything
wrangler workflows instances terminate-all order-processing --force
```

### Send an Event to an Instance

```bash
wrangler workflows instances send-event <WORKFLOW_NAME> <INSTANCE_ID> \
  --event-name <NAME> [--event-payload <JSON>]
```

Sends a named event to a running instance. The instance must be waiting for this event (via `waitForEvent()` in code).

**Example:**

```bash
wrangler workflows instances send-event order-processing inst-a1b2c3d4 \
  --event-name "approval" \
  --event-payload '{"approved": true, "approver": "manager@example.com"}'
```

---

## Writing Workflow Code

### Basic Workflow Structure

```typescript
// src/workflows/order-processing.ts
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";

type OrderParams = {
  orderId: string;
  customerId: string;
};

export class OrderWorkflow extends WorkflowEntrypoint<Env, OrderParams> {
  async run(event: WorkflowEvent<OrderParams>, step: WorkflowStep) {
    const { orderId, customerId } = event.payload;

    // Step 1: Validate the order
    const order = await step.do("validate-order", async () => {
      const res = await fetch(`https://api.example.com/orders/${orderId}`);
      const data = await res.json();
      if (!data.valid) throw new Error("Invalid order");
      return data;
    });

    // Step 2: Charge payment
    const payment = await step.do(
      "charge-payment",
      {
        retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
        timeout: "30 seconds",
      },
      async () => {
        const res = await fetch("https://payments.example.com/charge", {
          method: "POST",
          body: JSON.stringify({ orderId, amount: order.total }),
        });
        if (!res.ok) throw new Error("Payment failed");
        return res.json();
      }
    );

    // Step 3: Wait for warehouse confirmation (durable sleep + event)
    await step.sleep("wait-before-fulfillment", "10 seconds");

    // Step 4: Fulfill the order
    const fulfillment = await step.do("fulfill-order", async () => {
      const res = await fetch("https://warehouse.example.com/fulfill", {
        method: "POST",
        body: JSON.stringify({ orderId, transactionId: payment.transactionId }),
      });
      return res.json();
    });

    // Step 5: Send confirmation email
    await step.do("send-confirmation", async () => {
      await fetch("https://email.example.com/send", {
        method: "POST",
        body: JSON.stringify({
          to: customerId,
          subject: `Order ${orderId} confirmed`,
          body: `Your order has been fulfilled. Tracking: ${fulfillment.trackingNumber}`,
        }),
      });
    });

    return { orderId, status: "completed", trackingNumber: fulfillment.trackingNumber };
  }
}
```

### Step Options

```typescript
await step.do(
  "step-name",
  {
    retries: {
      limit: 5,            // Max retry attempts
      delay: "10 seconds",  // Initial delay between retries
      backoff: "exponential" // "linear" | "exponential"
    },
    timeout: "60 seconds",  // Max time for this step
  },
  async () => {
    // step logic
  }
);
```

### Durable Sleep

```typescript
// Sleep for a fixed duration
await step.sleep("wait-step", "1 hour");
await step.sleep("cool-down", "30 minutes");
await step.sleep("next-day", "24 hours");
```

The Workflow engine persists the sleep timer. Even if the Worker restarts, the Workflow resumes when the timer expires.

### Waiting for External Events

```typescript
// Wait for an external event (e.g., human approval)
const approvalEvent = await step.waitForEvent<{ approved: boolean }>(
  "wait-for-approval",
  {
    type: "approval",    // Event name to wait for
    timeout: "24 hours", // How long to wait before timing out
  }
);

if (approvalEvent.payload.approved) {
  // proceed
} else {
  // handle rejection
}
```

Send the event via CLI:

```bash
wrangler workflows instances send-event my-workflow inst-123 \
  --event-name "approval" \
  --event-payload '{"approved": true}'
```

Or programmatically from another Worker:

```typescript
await env.MY_WORKFLOW.get(instanceId).sendEvent("approval", { approved: true });
```

---

## Binding in `wrangler.jsonc`

```jsonc
{
  "name": "order-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "workflows": [
    {
      "name": "order-processing",
      "binding": "ORDER_WORKFLOW",
      "class_name": "OrderWorkflow"
    },
    {
      "name": "data-pipeline",
      "binding": "DATA_PIPELINE",
      "class_name": "DataPipeline"
    }
  ]
}
```

### Triggering from a Worker

```typescript
// src/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const body = await request.json();

    // Create a new Workflow instance
    const instance = await env.ORDER_WORKFLOW.create({
      params: {
        orderId: body.orderId,
        customerId: body.customerId,
      },
    });

    return Response.json({
      message: "Workflow started",
      instanceId: instance.id,
    });
  },
};

// Re-export the Workflow class so the runtime can find it
export { OrderWorkflow } from "./workflows/order-processing";
```

---

## Example: Multi-Step Data Processing Workflow with Error Handling

```typescript
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";

type PipelineParams = {
  sourceUrl: string;
  destBucket: string;
  notifyEmail: string;
};

export class DataPipeline extends WorkflowEntrypoint<Env, PipelineParams> {
  async run(event: WorkflowEvent<PipelineParams>, step: WorkflowStep) {
    const { sourceUrl, destBucket, notifyEmail } = event.payload;

    // Step 1: Download raw data
    const rawData = await step.do(
      "download-source",
      { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
      async () => {
        const res = await fetch(sourceUrl);
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        return await res.text();
      }
    );

    // Step 2: Parse and validate
    const records = await step.do("parse-and-validate", async () => {
      const rows = rawData.split("\n").filter(Boolean);
      const parsed = rows.map((row, i) => {
        const fields = row.split(",");
        if (fields.length < 3) throw new Error(`Invalid row ${i}: ${row}`);
        return { id: fields[0], name: fields[1], value: parseFloat(fields[2]) };
      });
      return parsed;
    });

    // Step 3: Transform data (batch processing)
    const transformed = await step.do("transform", async () => {
      return records.map((r) => ({
        ...r,
        value_normalized: r.value / 100,
        processed_at: new Date().toISOString(),
      }));
    });

    // Step 4: Upload to R2
    const uploadResult = await step.do(
      "upload-to-r2",
      { retries: { limit: 3, delay: "5 seconds", backoff: "linear" }, timeout: "60 seconds" },
      async () => {
        const key = `processed/${new Date().toISOString().split("T")[0]}/data.json`;
        // Uses the R2 binding from the Worker environment
        await this.env.DEST_BUCKET.put(key, JSON.stringify(transformed));
        return { bucket: destBucket, key, recordCount: transformed.length };
      }
    );

    // Step 5: Wait a bit, then verify the upload
    await step.sleep("post-upload-delay", "5 seconds");

    const verification = await step.do("verify-upload", async () => {
      const obj = await this.env.DEST_BUCKET.get(uploadResult.key);
      if (!obj) throw new Error("Upload verification failed: object not found");
      return { verified: true, size: obj.size };
    });

    // Step 6: Send notification
    await step.do("notify", async () => {
      await fetch("https://email.example.com/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: notifyEmail,
          subject: "Data pipeline complete",
          body: `Processed ${uploadResult.recordCount} records. File: ${uploadResult.key} (${verification.size} bytes)`,
        }),
      });
    });

    return {
      status: "complete",
      recordCount: uploadResult.recordCount,
      outputKey: uploadResult.key,
    };
  }
}
```

Trigger it:

```bash
wrangler workflows trigger data-pipeline \
  --params '{
    "sourceUrl": "https://data.example.com/export/2026-04-25.csv",
    "destBucket": "processed-data",
    "notifyEmail": "ops@example.com"
  }'
```

Monitor it:

```bash
# Check status
wrangler workflows instances list data-pipeline --status running

# Get detailed step-by-step progress
wrangler workflows instances describe data-pipeline inst-xyz123
```

---

## Tips

- **Idempotent steps** -- Each step should be idempotent because it may be retried. Avoid side effects that cannot be safely repeated (e.g., use PUT instead of POST for uploads, use idempotency keys for payment APIs).
- **Step granularity** -- Keep steps small and focused. If a step fails, only that step is retried, not the entire Workflow. Coarse-grained steps mean more wasted work on retry.
- **Return values are persisted** -- The return value of each `step.do()` is durably stored. On retry or restart, already-completed steps return their stored result instantly without re-executing.
- **Payload size limits** -- Step return values and event payloads are stored durably. Keep them reasonably small (kilobytes, not megabytes). Store large data in R2 or KV and pass references.
- **Error handling** -- If a step exhausts its retries, the Workflow instance moves to `errored` state. You can restart it from the CLI or programmatically.
- **Instance IDs** -- Use meaningful instance IDs (e.g., `order-12345`) instead of auto-generated UUIDs when you need to look them up later or prevent duplicate processing.
- **Concurrency** -- Multiple instances of the same Workflow can run concurrently. If you need mutual exclusion, use a Durable Object or custom locking mechanism.
- **Testing locally** -- Use `wrangler dev` to test Workflows locally. Instance state is stored in-memory during development.

---

## See Also

- [[Pipelines]] -- Serverless data streaming (complementary to Workflows for ETL)
- [[Dynamic-Workers]] -- Multi-tenant dispatch (can trigger Workflows per-tenant)
- [[Networking]] -- Cron triggers to schedule Workflow execution
