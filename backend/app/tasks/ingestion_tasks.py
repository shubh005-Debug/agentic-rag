# import os
# import tempfile

# from celery.utils.log import get_task_logger

# from celery_app import celery_app
# from app.services.unstructured_parser import chunk_document
# from app.services.embeddings import generate_embeddings
# from app.database.supabase import supabase
# from app.tasks.summary_tasks import summarize_document, summaries_enabled

# logger = get_task_logger(__name__)

# STORAGE_BUCKET = "documents"
# INSERT_BATCH_SIZE = 100


# @celery_app.task
# def process_document(document_id: str, storage_path: str):
#     """
#     Process an uploaded PDF.

#     The worker does NOT need access to the API's filesystem: it downloads
#     the PDF from Supabase Storage using storage_path, so the API and the
#     worker can run on different machines / operating systems.
#     """

#     try:

#         supabase \
#             .table("documents") \
#             .update({
#                 "status": "processing"
#             }) \
#             .eq("id", document_id) \
#             .execute()

#         # 1. Download the PDF from Supabase Storage
#         pdf_bytes = (
#             supabase
#             .storage
#             .from_(STORAGE_BUCKET)
#             .download(storage_path)
#         )

#         # 2. Extract + chunk (temporary directory is always cleaned up).
#         #    chunk_pdf() is structure-aware and falls back to the original
#         #    page-based pipeline automatically if it cannot handle the file.
#         with tempfile.TemporaryDirectory() as tmp_dir:

#             pdf_path = os.path.join(tmp_dir, "document.pdf")

#             with open(pdf_path, "wb") as pdf_file:
#                 pdf_file.write(pdf_bytes)

#             chunks = chunk_pdf(pdf_path)

#         if not chunks:
#             raise ValueError(
#                 "No text could be extracted from the PDF"
#             )

#         texts = [
#             chunk["content"]
#             for chunk in chunks
#         ]

#         embeddings = generate_embeddings(texts)

#         chunk_records = []

#         for index, (chunk, embedding) in enumerate(
#             zip(chunks, embeddings)
#         ):

#             chunk_records.append({
#                 "document_id": document_id,
#                 "content": chunk["content"],
#                 "chunk_index": index,
#                 "page_number": chunk["page_number"],
#                 "embedding": embedding
#             })

#         # Make the task safe to re-run: remove chunks from a previous attempt
#         supabase \
#             .table("document_chunks") \
#             .delete() \
#             .eq("document_id", document_id) \
#             .execute()

#         for start in range(0, len(chunk_records), INSERT_BATCH_SIZE):

#             supabase \
#                 .table("document_chunks") \
#                 .insert(
#                     chunk_records[start:start + INSERT_BATCH_SIZE]
#                 ) \
#                 .execute()

#         supabase \
#             .table("documents") \
#             .update({
#                 "status": "processed"
#             }) \
#             .eq("id", document_id) \
#             .execute()

#         # Queue chunk summaries (background). The document is already
#         # searchable, so a problem here must never fail the ingestion.
#         if summaries_enabled():
#             try:
#                 summarize_document.delay(document_id)
#             except Exception:
#                 logger.exception(
#                     "Could not queue summaries for %s",
#                     document_id
#                 )

#         return {
#             "document_id": document_id,
#             "status": "processed",
#             "number_of_chunks": len(chunks)
#         }

#     except Exception:

#         logger.exception(
#             "Document processing failed: %s",
#             document_id
#         )

#         try:
#             supabase \
#                 .table("documents") \
#                 .update({
#                     "status": "failed"
#                 }) \
#                 .eq("id", document_id) \
#                 .execute()
#         except Exception:
#             logger.exception(
#                 "Could not mark document as failed: %s",
#                 document_id
#             )

#         raise


import base64
import os
import tempfile
from collections import Counter
from pathlib import Path

from celery.utils.log import get_task_logger

from celery_app import celery_app
from app.services.unstructured_parser import chunk_document_multimodal
from app.services.embeddings import generate_embeddings
from app.database.supabase import supabase
from app.tasks.summary_tasks import summarize_document, summaries_enabled

logger = get_task_logger(__name__)

STORAGE_BUCKET = "documents"
INSERT_BATCH_SIZE = 100

SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".docx",
    ".pptx",
    ".txt",
    ".csv",
    ".xlsx",
    ".html",
    ".htm",
}


