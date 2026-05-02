# Pipelines

Cloudflare Pipelines is a **serverless data streaming** service that lets you ingest, transform, and deliver data at scale. Pipelines connect **sources** (where data comes from) to **sinks** (where data goes), with optional transformation logic in between. Think of it as a managed, edge-native data pipeline that requires no infrastructure to operate.

---

## Core Concepts

| Concept | Description |
|---|---|
| **Pipeline** | A named data flow connecting one or more sources to one or more sinks. |
| **Source / Stream** | An ingestion endpoint that receives data. Can be HTTP (webhook-style) or a Workers binding. |
| **Sink / Destination** | Where processed data is delivered. Supported destinations include R2, Workers, and more. |
| **Transform** | Optional processing logic applied to data in transit. Runs as Worker code. |
| **Batch** | Pipelines batch incoming records for efficient delivery. You can configure batch size and interval. |

### Architecture

```
Sources                     Pipeline                    Sinks
---------                 -----------                 -------
HTTP endpoint  -----\                          /----> R2 bucket
                     +---->  [Transform]  ----+
Worker binding -----/                          \----> Worker
```

---

## CLI Commands: `wrangler pipelines`

### Guided Setup

```bash
wrangler pipelines setup
```

Interactive wizard that walks you through creating a pipeline with sources and sinks. Best for first-time setup.

**Example:**

```bash
wrangler pipelines setup
```

The wizard prompts for:
1. Pipeline name
2. Source type (HTTP, Workers)
3. Sink type (R2, Workers)
4. Transform Worker (optional)
5. Batch configuration

### Create a Pipeline

```bash
wrangler pipelines create <NAME>
```

| Flag | Description |
|---|---|
| `--json` | Output as JSON |

**Example:**

```bash
wrangler pipelines create webhook-ingestion
```

Output:

```
Created pipeline "webhook-ingestion" (id: pipe-abc123)
```

### List Pipelines

```bash
wrangler pipelines list
```

| Flag | Description |
|---|---|
| `--json` | Output as JSON |

**Example:**

```bash
wrangler pipelines list
```

Output:

```
Pipelines:
  NAME                 ID            STATUS   SOURCES  SINKS
  webhook-ingestion    pipe-abc123   active   1        1
  event-archive        pipe-def456   active   2        1
  log-processor        pipe-ghi789   paused   1        2
```

### Get Pipeline Details

```bash
wrangler pipelines get <NAME>
```

Shows configuration, sources, sinks, and stats for a specific pipeline.

**Example:**

```bash
wrangler pipelines get webhook-ingestion
```

Output:

```
Pipeline: webhook-ingestion (pipe-abc123)
Status: active
Created: 2026-04-20T10:00:00Z

Sources:
  - http-webhook (type: HTTP, endpoint: https://pipe-abc123.pipelines.cloudflare.com)

Sinks:
  - r2-archive (type: R2, bucket: webhook-data, prefix: raw/)

Batch Config:
  max_bytes: 5242880 (5 MB)
  max_seconds: 60
  max_records: 10000
```

### Update a Pipeline

```bash
wrangler pipelines update <NAME>
```

| Flag | Description |
|---|---|
| `--batch-max-seconds <N>` | Max seconds before a batch is flushed |
| `--batch-max-bytes <N>` | Max batch size in bytes |
| `--batch-max-records <N>` | Max records per batch |
| `--json` | Output as JSON |

**Example:**

```bash
wrangler pipelines update webhook-ingestion \
  --batch-max-seconds 30 \
  --batch-max-records 5000
```

### Delete a Pipeline

```bash
wrangler pipelines delete <NAME>
```

| Flag | Description |
|---|---|
| `--force` | Skip confirmation prompt |

**Example:**

```bash
wrangler pipelines delete old-pipeline --force
```

---

## Streams (Sources): `wrangler pipelines streams`

Streams are the ingestion side of a pipeline -- they define where data enters.

### Create a Stream

```bash
wrangler pipelines streams create <PIPELINE_NAME> <STREAM_NAME>
```

| Flag | Description |
|---|---|
| `--type <TYPE>` | Source type: `http`, `worker` |
| `--json` | Output as JSON |

**Example (HTTP source):**

```bash
wrangler pipelines streams create webhook-ingestion http-webhook --type http
```

Output:

```
Created stream "http-webhook" on pipeline "webhook-ingestion"
Endpoint: https://pipe-abc123.pipelines.cloudflare.com/http-webhook
```

The endpoint URL accepts POST requests with JSON payloads.

**Example (Worker source):**

