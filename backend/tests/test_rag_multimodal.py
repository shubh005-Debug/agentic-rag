"""Focused tests for multimodal-aware retrieval and answer generation.

Tests verify that:
- The LLM context includes table HTML for table chunks.
- The LLM context includes image captions for image chunks.
- Sources include element_type, table_html, image_caption, has_image.
- The not-found behaviour is preserved (empty sources → NOT_FOUND_ANSWER).
- Cohere reranking failure falls back to RRF order without crashing.
"""

import app.services.rag as rag


def _make_text_chunk(**overrides):
    defaults = {
        "id": "chunk-1",
        "document_id": "doc-1",
        "content": "Revenue grew 15 percent this quarter.",
        "chunk_index": 0,
        "page_number": 1,
        "similarity": 0.85,
        "rrf_score": 0.034,
        "rerank_score": 0.92,
        "element_type": "Text",
        "table_html": None,
        "image_caption": None,
        "image_storage_path": None,
    }
    defaults.update(overrides)
    return defaults


def _make_table_chunk(**overrides):
    defaults = {
        "id": "chunk-2",
        "document_id": "doc-1",
        "content": "Product Price Widget 10",
        "chunk_index": 1,
        "page_number": 2,
        "similarity": 0.78,
        "rrf_score": 0.028,
        "rerank_score": 0.88,
        "element_type": "Table",
        "table_html": "<table><tr><td>Product</td><td>Price</td></tr></table>",
        "image_caption": None,
        "image_storage_path": None,
    }
    defaults.update(overrides)
    return defaults


def _make_image_chunk(**overrides):
    defaults = {
        "id": "chunk-3",
        "document_id": "doc-1",
        "content": "[Image on page 3]",
        "chunk_index": 2,
        "page_number": 3,
        "similarity": 0.71,
        "rrf_score": 0.022,
        "rerank_score": 0.75,
        "element_type": "Image",
        "table_html": None,
        "image_caption": "A bar chart showing quarterly revenue growth.",
        "image_storage_path": "doc-1/images/2.png",
    }
    defaults.update(overrides)
    return defaults


def _patch_rag(monkeypatch, chunks, answer="The revenue grew 15 percent.", rerank_fn=None):
    """Patch retrieve_candidates, rerank_chunks, and generate_answer."""
    monkeypatch.setattr(rag, "retrieve_candidates", lambda *args, **kw: chunks)

    if rerank_fn is not None:
        monkeypatch.setattr(rag, "rerank_chunks", rerank_fn)
    else:
        monkeypatch.setattr(
            rag, "rerank_chunks",
            lambda **kw: chunks,
        )

    captured = {}

    def _capture_answer(question, context):
        captured["context"] = context
        return answer

    monkeypatch.setattr(rag, "generate_answer", _capture_answer)
    return captured


# ------------------------------------------------------- context building
def test_context_includes_table_html(monkeypatch):
    """The context passed to the LLM should include table HTML for table chunks."""
    chunks = [_make_table_chunk()]
    captured = _patch_rag(monkeypatch, chunks)

    rag.ask_rag("What are the prices?", document_id=None)

    assert "Table HTML:" in captured["context"]
    assert "<table>" in captured["context"]


def test_context_includes_image_caption(monkeypatch):
    """The context passed to the LLM should include image captions."""
    chunks = [_make_image_chunk()]
    captured = _patch_rag(monkeypatch, chunks)

    rag.ask_rag("What does the chart show?", document_id=None)

    assert "bar chart" in captured["context"].lower()
    assert "[Image" in captured["context"]


def test_context_for_text_chunk_is_plain(monkeypatch):
    """Text chunks should produce plain content in the context."""
    chunks = [_make_text_chunk()]
    captured = _patch_rag(monkeypatch, chunks)

    rag.ask_rag("How much did revenue grow?", document_id=None)

    assert "Revenue grew" in captured["context"]
    assert "[Table" not in captured["context"]
    assert "[Image" not in captured["context"]


def test_context_includes_all_chunk_types(monkeypatch):
    """A mix of text, table, and image chunks should all appear in context."""
    chunks = [_make_text_chunk(), _make_table_chunk(), _make_image_chunk()]
    captured = _patch_rag(monkeypatch, chunks)

    rag.ask_rag("Summarize the document", document_id=None)

    ctx = captured["context"]
    assert "Revenue grew" in ctx
    assert "Table HTML:" in ctx
    assert "bar chart" in ctx.lower()


