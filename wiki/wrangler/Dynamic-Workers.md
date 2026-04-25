# Dynamic Workers (Workers for Platforms)

Workers for Platforms lets you deploy **user-written Workers into dispatch namespaces** so a single "dispatcher" Worker can route requests to thousands of customer-uploaded scripts. This is the foundation for building SaaS platforms, plugin systems, and any multi-tenant architecture where each tenant runs custom code on Cloudflare's edge.

---

## Core Concepts

| Term | Meaning |
|---|---|
| **Dispatch Namespace** | A named container that holds many user Workers. Think of it as a bucket of scripts keyed by name. |
| **Dispatcher Worker** | Your own Worker that receives incoming requests, decides which user script to invoke, and calls `env.DISPATCH.get(scriptName)` to fetch and run it. |
| **User Worker** | A script uploaded to a dispatch namespace on behalf of a customer/tenant. Each user Worker runs in its own isolate with its own bindings. |

### How It Works

```
Internet --> Dispatcher Worker --> Dispatch Namespace --> User Worker A
                                                     --> User Worker B
                                                     --> User Worker C
```

1. A request arrives at your Dispatcher Worker (deployed normally via `wrangler deploy`).
2. The Dispatcher inspects the request (hostname, path, header, JWT, etc.) to determine which tenant the request belongs to.
3. It calls `env.DISPATCH_NS.get("tenant-script-name")` to obtain a reference to the user Worker.
4. It calls `userWorker.fetch(request)` to forward the request.
5. The user Worker processes the request and returns a response.

---

## CLI Commands: `wrangler dispatch-namespace`

### Create a Dispatch Namespace

```bash
wrangler dispatch-namespace create <NAME>
```

| Flag | Description |
|---|---|
| `--json` | Output result as JSON |

**Example:**

```bash
wrangler dispatch-namespace create customer-scripts
```

Output:

```
Created dispatch namespace "customer-scripts" (id: abc123)
```

### List All Dispatch Namespaces

```bash
wrangler dispatch-namespace list
```

| Flag | Description |
|---|---|
| `--json` | Output result as JSON |

**Example:**

```bash
wrangler dispatch-namespace list
```

Output:

```
Dispatch Namespaces:
  - customer-scripts (id: abc123, created: 2026-01-15)
  - plugin-sandbox   (id: def456, created: 2026-02-20)
```

### Get Dispatch Namespace Details

```bash
wrangler dispatch-namespace get <NAME>
```

**Example:**

```bash
wrangler dispatch-namespace get customer-scripts
```

### Delete a Dispatch Namespace

```bash
wrangler dispatch-namespace delete <NAME>
```

| Flag | Description |
|---|---|
| `--force` | Skip confirmation prompt |

**Example:**

```bash
wrangler dispatch-namespace delete old-namespace --force
```

### Rename a Dispatch Namespace

```bash
wrangler dispatch-namespace rename <OLD_NAME> <NEW_NAME>
```

**Example:**

```bash
wrangler dispatch-namespace rename customer-scripts tenant-workers
```

---

## Deploying User Scripts to a Namespace

Upload a user Worker script into a dispatch namespace using `wrangler deploy` with the `--dispatch-namespace` flag:

```bash
wrangler deploy --dispatch-namespace customer-scripts --name tenant-acme
```

This uploads the Worker defined in your current project's `wrangler.jsonc` into the `customer-scripts` namespace under the name `tenant-acme`.

You can also upload scripts programmatically via the Cloudflare API for fully automated tenant onboarding.

### Deploying with Custom Bindings for a User Script

User scripts can have their own bindings (KV, R2, D1, etc.) specified at upload time. When deploying via the API, you pass bindings in the metadata. Via CLI, the bindings in `wrangler.jsonc` are used.

---

## Binding in `wrangler.jsonc`

The **dispatcher Worker** needs a `dispatch_namespaces` binding to access user scripts at runtime.

```jsonc
// wrangler.jsonc — Dispatcher Worker config
{
  "name": "api-gateway",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "dispatch_namespaces": [
    {
      "binding": "DISPATCH_NS",
      "namespace": "customer-scripts"
    }
  ]
}
```

You can bind multiple namespaces:

