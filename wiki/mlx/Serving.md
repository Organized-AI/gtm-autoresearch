# Serving MLX Models

Run a local OpenAI-compatible API server using `mlx-lm` for inference.

## Quick Start

```bash
python -m mlx_lm.server --model mlx-community/gemma-3-4b-it-4bit
```

Server starts on `http://localhost:8080` with OpenAI-compatible endpoints.

## Server Options

```bash
python -m mlx_lm.server \
  --model mlx-community/gemma-3-4b-it-4bit \
  --host 0.0.0.0 \
  --port 8080 \
  --adapter-path ./adapters \       # Optional: load LoRA adapters
  --trust-remote-code               # For models with custom code
```

| Flag | Default | Description |
|---|---|---|
| `--model` | — | Model path or HuggingFace ID |
| `--host` | `127.0.0.1` | Host to bind to |
| `--port` | `8080` | Port to bind to |
| `--adapter-path` | — | Path to LoRA adapters |
| `--trust-remote-code` | false | Trust custom model code from HuggingFace |

## API Endpoints

### POST /v1/chat/completions

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma-3-4b-it",
    "messages": [
      {"role": "system", "content": "You are a GTM specialist."},
      {"role": "user", "content": "What is Consent Mode v2?"}
    ],
    "max_tokens": 256,
    "temperature": 0.7,
    "stream": false
  }'
```

### POST /v1/completions

```bash
curl http://localhost:8080/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma-3-4b-it",
    "prompt": "Server-side tagging is",
    "max_tokens": 128,
    "temperature": 0.5
  }'
```

### GET /v1/models

```bash
curl http://localhost:8080/v1/models
```

Returns the loaded model name and metadata.

## Python Client (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="not-needed"  # mlx-lm doesn't require auth
)

response = client.chat.completions.create(
    model="gemma-3-4b-it",
    messages=[
        {"role": "system", "content": "You are a marketing analytics expert."},
        {"role": "user", "content": "Explain Event Match Quality scoring."}
    ],
    max_tokens=512,
    temperature=0.7
)

print(response.choices[0].message.content)
```

## Streaming

### curl

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma-3-4b-it",
    "messages": [{"role": "user", "content": "Explain CAPI deduplication."}],
    "max_tokens": 256,
    "stream": true
  }'
```

### Python

```python
stream = client.chat.completions.create(
    model="gemma-3-4b-it",
    messages=[{"role": "user", "content": "What is server-side GTM?"}],
    max_tokens=256,
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()
```

## Serving with LoRA Adapters

```bash
python -m mlx_lm.server \
  --model mlx-community/gemma-3-4b-it-4bit \
  --adapter-path ./gtm-adapters \
  --port 8080
```

The adapter is applied automatically to all requests.

## Serving a Fused Model

```bash
# Fuse first
python -m mlx_lm.fuse \
  --model mlx-community/gemma-3-4b-it-4bit \
  --adapter-path ./adapters \
  --save-path ./fused-model

# Serve the fused model
python -m mlx_lm.server --model ./fused-model
```

## Running Behind a Reverse Proxy

### nginx Configuration

```nginx
upstream mlx_server {
    server 127.0.0.1:8080;
}

server {
    listen 443 ssl;
    server_name llm.example.com;

    ssl_certificate /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    location /v1/ {
        proxy_pass http://mlx_server;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;           # Required for streaming
        proxy_cache off;
        proxy_read_timeout 300s;       # Long timeout for generation
    }
}
```

### Cloudflare Tunnel

Expose the local server via Cloudflare Tunnel (no port forwarding needed):

```bash
# In terminal 1: start the model server
python -m mlx_lm.server --model mlx-community/gemma-3-4b-it-4bit --port 8080

# In terminal 2: expose via tunnel
wrangler tunnel quick-start --url http://localhost:8080
```

## Integration Example

Using the local MLX server as a mutation provider for the GTM autoresearch loop:

```typescript
// In run-gtm-loop.ts — use local MLX model instead of Claude CLI
async function mutateWithLocalModel(
  config: string,
  prompt: string
): Promise<string> {
  const response = await fetch("http://localhost:8080/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemma-3-4b-it",
      messages: [
        { role: "system", content: "You are a GTM container optimization expert..." },
        { role: "user", content: `${prompt}\n\nCurrent config:\n${config}` }
      ],
      max_tokens: 4096,
      temperature: 0.3
    })
  });

  const data = await response.json();
  return data.choices[0].message.content;
}
```

## Tips

- **Memory**: The model stays loaded in memory. Ensure you have enough RAM for the model + KV cache for concurrent requests.
- **Concurrency**: mlx-lm server handles requests sequentially. For parallel requests, run multiple server instances on different ports.
- **Model swap**: To switch models, restart the server. There's no hot-reload.
- **Health check**: Use `GET /v1/models` as a health check endpoint.
- **Quantized models**: Serve 4-bit models for faster response times and lower memory usage with minimal quality loss.

---

See also: [[MLX-LM]], [[Gemma-4-on-MLX]], [[Fine-Tuning]], [[Performance]]
