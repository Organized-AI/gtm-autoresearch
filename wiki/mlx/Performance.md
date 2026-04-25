# Performance

Memory requirements, benchmarks, and optimization tips for MLX on Apple Silicon.

## Memory Requirements

### Model Size by Quantization

| Parameters | fp16 | 8-bit | 4-bit |
|---|---|---|---|
| 1B | ~2 GB | ~1 GB | ~0.6 GB |
| 3B | ~6 GB | ~3 GB | ~1.8 GB |
| 4B | ~8 GB | ~4 GB | ~2.5 GB |
| 7-8B | ~16 GB | ~8 GB | ~4.5 GB |
| 12-13B | ~26 GB | ~13 GB | ~7.5 GB |
| 27B | ~54 GB | ~27 GB | ~15 GB |
| 70B | ~140 GB | ~70 GB | ~38 GB |

These are base model weights only. Add overhead for:
- **KV cache**: ~0.5-2 GB for typical context lengths (2K-8K tokens)
- **Runtime overhead**: ~0.5-1 GB for MLX framework
- **System**: macOS needs ~2-4 GB for itself

### KV Cache Growth

KV cache memory scales linearly with context length:

| Context Length | 4B model | 12B model | 27B model |
|---|---|---|---|
| 2K tokens | ~0.2 GB | ~0.4 GB | ~0.8 GB |
| 8K tokens | ~0.8 GB | ~1.6 GB | ~3.2 GB |
| 32K tokens | ~3.2 GB | ~6.4 GB | ~12.8 GB |
| 128K tokens | ~12.8 GB | ~25.6 GB | ~51.2 GB |

## What Fits Where

| Chip | Max RAM | Largest Model (4-bit) | Comfortable (with context headroom) |
|---|---|---|---|
| M1 / M2 (8 GB) | 8 GB | 4B | 1B-3B |
| M1 / M2 (16 GB) | 16 GB | 12B | 4B-8B |
| M2 Pro (16 GB) | 16 GB | 12B | 4B-8B |
| M2 Pro (32 GB) | 32 GB | 27B | 12B-13B |
| M3 Pro (18 GB) | 18 GB | 12B | 8B |
| M3 Pro (36 GB) | 36 GB | 27B | 12B-13B |
| M3 Max (48 GB) | 48 GB | 27B (8-bit) | 27B (4-bit) |
| M3 Max (96 GB) | 96 GB | 70B | 27B (fp16) |
| M4 (16 GB) | 16 GB | 12B | 4B-8B |
| M4 Pro (24 GB) | 24 GB | 27B (4-bit, tight) | 12B |
| M4 Pro (48 GB) | 48 GB | 27B (8-bit) | 27B (4-bit) |
| M4 Max (64 GB) | 64 GB | 70B (4-bit, tight) | 27B (8-bit) |
| M4 Max (128 GB) | 128 GB | 70B (8-bit) | 70B (4-bit) |

## Tokens Per Second Benchmarks

Approximate generation speed (tokens/second) for 4-bit quantized models:

| Model (4-bit) | M1 Pro (16 GB) | M3 Pro (36 GB) | M3 Max (96 GB) | M4 Max (128 GB) |
|---|---|---|---|---|
| Gemma 3 1B | ~80 | ~100 | ~120 | ~140 |
| Gemma 3 4B | ~35 | ~50 | ~65 | ~80 |
| Llama 3.1 8B | ~20 | ~35 | ~50 | ~65 |
| Gemma 3 12B | ~12 | ~20 | ~30 | ~40 |
| Gemma 3 27B | — | ~8 | ~15 | ~22 |
| Llama 3.1 70B | — | — | ~5 | ~10 |

Prompt processing (prefill) is typically 2-5x faster than generation. Performance varies with context length — longer contexts are slower.

## Optimization Techniques

### JIT Compilation

```python
import mlx.core as mx

@mx.compile
def forward_pass(model, inputs):
    return model(inputs)
```

`mx.compile` traces and optimizes the computation graph. First call is slower (compilation), subsequent calls are faster.

### Quantization Tradeoffs

| Quantization | Size | Speed | Quality |
|---|---|---|---|
| fp16 | 100% | Baseline | Best |
| 8-bit | 50% | ~Same | Near-identical |
| 4-bit | 25% | Slightly faster | Minor degradation |

