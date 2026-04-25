# MLX-Data: Data Loading and Pipelines

`mlx-data` is a data loading and processing library designed to work seamlessly with MLX. It provides efficient, composable data pipelines for training machine learning models, with support for text, image, and audio data.

```bash
pip install mlx-data
```

---

## Table of Contents

- [Installation](#installation)
- [Core Concepts: Buffer and Stream](#core-concepts-buffer-and-stream)
- [Loading Data from Files](#loading-data-from-files)
- [Data Transformations](#data-transformations)
- [Text Data Pipelines](#text-data-pipelines)
- [Image Data Pipelines](#image-data-pipelines)
- [Integration with Training Loops](#integration-with-training-loops)
- [Loading from HuggingFace](#loading-from-huggingface)
- [Performance Tips](#performance-tips)
- [Complete Examples](#complete-examples)

---

## Installation

```bash
pip install mlx-data

# Verify
python -c "import mlx.data as dx; print('mlx-data installed')"
```

### Requirements

- macOS 13.5+ with Apple Silicon
- Python 3.9+
- MLX core (installed as dependency)

---

## Core Concepts: Buffer and Stream

`mlx-data` has two primary abstractions for data loading:

### Buffer

A **Buffer** holds an entire dataset in memory. It is best for small to medium datasets that fit comfortably in RAM.

```python
import mlx.data as dx

# Create a buffer from a list of dicts
data = [
    {"text": "Hello world", "label": 0},
    {"text": "Machine learning is great", "label": 1},
    {"text": "Apple Silicon is fast", "label": 1},
]

buffer = dx.buffer_from_vector(data)

# Buffer operations are chainable
pipeline = (
    buffer
    .shuffle()
    .batch(2)
)

# Iterate
for batch in pipeline:
    print(batch["text"])
    print(batch["label"])
```

### Stream

A **Stream** processes data lazily, one sample at a time. It is best for large datasets that do not fit in memory, or when streaming from disk/network.

```python
import mlx.data as dx

# Create a stream from a file
stream = dx.stream_line_reader("data.txt", "text")

# Stream operations are also chainable
pipeline = (
    stream
    .shuffle(buffer_size=1000)  # Shuffle with a buffer
    .batch(32)
    .prefetch(prefetch_size=4, num_threads=4)
)

for batch in pipeline:
    process(batch)
```

### When to Use Which

| | Buffer | Stream |
|---|---|---|
| Dataset size | Fits in memory | Any size |
| Shuffling | True random shuffle | Approximate (buffer-based) |
| Random access | Yes | No (sequential only) |
| Epoch boundaries | Clear | Manual |
| Best for | Small/medium datasets | Large files, streaming data |

---

## Loading Data from Files

### JSON Lines (JSONL)

The most common format for text/NLP data:

```python
import mlx.data as dx

# data.jsonl contains one JSON object per line:
# {"text": "First example", "label": 0}
# {"text": "Second example", "label": 1}

# As a buffer (loads all into memory)
buffer = dx.buffer_from_vector(
    [json.loads(line) for line in open("data.jsonl")]
)

# As a stream (lazy loading)
stream = dx.stream_line_reader("data.jsonl", "line")
```

### CSV Files

```python
import mlx.data as dx
import csv

# Load CSV into a buffer
with open("data.csv") as f:
    reader = csv.DictReader(f)
    data = list(reader)

buffer = dx.buffer_from_vector(data)
```

### Image Files from Directory

```python
import mlx.data as dx
import os

# Load images from a directory structure:
# images/
#   class_0/
#     img001.jpg
#     img002.jpg
#   class_1/
#     img003.jpg

# Build a list of {path, label} dicts
samples = []
for label, class_name in enumerate(sorted(os.listdir("images"))):
    class_dir = os.path.join("images", class_name)
    if os.path.isdir(class_dir):
        for fname in os.listdir(class_dir):
            samples.append({
                "file": os.path.join(class_dir, fname).encode(),
                "label": label
            })

buffer = dx.buffer_from_vector(samples)
pipeline = (
    buffer
    .shuffle()
    .load_image("file", output_key="image")
    .image_resize("image", h=224, w=224)
    .key_transform("image", lambda x: x.astype("float32") / 255.0)
    .batch(32)
)
```

### NumPy Files

```python
import mlx.data as dx
import mlx.core as mx
import numpy as np

# Load preprocessed NumPy data
X = np.load("features.npy")
y = np.load("labels.npy")

# Convert to list of dicts for buffer
data = [{"x": X[i], "y": int(y[i])} for i in range(len(X))]
buffer = dx.buffer_from_vector(data)
```

---

## Data Transformations

Transformations are applied lazily and compose into an efficient pipeline:

### Shuffling

```python
# Buffer: true random shuffle
pipeline = buffer.shuffle()

# Stream: approximate shuffle with buffer
pipeline = stream.shuffle(buffer_size=10000)
# Larger buffer_size = better randomness, more memory
```

### Batching

```python
# Fixed batch size
pipeline = buffer.batch(32)

# Pad sequences to the same length within a batch
pipeline = buffer.batch(32, pad={"text": 0})  # Pad with 0

# Drop incomplete last batch
pipeline = buffer.batch(32, drop_last=True)
```

### Prefetching

```python
# Load batches ahead of time in background threads
pipeline = (
    buffer
    .shuffle()
    .batch(32)
    .prefetch(prefetch_size=8, num_threads=4)
)
```

### Key Transforms

```python
# Apply a function to a specific key
pipeline = buffer.key_transform("text", lambda x: x.lower())

# Rename a key
pipeline = buffer.rename_key("old_name", "new_name")

# Select specific keys
pipeline = buffer.select_keys(["text", "label"])
```

### Image Transformations

```python
pipeline = (
    buffer
    .load_image("file", output_key="image")
    .image_resize("image", h=256, w=256)
    .image_center_crop("image", h=224, w=224)
    .image_random_crop("image", h=224, w=224)    # For training
    .image_random_horizontal_flip("image")         # For training
    .key_transform("image", lambda x: x.astype("float32") / 255.0)
)
```

### Sample Filtering

```python
# Filter samples based on a condition
pipeline = buffer.sample_transform(
    lambda sample: sample if len(sample["text"]) > 10 else None
)
```

---

## Text Data Pipelines

### Tokenization for Language Models

```python
import mlx.data as dx
from transformers import AutoTokenizer
import json

# Load tokenizer
tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.2-3B-Instruct")

# Load JSONL data
data = [json.loads(line) for line in open("train.jsonl")]
buffer = dx.buffer_from_vector(data)

def tokenize_sample(sample):
    """Tokenize a single sample."""
    text = sample["text"]
    if isinstance(text, bytes):
        text = text.decode("utf-8")
    tokens = tokenizer.encode(text, add_special_tokens=True)
    return {
        "input_ids": tokens,
        "length": len(tokens)
    }

pipeline = (
    buffer
    .shuffle()
    .sample_transform(tokenize_sample)
    .batch(8)
    .prefetch(prefetch_size=4, num_threads=2)
)

for batch in pipeline:
    input_ids = batch["input_ids"]
    # Process batch...
```

### Fixed-Length Sequences (for Pre-training)

```python
import mlx.data as dx
from transformers import AutoTokenizer
import json

tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.2-3B-Instruct")
SEQ_LEN = 512

data = [json.loads(line) for line in open("pretrain_data.jsonl")]
buffer = dx.buffer_from_vector(data)

def tokenize_and_chunk(sample):
    """Tokenize and split into fixed-length chunks."""
    text = sample["text"]
    if isinstance(text, bytes):
        text = text.decode("utf-8")
    tokens = tokenizer.encode(text)
    
    # Split into chunks of SEQ_LEN
    chunks = []
    for i in range(0, len(tokens) - SEQ_LEN, SEQ_LEN):
        chunk = tokens[i:i + SEQ_LEN + 1]  # +1 for next-token target
        chunks.append({
            "input_ids": chunk[:-1],
            "labels": chunk[1:]
        })
    return chunks

# Flatten chunks from all documents
all_chunks = []
for sample in data:
    all_chunks.extend(tokenize_and_chunk(sample))

chunk_buffer = dx.buffer_from_vector(all_chunks)
pipeline = (
    chunk_buffer
    .shuffle()
    .batch(16)
    .prefetch(prefetch_size=4, num_threads=2)
)
```

### Chat Format Dataset

```python
import json
from transformers import AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.2-3B-Instruct")

def format_chat(sample):
    """Format a sample as a chat conversation."""
    messages = [
        {"role": "user", "content": sample["question"]},
        {"role": "assistant", "content": sample["answer"]}
    ]
    text = tokenizer.apply_chat_template(messages, tokenize=False)
    tokens = tokenizer.encode(text)
    return {"input_ids": tokens, "length": len(tokens)}
```

---

## Image Data Pipelines

### Image Classification Pipeline

```python
import mlx.data as dx
import mlx.core as mx

# Assume samples is a list of {"file": b"path/to/image.jpg", "label": int}
buffer = dx.buffer_from_vector(samples)

# Training pipeline with augmentation
train_pipeline = (
    buffer
    .shuffle()
    .load_image("file", output_key="image")
    .image_resize("image", h=256, w=256)
    .image_random_crop("image", h=224, w=224)
    .image_random_horizontal_flip("image")
    .key_transform("image", lambda x: (x.astype("float32") / 255.0 - 0.5) / 0.5)
    .batch(32)
    .prefetch(prefetch_size=8, num_threads=4)
)

# Validation pipeline (no augmentation)
val_pipeline = (
    val_buffer
    .load_image("file", output_key="image")
    .image_resize("image", h=256, w=256)
    .image_center_crop("image", h=224, w=224)
    .key_transform("image", lambda x: (x.astype("float32") / 255.0 - 0.5) / 0.5)
    .batch(64)
    .prefetch(prefetch_size=4, num_threads=2)
)
```

---

## Integration with Training Loops

### Basic Training Integration

```python
import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import mlx.data as dx

# Setup model and optimizer
model = MyModel()
optimizer = optim.Adam(learning_rate=1e-3)

def loss_fn(model, batch):
    logits = model(mx.array(batch["input_ids"]))
    targets = mx.array(batch["labels"])
    return nn.losses.cross_entropy(logits, targets, reduction="mean")

loss_and_grad_fn = nn.value_and_grad(model, loss_fn)

# Setup data pipeline
buffer = dx.buffer_from_vector(training_data)
pipeline = (
    buffer
    .shuffle()
    .batch(32)
    .prefetch(prefetch_size=4, num_threads=2)
)

# Training loop
num_epochs = 10
for epoch in range(num_epochs):
    epoch_loss = 0
    num_batches = 0
    
    for batch in pipeline:
        loss, grads = loss_and_grad_fn(model, batch)
        optimizer.update(model, grads)
        mx.eval(model.parameters(), optimizer.state)
        
        epoch_loss += loss.item()
        num_batches += 1
    
    print(f"Epoch {epoch}: avg_loss={epoch_loss/num_batches:.4f}")
```

### Multi-Epoch with Re-shuffling

```python
for epoch in range(num_epochs):
    # Create a fresh shuffled pipeline each epoch
    epoch_pipeline = (
        buffer
        .shuffle()  # Re-shuffle for each epoch
        .batch(32)
        .prefetch(prefetch_size=4, num_threads=2)
    )
    
    for batch in epoch_pipeline:
        # Training step...
        pass
```

---

## Loading from HuggingFace

You can use the `datasets` library alongside `mlx-data`:

```python
from datasets import load_dataset
import mlx.data as dx

# Load a HuggingFace dataset
hf_dataset = load_dataset("squad", split="train")

# Convert to list of dicts for mlx-data
data = [
    {
        "context": sample["context"],
        "question": sample["question"],
        "answer": sample["answers"]["text"][0]
    }
    for sample in hf_dataset
]

buffer = dx.buffer_from_vector(data)
pipeline = (
    buffer
    .shuffle()
    .batch(16)
    .prefetch(prefetch_size=4, num_threads=2)
)
```

### Streaming from HuggingFace

```python
from datasets import load_dataset

# Stream a large dataset without downloading everything
hf_stream = load_dataset("allenai/c4", "en", split="train", streaming=True)

# Process in chunks
batch_data = []
for i, sample in enumerate(hf_stream):
    batch_data.append({"text": sample["text"]})
    
    if len(batch_data) >= 10000:
        buffer = dx.buffer_from_vector(batch_data)
        # Process this chunk...
        batch_data = []
    
    if i >= 100000:  # Limit for demo
        break
```

---

## Performance Tips

### 1. Use Prefetching

Always add prefetching at the end of your pipeline to overlap data loading with computation:

```python
pipeline = (
    buffer
    .shuffle()
    .batch(32)
    .prefetch(prefetch_size=8, num_threads=4)  # 8 batches ahead, 4 threads
)
```

### 2. Choose Buffer Size Wisely

For streams, the shuffle buffer size trades memory for randomness:

```python
# Small dataset: load entirely
pipeline = buffer.shuffle()  # True shuffle

# Large dataset: use a generous buffer
pipeline = stream.shuffle(buffer_size=50000)  # 50K sample buffer
```

### 3. Minimize Python Callbacks

Each `sample_transform` or `key_transform` calls back into Python, which is slow. Pre-process data when possible:

```python
# SLOWER: tokenize in the pipeline
pipeline = buffer.sample_transform(tokenize_fn).batch(32)

# FASTER: pre-tokenize all data, then pipeline
tokenized_data = [tokenize_fn(sample) for sample in data]
buffer = dx.buffer_from_vector(tokenized_data)
pipeline = buffer.shuffle().batch(32)
```

### 4. Use Appropriate Batch Sizes

Larger batches improve throughput but use more memory:

```python
# For training (maximize GPU utilization)
train_pipeline = buffer.batch(64)

# For evaluation (can often use larger batches)
eval_pipeline = buffer.batch(256)
```

### 5. Memory-Map Large Files

For very large datasets, use memory-mapped access:

```python
# Memory-mapped NumPy arrays
import numpy as np
data = np.load("large_dataset.npy", mmap_mode="r")
```

### 6. Profile Your Pipeline

Check if data loading is the bottleneck:

```python
import time

pipeline = buffer.shuffle().batch(32).prefetch(prefetch_size=8, num_threads=4)

# Time data loading
start = time.time()
for i, batch in enumerate(pipeline):
    if i >= 100:
        break
data_time = time.time() - start
print(f"100 batches loaded in {data_time:.2f}s ({data_time/100*1000:.1f}ms/batch)")
```

---

## Complete Examples

### End-to-End Text Classification Pipeline

```python
import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import mlx.data as dx
from transformers import AutoTokenizer
import json

# --- Data Setup ---
tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")
MAX_LEN = 128

# Load data
with open("train.jsonl") as f:
    train_data = [json.loads(line) for line in f]

# Pre-tokenize
def tokenize(sample):
    tokens = tokenizer.encode(
        sample["text"] if isinstance(sample["text"], str) else sample["text"].decode(),
        max_length=MAX_LEN,
        truncation=True,
        padding="max_length"
    )
    return {"input_ids": tokens, "label": sample["label"]}

tokenized_data = [tokenize(s) for s in train_data]

# Create pipeline
buffer = dx.buffer_from_vector(tokenized_data)
train_pipeline = (
    buffer
    .shuffle()
    .batch(32)
    .prefetch(prefetch_size=4, num_threads=2)
)

# --- Model ---
class TextClassifier(nn.Module):
    def __init__(self, vocab_size, dims, num_classes):
        super().__init__()
        self.embed = nn.Embedding(vocab_size, dims)
        self.fc1 = nn.Linear(dims, dims)
        self.fc2 = nn.Linear(dims, num_classes)
    
    def __call__(self, input_ids):
        x = self.embed(input_ids)
        x = mx.mean(x, axis=1)  # Simple mean pooling
        x = nn.relu(self.fc1(x))
        return self.fc2(x)

model = TextClassifier(tokenizer.vocab_size, 256, num_classes=2)
optimizer = optim.Adam(learning_rate=1e-3)

def loss_fn(model, batch):
    logits = model(mx.array(batch["input_ids"]))
    labels = mx.array(batch["label"])
    return nn.losses.cross_entropy(logits, labels, reduction="mean")

loss_and_grad_fn = nn.value_and_grad(model, loss_fn)

# --- Training ---
for epoch in range(5):
    total_loss = 0
    n = 0
    
    epoch_pipeline = buffer.shuffle().batch(32).prefetch(4, 2)
    
    for batch in epoch_pipeline:
        loss, grads = loss_and_grad_fn(model, batch)
        optimizer.update(model, grads)
        mx.eval(model.parameters(), optimizer.state)
        total_loss += loss.item()
        n += 1
    
    print(f"Epoch {epoch}: loss={total_loss/n:.4f}")

model.save_weights("text_classifier.safetensors")
```

---

See also: [[MLX-Core]] for array operations, [[MLX-NN]] for model building, [[Fine-Tuning]] for LoRA training pipelines, [[Performance]] for optimization.
