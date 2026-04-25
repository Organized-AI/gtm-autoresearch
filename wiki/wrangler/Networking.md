# Networking

This page covers Wrangler's networking capabilities: **VPC / Service Networking** for private connectivity between Workers and services, **Email Routing** for receiving email, **Email Sending** for outbound email, and **Triggers** for cron schedules and route mappings.

---

## VPC / Service Networking

VPC (Virtual Private Cloud) service networking lets you create private, authenticated connections between Workers and other Cloudflare services. This is useful for service-to-service communication that should not traverse the public internet.

### `wrangler vpc service create`

```bash
wrangler vpc service create <NAME>
```

Creates a new VPC service.

| Flag | Description |
|---|---|
| `--description <TEXT>` | Human-readable description |
| `--json` | Output as JSON |

**Example:**

```bash
wrangler vpc service create backend-api --description "Internal API for order processing"
```

Output:

```
Created VPC service "backend-api" (id: vpc-svc-abc123)
```

### `wrangler vpc service list`

```bash
wrangler vpc service list
```

| Flag | Description |
|---|---|
| `--json` | Output as JSON |

**Example:**

```bash
wrangler vpc service list
```

Output:

```
VPC Services:
  NAME          ID               STATUS   DESCRIPTION
  backend-api   vpc-svc-abc123   active   Internal API for order processing
  auth-service  vpc-svc-def456   active   Authentication microservice
  data-layer    vpc-svc-ghi789   active   Database access layer
```

### `wrangler vpc service get`

```bash
wrangler vpc service get <NAME>
```

**Example:**

```bash
wrangler vpc service get backend-api
```

### `wrangler vpc service update`

```bash
wrangler vpc service update <NAME>
```

| Flag | Description |
|---|---|
| `--description <TEXT>` | Update the description |
| `--json` | Output as JSON |

**Example:**

```bash
wrangler vpc service update backend-api --description "Internal API v2 for order and inventory"
```

### `wrangler vpc service delete`

```bash
wrangler vpc service delete <NAME>
```

| Flag | Description |
|---|---|
| `--force` | Skip confirmation prompt |

**Example:**

```bash
wrangler vpc service delete old-service --force
```

### VPC Service Binding in `wrangler.jsonc`

Connect Workers privately using service bindings:

```jsonc
{
  "name": "api-gateway",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "services": [
    {
      "binding": "BACKEND",
      "service": "backend-api"
    },
    {
      "binding": "AUTH",
      "service": "auth-service"
    }
  ]
}
```

### Using Service Bindings in Code

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Call another Worker privately (no public network hop)
    const authResponse = await env.AUTH.fetch(
      new Request("https://auth/verify", {
        headers: { Authorization: request.headers.get("Authorization") ?? "" },
      })
    );

    if (!authResponse.ok) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Forward to backend service
    return env.BACKEND.fetch(request);
  },
};
```

Service bindings provide:
- **No network latency** -- calls happen in-process on the same machine when possible.
- **No public exposure** -- the target Worker does not need a public route.
- **Automatic authentication** -- the binding is scoped to your account.

---

## Email Routing

Email Routing lets you receive email at your domain and process it with Workers, forward it to other addresses, or apply rules.

### `wrangler email routing list`

```bash
wrangler email routing list
```

Lists all email routing rules and settings for your domain.

| Flag | Description |
|---|---|
| `--zone <ZONE>` | Domain/zone to list rules for |
| `--json` | Output as JSON |

**Example:**

```bash
wrangler email routing list --zone example.com
```

### `wrangler email routing settings`

```bash
wrangler email routing settings
```

Shows current email routing configuration.

| Flag | Description |
|---|---|
| `--zone <ZONE>` | Target zone |

### `wrangler email routing enable`

```bash
wrangler email routing enable --zone <ZONE>
```

Enables email routing for a domain. This also configures the necessary MX and TXT DNS records.

**Example:**

```bash
wrangler email routing enable --zone example.com
```

Output:

```
Email routing enabled for example.com
DNS records configured:
  MX  example.com -> route1.mx.cloudflare.net (priority 45)
  MX  example.com -> route2.mx.cloudflare.net (priority 46)
  MX  example.com -> route3.mx.cloudflare.net (priority 47)
  TXT example.com -> "v=spf1 include:_spf.mx.cloudflare.net ~all"
