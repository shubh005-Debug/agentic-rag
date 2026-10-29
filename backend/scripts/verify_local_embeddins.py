"""
Check that the local embedding model produces the same vectors as the ones
already stored in your database (they were created earlier with the Hugging Face API).

Uses only Supabase and the local model.
Chunk text is never printed.

Run from the backend folder (venv active, after: pip install fastembed):

    python -m scripts.verify_local_embeddings
    python -m scripts.verify_local_embeddings --count 12
"""

import argparse
import json
import math
import time

from app.database.supabase import supabase
from app.services.embeddings import EXPECTED_DIMENSION, generate_embeddings

PASS_AT = 0.99     # same model on a different runtime: normally 0.999 or better
WARN_AT = 0.95


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


def stored_vector(value):
    # PostgREST returns a pgvector column as text such as "[0.01,0.02,...]"
    return json.loads(value) if isinstance(value, str) else list(value)


def verdict(similarities):
    lowest = min(similarities)
    if lowest >= PASS_AT:
        return "PASS: local vectors match the stored ones. Existing vectors stay valid, no re-embedding needed."
    if lowest >= WARN_AT:
        return "WARN: close but not identical. Retrieval should still work; tell me the numbers."
    return "FAIL: the vectors differ. Do NOT mix them; tell me the numbers before changing anything."


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=8)
    args = parser.parse_args(argv)

    rows = (
        supabase.table("document_chunks")
        .select("id, content, embedding")
        .not_.is_("embedding", "null")
        .limit(args.count)
        .execute()
        .data
    )

    if not rows:
        print("No chunks with embeddings found in the database. Upload and process a document first.")
        return 1

    print(f"Embedding {len(rows)} stored chunks with the local model (first run downloads about 70 MB)...")
    started = time.time()
    local = generate_embeddings([row["content"] for row in rows])
    elapsed = time.time() - started

    similarities = []
    for row, vector in zip(rows, local):
        stored = stored_vector(row["embedding"])
        if len(stored) != EXPECTED_DIMENSION or len(vector) != EXPECTED_DIMENSION:
            print(f"  chunk {row['id'][:8]}: dimension mismatch (stored {len(stored)}, local {len(vector)})")
            return 1
        similarities.append(cosine(stored, vector))
        print(f"  chunk {row['id'][:8]}  cosine similarity = {similarities[-1]:.5f}")

    print(f"\nlowest = {min(similarities):.5f}   average = {sum(similarities) / len(similarities):.5f}   "
          f"time = {elapsed:.1f}s for {len(rows)} chunks (includes model loading)")
    print(verdict(similarities))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())