"""Focused tests for multimodal-aware summaries (image caption generation).

Tests verify that:
- _summarize_image_chunk returns a caption when the vision model succeeds.
- _summarize_image_chunk returns a 'not analyzed' marker when vision is
  disabled or the image is not in storage.
- The marker is clearly distinguishable from a real caption.
"""

from types import SimpleNamespace

import app.tasks.summary_tasks as summary_tasks
import app.services.vision as vision


# --------------------------------------------------------------- helpers
def _make_image_row(image_path="doc/images/0.png", image_mime="image/png"):
    """Build a mock DB row for an image chunk."""
    return {
        "id": "chunk-uuid-1",
        "content": "[Image on page 1]",
        "summary": "",
        "element_type": "Image",
        "image_storage_path": image_path,
        "image_mime_type": image_mime,
    }


def _mock_storage_download(monkeypatch, image_bytes=b"fake-png-bytes"):
    """Mock supabase.storage download to return fake image bytes."""
    class FakeStorage:
        def from_(self, bucket):
            return SimpleNamespace(download=lambda path: image_bytes)

    monkeypatch.setattr(summary_tasks, "supabase", SimpleNamespace(storage=FakeStorage()))


# ----------------------------------------------------- vision succeeds
def test_image_chunk_returns_caption_when_vision_succeeds(monkeypatch):
    """When describe_image returns a caption, _summarize_image_chunk returns it."""
    _mock_storage_download(monkeypatch)
    monkeypatch.setattr(
        summary_tasks, "describe_image",
        lambda b64, mime: "A bar chart showing quarterly revenue growth.",
    )

    row = _make_image_row()
    result = summary_tasks._summarize_image_chunk(row)

    assert result == "A bar chart showing quarterly revenue growth."
    assert not result.startswith("[Image not analyzed")


# ----------------------------------------------- vision disabled / fails
def test_image_chunk_returns_marker_when_vision_disabled(monkeypatch):
    """When vision is disabled, _summarize_image_chunk returns a marker."""
    _mock_storage_download(monkeypatch)
    monkeypatch.setattr(
        summary_tasks, "describe_image",
        lambda b64, mime: None,  # vision disabled returns None
    )

    row = _make_image_row()
    result = summary_tasks._summarize_image_chunk(row)

    assert result.startswith("[Image not analyzed")


def test_image_chunk_returns_marker_when_image_not_in_storage(monkeypatch):
    """When there's no image_storage_path, return 'not available' marker."""
    row = _make_image_row(image_path=None)

    result = summary_tasks._summarize_image_chunk(row)

    assert result.startswith("[Image not analyzed")
    assert "not available" in result


def test_image_chunk_returns_marker_when_download_fails(monkeypatch):
    """When storage download raises, return a 'not analyzed' marker."""
    class FakeStorage:
        def from_(self, bucket):
            def _raise(path):
                raise Exception("Storage error")
            return SimpleNamespace(download=_raise)

    monkeypatch.setattr(summary_tasks, "supabase", SimpleNamespace(storage=FakeStorage()))

    row = _make_image_row()
    result = summary_tasks._summarize_image_chunk(row)

    assert result.startswith("[Image not analyzed")


# ----------------------------------------------- marker is distinguishable
def test_real_caption_does_not_start_with_marker_prefix(monkeypatch):
    """A real caption must NOT start with '[Image not analyzed'."""
    _mock_storage_download(monkeypatch)
    monkeypatch.setattr(
        summary_tasks, "describe_image",
        lambda b64, mime: "Diagram showing the system architecture.",
    )

    row = _make_image_row()
    result = summary_tasks._summarize_image_chunk(row)

    assert not result.startswith("[Image not analyzed")


# ------------------------------------------------------- vision module
def test_describe_image_returns_none_when_disabled(monkeypatch):
    """describe_image returns None when VISION_SUMMARY_ENABLED is false."""
    monkeypatch.setattr(vision, "vision_summary_enabled", lambda: False)

    result = vision.describe_image("iVBORw0KGgo=", "image/png")
    assert result is None


def test_describe_image_returns_caption_when_enabled(monkeypatch):
    """describe_image returns the caption when vision is enabled and the API works."""
    monkeypatch.setattr(vision, "vision_summary_enabled", lambda: True)

    mock_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=lambda **kw: SimpleNamespace(
                    choices=[
                        SimpleNamespace(
                            message=SimpleNamespace(
                                content="A line chart showing growth over time."
                            )
                        )
                    ]
                )
            )
        )
    )
    monkeypatch.setattr(vision, "_get_vision_client", lambda: mock_client)

    result = vision.describe_image("iVBORw0KGgo=", "image/png")
    assert result == "A line chart showing growth over time."


def test_describe_image_returns_none_on_api_error(monkeypatch):
    """describe_image returns None when the Groq API call fails."""
    monkeypatch.setattr(vision, "vision_summary_enabled", lambda: True)

    def _raise_client():
        raise Exception("API error")

    monkeypatch.setattr(vision, "_get_vision_client", _raise_client)

    result = vision.describe_image("iVBORw0KGgo=", "image/png")
    assert result is None


def test_describe_image_returns_none_for_empty_base64():
    """describe_image returns None when image_base64 is empty."""
    result = vision.describe_image("", "image/png")
    assert result is None
