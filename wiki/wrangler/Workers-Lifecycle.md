# Workers Lifecycle

This page covers the full lifecycle of a Cloudflare Worker: scaffolding, local development, building, deploying, monitoring, and cleanup.

See also: [[Home]] for installation and auth, [[Versioning-and-Deployments]] for gradual rollouts, [[Configuration-Reference]] for full config options.

---

## `wrangler init` -- Scaffold a Project

Creates a new Worker project with starter files and a `wrangler.jsonc` configuration.

```bash
wrangler init [name] [flags]
```

| Flag | Description |
|---|---|
| `--yes`, `-y` | Accept all defaults (TypeScript, no git init prompt) |
| `--from-dash <name>` | Pull config and code from an already-deployed Worker |
| `--template <url>` | Clone from a template repository |
| `--type <type>` | One of `javascript`, `typescript`, `webpack`, `rust` |

### Examples

```bash
# Interactive setup
wrangler init my-worker

# Quick start with defaults
wrangler init my-worker -y

# Bootstrap from an existing production Worker
wrangler init --from-dash api-gateway

# Use a Hono framework template
wrangler init my-api --template https://github.com/honojs/hono-minimal
```

After initialization your directory looks like:

```
my-worker/
  src/
    index.ts          # Entry point
  wrangler.jsonc      # Configuration
  package.json
  tsconfig.json
```

---

## `wrangler dev` -- Local Development Server

Runs a local development server that simulates the Workers runtime. It supports live reload, local bindings (KV, R2, D1, DO via Miniflare), and Chrome DevTools integration.

```bash
wrangler dev [script] [flags]
```

| Flag | Description |
|---|---|
| `--port <number>` | Local port to listen on (default: `8787`) |
| `--ip <address>` | IP address to bind to (default: `localhost`) |
| `--remote` | Run against the real Cloudflare edge instead of locally |
| `--local` | Force local mode (default behavior) |
| `--persist-to <path>` | Directory for persisted local state (KV, R2, D1 data) |
| `--test-scheduled` | Enables a `/__scheduled` route to test cron triggers locally |
| `--log-level <level>` | One of `debug`, `info`, `log`, `warn`, `error`, `none` |
| `--var <KEY:VALUE>` | Inject a text variable for this session |
| `--define <KEY:VALUE>` | Inject a compile-time define |
| `--inspector-port <number>` | Port for Chrome DevTools inspector |
| `--env`, `-e` | Environment to simulate |
| `--live-reload` | Automatically reload the browser on code changes |

### Basic usage

```bash
# Start local dev server
wrangler dev

# Start on a custom port
wrangler dev --port 3000

# Start with remote (edge) execution
wrangler dev --remote
```

### Working with local bindings

Local dev automatically provides local versions of all bindings declared in your config. Data is persisted between restarts in a `.wrangler/state` directory by default.

```bash
# Persist KV/R2/D1 data to a specific directory
wrangler dev --persist-to ./local-data
```

### Testing cron triggers

```bash
wrangler dev --test-scheduled
# Then visit http://localhost:8787/__scheduled to trigger the cron handler
```

### Injecting variables for local testing

```bash
wrangler dev --var API_KEY:test-key-123 --var DEBUG:true
```

### Chrome DevTools

While `wrangler dev` is running, press `d` in the terminal to open Chrome DevTools for the Workers runtime. You can set breakpoints, inspect network requests, and profile performance.

> **Tip:** The `--remote` flag is useful when you need to test against real Cloudflare services (e.g., a production KV namespace or a Durable Object that requires state from the edge). Be cautious -- remote dev executes code on Cloudflare's network and can affect real data.

---

## `wrangler deploy` -- Deploy to Cloudflare

Uploads and deploys your Worker to the Cloudflare network.

```bash
wrangler deploy [script] [flags]
```

| Flag | Description |
|---|---|
| `--name <name>` | Override the Worker name from config |
| `--env`, `-e` | Deploy to a specific environment |
| `--outdir <path>` | Write the bundled output to this directory |
| `--dry-run` | Build and validate without actually deploying |
| `--keep-vars` | Preserve existing environment variables and secrets (do not remove unset ones) |
| `--minify` | Minify the bundled Worker code |
| `--compatibility-date <date>` | Override the compatibility date |
| `--compatibility-flags <flags>` | Override compatibility flags (comma-separated) |
| `--assets <dir>` | Serve a directory of static assets alongside the Worker |
| `--dispatch-namespace <ns>` | Deploy to a Workers for Platforms dispatch namespace |
| `--delete-class <name>` | Delete a Durable Object class that is no longer referenced |
| `--var <KEY:VALUE>` | Set a text variable at deploy time |

