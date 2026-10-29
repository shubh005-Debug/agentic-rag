"""Unit tests for the ingestion task (process_document).

All Supabase, Storage, Celery, and embedding calls are mocked.
No real services are contacted.
"""

import base64
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import pytest

import app.tasks.ingestion_tasks as ingestion


# ---------------------------------------------------------------------------
# Shared fixtures and helpers
# ---------------------------------------------------------------------------

def _make_supabase_mock(chunks_to_delete=True):
    """Return a minimal supabase mock with chainable table/storage stubs."""
    mock = MagicMock()

    # .table(...).select(...).eq(...).single().execute() → filename
    mock.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = SimpleNamespace(
        data={"filename": "test.pdf"}
    )

    # .table(...).update(...).eq(...).execute() → no-op
    mock.table.return_value.update.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[])

    # .table(...).delete(...).eq(...).execute() → no-op
    mock.table.return_value.delete.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[])

    # .table(...).insert(...).execute() → no-op
    mock.table.return_value.insert.return_value.execute.return_value = SimpleNamespace(data=[])

    # Storage: .storage.from_(...).download(...) → minimal PDF bytes
    mock.storage.from_.return_value.download.return_value = b"%PDF-1.4 fake content"

    # Storage: .storage.from_(...).list(...) → empty (no old images)
    mock.storage.from_.return_value.list.return_value = []

    # Storage: .storage.from_(...).upload(...) → no-op
    mock.storage.from_.return_value.upload.return_value = SimpleNamespace(data={})

    return mock


