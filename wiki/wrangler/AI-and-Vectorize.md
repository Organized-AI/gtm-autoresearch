# AI and Vectorize

Cloudflare provides serverless AI inference, vector search, AI-powered search, and browser automation — all accessible via Wrangler CLI and Worker bindings.

## Workers AI

Run machine learning models on Cloudflare's global network with zero infrastructure.

### List Available Models

```bash
wrangler ai models
```

Lists all models in the Workers AI catalog (LLMs, image generation, embeddings, speech-to-text, etc.).

### Fine-Tuning

```bash
# Create a fine-tuning job
wrangler ai finetune create --model @cf/meta/llama-3-8b --training-data ./data.jsonl --name my-finetune

# List fine-tuning jobs
wrangler ai finetune list
```

### Binding in wrangler.jsonc

```jsonc
{
  "ai": {
    "binding": "AI"
  }
}
```

### Worker Code

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What is Cloudflare Workers?" }
      ],
      max_tokens: 512,
      temperature: 0.7
    });

    return Response.json(response);
  }
};
```

### Streaming Responses

```typescript
const stream = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
  messages: [{ role: "user", content: "Write a poem" }],
  stream: true
});

return new Response(stream, {
  headers: { "content-type": "text/event-stream" }
});
```

### Embeddings

```typescript
const embeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
  text: ["Cloudflare Workers are great", "Serverless computing at the edge"]
});
// embeddings.data → array of float arrays
```

---

## Vectorize

Globally distributed vector database for similarity search, built for Workers AI embeddings.

### Create an Index

```bash
wrangler vectorize create my-index --dimensions 768 --metric cosine
```

Options:
- `--dimensions` — vector dimensionality (must match your embedding model)
- `--metric` — distance metric: `cosine`, `euclidean`, or `dot-product`

### Manage Indexes

```bash
# List all indexes
wrangler vectorize list

# Get index details
wrangler vectorize get my-index

# View index info (vector count, dimensions, metric)
wrangler vectorize info my-index

# Delete an index
wrangler vectorize delete my-index
```

### Insert and Query Vectors

```bash
# Insert vectors from NDJSON file
wrangler vectorize insert my-index --file vectors.ndjson

# Upsert (insert or update)
wrangler vectorize upsert my-index --file vectors.ndjson

# Query for similar vectors
wrangler vectorize query my-index --vector "[0.1, 0.2, ...]" --top-k 10

# Get specific vectors by ID
wrangler vectorize get-vectors my-index --ids "id1,id2,id3"

# Delete vectors
wrangler vectorize delete-vectors my-index --ids "id1,id2"

# List vectors
wrangler vectorize list-vectors my-index
```

NDJSON format for vectors:

```json
{"id": "doc-1", "values": [0.1, 0.2, 0.3, ...], "metadata": {"title": "Example", "category": "docs"}}
{"id": "doc-2", "values": [0.4, 0.5, 0.6, ...], "metadata": {"title": "Another", "category": "blog"}}
```

### Metadata Indexes

Speed up filtered queries by indexing metadata fields:

```bash
# Create a metadata index on a string field
wrangler vectorize create-metadata-index my-index --property-name category --type string

# Create on a numeric field
wrangler vectorize create-metadata-index my-index --property-name year --type number

# List metadata indexes
wrangler vectorize list-metadata-index my-index

# Delete a metadata index
wrangler vectorize delete-metadata-index my-index --property-name category
```

### Binding in wrangler.jsonc

```jsonc
{
  "vectorize": [
    {
      "binding": "VECTORIZE",
      "index_name": "my-index"
    }
  ]
}
```

### Worker Code — Insert and Query

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Generate embeddings
    const text = "How do Workers handle requests?";
    const embedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [text] });

    // Query similar vectors
    const results = await env.VECTORIZE.query(embedding.data[0], {
      topK: 5,
      returnMetadata: "all",
      filter: { category: "docs" }
    });

    return Response.json(results);
  }
};
```

### Insert Vectors from Worker

```typescript
const vectors = [
  {
    id: "doc-1",
    values: embedding.data[0],
    metadata: { title: "Workers Guide", category: "docs", url: "/workers" }
  }
];

await env.VECTORIZE.upsert(vectors);
```

---

## AI Search

Managed search indexes with AI-powered semantic understanding.

### Manage Indexes

```bash
# Create an AI Search index
wrangler ai-search create my-search --description "Product catalog search"

# List indexes
wrangler ai-search list

# Get index details
wrangler ai-search get my-search

# Update index
wrangler ai-search update my-search --description "Updated description"

# Delete index
wrangler ai-search delete my-search
```

