# Versioning and Deployments

Wrangler v4 supports **gradual rollouts** for Workers. Instead of deploying new code instantly to 100% of traffic, you can upload a new version, route a fraction of traffic to it, monitor, and then promote it -- or roll back.

This page covers the `wrangler versions`, `wrangler deployments`, and `wrangler rollback` commands.

See also: [[Workers-Lifecycle]] for standard deploy, [[Security]] for version-specific secrets.

---

## Concepts

- **Version**: An immutable snapshot of your Worker code and configuration. Uploading a version does not serve traffic. Think of it as a release candidate.
- **Deployment**: A mapping of one or more versions to traffic percentages. A deployment says "send 10% of traffic to version A and 90% to version B."
- **Rollback**: Reverting to a previous deployment configuration.

The typical gradual rollout flow:

```
upload version -> deploy at 10% -> monitor -> deploy at 50% -> monitor -> deploy at 100%
```

---

## `wrangler versions` -- Manage Versions

### `wrangler versions upload`

Uploads a new version of your Worker **without deploying it**. The version is built and stored but receives no traffic until you explicitly deploy it.

```bash
wrangler versions upload [flags]
```

| Flag | Description |
|---|---|
| `--tag <tag>` | A human-readable tag for this version (e.g., `v2.3.1`) |
| `--message <msg>` | A description of what changed in this version |
| `--name <name>` | Worker name (overrides config) |
| `--env`, `-e` | Environment to target |
| `--dry-run` | Build and validate without uploading |

```bash
# Upload a new version with a tag and message
wrangler versions upload --tag "v2.3.1" --message "Fix payment webhook timeout"

# Upload without metadata
wrangler versions upload

# Dry run to validate the build
wrangler versions upload --dry-run
```

Example output:

```
Worker Version ID: 12345678-abcd-1234-efgh-567890abcdef
Tag: v2.3.1
Message: Fix payment webhook timeout
Uploaded: 2026-04-25T10:30:00Z
```

### `wrangler versions list`

Lists all versions of a Worker, ordered by upload time.

```bash
wrangler versions list [flags]
```

| Flag | Description |
|---|---|
| `--name <name>` | Worker name |
| `--env`, `-e` | Environment |

```bash
wrangler versions list
```

Example output:

```
Version ID                            Tag       Message                        Created
12345678-abcd-1234-efgh-567890abcdef  v2.3.1    Fix payment webhook timeout    2026-04-25T10:30:00Z
87654321-dcba-4321-hgfe-0987654321ba  v2.3.0    Add retry logic to cart API    2026-04-24T15:00:00Z
aabbccdd-1122-3344-5566-778899aabbcc  v2.2.0    Initial release                2026-04-20T09:00:00Z
```

### `wrangler versions view`

Shows detailed information about a specific version, including its bindings, compatibility date, and source metadata.

```bash
wrangler versions view <version-id> [flags]
```

```bash
wrangler versions view 12345678-abcd-1234-efgh-567890abcdef
```

Example output:

```
Version ID:         12345678-abcd-1234-efgh-567890abcdef
Tag:                v2.3.1
Message:            Fix payment webhook timeout
Created:            2026-04-25T10:30:00Z
Compatibility Date: 2025-04-01
Bindings:
  - KV Namespace: MY_KV (id: abc123)
  - D1 Database: MY_DB (id: def456)
```

### `wrangler versions deploy`

Creates a deployment that routes traffic to one or more versions. This is the command you use to perform gradual rollouts.

```bash
wrangler versions deploy [flags]
```

When run interactively, Wrangler prompts you to select versions and assign traffic percentages. You can also supply them non-interactively.

```bash
# Interactive: prompts you to choose versions and percentages
wrangler versions deploy

# Non-interactive example (see gradual rollout below)
wrangler versions deploy \
  12345678-abcd-1234-efgh-567890abcdef@10% \
  87654321-dcba-4321-hgfe-0987654321ba@90%
```

Traffic percentages must add up to 100%.

---

## Gradual Rollout Example

Here is a complete example of gradually rolling out a new Worker version.

### Step 1: Upload the new version

```bash
wrangler versions upload --tag "v2.4.0" --message "New caching strategy"
# Version ID: aaaa1111-bbbb-2222-cccc-dddd3333eeee
```

### Step 2: Deploy at 10%

Route 10% of traffic to the new version while 90% stays on the current version.

```bash
wrangler versions deploy \
  aaaa1111-bbbb-2222-cccc-dddd3333eeee@10% \
  87654321-dcba-4321-hgfe-0987654321ba@90%
```

### Step 3: Monitor

Use `wrangler tail` or your analytics dashboard to verify the new version is working correctly.

```bash
# Tail logs, filtering for errors
wrangler tail --status error
```

Check the deployment status:

```bash
wrangler deployments status
```

### Step 4: Increase to 50%

```bash
wrangler versions deploy \
  aaaa1111-bbbb-2222-cccc-dddd3333eeee@50% \
  87654321-dcba-4321-hgfe-0987654321ba@50%
```

### Step 5: Monitor again

```bash
wrangler tail --status error --sampling-rate 0.5
wrangler deployments status
```

