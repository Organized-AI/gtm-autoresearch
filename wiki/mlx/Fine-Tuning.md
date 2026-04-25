# Fine-Tuning on MLX

LoRA and QLoRA fine-tuning for language models on Apple Silicon using `mlx-lm`.

## Overview

MLX supports parameter-efficient fine-tuning via LoRA (Low-Rank Adaptation). Instead of updating all model weights, LoRA trains small adapter matrices that are merged with the base model. QLoRA combines this with 4-bit quantization of the base model, dramatically reducing memory requirements.

## Prerequisites

```bash
pip install mlx-lm
```

## Dataset Format

### Chat Format (Recommended)

JSONL file where each line contains a conversation:

```json
{"messages": [{"role": "user", "content": "What is GTM?"}, {"role": "assistant", "content": "Google Tag Manager is a tag management system..."}]}
{"messages": [{"role": "system", "content": "You are a marketing analyst."}, {"role": "user", "content": "Explain CAPI."}, {"role": "assistant", "content": "Conversions API (CAPI) is Meta's server-side..."}]}
```

### Completion Format

Simple text completion:

```json
{"text": "Question: What is server-side tagging?\nAnswer: Server-side tagging moves..."}
{"text": "Question: What is EMQ?\nAnswer: Event Match Quality measures..."}
```

### Dataset Structure

```
data/
├── train.jsonl     # Training data (required)
├── valid.jsonl     # Validation data (optional, recommended)
└── test.jsonl      # Test data (optional)
```

## Training

### Basic LoRA Training

```bash
python -m mlx_lm.lora \
  --model mlx-community/gemma-3-4b-it-4bit \
  --data ./data \
  --train \
  --iters 1000 \
  --batch-size 4 \
  --lora-rank 8 \
  --learning-rate 1e-5 \
  --adapter-path ./adapters
```

### QLoRA (Quantized Base Model)

```bash
python -m mlx_lm.lora \
  --model google/gemma-3-4b-it \
  --data ./data \
  --train \
  --iters 1000 \
  --batch-size 4 \
  --lora-rank 8 \
  --learning-rate 1e-5 \
  --adapter-path ./adapters \
  --q-bits 4
```

The `--q-bits 4` flag quantizes the base model to 4-bit during training, reducing memory to ~25% of fp16 while LoRA adapters remain in full precision.

### Training Parameters

| Flag | Default | Description |
|---|---|---|
| `--model` | — | Model path or HuggingFace ID |
| `--data` | — | Path to data directory |
| `--train` | — | Enable training mode |
| `--iters` | 1000 | Number of training iterations |
| `--batch-size` | 4 | Training batch size |
| `--learning-rate` | 1e-5 | Learning rate |
| `--lora-rank` | 8 | LoRA rank (higher = more capacity, more memory) |
| `--lora-layers` | 16 | Number of layers to apply LoRA to |
| `--lora-alpha` | 16 | LoRA alpha (scaling factor, typically = rank) |
| `--adapter-path` | ./adapters | Where to save adapter weights |
| `--steps-per-report` | 10 | Log training loss every N steps |
| `--steps-per-eval` | 200 | Run validation every N steps |
| `--val-batches` | 25 | Number of validation batches |
| `--save-every` | 100 | Save checkpoint every N steps |
| `--q-bits` | — | Quantize base model (4 or 8) |
| `--max-seq-length` | 2048 | Maximum sequence length |
| `--grad-checkpoint` | false | Gradient checkpointing (saves memory) |
| `--lr-schedule` | — | Learning rate schedule (cosine_decay, linear_decay) |
| `--seed` | 0 | Random seed |

## Evaluation

```bash
python -m mlx_lm.lora \
  --model mlx-community/gemma-3-4b-it-4bit \
  --adapter-path ./adapters \
  --data ./data \
  --test
```

Reports test loss and perplexity.

## Generating with Adapters

```bash
python -m mlx_lm.generate \
  --model mlx-community/gemma-3-4b-it-4bit \
  --adapter-path ./adapters \
  --prompt "What is Event Match Quality?" \
  --max-tokens 256
```

### In Python

```python
from mlx_lm import load, generate

model, tokenizer = load(
    "mlx-community/gemma-3-4b-it-4bit",
    adapter_path="./adapters"
)

response = generate(
    model, tokenizer,
    prompt="Explain server-side tagging benefits.",
    max_tokens=256
)
print(response)
```