### Basic deploy

```bash
wrangler deploy
```

### Deploy to an environment

Environments allow you to deploy the same Worker code under different names, routes, or bindings. Environments are defined in [[Configuration-Reference]].

```bash
# Deploy to the "staging" environment
wrangler deploy --env staging

# Deploy to production
wrangler deploy --env production
```

### Dry run (validate without deploying)

```bash
wrangler deploy --dry-run --outdir ./dist
# Writes bundled output to ./dist without uploading
```

### Deploy with static assets

```bash
wrangler deploy --assets ./public
```

### Routes and custom domains

Routes and custom domains are configured in `wrangler.jsonc` (see [[Configuration-Reference]]). When you run `wrangler deploy`, Workers are attached to the specified routes automatically.

```jsonc
{
  "name": "my-api",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01",
  "routes": [
    { "pattern": "api.example.com/*", "zone_name": "example.com" }
  ]
}
```

```bash
wrangler deploy
# Deploys and attaches to api.example.com/*
```

### Custom domains

```jsonc
{
  "name": "my-api",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01",
  "custom_domains": [
    "api.example.com",
    "api.example.org"
  ]
}
```

> **Tip:** Use `wrangler deploy --dry-run` in CI to validate your Worker compiles correctly, even on branches that should not deploy.

---

## `wrangler delete` -- Remove a Deployed Worker

Deletes a Worker from your Cloudflare account. This removes the Worker, all associated routes, and cron triggers. It does **not** delete bound resources (KV namespaces, R2 buckets, D1 databases, etc.).

```bash
wrangler delete [script] [flags]
```

| Flag | Description |
|---|---|
| `--name <name>` | Name of the Worker to delete |
| `--env`, `-e` | Environment to delete |
| `--force` | Skip the confirmation prompt |
| `--dry-run` | Show what would be deleted without deleting |

### Examples

```bash
# Delete the Worker defined in the current wrangler.jsonc
wrangler delete

# Delete a specific Worker by name
wrangler delete --name old-api

# Delete the staging environment Worker
wrangler delete --env staging

# Skip confirmation
wrangler delete --force
```

> **Warning:** Deletion is irreversible. The Worker's code and configuration are permanently removed. Secrets associated with the Worker are also deleted. Bound resources like KV namespaces remain intact and must be deleted separately.

---

## `wrangler build` -- Build Without Deploying

Bundles your Worker code using the same pipeline as `wrangler deploy` but stops before uploading. Useful for inspecting the build output, integrating with external CI, or running custom post-build steps.

```bash
wrangler build [flags]
```

| Flag | Description |
|---|---|
| `--outdir <path>` | Directory to write the build artifacts to (default: `./dist`) |
| `--minify` | Minify the output |
| `--env`, `-e` | Build using a specific environment's config |

### Examples

```bash
# Build and inspect output
wrangler build --outdir ./dist

# Build with minification
wrangler build --minify --outdir ./dist

# Inspect the output
ls -la ./dist/
cat ./dist/index.js | head -20
```

---

## `wrangler tail` -- Stream Live Logs

Streams real-time logs from a deployed Worker. Each log entry includes the request URL, method, status code, and any `console.log` output from your Worker code.

```bash
wrangler tail [worker-name] [flags]
```

| Flag | Description |
|---|---|
| `--format <format>` | Output format: `json` or `pretty` (default: `pretty`) |
| `--status <status>` | Filter by outcome status: `ok`, `error`, `canceled` |
| `--method <method>` | Filter by HTTP method: `GET`, `POST`, `PUT`, etc. |
| `--header <header>` | Filter by header presence (e.g., `X-Custom-Header:value`) |
| `--ip <address>` | Filter by client IP addresses (comma-separated, `self` for your own IP) |
| `--search <term>` | Filter logs containing a specific string |
| `--sampling-rate <rate>` | Sampling rate from `0` to `1` (default: `1` = all logs) |
| `--env`, `-e` | Tail a specific environment |
| `--debug` | Include debug-level logs |

