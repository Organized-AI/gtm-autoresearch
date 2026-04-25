# Containers

Cloudflare Containers lets you run **Docker containers directly on Cloudflare's global network**. While Workers excel at lightweight, sub-millisecond tasks, Containers handle workloads that need full OS environments, long-running processes, GPU access, or existing Docker images you do not want to rewrite.

---

## Core Concepts

| Concept | Description |
|---|---|
| **Container** | A running Docker container deployed to Cloudflare's network. |
| **Image** | A Docker/OCI image pushed to Cloudflare's container registry. |
| **Registry** | Cloudflare's built-in container registry, or an external registry you configure. |
| **Instance** | A single running copy of a container. A container definition can have multiple instances. |

### How It Works

```
Docker Image --> Cloudflare Registry --> Container Instance(s) --> Worker (optional front-end)
                                              |
                                              +--> Accessible via URL or Worker binding
```

1. Build a Docker image locally.
2. Push it to Cloudflare's container registry.
3. Deploy it -- Cloudflare starts container instances on its network.
4. Optionally, put a Worker in front to handle routing, auth, or request transformation.

---

## CLI Commands: `wrangler containers`

### Build an Image

```bash
wrangler containers build [OPTIONS]
```

Builds a Docker image from a Dockerfile in the current directory (or specified path).

| Flag | Description |
|---|---|
| `--tag <TAG>` | Tag for the image (e.g., `my-app:v1`) |
| `--file <PATH>` | Path to Dockerfile (default: `./Dockerfile`) |
| `--context <PATH>` | Build context directory (default: `.`) |
| `--platform <PLATFORM>` | Target platform (e.g., `linux/amd64`) |

**Example:**

```bash
wrangler containers build --tag my-api:latest
```

Output:

```
Building image from ./Dockerfile...
Step 1/5 : FROM node:20-slim
Step 2/5 : WORKDIR /app
Step 3/5 : COPY package*.json ./
Step 4/5 : RUN npm ci --production
Step 5/5 : COPY . .
Successfully built my-api:latest (sha256:abc123...)
```

### Push an Image

```bash
wrangler containers push <TAG>
```

Pushes a locally built image to Cloudflare's container registry.

| Flag | Description |
|---|---|
| `--registry <URL>` | Push to a specific registry (default: Cloudflare registry) |

**Example:**

```bash
wrangler containers push my-api:latest
```

Output:

```
Pushing my-api:latest to Cloudflare registry...
Uploading layers: [====================] 100%
Pushed: registry.cloudflare.com/my-account/my-api:latest
Digest: sha256:abc123def456...
```

### List Containers

```bash
wrangler containers list
```

| Flag | Description |
|---|---|
| `--json` | Output as JSON |

**Example:**

```bash
wrangler containers list
```

Output:

```
Containers:
  NAME        IMAGE                STATUS    INSTANCES  CREATED
  my-api      my-api:latest        running   2          2026-04-20
  worker-bg   bg-processor:v3      running   1          2026-04-18
  legacy-svc  legacy-app:v1.2      stopped   0          2026-03-01
```

### Get Container Info

```bash
wrangler containers info <NAME>
```

Displays detailed information about a container including configuration, resource limits, environment variables, and instance status.

**Example:**

```bash
wrangler containers info my-api
```

Output:

```
Container: my-api
Image: my-api:latest (sha256:abc123...)
Status: running
Created: 2026-04-20T10:00:00Z

Resources:
  CPU: 1 vCPU
  Memory: 512 MB
  Disk: 2 GB

Environment:
  NODE_ENV=production
  PORT=8080

Instances:
  ID              STATUS    REGION   STARTED
  inst-abc123     running   us-east  2026-04-25T08:00:00Z
  inst-def456     running   eu-west  2026-04-25T08:00:00Z

Network:
  Port: 8080
  URL: https://my-api.containers.cloudflare.com
```

### List Container Instances

```bash
wrangler containers instances <NAME>
```

Shows all running instances of a container.

| Flag | Description |
|---|---|
| `--json` | Output as JSON |

**Example:**

```bash
wrangler containers instances my-api
```

