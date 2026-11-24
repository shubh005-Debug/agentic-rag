"""
FastAPI application — RAG backend.

Endpoints:
  GET  /                                    health check
  POST /upload                              upload a document → queues Celery task
  GET  /documents                           list all documents
  DELETE /documents/{id}                    delete a document and its chunks
  POST /ask                                 RAG: answer a question from the knowledge base
  GET  /documents/{id}/chunks               list all chunks for a document
  GET  /documents/{id}/chunks/{chunk_id}/image  serve an extracted image

To run:
    uvicorn main:app --reload            (development)
    uvicorn main:app --host 0.0.0.0      (production)

Required env vars (see .env.example):
    SUPABASE_URL, SUPABASE_KEY, GROQ_API_KEY, COHERE_API_KEY, REDIS_URL
"""

import hashlib
import logging
import os
import re
import uuid
import zipfile
from html.parser import HTMLParser
from io import BytesIO
from typing import List
from uuid import UUID

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.database.supabase import supabase
from app.services.rag import ask_rag
from app.tasks.ingestion_tasks import process_document
from app.api.projects import router as projects_router
from app.api.conversations import router as conversations_router
from app.api.messages import router as messages_router


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="AI RAG Platform")

app.include_router(projects_router)
app.include_router(conversations_router)
app.include_router(messages_router)

# CORS: allow any browser origin to call the API.
# Tighten allow_origins in production (e.g. your deployed frontend URL).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Upload settings
# ---------------------------------------------------------------------------

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

STORAGE_BUCKET = "documents"

ALLOWED_EXTENSIONS = {
    ".pdf", ".docx", ".pptx", ".txt", ".csv", ".xlsx", ".html", ".htm",
}

# MIME types sent to Supabase Storage so the files are stored correctly.
CONTENT_TYPES = {
    ".pdf":  "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt":  "text/plain",
    ".csv":  "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".html": "text/html",
    ".htm":  "text/html",
}


# ---------------------------------------------------------------------------
# Root — health check
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    """Quick health check. Returns 200 when the API is running."""
    return {"message": "RAG API is running", "supabase": "connected"}


# ---------------------------------------------------------------------------
# POST /upload
# ---------------------------------------------------------------------------

@app.post("/upload")
def upload_document(file: UploadFile = File(...)):
    """
    Accept a document, validate it, upload it to Supabase Storage, and
    queue a Celery task to parse and embed it.

    Validation layers (in order):
      1. Extension must be in ALLOWED_EXTENSIONS
      2. Filename must not already exist in the database
      3. File must be ≤ 10 MB
      4. File must not be empty
      5. Format-specific structural checks (magic bytes, ZIP structure, UTF-8)
      6. SHA-256 hash must not match any existing document

    Returns 200 with {message, document, task_id} on success.
    """

    # --- 1. Extension check and filename sanitisation ---
    # Strip any directory component to prevent path traversal.
    original_name = os.path.basename((file.filename or "").replace("\\", "/"))
    extension = os.path.splitext(original_name)[1].lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Allowed formats: PDF, DOCX, PPTX, TXT, CSV, XLSX, HTML, HTM",
        )

    # --- 2. Duplicate filename check ---
    existing = (
        supabase.table("documents")
        .select("id")
        .eq("filename", original_name)
        .execute()
    )
    if existing.data:
        raise HTTPException(
            status_code=409,
            detail="A document with this filename already exists",
        )

    # Track what has been created so the exception handler can roll back.
    document_id = None
    storage_path = None
    storage_uploaded = False

    try:
        # --- 3. Read into memory (read MAX+1 bytes to detect over-size) ---
        data = file.file.read(MAX_FILE_SIZE + 1)

        if len(data) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File size must be less than 10 MB")

        if not data:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        # --- 4. Format-specific validation ---
        _validate_file_content(data, extension)

        # --- 5. SHA-256 duplicate check ---
        file_hash = hashlib.sha256(data).hexdigest()
        existing_hash = (
            supabase.table("documents")
            .select("id, filename")
            .eq("file_hash", file_hash)
            .execute()
        )
        if existing_hash.data:
            raise HTTPException(status_code=409, detail="This file has already been uploaded.")

        # --- 6. Upload to Supabase Storage ---
        # Replace special characters in the filename for a safe storage path.
        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", original_name)
        storage_path = f"{uuid.uuid4()}_{safe_name}"

        logger.info("Uploading %s to Supabase Storage", extension)
        supabase.storage.from_(STORAGE_BUCKET).upload(
            storage_path,
            data,
            {"content_type": CONTENT_TYPES[extension]},
        )
        storage_uploaded = True

        # --- 7. Create document record ---
        result = (
            supabase.table("documents")
            .insert({
                "filename": original_name,
                "storage_path": storage_path,
                "file_hash": file_hash,
                "status": "uploaded",
            })
            .execute()
        )
        document = result.data[0]
        document_id = document["id"]

        # --- 8. Queue Celery ingestion task ---
        # The worker downloads the file from Storage, so we do not hold
        # the bytes in memory after this point.
        task = process_document.delay(str(document_id), storage_path)
        logger.info("Document queued for processing: %s", document_id)

        return {
            "message": "Document uploaded successfully and queued for processing",
            "document": {
                "id": document["id"],
                "filename": document["filename"],
                "storage_path": document["storage_path"],
                "status": "uploaded",
                "created_at": document["created_at"],
            },
            "task_id": task.id,
        }

    except HTTPException:
        raise  # Re-raise validation errors unchanged.

    except Exception:
        logger.exception("Document upload failed")

        # Roll back: mark the document row as failed (if it was created),
        # or remove the orphaned storage object (if the row was never created).
        if document_id:
            supabase.table("documents").update(
                {"status": "failed"}
            ).eq("id", document_id).execute()
        elif storage_uploaded:
            try:
                supabase.storage.from_(STORAGE_BUCKET).remove([storage_path])
            except Exception:
                logger.exception("Could not remove orphaned storage object")

        raise HTTPException(status_code=500, detail="Failed to upload the document.")


