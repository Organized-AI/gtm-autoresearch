# Security

This page covers secrets management, the centralized Secrets Store, and mTLS certificate handling in Wrangler.

See also: [[Versioning-and-Deployments]] for version-specific secrets, [[Configuration-Reference]] for mTLS bindings, [[Workers-Lifecycle]] for deploy commands.

---

## Per-Worker Secrets -- `wrangler secret`

Secrets are encrypted environment variables attached to a specific Worker. They are not visible in your `wrangler.jsonc` or the Cloudflare dashboard (only their names are shown, never values). At runtime, secrets are available on the `env` object alongside bindings and plain-text variables.

### `wrangler secret put`

Sets or updates a secret. Prompts for the value interactively (the value is not echoed to the terminal).

```bash
wrangler secret put <KEY> [flags]
```

| Flag | Description |
|---|---|
| `--name <name>` | Worker name (overrides config) |
| `--env`, `-e` | Environment |

```bash
# Set a secret interactively
wrangler secret put DATABASE_URL
# Enter a secret value: ********

# Pipe from stdin (useful for CI)
echo "postgres://user:pass@host:5432/db" | wrangler secret put DATABASE_URL

# Set a secret for a specific environment
wrangler secret put DATABASE_URL --env staging
```

### `wrangler secret delete`

Deletes a secret from a Worker.

```bash
wrangler secret delete <KEY> [flags]
```

```bash
wrangler secret delete OLD_API_KEY

# Delete from a specific environment
wrangler secret delete OLD_API_KEY --env staging
```

### `wrangler secret list`

Lists the names (never the values) of all secrets for a Worker.

```bash
wrangler secret list [flags]
```

```bash
wrangler secret list
```

Example output:

```
[
  {
    "name": "DATABASE_URL",
    "type": "secret_text"
  },
  {
    "name": "JWT_SECRET",
    "type": "secret_text"
  },
  {
    "name": "STRIPE_KEY",
    "type": "secret_text"
  }
]
```

### `wrangler secret bulk`

Sets multiple secrets at once from a JSON file. This is the most efficient way to set or rotate many secrets.

```bash
wrangler secret bulk <file> [flags]
```

```bash
# Create a secrets file
cat > .secrets.json << 'EOF'
{
  "DATABASE_URL": "postgres://user:newpass@host:5432/db",
  "JWT_SECRET": "new-jwt-secret-value",
  "STRIPE_KEY": "sk_live_new_key_here",
  "SENDGRID_KEY": "SG.new_key_here"
}
EOF

# Apply all secrets at once
wrangler secret bulk .secrets.json

# Apply to a specific environment
wrangler secret bulk .secrets.json --env production
```

> **Warning:** Never commit the secrets JSON file to version control. Add it to `.gitignore`:
>
> ```bash
> echo ".secrets.json" >> .gitignore
> ```

---

## Secret Rotation Example

Here is a complete workflow for rotating secrets across environments.

```bash
# 1. List current secrets to know what needs rotating
wrangler secret list --env production

# 2. Create a file with the new values
cat > .rotate-secrets.json << 'EOF'
{
  "DATABASE_URL": "postgres://user:rotated-password@host:5432/db",
  "JWT_SECRET": "rotated-jwt-secret-2026-04"
}
EOF

# 3. Apply to staging first
wrangler secret bulk .rotate-secrets.json --env staging

# 4. Test staging
wrangler tail --env staging --status error
# Verify no errors for a few minutes

# 5. Apply to production
wrangler secret bulk .rotate-secrets.json --env production

# 6. Monitor production
wrangler tail --env production --status error

# 7. Clean up the secrets file
rm .rotate-secrets.json
```

For Workers using [[Versioning-and-Deployments|gradual rollouts]], you can use `wrangler versions secret put` to set secrets on a specific version before routing traffic to it.

---

## Centralized Secrets Store -- `wrangler secrets-store`

The Secrets Store is a centralized, account-level secrets management system. Unlike per-Worker secrets, a Secrets Store can be shared across multiple Workers via bindings. This is useful for organizations that need centralized credential management.

### Store Management

#### `wrangler secrets-store store create`

Creates a new secrets store.

```bash
wrangler secrets-store store create <store-name> [flags]
```

```bash
wrangler secrets-store store create my-org-secrets
```

#### `wrangler secrets-store store list`

Lists all secrets stores in the account.

```bash
wrangler secrets-store store list
```

Example output:

```
Name              ID                                     Created
my-org-secrets    xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx   2026-04-01T00:00:00Z
shared-creds      yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy   2026-03-15T00:00:00Z
```

#### `wrangler secrets-store store delete`

Deletes a secrets store and all secrets within it.

```bash
wrangler secrets-store store delete <store-name>
```

```bash
wrangler secrets-store store delete old-store
# Prompts for confirmation
```