```bash
wrangler pipelines streams create webhook-ingestion worker-source --type worker
```

### List Streams

```bash
wrangler pipelines streams list <PIPELINE_NAME>
```

**Example:**

```bash
wrangler pipelines streams list webhook-ingestion
```

Output:

```
Streams for webhook-ingestion:
  NAME            TYPE    ENDPOINT
  http-webhook    HTTP    https://pipe-abc123.pipelines.cloudflare.com/http-webhook
  worker-source   Worker  (bind via wrangler.jsonc)
```

### Get Stream Details

```bash
wrangler pipelines streams get <PIPELINE_NAME> <STREAM_NAME>
```

### Delete a Stream

```bash
wrangler pipelines streams delete <PIPELINE_NAME> <STREAM_NAME>
```

---

## Sinks (Destinations): `wrangler pipelines sinks`

Sinks define where processed data is delivered.

### Create a Sink

```bash
wrangler pipelines sinks create <PIPELINE_NAME> <SINK_NAME>
```

| Flag | Description |
|---|---|
| `--type <TYPE>` | Sink type: `r2`, `worker` |
| `--bucket <NAME>` | R2 bucket name (for R2 sinks) |
| `--prefix <PATH>` | Key prefix for R2 objects |
| `--format <FMT>` | Output format: `json`, `ndjson`, `csv` |
| `--json` | Output as JSON |

**Example (R2 sink):**

```bash
wrangler pipelines sinks create webhook-ingestion r2-archive \
  --type r2 \
  --bucket webhook-data \
  --prefix "raw/" \
  --format ndjson
```

**Example (Worker sink):**

```bash
wrangler pipelines sinks create webhook-ingestion worker-processor \
  --type worker
```

### List Sinks

```bash
wrangler pipelines sinks list <PIPELINE_NAME>
```

**Example:**

```bash
wrangler pipelines sinks list webhook-ingestion
```

Output:

```
Sinks for webhook-ingestion:
  NAME              TYPE    DESTINATION
  r2-archive        R2      webhook-data/raw/
  worker-processor  Worker  processor-worker
```

### Get Sink Details

```bash
wrangler pipelines sinks get <PIPELINE_NAME> <SINK_NAME>
```

### Delete a Sink

```bash
wrangler pipelines sinks delete <PIPELINE_NAME> <SINK_NAME>
```

---

## Supported Sources and Sinks

### Sources

| Type | Description | How Data Enters |
|---|---|---|
| **HTTP** | Webhook-style endpoint | POST JSON to the pipeline's HTTP URL |
| **Workers** | Programmatic ingestion from Worker code | Use the pipeline binding in your Worker |

### Sinks

| Type | Description | How Data is Delivered |
|---|---|---|
| **R2** | Object storage | Batched files written as objects (JSON, NDJSON, CSV) |
| **Workers** | Custom processing | Batches delivered to a Worker's `queue()` handler |

---

## Binding in `wrangler.jsonc`

To send data to a pipeline from a Worker, add a pipeline binding:

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "pipelines": [
    {
      "binding": "MY_PIPELINE",
      "pipeline": "webhook-ingestion"
    }
  ]
}
```

### Sending Data from a Worker

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const data = await request.json();

    // Send a single record
    await env.MY_PIPELINE.send({
      timestamp: Date.now(),
      event: "page_view",
      userId: data.userId,
      url: data.url,
    });

    return new Response("Event recorded", { status: 202 });
  },
};
```

### Sending Batches from a Worker

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const events = await request.json();

    // Send multiple records at once
    await env.MY_PIPELINE.sendBatch(
      events.map((e: any) => ({
        timestamp: Date.now(),
        ...e,
      }))
    );

    return new Response(`${events.length} events recorded`, { status: 202 });
  },
};
```

---

## Transform Workers

You can attach a transform Worker to process data in transit before it reaches the sink.

```jsonc
// wrangler.jsonc for the pipeline (configured during setup)
{
  "pipelines": [
    {
      "name": "webhook-ingestion",
      "transform": {
        "script": "transform-worker"
      }
    }
  ]
}
```

Transform Worker code:

```typescript
export default {
  async pipelines(
    records: PipelineRecord[],
    env: Env
  ): Promise<PipelineRecord[]> {
    // Filter, transform, or enrich records
    return records
      .filter((r) => r.data.event !== "bot_visit") // drop bot events
      .map((r) => ({
        ...r,
        data: {
          ...r.data,
          processed_at: new Date().toISOString(),
          region: r.cf?.country ?? "unknown",
        },
      }));
  },
};
```

---

## Example: Webhook Ingestion to R2

A complete example of setting up a pipeline that ingests webhook data from external services and stores it in R2.

### Step 1: Create the Pipeline

```bash
wrangler pipelines create webhook-archive
```

### Step 2: Add an HTTP Source

```bash
wrangler pipelines streams create webhook-archive incoming-webhooks --type http
```

Note the endpoint URL from the output:

```
Endpoint: https://pipe-xyz789.pipelines.cloudflare.com/incoming-webhooks
```

### Step 3: Create an R2 Bucket (if needed)

```bash
wrangler r2 bucket create webhook-storage
```

### Step 4: Add an R2 Sink

```bash
wrangler pipelines sinks create webhook-archive r2-sink \
  --type r2 \
  --bucket webhook-storage \
  --prefix "webhooks/" \
  --format ndjson