def _validate_file_content(data: bytes, extension: str) -> None:
    """
    Format-specific content validation.
    Raises HTTPException(400) if the file does not match the declared extension.
    """
    if extension == ".pdf":
        if b"%PDF-" not in data[:1024]:
            raise HTTPException(status_code=400, detail="File is not a valid PDF")

    elif extension in {".docx", ".pptx"}:
        # Both formats are ZIP archives with known internal structure.
        required_entries = {
            ".docx": {"[Content_Types].xml", "word/document.xml"},
            ".pptx": {"[Content_Types].xml", "ppt/presentation.xml"},
        }
        try:
            with zipfile.ZipFile(BytesIO(data)) as archive:
                names = set(archive.namelist())
                if not required_entries[extension].issubset(names):
                    raise ValueError("Missing required entries")
        except (zipfile.BadZipFile, ValueError):
            fmt = extension[1:].upper()
            raise HTTPException(
                status_code=400, detail=f"File is not a valid {fmt} document"
            )

    elif extension == ".xlsx":
        try:
            with zipfile.ZipFile(BytesIO(data)) as archive:
                names = set(archive.namelist())
                if not {"[Content_Types].xml", "xl/workbook.xml"}.issubset(names):
                    raise ValueError("Missing required entries")
        except (zipfile.BadZipFile, ValueError):
            raise HTTPException(status_code=400, detail="File is not a valid XLSX workbook")

    elif extension in {".csv", ".html", ".htm"}:
        # Must be valid UTF-8 text.
        try:
            text_data = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="CSV and HTML files must use UTF-8 encoding",
            )
        if not text_data.strip():
            raise HTTPException(status_code=400, detail="Uploaded document contains no text")

        if extension in {".html", ".htm"}:
            try:
                HTMLParser().feed(text_data)
            except Exception:
                raise HTTPException(status_code=400, detail="File contains invalid HTML markup")


# ---------------------------------------------------------------------------
# GET /documents
# ---------------------------------------------------------------------------

@app.get("/documents")
def get_documents():
    """
    Return all documents ordered by upload time (newest first).

    Fields included: id, filename, storage_path, status, created_at,
                     summary_status, total_chunks, element_counts
    """
    result = (
        supabase.table("documents")
        .select(
            "id, filename, storage_path, status, created_at, "
            "summary_status, total_chunks, element_counts"
        )
        .order("created_at", desc=True)
        .execute()
    )
    return {"documents": result.data}


# ---------------------------------------------------------------------------
# DELETE /documents/{document_id}
# ---------------------------------------------------------------------------

