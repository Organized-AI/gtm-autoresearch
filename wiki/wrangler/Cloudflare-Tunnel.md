# Cloudflare Tunnel

Cloudflare Tunnel (formerly Argo Tunnel) lets you expose local services to the internet **without opening inbound ports** on your firewall. A lightweight daemon (`cloudflared`) creates outbound-only connections to Cloudflare's edge, and Cloudflare routes traffic to your origin through those secure tunnels.

Wrangler v4.x includes built-in tunnel commands so you can create, manage, and run tunnels directly from the CLI you already use for Workers development.

---

## How Tunnels Work

```
Internet --> Cloudflare Edge --> Encrypted Tunnel --> cloudflared --> Local Service
              (DNS/Route)        (outbound-only)      (your machine)   (localhost:3000)
```

1. You create a **named tunnel** which generates a unique tunnel ID and credentials file.
2. You run the tunnel, which starts `cloudflared` and opens persistent outbound connections to Cloudflare.
3. You configure **DNS routes** (CNAME records) or **Cloudflare Load Balancer** origins to point at the tunnel.
4. Requests to those DNS names flow through Cloudflare's edge and are forwarded to your local service.

**Key benefit:** Your origin server needs no public IP, no open ports, and no firewall rules. All connections are outbound from your machine to Cloudflare.

---

## CLI Commands: `wrangler tunnel`

### Create a Tunnel

```bash
wrangler tunnel create <NAME>
```

Creates a named tunnel and generates a credentials JSON file.

| Flag | Description |
|---|---|
| `--output` | Output format (`json`, `text`) |

**Example:**

```bash
wrangler tunnel create my-dev-tunnel
```

Output:

```
Created tunnel my-dev-tunnel with id f1a2b3c4-d5e6-7890-abcd-ef1234567890
Credentials file written to ~/.cloudflared/f1a2b3c4-d5e6-7890-abcd-ef1234567890.json
```

The credentials file is required to run the tunnel. Keep it safe -- anyone with this file can run the tunnel.

### List All Tunnels

```bash
wrangler tunnel list
```

| Flag | Description |
|---|---|
| `--show-deleted` | Include deleted tunnels |
| `--name <NAME>` | Filter by tunnel name |
| `--id <UUID>` | Filter by tunnel ID |
| `--is-deleted` | Filter to only deleted tunnels |
| `--json` | Output as JSON |

**Example:**

```bash
wrangler tunnel list
```

Output:

```
ID                                     NAME            CREATED              CONNECTIONS
f1a2b3c4-d5e6-7890-abcd-ef1234567890  my-dev-tunnel   2026-04-20T10:30:00Z 2
a9b8c7d6-e5f4-3210-fedc-ba9876543210  staging-tunnel  2026-03-15T08:00:00Z 4
```

### Get Tunnel Info

```bash
wrangler tunnel info <NAME_OR_ID>
```

Displays detailed information about a specific tunnel including active connections and their locations.

**Example:**

```bash
wrangler tunnel info my-dev-tunnel
```

Output:

```
Tunnel: my-dev-tunnel (f1a2b3c4-d5e6-7890-abcd-ef1234567890)
Status: active
Created: 2026-04-20T10:30:00Z

Active Connections:
  - Connection 1: colo=DFW, id=conn-abc123, opened=2026-04-25T09:00:00Z
  - Connection 2: colo=IAD, id=conn-def456, opened=2026-04-25T09:00:00Z
```

### Run a Tunnel

```bash
wrangler tunnel run <NAME_OR_ID>
```

Starts the tunnel daemon and begins serving traffic according to your configuration.

| Flag | Description |
|---|---|
| `--config <PATH>` | Path to tunnel configuration file |
| `--url <URL>` | URL of the local service to expose (simple mode) |
| `--protocol <PROTO>` | Connection protocol (`auto`, `quic`, `http2`) |
| `--no-autoupdate` | Disable automatic cloudflared updates |

**Example (simple, single service):**