### Step 6: Promote to 100%

```bash
wrangler versions deploy \
  aaaa1111-bbbb-2222-cccc-dddd3333eeee@100%
```

The new version now handles all traffic. The previous version remains available for rollback.

### If something goes wrong: Roll back

```bash
wrangler rollback
# Reverts to the previous deployment configuration
```

---

## `wrangler deployments` -- View Deployment History

### `wrangler deployments list`

Lists all deployments for a Worker, showing which versions received traffic and when.

```bash
wrangler deployments list [flags]
```

| Flag | Description |
|---|---|
| `--name <name>` | Worker name |
| `--env`, `-e` | Environment |

```bash
wrangler deployments list
```

Example output:

```
Deployment ID                         Created                  Versions
dep-001                               2026-04-25T12:00:00Z     aaaa1111@100%
dep-002                               2026-04-25T11:30:00Z     aaaa1111@50%, 87654321@50%
dep-003                               2026-04-25T11:00:00Z     aaaa1111@10%, 87654321@90%
dep-004                               2026-04-24T15:00:00Z     87654321@100%
```

### `wrangler deployments status`

Shows the current active deployment -- which versions are serving traffic right now.

```bash
wrangler deployments status
```

Example output:

```
Current Deployment ID: dep-001
Created: 2026-04-25T12:00:00Z

Traffic Split:
  Version aaaa1111-bbbb-2222-cccc-dddd3333eeee (v2.4.0): 100%
```

### `wrangler deployments view`

Shows detailed information about a specific deployment.

```bash
wrangler deployments view <deployment-id>
```

```bash
wrangler deployments view dep-002
```

---

## `wrangler rollback` -- Revert to a Previous Version

Rolls back to the previous deployment configuration. This is a fast operation -- it does not re-upload code, it simply changes the traffic routing.

```bash
wrangler rollback [version-id] [flags]
```

| Flag | Description |
|---|---|
| `--message <msg>` | Reason for rollback |
| `--name <name>` | Worker name |
| `--env`, `-e` | Environment |

### Examples

```bash
# Roll back to the previous deployment (one step back)
wrangler rollback

# Roll back to a specific version
wrangler rollback 87654321-dcba-4321-hgfe-0987654321ba

# Roll back with a message for audit trail
wrangler rollback --message "Elevated error rate after v2.4.0 deploy"
```

> **Tip:** Rollback restores the **deployment configuration**, not just the code. If the previous deployment had a traffic split (e.g., 50/50), rolling back restores that same split. If you need to go back to a single version at 100%, specify the version ID explicitly.

---

## Version-Specific Secrets

When using gradual rollouts, you may need different secret values for different versions (e.g., testing a new API key with the canary version). Wrangler supports managing secrets per version.

### `wrangler versions secret put`

Sets a secret for a specific version (or the next version to be uploaded).

```bash
wrangler versions secret put <KEY> [flags]
```

| Flag | Description |
|---|---|
| `--name <name>` | Worker name |
| `--env`, `-e` | Environment |

```bash
# Set a secret (prompts for value interactively)
wrangler versions secret put API_KEY

# Pipe from stdin
echo "sk-newkey-12345" | wrangler versions secret put API_KEY
```

### `wrangler versions secret bulk`

Sets multiple secrets at once from a JSON file.

```bash
wrangler versions secret bulk <file> [flags]
```

```bash
# Create a JSON file with secrets
cat secrets.json
{
  "API_KEY": "sk-newkey-12345",
  "DB_PASSWORD": "supersecret",
  "WEBHOOK_SECRET": "whsec_abcdef"
}

# Apply all secrets
wrangler versions secret bulk secrets.json
```

> **Warning:** Never commit `secrets.json` to version control. Add it to `.gitignore`.

### `wrangler versions secret delete`

Removes a secret from the version configuration.

```bash
wrangler versions secret delete <KEY> [flags]
```

```bash
wrangler versions secret delete OLD_API_KEY
```

### `wrangler versions secret list`

Lists the names (not values) of all secrets for the current version.

```bash
wrangler versions secret list [flags]
```

```bash
wrangler versions secret list
```

Example output:

```
Secret Name
API_KEY
DB_PASSWORD
WEBHOOK_SECRET
```

---

## Tips

- **Upload first, deploy later.** The `versions upload` + `versions deploy` workflow decouples building from traffic routing. This is safer than `wrangler deploy`, which does both at once.
- **Always tag your versions.** Tags like `v2.4.0` or `hotfix-payment-bug` make `versions list` output much easier to read and reason about.
- **Monitor between traffic steps.** Gradual rollouts only help if you actually check metrics between steps. Use `wrangler tail`, Cloudflare Analytics, or external monitoring.
- **Rollback is instant.** It re-points traffic routing without re-uploading code. Keep previous versions available as an escape hatch.
- **Standard `wrangler deploy` still works.** If you do not need gradual rollouts, `wrangler deploy` uploads and deploys at 100% in a single step. The versioning system is opt-in.
- **Version-specific secrets** are useful for testing new third-party API keys or credentials alongside the canary version before promoting.
