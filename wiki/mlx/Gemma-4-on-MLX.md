# Running Gemma 4 on MLX

This is the definitive guide for running Google's Gemma 4 model family on Apple Silicon using MLX. Gemma 4 represents the latest generation of Google's open-weight language models, and MLX provides an efficient way to run these models locally on Mac hardware.

---

## Table of Contents

- [Gemma 4 Overview](#gemma-4-overview)
- [Prerequisites](#prerequisites)
- [Loading Gemma 4 via mlx-lm](#loading-gemma-4-via-mlx-lm)
- [Converting from HuggingFace](#converting-from-huggingface)
- [Prompt Format and Chat Template](#prompt-format-and-chat-template)
- [Generation Examples](#generation-examples)
- [Generation Parameters](#generation-parameters)
- [Memory Requirements](#memory-requirements)
- [Performance Benchmarks](#performance-benchmarks)
- [Multimodal Usage](#multimodal-usage)
- [Comparison: Gemma 4 vs Llama 3 vs Phi-4](#comparison-gemma-4-vs-llama-3-vs-phi-4)
- [Tips and Best Practices](#tips-and-best-practices)

---

## Gemma 4 Overview

Gemma 4 is Google DeepMind's latest family of open-weight language models. Key characteristics:

- **Model sizes**: Available in multiple sizes (check [HuggingFace google collection](https://huggingface.co/google) for the latest). The family typically includes smaller efficient variants and larger high-capability models.
- **Architecture**: Decoder-only transformer with SwiGLU activations, RMSNorm, RoPE positional embeddings, and grouped-query attention (GQA).
- **Multimodal**: Gemma 4 includes vision-language variants that accept both text and image inputs.
- **Training**: Trained on a large, diverse corpus of web, code, math, and multilingual data.
- **License**: Open-weight under Google's Gemma license, permitting commercial use with certain conditions.
- **Context window**: Extended context lengths (8K to 128K tokens depending on variant).

### Gemma Family Evolution

| Generation | Key Models | Notable Features |
|---|---|---|
| Gemma 1 | 2B, 7B | First open Gemma release |
| Gemma 2 | 2B, 9B, 27B | Sliding window attention, improved quality |
| Gemma 3 | 1B, 4B, 12B, 27B | Multimodal (vision), longer context |
| Gemma 4 | Various sizes | Latest generation, expanded multimodal |

---

## Prerequisites

### Install Required Packages

```bash
# Install mlx-lm (includes mlx as dependency)
pip install mlx-lm

# For multimodal models, you may also need
pip install pillow

# Verify
python -c "from mlx_lm import load; print('Ready')"
```

### Hardware Requirements

- Apple Silicon Mac (M1, M2, M3, or M4 -- any variant)
- Minimum 8 GB unified memory (for small quantized models)
- 16 GB+ recommended for 7B+ models
- 32 GB+ recommended for 12B+ models
- macOS 13.5 or later

---

## Loading Gemma 4 via mlx-lm

### Pre-converted Models from mlx-community

The easiest path. Check [huggingface.co/mlx-community](https://huggingface.co/mlx-community) for pre-converted Gemma 4 models:

```python
from mlx_lm import load, generate

# Load a 4-bit quantized Gemma 4 model
# (Replace with actual model name from mlx-community)
model, tokenizer = load("mlx-community/gemma-4-12b-it-4bit")

# Generate text
response = generate(
    model,
    tokenizer,
    prompt="Explain the theory of relativity in simple terms.",
    max_tokens=300
)
print(response)
```

### Finding Available Models

Search for Gemma 4 MLX models on HuggingFace:

```bash
# Search HuggingFace for MLX Gemma 4 models
pip install huggingface_hub
python -c "
from huggingface_hub import HfApi
api = HfApi()
models = api.list_models(search='gemma-4 mlx', sort='downloads', direction=-1)
for m in models:
    print(f'{m.id} ({m.downloads} downloads)')
"
```

Common naming patterns on mlx-community:
- `mlx-community/gemma-4-{size}-it-4bit` (4-bit quantized, instruct-tuned)
- `mlx-community/gemma-4-{size}-it-8bit` (8-bit quantized, instruct-tuned)
- `mlx-community/gemma-4-{size}-it` (fp16, instruct-tuned)
- `mlx-community/gemma-4-{size}-pt-4bit` (4-bit quantized, pre-trained base)

---

## Converting from HuggingFace

If no pre-converted MLX version exists, convert the original HuggingFace model yourself:

### 4-bit Quantization (Recommended for Most Users)

```bash
python -m mlx_lm.convert \
    --hf-path google/gemma-4-12b-it \
    --mlx-path ./gemma4-12b-it-4bit \
    -q \
    --q-bits 4 \
    --q-group-size 64
```

### 8-bit Quantization (Better Quality)

```bash
python -m mlx_lm.convert \
    --hf-path google/gemma-4-12b-it \
    --mlx-path ./gemma4-12b-it-8bit \
    -q \
    --q-bits 8
```

### Full Precision (fp16)

```bash
python -m mlx_lm.convert \
    --hf-path google/gemma-4-12b-it \
    --mlx-path ./gemma4-12b-it-fp16
```

### Conversion Notes

- You need a HuggingFace account and must accept the Gemma license agreement on the model page before downloading.
- Set your HuggingFace token: `huggingface-cli login`
- Conversion downloads the full model first, then converts. Ensure you have enough disk space (roughly 2x the model size during conversion).
- The converted model directory will contain safetensors weight files, tokenizer files, and a config.json.

### Upload Your Conversion

```bash
# Share with the community
python -m mlx_lm.convert \
    --hf-path google/gemma-4-12b-it \
    --mlx-path ./gemma4-12b-it-4bit \
    -q --q-bits 4 \
    --upload-repo your-username/gemma-4-12b-it-4bit-mlx
```

---

## Prompt Format and Chat Template

Gemma models use a specific chat template with turn markers. The instruct-tuned models expect this format.

### Gemma Chat Format

```
<start_of_turn>user
What is the meaning of life?<end_of_turn>
<start_of_turn>model
```

### With System Instructions (Gemma 3/4)

Gemma 3 and 4 support system instructions:

```
<start_of_turn>system
You are a helpful and concise assistant.<end_of_turn>
<start_of_turn>user
What is machine learning?<end_of_turn>
<start_of_turn>model
```

### Multi-turn Conversation

```
<start_of_turn>user
What is Python?<end_of_turn>
<start_of_turn>model
Python is a high-level, interpreted programming language known for its readability and versatility.<end_of_turn>
<start_of_turn>user
How does it compare to Rust?<end_of_turn>
<start_of_turn>model
```

### Using the Tokenizer's Chat Template (Recommended)

Let the tokenizer handle formatting automatically:

```python
from mlx_lm import load, generate

model, tokenizer = load("mlx-community/gemma-4-12b-it-4bit")

messages = [
    {"role": "system", "content": "You are a helpful coding assistant."},
    {"role": "user", "content": "Write a Python function to calculate fibonacci numbers."}
]

prompt = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True
)

response = generate(model, tokenizer, prompt=prompt, max_tokens=500)
print(response)
```

### Manual Template Construction

```python
def format_gemma_prompt(messages):
    """Manually format messages for Gemma."""
    prompt = ""
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        if role == "system":
            prompt += f"<start_of_turn>system\n{content}<end_of_turn>\n"
        elif role == "user":
            prompt += f"<start_of_turn>user\n{content}<end_of_turn>\n"
        elif role == "assistant":
            prompt += f"<start_of_turn>model\n{content}<end_of_turn>\n"
    prompt += "<start_of_turn>model\n"
    return prompt
```

---

## Generation Examples

### Basic Text Completion

```python
from mlx_lm import load, generate

model, tokenizer = load("mlx-community/gemma-4-12b-it-4bit")

# Simple completion
response = generate(
    model, tokenizer,
    prompt="The three laws of robotics are:",
    max_tokens=200
)
print(response)
```

### Chat with System Prompt

```python
messages = [
    {"role": "system", "content": "You are a senior Python developer. Give concise, practical answers with code examples."},
    {"role": "user", "content": "How do I read a large CSV file efficiently in Python?"}
]

prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
response = generate(model, tokenizer, prompt=prompt, max_tokens=500, temp=0.3)
print(response)
```

### Code Generation

```python
messages = [
    {"role": "user", "content": """Write a Python class for a binary search tree with insert, search, and delete methods. Include type hints and docstrings."""}
]

prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
response = generate(model, tokenizer, prompt=prompt, max_tokens=1000, temp=0.2)
print(response)
```

### Streaming Chat

```python
from mlx_lm import load, stream_generate

model, tokenizer = load("mlx-community/gemma-4-12b-it-4bit")

messages = [
    {"role": "user", "content": "Explain how transformers work in machine learning."}
]

prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

print("Gemma 4: ", end="")
for chunk in stream_generate(model, tokenizer, prompt=prompt, max_tokens=500, temp=0.7):
    print(chunk, end="", flush=True)
print()
```

### Multi-turn Chat Application

```python
from mlx_lm import load, generate

model, tokenizer = load("mlx-community/gemma-4-12b-it-4bit")

conversation = [
    {"role": "system", "content": "You are a helpful assistant specializing in machine learning."}
]

def chat(user_message):
    conversation.append({"role": "user", "content": user_message})
    prompt = tokenizer.apply_chat_template(
        conversation, tokenize=False, add_generation_prompt=True
    )
    response = generate(model, tokenizer, prompt=prompt, max_tokens=500, temp=0.7)
    conversation.append({"role": "assistant", "content": response})
    return response

# Multi-turn conversation
print(chat("What is gradient descent?"))
print("---")
print(chat("Can you show me a simple Python implementation?"))
print("---")
print(chat("How does Adam optimizer improve on basic gradient descent?"))
```

### JSON Output

```python
messages = [
    {"role": "system", "content": "You always respond with valid JSON. No markdown, no explanation, just JSON."},
    {"role": "user", "content": "List 5 programming languages with their year of creation and primary use case."}
]

prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
response = generate(model, tokenizer, prompt=prompt, max_tokens=500, temp=0.0)
print(response)
```

---

## Generation Parameters

### Parameter Reference

| Parameter | Type | Default | Description |
|---|---|---|---|
| `max_tokens` | int | 100 | Maximum number of tokens to generate |
| `temp` | float | 0.0 | Sampling temperature. 0 = greedy |
| `top_p` | float | 1.0 | Nucleus sampling threshold |
| `top_k` | int | 0 | Top-k sampling. 0 = disabled |
| `repetition_penalty` | float | 1.0 | Penalty for repeating tokens |
| `repetition_context_size` | int | 20 | Window size for repetition check |

### Recommended Settings by Task

```python
# Factual Q&A, coding, math (deterministic)
generate(model, tokenizer, prompt=prompt,
         max_tokens=500, temp=0.0)

# General conversation (balanced)
generate(model, tokenizer, prompt=prompt,
         max_tokens=500, temp=0.7, top_p=0.9, repetition_penalty=1.05)

# Creative writing (diverse)
generate(model, tokenizer, prompt=prompt,
         max_tokens=1000, temp=0.9, top_p=0.95, top_k=50)

# Long-form content (avoid repetition)
generate(model, tokenizer, prompt=prompt,
         max_tokens=2000, temp=0.7, top_p=0.9,
         repetition_penalty=1.15, repetition_context_size=100)

# Summarization (focused)
generate(model, tokenizer, prompt=prompt,
         max_tokens=300, temp=0.3, top_p=0.9)
```

---

## Memory Requirements

### Gemma 4 Memory by Size and Quantization

These are estimates. Actual usage includes both model weights and KV cache (which grows with context length).

| Model Size | fp16 | 8-bit | 4-bit | Minimum Mac |
|---|---|---|---|---|
| 2B | ~4 GB | ~2 GB | ~1.2 GB | M1 8GB |
| 4B | ~8 GB | ~4 GB | ~2.5 GB | M1 8GB (4bit) |
| 12B | ~24 GB | ~12 GB | ~7 GB | M2 Pro 16GB (4bit) |
| 27B | ~54 GB | ~27 GB | ~15 GB | M3 Max 36GB (4bit) |

### KV Cache Memory Overhead

The KV cache grows with context length. Approximate additional memory per 1K tokens of context:

| Model Size | KV Cache per 1K Tokens |
|---|---|
| 2B | ~30 MB |
| 4B | ~60 MB |
| 12B | ~150 MB |
| 27B | ~300 MB |

**Example**: Running Gemma 4 12B 4-bit with 8K context uses approximately 7 GB (weights) + 1.2 GB (KV cache) = ~8.2 GB total.

### Checking Available Memory

```python
import mlx.core as mx

# Check active GPU memory usage
active = mx.metal.get_active_memory() / 1024**3
peak = mx.metal.get_peak_memory() / 1024**3
print(f"Active memory: {active:.2f} GB")
print(f"Peak memory: {peak:.2f} GB")
```

### What Fits Where

| Mac Configuration | Recommended Gemma 4 |
|---|---|
| M1/M2 8 GB | 2B 4-bit, 4B 4-bit (tight) |
| M1/M2 16 GB | 4B 8-bit, 12B 4-bit (with short context) |
| M2/M3 Pro 18-36 GB | 12B 4-bit or 8-bit comfortably |
| M3/M4 Max 36-48 GB | 12B fp16, 27B 4-bit |
| M2/M3 Max 64-96 GB | 27B 8-bit, 27B fp16 |
| M2 Ultra 128-192 GB | All sizes at any precision |

---

## Performance Benchmarks

Performance varies significantly by chip, memory bandwidth, model size, and quantization. These are approximate tokens/second for generation (decode phase):

### Tokens per Second (Generation)

| Model | Quantization | M1 (8GB) | M2 Pro (16GB) | M3 Max (48GB) | M4 Pro (24GB) | M4 Max (64GB) |
|---|---|---|---|---|---|---|
| Gemma 4 2B | 4-bit | ~40 t/s | ~55 t/s | ~80 t/s | ~65 t/s | ~90 t/s |
| Gemma 4 4B | 4-bit | ~25 t/s | ~35 t/s | ~55 t/s | ~45 t/s | ~65 t/s |
| Gemma 4 12B | 4-bit | -- | ~15 t/s | ~35 t/s | ~25 t/s | ~45 t/s |
| Gemma 4 12B | 8-bit | -- | ~10 t/s | ~25 t/s | ~18 t/s | ~35 t/s |
| Gemma 4 27B | 4-bit | -- | -- | ~18 t/s | -- | ~25 t/s |
| Gemma 4 27B | 8-bit | -- | -- | ~12 t/s | -- | ~18 t/s |

**Notes:**
- "--" means the model does not fit in memory on that configuration.
- Prompt processing (prefill) is significantly faster than generation (often 2-5x).
- These are rough estimates. Actual performance depends on context length, batch size, and system load.
- M4 chips have improved memory bandwidth and GPU cores compared to earlier generations.

### Measuring Your Own Performance

```python
from mlx_lm import load, generate
import time

model, tokenizer = load("mlx-community/gemma-4-12b-it-4bit")

prompt = "Write a detailed essay about the history of artificial intelligence."

start = time.time()
response = generate(model, tokenizer, prompt=prompt, max_tokens=500)
elapsed = time.time() - start

# Approximate tokens generated (rough count)
token_count = len(tokenizer.encode(response))
print(f"Generated {token_count} tokens in {elapsed:.1f}s")
print(f"Speed: {token_count/elapsed:.1f} tokens/sec")
```

---

## Multimodal Usage

Gemma 4 includes vision-language variants that can process images alongside text. Support in mlx-lm for multimodal models depends on the specific architecture implementation.

### Text + Image Input (if supported)

```python
from mlx_lm import load, generate
from PIL import Image
import base64

# Load a multimodal Gemma 4 variant
model, tokenizer = load("mlx-community/gemma-4-12b-vision-it-4bit")

# Prepare image
image = Image.open("photo.jpg")

# Format prompt with image token
messages = [
    {
        "role": "user",
        "content": [
            {"type": "image", "image": image},
            {"type": "text", "text": "Describe what you see in this image in detail."}
        ]
    }
]

prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
response = generate(model, tokenizer, prompt=prompt, max_tokens=500)
print(response)
```

### Multimodal Capabilities

When available, the vision variants can:
- Describe images in detail
- Answer questions about image content
- Read text/OCR from images
- Analyze charts and diagrams
- Compare multiple images

**Note**: Check the specific model card on HuggingFace for exact multimodal support and prompt formatting. The vision model will require more memory than the text-only variant due to the vision encoder.

---

## Comparison: Gemma 4 vs Llama 3 vs Phi-4

### Quality Comparison (at Similar Sizes)

| Aspect | Gemma 4 | Llama 3.x | Phi-4 |
|---|---|---|---|
| **Provider** | Google DeepMind | Meta | Microsoft |
| **Sizes** | 2B, 4B, 12B, 27B | 1B, 3B, 8B, 70B, 405B | 3.8B, 14B |
| **Multilingual** | Strong | Strong | Moderate |
| **Code** | Strong | Strong | Excellent (at size) |
| **Math** | Strong | Strong | Excellent (at size) |
| **Vision** | Yes (select variants) | Yes (Llama 3.2 11B/90B) | Yes (Phi-3.5-vision) |
| **Context** | Up to 128K | Up to 128K | Up to 16K |
| **License** | Gemma License | Llama License | MIT |

### MLX Performance Comparison (4-bit, M3 Max 48GB)

| Model | Size | Tokens/sec | Memory | Quality Tier |
|---|---|---|---|---|
| Gemma 4 12B | 12B | ~35 t/s | ~7 GB | High |
| Llama 3.1 8B Instruct | 8B | ~45 t/s | ~4.5 GB | High |
| Phi-4 | 14B | ~30 t/s | ~8 GB | High |
| Gemma 4 27B | 27B | ~18 t/s | ~15 GB | Very High |
| Llama 3.1 70B Instruct | 70B | ~8 t/s | ~35 GB | Very High |

### When to Choose Gemma 4

- **Best at**: Instruction following, multilingual tasks, balanced quality across benchmarks, multimodal (vision)
- **Good ecosystem**: Active model releases from Google, strong community conversions
- **Memory efficient**: The 12B model hits a quality sweet spot for Mac hardware with 16-36GB RAM

### When to Choose Llama 3

- **Best at**: Widest range of sizes (1B to 405B), largest community, most fine-tuned variants available
- **Ecosystem**: Enormous number of fine-tunes, adapters, and community models

### When to Choose Phi-4

- **Best at**: Punching above its weight at small sizes, code generation, math/reasoning
- **Efficiency**: Excellent quality-per-parameter ratio, fits in less memory

---

## Tips and Best Practices

### 1. Context Window Management

Long contexts consume significant memory via the KV cache. Manage it carefully:

```python
# Monitor memory during long context usage
import mlx.core as mx

# Before loading
pre_memory = mx.metal.get_active_memory() / 1024**3

model, tokenizer = load("mlx-community/gemma-4-12b-it-4bit")
post_load = mx.metal.get_active_memory() / 1024**3
print(f"Model memory: {post_load - pre_memory:.2f} GB")

# After generation with long context
response = generate(model, tokenizer, prompt=long_prompt, max_tokens=2000)
post_gen = mx.metal.get_active_memory() / 1024**3
print(f"Total memory with KV cache: {post_gen - pre_memory:.2f} GB")
```

### 2. KV Cache Reuse

For multi-turn conversations, the prompt is re-processed each turn. Keep conversations concise or summarize older turns:

```python
# Instead of sending the entire conversation history each time,
# summarize older turns to keep the prompt short
def summarize_old_turns(messages, keep_recent=4):
    """Keep only recent messages to limit context length."""
    if len(messages) <= keep_recent + 1:  # +1 for system
        return messages
    
    system = [m for m in messages if m["role"] == "system"]
    recent = messages[-(keep_recent):]
    
    return system + [
        {"role": "user", "content": "(Earlier conversation summarized) " + 
         "We discussed various topics."}
    ] + recent
```

### 3. Batch Inference

For processing multiple prompts, batch them when possible:

```python
from mlx_lm import load, generate

model, tokenizer = load("mlx-community/gemma-4-12b-it-4bit")

prompts = [
    "Summarize the concept of machine learning.",
    "What is the capital of Japan?",
    "Write a haiku about coding.",
]

results = []
for prompt in prompts:
    messages = [{"role": "user", "content": prompt}]
    formatted = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    response = generate(model, tokenizer, prompt=formatted, max_tokens=200)
    results.append(response)

for prompt, result in zip(prompts, results):
    print(f"Q: {prompt}")
    print(f"A: {result}\n")
```

### 4. Choose the Right Quantization

```
Rule of thumb:
- If the model fits in fp16 with room to spare -> use fp16
- If memory is tight but you want best quality -> use 8-bit  
- If you need to fit the model at all -> use 4-bit
- Avoid 2-bit unless you have no other option
```

### 5. Temperature Tips for Gemma 4

- Gemma models tend to be well-calibrated. `temp=0.0` (greedy) works well for factual tasks.
- For creative tasks, `temp=0.7` to `0.9` gives good results without becoming incoherent.
- If you see repetitive output, add `repetition_penalty=1.1` to `1.2`.
- For structured output (JSON, code), keep temperature low (`0.0` to `0.3`).

### 6. Using the Server for Production Workflows

For applications that need persistent model loading, use the server mode:

```bash
python -m mlx_lm.server --model mlx-community/gemma-4-12b-it-4bit --port 8080
```

Then query via OpenAI-compatible API. See [[Serving]] for details.

### 7. Monitoring and Debugging

```python
import mlx.core as mx

# Check memory at any point
def print_memory():
    active = mx.metal.get_active_memory() / 1024**3
    peak = mx.metal.get_peak_memory() / 1024**3
    cache = mx.metal.get_cache_memory() / 1024**3
    print(f"Active: {active:.2f} GB | Peak: {peak:.2f} GB | Cache: {cache:.2f} GB")

# Reset peak counter
mx.metal.reset_peak_memory()

# Clear cache if memory pressure is high
mx.metal.clear_cache()
```

---

See also: [[MLX-LM]] for general mlx-lm usage, [[Fine-Tuning]] for fine-tuning Gemma 4, [[Serving]] for API server, [[Performance]] for hardware optimization guide.
