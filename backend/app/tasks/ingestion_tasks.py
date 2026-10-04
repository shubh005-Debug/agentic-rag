import os
import tempfile

from celery.utils.log import get_task_logger

from celery_app import celery_app

from app.services.documents import extract_pages_from_pdf
from app.services.chunking import split_pages
from app.services.embeddings import generate_embeddings
from app.database.supabase import supabase

logger = get_task_logger(__name__)

STORAGE_BUCKET = "documents"
INSERT_BATCH_SIZE = 100


@celery_app.task
def process_document(document_id: str, storage_path: str):
    """
    Process an uploaded PDF.

    The worker does NOT need access to the API's filesystem: it downloads
    the PDF from Supabase Storage using storage_path, so the API and the
    worker can run on different machines / operating systems.
    """

    try:

        supabase \
            .table("documents") \
            .update({
                "status": "processing"
            }) \
            .eq("id", document_id) \
            .execute()

        # 1. Download the PDF from Supabase Storage
        pdf_bytes = (
            supabase
            .storage
            .from_(STORAGE_BUCKET)
            .download(storage_path)
        )

        # 2. Extract text (temporary directory is always cleaned up)
        with tempfile.TemporaryDirectory() as tmp_dir:

            pdf_path = os.path.join(tmp_dir, "document.pdf")

            with open(pdf_path, "wb") as pdf_file:
                pdf_file.write(pdf_bytes)

            pages = extract_pages_from_pdf(pdf_path)

        chunks = split_pages(pages)

        if not chunks:
            raise ValueError(
                "No text could be extracted from the PDF"
            )

        texts = [
            chunk["content"]
            for chunk in chunks
        ]

        embeddings = generate_embeddings(texts)

        chunk_records = []

        for index, (chunk, embedding) in enumerate(
            zip(chunks, embeddings)
        ):

            chunk_records.append({
                "document_id": document_id,
                "content": chunk["content"],
                "chunk_index": index,
                "page_number": chunk["page_number"],
                "embedding": embedding
            })

        # Make the task safe to re-run: remove chunks from a previous attempt
        supabase \
            .table("document_chunks") \
            .delete() \
            .eq("document_id", document_id) \
            .execute()

        for start in range(0, len(chunk_records), INSERT_BATCH_SIZE):

            supabase \
                .table("document_chunks") \
                .insert(
                    chunk_records[start:start + INSERT_BATCH_SIZE]
                ) \
                .execute()

        supabase \
            .table("documents") \
            .update({
                "status": "processed"
            }) \
            .eq("id", document_id) \
            .execute()

        return {
            "document_id": document_id,
            "status": "processed",
            "number_of_chunks": len(chunks)
        }

    except Exception:

        logger.exception(
            "Document processing failed: %s",
            document_id
        )

        try:
            supabase \
                .table("documents") \
                .update({
                    "status": "failed"
                }) \
                .eq("id", document_id) \
                .execute()
        except Exception:
            logger.exception(
                "Could not mark document as failed: %s",
                document_id
            )

        raise