### Search and Stats

```bash
# Execute a search query
wrangler ai-search search my-search --query "serverless deployment"

# View index statistics
wrangler ai-search stats my-search
```

---

## Browser Rendering

Headless browser sessions running on Cloudflare for screenshots, PDF generation, and web scraping.

### Manage Sessions

```bash
# Create a browser session
wrangler browser create

# List active sessions
wrangler browser list

# View a session
wrangler browser view <session-id>

# Close a session
wrangler browser close <session-id>
```

### Binding in wrangler.jsonc

```jsonc
{
  "browser": {
    "binding": "BROWSER"
  }
}
```

### Worker Code — Screenshot

```typescript
import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.goto("https://example.com");

    const screenshot = await page.screenshot({ type: "png" });
    await browser.close();

    return new Response(screenshot, {
      headers: { "content-type": "image/png" }
    });
  }
};
```

---

## End-to-End Example: RAG with Workers AI + Vectorize

A complete Retrieval-Augmented Generation pipeline:

### 1. Setup

```bash
wrangler init rag-worker
cd rag-worker

# Create vector index (768 dims for bge-base-en)
wrangler vectorize create rag-index --dimensions 768 --metric cosine
wrangler vectorize create-metadata-index rag-index --property-name source --type string
```

### 2. Configuration

```jsonc
// wrangler.jsonc
{
  "name": "rag-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "ai": {
    "binding": "AI"
  },
  "vectorize": [
    {
      "binding": "VECTORIZE",
      "index_name": "rag-index"
    }
  ]
}
```

### 3. Worker Code

```typescript
interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ingest" && request.method === "POST") {
      return handleIngest(request, env);
    }

    if (url.pathname === "/ask" && request.method === "POST") {
      return handleAsk(request, env);
    }

    return new Response("RAG API: POST /ingest or POST /ask", { status: 200 });
  }
};

async function handleIngest(request: Request, env: Env): Promise<Response> {
  const { documents } = await request.json<{
    documents: Array<{ id: string; text: string; source: string }>;
  }>();

  const texts = documents.map((d) => d.text);
  const embeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: texts });

  const vectors = documents.map((doc, i) => ({
    id: doc.id,
    values: embeddings.data[i],
    metadata: { source: doc.source, text: doc.text.slice(0, 500) }
  }));

  await env.VECTORIZE.upsert(vectors);
  return Response.json({ ingested: vectors.length });
}

async function handleAsk(request: Request, env: Env): Promise<Response> {
  const { question } = await request.json<{ question: string }>();

  // 1. Embed the question
  const queryEmbedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [question]
  });

  // 2. Find relevant documents
  const results = await env.VECTORIZE.query(queryEmbedding.data[0], {
    topK: 3,
    returnMetadata: "all"
  });

  const context = results.matches
    .map((m) => m.metadata?.text || "")
    .join("\n\n");

  // 3. Generate answer with context
  const answer = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [
      {
        role: "system",
        content: `Answer based on this context:\n\n${context}`
      },
      { role: "user", content: question }
    ],
    max_tokens: 512
  });

  return Response.json({
    answer: answer.response,
    sources: results.matches.map((m) => ({
      id: m.id,
      score: m.score,
      source: m.metadata?.source
    }))
  });
}
```

### 4. Deploy

```bash
wrangler deploy
```

### 5. Test

```bash
# Ingest documents
curl -X POST https://rag-worker.your-subdomain.workers.dev/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      {"id": "doc-1", "text": "Workers run on Cloudflare edge network...", "source": "docs"},
      {"id": "doc-2", "text": "KV is a global key-value store...", "source": "docs"}
    ]
  }'

# Ask a question
curl -X POST https://rag-worker.your-subdomain.workers.dev/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "How does Workers KV work?"}'
```

---

## Tips

- **Model selection**: Use `wrangler ai models` to browse available models — filter by task (text-generation, embeddings, image-classification)
- **Vectorize dimensions**: Must match your embedding model output (bge-base = 768, bge-small = 384, bge-large = 1024)
- **Metadata filtering**: Index frequently-filtered fields for performance; Vectorize supports string, number, and boolean metadata types
- **Cost**: Workers AI has a generous free tier; Vectorize charges per stored vector and per query
- **Local dev**: `wrangler dev` supports AI and Vectorize bindings locally via `--remote` flag (runs inference on Cloudflare's network)

---

See also: [[KV]], [[R2]], [[D1]], [[Workers-Lifecycle]], [[Configuration-Reference]]