# --------------------------------------------------------------- sources
def test_sources_include_element_type(monkeypatch):
    """Sources should include element_type for each chunk."""
    chunks = [_make_text_chunk(), _make_table_chunk(), _make_image_chunk()]
    _patch_rag(monkeypatch, chunks)

    result = rag.ask_rag("Show everything", document_id=None)

    types = [s["element_type"] for s in result["sources"]]
    assert "Text" in types
    assert "Table" in types
    assert "Image" in types


def test_sources_include_table_html(monkeypatch):
    """Sources should include table_html for table chunks."""
    chunks = [_make_table_chunk()]
    _patch_rag(monkeypatch, chunks)

    result = rag.ask_rag("What are the prices?", document_id=None)

    assert result["sources"][0]["table_html"] is not None
    assert "<table>" in result["sources"][0]["table_html"]


def test_sources_include_image_caption(monkeypatch):
    """Sources should include image_caption for image chunks."""
    chunks = [_make_image_chunk()]
    _patch_rag(monkeypatch, chunks)

    result = rag.ask_rag("What does the chart show?", document_id=None)

    assert result["sources"][0]["image_caption"] is not None
    assert "bar chart" in result["sources"][0]["image_caption"].lower()


def test_sources_include_has_image_flag(monkeypatch):
    """has_image is True when image_storage_path is present, False otherwise."""
    chunks = [_make_text_chunk(), _make_image_chunk()]
    _patch_rag(monkeypatch, chunks)

    result = rag.ask_rag("Show everything", document_id=None)

    by_type = {s["element_type"]: s for s in result["sources"]}
    assert by_type["Image"]["has_image"] is True
    assert by_type["Text"]["has_image"] is False


def test_has_image_false_when_image_upload_failed(monkeypatch):
    """has_image must be False for an image chunk whose storage upload failed."""
    # element_type="Image" but no image_storage_path (upload failed)
    chunk = _make_image_chunk(image_storage_path=None)
    _patch_rag(monkeypatch, [chunk])

    result = rag.ask_rag("What does the chart show?", document_id=None)

    assert result["sources"][0]["has_image"] is False


# ----------------------------------------------------- not-found behaviour
def test_not_found_when_no_chunks(monkeypatch):
    """When retrieval returns no chunks, the not-found answer is returned."""
    monkeypatch.setattr(rag, "retrieve_candidates", lambda *args, **kw: [])
    monkeypatch.setattr(rag, "rerank_chunks", lambda **kw: [])

    result = rag.ask_rag("Nonexistent question", document_id=None)

    assert result["answer"] == rag.NOT_FOUND_ANSWER
    assert result["sources"] == []


def test_not_found_when_rerank_filters_all(monkeypatch):
    """When all chunks are below the rerank threshold, return not-found."""
    low_chunks = [_make_text_chunk(rerank_score=0.01)]
    monkeypatch.setattr(rag, "retrieve_candidates", lambda *args, **kw: low_chunks)
    monkeypatch.setattr(rag, "rerank_chunks", lambda **kw: low_chunks)

    result = rag.ask_rag("Irrelevant question", document_id=None)

    assert result["answer"] == rag.NOT_FOUND_ANSWER
    assert result["sources"] == []


# --------------------------------------------------- Cohere fallback
def test_cohere_failure_falls_back_to_rrf_order(monkeypatch):
    """When Cohere reranking fails, ask_rag should fall back to RRF order."""
    chunks = [_make_text_chunk(), _make_table_chunk(), _make_image_chunk()]
    captured = _patch_rag(
        monkeypatch, chunks,
        rerank_fn=lambda **kw: (_ for _ in ()).throw(Exception("Cohere API error")),
    )

    # Should NOT raise
    result = rag.ask_rag("What is the revenue?", document_id=None)

    # Should still return an answer and sources
    assert result["answer"] is not None
    assert len(result["sources"]) > 0


def test_cohere_failure_skips_score_filter(monkeypatch):
    """When Cohere fails, chunks should not be filtered by rerank_score."""
    # All chunks have rerank_score=0.0 (below default 0.55 threshold)
    # but if Cohere fails, the filter should be skipped.
    chunks = [_make_text_chunk(rerank_score=0.0)]
    captured = _patch_rag(
        monkeypatch, chunks,
        rerank_fn=lambda **kw: (_ for _ in ()).throw(Exception("Cohere down")),
    )

    result = rag.ask_rag("What is the revenue?", document_id=None)

    # Chunk should survive because the score filter was skipped
    assert len(result["sources"]) == 1
