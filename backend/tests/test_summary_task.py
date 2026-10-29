"""Unit tests for the background summarisation task.

Covers:
- Happy-path: text chunks get summarised and embedded.
- Resumability: already-summarised chunks (summary_embedding IS NOT NULL) are skipped.
- SUMMARY_MAX_CHUNKS cutoff.
- Rate-limit retry path (SummaryRateLimited).
- Unhandled exception sets summary_status='failed'.
- summaries_enabled() env-var guard.

No real Groq, Supabase, or Redis calls are made.
"""

import types
from types import SimpleNamespace
from unittest.mock import MagicMock, call

import pytest

import app.tasks.summary_tasks as st
from app.services.summarizer import SummaryRateLimited


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_supabase_mock(pending_rows, total_count=None):
    """Build a supabase mock that returns pending_rows for the pending query."""
    mock = MagicMock()

    # Count query: .table().select().eq().execute().count
    count_result = SimpleNamespace(count=total_count if total_count is not None else len(pending_rows))
    mock.table.return_value.select.return_value.eq.return_value.execute.return_value = count_result

    # Pending query: .table().select().eq().is_().order().execute().data
    mock.table.return_value.select.return_value.eq.return_value.is_.return_value.order.return_value.execute.return_value = SimpleNamespace(data=pending_rows)

    # update chain
    mock.table.return_value.update.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[])

    return mock


def _text_row(chunk_id: str, content: str = "Some text content."):
    return {
        "id": chunk_id,
        "content": content,
        "summary": "",
        "element_type": "Text",
        "image_storage_path": None,
        "image_mime_type": None,
    }


def _image_row(chunk_id: str, image_path: str = "doc/images/0.png"):
    return {
        "id": chunk_id,
        "content": "[Image on page 1]",
        "summary": "",
        "element_type": "Image",
        "image_storage_path": image_path,
        "image_mime_type": "image/png",
    }


# ---------------------------------------------------------------------------
# Tests: summarisation happy path
# ---------------------------------------------------------------------------

def test_text_chunks_are_summarised_and_embedded(monkeypatch):
    """Text chunks get a summary generated and a summary_embedding set."""
    rows = [_text_row("c1"), _text_row("c2")]
    mock_supa = _make_supabase_mock(rows, total_count=2)
    monkeypatch.setattr(st, "supabase", mock_supa)
    monkeypatch.setattr(st, "summarize_chunk", lambda content: SimpleNamespace(text="A summary.", tokens_used=50))
    monkeypatch.setattr(st, "generate_embeddings", lambda texts, **kw: [[0.1] * 384] * len(texts))
    monkeypatch.setattr(st, "pause_after", lambda tokens: None)
    monkeypatch.setattr(st, "describe_image", lambda b64, mime: None)

    result = st.summarize_document_chunks("doc-id")

    assert result["status"] == "done"
    assert result["summarized"] == 2


def test_already_summarised_chunks_are_skipped(monkeypatch):
    """Chunks with an existing summary_embedding (null-filtered by the query) are not in pending."""
    # The mock returns zero pending rows — all chunks already have summary_embedding
    mock_supa = _make_supabase_mock(pending_rows=[], total_count=5)
    monkeypatch.setattr(st, "supabase", mock_supa)
    monkeypatch.setattr(st, "generate_embeddings", MagicMock())

    result = st.summarize_document_chunks("doc-id")

    assert result["status"] == "done"
    assert result["summarized"] == 0
    # No embedding calls made
    st.generate_embeddings.assert_not_called()


# ---------------------------------------------------------------------------
# Tests: SUMMARY_MAX_CHUNKS cutoff
# ---------------------------------------------------------------------------

def test_document_skipped_when_over_max_chunks(monkeypatch):
    """Documents over SUMMARY_MAX_CHUNKS get status='skipped' without any work."""
    mock_supa = _make_supabase_mock(pending_rows=[], total_count=999)
    monkeypatch.setattr(st, "supabase", mock_supa)
    monkeypatch.setenv("SUMMARY_MAX_CHUNKS", "10")

    result = st.summarize_document_chunks("doc-id")

    assert result["status"] == "skipped"


def test_document_not_skipped_at_exact_limit(monkeypatch):
    """A document at exactly SUMMARY_MAX_CHUNKS should NOT be skipped."""
    rows = [_text_row("c1")]
    mock_supa = _make_supabase_mock(rows, total_count=10)
    monkeypatch.setattr(st, "supabase", mock_supa)
    monkeypatch.setenv("SUMMARY_MAX_CHUNKS", "10")
    monkeypatch.setattr(st, "summarize_chunk", lambda c: SimpleNamespace(text="summary", tokens_used=20))
    monkeypatch.setattr(st, "generate_embeddings", lambda t, **kw: [[0.0] * 384] * len(t))
    monkeypatch.setattr(st, "pause_after", lambda t: None)
    monkeypatch.setattr(st, "describe_image", lambda b64, mime: None)

    result = st.summarize_document_chunks("doc-id")

    assert result["status"] != "skipped"


# ---------------------------------------------------------------------------
# Tests: rate-limit handling
# ---------------------------------------------------------------------------

