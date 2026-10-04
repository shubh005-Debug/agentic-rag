import os

from celery_app import celery_app

from app.services.documents import extract_pages_from_pdf
from app.services.chunking import split_pages
from app.services.embeddings import generate_embeddings
from app.database.supabase import supabase


@celery_app.task
def process_document(document_id: str, file_path: str):

    try:

        pages = extract_pages_from_pdf(file_path)

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

        if chunk_records:

            supabase \
                .table("document_chunks") \
                .insert(chunk_records) \
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

        supabase \
            .table("documents") \
            .update({
                "status": "failed"
            }) \
            .eq("id", document_id) \
            .execute()

        raise

    finally:

        if os.path.exists(file_path):
            os.remove(file_path)