```

### `wrangler email routing disable`

```bash
wrangler email routing disable --zone <ZONE>
```

Disables email routing for a domain.

### Email Routing DNS Records

When you enable email routing, Cloudflare automatically sets up:

| Record | Purpose |
|---|---|
| **MX** records | Route incoming mail to Cloudflare's email servers |
| **TXT** (SPF) record | Authorize Cloudflare to handle email for your domain |

You can verify these with:

```bash
dig MX example.com
dig TXT example.com
```

---

## Email Routing Rules

Rules determine what happens to incoming email based on the recipient address.

### `wrangler email routing rules list`

```bash
wrangler email routing rules list --zone <ZONE>
```

| Flag | Description |
|---|---|
| `--json` | Output as JSON |

**Example:**

```bash
wrangler email routing rules list --zone example.com
```

Output:

```
Email Routing Rules for example.com:
  MATCHER                   ACTION           DESTINATION
  support@example.com       forward          team@company.com
  sales@example.com         forward          sales-team@company.com
  info@example.com          worker           email-handler
  *@example.com             drop             (catch-all)
```

### `wrangler email routing rules get`

```bash
wrangler email routing rules get <RULE_ID> --zone <ZONE>
```

### `wrangler email routing rules create`

```bash
wrangler email routing rules create --zone <ZONE>
```

| Flag | Description |
|---|---|
| `--name <NAME>` | Rule name |
| `--match <ADDRESS>` | Email address pattern to match |
| `--action <ACTION>` | Action: `forward`, `worker`, `drop` |
| `--destination <DEST>` | Forward destination or Worker name |
| `--priority <N>` | Rule priority (lower = higher priority) |
| `--enabled` | Enable the rule (default: true) |

**Examples:**

Forward email to another address:

```bash
wrangler email routing rules create --zone example.com \
  --name "Support forwarding" \
  --match "support@example.com" \
  --action forward \
  --destination "team@company.com"
```

Route email to a Worker:

```bash
wrangler email routing rules create --zone example.com \
  --name "Process info emails" \
  --match "info@example.com" \
  --action worker \
  --destination "email-handler"
```

Catch-all rule (drop unmatched):

```bash
wrangler email routing rules create --zone example.com \
  --name "Catch-all drop" \
  --match "*@example.com" \
  --action drop \
  --priority 100
```

### `wrangler email routing rules update`

```bash
wrangler email routing rules update <RULE_ID> --zone <ZONE>
```

Supports the same flags as `create`.

**Example:**

```bash
wrangler email routing rules update rule-abc123 --zone example.com \
  --destination "new-team@company.com"
```

### `wrangler email routing rules delete`

```bash
wrangler email routing rules delete <RULE_ID> --zone <ZONE>
```

| Flag | Description |
|---|---|
| `--force` | Skip confirmation |

### Email Routing Destination Addresses

Before forwarding, the destination address must be verified:

```bash
# The verification is managed in the Cloudflare dashboard
# or via API. After adding a destination, the recipient
# receives a verification email they must click.
```

### Email Worker Example

Handle incoming email with a Worker:

```jsonc
// wrangler.jsonc
{
  "name": "email-handler",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01"
}
```

```typescript
// src/index.ts
export default {
  async email(message: EmailMessage, env: Env): Promise<void> {
    const { from, to, headers } = message;
    const subject = headers.get("subject") ?? "(no subject)";

    console.log(`Email received: from=${from}, to=${to}, subject=${subject}`);

    // Read the raw email body
    const rawEmail = await new Response(message.raw).text();

    // Store in KV for later processing
    await env.EMAIL_STORE.put(
      `email:${Date.now()}`,
      JSON.stringify({ from, to, subject, body: rawEmail }),
      { expirationTtl: 86400 * 30 } // 30 days
    );

    // Optionally forward to another address
    await message.forward("admin@company.com");
  },
};
```

---

## Email Sending

Email Sending allows Workers to send outbound email programmatically.

### `wrangler email sending list`

```bash
wrangler email sending list --zone <ZONE>
```

Lists configured sending domains/settings.

### `wrangler email sending settings`

```bash
wrangler email sending settings --zone <ZONE>
```

Shows current email sending configuration including DKIM keys and DNS records.

### `wrangler email sending enable`

```bash
wrangler email sending enable --zone <ZONE>
```

Enables email sending for a domain and configures required DNS records.

**Example:**

```bash
wrangler email sending enable --zone example.com
```

Output:

```
Email sending enabled for example.com
Required DNS records:
  TXT  _dmarc.example.com     -> "v=DMARC1; p=quarantine"
  TXT  cf._domainkey.example.com -> "v=DKIM1; k=rsa; p=MIGfMA0..."
  TXT  example.com             -> "v=spf1 include:_spf.mx.cloudflare.net ~all"
