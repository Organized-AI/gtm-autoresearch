# Wrangler CLI -- Home

Wrangler is Cloudflare's command-line tool for building, previewing, and deploying applications on the Cloudflare developer platform. It manages Workers, Pages, KV, R2, D1, Durable Objects, Queues, and every other developer-facing Cloudflare product from a single CLI.

This wiki covers **Wrangler v4.x** (the current major release line).

---

## Table of Contents

| Page | Topics |
|---|---|
| **[[Home]]** | Installation, authentication, config basics, global flags, telemetry |
| **[[Workers-Lifecycle]]** | `init`, `dev`, `deploy`, `delete`, `build`, `tail`, `types`, `setup` |
| **[[Versioning-and-Deployments]]** | Gradual rollouts, `versions`, `deployments`, `rollback`, version secrets |
| **[[Pages]]** | Pages projects, deployments, Functions, secrets, local dev |
| **[[Configuration-Reference]]** | `wrangler.jsonc` schema, bindings, environments, routes, cron triggers |
| **[[Security]]** | Secrets, Secrets Store, mTLS certificates, certificate management |

---

## Installation

Wrangler is distributed as an npm package. Install it globally or as a project dev-dependency.

### Global install

```bash
npm install -g wrangler
```

### Per-project install (recommended)

```bash
npm install --save-dev wrangler
```

Then invoke it via `npx wrangler` or add scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  }
}
```

### Verify installation

```bash
wrangler --version
# Example output: ⛅ wrangler 4.14.0
```

### Updating

```bash
npm install -g wrangler@latest
# or for a project dependency:
npm install --save-dev wrangler@latest
```

---

## Authentication

Wrangler needs to authenticate against the Cloudflare API. There are two primary methods: OAuth browser login and API tokens.

### `wrangler login`

Opens a browser window for OAuth authentication. The resulting token is stored locally and refreshed automatically.

```bash
wrangler login
```

Flags:

| Flag | Description |
|---|---|
| `--scopes-list` | List all available OAuth scopes |
| `--browser` | Open the login URL in the default browser (default: `true`) |

```bash
# List available scopes before logging in
wrangler login --scopes-list

# Login without auto-opening a browser (prints URL to terminal)
wrangler login --no-browser
```

### `wrangler logout`

Revokes the current OAuth token and removes it from local storage.

```bash
wrangler logout
```

### `wrangler whoami`

Prints the currently authenticated user and account details.

```bash
wrangler whoami
```

Example output:

```
⛅ wrangler 4.14.0
──────────────────
Getting User settings...
  You are logged in with an OAuth Token, associated with the email you@example.com.

┌─────────────────────┬──────────────────────────────────┐
│ Account Name        │ Account ID                       │
├─────────────────────┼──────────────────────────────────┤
│ My Account          │ abcdef1234567890abcdef1234567890 │
└─────────────────────┴──────────────────────────────────┘
```

### `wrangler auth token`

Prints the current OAuth or API token to stdout. Useful for piping into other tools or CI scripts.

```bash
wrangler auth token
```

### API Token Authentication (CI / headless)

For CI pipelines or environments without a browser, set the `CLOUDFLARE_API_TOKEN` environment variable instead of using `wrangler login`.

```bash
export CLOUDFLARE_API_TOKEN="your-api-token-here"
wrangler deploy
```

You can also set `CLOUDFLARE_ACCOUNT_ID` to avoid interactive account selection:

```bash
export CLOUDFLARE_ACCOUNT_ID="abcdef1234567890"
export CLOUDFLARE_API_TOKEN="your-api-token-here"
wrangler deploy
```

---

## Configuration Basics

Wrangler looks for a configuration file in the current directory. The preferred format is `wrangler.jsonc` (JSON with comments), but `wrangler.json` and the legacy `wrangler.toml` are also supported.

### Minimal `wrangler.jsonc`

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01"
}
```

### Generating a config file

```bash
# Scaffold a new project with a config file
wrangler init my-project

# Or generate a config in an existing project
wrangler init --from-dash my-existing-worker
```

See [[Configuration-Reference]] for the full schema and all available options.

---

## Project Initialization -- `wrangler init`

Scaffolds a new Worker project with source files, configuration, and optional TypeScript support.

```bash
wrangler init [name] [flags]
```

| Flag | Description |
|---|---|
| `--yes`, `-y` | Accept all defaults without prompting |
| `--from-dash <worker-name>` | Initialize from an existing deployed Worker |
| `--template <url>` | Use a custom template repository |
| `--type <type>` | Worker type: `javascript`, `typescript`, `webpack`, `rust` |

### Examples

```bash
# Interactive scaffold
wrangler init my-api

# Non-interactive with defaults (TypeScript Worker)
wrangler init my-api -y

# Clone config from a deployed Worker
wrangler init --from-dash production-api

# Use a community template
wrangler init my-app --template https://github.com/cloudflare/workers-sdk/templates/worker-router
```

After `wrangler init`, your project will have:

```
my-api/
  src/
    index.ts
  wrangler.jsonc
  package.json
  tsconfig.json
```

---

## Global Flags

These flags are available on every Wrangler command.

| Flag | Description |
|---|---|
| `--config`, `-c` | Path to a `wrangler.jsonc`, `wrangler.json`, or `wrangler.toml` file (default: auto-detected in cwd) |
| `--env`, `-e` | Environment to use (maps to `[env.<name>]` in config) |
| `--env-file` | Path to a `.env` file to load environment variables from |
| `--cwd` | Run the command as if wrangler were in this directory |
| `--help`, `-h` | Show help for any command |
| `--version`, `-v` | Show installed Wrangler version |

### Examples

```bash
# Use a specific config file
wrangler dev --config ./configs/wrangler.staging.jsonc

# Deploy to the "production" environment
wrangler deploy --env production

# Load env vars from a custom file
wrangler dev --env-file .env.local

# Run from a different directory
wrangler dev --cwd ./packages/worker
```

---

## Telemetry

Wrangler collects anonymous usage telemetry to improve the tool. You can manage this setting explicitly.

### `wrangler telemetry enable`

Opts in to telemetry collection.

```bash
wrangler telemetry enable
```

### `wrangler telemetry disable`

Opts out of telemetry collection. No data will be sent.

```bash
wrangler telemetry disable
```

### `wrangler telemetry status`

Prints the current telemetry state.

```bash
wrangler telemetry status
# Example output: Status: Enabled
```

> **Tip:** Telemetry is also controlled by the `DO_NOT_TRACK=1` or `WRANGLER_SEND_METRICS=false` environment variables.

---

## `wrangler docs`

Opens the official Cloudflare Workers documentation in your default browser. You can optionally pass a search query.

```bash
wrangler docs
# Opens https://developers.cloudflare.com/workers/

wrangler docs kv
# Opens docs and searches for "kv"

wrangler docs "durable objects alarm"
# Opens docs and searches for "durable objects alarm"
```

---

## Tips

- **Use `wrangler.jsonc`** over `wrangler.toml` for new projects. JSONC supports comments, is closer to the API schema, and is the default going forward in v4.
- **Pin your `compatibility_date`** to avoid surprise behavior changes. Update it deliberately when you are ready to adopt new runtime features.
- **Per-project installs** (`npm install --save-dev wrangler`) are preferred over global installs so that every team member and CI runner uses the same version.
- **CI authentication** should always use `CLOUDFLARE_API_TOKEN` with a scoped API token rather than `wrangler login`.
- Run `wrangler whoami` after setup to confirm your account and permissions are correct.
