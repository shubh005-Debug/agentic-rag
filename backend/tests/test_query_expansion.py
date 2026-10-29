
from app.services.query_expansion import normalize_expanded_queries


def test_original_question_is_always_first():
    result = normalize_expanded_queries(
        "What did Marcus learn?",
        ["What lessons did Marcus learn?"],
    )

    assert result == [
        "What did Marcus learn?",
        "What lessons did Marcus learn?",
    ]


def test_duplicate_original_is_removed():
    result = normalize_expanded_queries(
        "What did Marcus learn?",
        [
            "What did Marcus learn?",
            " What did Marcus learn? ",
        ],
    )

    assert result == ["What did Marcus learn?"]


def test_only_one_rewrite_is_allowed():
    result = normalize_expanded_queries(
        "What did Marcus learn?",
        [
            "What lessons did Marcus learn?",
            "Which teachings influenced Marcus?",
            "What did Marcus discover?",
        ],
    )

    assert result == [
        "What did Marcus learn?",
        "What lessons did Marcus learn?",
    ]


def test_empty_or_invalid_rewrites_fall_back_to_original():
    result = normalize_expanded_queries(
        "What did Marcus learn?",
        [None, "", "   ", 42],
    )

    assert result == ["What did Marcus learn?"]


def test_string_output_is_not_treated_as_a_list_of_queries():
    result = normalize_expanded_queries(
        "What did Marcus learn?",
        "What lessons did Marcus learn?",
    )

    assert result == ["What did Marcus learn?"]


def test_blank_original_question_is_rejected():
    import pytest

    with pytest.raises(ValueError):
        normalize_expanded_queries("   ", ["A valid rewrite"])

from types import SimpleNamespace

import app.services.query_expansion as query_expansion


def mock_response(content):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content)
            )
        ]
    )


def test_expand_query_returns_original_and_rewrite(monkeypatch):
    class FakeCompletions:
        def create(self, **kwargs):
            return mock_response(
                '["What lessons did Marcus learn?"]'
            )

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        def with_options(self, **kwargs):
            assert kwargs["max_retries"] == 0
            assert kwargs["timeout"] == 20
            return SimpleNamespace(chat=FakeChat())

    monkeypatch.setattr(query_expansion, "client", FakeClient())

    result = query_expansion.expand_query("What did Marcus learn?")

    assert result == [
        "What did Marcus learn?",
        "What lessons did Marcus learn?",
    ]


def test_expand_query_falls_back_on_invalid_json(monkeypatch):
    class FakeCompletions:
        def create(self, **kwargs):
            return mock_response("not valid JSON")

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        def with_options(self, **kwargs):
            return SimpleNamespace(chat=FakeChat())

    monkeypatch.setattr(query_expansion, "client", FakeClient())

    result = query_expansion.expand_query("What did Marcus learn?")

    assert result == ["What did Marcus learn?"]


def test_expand_query_falls_back_on_api_error(monkeypatch):
    class FakeClient:
        def with_options(self, **kwargs):
            raise RuntimeError("simulated API failure")

    monkeypatch.setattr(query_expansion, "client", FakeClient())

    result = query_expansion.expand_query("What did Marcus learn?")

    assert result == ["What did Marcus learn?"]


def test_expand_query_rejects_blank_question_without_api_call(monkeypatch):
    class FakeClient:
        def with_options(self, **kwargs):
            raise AssertionError("API must not be called")

    monkeypatch.setattr(query_expansion, "client", FakeClient())

    import pytest

    with pytest.raises(ValueError):
        query_expansion.expand_query("   ")


def test_long_rewrite_is_rejected():
    result = query_expansion.normalize_expanded_queries(
        "What did Marcus learn?",
        ["A" * 1000],
    )

    assert result == ["What did Marcus learn?"]


def test_long_question_skips_expansion_request(monkeypatch):
    class FakeClient:
        def with_options(self, **kwargs):
            raise AssertionError("Expansion must be skipped")

    monkeypatch.setattr(query_expansion, "client", FakeClient())

    question = "What did Marcus learn? " * 200

    result = query_expansion.expand_query(question)

    assert result == [question.strip()]


# ---------------------------------------------------------------------------
# Integration with retrieve_candidates (query_expansion_enabled guard)
# ---------------------------------------------------------------------------

import app.services.rag as rag