> **Warning:** Deleting a store removes all secrets within it and breaks any Workers that reference it.

### Secret Management (within a Store)

#### `wrangler secrets-store secret create`

Adds a secret to a store.

```bash
wrangler secrets-store secret create <store-name> <secret-name> [flags]
```

| Flag | Description |
|---|---|
| `--value <value>` | Secret value (if omitted, prompts interactively) |

```bash
# Interactive (value not echoed)
wrangler secrets-store secret create my-org-secrets DB_PASSWORD

# Non-interactive
echo "my-secret-value" | wrangler secrets-store secret create my-org-secrets DB_PASSWORD
```

#### `wrangler secrets-store secret list`

Lists all secrets in a store (names only, not values).

```bash
wrangler secrets-store secret list <store-name>
```

```bash
wrangler secrets-store secret list my-org-secrets
```

Example output:

```
Name              Created                  Updated
DB_PASSWORD       2026-04-01T00:00:00Z     2026-04-20T10:00:00Z
API_KEY           2026-04-01T00:00:00Z     2026-04-01T00:00:00Z
WEBHOOK_SECRET    2026-04-10T00:00:00Z     2026-04-10T00:00:00Z
```

#### `wrangler secrets-store secret get`

Retrieves a secret's value from a store.

```bash
wrangler secrets-store secret get <store-name> <secret-name>
```

```bash
wrangler secrets-store secret get my-org-secrets DB_PASSWORD
# Outputs the secret value to stdout
```

> **Tip:** Pipe to clipboard or other tools:
>
> ```bash
> wrangler secrets-store secret get my-org-secrets DB_PASSWORD | pbcopy
> ```

#### `wrangler secrets-store secret update`

Updates an existing secret's value.

```bash
wrangler secrets-store secret update <store-name> <secret-name> [flags]
```

```bash
# Interactive
wrangler secrets-store secret update my-org-secrets DB_PASSWORD

# Piped
echo "new-password-here" | wrangler secrets-store secret update my-org-secrets DB_PASSWORD
```

#### `wrangler secrets-store secret delete`

Removes a secret from a store.

```bash
wrangler secrets-store secret delete <store-name> <secret-name>
```

```bash
wrangler secrets-store secret delete my-org-secrets OLD_API_KEY
```

#### `wrangler secrets-store secret duplicate`

Copies a secret to another store. Useful for sharing credentials across environments.

```bash
wrangler secrets-store secret duplicate <source-store> <secret-name> <destination-store> [flags]
```

```bash
# Copy a secret from the staging store to the production store
wrangler secrets-store secret duplicate staging-secrets DB_PASSWORD production-secrets
```

### Using a Secrets Store in a Worker

Add the store as a binding in `wrangler.jsonc`:

```jsonc
{
  "secrets_store_bindings": [
    {
      "binding": "SECRETS",
      "store_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ]
}
```

Access in code:

```typescript
export default {
  async fetch(request: Request, env: Env) {
    const dbPassword = await env.SECRETS.get("DB_PASSWORD");
    // Use the password to connect to your database
  },
};
```

---

## mTLS Certificates -- `wrangler cert`

Mutual TLS (mTLS) certificates allow your Worker to authenticate itself when making outbound requests to services that require client certificates. You upload the certificate and private key to Cloudflare, then bind them to your Worker.

### `wrangler cert upload mtls-certificate`

Uploads an mTLS client certificate and private key.

```bash
wrangler cert upload mtls-certificate --cert <path> --key <path> [flags]
```

| Flag | Description |
|---|---|
| `--cert <path>` | Path to the certificate PEM file |
| `--key <path>` | Path to the private key PEM file |
| `--name <name>` | Human-readable name for the certificate |

```bash
wrangler cert upload mtls-certificate \
  --cert ./certs/client.pem \
  --key ./certs/client-key.pem \
  --name "payment-gateway-mtls"
```

Example output:

```
Uploading mTLS certificate...
Certificate ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
Name: payment-gateway-mtls
Issuer: CN=Internal CA
Expires: 2027-04-25T00:00:00Z
```

### `wrangler cert upload certificate-authority`

Uploads a Certificate Authority (CA) certificate. This is used to validate client certificates on inbound requests (when your Worker acts as a server requiring mTLS).

```bash
wrangler cert upload certificate-authority --cert <path> [flags]
```

| Flag | Description |
|---|---|
| `--cert <path>` | Path to the CA certificate PEM file |
| `--name <name>` | Human-readable name |

```bash
wrangler cert upload certificate-authority \
  --cert ./certs/ca.pem \
  --name "internal-ca"
```

### `wrangler cert list`

Lists all uploaded certificates.

```bash
wrangler cert list [flags]
```

```bash
wrangler cert list
```

Example output:

```
ID                                     Name                    Type               Expires
xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx   payment-gateway-mtls    mtls-certificate   2027-04-25
yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy   internal-ca             certificate-authority  2028-01-01
```

### `wrangler cert delete`

Deletes an uploaded certificate.

```bash
wrangler cert delete --id <certificate-id>
```

```bash
wrangler cert delete --id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

> **Warning:** Deleting a certificate that is bound to a Worker will break mTLS-authenticated requests from that Worker. Remove the binding first or update it to point to a new certificate.

---

## Legacy mTLS Commands -- `wrangler mtls-certificate`

These commands are the legacy equivalent of `wrangler cert` and are still functional but deprecated in favor of the `wrangler cert` commands above.

### `wrangler mtls-certificate upload`

```bash
wrangler mtls-certificate upload --cert <path> --key <path> [flags]
```

| Flag | Description |
|---|---|
| `--cert <path>` | Path to the certificate PEM file |
| `--key <path>` | Path to the private key PEM file |
| `--name <name>` | Human-readable name |

```bash
wrangler mtls-certificate upload \
  --cert ./certs/client.pem \
  --key ./certs/client-key.pem \
  --name "legacy-cert"
```

### `wrangler mtls-certificate list`

```bash
wrangler mtls-certificate list
```

### `wrangler mtls-certificate delete`

```bash
wrangler mtls-certificate delete --id <certificate-id>
```

```bash
wrangler mtls-certificate delete --id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

> **Tip:** If you are using `wrangler mtls-certificate` commands, consider migrating to the `wrangler cert` commands. They provide the same functionality with a cleaner interface and support for CA certificates.

---

## mTLS Setup Example

End-to-end example: configure a Worker to authenticate with a payment gateway using mutual TLS.

### Step 1: Generate or obtain certificates

Your payment gateway provider gives you a client certificate and private key, or you generate them from your internal CA:

```bash
# Example: generate a self-signed client cert (for testing only)
openssl req -x509 -newkey rsa:2048 -keyout client-key.pem -out client.pem \
  -days 365 -nodes -subj "/CN=my-worker-client"
```

### Step 2: Upload the certificate

```bash
wrangler cert upload mtls-certificate \
  --cert ./client.pem \
  --key ./client-key.pem \
  --name "payment-gateway-client"
```

Note the certificate ID from the output.

### Step 3: Add the binding to config

```jsonc
// wrangler.jsonc
{
  "name": "payment-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01",
  "mtls_certificates": [
    {
      "binding": "PAYMENT_CERT",
      "certificate_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ]
}
```

### Step 4: Use the certificate in your Worker

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // The PAYMENT_CERT binding provides the client certificate
    // for mutual TLS authentication
    const response = await fetch("https://payments.provider.com/api/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 1000, currency: "USD" }),
      // @ts-ignore -- Cloudflare-specific fetch option
      client: env.PAYMENT_CERT,
    });

    const result = await response.json();
    return Response.json(result);
  },
};
```

### Step 5: Deploy and test

```bash
wrangler deploy

# Monitor for mTLS handshake errors
wrangler tail --status error --search "TLS"
```

### Step 6: Certificate rotation

When the certificate approaches expiration:

```bash
# 1. Upload the new certificate
wrangler cert upload mtls-certificate \
  --cert ./new-client.pem \
  --key ./new-client-key.pem \
  --name "payment-gateway-client-2027"

# 2. Update the certificate_id in wrangler.jsonc to the new ID
# 3. Re-deploy
wrangler deploy

# 4. Verify the new certificate is working
wrangler tail --status error

# 5. Delete the old certificate
wrangler cert delete --id old-certificate-id
```

---

## Tips

- **Secrets are encrypted at rest** and in transit. They are injected into the Worker runtime at execution time and are never logged by Cloudflare.
- **Use `wrangler secret bulk`** for setting up a new environment or rotating multiple secrets. It is atomic -- all secrets are applied together.
- **Never put secrets in `vars`** in your `wrangler.jsonc`. The `vars` field is plain text and visible in your config file and the Cloudflare dashboard. Use `wrangler secret put` for sensitive values.
- **Secrets Store** is best for organizations managing credentials across many Workers. For single-Worker projects, per-Worker secrets (`wrangler secret put`) are simpler.
- **mTLS certificates** should be rotated well before expiration. Set calendar reminders or automate monitoring with `wrangler cert list`.
- **Pipe secrets from a secrets manager** in CI instead of using files:
  ```bash
  vault kv get -field=value secret/worker/db-password | wrangler secret put DATABASE_URL
  ```
- **Separate secrets per environment.** Always specify `--env` when setting secrets so staging and production use different credentials:
  ```bash
  wrangler secret put API_KEY --env staging
  wrangler secret put API_KEY --env production
  ```