### Delete a Container

```bash
wrangler containers delete <NAME>
```

Stops all instances and removes the container definition.

| Flag | Description |
|---|---|
| `--force` | Skip confirmation prompt |

**Example:**

```bash
wrangler containers delete legacy-svc --force
```

### SSH into a Running Container

```bash
wrangler containers ssh <NAME> [INSTANCE_ID]
```

Opens an interactive SSH session into a running container instance. If no instance ID is given and there are multiple instances, you are prompted to choose one.

| Flag | Description |
|---|---|
| `--command <CMD>` | Run a single command instead of opening an interactive shell |

**Examples:**

```bash
# Interactive shell
wrangler containers ssh my-api

# Run a specific command
wrangler containers ssh my-api --command "cat /app/logs/error.log"

# SSH into a specific instance
wrangler containers ssh my-api inst-abc123
```

---

## Registry Management: `wrangler containers registries`

### Configure an External Registry

```bash
wrangler containers registries configure <NAME>
```

Configures credentials for an external container registry (Docker Hub, GitHub Container Registry, AWS ECR, etc.) so you can pull images from it.

| Flag | Description |
|---|---|
| `--url <URL>` | Registry URL (e.g., `https://ghcr.io`, `https://registry.hub.docker.com`) |
| `--username <USER>` | Registry username |
| `--password <PASS>` | Registry password or token (can also be set via prompt) |

**Example:**

```bash
wrangler containers registries configure github-registry \
  --url https://ghcr.io \
  --username my-github-user
# You will be prompted for the password/token
```

### List Configured Registries

```bash
wrangler containers registries list
```

**Example:**

```bash
wrangler containers registries list
```

Output:

```
Configured Registries:
  NAME              URL                                 USERNAME
  cloudflare        registry.cloudflare.com             (default)
  github-registry   https://ghcr.io                     my-github-user
  docker-hub        https://registry.hub.docker.com     myuser
```

### Delete a Registry Configuration

```bash
wrangler containers registries delete <NAME>
```

### View Registry Credentials

```bash
wrangler containers registries credentials <NAME>
```

Shows the stored credentials for a configured registry (password is masked).

---

## Image Management: `wrangler containers images`

### List Images

```bash
wrangler containers images list
```

Lists all images in Cloudflare's container registry for your account.

| Flag | Description |
|---|---|
| `--json` | Output as JSON |

**Example:**

```bash
wrangler containers images list
```

Output:

```
Images in Cloudflare Registry:
  REPOSITORY          TAG       DIGEST            SIZE     PUSHED
  my-api              latest    sha256:abc123...  145 MB   2026-04-25
  my-api              v1.2.0    sha256:def456...  142 MB   2026-04-20
  bg-processor        v3        sha256:ghi789...  98 MB    2026-04-18
  legacy-app          v1.2      sha256:jkl012...  230 MB   2026-03-01
```

### Delete an Image

```bash
wrangler containers images delete <REPOSITORY>:<TAG>
```

| Flag | Description |
|---|---|
| `--force` | Skip confirmation prompt |

**Example:**

```bash
wrangler containers images delete legacy-app:v1.2 --force
```

---

## Container Configuration in `wrangler.jsonc`

Define containers alongside your Worker:

```jsonc
{
  "name": "my-app",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "containers": [
    {
      "binding": "MY_CONTAINER",
      "image": "my-api:latest",
      "port": 8080,
      "resources": {
        "cpu": 1,
        "memory": "512MB"
      },
      "environment": {
        "NODE_ENV": "production",
        "LOG_LEVEL": "info"
      },
      "instances": {
        "min": 1,
        "max": 5
      }
    }
  ]
}
```

