# MLX-LM: Language Models on Apple Silicon

`mlx-lm` is a high-level package for running, converting, quantizing, fine-tuning, and serving large language models using MLX. It provides a simple interface to work with models from HuggingFace's `mlx-community` hub and convert models from other formats.

```bash
pip install mlx-lm
```

---

## Table of Contents

- [Installation](#installation)
- [Loading Models](#loading-models)
- [Text Generation](#text-generation)
- [Streaming Generation](#streaming-generation)
- [Chat with Models](#chat-with-models)
- [Model Conversion from HuggingFace](#model-conversion-from-huggingface)
- [Quantization](#quantization)
- [Supported Architectures](#supported-architectures)
- [Sampling Parameters](#sampling-parameters)
- [Command-Line Interface](#command-line-interface)
- [Programmatic API Reference](#programmatic-api-reference)

---

## Installation

```bash
pip install mlx-lm

# Verify installation
python -c "import mlx_lm; print('mlx-lm installed successfully')"
```

### Requirements

- macOS 13.5+
- Apple Silicon (M1/M2/M3/M4)
- Python 3.9+
- MLX (installed automatically as dependency)

---

## Loading Models

### From mlx-community (Pre-converted)

The easiest way to get started. The `mlx-community` organization on HuggingFace hosts hundreds of pre-converted and quantized models:

```python
from mlx_lm import load

# Load a pre-converted model
model, tokenizer = load("mlx-community/Llama-3.2-3B-Instruct-4bit")

# Load a larger model
model, tokenizer = load("mlx-community/Mistral-7B-Instruct-v0.3-4bit")

# Load with specific revision
model, tokenizer = load("mlx-community/Phi-3.5-mini-instruct-4bit")
```

### From a Local Path

```python
from mlx_lm import load

# Load from a local directory
model, tokenizer = load("./my-converted-model")
```

### Lazy Loading (Memory Efficient)

For very large models, you can load weights lazily:

```python
from mlx_lm import load

# Weights are memory-mapped and loaded on demand
model, tokenizer = load("mlx-community/Llama-3.1-70B-Instruct-4bit")
```

MLX uses memory-mapped weight files, so the entire model does not need to fit in memory at once during loading. Weights are paged in as needed.

---

## Text Generation

### Basic Generation

```python
from mlx_lm import load, generate

model, tokenizer = load("mlx-community/Llama-3.2-3B-Instruct-4bit")

# Simple generation
response = generate(
    model,
    tokenizer,
    prompt="Explain quantum computing in simple terms:",
    max_tokens=200
)
print(response)
```

### Generation with Parameters

```python
response = generate(
    model,
    tokenizer,
    prompt="Write a haiku about machine learning:",
    max_tokens=100,
    temp=0.7,           # Temperature (0 = deterministic, higher = more random)
    top_p=0.9,          # Nucleus sampling
    repetition_penalty=1.1,  # Penalize repeated tokens
    repetition_context_size=20  # Window for repetition check
)
```

### Using Chat Templates

Most instruct models expect messages in a specific chat format. Use the tokenizer's chat template:

```python
from mlx_lm import load, generate

model, tokenizer = load("mlx-community/Llama-3.2-3B-Instruct-4bit")

messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is the capital of France?"}
]

# Apply chat template
prompt = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True
)

response = generate(model, tokenizer, prompt=prompt, max_tokens=200)
print(response)
```

---

## Streaming Generation

For interactive applications, stream tokens as they are generated:

```python
from mlx_lm import load, stream_generate

model, tokenizer = load("mlx-community/Llama-3.2-3B-Instruct-4bit")

prompt = "Tell me a story about a brave robot:"

# Stream tokens one at a time
for token_text in stream_generate(
    model,
    tokenizer,
    prompt=prompt,
    max_tokens=500
):
    print(token_text, end="", flush=True)
print()  # Newline at end
```

### Streaming with Generation Info

```python
from mlx_lm import load, stream_generate

model, tokenizer = load("mlx-community/Llama-3.2-3B-Instruct-4bit")

prompt = "Explain relativity:"
tokens_generated = 0

for response in stream_generate(
    model,
    tokenizer,
    prompt=prompt,
    max_tokens=200
):
    print(response, end="", flush=True)
    tokens_generated += 1

print(f"\n\nTokens generated: {tokens_generated}")
```

---

## Chat with Models

### Interactive Chat Loop

```python
from mlx_lm import load, generate

model, tokenizer = load("mlx-community/Llama-3.2-3B-Instruct-4bit")

messages = [
    {"role": "system", "content": "You are a helpful coding assistant."}
]

while True:
    user_input = input("\nYou: ")
    if user_input.lower() in ("quit", "exit"):
        break
    
    messages.append({"role": "user", "content": user_input})
    
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True
    )
    
    response = generate(
        model, tokenizer,
        prompt=prompt,
        max_tokens=500,
        temp=0.7
    )
    
    print(f"\nAssistant: {response}")
    messages.append({"role": "assistant", "content": response})
```

### Multi-turn Conversation Example

```python
from mlx_lm import load, generate

model, tokenizer = load("mlx-community/Mistral-7B-Instruct-v0.3-4bit")

messages = [
    {"role": "user", "content": "What is Python?"},
]

prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
response1 = generate(model, tokenizer, prompt=prompt, max_tokens=200)
messages.append({"role": "assistant", "content": response1})

# Follow-up
messages.append({"role": "user", "content": "How does it compare to Rust?"})
prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
response2 = generate(model, tokenizer, prompt=prompt, max_tokens=200)

print("Turn 1:", response1)
print("Turn 2:", response2)
```

---

## Model Conversion from HuggingFace

Convert any supported HuggingFace model to MLX format:

### Command-Line Conversion

```bash
# Basic conversion (fp16)
python -m mlx_lm.convert \
    --hf-path meta-llama/Llama-3.2-3B-Instruct \
    --mlx-path ./Llama-3.2-3B-Instruct-mlx

# Conversion with 4-bit quantization
python -m mlx_lm.convert \
    --hf-path meta-llama/Llama-3.2-3B-Instruct \
    --mlx-path ./Llama-3.2-3B-Instruct-4bit \
    -q \
    --q-bits 4

# Conversion with 8-bit quantization
python -m mlx_lm.convert \
    --hf-path microsoft/Phi-3.5-mini-instruct \
    --mlx-path ./Phi-3.5-mini-instruct-8bit \
    -q \
    --q-bits 8

# Upload to HuggingFace after conversion
python -m mlx_lm.convert \
    --hf-path meta-llama/Llama-3.2-3B-Instruct \
    --mlx-path ./Llama-3.2-3B-Instruct-4bit \
    -q --q-bits 4 \
    --upload-repo your-username/Llama-3.2-3B-Instruct-4bit-mlx
```

### Programmatic Conversion

```python
from mlx_lm import convert

convert(
    hf_path="meta-llama/Llama-3.2-3B-Instruct",
    mlx_path="./Llama-3.2-3B-Instruct-4bit",
    quantize=True,
    q_bits=4,
    q_group_size=64
)
```

### What Conversion Does

1. Downloads the model from HuggingFace (if not cached)
2. Converts weights from PyTorch format to MLX safetensors
3. Optionally quantizes weights (4-bit or 8-bit)
4. Copies tokenizer files and config
5. Creates an MLX-compatible model directory

---

## Quantization

Quantization reduces model size and memory usage by representing weights with fewer bits.

### Quantization Options

| Parameter | Values | Description |
|---|---|---|
| `--q-bits` | 2, 4, 8 | Bits per weight (4 is the most common) |
| `--q-group-size` | 32, 64, 128 | Number of weights sharing a scale factor |

### Memory Savings

| Precision | Memory per 1B params | 7B Model | 70B Model |
|---|---|---|---|
| fp16 | ~2 GB | ~14 GB | ~140 GB |
| 8-bit | ~1 GB | ~7 GB | ~70 GB |
| 4-bit | ~0.5 GB | ~3.5 GB | ~35 GB |
| 2-bit | ~0.25 GB | ~1.75 GB | ~17.5 GB |

### Quantization Quality

- **8-bit**: Nearly identical to fp16 quality. Recommended when memory allows.
- **4-bit**: Small quality degradation. Best balance of quality vs memory. Most popular choice.
- **2-bit**: Noticeable quality loss. Only for when memory is extremely constrained.

```bash
# Compare: convert same model at different quantization levels
python -m mlx_lm.convert --hf-path meta-llama/Llama-3.2-3B-Instruct --mlx-path ./llama3-fp16
python -m mlx_lm.convert --hf-path meta-llama/Llama-3.2-3B-Instruct --mlx-path ./llama3-8bit -q --q-bits 8
python -m mlx_lm.convert --hf-path meta-llama/Llama-3.2-3B-Instruct --mlx-path ./llama3-4bit -q --q-bits 4
```

---

## Supported Architectures

`mlx-lm` supports a wide range of model architectures:

| Architecture | Example Models | Notes |
|---|---|---|
| Llama | Llama 2, Llama 3, Llama 3.1, Llama 3.2 | Most popular family |
| Mistral | Mistral 7B, Mixtral 8x7B | Includes MoE models |
| Phi | Phi-3, Phi-3.5, Phi-4 | Microsoft's efficient models |
| Qwen | Qwen 2, Qwen 2.5 | Alibaba's models |
| Gemma | Gemma, Gemma 2, Gemma 3, Gemma 4 | Google's open models |
| Starcoder | Starcoder2 | Code generation |
| Cohere | Command-R | Chat-optimized |
| DeepSeek | DeepSeek V2, DeepSeek Coder | MoE architecture |
| OLMo | OLMo, OLMo 2 | AI2's open models |
| InternLM | InternLM2 | Shanghai AI Lab |
| DBRX | DBRX | Databricks MoE |

To check if a specific architecture is supported:

```python
# If loading fails with "unsupported architecture", the model type
# is not yet implemented in mlx-lm
from mlx_lm import load
try:
    model, tokenizer = load("mlx-community/some-model")
    print("Model loaded successfully")
except Exception as e:
    print(f"Not supported: {e}")
```

---

## Sampling Parameters

Control generation behavior with these parameters:

| Parameter | Default | Description |
|---|---|---|
| `max_tokens` | 100 | Maximum tokens to generate |
| `temp` | 0.0 | Temperature. 0 = greedy/deterministic. 0.7 = balanced. 1.0+ = very creative |
| `top_p` | 1.0 | Nucleus sampling. Only consider tokens whose cumulative probability exceeds this threshold. 0.9 is common |
| `top_k` | 0 | Only consider top-k most likely tokens. 0 = disabled |
| `repetition_penalty` | 1.0 | Penalize repeated tokens. 1.0 = no penalty. 1.1-1.3 = mild. >1.5 = strong |
| `repetition_context_size` | 20 | How many recent tokens to check for repetition |

### Choosing Parameters

```python
# Deterministic (best for factual Q&A, coding)
generate(model, tokenizer, prompt=prompt, max_tokens=500, temp=0.0)

# Balanced (good default for most tasks)
generate(model, tokenizer, prompt=prompt, max_tokens=500, temp=0.7, top_p=0.9)

# Creative (stories, brainstorming)
generate(model, tokenizer, prompt=prompt, max_tokens=500, temp=1.0, top_p=0.95)

# Reduce repetition
generate(model, tokenizer, prompt=prompt, max_tokens=500,
         temp=0.7, repetition_penalty=1.15, repetition_context_size=50)
```

---

## Command-Line Interface

`mlx-lm` provides a CLI for quick testing:

### Generate Text

```bash
# Basic generation
python -m mlx_lm.generate \
    --model mlx-community/Llama-3.2-3B-Instruct-4bit \
    --prompt "Explain machine learning in one paragraph:" \
    --max-tokens 200

# With sampling parameters
python -m mlx_lm.generate \
    --model mlx-community/Mistral-7B-Instruct-v0.3-4bit \
    --prompt "Write a poem about the ocean:" \
    --max-tokens 300 \
    --temp 0.8 \
    --top-p 0.95
```

### Chat Mode

```bash
# Interactive chat
python -m mlx_lm.chat \
    --model mlx-community/Llama-3.2-3B-Instruct-4bit

# Chat with system prompt
python -m mlx_lm.chat \
    --model mlx-community/Llama-3.2-3B-Instruct-4bit \
    --system-prompt "You are a Python expert. Give concise answers with code examples."
```

### Convert

```bash
python -m mlx_lm.convert \
    --hf-path meta-llama/Llama-3.2-3B-Instruct \
    --mlx-path ./output \
    -q --q-bits 4
```

### Serve (OpenAI API)

```bash
python -m mlx_lm.server \
    --model mlx-community/Llama-3.2-3B-Instruct-4bit \
    --port 8080
```

See [[Serving]] for full server documentation.

---

## Programmatic API Reference

### Core Functions

```python
from mlx_lm import (
    load,              # Load model and tokenizer
    generate,          # Generate text (blocking)
    stream_generate,   # Generate text (streaming)
    convert,           # Convert HuggingFace model to MLX
)

# load(path_or_hf_repo, tokenizer_config={}, adapter_path=None)
# Returns: (model, tokenizer)

# generate(model, tokenizer, prompt, max_tokens=100, temp=0.0, ...)
# Returns: str (generated text)

# stream_generate(model, tokenizer, prompt, max_tokens=100, temp=0.0, ...)
# Returns: generator yielding str chunks
```

### Working with the Model Object Directly

```python
from mlx_lm import load
import mlx.core as mx

model, tokenizer = load("mlx-community/Llama-3.2-3B-Instruct-4bit")

# Tokenize manually
tokens = tokenizer.encode("Hello, world!")
input_ids = mx.array([tokens])

# Run the model
logits = model(input_ids)
print(f"Logits shape: {logits.shape}")  # (1, seq_len, vocab_size)

# Get next token probabilities
probs = mx.softmax(logits[:, -1, :], axis=-1)
next_token = mx.argmax(probs, axis=-1)
print(f"Next token: {tokenizer.decode(next_token.tolist())}")
```

---

See also: [[Gemma-4-on-MLX]] for running Gemma 4 models, [[Fine-Tuning]] for LoRA training, [[Serving]] for API server, [[Performance]] for optimization.