### Basic usage

```bash
# Tail the Worker defined in wrangler.jsonc
wrangler tail

# Tail a specific Worker by name
wrangler tail my-api
```

### Filtering logs

```bash
# Only show errors
wrangler tail --status error

# Only show POST requests
wrangler tail --method POST

# Only show requests from your own IP
wrangler tail --ip self

# Combine filters: errors from POST requests
wrangler tail --status error --method POST

# Filter by a string in the log output
wrangler tail --search "payment failed"
```

### JSON output for piping

```bash
# Stream JSON logs into jq for processing
wrangler tail --format json | jq '.logs[]'

# Save logs to a file
wrangler tail --format json > worker-logs.jsonl
```

### Sampling for high-traffic Workers

```bash
# Sample 10% of requests to reduce noise
wrangler tail --sampling-rate 0.1
```

> **Tip:** `wrangler tail` opens a WebSocket connection to the Cloudflare network. It works on production traffic in real time. For Workers that receive very high traffic, use `--sampling-rate` to avoid overwhelming your terminal.

---

## `wrangler types` -- Generate TypeScript Types

Generates TypeScript type declarations based on your `wrangler.jsonc` bindings. This creates a `.d.ts` file (typically `worker-configuration.d.ts`) that provides type-safe access to your KV, R2, D1, and other bindings in your Worker code.

```bash
wrangler types [flags]
```

| Flag | Description |
|---|---|
| `--env`, `-e` | Generate types for a specific environment |
| `--env-interface <name>` | Name of the generated interface (default: `Env`) |
| `--x-include-runtime` | Include Workers runtime types |

### Examples

```bash
# Generate types from current config
wrangler types

# Generate types for the staging environment
wrangler types --env staging

# Include runtime types
wrangler types --x-include-runtime
```

This generates a file like:

```typescript
// worker-configuration.d.ts
interface Env {
  MY_KV: KVNamespace;
  MY_BUCKET: R2Bucket;
  MY_DB: D1Database;
  API_SECRET: string;
}
```

Your Worker entry point can then use this interface:

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const value = await env.MY_KV.get("key"); // fully typed
    return new Response(value);
  },
};
```

> **Tip:** Add `wrangler types` to a `postinstall` or `prebuild` script in `package.json` so types are always up to date:
>
> ```json
> {
>   "scripts": {
>     "postinstall": "wrangler types"
>   }
> }
> ```

---

## `wrangler setup` -- Interactive Onboarding

Runs an interactive setup wizard that walks you through configuring Wrangler for your project. It detects your framework, suggests config values, and creates or updates your `wrangler.jsonc`.

```bash
wrangler setup
```

This command is particularly useful when:

- You are adding Workers to an existing project (e.g., a Next.js, Remix, or Astro app).
- You want guided help creating bindings.
- You are migrating from another platform.

The wizard will ask questions about your project and generate the appropriate configuration.

---

## Common Workflow Example

A typical development flow from start to deploy:

```bash
# 1. Scaffold a new project
wrangler init my-api -y
cd my-api

# 2. Edit src/index.ts with your Worker logic
# ...

# 3. Start local development with live reload
wrangler dev

# 4. Test locally at http://localhost:8787
# Press 'd' to open DevTools
# Press 'x' to exit

# 5. Generate types if you added bindings
wrangler types

# 6. Deploy to staging
wrangler deploy --env staging

# 7. Tail staging logs to verify
wrangler tail --env staging

# 8. Deploy to production
wrangler deploy --env production

# 9. Tail production logs
wrangler tail --env production --sampling-rate 0.1
```

---

## Tips

- Use `wrangler dev --persist-to ./local-data` during development so your KV, R2, and D1 data survives restarts. Without it, data is stored in a temporary `.wrangler/state` directory that is still persisted, but using an explicit path makes it easier to manage and reset.
- `wrangler dev --remote` connects to the actual Cloudflare edge. It is slower but tests real behavior including edge-specific APIs and deployed bindings.
- `wrangler deploy --dry-run` is invaluable in CI pipelines for validating that the Worker compiles before merging a PR.
- `wrangler tail` is your primary debugging tool for production. Combine `--status error` with `--search` to find specific issues quickly.
- Always run `wrangler types` after changing bindings in your config to keep TypeScript types in sync.
