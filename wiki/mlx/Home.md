# MLX - Apple's Machine Learning Framework

MLX is an array framework for machine learning research and production on Apple Silicon, created by Apple's machine learning research team. It is designed to be familiar to users of NumPy, PyTorch, and JAX, while being optimized specifically for the unified memory architecture of M-series chips.

---

## Table of Contents

- [[Home]] - This page (overview, installation, ecosystem)
- [[MLX-Core]] - Core array operations, lazy evaluation, function transforms
- [[MLX-NN]] - Neural network modules, optimizers, training loops
- [[MLX-LM]] - Language model inference, conversion, quantization
- [[MLX-Data]] - Data loading, pipelines, transformations
- [[Gemma-4-on-MLX]] - Running Google's Gemma 4 models on Apple Silicon
- [[Fine-Tuning]] - LoRA/QLoRA fine-tuning with mlx-lm
- [[Serving]] - Local OpenAI-compatible API server
- [[Performance]] - Benchmarks, memory optimization, hardware guide

---

## What Is MLX?

MLX is a NumPy-like array framework designed for efficient and flexible machine learning on Apple Silicon. Key design principles:

1. **Familiar APIs** - MLX follows NumPy and PyTorch conventions closely, making adoption straightforward for anyone with Python ML experience.
2. **Composable function transforms** - Automatic differentiation, vectorization, and computation graph optimization via `mx.grad`, `mx.vmap`, and `mx.compile`.
3. **Lazy evaluation** - Computations are only executed when results are actually needed, enabling graph-level optimizations.
4. **Unified memory** - Arrays live in shared memory accessible by both CPU and GPU with zero-copy overhead. There are no explicit transfers between devices.
5. **Multi-device** - Operations can run on CPU or GPU (Metal) without data movement.

---

## Key Features

### Lazy Evaluation

Unlike PyTorch (eager by default), MLX uses lazy evaluation. Operations build a computation graph and only execute when you explicitly request results:

```python
import mlx.core as mx

a = mx.ones((1000, 1000))
b = mx.ones((1000, 1000))
c = a + b  # No computation happens yet

mx.eval(c)  # Now the computation executes
print(c)    # Also forces evaluation if not yet done
```

This enables the framework to optimize across multiple operations before executing them.

### Unified CPU/GPU Memory

On Apple Silicon, CPU and GPU share the same physical memory (unified memory architecture). MLX exploits this:

```python
import mlx.core as mx

# Create an array - it lives in unified memory
x = mx.random.normal((1024, 1024))

# Use it on GPU - no transfer needed
mx.set_default_device(mx.gpu)
y = x @ x.T  # Runs on GPU, same memory

# Use it on CPU - still no transfer
mx.set_default_device(mx.cpu)
z = mx.sum(y)  # Runs on CPU, same memory
```

### Composable Function Transforms

```python
import mlx.core as mx

def loss_fn(x):
    return mx.sum(x ** 2)

# Automatic differentiation
grad_fn = mx.grad(loss_fn)
x = mx.array([1.0, 2.0, 3.0])
print(grad_fn(x))  # [2.0, 4.0, 6.0]

# JIT compilation
compiled_loss = mx.compile(loss_fn)

# Vectorization
batched_fn = mx.vmap(loss_fn)
```

---

## Comparison to Other Frameworks

| Feature | MLX | PyTorch | JAX | TensorFlow |
|---|---|---|---|---|
| **Target hardware** | Apple Silicon (M1-M4) | NVIDIA GPU, CPU | NVIDIA GPU, TPU, CPU | NVIDIA GPU, TPU, CPU |
| **Memory model** | Unified (zero-copy CPU/GPU) | Separate CPU/GPU memory | Separate CPU/GPU memory | Separate CPU/GPU memory |
| **Evaluation** | Lazy by default | Eager by default | Lazy (functional) | Eager (v2) / Graph (v1) |
| **Autodiff** | Function transforms (`mx.grad`) | Tape-based (`loss.backward()`) | Function transforms (`jax.grad`) | Tape-based (`GradientTape`) |
| **JIT compilation** | `mx.compile` | `torch.compile` | `jax.jit` | `tf.function` |
| **API style** | NumPy-like | NumPy-like | NumPy-like | Own API (Keras) |
| **Primary use case** | On-device Apple ML | Training + inference at scale | Research, TPU workloads | Production deployment |

**When to use MLX:**
- You develop on a Mac with Apple Silicon and want fast local iteration
- You want to run LLMs locally on your Mac without needing a cloud GPU
- You prefer a lightweight framework without CUDA dependencies
- You want unified memory to avoid CPU-GPU transfer overhead

