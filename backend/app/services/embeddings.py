"""
Text embeddings — BAAI/bge-small-en-v1.5 (384 dimensions).

Uses fastembed (ONNX, CPU-only). No API key, no usage limits.
Model files (~70 MB) are downloaded once on first use and cached to disk.

Optional env var:
    EMBEDDING_CACHE_DIR — where to cache model files
                          (default: ~/.cache/rag_fastembed)

Public functions:
    generate_embedding(text)         -> list[float]  (single text)
    generate_embeddings(texts, ...)  -> list[list[float]]  (batch)
"""

import logging
import os
import threading

logger = logging.getLogger(__name__)

MODEL_NAME = "BAAI/bge-small-en-v1.5"
EXPECTED_DIMENSION = 384

# Module-level singleton so the model is loaded once per process.
_model = None
_lock = threading.Lock()


def _get_model():
    """
    Load the fastembed model on first call, then reuse it.

    Loading is deferred to first use (not at import time) because Celery
    forks worker processes — each fork must load its own model copy after
    the fork, not inherit a pre-fork file handle.
    """
    global _model

    if _model is None:
        with _lock:
            if _model is None:  # second check inside the lock
                from fastembed import TextEmbedding

                cache_dir = os.getenv("EMBEDDING_CACHE_DIR") or os.path.join(
                    os.path.expanduser("~"), ".cache", "rag_fastembed"
                )
                os.makedirs(cache_dir, exist_ok=True)

                logger.info("Loading embedding model: %s", MODEL_NAME)
                _model = TextEmbedding(model_name=MODEL_NAME, cache_dir=cache_dir)

    return _model


def generate_embeddings(texts: list[str], batch_size: int = 20) -> list[list[float]]:
    """Embed a list of texts. Returns one vector (384 floats) per text."""
    if not texts:
        return []

    vectors = [
        vector.tolist()
        for vector in _get_model().embed(texts, batch_size=batch_size)
    ]

    # Sanity check: the model must always return exactly 384 dimensions.
    for vector in vectors:
        if len(vector) != EXPECTED_DIMENSION:
            raise ValueError(
                f"Embedding dimension mismatch: expected {EXPECTED_DIMENSION}, "
                f"got {len(vector)}"
            )

    return vectors


def generate_embedding(text: str) -> list[float]:
    """Embed a single text string. Returns a list of 384 floats."""
    return generate_embeddings([text], batch_size=1)[0]
