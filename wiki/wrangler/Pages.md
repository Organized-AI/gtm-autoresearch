# Pages

Cloudflare Pages is a platform for deploying full-stack applications. It supports static sites, JAMstack frameworks (Next.js, Astro, Remix, SvelteKit, etc.), and serverless functions via **Pages Functions** (which run on the Workers runtime).

Wrangler provides commands to manage Pages projects, deployments, local development, and secrets.

See also: [[Workers-Lifecycle]] for Workers-specific commands, [[Configuration-Reference]] for binding configuration, [[Security]] for centralized secrets.

---

## Overview

Pages differs from Workers in key ways:

- **Pages** is asset-first: you deploy a directory of static files, optionally with server-side Functions.
- **Workers** is code-first: you deploy a script that handles requests.

Pages projects can have:
- **Static assets**: HTML, CSS, JS, images, fonts.
- **Pages Functions**: Server-side code in a `functions/` directory that runs on the Workers runtime.
- **Bindings**: KV, R2, D1, Durable Objects, etc., configured in `wrangler.jsonc` or the dashboard.

---

## `wrangler pages dev` -- Local Development

Runs a local development server for a Pages project. It serves static assets and runs Pages Functions locally with full binding support (via Miniflare).

```bash
wrangler pages dev [directory] [flags]
```

| Flag | Description |
|---|---|
| `[directory]` | The static asset directory to serve (e.g., `./dist`, `./build`, `./public`) |
| `--port <number>` | Local port (default: `8788`) |
| `--proxy <port>` | Proxy a running framework dev server (e.g., `--proxy 3000`) |
| `--binding <KEY=VALUE>` | Add a binding for local dev |
| `--kv <BINDING_NAME>` | Bind a local KV namespace |
| `--d1 <BINDING_NAME>` | Bind a local D1 database |
| `--r2 <BINDING_NAME>` | Bind a local R2 bucket |
| `--do <BINDING_NAME=CLASS_NAME>` | Bind a Durable Object |
| `--persist-to <path>` | Persist local binding data to a directory |
| `--compatibility-date <date>` | Workers runtime compatibility date |
| `--compatibility-flags <flags>` | Workers runtime compatibility flags |
| `--live-reload` | Auto-reload browser on changes |
| `--ip <address>` | IP address to bind to |
| `--log-level <level>` | Log level: `debug`, `info`, `log`, `warn`, `error`, `none` |

### Serving a static build directory

```bash
# Build your framework (e.g., Astro, Vite, Next.js)
npm run build

# Serve the output directory
wrangler pages dev ./dist
```

### Proxying a framework dev server

If your framework has its own dev server (e.g., `npm run dev` starts Vite on port 5173), you can proxy it through Wrangler to get Pages Functions and bindings working locally:

```bash
# In one terminal: start the framework dev server
npm run dev
# Framework running on http://localhost:5173

# In another terminal: proxy through Wrangler
wrangler pages dev --proxy 5173
# Pages dev server on http://localhost:8788, proxying to 5173
```

### Local bindings

```bash
wrangler pages dev ./dist \
  --kv MY_CACHE \
  --d1 MY_DB \
  --r2 ASSETS \
  --binding API_KEY=test-key
```

### Persisting local data

```bash
wrangler pages dev ./dist --persist-to ./.wrangler/pages-state
```

---

## `wrangler pages deploy` / `wrangler pages publish`

Deploys a Pages project. Uploads the static asset directory and any Pages Functions to Cloudflare.

> `wrangler pages publish` is an alias for `wrangler pages deploy`. Both commands are equivalent.

```bash
wrangler pages deploy <directory> [flags]
```

| Flag | Description |
|---|---|
| `<directory>` | The build output directory to deploy (required) |
| `--project-name <name>` | Pages project name |
| `--branch <branch>` | Git branch name for this deployment (affects preview vs. production) |
| `--commit-hash <hash>` | Git commit hash to associate with this deployment |
| `--commit-message <msg>` | Commit message to display in the dashboard |
| `--commit-dirty` | Mark the deployment as from a dirty working tree |
| `--skip-caching` | Skip Cloudflare's asset caching |
| `--no-bundle` | Skip bundling Functions |

### Deploy a static site

```bash
# Build
npm run build

# Deploy
wrangler pages deploy ./dist --project-name my-site
```

On first deploy, if the project does not exist, Wrangler will prompt you to create it.

### Production vs. Preview deployments

Pages uses the **branch** name to determine whether a deployment is production or preview:

```bash
# Production deployment (main branch)
wrangler pages deploy ./dist --project-name my-site --branch main

# Preview deployment (feature branch)
wrangler pages deploy ./dist --project-name my-site --branch feat/new-homepage
```

Preview deployments get a unique URL like `feat-new-homepage.my-site.pages.dev`.