@app.delete("/documents/{document_id}")
def delete_document(document_id: UUID):
    """
    Delete a document and all its associated data:
      - The original file from Supabase Storage
      - Any extracted images from Supabase Storage
      - The document row (chunks are deleted by ON DELETE CASCADE)
    """
    result = (
        supabase.table("documents")
        .select("*")
        .eq("id", str(document_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Document not found")

    document = result.data[0]

    # Delete the original file from Storage.
    storage_path = document.get("storage_path")
    if storage_path:
        supabase.storage.from_(STORAGE_BUCKET).remove([storage_path])

    # Delete extracted images (best-effort; a failure here does not block deletion).
    try:
        images = supabase.storage.from_(STORAGE_BUCKET).list(
            path=f"{document_id}/images"
        )
        if images:
            image_paths = [
                f"{document_id}/images/{obj['name']}"
                for obj in images
                if isinstance(obj, dict) and "name" in obj
            ]
            if image_paths:
                supabase.storage.from_(STORAGE_BUCKET).remove(image_paths)
    except Exception:
        logger.warning("Could not remove images for document %s", document_id)

    # Delete the document row (cascades to document_chunks).
    supabase.table("documents").delete().eq("id", str(document_id)).execute()

    return {"message": "Document deleted successfully", "document_id": str(document_id)}


# ---------------------------------------------------------------------------
# POST /ask
# ---------------------------------------------------------------------------

class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    # Optional: scope the search to a single document.
    # If omitted or null, all documents are searched.
    document_id: UUID | None = None


class Source(BaseModel):
    id: str
    document_id: str
    content: str
    chunk_index: int
    page_number: int | None = None
    similarity: float | None = None
    rrf_score: float | None = None
    rerank_score: float | None = None
    element_type: str | None = None
    table_html: str | None = None
    image_caption: str | None = None
    has_image: bool | None = None


class AskResponse(BaseModel):
    answer: str
    sources: List[Source]


@app.post("/ask", response_model=AskResponse)
def ask_question(request: AskRequest):
    """
    Answer a question using RAG.

    Optional: set document_id to scope the search to a single document.
    Returns the answer and the source chunks used to generate it.
    """
    logger.info("Received question")

    try:
        result = ask_rag(
            question=request.question,
            document_id=str(request.document_id) if request.document_id else None,
        )
        logger.info("RAG request completed")
        return result

    except Exception:
        logger.exception("RAG request failed")
        raise HTTPException(status_code=500, detail="Unable to process the question right now")


# ---------------------------------------------------------------------------
# GET /documents/{document_id}/chunks
# ---------------------------------------------------------------------------

@app.get("/documents/{document_id}/chunks")
def get_document_chunks(document_id: UUID):
    """
    List all chunks for a document.

    Returns element type, page number, table HTML, image caption,
    summary text, and whether an image file is available for each chunk.

    Useful for building a chunk explorer UI or debugging document parsing.
    """
    doc_result = (
        supabase.table("documents")
        .select("id")
        .eq("id", str(document_id))
        .execute()
    )
    if not doc_result.data:
        raise HTTPException(status_code=404, detail="Document not found")

    result = (
        supabase.table("document_chunks")
        .select(
            "id, document_id, content, chunk_index, page_number, "
            "element_type, table_html, image_caption, summary, image_storage_path"
        )
        .eq("document_id", str(document_id))
        .order("chunk_index")
        .execute()
    )

    chunks = [
        {
            "id": row["id"],
            "document_id": row["document_id"],
            "content": row["content"],
            "chunk_index": row["chunk_index"],
            "page_number": row.get("page_number"),
            "element_type": row.get("element_type"),
            "table_html": row.get("table_html"),
            "image_caption": row.get("image_caption"),
            "summary": row.get("summary"),
            "has_image": bool(row.get("image_storage_path")),
        }
        for row in result.data
    ]

    return {"document_id": str(document_id), "chunks": chunks}


# ---------------------------------------------------------------------------
# GET /documents/{document_id}/chunks/{chunk_id}/image
# ---------------------------------------------------------------------------

@app.get("/documents/{document_id}/chunks/{chunk_id}/image")
def get_chunk_image(document_id: UUID, chunk_id: UUID):
    """
    Serve the image extracted from a chunk.

    Downloads the image from Supabase Storage server-side and returns it
    directly — the raw storage path is never exposed to the client.
    """
    result = (
        supabase.table("document_chunks")
        .select("id, document_id, image_storage_path, image_mime_type")
        .eq("id", str(chunk_id))
        .eq("document_id", str(document_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Chunk not found")

    row = result.data[0]
    image_path = row.get("image_storage_path")

    if not image_path:
        raise HTTPException(
            status_code=404, detail="This chunk does not have an associated image"
        )

    try:
        image_bytes = supabase.storage.from_(STORAGE_BUCKET).download(image_path)
    except Exception:
        raise HTTPException(
            status_code=500, detail="Could not retrieve the image from storage"
        )

    mime_type = row.get("image_mime_type") or "image/png"
    return Response(content=image_bytes, media_type=mime_type)