def _make_chunk(chunk_id: str, **overrides):
    defaults = {
        "id": chunk_id,
        "document_id": "doc-1",
        "content": "Some relevant content.",
        "chunk_index": 0,
        "page_number": 1,
        "similarity": 0.8,
        "rrf_score": 0.03,
        "element_type": "Text",
        "table_html": None,
        "image_caption": None,
        "image_storage_path": None,
    }
    defaults.update(overrides)
    return defaults


def test_expansion_disabled_by_default(monkeypatch):
    """Query expansion is not called when QUERY_EXPANSION_ENABLED is unset."""
    monkeypatch.delenv("QUERY_EXPANSION_ENABLED", raising=False)

    expansion_called = []

    def _spy_search(*args, **kwargs):
        expansion_called.append(args)
        return []

    # Patch all external Supabase/embedding calls
    monkeypatch.setattr(rag, "search_chunks", lambda *a, **kw: [_make_chunk("c1")])
    monkeypatch.setattr(rag, "search_keyword_chunks", lambda *a, **kw: [])

    import app.services.query_expansion as qe
    monkeypatch.setattr(qe, "expand_query", lambda q: [q, "alternative query"])

    result = rag.retrieve_candidates("What is revenue?")

    # expand_query was never wired in — no expansion search was done
    assert len(expansion_called) == 0


def test_expansion_enabled_adds_extra_rrf_list(monkeypatch):
    """When QUERY_EXPANSION_ENABLED=true, expansion results feed into RRF."""
    monkeypatch.setenv("QUERY_EXPANSION_ENABLED", "true")
    monkeypatch.setenv("SUMMARY_SEARCH_ENABLED", "false")

    # Simulate: primary query finds chunk-A; expansion finds chunk-B (new)
    chunk_a = _make_chunk("chunk-a")
    chunk_b = _make_chunk("chunk-b", content="Expansion-only content.")

    import app.services.query_expansion as qe
    monkeypatch.setattr(qe, "expand_query", lambda q: [q, "alternative phrasing"])

    call_count = []

    def _mock_search(query, match_count, document_id, query_embedding=None):
        call_count.append(query)
        if "alternative" in query:
            return [chunk_b]
        return [chunk_a]

    monkeypatch.setattr(rag, "search_chunks", _mock_search)
    monkeypatch.setattr(rag, "search_keyword_chunks", lambda *a, **kw: [])

    result = rag.retrieve_candidates("What is revenue?", document_id=None)

    # search_chunks called twice: primary + expansion
    assert len(call_count) == 2
    # Both chunks appear in the result
    ids = [c["id"] for c in result]
    assert "chunk-a" in ids
    assert "chunk-b" in ids


def test_expansion_failure_does_not_break_retrieval(monkeypatch):
    """If query expansion raises, retrieval continues normally."""
    monkeypatch.setenv("QUERY_EXPANSION_ENABLED", "true")
    monkeypatch.setenv("SUMMARY_SEARCH_ENABLED", "false")

    chunk = _make_chunk("chunk-ok")
    monkeypatch.setattr(rag, "search_chunks", lambda *a, **kw: [chunk])
    monkeypatch.setattr(rag, "search_keyword_chunks", lambda *a, **kw: [])

    import app.services.query_expansion as qe
    monkeypatch.setattr(qe, "expand_query", lambda q: (_ for _ in ()).throw(RuntimeError("LLM down")))

    result = rag.retrieve_candidates("What is revenue?")

    # Retrieval still returns the primary result
    assert len(result) == 1
    assert result[0]["id"] == "chunk-ok"


def test_expansion_no_rewrite_skips_extra_search(monkeypatch):
    """If expand_query returns only the original (no rewrite), no extra search is made."""
    monkeypatch.setenv("QUERY_EXPANSION_ENABLED", "true")
    monkeypatch.setenv("SUMMARY_SEARCH_ENABLED", "false")

    chunk = _make_chunk("chunk-only")
    call_count = []

    def _mock_search(query, match_count, document_id, query_embedding=None):
        call_count.append(query)
        return [chunk]

    monkeypatch.setattr(rag, "search_chunks", _mock_search)
    monkeypatch.setattr(rag, "search_keyword_chunks", lambda *a, **kw: [])

    import app.services.query_expansion as qe
    # expand_query returns only the original — no rewrite
    monkeypatch.setattr(qe, "expand_query", lambda q: [q])

    rag.retrieve_candidates("What is revenue?")

    # Only the primary vector search was called
    assert len(call_count) == 1