@celery_app.task
def process_document(document_id: str, storage_path: str):
    """Download, parse, chunk, embed, and store a document."""

    try:
        supabase.table("documents").update({
            "status": "processing"
        }).eq("id", document_id).execute()

        # Get the original filename to reliably detect the format.
        document_result = (
            supabase.table("documents")
            .select("filename")
            .eq("id", document_id)
            .single()
            .execute()
        )

        filename = document_result.data["filename"]
        extension = Path(filename).suffix.lower()

        if extension not in SUPPORTED_EXTENSIONS:
            raise ValueError(
                f"Unsupported document format: {extension or 'unknown'}"
            )

        # Download the original file from Supabase Storage.
        file_bytes = (
            supabase.storage
            .from_(STORAGE_BUCKET)
            .download(storage_path)
        )

        # Save with the correct extension and parse using Unstructured.
        with tempfile.TemporaryDirectory() as tmp_dir:
            file_path = os.path.join(tmp_dir, f"document{extension}")

            with open(file_path, "wb") as output_file:
                output_file.write(file_bytes)

            try:
                chunks = chunk_document_multimodal(file_path)
            except Exception:
                if extension != ".pdf":
                    raise

                logger.exception(
                    "Unstructured PDF parsing failed; trying PDF fallback"
                )

                from app.services.structured_chunking import chunk_pdf
                chunks = chunk_pdf(file_path)

            # Also use the PDF fallback if Unstructured returns no chunks.
            if not chunks and extension == ".pdf":
                logger.warning(
                    "Unstructured returned no PDF chunks; trying PDF fallback"
                )

                from app.services.structured_chunking import chunk_pdf
                chunks = chunk_pdf(file_path)

        # Normalize fallback chunks to the multimodal shape.
        for chunk in chunks:
            chunk.setdefault("element_type", "Text")
            chunk.setdefault("table_html", None)
            chunk.setdefault("image_base64", None)
            chunk.setdefault("image_mime_type", None)

        if not chunks:
            raise ValueError(
                f"No usable text could be extracted from {extension}"
            )

        # Generate embeddings for the extracted chunks.
        texts = [chunk["content"] for chunk in chunks]
        embeddings = generate_embeddings(texts)

        if len(embeddings) != len(chunks):
            raise ValueError(
                f"Embedding count mismatch: {len(chunks)} chunks, "
                f"{len(embeddings)} embeddings"
            )

        # Remove old image objects before re-inserting (idempotent re-run).
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
            logger.warning(
                "Could not remove old images for %s", document_id
            )

        chunk_records = []

        for index, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            # Upload image to Storage if the parser extracted one.
            image_storage_path = None
            image_b64 = chunk.get("image_base64")
            image_mime = chunk.get("image_mime_type") or "image/png"

            if image_b64:
                try:
                    image_bytes = base64.b64decode(image_b64)
                    # Derive file extension from the actual MIME type so the
                    # storage path reflects what is stored.  Unknown types fall
                    # back to ".bin" (safe, never confused with an image format).
                    _mime_ext = {
                        "image/png": ".png",
                        "image/jpeg": ".jpg",
                        "image/jpg": ".jpg",
                        "image/gif": ".gif",
                        "image/webp": ".webp",
                        "image/tiff": ".tiff",
                        "image/bmp": ".bmp",
                    }
                    ext = _mime_ext.get(image_mime.lower(), ".bin")
                    image_storage_path = (
                        f"{document_id}/images/{index}{ext}"
                    )
                    supabase.storage.from_(STORAGE_BUCKET).upload(
                        image_storage_path,
                        image_bytes,
                        {"content_type": image_mime},
                    )
                except Exception:
                    logger.exception(
                        "Failed to upload image for chunk %d of %s",
                        index, document_id,
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

        # Preserve the existing database-write behavior: delete then insert.
        supabase.table("document_chunks").delete().eq(
            "document_id", document_id
        ).execute()

        for start in range(0, len(chunk_records), INSERT_BATCH_SIZE):
            supabase.table("document_chunks").insert(
                chunk_records[start:start + INSERT_BATCH_SIZE]
            ).execute()

        element_counts = dict(
            Counter(c.get("element_type", "Text") for c in chunks)
        )
        supabase.table("documents").update({
            "status": "processed",
            "total_chunks": len(chunks),
            "element_counts": element_counts,
        }).eq("id", document_id).execute()

        # Queue summaries without failing successful ingestion.
        if summaries_enabled():
            try:
                summarize_document.delay(document_id)
            except Exception:
                logger.exception(
                    "Could not queue summaries for %s", document_id
                )

        return {
            "document_id": document_id,
            "status": "processed",
            "number_of_chunks": len(chunks),
        }

    except Exception:
        logger.exception("Document processing failed: %s", document_id)

        try:
            supabase.table("documents").update({
                "status": "failed"
            }).eq("id", document_id).execute()
        except Exception:
            logger.exception(
                "Could not mark document as failed: %s", document_id
            )

        raise
