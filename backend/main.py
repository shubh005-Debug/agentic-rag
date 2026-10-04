from fastapi import FastAPI, UploadFile, File, HTTPException
from app.tasks.ingestion_tasks import process_document
import uuid
import os
import re
from app.database.supabase import supabase
from pydantic import BaseModel, Field
from app.services.rag import ask_rag
from typing import List
import logging
from uuid import UUID
import hashlib


# =========================================================
# LOGGING
# =========================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

logger = logging.getLogger(__name__)


# =========================================================
# FASTAPI
# =========================================================

app = FastAPI(
    title="AI RAG Platform"
)


# =========================================================
# UPLOAD SETTINGS
# =========================================================
# The API no longer writes uploads to local disk. The PDF is read
# into memory (max 10 MB), stored in Supabase Storage, and the Celery
# worker downloads it from there.

MAX_FILE_SIZE = 10 * 1024 * 1024
STORAGE_BUCKET = "documents"


# =========================================================
# ROOT
# =========================================================

@app.get("/")
def root():

    return {
        "message": "RAG API is running",
        "supabase": "connected"
    }


# NOTE: plain "def" (not "async def"): this endpoint does blocking work
# (file read, hashing, Supabase calls). FastAPI runs it in a thread pool
# so it does not freeze the event loop.
@app.post("/upload")
def upload_document(
    file: UploadFile = File(...)
):

    # -----------------------------------------------------
    # 1. Check file type and clean the filename
    # -----------------------------------------------------

    # Strip any directory part ("..\\..\\x.pdf" -> "x.pdf")
    original_name = os.path.basename(
        (file.filename or "").replace("\\", "/")
    )

    if not original_name.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are allowed"
        )

    # -----------------------------------------------------
    # 2. Check duplicate filename
    # -----------------------------------------------------

    existing = (
        supabase
        .table("documents")
        .select("id")
        .eq("filename", original_name)
        .execute()
    )

    if existing.data:
        raise HTTPException(
            status_code=409,
            detail="A document with this filename already exists"
        )

    document_id = None
    storage_path = None
    storage_uploaded = False

    try:

        # -------------------------------------------------
        # 3. Read the file into memory (never more than
        #    MAX_FILE_SIZE + 1 bytes)
        # -------------------------------------------------

        data = file.file.read(MAX_FILE_SIZE + 1)

        if len(data) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="File size must be less than 10 mb"
            )

        if b"%PDF" not in data[:1024]:
            raise HTTPException(
                status_code=400,
                detail="File is not a valid PDF"
            )

        # -------------------------------------------------
        # 4. Generate SHA-256 hash
        # -------------------------------------------------

        file_hash = hashlib.sha256(data).hexdigest()

        # -------------------------------------------------
        # 5. Check duplicate file using hash
        # -------------------------------------------------

        existing_hash = (
            supabase
            .table("documents")
            .select("id, filename")
            .eq("file_hash", file_hash)
            .execute()
        )

        if existing_hash.data:
            raise HTTPException(
                status_code=409,
                detail="This file has already been uploaded."
            )

        # -------------------------------------------------
        # 6. Upload PDF to Supabase Storage
        # -------------------------------------------------

        safe_name = re.sub(
            r"[^A-Za-z0-9._-]",
            "_",
            original_name
        )

        storage_path = f"{uuid.uuid4()}_{safe_name}"

        logger.info(
            "Uploading PDF to Supabase Storage"
        )

        supabase.storage \
            .from_(STORAGE_BUCKET) \
            .upload(
                storage_path,
                data,
                {
                    "content_type": "application/pdf"
                }
            )

        storage_uploaded = True

        # -------------------------------------------------
        # 7. Create document record
        # -------------------------------------------------

        result = (
            supabase
            .table("documents")
            .insert({
                "filename": original_name,
                "storage_path": storage_path,
                "file_hash": file_hash,
                "status": "uploaded"
            })
            .execute()
        )

        document = result.data[0]

        document_id = document["id"]

        # -------------------------------------------------
        # 8. Queue Celery ingestion task
        #    (the worker downloads the PDF from storage)
        # -------------------------------------------------

        task = process_document.delay(
            str(document_id),
            storage_path
        )

        logger.info(
            "Document queued for processing: %s",
            document_id
        )

        # -------------------------------------------------
        # 9. Return immediately
        # -------------------------------------------------

        return {
            "message": "PDF uploaded successfully and queued for processing",

            "document": {
                "id": document["id"],
                "filename": document["filename"],
                "storage_path": document["storage_path"],
                "status": "uploaded",
                "created_at": document["created_at"]
            },

            "task_id": task.id
        }

    except HTTPException:
        raise

    except Exception:

        logger.exception(
            "Document upload failed"
        )

        if document_id:

            supabase \
                .table("documents") \
                .update({
                    "status": "failed"
                }) \
                .eq("id", document_id) \
                .execute()

        elif storage_uploaded:

            # The file reached storage but no document row exists:
            # remove the orphaned object (best effort).
            try:
                supabase.storage \
                    .from_(STORAGE_BUCKET) \
                    .remove([storage_path])
            except Exception:
                logger.exception(
                    "Could not remove orphaned storage object"
                )

        raise HTTPException(
            status_code=500,
            detail="Failed to upload the document."
        )

# =========================================================
# ASK REQUEST
# =========================================================

class AskRequest(BaseModel):

    question: str = Field(
        min_length=2,
        max_length=1000
    )

    document_id: UUID | None = None


# =========================================================
# SOURCE
# =========================================================

class Source(BaseModel):
    id: str
    document_id: str
    content: str
    chunk_index: int
    page_number: int | None = None
    similarity: float | None = None
    rrf_score: float | None = None
    rerank_score: float | None = None


# =========================================================
# ASK RESPONSE
# =========================================================

class AskResponse(BaseModel):

    answer: str

    sources: List[Source]


# =========================================================
# ASK / RAG
# =========================================================

@app.post(
    "/ask",
    response_model=AskResponse
)
def ask_question(
    request: AskRequest
):

    logger.info(
        "Received question"
    )

    try:

        result = ask_rag(
            question=request.question,
            document_id=(
                str(request.document_id)
                if request.document_id
                else None
            )
        )

        logger.info(
            "RAG request completed"
        )

        return result


    except Exception:

        logger.exception(
            "RAG request failed"
        )

        raise HTTPException(
            status_code=500,
            detail="Unable to process the question right now"
        )

@app.delete("/documents/{document_id}")
def delete_document(document_id: UUID):

    # 1. Find document
    result = supabase.table("documents") \
        .select("*") \
        .eq("id", str(document_id)) \
        .execute()

    if not result.data:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )

    document = result.data[0]

    # 2. Get storage path
    storage_path = document.get("storage_path")

    # 3. Delete PDF from Supabase Storage
    if storage_path:
        supabase.storage \
            .from_("documents") \
            .remove([storage_path])

    # 4. Delete document row
    # document_chunks will be deleted automatically
    # because of ON DELETE CASCADE
    supabase.table("documents") \
        .delete() \
        .eq("id", str(document_id)) \
        .execute()

    return {
        "message": "Document deleted successfully",
        "document_id": str(document_id)
    }       


@app.get("/documents")
def get_documents():

    result = (
        supabase
        .table("documents")
        .select("id, filename, storage_path, status, created_at")
        .order("created_at", desc=True)
        .execute()
    )

    return {
        "documents": result.data
    }