### Full-stack Pages app (with Functions)

If your project has a `functions/` directory, Pages Functions are automatically detected and deployed alongside the static assets.

```
my-project/
  functions/
    api/
      hello.ts        # Handles GET /api/hello
      users/
        [id].ts       # Handles GET /api/users/:id
  dist/
    index.html
    style.css
  wrangler.jsonc
```

```bash
wrangler pages deploy ./dist --project-name my-fullstack-app
```

Example Pages Function (`functions/api/hello.ts`):

```typescript
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const value = await context.env.MY_KV.get("greeting");
  return new Response(JSON.stringify({ message: value || "Hello, world!" }), {
    headers: { "Content-Type": "application/json" },
  });
};
```

### CI/CD deployment

```bash
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ACCOUNT_ID="your-account-id"

npm run build
wrangler pages deploy ./dist \
  --project-name my-site \
  --branch "$CI_BRANCH" \
  --commit-hash "$CI_COMMIT_SHA" \
  --commit-message "$CI_COMMIT_MESSAGE"
```

---

## Project Management

### `wrangler pages project list`

Lists all Pages projects in your account.

```bash
wrangler pages project list
```

Example output:

```
Name            Subdomain                      Created
my-site         my-site.pages.dev              2026-01-15T10:00:00Z
my-app          my-app.pages.dev               2026-03-20T14:30:00Z
docs            docs.pages.dev                 2025-11-01T08:00:00Z
```

### `wrangler pages project create`

Creates a new Pages project without deploying anything.

```bash
wrangler pages project create <project-name> [flags]
```

| Flag | Description |
|---|---|
| `--production-branch <branch>` | The branch that triggers production deployments (default: `main`) |

```bash
wrangler pages project create my-new-site --production-branch main
```

### `wrangler pages project delete`

Deletes a Pages project and all its deployments.

```bash
wrangler pages project delete <project-name> [flags]
```

```bash
wrangler pages project delete old-prototype
# Prompts for confirmation
```

> **Warning:** This deletes all deployments, custom domains, and configuration for the project. It cannot be undone.

---

## Deployment Management

### `wrangler pages deployment list`

Lists all deployments for a project.

```bash
wrangler pages deployment list --project-name <name> [flags]
```

| Flag | Description |
|---|---|
| `--project-name <name>` | Pages project name (required) |
| `--environment <env>` | Filter by environment: `production` or `preview` |

```bash
# List all deployments
wrangler pages deployment list --project-name my-site

# List only production deployments
wrangler pages deployment list --project-name my-site --environment production
```

### `wrangler pages deployment create`

Alias for `wrangler pages deploy`. Creates a new deployment by uploading assets.

```bash
wrangler pages deployment create ./dist --project-name my-site
```

### `wrangler pages deployment tail`

Streams live logs from a Pages deployment, similar to `wrangler tail` for Workers.

```bash
wrangler pages deployment tail --project-name <name> [flags]
```

| Flag | Description |
|---|---|
| `--project-name <name>` | Pages project name |
| `--environment <env>` | `production` or `preview` |
| `--format <format>` | `json` or `pretty` |
| `--status <status>` | Filter: `ok`, `error`, `canceled` |
| `--method <method>` | Filter by HTTP method |
| `--ip <address>` | Filter by client IP |
| `--search <term>` | Filter by string content |

```bash
# Tail production logs
wrangler pages deployment tail --project-name my-site --environment production

# Tail only errors
wrangler pages deployment tail --project-name my-site --status error
```

### `wrangler pages deployment delete`

Deletes a specific deployment.

```bash
wrangler pages deployment delete --project-name <name> --deployment-id <id>
```

```bash
wrangler pages deployment delete --project-name my-site --deployment-id abc123
```

---

## Pages Functions

Pages Functions let you run server-side code on the Workers runtime. They live in a `functions/` directory and are file-system routed.

### `wrangler pages functions build`

Builds Pages Functions into a single Worker bundle. Useful for debugging or custom build pipelines.

```bash
wrangler pages functions build [flags]
```

| Flag | Description |
|---|---|
| `--outfile <path>` | Output file path |
| `--outdir <path>` | Output directory |
| `--bindings <json>` | JSON string of bindings |
| `--external-modules` | Treat dynamic imports as external modules |

```bash
# Build Functions to inspect the output
wrangler pages functions build --outdir ./functions-dist
```

### `wrangler pages functions build-env`

Outputs the environment configuration for Pages Functions. Useful for debugging which bindings and variables are available.

```bash
wrangler pages functions build-env
```

### `wrangler pages functions optimize-routes`

Analyzes and optimizes the file-based routing for your Functions directory. Outputs the generated route configuration.

```bash
wrangler pages functions optimize-routes --routes-path ./functions
```

