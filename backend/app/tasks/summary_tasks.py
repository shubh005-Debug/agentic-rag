"""
Background chunk summarization (Step 5a).

Runs AFTER a document is already searchable ('processed'), so a Groq quota
problem can only delay summaries, never ingestion or retrieval.

The work is resumable: progress is saved chunk by chunk, and a re-run only
handles chunks that still have no summary embedding.
"""

import base64
import os

from celery.utils.log import get_task_logger

from celery_app import celery_app

from app.database.supabase import supabase
from app.services.embeddings import generate_embeddings
from app.services.summarizer import (
    SummaryRateLimited,
    pause_after,
    summarize_chunk,
)
from app.services.vision import describe_image

logger = get_task_logger(__name__)

DEFAULT_MAX_CHUNKS = 80
EMBED_BATCH_SIZE = 16
MAX_RETRIES = 5
MAX_RETRY_WAIT_SECONDS = 1800   # Redis redelivers tasks scheduled further out

STORAGE_BUCKET = "documents"


def summaries_enabled() -> bool:
    return os.getenv("SUMMARY_ENABLED", "true").strip().lower() not in ("0", "false", "no", "off")


def max_summary_chunks() -> int:
    try:
        return int(os.getenv("SUMMARY_MAX_CHUNKS", DEFAULT_MAX_CHUNKS))
    except ValueError:
        return DEFAULT_MAX_CHUNKS


def _set_status(document_id: str, status: str) -> None:
    try:
        supabase.table("documents").update({"summary_status": status}).eq("id", document_id).execute()
    except Exception:
        logger.exception("Could not set summary_status=%s for %s", status, document_id)


def _summarize_image_chunk(row: dict) -> str:
    """Generate a summary for an image chunk.

    Returns the caption text (from the vision model) or a 'not analyzed'
    marker string.  Never returns None -- the caller always stores the
    result so the chunk is marked as processed (summary_embedding set).
    """
    image_path = row.get("image_storage_path")

    if not image_path:
        return "[Image not analyzed: image not available in storage]"

    image_mime = row.get("image_mime_type") or "image/png"

    try:
        image_bytes = supabase.storage.from_(STORAGE_BUCKET).download(image_path)
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        caption = describe_image(image_b64, image_mime)
        if caption:
            return caption
    except Exception:
        logger.warning(
            "Could not download/process image %s for captioning",
            image_path,
            exc_info=True,
        )

    return "[Image not analyzed: vision model unavailable]"


def summarize_document_chunks(document_id: str) -> dict:
    """Do the work. Raises SummaryRateLimited when Groq asks us to wait."""

    total = (
        supabase.table("document_chunks")
        .select("id", count="exact")
        .eq("document_id", document_id)
        .execute()
        .count
    ) or 0

    if total > max_summary_chunks():
        _set_status(document_id, "skipped")
        logger.info("Summaries skipped for %s: %d chunks (limit %d)", document_id, total, max_summary_chunks())
        return {"document_id": document_id, "status": "skipped", "chunks": total}

    pending = (
        supabase.table("document_chunks")
        .select(
            "id, content, summary, element_type, "
            "image_storage_path, image_mime_type"
        )
        .eq("document_id", document_id)
        .is_("summary_embedding", "null")
        .order("chunk_index")
        .execute()
        .data
    )

    if not pending:
        _set_status(document_id, "done")
        return {"document_id": document_id, "status": "done", "summarized": 0}

    _set_status(document_id, "processing")

    summarized = 0
    unusable = 0

    for start in range(0, len(pending), EMBED_BATCH_SIZE):
        batch = []     # (chunk_id, summary_text) ready to embed

        for row in pending[start:start + EMBED_BATCH_SIZE]:
            summary = (row.get("summary") or "").strip()

            if not summary:
                element_type = row.get("element_type", "Text")

                if element_type == "Image":
                    # Generate image caption or mark as not analyzed.
                    summary = _summarize_image_chunk(row)
                    is_real_caption = not summary.startswith("[Image not analyzed")
                    supabase.table("document_chunks").update({
                        "summary": summary,
                        "image_caption": summary,
                    }).eq("id", row["id"]).execute()
                    if is_real_caption:
                        summarized += 1
                    else:
                        unusable += 1
                else:
                    # Text / table chunk: use the text summarizer.
                    result = summarize_chunk(row["content"])     # may raise SummaryRateLimited
                    if not result.text:
                        unusable += 1
                        pause_after(result.tokens_used)
                        continue
                    summary = result.text
                    supabase.table("document_chunks").update({"summary": summary}).eq("id", row["id"]).execute()
                    summarized += 1
                    pause_after(result.tokens_used)

            batch.append((row["id"], summary))

        if batch:
            embeddings = generate_embeddings([text for _, text in batch])
            for (chunk_id, _), embedding in zip(batch, embeddings):
                supabase.table("document_chunks").update({"summary_embedding": embedding}).eq("id", chunk_id).execute()

    status = "partial" if unusable else "done"
    _set_status(document_id, status)
    return {"document_id": document_id, "status": status, "summarized": summarized, "unusable": unusable}


@celery_app.task(bind=True, max_retries=MAX_RETRIES)
def summarize_document(self, document_id: str):

    try:
        return summarize_document_chunks(document_id)

    except SummaryRateLimited as exc:
        if exc.wait_seconds > MAX_RETRY_WAIT_SECONDS or self.request.retries >= self.max_retries:
            logger.warning("Summaries for %s stopped early (rate limit). Re-run the task later.", document_id)
            _set_status(document_id, "partial")
            return {"document_id": document_id, "status": "partial", "reason": "rate_limited"}

        countdown = max(exc.wait_seconds, 30)
        logger.info("Rate limited; retrying summaries for %s in %.0fs", document_id, countdown)
        raise self.retry(exc=exc, countdown=countdown)

    except Exception:
        logger.exception("Summarization failed for %s", document_id)
        _set_status(document_id, "failed")
        raise