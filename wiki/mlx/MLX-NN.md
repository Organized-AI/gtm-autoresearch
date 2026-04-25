# MLX Neural Networks (`mlx.nn`)

`mlx.nn` provides the building blocks for neural networks in MLX: a module system, standard layers, loss functions, and integration with optimizers. If you have used PyTorch's `torch.nn`, the API will feel natural.

```python
import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
```

---

## Table of Contents

- [Module System](#module-system)
- [Built-in Layers](#built-in-layers)
- [Activation Functions](#activation-functions)
- [Normalization Layers](#normalization-layers)
- [Attention and Positional Encoding](#attention-and-positional-encoding)
- [Optimizers](#optimizers)
- [Loss Functions](#loss-functions)
- [Saving and Loading](#saving-and-loading)
- [Training Loop Pattern](#training-loop-pattern)
- [Complete Training Example](#complete-training-example)

---

## Module System

### Defining a Module

All neural network modules inherit from `nn.Module`. Parameters are defined as instance attributes in `__init__`, and the forward pass is defined in `__call__`:

```python
import mlx.core as mx
import mlx.nn as nn

class MLP(nn.Module):
    def __init__(self, input_dim, hidden_dim, output_dim):
        super().__init__()
        self.fc1 = nn.Linear(input_dim, hidden_dim)
        self.fc2 = nn.Linear(hidden_dim, hidden_dim)
        self.fc3 = nn.Linear(hidden_dim, output_dim)
        self.dropout = nn.Dropout(p=0.1)
    
    def __call__(self, x):
        x = nn.relu(self.fc1(x))
        x = self.dropout(x)
        x = nn.relu(self.fc2(x))
        x = self.dropout(x)
        x = self.fc3(x)
        return x

model = MLP(784, 256, 10)
```

### Parameter Access

```python
# Get all trainable parameters as a nested dict
params = model.parameters()
print(type(params))  # dict

# Get all trainable parameters as a flat list
param_list = model.trainable_parameters()

# Count parameters
num_params = sum(p.size for _, p in nn.utils.tree_flatten(model.parameters()))
print(f"Total parameters: {num_params:,}")

# Freeze parameters (make non-trainable)
model.freeze()          # Freeze all parameters
model.fc3.unfreeze()    # Unfreeze just the last layer

# Check which parameters are trainable
for name, param in nn.utils.tree_flatten(model.trainable_parameters()):
    print(f"{name}: {param.shape}")
```

### Nested Modules

Modules can be nested arbitrarily:

```python
class ResidualBlock(nn.Module):
    def __init__(self, dim):
        super().__init__()
        self.fc1 = nn.Linear(dim, dim)
        self.fc2 = nn.Linear(dim, dim)
        self.norm = nn.LayerNorm(dim)
    
    def __call__(self, x):
        residual = x
        x = self.norm(x)
        x = nn.gelu(self.fc1(x))
        x = self.fc2(x)
        return x + residual

class DeepNet(nn.Module):
    def __init__(self, dim, num_blocks):
        super().__init__()
        self.blocks = [ResidualBlock(dim) for _ in range(num_blocks)]
        self.final = nn.Linear(dim, 10)
    
    def __call__(self, x):
        for block in self.blocks:
            x = block(x)
        return self.final(x)

model = DeepNet(128, num_blocks=6)
```

### Train vs Eval Mode

```python
# Set model to training mode (dropout active, etc.)
model.train()

# Set model to evaluation mode (dropout disabled)
model.eval()
```

---

## Built-in Layers

### Linear (Fully Connected)

```python
# Linear: y = xW^T + b
linear = nn.Linear(input_dims=512, output_dims=256)

# Without bias
linear_no_bias = nn.Linear(512, 256, bias=False)

x = mx.random.normal((32, 512))  # batch of 32
y = linear(x)                     # (32, 256)
```

### Convolution

```python
# 1D Convolution
conv1d = nn.Conv1d(
    in_channels=3,
    out_channels=16,
    kernel_size=3,
    stride=1,
    padding=1
)
x = mx.random.normal((1, 100, 3))  # (batch, length, channels)
y = conv1d(x)                       # (1, 100, 16)

# 2D Convolution
conv2d = nn.Conv2d(
    in_channels=3,
    out_channels=32,
    kernel_size=3,
    stride=1,
    padding=1
)
x = mx.random.normal((1, 28, 28, 3))  # (batch, height, width, channels) - NHWC
y = conv2d(x)                           # (1, 28, 28, 32)
```

**Note**: MLX uses NHWC (channels-last) format by default, not NCHW like PyTorch.

### Embedding

```python
# Embedding table
embedding = nn.Embedding(num_embeddings=10000, dims=512)

# Look up embeddings
token_ids = mx.array([1, 42, 1000, 5])
embedded = embedding(token_ids)  # (4, 512)

# Batch of sequences
batch_ids = mx.array([[1, 2, 3], [4, 5, 6]])
embedded = embedding(batch_ids)  # (2, 3, 512)
```

### Recurrent Layers

```python
# LSTM
lstm = nn.LSTM(input_size=128, hidden_size=256, bias=True)

x = mx.random.normal((32, 10, 128))  # (batch, seq_len, input_size)
output, (h_n, c_n) = lstm(x)

# GRU
gru = nn.GRU(input_size=128, hidden_size=256)
output, h_n = gru(x)
```

---

## Activation Functions

MLX provides activations as both functions and modules:

```python
# As functions (use in __call__)
x = mx.random.normal((32, 128))

y = nn.relu(x)
y = nn.gelu(x)          # Gaussian Error Linear Unit
y = nn.silu(x)           # SiLU / Swish
y = nn.leaky_relu(x, negative_slope=0.01)
y = nn.elu(x, alpha=1.0)
y = nn.softmax(x, axis=-1)
y = nn.sigmoid(x)
y = nn.tanh(x)
y = mx.tanh(x)           # Also available in mx.core

# As modules (use in __init__)
class Model(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(128, 64)
        self.act = nn.GELU()
        self.fc2 = nn.Linear(64, 10)
    
    def __call__(self, x):
        return self.fc2(self.act(self.fc1(x)))
```

---

## Normalization Layers

```python
# Layer Normalization (most common in transformers)
layer_norm = nn.LayerNorm(dims=512)
x = mx.random.normal((32, 10, 512))
y = layer_norm(x)  # Normalizes over last dimension

# RMS Normalization (used in Llama, Gemma, etc.)
rms_norm = nn.RMSNorm(dims=512)
y = rms_norm(x)  # RMS normalization, no mean centering

# Group Normalization
group_norm = nn.GroupNorm(num_groups=32, dims=512)
y = group_norm(x)

# Batch Normalization
batch_norm = nn.BatchNorm(num_features=64)
x = mx.random.normal((32, 64))
y = batch_norm(x)
```

### When to Use Which

- **LayerNorm**: Standard for transformers and most modern architectures.
- **RMSNorm**: Faster than LayerNorm, used in recent LLMs (Llama 2/3, Gemma). Only normalizes by root mean square, skips the mean-centering step.
- **BatchNorm**: Traditional CNNs. Requires batch statistics, so does not work well with small batches or inference.
- **GroupNorm**: When batch size is too small for BatchNorm. Common in vision transformers.

---

## Attention and Positional Encoding

### Multi-Head Attention

```python
# Multi-Head Attention
mha = nn.MultiHeadAttention(
    dims=512,          # model dimension
    num_heads=8,       # number of attention heads
    bias=False         # no bias in projections
)

# Self-attention
x = mx.random.normal((1, 20, 512))  # (batch, seq_len, dims)
output = mha(x, x, x)               # queries, keys, values
print(output.shape)                   # (1, 20, 512)

# With attention mask (causal)
seq_len = 20
mask = nn.MultiHeadAttention.create_additive_causal_mask(seq_len)
output = mha(x, x, x, mask=mask)
```

### Rotary Positional Embedding (RoPE)

```python
# RoPE - used in modern LLMs (Llama, Gemma, Mistral)
rope = nn.RoPE(dims=64)  # dims = head_dim

# Apply to queries and keys
seq_len = 100
q = mx.random.normal((1, seq_len, 8, 64))  # (batch, seq, heads, head_dim)
k = mx.random.normal((1, seq_len, 8, 64))

q_rotated = rope(q)
k_rotated = rope(k)

# With offset (for KV cache during generation)
q_rotated = rope(q, offset=50)  # Positions start at 50
```

### ALiBi (Attention with Linear Biases)

```python
# ALiBi positional encoding
alibi = nn.ALiBi()

# Create ALiBi attention bias
# Used as additive mask in attention
```

---

## Optimizers

Optimizers live in `mlx.optimizers`:

```python
import mlx.optimizers as optim

model = MLP(784, 256, 10)

# Adam (most common default)
optimizer = optim.Adam(learning_rate=1e-3)

# AdamW (Adam with decoupled weight decay - recommended for transformers)
optimizer = optim.AdamW(learning_rate=1e-4, weight_decay=0.01)

# SGD with momentum
optimizer = optim.SGD(learning_rate=0.01, momentum=0.9)

# Lion (newer optimizer, memory efficient)
optimizer = optim.Lion(learning_rate=1e-4, weight_decay=1e-2)

# Adafactor (memory efficient for large models)
optimizer = optim.Adafactor(learning_rate=1e-3)
```

### Learning Rate Schedules

```python
# Cosine decay
schedule = optim.cosine_decay(init=1e-3, decay_steps=1000)
optimizer = optim.Adam(learning_rate=schedule)

# Linear warmup then cosine decay
warmup_schedule = optim.join_schedules(
    schedules=[
        optim.linear_schedule(init=0, end=1e-3, steps=100),
        optim.cosine_decay(init=1e-3, decay_steps=900)
    ],
    boundaries=[100]
)
optimizer = optim.Adam(learning_rate=warmup_schedule)

# Step decay
step_schedule = optim.step_decay(init=1e-3, decay_rate=0.5, step_size=200)
```

### Using Optimizers

```python
# Update model parameters with gradients
optimizer.update(model, grads)

# After update, evaluate both model params and optimizer state
mx.eval(model.parameters(), optimizer.state)
```

---

## Loss Functions

Loss functions are in `nn.losses`:

```python
import mlx.nn as nn
import mlx.core as mx

# Cross-entropy loss (for classification)
logits = mx.random.normal((32, 10))    # (batch, num_classes)
targets = mx.random.randint(0, 10, (32,))  # (batch,) class indices

loss = nn.losses.cross_entropy(logits, targets, reduction="mean")

# With label smoothing
loss = nn.losses.cross_entropy(logits, targets, label_smoothing=0.1, reduction="mean")

# Binary cross-entropy
predictions = mx.sigmoid(mx.random.normal((32, 1)))
binary_targets = mx.random.randint(0, 2, (32, 1)).astype(mx.float32)
loss = nn.losses.binary_cross_entropy(predictions, binary_targets, reduction="mean")

# Mean squared error
pred = mx.random.normal((32, 5))
target = mx.random.normal((32, 5))
loss = nn.losses.mse_loss(pred, target, reduction="mean")

# L1 loss
loss = nn.losses.l1_loss(pred, target, reduction="mean")

# Smooth L1 loss (Huber)
loss = nn.losses.smooth_l1_loss(pred, target, beta=1.0, reduction="mean")

# KL divergence
p = mx.softmax(mx.random.normal((32, 10)), axis=-1)
q = mx.softmax(mx.random.normal((32, 10)), axis=-1)
loss = nn.losses.kl_div_loss(p, q, reduction="mean")

# Triplet loss
anchor = mx.random.normal((32, 128))
positive = mx.random.normal((32, 128))
negative = mx.random.normal((32, 128))
loss = nn.losses.triplet_loss(anchor, positive, negative, margin=1.0, reduction="mean")
```

### Reduction Modes

All loss functions support `reduction` parameter:
- `"mean"` - average over all elements (default)
- `"sum"` - sum over all elements
- `"none"` - return per-element loss

---

## Saving and Loading

### Saving Model Weights

```python
import mlx.core as mx
import mlx.nn as nn

model = MLP(784, 256, 10)

# Save as safetensors (recommended - safe, fast, portable)
model.save_weights("model.safetensors")

# Save as NumPy npz
weights = dict(nn.utils.tree_flatten(model.parameters()))
mx.savez("model.npz", **weights)
```

### Loading Model Weights

```python
# Load safetensors
model = MLP(784, 256, 10)
model.load_weights("model.safetensors")

# Load with strict=False (ignore missing/extra keys)
model.load_weights("model.safetensors", strict=False)

# Load npz
weights = mx.load("model.npz")
```

### Safetensors Format

MLX has first-class support for the safetensors format, which is the standard for HuggingFace models:

```python
# Save
mx.save_safetensors("weights.safetensors", dict(nn.utils.tree_flatten(model.parameters())))

# Load
weights = mx.load("weights.safetensors")
```

### Saving and Loading with Optimizer State

```python
import json

# Save model + optimizer state
model.save_weights("model.safetensors")
opt_state = dict(nn.utils.tree_flatten(optimizer.state))
mx.save_safetensors("optimizer.safetensors", opt_state)

# Save training metadata
metadata = {"step": 1000, "loss": 0.05}
with open("training_state.json", "w") as f:
    json.dump(metadata, f)
```

---

## Training Loop Pattern

The standard MLX training pattern:

```python
import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim

# 1. Define model
model = MLP(784, 256, 10)

# 2. Define optimizer
optimizer = optim.AdamW(learning_rate=1e-3, weight_decay=0.01)

# 3. Define loss function that takes model as first argument
def loss_fn(model, x, y):
    logits = model(x)
    return nn.losses.cross_entropy(logits, y, reduction="mean")

# 4. Create value_and_grad function
#    nn.value_and_grad handles model parameter extraction automatically
loss_and_grad_fn = nn.value_and_grad(model, loss_fn)

# 5. Training step
def train_step(model, optimizer, x, y):
    loss, grads = loss_and_grad_fn(model, x, y)
    optimizer.update(model, grads)
    return loss

# 6. Training loop
model.train()  # Enable training mode (dropout, etc.)

for epoch in range(num_epochs):
    epoch_loss = 0
    num_batches = 0
    
    for batch_x, batch_y in dataloader:
        loss = train_step(model, optimizer, batch_x, batch_y)
        
        # Evaluate periodically (not every step for performance)
        mx.eval(model.parameters(), optimizer.state)
        
        epoch_loss += loss.item()
        num_batches += 1
    
    avg_loss = epoch_loss / num_batches
    print(f"Epoch {epoch}: loss={avg_loss:.4f}")

# 7. Evaluation
model.eval()  # Disable dropout, etc.
test_logits = model(test_x)
predictions = mx.argmax(test_logits, axis=1)
accuracy = mx.mean(predictions == test_y).item()
print(f"Test accuracy: {accuracy:.2%}")
```

### Key Points

- Use `nn.value_and_grad(model, loss_fn)` instead of `mx.value_and_grad` -- the `nn` version handles extracting/updating model parameters automatically.
- Call `mx.eval(model.parameters(), optimizer.state)` to force evaluation. Without this, the computation graph grows unboundedly.
- Do not evaluate every single operation -- batch evaluations for better performance.

---

## Complete Training Example

Here is a complete example training a CNN on a synthetic dataset:

```python
import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np

# --- Model Definition ---
class SimpleCNN(nn.Module):
    def __init__(self, num_classes=10):
        super().__init__()
        self.conv1 = nn.Conv2d(1, 32, kernel_size=3, padding=1)
        self.conv2 = nn.Conv2d(32, 64, kernel_size=3, padding=1)
        self.pool = nn.MaxPool2d(kernel_size=2, stride=2)
        self.fc1 = nn.Linear(64 * 7 * 7, 128)
        self.fc2 = nn.Linear(128, num_classes)
        self.dropout = nn.Dropout(0.25)
    
    def __call__(self, x):
        # x: (batch, 28, 28, 1) - NHWC format
        x = nn.relu(self.conv1(x))
        x = self.pool(x)            # (batch, 14, 14, 32)
        x = nn.relu(self.conv2(x))
        x = self.pool(x)            # (batch, 7, 7, 64)
        x = x.reshape(x.shape[0], -1)  # Flatten
        x = nn.relu(self.fc1(x))
        x = self.dropout(x)
        x = self.fc2(x)
        return x

# --- Data (synthetic for this example) ---
def get_batch(batch_size=64):
    """Generate a random batch (replace with real data loading)."""
    x = mx.random.normal((batch_size, 28, 28, 1))
    y = mx.random.randint(0, 10, (batch_size,))
    return x, y

# --- Setup ---
model = SimpleCNN(num_classes=10)
optimizer = optim.AdamW(learning_rate=1e-3, weight_decay=0.01)

def loss_fn(model, x, y):
    logits = model(x)
    return nn.losses.cross_entropy(logits, y, reduction="mean")

loss_and_grad_fn = nn.value_and_grad(model, loss_fn)

# --- Training ---
model.train()
num_steps = 200

for step in range(num_steps):
    x, y = get_batch(batch_size=64)
    loss, grads = loss_and_grad_fn(model, x, y)
    optimizer.update(model, grads)
    mx.eval(model.parameters(), optimizer.state)
    
    if step % 50 == 0:
        print(f"Step {step}: loss={loss.item():.4f}")

# --- Evaluation ---
model.eval()
x_test, y_test = get_batch(batch_size=256)
logits = model(x_test)
predictions = mx.argmax(logits, axis=1)
accuracy = mx.mean(predictions == y_test).item()
print(f"Test accuracy: {accuracy:.2%}")

# --- Save ---
model.save_weights("cnn_model.safetensors")
print("Model saved.")
```

### Example: Transformer Block

```python
class TransformerBlock(nn.Module):
    def __init__(self, dims, num_heads, mlp_ratio=4.0):
        super().__init__()
        self.norm1 = nn.RMSNorm(dims)
        self.attn = nn.MultiHeadAttention(dims, num_heads)
        self.norm2 = nn.RMSNorm(dims)
        self.mlp = MLP_Block(dims, int(dims * mlp_ratio))
    
    def __call__(self, x, mask=None):
        # Pre-norm architecture (like Llama, Gemma)
        h = self.norm1(x)
        h = self.attn(h, h, h, mask=mask)
        x = x + h
        
        h = self.norm2(x)
        h = self.mlp(h)
        x = x + h
        return x

class MLP_Block(nn.Module):
    def __init__(self, dims, hidden_dims):
        super().__init__()
        self.gate_proj = nn.Linear(dims, hidden_dims, bias=False)
        self.up_proj = nn.Linear(dims, hidden_dims, bias=False)
        self.down_proj = nn.Linear(hidden_dims, dims, bias=False)
    
    def __call__(self, x):
        # SwiGLU activation (used in Llama, Gemma)
        return self.down_proj(nn.silu(self.gate_proj(x)) * self.up_proj(x))

# Stack multiple transformer blocks
class SmallTransformer(nn.Module):
    def __init__(self, vocab_size=32000, dims=512, num_heads=8, num_layers=6):
        super().__init__()
        self.embed = nn.Embedding(vocab_size, dims)
        self.layers = [TransformerBlock(dims, num_heads) for _ in range(num_layers)]
        self.norm = nn.RMSNorm(dims)
        self.head = nn.Linear(dims, vocab_size, bias=False)
    
    def __call__(self, tokens):
        x = self.embed(tokens)
        mask = nn.MultiHeadAttention.create_additive_causal_mask(tokens.shape[1])
        for layer in self.layers:
            x = layer(x, mask=mask)
        x = self.norm(x)
        return self.head(x)

model = SmallTransformer()
tokens = mx.random.randint(0, 32000, (1, 128))
logits = model(tokens)
mx.eval(logits)
print(f"Output shape: {logits.shape}")  # (1, 128, 32000)
```

---

See also: [[MLX-Core]] for array operations, [[MLX-LM]] for pre-trained language models, [[Fine-Tuning]] for LoRA training, [[Performance]] for optimization.