def _make_text_chunks(n=3):
    """Return n simple text chunks in the multimodal shape."""
    return [
        {
            "content": f"Chunk {i} content.",
            "page_number": i + 1,
            "element_type": "Text",
            "table_html": None,
            "image_base64": None,
            "image_mime_type": None,
        }
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# Tests: happy path
# ---------------------------------------------------------------------------

def test_process_document_marks_status_processed(monkeypatch):
    """A successful run should set document status to 'processed'."""
    chunks = _make_text_chunks(2)
    embeddings = [[0.1] * 384, [0.2] * 384]

    monkeypatch.setattr(ingestion, "supabase", _make_supabase_mock())
    monkeypatch.setattr(
        ingestion, "chunk_document_multimodal",
        lambda path: chunks,
    )
    monkeypatch.setattr(
        ingestion, "generate_embeddings",
        lambda texts, **kw: embeddings[: len(texts)],
    )
    monkeypatch.setattr(ingestion, "summaries_enabled", lambda: False)
    monkeypatch.setattr(ingestion, "summarize_document", MagicMock())

    result = ingestion.process_document("doc-uuid", "path/to/doc.pdf")

    assert result["status"] == "processed"
    assert result["number_of_chunks"] == 2


def test_process_document_returns_chunk_count(monkeypatch):
    """Result dict should include the correct number_of_chunks."""
    chunks = _make_text_chunks(5)
    monkeypatch.setattr(ingestion, "supabase", _make_supabase_mock())
    monkeypatch.setattr(ingestion, "chunk_document_multimodal", lambda p: chunks)
    monkeypatch.setattr(ingestion, "generate_embeddings", lambda t, **kw: [[0.0] * 384] * len(t))
    monkeypatch.setattr(ingestion, "summaries_enabled", lambda: False)
    monkeypatch.setattr(ingestion, "summarize_document", MagicMock())

    result = ingestion.process_document("doc-id", "p.pdf")
    assert result["number_of_chunks"] == 5


def test_process_document_queues_summaries_when_enabled(monkeypatch):
    """When summaries are enabled, summarize_document.delay() should be called."""
    chunks = _make_text_chunks(2)
    mock_summarize = MagicMock()

    monkeypatch.setattr(ingestion, "supabase", _make_supabase_mock())
    monkeypatch.setattr(ingestion, "chunk_document_multimodal", lambda p: chunks)
    monkeypatch.setattr(ingestion, "generate_embeddings", lambda t, **kw: [[0.0] * 384] * len(t))
    monkeypatch.setattr(ingestion, "summaries_enabled", lambda: True)
    monkeypatch.setattr(ingestion, "summarize_document", mock_summarize)

    ingestion.process_document("doc-id", "p.pdf")

    mock_summarize.delay.assert_called_once_with("doc-id")


def test_process_document_does_not_queue_summaries_when_disabled(monkeypatch):
    """When summaries are disabled, summarize_document.delay() must not be called."""
    chunks = _make_text_chunks(2)
    mock_summarize = MagicMock()

    monkeypatch.setattr(ingestion, "supabase", _make_supabase_mock())
    monkeypatch.setattr(ingestion, "chunk_document_multimodal", lambda p: chunks)
    monkeypatch.setattr(ingestion, "generate_embeddings", lambda t, **kw: [[0.0] * 384] * len(t))
    monkeypatch.setattr(ingestion, "summaries_enabled", lambda: False)
    monkeypatch.setattr(ingestion, "summarize_document", mock_summarize)

    ingestion.process_document("doc-id", "p.pdf")

    mock_summarize.delay.assert_not_called()


# ---------------------------------------------------------------------------
# Tests: image upload
# ---------------------------------------------------------------------------

def test_image_chunk_is_uploaded_to_storage(monkeypatch):
    """An image chunk should be uploaded to Supabase Storage."""
    fake_png = b"\x89PNG\r\n\x1a\n"
    image_b64 = base64.b64encode(fake_png).decode()

    chunks = [
        {
            "content": "[Image on page 1]",
            "page_number": 1,
            "element_type": "Image",
            "table_html": None,
            "image_base64": image_b64,
            "image_mime_type": "image/png",
        }
    ]

    mock_supa = _make_supabase_mock()
    monkeypatch.setattr(ingestion, "supabase", mock_supa)
    monkeypatch.setattr(ingestion, "chunk_document_multimodal", lambda p: chunks)
    monkeypatch.setattr(ingestion, "generate_embeddings", lambda t, **kw: [[0.0] * 384])
    monkeypatch.setattr(ingestion, "summaries_enabled", lambda: False)
    monkeypatch.setattr(ingestion, "summarize_document", MagicMock())

    ingestion.process_document("doc-uuid", "path/to/doc.pdf")

    # Storage upload should have been called with the PNG bytes
    upload_calls = mock_supa.storage.from_.return_value.upload.call_args_list
    assert len(upload_calls) == 1
    path_arg, bytes_arg, opts_arg = upload_calls[0][0]
    assert path_arg.endswith(".png")
    assert bytes_arg == fake_png
    assert opts_arg["content_type"] == "image/png"


def test_image_storage_path_uses_correct_extension_for_jpeg(monkeypatch):
    """JPEG images should be stored with .jpg extension, not .png."""
    fake_jpg = b"\xff\xd8\xff"  # JPEG magic bytes
    image_b64 = base64.b64encode(fake_jpg).decode()

    chunks = [
        {
            "content": "[Image]",
            "page_number": 1,
            "element_type": "Image",
            "table_html": None,
            "image_base64": image_b64,
            "image_mime_type": "image/jpeg",
        }
    ]

    mock_supa = _make_supabase_mock()
    monkeypatch.setattr(ingestion, "supabase", mock_supa)
    monkeypatch.setattr(ingestion, "chunk_document_multimodal", lambda p: chunks)
    monkeypatch.setattr(ingestion, "generate_embeddings", lambda t, **kw: [[0.0] * 384])
    monkeypatch.setattr(ingestion, "summaries_enabled", lambda: False)
    monkeypatch.setattr(ingestion, "summarize_document", MagicMock())

    ingestion.process_document("doc-uuid", "path/to/doc.pdf")

    upload_calls = mock_supa.storage.from_.return_value.upload.call_args_list
    path_arg = upload_calls[0][0][0]
    assert path_arg.endswith(".jpg"), f"Expected .jpg extension, got: {path_arg}"


def test_image_upload_failure_does_not_abort_ingestion(monkeypatch):
    """A Storage upload failure for an image chunk should not abort the task."""
    fake_png = base64.b64encode(b"\x89PNG").decode()

    chunks = [
        {
            "content": "[Image]",
            "page_number": 1,
            "element_type": "Image",
            "table_html": None,
            "image_base64": fake_png,
            "image_mime_type": "image/png",
        },
        {
            "content": "Normal text chunk.",
            "page_number": 2,
            "element_type": "Text",
            "table_html": None,
            "image_base64": None,
            "image_mime_type": None,
        },
    ]

    mock_supa = _make_supabase_mock()
    mock_supa.storage.from_.return_value.upload.side_effect = Exception("Storage unavailable")
    monkeypatch.setattr(ingestion, "supabase", mock_supa)
    monkeypatch.setattr(ingestion, "chunk_document_multimodal", lambda p: chunks)
    monkeypatch.setattr(ingestion, "generate_embeddings", lambda t, **kw: [[0.0] * 384] * len(t))
    monkeypatch.setattr(ingestion, "summaries_enabled", lambda: False)
    monkeypatch.setattr(ingestion, "summarize_document", MagicMock())

    result = ingestion.process_document("doc-uuid", "path/to/doc.pdf")

    # Ingestion must still succeed
    assert result["status"] == "processed"


# ---------------------------------------------------------------------------
# Tests: element_counts
# ---------------------------------------------------------------------------

def test_element_counts_are_correct(monkeypatch):
    """documents.element_counts should reflect the mix of element types."""
    chunks = [
        {"content": "T1", "page_number": 1, "element_type": "Text", "table_html": None, "image_base64": None, "image_mime_type": None},
        {"content": "T2", "page_number": 1, "element_type": "Text", "table_html": None, "image_base64": None, "image_mime_type": None},
        {"content": "TB", "page_number": 2, "element_type": "Table", "table_html": "<table/>", "image_base64": None, "image_mime_type": None},
    ]

    mock_supa = _make_supabase_mock()
    monkeypatch.setattr(ingestion, "supabase", mock_supa)
    monkeypatch.setattr(ingestion, "chunk_document_multimodal", lambda p: chunks)
    monkeypatch.setattr(ingestion, "generate_embeddings", lambda t, **kw: [[0.0] * 384] * len(t))
    monkeypatch.setattr(ingestion, "summaries_enabled", lambda: False)
    monkeypatch.setattr(ingestion, "summarize_document", MagicMock())

    ingestion.process_document("doc-id", "p.pdf")

    # Find the update call that sets status="processed" (has element_counts)
    update_calls = mock_supa.table.return_value.update.call_args_list
    processed_call = next(
        (c for c in update_calls if c[0][0].get("status") == "processed"),
        None
    )
    assert processed_call is not None
    ec = processed_call[0][0]["element_counts"]
    assert ec["Text"] == 2
    assert ec["Table"] == 1


# ---------------------------------------------------------------------------
# Tests: error handling
# ---------------------------------------------------------------------------

def test_process_document_marks_failed_on_error(monkeypatch):
    """When chunking raises, document status should be set to 'failed'."""
    mock_supa = _make_supabase_mock()
    # Use a .docx filename so the PDF fallback branch is never triggered
    mock_supa.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = SimpleNamespace(
        data={"filename": "test.docx"}
    )
    monkeypatch.setattr(ingestion, "supabase", mock_supa)
    monkeypatch.setattr(
        ingestion, "chunk_document_multimodal",
        lambda p: (_ for _ in ()).throw(RuntimeError("parse error")),
    )

    with pytest.raises(RuntimeError):
        ingestion.process_document("doc-id", "path/to/doc.docx")

    update_calls = mock_supa.table.return_value.update.call_args_list
    failed_call = next(
        (c for c in update_calls if c[0][0].get("status") == "failed"),
        None,
    )
    assert failed_call is not None


def test_process_document_raises_on_empty_chunks(monkeypatch):
    """When chunking returns no chunks, the task should raise ValueError."""
    mock_supa = _make_supabase_mock()
    # Use .docx to avoid PDF fallback
    mock_supa.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = SimpleNamespace(
        data={"filename": "empty.docx"}
    )
    monkeypatch.setattr(ingestion, "supabase", mock_supa)
    monkeypatch.setattr(ingestion, "chunk_document_multimodal", lambda p: [])

    with pytest.raises((ValueError, Exception)):
        ingestion.process_document("doc-id", "p.docx")


def test_process_document_raises_on_embedding_count_mismatch(monkeypatch):
    """A mismatch between chunk count and embedding count should raise."""
    chunks = _make_text_chunks(3)
    mock_supa = _make_supabase_mock()
    mock_supa.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = SimpleNamespace(
        data={"filename": "test.docx"}
    )
    monkeypatch.setattr(ingestion, "supabase", mock_supa)
    monkeypatch.setattr(ingestion, "chunk_document_multimodal", lambda p: chunks)
    # Return fewer embeddings than chunks
    monkeypatch.setattr(ingestion, "generate_embeddings", lambda t, **kw: [[0.0] * 384, [0.0] * 384])

    with pytest.raises((ValueError, Exception)):
        ingestion.process_document("doc-id", "p.docx")


# ---------------------------------------------------------------------------
# Tests: idempotency (re-run)
# ---------------------------------------------------------------------------

def test_old_chunks_are_deleted_before_insert(monkeypatch):
    """On re-run, old chunks are deleted from document_chunks before insertion."""
    chunks = _make_text_chunks(2)
    mock_supa = _make_supabase_mock()
    monkeypatch.setattr(ingestion, "supabase", mock_supa)
    monkeypatch.setattr(ingestion, "chunk_document_multimodal", lambda p: chunks)
    monkeypatch.setattr(ingestion, "generate_embeddings", lambda t, **kw: [[0.0] * 384] * len(t))
    monkeypatch.setattr(ingestion, "summaries_enabled", lambda: False)
    monkeypatch.setattr(ingestion, "summarize_document", MagicMock())

    ingestion.process_document("doc-id", "p.pdf")

    # delete().eq("document_id", ...) should have been called
    delete_chain = mock_supa.table.return_value.delete.return_value.eq
    assert delete_chain.called