```

### `wrangler email sending disable`

```bash
wrangler email sending disable --zone <ZONE>
```

### `wrangler email sending send`

```bash
wrangler email sending send --zone <ZONE>
```

Send a structured email from the CLI.

| Flag | Description |
|---|---|
| `--from <ADDRESS>` | Sender address |
| `--to <ADDRESS>` | Recipient address (can specify multiple) |
| `--subject <TEXT>` | Email subject |
| `--body <TEXT>` | Plain text body |
| `--html <TEXT>` | HTML body |

**Example:**

```bash
wrangler email sending send --zone example.com \
  --from "noreply@example.com" \
  --to "user@gmail.com" \
  --subject "Welcome to our service" \
  --body "Thanks for signing up!"
```

### `wrangler email sending send-raw`

```bash
wrangler email sending send-raw --zone <ZONE> --raw <FILE>
```

Send a raw MIME email from a file.

**Example:**

```bash
wrangler email sending send-raw --zone example.com --raw email.eml
```

### Email Sending DNS Records

Email sending requires proper DNS authentication records:

| Record | Purpose |
|---|---|
| **SPF** (TXT) | Authorizes Cloudflare to send on behalf of your domain |
| **DKIM** (TXT) | Cryptographic signature for email authentication |
| **DMARC** (TXT) | Policy for handling authentication failures |

### Sending Email from a Worker

```jsonc
// wrangler.jsonc
{
  "name": "notification-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "send_email": {
    "binding": "EMAIL",
    "destination_address": "user@example.com"
  }
}
```

```typescript
// src/index.ts
import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const msg = createMimeMessage();
    msg.setSender({ name: "My App", addr: "noreply@example.com" });
    msg.setRecipient("user@gmail.com");
    msg.setSubject("Your order has shipped");
    msg.addMessage({
      contentType: "text/plain",
      data: "Your order #12345 has shipped and will arrive in 2-3 days.",
    });

    const message = new EmailMessage(
      "noreply@example.com",
      "user@gmail.com",
      msg.asRaw()
    );

    await env.EMAIL.send(message);

    return new Response("Email sent");
  },
};
```

---

## Triggers

Triggers control how and when your Worker is invoked. The two main types are **cron triggers** (scheduled execution) and **routes** (HTTP request matching).

### `wrangler triggers deploy`

```bash
wrangler triggers deploy
```

Deploys the triggers defined in your `wrangler.jsonc` configuration. This is typically done automatically as part of `wrangler deploy`, but can be run separately.

### Cron Triggers

Cron triggers invoke your Worker on a schedule, without any HTTP request.

#### Configuration in `wrangler.jsonc`

```jsonc
{
  "name": "scheduled-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "triggers": {
    "crons": [
      "0 * * * *",       // Every hour
      "*/15 * * * *",    // Every 15 minutes
      "0 0 * * *",       // Daily at midnight UTC
      "0 9 * * MON-FRI", // Weekdays at 9 AM UTC
      "0 0 1 * *"        // First day of every month
    ]
  }
}
```

#### Worker Code for Scheduled Events

```typescript
export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const triggerTime = new Date(controller.scheduledTime);
    const cron = controller.cron;

    console.log(`Cron "${cron}" fired at ${triggerTime.toISOString()}`);

    switch (cron) {
      case "0 * * * *":
        await hourlyTask(env);
        break;
      case "0 0 * * *":
        await dailyCleanup(env);
        break;
      default:
        console.log(`Unknown cron: ${cron}`);
    }
  },
};

async function hourlyTask(env: Env) {
  // Check for stale data, send reminders, etc.
  const staleKeys = await env.KV.list({ prefix: "temp:" });
  for (const key of staleKeys.keys) {
    await env.KV.delete(key.name);
  }
}

async function dailyCleanup(env: Env) {
  // Aggregate stats, generate reports, etc.
  const stats = await env.DB.prepare("SELECT COUNT(*) as total FROM events WHERE date = ?")
    .bind(new Date().toISOString().split("T")[0])
    .first();
  console.log(`Daily stats: ${JSON.stringify(stats)}`);
}
```

#### Testing Cron Triggers Locally

```bash
# Start dev server
wrangler dev

# In another terminal, trigger the cron handler
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

### Routes

Routes map HTTP requests to your Worker based on URL patterns.

#### Configuration in `wrangler.jsonc`

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "routes": [
    { "pattern": "example.com/api/*", "zone_name": "example.com" },
    { "pattern": "example.com/webhook", "zone_name": "example.com" },
    { "pattern": "*.example.com/assets/*", "zone_name": "example.com" }
  ]
}
```

Alternatively, use the simpler string format:

```jsonc
{
  "routes": [
    "example.com/api/*",
    "example.com/webhook"
  ]
}
```

#### Route with Custom Domain

```jsonc
{
  "routes": [
    {
      "pattern": "api.example.com/*",
      "zone_name": "example.com",
      "custom_domain": true
    }
  ]
}
```

#### Deploy Routes

```bash
# Deploy Worker and its routes
wrangler deploy