### Using a Container from a Worker

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Forward request to the container
    const containerUrl = await env.MY_CONTAINER.getUrl();
    const containerResponse = await fetch(`${containerUrl}/api/process`, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    return containerResponse;
  },
};
```

---

## Example: Deploying a Containerized Application

### Step 1: Create a Dockerfile

```dockerfile
# Dockerfile
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 8080
CMD ["node", "server.js"]
```

### Step 2: Write the Application

```javascript
// server.js
const http = require("http");

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "healthy", uptime: process.uptime() }));
    return;
  }

  if (req.url === "/api/process" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const data = JSON.parse(body);
      // Heavy computation that wouldn't fit in a Worker
      const result = heavyComputation(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

function heavyComputation(data) {
  // CPU-intensive work, ML inference, image processing, etc.
  return { processed: true, input: data };
}

server.listen(8080, () => {
  console.log("Server running on port 8080");
});
```

### Step 3: Build and Push

```bash
# Build the image
wrangler containers build --tag my-api:v1.0.0

# Push to Cloudflare registry
wrangler containers push my-api:v1.0.0
```

### Step 4: Configure `wrangler.jsonc`

```jsonc
{
  "name": "api-gateway",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "containers": [
    {
      "binding": "API_CONTAINER",
      "image": "my-api:v1.0.0",
      "port": 8080,
      "resources": {
        "cpu": 2,
        "memory": "1GB"
      },
      "environment": {
        "NODE_ENV": "production"
      },
      "instances": {
        "min": 2,
        "max": 10
      }
    }
  ]
}
```

### Step 5: Deploy the Worker + Container

```bash
wrangler deploy
```

### Step 6: Verify

```bash
# Check container status
wrangler containers list

# View instance details
wrangler containers info my-api

# Test the endpoint
curl https://api-gateway.example.com/api/process \
  -H "Content-Type: application/json" \
  -d '{"data": "test"}'

# SSH in for debugging
wrangler containers ssh my-api
```

---

## Example: Using an External Registry Image

Pull and deploy an image from GitHub Container Registry:

```bash
# 1. Configure the external registry
wrangler containers registries configure ghcr \
  --url https://ghcr.io \
  --username my-github-user

# 2. Reference the external image in wrangler.jsonc
```

```jsonc
{
  "containers": [
    {
      "binding": "ML_MODEL",
      "image": "ghcr.io/my-org/ml-inference:latest",
      "port": 5000,
      "resources": {
        "cpu": 4,
        "memory": "2GB"
      }
    }
  ]
}
```

```bash
# 3. Deploy
wrangler deploy
```

---

## Updating a Container

To deploy a new version:

```bash
# Build new version
wrangler containers build --tag my-api:v1.1.0

# Push it
wrangler containers push my-api:v1.1.0

# Update wrangler.jsonc to reference the new tag, then:
wrangler deploy
```

Cloudflare performs a rolling update -- new instances start with the new image while old instances drain connections.

---

## Tips

- **Workers as front-ends** -- Always put a Worker in front of your container. The Worker handles routing, authentication, rate limiting, and caching at the edge, while the container handles compute-heavy work.
- **Health checks** -- Implement a `/health` endpoint in your container. Cloudflare uses it to determine instance health and restart unhealthy instances.
- **Startup time** -- Containers take seconds to start (not milliseconds like Workers). Use `min` instances to keep warm capacity ready.
- **Image size** -- Smaller images start faster. Use multi-stage Docker builds and slim base images (`-slim`, `-alpine`).
- **Logging** -- Write logs to stdout/stderr. Cloudflare captures container logs and makes them available through the dashboard and CLI.
- **Secrets** -- Do not bake secrets into images. Use environment variables in `wrangler.jsonc` or Cloudflare Secrets for sensitive configuration.
- **Persistent storage** -- Container filesystems are ephemeral. Use R2, D1, or KV for persistent data.
- **SSH for debugging** -- Use `wrangler containers ssh` to debug running instances. This is invaluable for diagnosing production issues.
- **Cost management** -- Set appropriate `min` and `max` instance counts. Idle containers consume resources. If your workload is bursty, set `min: 0` and accept cold-start latency.
- **Port configuration** -- The `port` in `wrangler.jsonc` must match the `EXPOSE` port in your Dockerfile and the port your application listens on.

---

## See Also

- [[Dynamic-Workers]] -- Multi-tenant Workers that can front-end containers
- [[Workflows]] -- Orchestrate container tasks as durable workflow steps
- [[Cloudflare-Tunnel]] -- Expose local containers during development
