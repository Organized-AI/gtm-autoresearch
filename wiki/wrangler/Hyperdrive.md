# Hyperdrive

Hyperdrive accelerates access to existing PostgreSQL and MySQL databases from Cloudflare Workers. It provides **connection pooling** (eliminating cold-start connection overhead) and **automatic query caching** at the edge, making database queries from Workers dramatically faster.

**Key characteristics:**

- Maintains persistent connection pools to your origin database
- Caches read queries at the edge automatically
- Works with any PostgreSQL or MySQL database (Supabase, Neon, PlanetScale, AWS RDS, etc.)
- Zero code changes -- uses standard connection strings
- Compatible with popular ORMs and drivers (Drizzle, Prisma, node-postgres, mysql2)

---

## Table of Contents

- [[#How Hyperdrive Works]]
- [[#Create a Hyperdrive Config]]
- [[#Manage Hyperdrive Configs]]
- [[#Binding in wrangler.jsonc]]
- [[#Worker Code Usage]]
- [[#Caching Behavior]]
- [[#Supported Databases]]
- [[#End-to-End Example]]
- [[#Tips and Gotchas]]

See also: [[D1]] for a fully managed serverless SQLite database.

---

## How Hyperdrive Works

Without Hyperdrive, every Worker invocation that queries a database must:

1. Establish a new TCP connection (TLS handshake, authentication)
2. Send the query over the open internet to the database
3. Wait for the response

This can add 50-200 ms of latency per request, especially for databases far from the edge.

Hyperdrive solves this by:

1. **Connection pooling.** Hyperdrive maintains warm, persistent connections to your database from Cloudflare's network. Workers connect to Hyperdrive locally (near-zero latency), and Hyperdrive reuses an existing connection to your database.

2. **Query caching.** Read queries (`SELECT`) are cached at the edge. Repeated identical queries are served from cache without hitting the database.

3. **Smart routing.** Queries are routed through Cloudflare's backbone to the closest Hyperdrive node that has a connection to your database, minimizing round trips.

---

## Create a Hyperdrive Config

```bash
wrangler hyperdrive create <NAME> --connection-string <CONNECTION_STRING> [OPTIONS]
```

| Flag | Description |
|------|-------------|
| `--connection-string <URL>` | Database connection string (required) |
| `--caching-disabled` | Disable query caching |
| `--max-age <SECONDS>` | Maximum cache age for queries (default: 60) |
| `--swr <SECONDS>` | Stale-while-revalidate window (default: 15) |

### Connection String Format

**PostgreSQL:**
```
postgresql://user:password@hostname:port/database
```

**MySQL:**
```
mysql://user:password@hostname:port/database
```

### Examples

```bash
# PostgreSQL (Supabase)
wrangler hyperdrive create my-supabase-db \
  --connection-string "postgresql://postgres.xxxx:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

# PostgreSQL (Neon)
wrangler hyperdrive create my-neon-db \
  --connection-string "postgresql://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/mydb?sslmode=require"

# MySQL (PlanetScale)
wrangler hyperdrive create my-planetscale-db \
  --connection-string "mysql://user:pass@aws.connect.psdb.cloud/mydb?ssl={\"rejectUnauthorized\":true}"

# PostgreSQL (AWS RDS)
wrangler hyperdrive create my-rds-db \
  --connection-string "postgresql://admin:secret@mydb.cluster-abc123.us-east-1.rds.amazonaws.com:5432/mydb"

# With custom caching settings
wrangler hyperdrive create my-db \
  --connection-string "postgresql://user:pass@host:5432/db" \
  --max-age 120 \
  --swr 30

# Disable caching entirely (for write-heavy workloads)
wrangler hyperdrive create my-db \
  --connection-string "postgresql://user:pass@host:5432/db" \
  --caching-disabled
```

Output:

```
 Created Hyperdrive config "my-supabase-db"
  id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

Add the following to your wrangler.jsonc:
  [[hyperdrive]]
  binding = "HYPERDRIVE"
  id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

---

## Manage Hyperdrive Configs

### List All Configs

```bash
wrangler hyperdrive list
```

### Get Config Details

```bash
wrangler hyperdrive get <NAME_OR_ID>
```

```bash
wrangler hyperdrive get my-supabase-db
```

Shows the config ID, origin database host/port, caching settings, and connection status.

### Update a Config

```bash
wrangler hyperdrive update <NAME_OR_ID> [OPTIONS]
```

| Flag | Description |
|------|-------------|
| `--connection-string <URL>` | Update the connection string |
| `--caching-disabled` | Disable caching |
| `--max-age <SECONDS>` | Update cache max age |
| `--swr <SECONDS>` | Update stale-while-revalidate window |
| `--name <NEW_NAME>` | Rename the config |

```bash
# Update connection string (e.g., after password rotation)
wrangler hyperdrive update my-supabase-db \
  --connection-string "postgresql://postgres:NEW_PASSWORD@host:5432/db"

# Adjust caching
wrangler hyperdrive update my-supabase-db --max-age 300 --swr 60

# Disable caching
wrangler hyperdrive update my-supabase-db --caching-disabled
```

### Delete a Config

```bash
wrangler hyperdrive delete <NAME_OR_ID>
```

```bash
wrangler hyperdrive delete my-supabase-db
```

---

## Binding in wrangler.jsonc

```jsonc
// wrangler.jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ]
}
```

Multiple Hyperdrive bindings (e.g., read replica + primary) are supported:

```jsonc
{
  "hyperdrive": [
    {
      "binding": "DB_PRIMARY",
      "id": "primary-config-id"
    },
    {
      "binding": "DB_REPLICA",
      "id": "replica-config-id"
    }
  ]
}
```

---

## Worker Code Usage

Hyperdrive exposes a `connectionString` property on the binding. You pass this to your database driver instead of the original connection string.

### With `postgres` (node-postgres / pg)

```typescript
import { Client } from "pg";

interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Hyperdrive provides a local connection string that routes through its pool
    const client = new Client({
      connectionString: env.HYPERDRIVE.connectionString,
    });

    await client.connect();

    try {
      const result = await client.query(
        "SELECT id, name, email FROM users WHERE active = $1 LIMIT $2",
        [true, 10]
      );

      return Response.json(result.rows);
    } finally {
      // Important: close the client to return the connection to the pool
      await client.end();
    }
  },
};
```

### With Drizzle ORM

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sql = postgres(env.HYPERDRIVE.connectionString);
    const db = drizzle(sql, { schema });

    const users = await db.query.users.findMany({
      where: (users, { eq }) => eq(users.active, true),
      limit: 10,
    });

    return Response.json(users);
  },
};
```

### With Prisma

```typescript
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";

interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const client = new Client({
      connectionString: env.HYPERDRIVE.connectionString,
    });
    await client.connect();

    const adapter = new PrismaPg(client);
    const prisma = new PrismaClient({ adapter });

    const users = await prisma.user.findMany({
      where: { active: true },
      take: 10,
    });

    await client.end();
    return Response.json(users);
  },
};
```

### Accessing Connection Components

```typescript
// If you need individual connection parameters instead of the full string
const host = env.HYPERDRIVE.host;         // Hyperdrive's local host
const port = env.HYPERDRIVE.port;         // Hyperdrive's local port
const user = env.HYPERDRIVE.user;         // Original database user
const password = env.HYPERDRIVE.password; // Original database password
const database = env.HYPERDRIVE.database; // Original database name
```

---

## Caching Behavior

Hyperdrive automatically caches **read queries** (`SELECT` statements) at the edge.

### Cache Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `max-age` | 60s | How long cached results are considered fresh |
| `swr` | 15s | Stale-while-revalidate: serve stale cache while refreshing in background |
| `caching-disabled` | false | Completely disable caching |

### How Caching Works

1. A `SELECT` query arrives at Hyperdrive.
2. If an identical query + parameters are cached and fresh (< `max-age`), the cached result is returned instantly.
3. If the cache is stale but within `max-age + swr`, the stale result is returned immediately while Hyperdrive refreshes the cache in the background.
4. If no cache exists or the entry is expired, the query goes to the origin database.

### What Is NOT Cached

- `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP` statements
- Queries inside explicit transactions (`BEGIN ... COMMIT`)
- Queries with non-deterministic functions like `NOW()`, `RANDOM()`, `CURRENT_TIMESTAMP`

### Tuning Cache for Your Workload

```bash
# Read-heavy, data changes rarely (e.g., product catalog)
wrangler hyperdrive update my-db --max-age 300 --swr 60

# Data changes frequently (e.g., real-time dashboard)
wrangler hyperdrive update my-db --max-age 5 --swr 5

# Write-heavy, cache hurts more than helps
wrangler hyperdrive update my-db --caching-disabled
```

---

## Supported Databases

| Database | Protocol | Tested Providers |
|----------|----------|------------------|
| PostgreSQL | `postgresql://` | Supabase, Neon, AWS RDS/Aurora, Google Cloud SQL, Azure Database, Crunchy Bridge, Timescale, CockroachDB (PostgreSQL-compatible mode) |
| MySQL | `mysql://` | PlanetScale, AWS RDS/Aurora MySQL, Google Cloud SQL, Azure Database for MySQL, TiDB |

> **Note:** The database must be accessible from the public internet (or via Cloudflare Tunnel). Hyperdrive cannot connect to databases behind a VPN or private network without a Tunnel.

---

## End-to-End Example

Connecting a Worker to a Supabase PostgreSQL database via Hyperdrive.

### Step 1: Get Your Supabase Connection String

From the Supabase dashboard, go to **Settings > Database > Connection string > URI**. Use the **Session mode** (port 5432) or **Transaction mode** (port 6543) pooler URL:

```
postgresql://postgres.xxxx:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

### Step 2: Create the Hyperdrive Config

```bash
wrangler hyperdrive create supabase-prod \
  --connection-string "postgresql://postgres.xxxx:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
```

### Step 3: Configure wrangler.jsonc

```jsonc
{
  "name": "my-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-25",
  "hyperdrive": [
    {
      "binding": "DB",
      "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ]
}
```

### Step 4: Install Dependencies

```bash
npm install pg
npm install --save-dev @types/pg
```

### Step 5: Write the Worker

```typescript
// src/index.ts
import { Client } from "pg";

interface Env {
  DB: Hyperdrive;
}

type Product = {
  id: number;
  name: string;
  price: number;
  category: string;
  in_stock: boolean;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const client = new Client({ connectionString: env.DB.connectionString });

    try {
      await client.connect();

      // GET /products?category=electronics
      if (request.method === "GET" && url.pathname === "/products") {
        const category = url.searchParams.get("category");

        let query = "SELECT id, name, price, category, in_stock FROM products";
        let params: any[] = [];

        if (category) {
          query += " WHERE category = $1";
          params.push(category);
        }

        query += " ORDER BY name LIMIT 50";
        const result = await client.query<Product>(query, params);

        return Response.json(result.rows, {
          headers: {
            // Hyperdrive caches the DB query; this caches the HTTP response
            "Cache-Control": "public, max-age=60",
          },
        });
      }

      // GET /products/:id
      if (request.method === "GET" && url.pathname.startsWith("/products/")) {
        const id = parseInt(url.pathname.split("/")[2]);
        const result = await client.query<Product>(
          "SELECT * FROM products WHERE id = $1",
          [id]
        );

        if (result.rows.length === 0) {
          return new Response("Not found", { status: 404 });
        }

        return Response.json(result.rows[0]);
      }

      // POST /products
      if (request.method === "POST" && url.pathname === "/products") {
        const body = await request.json() as Omit<Product, "id">;
        const result = await client.query(
          "INSERT INTO products (name, price, category, in_stock) VALUES ($1, $2, $3, $4) RETURNING id",
          [body.name, body.price, body.category, body.in_stock ?? true]
        );

        return Response.json(
          { id: result.rows[0].id, ...body },
          { status: 201 }
        );
      }

      return new Response("Not found", { status: 404 });
    } finally {
      await client.end();
    }
  },
};
```

### Step 6: Test Locally and Deploy

```bash
# Local development (uses a local proxy to Hyperdrive)
wrangler dev

# Deploy to production
wrangler deploy
```

### Step 7: Verify It Works

```bash
# Fetch products (first request hits DB, subsequent requests may hit cache)
curl https://my-api.yourname.workers.dev/products

# With category filter
curl https://my-api.yourname.workers.dev/products?category=electronics

# Create a product
curl -X POST https://my-api.yourname.workers.dev/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Widget","price":9.99,"category":"gadgets"}'
```

---

## Tips and Gotchas

1. **Connection pooling is the main benefit.** Even with caching disabled, Hyperdrive dramatically reduces latency by eliminating per-request TCP/TLS handshakes.

2. **Always close the client.** Call `client.end()` (or use `try/finally`) to return the connection to Hyperdrive's pool. Forgetting this will leak connections.

3. **Database must be publicly accessible.** Hyperdrive connects from Cloudflare's network. If your database is behind a firewall, allow Cloudflare's IP ranges or use Cloudflare Tunnel.

4. **Password rotation.** After rotating your database password, update the Hyperdrive config immediately:
   ```bash
   wrangler hyperdrive update my-db --connection-string "postgresql://user:NEW_PASS@host:5432/db"
   ```

5. **Caching is per-query + parameters.** `SELECT * FROM users WHERE id = 1` and `SELECT * FROM users WHERE id = 2` are cached separately.

6. **Transactions bypass the cache.** Queries inside `BEGIN ... COMMIT` always go to the origin database, which is correct for write consistency.

7. **Use `swr` for high availability.** The stale-while-revalidate window means users get fast responses even when the cache is being refreshed. Set `swr` higher if your data can tolerate slightly stale reads.

8. **Prepared statements work.** Hyperdrive supports PostgreSQL's extended query protocol (prepared statements, binary parameters), which most drivers use by default.

9. **Multiple databases.** Create separate Hyperdrive configs for each database and bind them as separate environment variables.

10. **Local dev.** `wrangler dev` connects to Hyperdrive as it would in production. Your database must be reachable from your local machine for this to work. You can also use `--local` mode with a local database.
