# KV (Workers KV)

Workers KV is Cloudflare's global, low-latency key-value store. It is optimized for **read-heavy workloads** where data is written infrequently but read from hundreds of locations worldwide. KV is eventually consistent -- writes propagate globally within ~60 seconds.

**Key characteristics:**

- Keys up to 512 bytes, values up to 25 MiB
- Eventually consistent (reads may return stale data briefly after writes)
- Free tier: 100k reads/day, 1k writes/day, 1 GB stored
- Ideal for: config flags, cached API responses, session tokens, i18n strings, redirects

---

## Table of Contents

- [[#Namespace Management]]
- [[#Key Operations]]
- [[#Bulk Operations]]
- [[#Binding in wrangler.jsonc]]
- [[#Worker Code Usage]]
- [[#Practical Examples]]
- [[#Tips and Gotchas]]

See also: [[R2]] for large object storage, [[D1]] for relational data.

---

## Namespace Management

A **namespace** is an isolated KV store. You typically create one per logical data set (e.g., `SESSIONS`, `CONFIG`, `CACHE`).

### Create a Namespace

```bash
wrangler kv namespace create <NAME> [OPTIONS]
```

| Flag | Description |
|------|-------------|
| `--preview` | Create a preview namespace (used in `wrangler dev`) |

```bash
# Production namespace
wrangler kv namespace create MY_CACHE

# Preview namespace (for local dev)
wrangler kv namespace create MY_CACHE --preview
```

Output:

```
 Successfully created KV namespace "MY_CACHE"
  id = "a1b2c3d4e5f6..."

Add the following to your wrangler.jsonc:
  [[kv_namespaces]]
  binding = "MY_CACHE"
  id = "a1b2c3d4e5f6..."
```

### List Namespaces

```bash
wrangler kv namespace list
```

Returns JSON array of all namespaces in the account.

```bash
# Pretty-print the list
wrangler kv namespace list | jq '.[].title'
```

### Rename a Namespace

```bash
wrangler kv namespace rename <OLD_NAME> <NEW_NAME>
```

> **Note:** Renaming changes the title only. The namespace ID stays the same, so bindings are unaffected.

### Delete a Namespace

```bash
wrangler kv namespace delete --namespace-id <ID>
```

```bash
# Delete by ID
wrangler kv namespace delete --namespace-id a1b2c3d4e5f6
```

> **Warning:** This is irreversible. All keys in the namespace are permanently deleted.

---

## Key Operations

### Put a Key

```bash
wrangler kv key put <KEY> [VALUE] [OPTIONS]
```

| Flag | Description |
|------|-------------|
| `--namespace-id <ID>` | Target namespace ID |
| `--binding <NAME>` | Use binding name from wrangler.jsonc instead of ID |
| `--preview` | Write to preview namespace |
| `--expiration <UNIX_TS>` | Absolute expiration as Unix timestamp (seconds) |
| `--expiration-ttl <SECONDS>` | Expiration as seconds from now (min 60) |
| `--metadata <JSON>` | Attach JSON metadata to the key |
| `--path <FILE>` | Read value from a file instead of argument |
| `--local` | Write to local dev storage |

```bash
# Simple string value
wrangler kv key put --binding MY_CACHE "user:1234" '{"name":"Alice","role":"admin"}'

# With TTL (expires in 1 hour)
wrangler kv key put --binding MY_CACHE "session:abc" "token_xyz" \
  --expiration-ttl 3600

# With absolute expiration
wrangler kv key put --binding MY_CACHE "promo:summer" "20% off" \
  --expiration 1735689600

# With metadata
wrangler kv key put --binding MY_CACHE "asset:logo" --path ./logo.png \
  --metadata '{"content-type":"image/png","version":3}'

# Using namespace ID directly
wrangler kv key put --namespace-id a1b2c3d4e5f6 "hello" "world"
```

### Get a Key

```bash
wrangler kv key get <KEY> [OPTIONS]
```

| Flag | Description |
|------|-------------|
| `--namespace-id <ID>` | Target namespace ID |
| `--binding <NAME>` | Use binding name from wrangler.jsonc |
| `--preview` | Read from preview namespace |
| `--local` | Read from local dev storage |

```bash
wrangler kv key get --binding MY_CACHE "user:1234"
# Output: {"name":"Alice","role":"admin"}
```

### List Keys

```bash
wrangler kv key list [OPTIONS]
```

| Flag | Description |
|------|-------------|
| `--namespace-id <ID>` | Target namespace ID |
| `--binding <NAME>` | Use binding name from wrangler.jsonc |
| `--prefix <PREFIX>` | Filter keys by prefix |
| `--limit <N>` | Max keys to return (default 1000) |
| `--cursor <CURSOR>` | Pagination cursor from previous response |
| `--local` | List from local dev storage |

```bash
# List all keys
wrangler kv key list --binding MY_CACHE

# List keys with prefix
wrangler kv key list --binding MY_CACHE --prefix "user:"

# Paginate
wrangler kv key list --binding MY_CACHE --limit 100
```

### Delete a Key

```bash
wrangler kv key delete <KEY> [OPTIONS]
```

```bash
wrangler kv key delete --binding MY_CACHE "user:1234"
```

---

## Bulk Operations

Bulk operations accept or produce JSON arrays, making them efficient for batch work.

### Bulk Put

```bash
wrangler kv bulk put <FILENAME> [OPTIONS]
```

The file must be a JSON array of objects with `key`, `value`, and optionally `expiration`, `expiration_ttl`, `metadata`, and `base64` fields.

```json
// data.json
[
  {
    "key": "user:1",
    "value": "{\"name\":\"Alice\"}",
    "expiration_ttl": 86400
  },
  {
    "key": "user:2",
    "value": "{\"name\":\"Bob\"}",
    "metadata": {"created": "2026-01-01"}
  },
  {
    "key": "binary:1",
    "value": "iVBORw0KGgo=",
    "base64": true
  }
]
```

```bash
wrangler kv bulk put data.json --binding MY_CACHE
```

### Bulk Get

```bash
wrangler kv bulk get <FILENAME> [OPTIONS]
```

The file contains a JSON array of keys:

```json
// keys.json
["user:1", "user:2", "user:3"]
```

```bash
wrangler kv bulk get keys.json --binding MY_CACHE
```

### Bulk Delete

```bash
wrangler kv bulk delete <FILENAME> [OPTIONS]
```

Same format as bulk get -- a JSON array of key strings.

```bash
wrangler kv bulk delete keys.json --binding MY_CACHE
```

---

## Binding in wrangler.jsonc

Add KV bindings in your `wrangler.jsonc` (or `wrangler.toml`):

```jsonc
// wrangler.jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "kv_namespaces": [
    {
      "binding": "MY_CACHE",
      "id": "a1b2c3d4e5f6...",
      "preview_id": "f6e5d4c3b2a1..."  // optional, for wrangler dev
    },
    {
      "binding": "SESSIONS",
      "id": "x9y8z7w6v5u4..."
    }
  ]
}
```

The `binding` value becomes the property name on the `env` object in your Worker.

---

## Worker Code Usage

### Basic CRUD

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // --- GET (read) ---
    const value = await env.MY_CACHE.get("user:1234");
    // Returns string | null

    // Get as JSON (auto-parsed)
    const user = await env.MY_CACHE.get("user:1234", { type: "json" });
    // Returns parsed object | null

    // Get as ArrayBuffer (binary data)
    const image = await env.MY_CACHE.get("asset:logo", { type: "arrayBuffer" });

    // Get as ReadableStream
    const stream = await env.MY_CACHE.get("large:file", { type: "stream" });

    // Get with metadata
    const { value: val, metadata } = await env.MY_CACHE.getWithMetadata("user:1234", {
      type: "json",
    });

    // --- PUT (write) ---
    await env.MY_CACHE.put("user:1234", JSON.stringify({ name: "Alice" }));

    // With expiration (absolute Unix timestamp in seconds)
    await env.MY_CACHE.put("session:abc", "token", {
      expiration: Math.floor(Date.now() / 1000) + 3600,
    });

    // With TTL (seconds from now, minimum 60)
    await env.MY_CACHE.put("session:abc", "token", {
      expirationTtl: 3600,
    });

    // With metadata
    await env.MY_CACHE.put("user:1234", JSON.stringify({ name: "Alice" }), {
      metadata: { role: "admin", updatedAt: Date.now() },
    });

    // --- DELETE ---
    await env.MY_CACHE.delete("user:1234");

    // --- LIST ---
    const keys = await env.MY_CACHE.list();
    // keys.keys = [{name: "user:1", ...}, ...]
    // keys.list_complete = true/false
    // keys.cursor = "..." (for pagination)

    // List with prefix and limit
    const sessionKeys = await env.MY_CACHE.list({
      prefix: "session:",
      limit: 50,
    });

    // Paginate through all keys
    let cursor: string | undefined;
    let allKeys: string[] = [];
    do {
      const result = await env.MY_CACHE.list({ cursor });
      allKeys.push(...result.keys.map((k) => k.name));
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return new Response("OK");
  },
};
```

### TypeScript Env Interface

```typescript
interface Env {
  MY_CACHE: KVNamespace;
  SESSIONS: KVNamespace;
}
```

---

## Practical Examples

### 1. API Response Cache

Cache expensive API responses with automatic expiration:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cacheKey = `api-cache:${url.pathname}`;

    // Check cache first
    const cached = await env.MY_CACHE.get(cacheKey, { type: "json" });
    if (cached) {
      return Response.json(cached, {
        headers: { "X-Cache": "HIT" },
      });
    }

    // Fetch from origin
    const response = await fetch(`https://api.example.com${url.pathname}`);
    const data = await response.json();

    // Cache for 5 minutes
    await env.MY_CACHE.put(cacheKey, JSON.stringify(data), {
      expirationTtl: 300,
    });

    return Response.json(data, {
      headers: { "X-Cache": "MISS" },
    });
  },
};
```

### 2. Session Storage

```typescript
import { v4 as uuidv4 } from "uuid";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cookie = request.headers.get("Cookie") || "";
    const sessionId = cookie.match(/session=([^;]+)/)?.[1];

    if (request.url.endsWith("/login")) {
      const newSessionId = uuidv4();
      const sessionData = {
        userId: "user_123",
        loginAt: Date.now(),
        ip: request.headers.get("CF-Connecting-IP"),
      };

      // Store session, expire in 24 hours
      await env.SESSIONS.put(
        `session:${newSessionId}`,
        JSON.stringify(sessionData),
        { expirationTtl: 86400 }
      );

      return new Response("Logged in", {
        headers: {
          "Set-Cookie": `session=${newSessionId}; HttpOnly; Secure; SameSite=Strict`,
        },
      });
    }

    if (!sessionId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const session = await env.SESSIONS.get(`session:${sessionId}`, {
      type: "json",
    });
    if (!session) {
      return new Response("Session expired", { status: 401 });
    }

    return Response.json({ session });
  },
};
```

### 3. Feature Flags / Config Storage

```bash
# Seed feature flags via CLI
wrangler kv key put --binding CONFIG "features:dark-mode" '{"enabled":true,"rollout":0.5}' \
  --metadata '{"updatedBy":"alice","updatedAt":"2026-04-25"}'

wrangler kv key put --binding CONFIG "features:new-checkout" '{"enabled":false}'

wrangler kv key put --binding CONFIG "rate-limits:api" '{"rpm":1000,"burst":50}'
```

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const feature = await env.CONFIG.get("features:dark-mode", { type: "json" });

    if (feature?.enabled) {
      const userId = request.headers.get("X-User-ID") || "";
      // Simple percentage rollout based on user ID hash
      const hash = [...userId].reduce((a, c) => a + c.charCodeAt(0), 0);
      const inRollout = (hash % 100) / 100 < feature.rollout;

      if (inRollout) {
        return new Response("Dark mode enabled", {
          headers: { "X-Feature-Dark-Mode": "true" },
        });
      }
    }

    return new Response("Standard mode");
  },
};
```

### 4. URL Shortener

```bash
# Seed redirects in bulk
cat <<'EOF' > redirects.json
[
  {"key": "gh", "value": "https://github.com/cloudflare"},
  {"key": "docs", "value": "https://developers.cloudflare.com"},
  {"key": "dash", "value": "https://dash.cloudflare.com"}
]
EOF

wrangler kv bulk put redirects.json --binding REDIRECTS
```

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const slug = new URL(request.url).pathname.slice(1); // remove leading /

    if (!slug) {
      return new Response("URL Shortener. Use /<slug>", { status: 200 });
    }

    const destination = await env.REDIRECTS.get(slug);
    if (!destination) {
      return new Response("Not found", { status: 404 });
    }

    return Response.redirect(destination, 302);
  },
};
```

---

## Tips and Gotchas

1. **Eventually consistent.** A write in one region may take up to 60 seconds to appear in all others. Do not use KV for data that requires strong consistency -- use [[D1]] or Durable Objects instead.

2. **Minimum TTL is 60 seconds.** Setting `expirationTtl` below 60 will throw an error.

3. **Value size limit is 25 MiB.** For larger objects, use [[R2]].

4. **Key size limit is 512 bytes.** Keep keys concise; use prefixes like `user:` or `session:` for logical grouping.

5. **`list()` is expensive.** It scans sequentially. For frequent lookups, store an index key or use [[D1]].

6. **Metadata is limited to ~1 KiB.** Use it for small annotations (content-type, version, timestamps), not large payloads.

7. **Preview vs production namespaces.** Always create a `--preview` namespace for local development with `wrangler dev`. If you don't set a `preview_id`, `wrangler dev` will use the production namespace, which can corrupt live data.

8. **Billing.** Reads are cheap (~$0.50/million). Writes are ~$5.00/million. Design for read-heavy patterns.

9. **`get()` returns `null` for missing keys**, not an error. Always check for `null`.

10. **Atomic operations are not supported.** KV has no compare-and-swap or increment. For atomic counters or transactions, use Durable Objects.