**When not to use MLX:**
- You need NVIDIA GPU or TPU support
- You need distributed multi-node training
- You deploy to Linux servers in production

---

## Installation

### Prerequisites

- macOS 13.5 (Ventura) or later
- Apple Silicon Mac (M1, M2, M3, or M4 -- any variant: base, Pro, Max, Ultra)
- Python 3.9 or later

### Install MLX Core

```bash
pip install mlx
```

### Install the Full Ecosystem

```bash
# Core framework
pip install mlx

# Language model tools (inference, conversion, fine-tuning, serving)
pip install mlx-lm

# Data loading utilities
pip install mlx-data

# Verify installation
python -c "import mlx.core as mx; print(mx.array([1, 2, 3]))"
```

### From Source (Development)

```bash
git clone https://github.com/ml-explore/mlx.git
cd mlx
pip install -e ".[dev]"
```

---

## Ecosystem Overview

### mlx (`pip install mlx`)

The core framework. Provides:
- N-dimensional array type (`mx.array`)
- Standard math and linear algebra operations
- Automatic differentiation (`mx.grad`, `mx.value_and_grad`)
- Vectorization (`mx.vmap`)
- JIT compilation (`mx.compile`)
- Neural network building blocks (`mlx.nn`)
- Optimizers (`mlx.optimizers`)
- Metal GPU backend

See [[MLX-Core]] and [[MLX-NN]] for details.

### mlx-lm (`pip install mlx-lm`)

High-level tools for working with large language models:
- Load and run pre-converted models from HuggingFace (`mlx-community`)
- Convert HuggingFace models to MLX format
- Quantize models (4-bit, 8-bit)
- Fine-tune with LoRA/QLoRA
- Serve models via OpenAI-compatible API

See [[MLX-LM]], [[Gemma-4-on-MLX]], [[Fine-Tuning]], and [[Serving]].

### mlx-data (`pip install mlx-data`)

Data loading and preprocessing:
- Efficient data pipelines for training
- Image, text, and audio data loading
- Streaming and buffered datasets

See [[MLX-Data]].

### mlx-examples

Community repository of example implementations:
- LLM inference and fine-tuning
- Stable Diffusion
- Whisper (speech-to-text)
- BERT, LoRA, and more

```bash
git clone https://github.com/ml-explore/mlx-examples.git
```

---

## Supported Hardware

| Chip | Variants | Max Unified Memory | Typical Use Case |
|---|---|---|---|
| M1 | Base, Pro, Max, Ultra | 8-128 GB | Small models (7B quantized) |
| M2 | Base, Pro, Max, Ultra | 8-192 GB | Medium models (7-13B) |
| M3 | Base, Pro, Max | 8-128 GB | Medium models, faster GPU cores |
| M4 | Base, Pro, Max | 16-128 GB | Large models (70B+ quantized on Max) |

All Apple Silicon chips are supported. The primary differentiator is the amount of unified memory, which determines the largest model you can load. See [[Performance]] for detailed hardware guidance.

---

## Quick Start

```python
import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim

# Define a simple model
class MLP(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(784, 256)
        self.fc2 = nn.Linear(256, 10)

    def __call__(self, x):
        x = nn.relu(self.fc1(x))
        return self.fc2(x)

# Create model and optimizer
model = MLP()
optimizer = optim.Adam(learning_rate=1e-3)

# Training step
def loss_fn(model, x, y):
    logits = model(x)
    return nn.losses.cross_entropy(logits, y, reduction="mean")

loss_and_grad_fn = nn.value_and_grad(model, loss_fn)

# Single training step
x = mx.random.normal((32, 784))
y = mx.random.randint(0, 10, (32,))
loss, grads = loss_and_grad_fn(model, x, y)
optimizer.update(model, grads)
mx.eval(model.parameters(), optimizer.state)

print(f"Loss: {loss.item():.4f}")
```

---

## Resources

- **GitHub**: [https://github.com/ml-explore/mlx](https://github.com/ml-explore/mlx)
- **Documentation**: [https://ml-explore.github.io/mlx/](https://ml-explore.github.io/mlx/)
- **Examples**: [https://github.com/ml-explore/mlx-examples](https://github.com/ml-explore/mlx-examples)
- **HuggingFace Community Models**: [https://huggingface.co/mlx-community](https://huggingface.co/mlx-community)
- **Discord**: MLX community Discord for support and discussion