```jsonc
{
  "dispatch_namespaces": [
    {
      "binding": "PLUGINS",
      "namespace": "plugin-sandbox"
    },
    {
      "binding": "TENANT_WORKERS",
      "namespace": "customer-scripts"
    }
  ]
}
```

### Outbound Workers

You can attach an **outbound Worker** to a dispatch namespace binding. The outbound Worker intercepts all `fetch()` calls made by user scripts, letting you enforce security policies, add logging, or rewrite URLs:

```jsonc
{
  "dispatch_namespaces": [
    {
      "binding": "DISPATCH_NS",
      "namespace": "customer-scripts",
      "outbound": {
        "service": "outbound-gateway",
        "parameters": ["customerId"]
      }
    }
  ]
}
```

---

## Dispatcher Worker Code Example

```typescript
// src/index.ts — Dispatcher Worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Extract tenant identifier from the hostname
    // e.g., acme.example.com -> "acme"
    const subdomain = url.hostname.split(".")[0];

    // Map the subdomain to a script name in the namespace
    const scriptName = `tenant-${subdomain}`;

    try {
      // Fetch the user Worker from the dispatch namespace
      const userWorker = env.DISPATCH_NS.get(scriptName);

      // Forward the request to the user Worker
      return await userWorker.fetch(request);
    } catch (e) {
      // Script not found or execution error
      if (e instanceof Error && e.message.includes("not found")) {
        return new Response(`Tenant "${subdomain}" not found`, {
          status: 404,
        });
      }
      return new Response("Internal error dispatching request", {
        status: 500,
      });
    }
  },
};

interface Env {
  DISPATCH_NS: DispatchNamespace;
}
```

### User Worker Example (uploaded to namespace)

```typescript
// tenant-acme/src/index.ts
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response("Hello from ACME Corp's custom Worker!", {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
```

---

## Full End-to-End Setup

### Step 1: Create the Dispatch Namespace

```bash
wrangler dispatch-namespace create customer-scripts
```

### Step 2: Configure and Deploy the Dispatcher Worker

```bash
# In your dispatcher project directory
wrangler deploy
```

Make sure `wrangler.jsonc` has the `dispatch_namespaces` binding as shown above.

### Step 3: Upload User Scripts

```bash
# In each tenant's project directory
cd tenant-acme/
wrangler deploy --dispatch-namespace customer-scripts --name tenant-acme

cd ../tenant-globex/
wrangler deploy --dispatch-namespace customer-scripts --name tenant-globex
```

### Step 4: Test

```bash
# Assuming your dispatcher is on api-gateway.example.com
# and routes by subdomain:
curl https://acme.api-gateway.example.com/
# => "Hello from ACME Corp's custom Worker!"

curl https://globex.api-gateway.example.com/
# => "Hello from Globex Corporation's custom Worker!"
```

---

## Use Cases

### SaaS Platforms
Let each customer write custom logic that runs on incoming webhooks, API requests, or data transformations. The dispatch namespace isolates each customer's code.

### Plugin / Extension Systems
Build an app marketplace where third-party developers upload plugins. Your dispatcher loads the right plugin based on the request context.

### Per-Customer Logic
E-commerce platforms where each storefront has custom pricing rules, redirect logic, or A/B testing scripts running at the edge.

### White-Label Services
Deploy slightly different Worker logic per client while sharing the same dispatcher infrastructure and domain routing.

---

## Tips

- **Script name conventions** -- Use a consistent naming scheme like `tenant-{id}` or `customer-{slug}` so the dispatcher can deterministically map requests to scripts.
- **Limits** -- Each dispatch namespace can hold thousands of scripts. Check the Workers for Platforms documentation for current limits on script count and size.
- **Error handling** -- Always wrap `env.DISPATCH_NS.get()` in a try/catch. If the script does not exist or fails to load, you want a graceful fallback.
- **Outbound control** -- Use outbound Workers to prevent user scripts from calling arbitrary external APIs. This is critical for security in multi-tenant environments.
- **Tail Workers** -- You can attach tail Workers to dispatch namespaces for centralized logging of all user Worker executions.
- **Tags** -- You can tag user Workers when uploading them, which is useful for bulk operations (e.g., delete all scripts tagged `deprecated`).

---

## See Also

- [[Networking]] -- VPC and service networking for Workers
- [[Workflows]] -- Durable execution engine for multi-step tasks
- [[Containers]] -- Running Docker containers on Cloudflare
