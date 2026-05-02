# Queues

Cloudflare Queues provide **guaranteed message delivery** between Workers or between external producers and Worker consumers. Queues decouple producers from consumers, buffer spikes, and enable reliable async processing.

**Key characteristics:**

- At-least-once delivery guarantee
- Automatic batching and retries with exponential backoff
- Dead-letter queues for failed messages
- Two consumer models: Worker (push) and HTTP (pull)
- Messages retained for up to 4 days
- Max message size: 128 KB
- Max batch size: 100 messages or 256 KB total

---

## Table of Contents

- [[#Queue Management]]
- [[#Delivery Control]]
- [[#Purge]]
- [[#Worker Consumers]]
- [[#HTTP Pull Consumers]]
- [[#Subscriptions]]
- [[#Binding in wrangler.jsonc]]
- [[#Producer Code]]
- [[#Consumer Code]]
- [[#End-to-End Example]]
- [[#Tips and Gotchas]]

See also: [[R2]] event notifications (which deliver to Queues), [[KV]] for caching processed results.

---

## Queue Management

### Create a Queue

```bash
wrangler queues create <QUEUE_NAME> [OPTIONS]
```

| Flag | Description |
|------|-------------|
| `--delivery-delay <SECONDS>` | Default delivery delay for all messages (0-43200) |

```bash
# Simple queue
wrangler queues create email-queue

# Queue with default 30-second delivery delay
wrangler queues create batch-processor --delivery-delay 30
```

### List Queues

```bash
wrangler queues list
```

### Get Queue Info

```bash
wrangler queues info <QUEUE_NAME>
```

Shows queue ID, created date, producers, consumers, and current message count.

### Update a Queue

```bash
wrangler queues update <QUEUE_NAME> [OPTIONS]
```

| Flag | Description |
|------|-------------|
| `--delivery-delay <SECONDS>` | Update default delivery delay |

```bash
wrangler queues update batch-processor --delivery-delay 60
```

### Delete a Queue

```bash
wrangler queues delete <QUEUE_NAME>
```

> **Warning:** Undelivered messages in the queue will be permanently lost.

---

## Delivery Control

### Pause Delivery

Stop delivering messages to consumers. Messages continue to accumulate in the queue.

```bash
wrangler queues pause-delivery <QUEUE_NAME>
```

```bash
# Pause during maintenance
wrangler queues pause-delivery email-queue
```

### Resume Delivery

Resume delivering messages to consumers.

```bash
wrangler queues resume-delivery <QUEUE_NAME>
```

```bash
wrangler queues resume-delivery email-queue
```

---

## Purge

Delete all messages currently in the queue.

```bash
wrangler queues purge <QUEUE_NAME>
```

```bash
# Clear all messages (irreversible)
wrangler queues purge email-queue
```

> **Warning:** This permanently deletes all pending messages. Use `pause-delivery` if you just want to temporarily stop processing.

---

## Worker Consumers

Worker consumers are push-based: Cloudflare invokes your Worker's `queue()` handler whenever messages are available.

### Add a Worker Consumer

```bash
wrangler queues consumer worker add <QUEUE_NAME> <WORKER_SCRIPT_NAME> [OPTIONS]
```

| Flag | Description |
|------|-------------|
| `--batch-size <N>` | Max messages per batch (1-100, default 10) |
| `--batch-timeout <SECONDS>` | Max seconds to wait for a full batch (0-30, default 5) |
| `--message-retries <N>` | Max retry attempts per message (0-100, default 3) |
| `--dead-letter-queue <NAME>` | Queue for messages that exceed max retries |
| `--retry-delay <SECONDS>` | Initial retry delay in seconds |

```bash
# Basic consumer
wrangler queues consumer worker add email-queue email-worker

# With tuned batch settings and dead-letter queue
wrangler queues consumer worker add order-queue order-processor \
  --batch-size 50 \
  --batch-timeout 10 \
  --message-retries 5 \
  --dead-letter-queue order-dlq \
  --retry-delay 30
```

### List Worker Consumers

```bash
wrangler queues consumer worker list <QUEUE_NAME>
```

### Remove a Worker Consumer

```bash
wrangler queues consumer worker remove <QUEUE_NAME> <WORKER_SCRIPT_NAME>
```

---

## HTTP Pull Consumers

HTTP pull consumers let you fetch messages on demand via HTTP, useful for external services or cron-triggered processing.

### Add an HTTP Pull Consumer

```bash
wrangler queues consumer http add <QUEUE_NAME> [OPTIONS]
```

| Flag | Description |
|------|-------------|
| `--batch-size <N>` | Max messages per pull (1-100, default 10) |
| `--message-retries <N>` | Max retry attempts per message |
| `--dead-letter-queue <NAME>` | Dead-letter queue |
| `--visibility-timeout <SECONDS>` | Seconds before unacknowledged messages become visible again |

```bash
wrangler queues consumer http add webhook-queue \
  --batch-size 20 \
  --visibility-timeout 300 \
  --dead-letter-queue webhook-dlq
```

### List HTTP Consumers

```bash
wrangler queues consumer http list <QUEUE_NAME>
```

### Remove an HTTP Consumer

```bash
wrangler queues consumer http remove <QUEUE_NAME> --consumer-id <ID>
```

---

## Subscriptions

Subscriptions provide a higher-level abstraction for connecting producers and consumers.

### Create a Subscription

```bash
wrangler queues subscription create <QUEUE_NAME> [OPTIONS]
```

### List Subscriptions

```bash
wrangler queues subscription list <QUEUE_NAME>
```

### Get a Subscription

```bash
wrangler queues subscription get <QUEUE_NAME> --subscription-id <ID>
```

### Update a Subscription

```bash
wrangler queues subscription update <QUEUE_NAME> --subscription-id <ID> [OPTIONS]
```

### Delete a Subscription

```bash
wrangler queues subscription delete <QUEUE_NAME> --subscription-id <ID>
```

---

## Binding in wrangler.jsonc

```jsonc
// wrangler.jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",

  // Producer binding — send messages to queues
  "queues": {
    "producers": [
      {
        "binding": "EMAIL_QUEUE",
        "queue": "email-queue",
        "delivery_delay": 0         // optional per-producer default delay
      },
      {
        "binding": "ORDER_QUEUE",
        "queue": "order-queue"
      }
    ],

    // Consumer binding — receive messages (only one consumer per Worker)
    "consumers": [
      {
        "queue": "email-queue",
        "max_batch_size": 10,
        "max_batch_timeout": 5,      // seconds
        "max_retries": 3,
        "dead_letter_queue": "email-dlq",
        "retry_delay": 30            // seconds, initial backoff
      }
    ]
  }
}
```

A Worker can be both a producer (sending to one or more queues) and a consumer (receiving from one queue) simultaneously.

---

## Producer Code

### Sending Messages

```typescript
interface Env {
  EMAIL_QUEUE: Queue;
  ORDER_QUEUE: Queue;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // --- Send a single message ---
    await env.EMAIL_QUEUE.send({
      to: "alice@example.com",
      subject: "Welcome!",
      body: "Thanks for signing up.",
    });

    // --- Send with content type ---
    // "json" (default), "text", "bytes", "v8"
    await env.EMAIL_QUEUE.send("plain text message", {
      contentType: "text",
    });

    // --- Send with delivery delay (seconds) ---
    // Message won't be delivered to consumers for 60 seconds
    await env.EMAIL_QUEUE.send(
      { type: "reminder", userId: 123 },
      { delaySeconds: 60 }
    );

    // --- Send a batch of messages ---
    await env.ORDER_QUEUE.sendBatch([
      {
        body: { orderId: 1, action: "process" },
      },
      {
        body: { orderId: 2, action: "process" },
        delaySeconds: 30,
      },
      {
        body: "raw bytes here",
        contentType: "text",
      },
    ]);

    return new Response("Messages sent");
  },
};
```

### Content Types

| Type | Description | Serialization |
|------|-------------|---------------|
| `json` (default) | JSON-serializable objects | `JSON.stringify` / `JSON.parse` |
| `text` | Plain text strings | As-is |
| `bytes` | Binary data (ArrayBuffer) | As-is |
| `v8` | V8-serialized (supports Map, Set, Date, RegExp, etc.) | Structured clone |

---

## Consumer Code

### Queue Handler

The consumer Worker exports a `queue()` function that receives batches of messages:

```typescript
interface Env {
  // Any bindings the consumer needs (KV, D1, R2, etc.)
  DB: D1Database;
}

interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export default {
  // The queue() handler is called by Cloudflare when messages are available
  async queue(batch: MessageBatch<EmailMessage>, env: Env): Promise<void> {
    // Process each message in the batch
    for (const message of batch.messages) {
      try {
        console.log(`Processing message ${message.id}`);
        console.log(`Timestamp: ${message.timestamp}`); // when it was sent
        console.log(`Attempts: ${message.attempts}`);     // retry count

        const { to, subject, body } = message.body;

        // Do your work here (send email, update DB, etc.)
        await sendEmail(to, subject, body);

        // Acknowledge successful processing
        message.ack();
      } catch (error) {
        console.error(`Failed to process message ${message.id}:`, error);

        // Retry the message (will be redelivered after retry delay)
        message.retry({
          delaySeconds: 60, // optional: override default retry delay
        });
      }
    }

    // Alternative: acknowledge or retry the entire batch at once
    // batch.ackAll();
    // batch.retryAll();
  },

  // Workers can have both fetch() and queue() handlers
  async fetch(request: Request, env: Env): Promise<Response> {
    return new Response("Consumer worker is running");
  },
};
```

### Message Properties

| Property | Type | Description |
|----------|------|-------------|
| `message.id` | `string` | Unique message ID |
| `message.timestamp` | `Date` | When the message was sent |
| `message.body` | `T` | Deserialized message body |
| `message.attempts` | `number` | Number of delivery attempts (starts at 1) |
| `message.ack()` | method | Acknowledge successful processing |
| `message.retry(options?)` | method | Request redelivery |

### Batch Properties

| Property | Type | Description |
|----------|------|-------------|
| `batch.queue` | `string` | Queue name |
| `batch.messages` | `Message<T>[]` | Array of messages |
| `batch.ackAll()` | method | Acknowledge all messages |
| `batch.retryAll(options?)` | method | Retry all messages |

---

## End-to-End Example

A system where an API Worker receives orders and sends them to a queue, and a consumer Worker processes them asynchronously.

### Step 1: Create the Queue and Dead-Letter Queue

```bash
wrangler queues create order-queue
wrangler queues create order-dlq
```

### Step 2: Producer Worker (`order-api`)

**wrangler.jsonc:**

```jsonc
{
  "name": "order-api",
  "main": "src/producer.ts",
  "queues": {
    "producers": [
      {
        "binding": "ORDER_QUEUE",
        "queue": "order-queue"
      }
    ]
  }
}
```

**src/producer.ts:**

```typescript
interface Env {
  ORDER_QUEUE: Queue;
}

interface OrderPayload {
  orderId: string;
  customerId: string;
  items: { sku: string; qty: number; price: number }[];
  total: number;
  createdAt: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST" || !request.url.endsWith("/orders")) {
      return new Response("POST /orders only", { status: 404 });
    }

    const body = await request.json() as Omit<OrderPayload, "orderId" | "createdAt">;
    const order: OrderPayload = {
      ...body,
      orderId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    // Send to queue for async processing
    await env.ORDER_QUEUE.send(order);

    return Response.json(
      { message: "Order received", orderId: order.orderId },
      { status: 202 } // Accepted -- processing is async
    );
  },
};
```

### Step 3: Consumer Worker (`order-processor`)

**wrangler.jsonc:**

```jsonc
{
  "name": "order-processor",
  "main": "src/consumer.ts",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "orders-db",
      "database_id": "xxx"
    }
  ],
  "queues": {
    "consumers": [
      {
        "queue": "order-queue",
        "max_batch_size": 25,
        "max_batch_timeout": 10,
        "max_retries": 5,
        "dead_letter_queue": "order-dlq",
        "retry_delay": 30
      }
    ]
  }
}
```

**src/consumer.ts:**

```typescript
interface Env {
  DB: D1Database;
}

interface OrderPayload {
  orderId: string;
  customerId: string;
  items: { sku: string; qty: number; price: number }[];
  total: number;
  createdAt: string;
}

export default {
  async queue(batch: MessageBatch<OrderPayload>, env: Env): Promise<void> {
    console.log(`Processing batch of ${batch.messages.length} orders`);

    for (const message of batch.messages) {
      const order = message.body;

      try {
        // Insert order into D1
        const statements = [
          env.DB.prepare(
            "INSERT INTO orders (id, customer_id, total, status, created_at) VALUES (?, ?, ?, ?, ?)"
          ).bind(order.orderId, order.customerId, order.total, "processing", order.createdAt),

          // Insert line items
          ...order.items.map((item) =>
            env.DB.prepare(
              "INSERT INTO order_items (order_id, sku, qty, price) VALUES (?, ?, ?, ?)"
            ).bind(order.orderId, item.sku, item.qty, item.price)
          ),
        ];

        await env.DB.batch(statements);

        console.log(`Order ${order.orderId} processed successfully`);
        message.ack();
      } catch (error) {
        console.error(`Failed to process order ${order.orderId}:`, error);

        if (message.attempts >= 5) {
          console.error(`Order ${order.orderId} exceeded max retries, sending to DLQ`);
          // Message will go to dead-letter queue after this final retry failure
        }

        message.retry({ delaySeconds: message.attempts * 30 }); // exponential-ish backoff
      }
    }
  },
};
```

### Step 4: Set Up Consumer via CLI

```bash
# Add the consumer relationship
wrangler queues consumer worker add order-queue order-processor \
  --batch-size 25 \
  --batch-timeout 10 \
  --message-retries 5 \
  --dead-letter-queue order-dlq \
  --retry-delay 30

# Deploy both workers
wrangler deploy --config order-api/wrangler.jsonc
wrangler deploy --config order-processor/wrangler.jsonc
```

### Step 5: Test

```bash
# Send an order
curl -X POST https://order-api.yourname.workers.dev/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_123",
    "items": [
      {"sku": "WIDGET-A", "qty": 2, "price": 19.99},
      {"sku": "GADGET-B", "qty": 1, "price": 49.99}
    ],
    "total": 89.97
  }'

# Check queue status
wrangler queues info order-queue
```

---

## Tips and Gotchas

1. **At-least-once delivery.** Messages may be delivered more than once (e.g., if the consumer crashes after processing but before acknowledging). Design consumers to be idempotent.

2. **Batch processing is efficient.** Configure `max_batch_size` and `max_batch_timeout` to balance throughput and latency. Larger batches are more efficient but introduce latency.

3. **Always set a dead-letter queue.** Without one, messages that repeatedly fail are silently dropped after max retries.

4. **Message ordering is not guaranteed.** If order matters, include a sequence number in the message body and handle reordering in the consumer.

5. **Max message size is 128 KB.** For larger payloads, store the data in [[R2]] or [[KV]] and send a reference (key/URL) in the queue message.

6. **Delivery delay** is useful for scheduling (e.g., "send a reminder in 1 hour"), rate limiting, and retry backoff. Max delay is 12 hours (43,200 seconds).

7. **`ack()` vs `retry()`**: If you don't call either, the message is implicitly retried when the Worker execution completes. Call `ack()` explicitly for clarity.

8. **Consumer CPU time limits apply.** Each batch invocation has the same CPU limits as a regular Worker request. Keep processing lightweight or fan out to sub-tasks.

9. **Pause delivery** during deployments or maintenance windows to prevent message loss from failing consumers.

10. **Monitor the DLQ.** Create a separate consumer or periodic script that reads from the dead-letter queue, logs failures, and alerts your team.
