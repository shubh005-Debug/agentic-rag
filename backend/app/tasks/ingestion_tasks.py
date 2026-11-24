"""
Celery task: process_document

Runs after a document is uploaded to Supabase Storage.
Steps:
  1. Set document status → "processing"
  2. Download the file from Supabase Storage
  3. Parse and chunk using Unstructured (multimodal: text, tables, images)
     Falls back to the PyMuPDF-based structured chunker for PDFs if
     Unstructured fails or returns nothing.
  4. Generate embeddings for all chunk contents
  5. Upload any extracted images to Supabase Storage
  6. Delete old chunks (makes the task safe to re-run) and insert new ones
  7. Update document → status="processed", total_chunks, element_counts
  8. Queue the summarisation task (if SUMMARY_ENABLED=true)
  9. On any failure → set document status to "failed" and re-raise
"""

import base64
import os
import tempfile
from collections import Counter
from pathlib import Path

from celery.utils.log import get_task_logger

from celery_app import celery_app
from app.database.supabase import supabase
from app.services.embeddings import generate_embeddings
from app.services.unstructured_parser import chunk_document_multimodal
from app.tasks.summary_tasks import summaries_enabled, summarize_document

logger = get_task_logger(__name__)

STORAGE_BUCKET = "documents"
INSERT_BATCH_SIZE = 100  # rows per Supabase insert call

SUPPORTED_EXTENSIONS = {
    ".pdf", ".docx", ".pptx", ".txt", ".csv", ".xlsx", ".html", ".htm",
}

# Maps MIME types to file extensions for naming uploaded images.
_IMAGE_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/tiff": ".tiff",
    "image/bmp": ".bmp",
}


@celery_app.task
def process_document(document_id: str, storage_path: str):
    """Download, parse, embed, and store a document."""

    try:
        # --- 1. Mark as processing ---
        supabase.table("documents").update(
            {"status": "processing"}
        ).eq("id", document_id).execute()

        # --- 2. Get original filename to detect format ---
        doc_result = (
            supabase.table("documents")
            .select("filename")
            .eq("id", document_id)
            .single()
            .execute()
        )
        filename = doc_result.data["filename"]
        extension = Path(filename).suffix.lower()

        if extension not in SUPPORTED_EXTENSIONS:
            raise ValueError(f"Unsupported document format: {extension or 'unknown'}")

        # --- 3. Download file from Supabase Storage ---
        file_bytes = (
            supabase.storage
            .from_(STORAGE_BUCKET)
            .download(storage_path)
        )

        # --- 4. Parse and chunk ---
        # Save to a temp file with the correct extension so Unstructured
        # can detect the format reliably.
        with tempfile.TemporaryDirectory() as tmp_dir:
            file_path = os.path.join(tmp_dir, f"document{extension}")

            with open(file_path, "wb") as f:
                f.write(file_bytes)

            try:
                chunks = chunk_document_multimodal(file_path)
            except Exception:
                # For PDFs only, fall back to the pure-PyMuPDF chunker.
                if extension != ".pdf":
                    raise
                logger.exception("Unstructured PDF parsing failed; trying PyMuPDF fallback")
                from app.services.structured_chunking import chunk_pdf
                chunks = chunk_pdf(file_path)

            # Also try the fallback if Unstructured returned nothing for a PDF.
            if not chunks and extension == ".pdf":
                logger.warning("Unstructured returned no PDF chunks; trying PyMuPDF fallback")
                from app.services.structured_chunking import chunk_pdf
                chunks = chunk_pdf(file_path)

        # Ensure every chunk has the multimodal keys (fallback chunks may not).
        for chunk in chunks:
            chunk.setdefault("element_type", "Text")
            chunk.setdefault("table_html", None)
            chunk.setdefault("image_base64", None)
            chunk.setdefault("image_mime_type", None)

        if not chunks:
            raise ValueError(f"No usable text could be extracted from {extension}")

        # --- 5. Generate embeddings ---
        texts = [chunk["content"] for chunk in chunks]
        embeddings = generate_embeddings(texts)

        if len(embeddings) != len(chunks):
            raise ValueError(
                f"Embedding count mismatch: {len(chunks)} chunks, "
                f"{len(embeddings)} embeddings"
            )

        # --- 6. Remove old image objects from Storage (idempotent re-run) ---
        try:
            old_images = supabase.storage.from_(STORAGE_BUCKET).list(
                path=f"{document_id}/images"
            )
            if old_images:
                old_paths = [
                    f"{document_id}/images/{obj['name']}"
                    for obj in old_images
                    if isinstance(obj, dict) and "name" in obj
                ]
                if old_paths:
                    supabase.storage.from_(STORAGE_BUCKET).remove(old_paths)
        except Exception:
            logger.warning("Could not remove old images for %s", document_id)

        # --- 7. Upload new images and build chunk records ---
        chunk_records = []
        for index, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            image_storage_path = None
            image_b64 = chunk.get("image_base64")
            image_mime = chunk.get("image_mime_type") or "image/png"

            if image_b64:
                try:
                    image_bytes = base64.b64decode(image_b64)
                    ext = _IMAGE_EXT.get(image_mime.lower(), ".bin")
                    image_storage_path = f"{document_id}/images/{index}{ext}"
                    supabase.storage.from_(STORAGE_BUCKET).upload(
                        image_storage_path,
                        image_bytes,
                        {"content_type": image_mime},
                    )
                except Exception:
                    logger.exception(
                        "Failed to upload image for chunk %d of %s", index, document_id
                    )
                    image_storage_path = None

            chunk_records.append({
                "document_id": document_id,
                "content": chunk["content"],
                "chunk_index": index,
                "page_number": chunk.get("page_number"),
                "embedding": embedding,
                "element_type": chunk.get("element_type", "Text"),
                "table_html": chunk.get("table_html"),
                "image_storage_path": image_storage_path,
                "image_mime_type": image_mime if image_storage_path else None,
            })

        # --- 8. Delete old chunks and insert new ones ---
        supabase.table("document_chunks").delete().eq(
            "document_id", document_id
        ).execute()

        for start in range(0, len(chunk_records), INSERT_BATCH_SIZE):
            supabase.table("document_chunks").insert(
                chunk_records[start : start + INSERT_BATCH_SIZE]
            ).execute()

        # --- 9. Mark document as processed ---
        element_counts = dict(
            Counter(c.get("element_type", "Text") for c in chunks)
        )
        supabase.table("documents").update({
            "status": "processed",
            "total_chunks": len(chunks),
            "element_counts": element_counts,
        }).eq("id", document_id).execute()

        # --- 10. Queue background summarisation ---
        # Summaries are generated after ingestion so a Groq quota problem
        # can never block the document from being searchable.
        if summaries_enabled():
            try:
                summarize_document.delay(document_id)
            except Exception:
                logger.exception("Could not queue summaries for %s", document_id)

        return {
            "document_id": document_id,
            "status": "processed",
            "number_of_chunks": len(chunks),
        }

    except Exception:
        logger.exception("Document processing failed: %s", document_id)

        # Best-effort: mark as failed so the UI shows an error state.
        try:
            supabase.table("documents").update(
                {"status": "failed"}
            ).eq("id", document_id).execute()
        except Exception:
            logger.exception("Could not mark document as failed: %s", document_id)

        raise