4-bit is the sweet spot for most use cases. Quality difference is noticeable mainly on:
- Complex reasoning tasks
- Code generation
- Mathematical proofs
- Very long outputs

### Prompt Caching

Reuse KV cache for prompts with shared prefixes:

```python
from mlx_lm import load, generate

model, tokenizer = load("mlx-community/gemma-3-4b-it-4bit")

# First call builds KV cache for the system prompt
system = "You are a GTM optimization expert.\n\n"

# Subsequent calls with same prefix reuse the cache
for question in questions:
    response = generate(
        model, tokenizer,
        prompt=system + question,
        max_tokens=256
    )
```

### Memory Monitoring

```python
import mlx.core as mx

# Check current memory usage
active = mx.metal.get_active_memory() / 1e9
print(f"Active memory: {active:.2f} GB")

# Check peak memory
peak = mx.metal.get_peak_memory() / 1e9
print(f"Peak memory: {peak:.2f} GB")

# Reset peak tracking
mx.metal.reset_peak_memory()

# Set memory limit (optional — prevents system swap)
mx.metal.set_memory_limit(16 * 1024**3)  # 16 GB
```

### Reducing Memory During Fine-Tuning

```bash
python -m mlx_lm.lora \
  --model mlx-community/gemma-3-4b-it-4bit \
  --data ./data \
  --train \
  --batch-size 1 \            # Reduce batch size
  --max-seq-length 1024 \     # Reduce sequence length
  --grad-checkpoint \          # Trade compute for memory
  --lora-rank 8               # Lower rank = less memory
```

## Comparison: MLX vs llama.cpp vs Ollama

| Feature | MLX | llama.cpp | Ollama |
|---|---|---|---|
| **Runtime** | Python/Swift | C/C++ | Go + llama.cpp |
| **Platform** | Apple Silicon only | Cross-platform | Cross-platform |
| **Memory model** | Unified (no copies) | Explicit Metal/CUDA | Wraps llama.cpp |
| **Speed (Apple)** | Fastest | Close second | Same as llama.cpp |
| **Speed (NVIDIA)** | N/A | Fast (CUDA) | Fast (CUDA) |
| **Fine-tuning** | LoRA built-in | Limited | No |
| **API server** | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible |
| **Model format** | safetensors + config | GGUF | GGUF |
| **Quantization** | 4/8-bit | 2-8 bit (more options) | 2-8 bit |
| **Ecosystem** | Python ML (NumPy-like) | CLI-focused | User-friendly CLI |
| **Best for** | ML research + Apple dev | Production + portability | Easy setup |

### When to Choose MLX

- You're on Apple Silicon and want maximum performance
- You need fine-tuning (LoRA/QLoRA)
- You want a Python-native workflow (NumPy-like API)
- You're building custom models or research

### When to Choose llama.cpp / Ollama

- You need cross-platform support (Linux servers, NVIDIA GPUs)
- You want the widest model compatibility (GGUF ecosystem)
- You prefer a simple CLI (`ollama run gemma3`)
- You need advanced quantization options (Q2, Q3, Q5, Q6)

## Batch Inference

For processing multiple prompts efficiently:

```python
from mlx_lm import load, generate

model, tokenizer = load("mlx-community/gemma-3-4b-it-4bit")

prompts = [
    "What is tag coverage?",
    "Explain consent mode v2.",
    "What is CAPI deduplication?"
]

results = []
for prompt in prompts:
    response = generate(model, tokenizer, prompt=prompt, max_tokens=256)
    results.append(response)
```

The model stays loaded between calls — no reload overhead. Each generation reuses the model weights already in unified memory.

## Tips

- **Close other apps**: Apple Silicon shares memory between CPU and GPU. Browser tabs and other apps compete for the same RAM.
- **Monitor Activity Monitor**: Watch "Memory Pressure" — yellow/red means swap, which kills performance.
- **Start small**: Try 4-bit quantization first. Only increase precision if quality is insufficient for your task.
- **Shorter context = faster**: If you don't need the full context window, keep prompts concise.
- **Metal performance**: MLX uses Metal for GPU compute. Ensure no other Metal-heavy apps (games, video editors) are running.

---

See also: [[MLX-Core]], [[Gemma-4-on-MLX]], [[Fine-Tuning]], [[Serving]]