---

## Pages Secrets

Pages projects can have secrets (encrypted environment variables) that are available to Pages Functions at runtime.

### `wrangler pages secret put`

Sets a secret for a Pages project.

```bash
wrangler pages secret put <KEY> --project-name <name> [flags]
```

| Flag | Description |
|---|---|
| `--project-name <name>` | Pages project name (required) |
| `--environment <env>` | `production` or `preview` |

```bash
# Set a production secret (prompts for value)
wrangler pages secret put API_KEY --project-name my-site --environment production

# Pipe from stdin
echo "sk-secret-value" | wrangler pages secret put API_KEY --project-name my-site
```

### `wrangler pages secret bulk`

Sets multiple secrets from a JSON file.

```bash
wrangler pages secret bulk secrets.json --project-name <name> [flags]
```

```bash
cat secrets.json
{
  "API_KEY": "sk-12345",
  "DATABASE_URL": "postgres://...",
  "JWT_SECRET": "my-jwt-secret"
}

wrangler pages secret bulk secrets.json --project-name my-site --environment production
```

### `wrangler pages secret delete`

Deletes a secret.

```bash
wrangler pages secret delete <KEY> --project-name <name> [flags]
```

```bash
wrangler pages secret delete OLD_KEY --project-name my-site --environment production
```

### `wrangler pages secret list`

Lists secret names (not values) for a Pages project.

```bash
wrangler pages secret list --project-name <name> [flags]
```

```bash
wrangler pages secret list --project-name my-site --environment production
```

---

## `wrangler pages download config`

Downloads the current Pages project configuration from the Cloudflare dashboard to a local file. Useful for syncing dashboard changes to your local config.

```bash
wrangler pages download config --project-name <name>
```

```bash
wrangler pages download config --project-name my-site
# Writes configuration to wrangler.jsonc
```

---

## Example: Deploying a Static Site

End-to-end example deploying a Vite static site.

```bash
# 1. Create the project
npm create vite@latest my-static-site -- --template vanilla-ts
cd my-static-site
npm install

# 2. Build
npm run build

# 3. Create the Pages project
wrangler pages project create my-static-site --production-branch main

# 4. Deploy
wrangler pages deploy ./dist --project-name my-static-site --branch main

# 5. View the deployment
# Output: https://my-static-site.pages.dev
```

---

## Example: Full-Stack Pages App with Bindings

End-to-end example deploying an Astro app with a KV-backed API.

```bash
# 1. Create an Astro project
npm create astro@latest my-fullstack-app
cd my-fullstack-app
```

Add a Pages Function (`functions/api/data.ts`):

```typescript
interface Env {
  CACHE: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const cached = await context.env.CACHE.get("latest-data");
  if (cached) {
    return new Response(cached, {
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = JSON.stringify({ timestamp: Date.now(), status: "fresh" });
  await context.env.CACHE.put("latest-data", data, { expirationTtl: 300 });
  return new Response(data, {
    headers: { "Content-Type": "application/json" },
  });
};
```

Configure bindings in `wrangler.jsonc`:

```jsonc
{
  "name": "my-fullstack-app",
  "pages_build_output_dir": "./dist",
  "compatibility_date": "2025-04-01",
  "kv_namespaces": [
    { "binding": "CACHE", "id": "abcdef1234567890" }
  ]
}
```

```bash
# 2. Local dev with bindings
npm run build
wrangler pages dev ./dist

# 3. Test the Function
curl http://localhost:8788/api/data

# 4. Deploy to production
wrangler pages deploy ./dist --project-name my-fullstack-app --branch main

# 5. Set production secrets
wrangler pages secret put EXTERNAL_API_KEY --project-name my-fullstack-app --environment production

# 6. Tail production logs
wrangler pages deployment tail --project-name my-fullstack-app --environment production
```

---

## Tips

- **Branch-based environments**: Pages automatically treats deployments from your production branch as production and everything else as preview. You do not need to configure environments manually.
- **`--proxy` is powerful**: For frameworks like Next.js or Remix that have their own dev server with HMR, use `wrangler pages dev --proxy <port>` to layer Pages Functions and bindings on top without losing hot reload.
- **File-based routing**: Pages Functions use the filesystem for routing. `functions/api/users/[id].ts` handles `/api/users/:id`. `functions/api/[[catchall]].ts` handles all unmatched routes under `/api/`.
- **Secrets per environment**: Pages secrets are scoped to `production` or `preview`. Always specify `--environment` when setting secrets to avoid surprises.
- **`pages download config`**: If someone changed bindings in the dashboard, run this to sync those changes to your local `wrangler.jsonc`.
- Pages and Workers share the same runtime. Pages Functions have the same APIs, limits, and capabilities as Workers, including access to all bindings.