```bash
wrangler tunnel run --url http://localhost:3000 my-dev-tunnel
```

**Example (with config file):**

```bash
wrangler tunnel run --config tunnel-config.yml my-dev-tunnel
```

### Quick-Start Tunnel

```bash
wrangler tunnel quick-start [URL]
```

Creates a temporary tunnel for development. No named tunnel or DNS setup required -- gives you a public URL instantly.

| Flag | Description |
|---|---|
| `--url <URL>` | Local URL to expose (default: `http://localhost:8080`) |

**Example:**

```bash
wrangler tunnel quick-start --url http://localhost:5173
```

Output:

```
Starting quick tunnel...
Your public URL: https://random-words-here.trycloudflare.com
Forwarding to: http://localhost:5173

Press Ctrl+C to stop the tunnel.
```

This is perfect for:
- Sharing a local dev server with a teammate
- Testing webhooks from external services
- Quick demos without DNS configuration

### Delete a Tunnel

```bash
wrangler tunnel delete <NAME_OR_ID>
```

| Flag | Description |
|---|---|
| `--force` | Force delete even if the tunnel has active connections |

**Example:**

```bash
wrangler tunnel delete my-dev-tunnel
```

You must stop a running tunnel before deleting it, unless you use `--force`.

---

## DNS Routing

After creating a tunnel, you need to route DNS to it so traffic reaches your local service.

### Create a DNS Route

```bash
wrangler tunnel route dns <TUNNEL_NAME_OR_ID> <HOSTNAME>
```

This creates a CNAME record pointing `<HOSTNAME>` to the tunnel.

**Example:**

```bash
wrangler tunnel route dns my-dev-tunnel app.example.com
```

Output:

```
Added CNAME app.example.com -> f1a2b3c4-d5e6-7890-abcd-ef1234567890.cfargotunnel.com
```

Now requests to `https://app.example.com` will route through the tunnel to your local service.

---

## Configuration File Format

For advanced setups (multiple services, path-based routing, etc.), use a YAML configuration file.

### Basic Configuration

```yaml
# tunnel-config.yml
tunnel: f1a2b3c4-d5e6-7890-abcd-ef1234567890
credentials-file: /home/user/.cloudflared/f1a2b3c4-d5e6-7890-abcd-ef1234567890.json

ingress:
  - hostname: app.example.com
    service: http://localhost:3000
  - service: http_status:404  # catch-all (required)
```

### Multiple Services on Subdomains

```yaml
# tunnel-config.yml
tunnel: f1a2b3c4-d5e6-7890-abcd-ef1234567890
credentials-file: /home/user/.cloudflared/f1a2b3c4-d5e6-7890-abcd-ef1234567890.json

ingress:
  # Main web app
  - hostname: app.example.com
    service: http://localhost:3000

  # API server
  - hostname: api.example.com
    service: http://localhost:8080

  # WebSocket server
  - hostname: ws.example.com
    service: ws://localhost:8765

  # Grafana dashboard
  - hostname: metrics.example.com
    service: http://localhost:3001

  # SSH access
  - hostname: ssh.example.com
    service: ssh://localhost:22

  # Catch-all rule (required — must be last)
  - service: http_status:404
```

### Path-Based Routing

```yaml
ingress:
  - hostname: app.example.com
    path: /api/*
    service: http://localhost:8080

  - hostname: app.example.com
    path: /static/*
    service: http://localhost:9000

  - hostname: app.example.com
    service: http://localhost:3000

  - service: http_status:404
```

### Ingress Rule Options

Each ingress rule supports additional options:

```yaml
ingress:
  - hostname: app.example.com
    service: http://localhost:3000
    originRequest:
      # TLS settings
      noTLSVerify: true            # Skip TLS verification for origin
      originServerName: "internal" # SNI for origin TLS

      # Connection settings
      connectTimeout: 30s
      tcpKeepAlive: 30s
      keepAliveConnections: 10
      keepAliveTimeout: 90s

      # HTTP settings
      httpHostHeader: "internal-app.local"
      disableChunkedEncoding: false

      # Access control
      ipRules:
        - prefix: "192.168.1.0/24"
          allow: true

  - service: http_status:404
```