## Fusing Adapters

Merge LoRA adapters back into the base model to create a standalone fine-tuned model:

```bash
python -m mlx_lm.fuse \
  --model mlx-community/gemma-3-4b-it-4bit \
  --adapter-path ./adapters \
  --save-path ./fused-model
```

The fused model can be loaded and used without specifying an adapter path:

```python
model, tokenizer = load("./fused-model")
```

### De-Quantize and Fuse

To fuse into a full-precision model (useful for further fine-tuning or re-quantizing):

```bash
python -m mlx_lm.fuse \
  --model google/gemma-3-4b-it \
  --adapter-path ./adapters \
  --save-path ./fused-model-fp16 \
  --de-quantize
```

## Fine-Tuning Gemma — Recommended Settings

```bash
python -m mlx_lm.lora \
  --model mlx-community/gemma-3-4b-it-4bit \
  --data ./data \
  --train \
  --iters 500 \
  --batch-size 2 \
  --lora-rank 16 \
  --lora-alpha 32 \
  --lora-layers 16 \
  --learning-rate 2e-5 \
  --lr-schedule cosine_decay \
  --max-seq-length 2048 \
  --steps-per-eval 50 \
  --save-every 100 \
  --adapter-path ./gemma-adapters
```

Key considerations for Gemma:
- Start with `--lora-rank 16` and `--lora-alpha 32` (alpha = 2x rank)
- Use cosine decay schedule for stable training
- Keep batch size small (2-4) to fit in memory
- 500-1000 iterations is often sufficient for task-specific fine-tuning
- Use `--grad-checkpoint` if running out of memory on larger models

## End-to-End Example

### 1. Prepare Data

```python
import json

examples = [
    {"messages": [
        {"role": "user", "content": "What conversion events should I track for ecommerce?"},
        {"role": "assistant", "content": "For ecommerce, track these key conversion events: ViewContent (product page views), AddToCart, InitiateCheckout, AddPaymentInfo, and Purchase. Each should include value, currency, content_ids, and content_type parameters."}
    ]},
    # ... more examples
]

# Split 90/10
train = examples[:int(len(examples) * 0.9)]
valid = examples[int(len(examples) * 0.9):]

with open("data/train.jsonl", "w") as f:
    for ex in train:
        f.write(json.dumps(ex) + "\n")

with open("data/valid.jsonl", "w") as f:
    for ex in valid:
        f.write(json.dumps(ex) + "\n")
```

### 2. Train

```bash
python -m mlx_lm.lora \
  --model mlx-community/gemma-3-4b-it-4bit \
  --data ./data \
  --train \
  --iters 500 \
  --batch-size 2 \
  --lora-rank 16 \
  --learning-rate 2e-5 \
  --adapter-path ./gtm-adapters
```

### 3. Evaluate

```bash
python -m mlx_lm.lora \
  --model mlx-community/gemma-3-4b-it-4bit \
  --adapter-path ./gtm-adapters \
  --data ./data \
  --test
```

### 4. Test Generation

```bash
python -m mlx_lm.generate \
  --model mlx-community/gemma-3-4b-it-4bit \
  --adapter-path ./gtm-adapters \
  --prompt "How do I set up Consent Mode v2?" \
  --max-tokens 512
```

### 5. Fuse and Deploy

```bash
python -m mlx_lm.fuse \
  --model mlx-community/gemma-3-4b-it-4bit \
  --adapter-path ./gtm-adapters \
  --save-path ./gtm-expert-model
```

## Tips

- **Data quality > quantity**: 200 high-quality examples often outperform 2000 noisy ones
- **Overfitting**: Watch validation loss — if it starts increasing while training loss drops, you're overfitting. Reduce `--iters` or increase data.
- **Memory**: Use `--grad-checkpoint` and reduce `--batch-size` if you hit OOM
- **Multiple adapters**: You can train different adapters for different tasks and swap them at inference time without reloading the base model
- **Resume training**: Adapters are saved as checkpoints — load a previous adapter and continue training with more data

---

See also: [[Gemma-4-on-MLX]], [[MLX-LM]], [[Performance]], [[Serving]]