# Or deploy just the triggers/routes
wrangler triggers deploy
```

---

## Practical Examples

### Example 1: Private Microservice Architecture

Three Workers communicating privately via service bindings:

```bash
# Create the services
wrangler vpc service create user-service
wrangler vpc service create order-service
wrangler vpc service create notification-service
```

API Gateway (`wrangler.jsonc`):

```jsonc
{
  "name": "api-gateway",
  "main": "src/index.ts",
  "routes": ["api.example.com/*"],
  "services": [
    { "binding": "USERS", "service": "user-service" },
    { "binding": "ORDERS", "service": "order-service" },
    { "binding": "NOTIFICATIONS", "service": "notification-service" }
  ]
}
```

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/users")) {
      return env.USERS.fetch(request);
    }
    if (url.pathname.startsWith("/api/orders")) {
      return env.ORDERS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
```

### Example 2: Email-Powered Support System

Receive support emails, store them, and auto-respond:

```bash
# Enable email routing
wrangler email routing enable --zone example.com

# Create rule to route support emails to a Worker
wrangler email routing rules create --zone example.com \
  --name "Support inbox" \
  --match "support@example.com" \
  --action worker \
  --destination "support-handler"

# Forward billing emails to the finance team
wrangler email routing rules create --zone example.com \
  --name "Billing forwarding" \
  --match "billing@example.com" \
  --action forward \
  --destination "finance@company.com"

# Drop everything else
wrangler email routing rules create --zone example.com \
  --name "Catch-all" \
  --match "*@example.com" \
  --action drop \
  --priority 100
```

### Example 3: Scheduled Data Sync with Cron Triggers

```jsonc
// wrangler.jsonc
{
  "name": "data-sync",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "triggers": {
    "crons": [
      "*/30 * * * *",   // Sync inventory every 30 minutes
      "0 2 * * *"       // Full reconciliation at 2 AM UTC daily
    ]
  },
  "kv_namespaces": [
    { "binding": "CACHE", "id": "abc123" }
  ],
  "d1_databases": [
    { "binding": "DB", "database_id": "def456" }
  ]
}
```

```typescript
export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === "*/30 * * * *") {
      // Incremental sync
      const lastSync = await env.CACHE.get("last-sync-timestamp");
      const data = await fetch(
        `https://erp.example.com/api/inventory?since=${lastSync}`
      ).then((r) => r.json());

      for (const item of data.items) {
        await env.DB.prepare("INSERT OR REPLACE INTO inventory (sku, qty) VALUES (?, ?)")
          .bind(item.sku, item.quantity)
          .run();
      }

      await env.CACHE.put("last-sync-timestamp", new Date().toISOString());
    }

    if (controller.cron === "0 2 * * *") {
      // Full reconciliation
      const allItems = await fetch("https://erp.example.com/api/inventory/all")
        .then((r) => r.json());

      await env.DB.exec("DELETE FROM inventory");
      for (const item of allItems.items) {
        await env.DB.prepare("INSERT INTO inventory (sku, qty) VALUES (?, ?)")
          .bind(item.sku, item.quantity)
          .run();
      }
    }
  },
};
```

---

## Tips

- **Service bindings vs. fetch** -- Always prefer service bindings over `fetch()` for Worker-to-Worker communication. Service bindings are faster (no network hop), cheaper (no egress), and more secure (no public exposure).
- **Email routing catch-all** -- Always create a catch-all rule with low priority to handle unexpected recipient addresses. Otherwise, unmatched emails bounce with an error.
- **Cron syntax** -- Cloudflare uses standard 5-field cron syntax (minute, hour, day-of-month, month, day-of-week). All times are UTC. Use `crontab.guru` to verify your expressions.
- **Route specificity** -- More specific routes take priority. `example.com/api/v2/*` matches before `example.com/api/*`. Routes with `zone_name` are required when your Worker runs on a domain you manage.
- **Email size limits** -- Email routing has a maximum message size (typically 25 MB). Large attachments may be rejected.
- **SPF/DKIM/DMARC** -- When enabling email sending, always configure all three DNS records. Missing records cause emails to land in spam or get rejected.
- **Cron testing** -- Use `wrangler dev` with the `/__scheduled` endpoint to test cron handlers locally before deploying.
- **Multiple crons** -- A single Worker can have multiple cron triggers. Use `controller.cron` in the handler to differentiate which schedule fired.

---

## See Also

- [[Dynamic-Workers]] -- Multi-tenant Worker dispatch
- [[Workflows]] -- Durable execution for tasks triggered by crons or email
- [[Cloudflare-Tunnel]] -- Expose local services securely
- [[Pipelines]] -- Stream data from email or scheduled tasks to storage
