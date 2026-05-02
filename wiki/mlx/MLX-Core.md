# MLX Core (`mlx.core`)

`mlx.core` is the foundation of the MLX framework. It provides the array type, mathematical operations, random number generation, function transforms (autodiff, vmap, JIT), and device management. If you have used NumPy, most of the API will feel immediately familiar.

```python
import mlx.core as mx
```

---

## Table of Contents

- [Array Creation](#array-creation)
- [Data Types](#data-types)
- [Array Operations](#array-operations)
- [Indexing and Slicing](#indexing-and-slicing)
- [Broadcasting](#broadcasting)
- [Lazy Evaluation](#lazy-evaluation)
- [Unified Memory Model](#unified-memory-model)
- [Function Transforms](#function-transforms)
- [Device Control](#device-control)
- [Streams and Synchronization](#streams-and-synchronization)
- [Random Number Generation](#random-number-generation)
- [Practical Examples](#practical-examples)

---

## Array Creation

MLX arrays are the core data structure. They are similar to NumPy `ndarray` or PyTorch `Tensor`.

### From Python Data

```python
import mlx.core as mx

# From a list
a = mx.array([1, 2, 3, 4])
print(a)  # array([1, 2, 3, 4], dtype=int32)

# From nested lists (2D)
b = mx.array([[1.0, 2.0], [3.0, 4.0]])
print(b.shape)  # [2, 2]
print(b.dtype)  # float32

# Specify dtype explicitly
c = mx.array([1, 2, 3], dtype=mx.float16)
```

### Factory Functions

```python
# Zeros and ones
zeros = mx.zeros((3, 4))                    # shape (3, 4), float32
ones = mx.ones((2, 3, 4), dtype=mx.int32)   # shape (2, 3, 4), int32

# Full (constant fill)
full = mx.full((3, 3), fill_value=7.0)

# Identity / eye
eye = mx.eye(4)           # 4x4 identity matrix
eye_rect = mx.eye(3, 5)   # 3x5 with ones on diagonal

# Ranges
r = mx.arange(0, 10, 2)           # [0, 2, 4, 6, 8]
lin = mx.linspace(0, 1, num=5)    # [0.0, 0.25, 0.5, 0.75, 1.0]

# Like variants (same shape/dtype as another array)
x = mx.array([[1.0, 2.0], [3.0, 4.0]])
z = mx.zeros_like(x)
o = mx.ones_like(x)
```

### From NumPy

```python
import numpy as np
import mlx.core as mx

np_arr = np.random.randn(3, 4).astype(np.float32)
mx_arr = mx.array(np_arr)

# Convert back to NumPy
np_back = np.array(mx_arr)
```

---

## Data Types

MLX supports a focused set of data types optimized for ML workloads:

| Type | MLX dtype | Bits | Use Case |
|---|---|---|---|
| Boolean | `mx.bool_` | 1 | Masks, conditions |
| 8-bit unsigned int | `mx.uint8` | 8 | Image pixel data |
| 16-bit int | `mx.int16` | 16 | Tokenizer IDs |
| 32-bit int | `mx.int32` | 32 | Default integer type |
| 64-bit int | `mx.int64` | 64 | Large indices |
| 16-bit float | `mx.float16` | 16 | Fast inference, reduced memory |
| bfloat16 | `mx.bfloat16` | 16 | Training (better dynamic range than fp16) |
| 32-bit float | `mx.float32` | 32 | Default float type, full precision |
| complex64 | `mx.complex64` | 64 | Signal processing |

### Type Casting

```python
x = mx.array([1, 2, 3], dtype=mx.int32)

# Cast to float
x_float = x.astype(mx.float32)

# Cast to half precision
x_half = x.astype(mx.float16)

# Check dtype
print(x.dtype)  # int32
```

### Tips on dtype Selection

- **Training**: Use `float32` or `bfloat16`. bfloat16 provides 2x memory savings with minimal accuracy loss.
- **Inference**: Use `float16` for maximum throughput. Quantized models (4-bit, 8-bit) are even more memory efficient.
- **Integer indices**: Use `int32` unless you need values above 2 billion, then use `int64`.

---

## Array Operations

### Arithmetic

```python
a = mx.array([1.0, 2.0, 3.0])
b = mx.array([4.0, 5.0, 6.0])

# Element-wise operations
c = a + b       # [5.0, 7.0, 9.0]
d = a * b       # [4.0, 10.0, 18.0]
e = a / b       # [0.25, 0.4, 0.5]
f = a ** 2      # [1.0, 4.0, 9.0]

# In-place style (creates new array in MLX, but same syntax)
a = a + 1       # [2.0, 3.0, 4.0]
```

### Matrix Operations

```python
A = mx.random.normal((3, 4))
B = mx.random.normal((4, 5))

# Matrix multiplication
C = A @ B                    # (3, 5)
C = mx.matmul(A, B)         # same thing

# Transpose
At = A.T                     # (4, 3)
At = mx.transpose(A)        # same thing

# Reshape
D = mx.reshape(A, (2, 6))   # (2, 6)
D = A.reshape(2, 6)         # same thing

# Element-wise math
E = mx.exp(A)
F = mx.log(mx.abs(A) + 1e-8)
G = mx.sqrt(mx.abs(A))
H = mx.sin(A)
```

### Reductions

```python
x = mx.array([[1.0, 2.0, 3.0],
               [4.0, 5.0, 6.0]])

# Sum
total = mx.sum(x)            # 21.0
row_sum = mx.sum(x, axis=1)  # [6.0, 15.0]
col_sum = mx.sum(x, axis=0)  # [5.0, 7.0, 9.0]

# Mean, min, max
mean_val = mx.mean(x)
min_val = mx.min(x)
max_val = mx.max(x, axis=1)

# Argmax / argmin
idx = mx.argmax(x, axis=1)   # [2, 2]

# Product
prod = mx.prod(x, axis=0)
```

### Comparison and Logical

```python
a = mx.array([1, 2, 3, 4])
b = mx.array([2, 2, 4, 4])

mask = a > b         # [False, False, False, False]
mask = a == b        # [False, True, False, True]
mask = a >= 3        # [False, False, True, True]

# Where (conditional select)
result = mx.where(a > 2, a, mx.zeros_like(a))  # [0, 0, 3, 4]
```

### Concatenation and Stacking

```python
a = mx.array([1, 2, 3])
b = mx.array([4, 5, 6])

# Concatenate
c = mx.concatenate([a, b])              # [1, 2, 3, 4, 5, 6]

# Stack (adds a new dimension)
d = mx.stack([a, b])                     # [[1, 2, 3], [4, 5, 6]]
e = mx.stack([a, b], axis=1)             # [[1, 4], [2, 5], [3, 6]]

# Split
parts = mx.split(c, 3)                  # [[1, 2], [3, 4], [5, 6]]
```

---

## Indexing and Slicing

MLX supports NumPy-style indexing:

```python
x = mx.array([[1, 2, 3],
               [4, 5, 6],
               [7, 8, 9]])

# Basic indexing
print(x[0])       # [1, 2, 3]
print(x[1, 2])    # 6
print(x[-1])      # [7, 8, 9]

# Slicing
print(x[0:2])     # [[1, 2, 3], [4, 5, 6]]
print(x[:, 1])    # [2, 5, 8]
print(x[1:, :2])  # [[4, 5], [7, 8]]

# Boolean indexing
mask = x > 5
result = x[mask]  # [6, 7, 8, 9]

# Fancy indexing
indices = mx.array([0, 2])
print(x[indices])  # [[1, 2, 3], [7, 8, 9]]
```

### Important Note on Mutability

MLX arrays are immutable. You cannot do in-place assignment like `x[0] = 5`. Instead, use functional approaches:

```python
# Instead of x[0] = 99, use mx.where or reconstruct
x = mx.array([1, 2, 3, 4])
mask = mx.array([True, False, False, False])
x = mx.where(mask, mx.array([99, 0, 0, 0]), x)  # [99, 2, 3, 4]
```

---

## Broadcasting

MLX follows NumPy broadcasting rules. Arrays with different shapes can be combined if their dimensions are compatible (equal, or one of them is 1):

```python
# Scalar broadcast
a = mx.array([[1, 2], [3, 4]])
b = a + 10  # [[11, 12], [13, 14]]

# Row vector broadcast
row = mx.array([10, 20])
c = a + row  # [[11, 22], [13, 24]]

# Column vector broadcast
col = mx.array([[100], [200]])
d = a + col  # [[101, 102], [203, 204]]

# Broadcasting rules: shapes (3, 1) and (1, 4) -> (3, 4)
e = mx.ones((3, 1)) + mx.ones((1, 4))  # shape (3, 4)
```

---

## Lazy Evaluation

This is one of the most important concepts in MLX. Computations are recorded but not executed until you explicitly request results.

### Why Lazy?

1. **Graph optimization**: MLX can fuse operations, eliminate redundant computation, and optimize memory.
2. **Reduced overhead**: Many small operations are batched into fewer GPU kernel launches.
3. **Flexibility**: You build the computation graph freely, then execute it all at once.

### Forcing Evaluation

```python
import mlx.core as mx

a = mx.ones((1000, 1000))
b = mx.ones((1000, 1000))
c = a + b            # Nothing computed yet
d = c * 2            # Still nothing
e = mx.sum(d)        # Still lazy

# Method 1: mx.eval() - explicit evaluation
mx.eval(e)
print(e)  # 4000000.0

# Method 2: Converting to Python scalar
value = e.item()     # Forces evaluation and returns Python float

# Method 3: print() forces evaluation
print(mx.sum(a))     # Forces evaluation to print the result

# Method 4: Converting to NumPy forces evaluation
import numpy as np
np_arr = np.array(c)  # Forces evaluation
```

### Evaluating Multiple Arrays

```python
# Evaluate multiple arrays at once (more efficient)
x = mx.random.normal((100, 100))
y = x @ x.T
z = mx.sum(y)

mx.eval(y, z)  # Evaluates both in one pass
```

### Common Pitfall

```python
# BAD: Evaluating in a tight loop
for i in range(1000):
    x = x + 1
    mx.eval(x)  # Slow - forces a GPU sync each iteration

# GOOD: Let operations accumulate, evaluate less often
for i in range(1000):
    x = x + 1
mx.eval(x)  # One evaluation at the end

# GOOD: Or evaluate every N steps in training
for i in range(1000):
    loss, grads = loss_and_grad_fn(model, batch_x, batch_y)
    optimizer.update(model, grads)
    if i % 10 == 0:
        mx.eval(model.parameters(), optimizer.state)
```

---

## Unified Memory Model

On Apple Silicon, CPU and GPU share the same physical memory (DRAM). MLX takes full advantage of this:

```python
import mlx.core as mx

# Create an array - it exists in unified memory
x = mx.random.normal((1024, 1024))

# The same physical memory is accessible from CPU and GPU
# No copies, no transfers, no PCIe bottleneck

# Operations specify which device to use, but data stays put
y = mx.matmul(x, x, stream=mx.gpu)   # GPU computes, same memory
z = mx.sum(y, stream=mx.cpu)          # CPU computes, same memory
```

### Implications

- **No `.to(device)` calls**: Unlike PyTorch where you call `tensor.cuda()` or `tensor.to("mps")`, MLX arrays are always available on all devices.
- **No OOM from transfers**: You never waste memory on duplicate copies.
- **Seamless fallback**: If an operation is faster on CPU, use CPU. If faster on GPU, use GPU. The data is already there.

---

## Function Transforms

Function transforms are composable higher-order functions that transform other functions. This is where MLX draws heavily from JAX's design philosophy.

### Automatic Differentiation (`mx.grad`)

```python
import mlx.core as mx

# Simple gradient
def f(x):
    return mx.sum(x ** 2)

grad_f = mx.grad(f)
x = mx.array([1.0, 2.0, 3.0])
print(grad_f(x))  # [2.0, 4.0, 6.0]

# Gradient with respect to specific argument
def loss(w, x, y):
    pred = w @ x
    return mx.mean((pred - y) ** 2)

grad_loss = mx.grad(loss, argnums=0)  # Gradient w.r.t. first arg (w)
```

### Value and Gradient (`mx.value_and_grad`)

Often you need both the loss value and the gradients:

```python
def loss_fn(w, x, y):
    pred = w @ x
    return mx.mean((pred - y) ** 2)

value_and_grad_fn = mx.value_and_grad(loss_fn, argnums=0)

w = mx.random.normal((5, 3))
x = mx.random.normal((3, 10))
y = mx.random.normal((5, 10))

loss_value, grad_w = value_and_grad_fn(w, x, y)
print(f"Loss: {loss_value.item():.4f}")
print(f"Gradient shape: {grad_w.shape}")
```

### Vectorization (`mx.vmap`)

Automatically vectorize a function to operate over a batch dimension:

```python
def single_dot(a, b):
    """Dot product of two 1D vectors."""
    return mx.sum(a * b)

# Vectorize over the first dimension of both inputs
batched_dot = mx.vmap(single_dot)

A = mx.random.normal((10, 5))  # 10 vectors of dim 5
B = mx.random.normal((10, 5))

result = batched_dot(A, B)  # 10 dot products at once
print(result.shape)  # [10]

# Specify which axes to vectorize over
batched_dot_2 = mx.vmap(single_dot, in_axes=(0, 0))  # Both along axis 0
```

### JIT Compilation (`mx.compile`)

Compile a function for faster repeated execution:

```python
def slow_fn(x):
    for _ in range(10):
        x = mx.sin(x) + mx.cos(x)
    return x

# Compile the function
fast_fn = mx.compile(slow_fn)

x = mx.random.normal((1000,))

# First call compiles (may be slower)
result = fast_fn(x)
mx.eval(result)

# Subsequent calls use the compiled version (faster)
result = fast_fn(x)
mx.eval(result)
```

### Composing Transforms

Transforms compose naturally:

```python
def f(x):
    return mx.sum(mx.sin(x))

# Gradient of a compiled function
fast_grad = mx.compile(mx.grad(f))

# Second derivative
second_grad = mx.grad(mx.grad(f))

# Vectorized gradient
batched_grad = mx.vmap(mx.grad(f))
```

---

## Device Control

### Setting the Default Device

```python
import mlx.core as mx

# Check default device
print(mx.default_device())  # gpu (on Apple Silicon)

# Set default device
mx.set_default_device(mx.gpu)  # Use GPU for all operations
mx.set_default_device(mx.cpu)  # Use CPU for all operations
```

### Per-Operation Device Selection

```python
# Run specific operations on a specific device using streams
x = mx.random.normal((100, 100))

# GPU computation
y = mx.matmul(x, x, stream=mx.gpu)

# CPU computation
z = mx.sum(y, stream=mx.cpu)
```

### When to Use CPU vs GPU

- **GPU**: Matrix multiplications, convolutions, large element-wise operations, attention computations.
- **CPU**: Small operations, data preprocessing, operations with many branches, I/O-bound work.

---

## Streams and Synchronization

Streams allow concurrent execution and fine-grained control over operation scheduling:

```python
import mlx.core as mx

# Default streams
gpu_stream = mx.default_stream(mx.gpu)
cpu_stream = mx.default_stream(mx.cpu)

# Create a custom stream
s = mx.Stream(mx.gpu)

# Run operations on a specific stream
x = mx.random.normal((100, 100))
y = mx.matmul(x, x, stream=s)

# Operations on different streams can run concurrently
# Operations on the same stream run in order

# Synchronize (wait for all pending operations)
mx.eval(y)  # Waits for y to be computed
```

### Stream Context Manager

```python
# Temporarily change the default stream
with mx.stream(mx.cpu):
    # All operations here use CPU
    result = mx.sum(mx.ones((100,)))

# Back to default (GPU)
```

---

## Random Number Generation

MLX uses a functional random number generator with explicit key management:

```python
import mlx.core as mx

# Generate random numbers
normal = mx.random.normal((3, 4))                    # Standard normal
uniform = mx.random.uniform(shape=(3, 4))             # Uniform [0, 1)
uniform_range = mx.random.uniform(low=-1, high=1, shape=(3, 4))
integers = mx.random.randint(0, 10, shape=(5,))       # Random integers
bernoulli = mx.random.bernoulli(0.5, shape=(10,))     # Coin flips

# Set seed for reproducibility
mx.random.seed(42)
a = mx.random.normal((3,))

mx.random.seed(42)
b = mx.random.normal((3,))
# a and b are identical

# Manual key management
key = mx.random.key(42)
key1, key2 = mx.random.split(key)
sample1 = mx.random.normal((3,), key=key1)
sample2 = mx.random.normal((3,), key=key2)
```

### Distributions

```python
# Categorical sampling
logits = mx.array([1.0, 2.0, 0.5])
samples = mx.random.categorical(logits, num_samples=1000)

# Truncated normal
trunc = mx.random.truncated_normal(lower=-2.0, upper=2.0, shape=(100,))

# Gumbel (useful for Gumbel-softmax trick)
gumbel = mx.random.gumbel(shape=(10,))
```

---

## Practical Examples

### Example 1: Linear Regression from Scratch

```python
import mlx.core as mx

# Generate synthetic data
mx.random.seed(0)
N = 100
true_w = mx.array([2.0, -3.5])
true_b = mx.array([1.0])

X = mx.random.normal((N, 2))
y = X @ true_w + true_b + mx.random.normal((N,)) * 0.1

# Initialize parameters
w = mx.random.normal((2,))
b = mx.zeros((1,))

def loss_fn(w, b, X, y):
    pred = X @ w + b
    return mx.mean((pred - y) ** 2)

grad_fn = mx.grad(loss_fn, argnums=(0, 1))

# Training loop
lr = 0.1
for step in range(100):
    grad_w, grad_b = grad_fn(w, b, X, y)
    w = w - lr * grad_w
    b = b - lr * grad_b
    
    if step % 20 == 0:
        loss = loss_fn(w, b, X, y)
        mx.eval(loss, w, b)
        print(f"Step {step}: loss={loss.item():.4f}, w={w.tolist()}, b={b.item():.4f}")

# Final: w should be close to [2.0, -3.5], b close to 1.0
```

### Example 2: Softmax Attention

```python
import mlx.core as mx

def attention(Q, K, V, mask=None):
    """Scaled dot-product attention."""
    d_k = Q.shape[-1]
    scores = (Q @ K.T) / mx.sqrt(mx.array(d_k, dtype=mx.float32))
    
    if mask is not None:
        scores = mx.where(mask, scores, mx.array(float('-inf')))
    
    weights = mx.softmax(scores, axis=-1)
    return weights @ V

# Example usage
seq_len, d_model = 10, 64
Q = mx.random.normal((seq_len, d_model))
K = mx.random.normal((seq_len, d_model))
V = mx.random.normal((seq_len, d_model))

output = attention(Q, K, V)
mx.eval(output)
print(f"Attention output shape: {output.shape}")  # [10, 64]
```

### Example 3: Image Convolution

```python
import mlx.core as mx

# Simple edge detection using convolution
def conv2d_manual(image, kernel):
    """Manual 2D convolution for demonstration."""
    # image: (H, W), kernel: (kH, kW)
    kH, kW = kernel.shape
    H, W = image.shape
    oH, oW = H - kH + 1, W - kW + 1
    
    # Use as_strided for efficient windowing (simplified)
    output = mx.zeros((oH, oW))
    patches = []
    for i in range(oH):
        for j in range(oW):
            patch = image[i:i+kH, j:j+kW]
            patches.append(mx.sum(patch * kernel))
    
    return mx.array(patches).reshape(oH, oW)

# Sobel edge detection kernel
sobel_x = mx.array([[-1, 0, 1],
                     [-2, 0, 2],
                     [-1, 0, 1]], dtype=mx.float32)

image = mx.random.normal((32, 32))
edges = conv2d_manual(image, sobel_x)
mx.eval(edges)
print(f"Edge map shape: {edges.shape}")
```

---

## Quick Reference

| Operation | MLX | NumPy Equivalent |
|---|---|---|
| Create array | `mx.array([1,2,3])` | `np.array([1,2,3])` |
| Zeros | `mx.zeros((3,4))` | `np.zeros((3,4))` |
| Random normal | `mx.random.normal((3,4))` | `np.random.randn(3,4)` |
| Matrix multiply | `a @ b` or `mx.matmul(a,b)` | `a @ b` |
| Sum | `mx.sum(x, axis=0)` | `np.sum(x, axis=0)` |
| Reshape | `x.reshape(2,3)` | `x.reshape(2,3)` |
| Transpose | `x.T` | `x.T` |
| Type cast | `x.astype(mx.float16)` | `x.astype(np.float16)` |
| Gradient | `mx.grad(f)(x)` | N/A |
| JIT compile | `mx.compile(f)` | N/A |
| Evaluate | `mx.eval(x)` | N/A (eager) |

See also: [[MLX-NN]] for neural network modules, [[Performance]] for optimization tips.