---

## Practical Examples

### Example 1: Expose a Local Dev Server

The simplest use case -- make your local development server publicly accessible.

```bash
# Start your dev server
npm run dev  # Running on localhost:5173

# In another terminal, create and run a quick tunnel
wrangler tunnel quick-start --url http://localhost:5173
```

You get a URL like `https://random-words.trycloudflare.com` that anyone can access.

### Example 2: Persistent Tunnel with Custom Domain

For a staging environment or persistent dev setup:

```bash
# 1. Create the tunnel
wrangler tunnel create staging

# 2. Route DNS to the tunnel
wrangler tunnel route dns staging staging.example.com

# 3. Run the tunnel
wrangler tunnel run --url http://localhost:3000 staging
```

Now `https://staging.example.com` maps to your local port 3000.

### Example 3: Multi-Service Setup

Expose several local services through one tunnel with a config file:

```bash
# 1. Create tunnel
wrangler tunnel create dev-services

# 2. Create DNS routes for each hostname
wrangler tunnel route dns dev-services app.example.com
wrangler tunnel route dns dev-services api.example.com
wrangler tunnel route dns dev-services admin.example.com
```

Create the config file:

```yaml
# tunnel-config.yml
tunnel: dev-services
credentials-file: /home/user/.cloudflared/TUNNEL_ID.json

ingress:
  - hostname: app.example.com
    service: http://localhost:3000
  - hostname: api.example.com
    service: http://localhost:8080
  - hostname: admin.example.com
    service: http://localhost:3001
  - service: http_status:404
```

```bash
# 3. Run with config
wrangler tunnel run --config tunnel-config.yml dev-services
```

### Example 4: Exposing a Local Database Admin Tool

Securely expose a local pgAdmin or Adminer instance without opening ports:

```bash
# pgAdmin running on localhost:5050
wrangler tunnel create db-admin
wrangler tunnel route dns db-admin db-admin.example.com
wrangler tunnel run --url http://localhost:5050 db-admin
```

Combine with Cloudflare Access to add authentication in front of the tunnel.

### Example 5: Webhook Testing

Receive webhooks from third-party services (Stripe, GitHub, etc.) during local development:

```bash
# Your webhook handler runs on port 8080
wrangler tunnel quick-start --url http://localhost:8080
```

Copy the generated URL and paste it into the third-party service's webhook configuration.

---

## Tips

- **Quick-start vs. named tunnels** -- Use `quick-start` for throwaway dev sessions. Use named tunnels for anything that needs a stable hostname or persistent configuration.
- **Credentials file security** -- The credentials JSON file is a secret. Do not commit it to version control. Add `*.json` under `.cloudflared/` to your `.gitignore`.
- **Catch-all rule** -- The ingress list must always end with a rule that has no `hostname` or `path` matcher. This is typically `http_status:404`.
- **Cloudflare Access** -- Pair tunnels with Cloudflare Access to add identity-aware authentication (SSO, MFA) in front of any exposed service. This is strongly recommended for admin panels and sensitive services.
- **Connection stability** -- By default, `cloudflared` opens multiple connections to different Cloudflare data centers for redundancy. If one connection drops, traffic fails over to another.
- **Protocol selection** -- The default `auto` protocol typically selects QUIC. If your network blocks UDP, use `--protocol http2` to fall back to HTTP/2.
- **Metrics** -- `cloudflared` exposes a local metrics endpoint (default `http://localhost:20241/metrics`) with Prometheus-format metrics for monitoring tunnel health.
- **Running as a service** -- For production, install `cloudflared` as a system service so the tunnel starts automatically on boot.

---

## See Also

- [[Networking]] -- VPC, email routing, and triggers
- [[Containers]] -- Running Docker containers that can be exposed via tunnels
- [[Dynamic-Workers]] -- Multi-tenant Workers that can sit in front of tunnels