```

### Step 5: Configure Batching

```bash
wrangler pipelines update webhook-archive \
  --batch-max-seconds 60 \
  --batch-max-records 1000
```

### Step 6: Test with curl

```bash
# Send a test webhook
curl -X POST https://pipe-xyz789.pipelines.cloudflare.com/incoming-webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "event": "order.created",
    "order_id": "ORD-12345",
    "total": 99.99,
    "customer": "jane@example.com"
  }'
```

### Step 7: Verify Data in R2

After the batch interval (60 seconds), check your R2 bucket:

```bash
wrangler r2 object list webhook-storage --prefix "webhooks/"
```

You should see NDJSON files containing your webhook payloads.

---

## Example: Worker-to-R2 Event Logging

Use a Worker to collect events and stream them to R2 for analytics.

### Pipeline Setup

```bash
wrangler pipelines create event-log
wrangler pipelines streams create event-log worker-ingestion --type worker
wrangler pipelines sinks create event-log r2-events \
  --type r2 \
  --bucket analytics-data \
  --prefix "events/" \
  --format ndjson
```

### Worker Code

```jsonc
// wrangler.jsonc
{
  "name": "event-collector",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "pipelines": [
    {
      "binding": "EVENT_PIPELINE",
      "pipeline": "event-log"
    }
  ]
}
```

```typescript
// src/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/track" && request.method === "POST") {
      const event = await request.json();

      await env.EVENT_PIPELINE.send({
        event_type: event.type,
        properties: event.properties,
        timestamp: new Date().toISOString(),
        ip: request.headers.get("CF-Connecting-IP"),
        country: request.cf?.country,
        user_agent: request.headers.get("User-Agent"),
      });

      return new Response("OK", { status: 202 });
    }

    return new Response("Not Found", { status: 404 });
  },
};
```

### Verify

```bash
# Send test events
curl -X POST https://event-collector.example.com/track \
  -H "Content-Type: application/json" \
  -d '{"type": "click", "properties": {"button": "signup", "page": "/pricing"}}'

# Check pipeline status
wrangler pipelines get event-log

# List objects in R2 after batch flush
wrangler r2 object list analytics-data --prefix "events/"
```

---

## Tips

- **HTTP source authentication** -- HTTP pipeline endpoints are public by default. Use a shared secret in a custom header and validate it in a transform Worker, or place a Worker in front that verifies authentication before forwarding to the pipeline.
- **Batch tuning** -- Smaller batches (`--batch-max-seconds 10`) give lower latency but more R2 objects. Larger batches (`--batch-max-seconds 300`) reduce object count but increase delivery delay. Tune based on your analytics query patterns.
- **NDJSON format** -- For R2 sinks, NDJSON (newline-delimited JSON) is usually the best format. Each line is a self-contained JSON record, making files easy to process with standard tools.
- **R2 key structure** -- Use time-based prefixes (`events/2026/04/25/`) for efficient listing and lifecycle rules. Configure the `--prefix` flag thoughtfully.
- **Idempotency** -- Include unique IDs in your records so downstream consumers can deduplicate if a batch is retried.
- **Monitoring** -- Use `wrangler pipelines get <NAME>` to check pipeline health. Watch for error counts and delivery lag.
- **Cost** -- Pipelines pricing is based on data volume ingested. Filtering out unwanted records in a transform Worker reduces downstream costs.
- **Transform Worker limits** -- Transform Workers run with standard Worker CPU limits. Keep transformations lightweight. For heavy processing, send raw data to R2 and process it with a Workflow or Queue consumer.

---

## See Also

- [[Workflows]] -- Durable execution for multi-step data processing
- [[Containers]] -- Run heavyweight data processing in containers
- [[Networking]] -- Cron triggers to schedule periodic pipeline operations
