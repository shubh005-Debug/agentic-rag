"""
Text embeddings: BAAI/bge-small-en-v1.5 (384 dimensions), run locally.

Uses fastembed (ONNX, CPU only, no PyTorch, no API key, no usage limits).
The model files (about 70 MB) are downloaded once on first use and then
reused from disk.

Optional: EMBEDDING_CACHE_DIR = where the model files are stored
          (default: ~/.cache/rag_fastembed, outside the project).
"""

import logging
import os
import threading

logger = logging.getLogger(__name__)

MODEL_NAME = "BAAI/bge-small-en-v1.5"
EXPECTED_DIMENSION = 384

_model = None
_lock = threading.Lock()


def _get_model():
    """
    Load the model on first use (not at import), once per process.
    Loading lazily keeps Celery's forked worker processes safe: each one
    loads its own copy after the fork.
    """
    global _model

    if _model is None:
        with _lock:
            if _model is None:
                from fastembed import TextEmbedding

                cache_dir = os.getenv("EMBEDDING_CACHE_DIR") or os.path.join(
                    os.path.expanduser("~"), ".cache", "rag_fastembed"
                )
                os.makedirs(cache_dir, exist_ok=True)

                logger.info("Loading embedding model %s", MODEL_NAME)

                _model = TextEmbedding(
                    model_name=MODEL_NAME,
                    cache_dir=cache_dir
                )

    return _model


def generate_embeddings(
    texts: list[str],
    batch_size: int = 20
):
    """Embed a list of texts. Returns one list of 384 floats per text."""
    if not texts:
        return []

    vectors = [
        vector.tolist()
        for vector in _get_model().embed(texts, batch_size=batch_size)
    ]

    for vector in vectors:
        if len(vector) != EXPECTED_DIMENSION:
            raise ValueError(
                f"Embedding has {len(vector)} dimensions, expected {EXPECTED_DIMENSION}"
            )

    return vectors


def generate_embedding(text: str):
    """Embed a single text. Returns a list of 384 floats."""
    return generate_embeddings([text], batch_size=1)[0]