def test_rate_limit_error_propagates_as_summary_rate_limited(monkeypatch):
    """SummaryRateLimited raised by summarize_chunk should propagate to the task."""
    rows = [_text_row("c1")]
    mock_supa = _make_supabase_mock(rows, total_count=1)
    monkeypatch.setattr(st, "supabase", mock_supa)
    monkeypatch.setattr(
        st, "summarize_chunk",
        lambda c: (_ for _ in ()).throw(SummaryRateLimited(60.0)),
    )
    monkeypatch.setattr(st, "generate_embeddings", MagicMock())
    monkeypatch.setattr(st, "pause_after", lambda t: None)

    with pytest.raises(SummaryRateLimited):
        st.summarize_document_chunks("doc-id")


# ---------------------------------------------------------------------------
# Tests: partial status
# ---------------------------------------------------------------------------

def test_partial_status_when_some_chunks_unusable(monkeypatch):
    """When summarize_chunk returns no text for some chunks, status is 'partial'."""
    rows = [_text_row("c1"), _text_row("c2")]
    mock_supa = _make_supabase_mock(rows, total_count=2)
    monkeypatch.setattr(st, "supabase", mock_supa)
    # First chunk: no summary; second: has summary
    call_count = [0]

    def _selective_summarize(content):
        call_count[0] += 1
        if call_count[0] == 1:
            return SimpleNamespace(text=None, tokens_used=10)   # unusable
        return SimpleNamespace(text="A summary.", tokens_used=50)

    monkeypatch.setattr(st, "summarize_chunk", _selective_summarize)
    monkeypatch.setattr(st, "generate_embeddings", lambda t, **kw: [[0.0] * 384] * len(t))
    monkeypatch.setattr(st, "pause_after", lambda t: None)
    monkeypatch.setattr(st, "describe_image", lambda b64, mime: None)

    result = st.summarize_document_chunks("doc-id")

    assert result["status"] == "partial"
    assert result["unusable"] == 1
    assert result["summarized"] == 1


# ---------------------------------------------------------------------------
# Tests: image chunk handling
# ---------------------------------------------------------------------------

def test_image_chunk_uses_vision_caption(monkeypatch):
    """An image chunk with a storage path should use the vision caption."""
    rows = [_image_row("img-1")]
    mock_supa = _make_supabase_mock(rows, total_count=1)
    mock_supa.storage.from_.return_value.download.return_value = b"fake-png-bytes"
    monkeypatch.setattr(st, "supabase", mock_supa)
    monkeypatch.setattr(st, "describe_image", lambda b64, mime: "A pie chart showing revenue.")
    monkeypatch.setattr(st, "generate_embeddings", lambda t, **kw: [[0.0] * 384] * len(t))
    monkeypatch.setattr(st, "pause_after", lambda t: None)

    result = st.summarize_document_chunks("doc-id")

    assert result["summarized"] == 1


def test_image_chunk_without_path_gets_not_analyzed_marker(monkeypatch):
    """An image chunk without a storage path gets the 'not available' marker."""
    rows = [_image_row("img-no-path", image_path=None)]
    mock_supa = _make_supabase_mock(rows, total_count=1)
    monkeypatch.setattr(st, "supabase", mock_supa)
    monkeypatch.setattr(st, "generate_embeddings", lambda t, **kw: [[0.0] * 384] * len(t))
    monkeypatch.setattr(st, "pause_after", lambda t: None)

    result = st.summarize_document_chunks("doc-id")

    # unusable == 1 (marker, not a real caption)
    assert result["unusable"] == 1


# ---------------------------------------------------------------------------
# Tests: summaries_enabled guard
# ---------------------------------------------------------------------------

def test_summaries_enabled_true_by_default(monkeypatch):
    """summaries_enabled() should return True when SUMMARY_ENABLED is unset."""
    monkeypatch.delenv("SUMMARY_ENABLED", raising=False)
    assert st.summaries_enabled() is True


def test_summaries_disabled_via_env(monkeypatch):
    """summaries_enabled() should return False when SUMMARY_ENABLED=false."""
    monkeypatch.setenv("SUMMARY_ENABLED", "false")
    assert st.summaries_enabled() is False


# ---------------------------------------------------------------------------
# Tests: unhandled exception
# ---------------------------------------------------------------------------

def test_unhandled_exception_propagates_from_summarize_document_chunks(monkeypatch):
    """An unexpected DB error in summarize_document_chunks propagates up."""
    mock_supa = _make_supabase_mock([], total_count=1)
    # Make the count query raise
    mock_supa.table.return_value.select.return_value.eq.return_value.execute.side_effect = RuntimeError("DB error")
    monkeypatch.setattr(st, "supabase", mock_supa)

    with pytest.raises(RuntimeError):
        st.summarize_document_chunks("doc-id")


def test_celery_task_sets_failed_status_on_exception(monkeypatch):
    """When summarize_document_chunks raises, the Celery task sets summary_status='failed'."""
    mock_supa = _make_supabase_mock([], total_count=1)
    monkeypatch.setattr(st, "supabase", mock_supa)
    monkeypatch.setattr(
        st, "summarize_document_chunks",
        lambda doc_id: (_ for _ in ()).throw(RuntimeError("unexpected")),
    )

    # Simulate Celery task execution (without a real broker) by calling the
    # underlying function directly via the task's run method.
    with pytest.raises(RuntimeError):
        st.summarize_document.run("doc-id")

    update_calls = mock_supa.table.return_value.update.call_args_list
    failed_call = next(
        (c for c in update_calls if c[0][0].get("summary_status") == "failed"),
        None,
    )
    assert failed_call is not None
