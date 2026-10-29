"""Focused tests for the multimodal parser: chunk_document_multimodal().

These tests patch extract_elements() so no real file is needed. They verify
that the multimodal entry point preserves element types, separates table
HTML from content, and extracts image payloads.
"""

from unstructured.documents.elements import (
    ElementMetadata,
    Image,
    NarrativeText,
    Table,
    Title,
)

import app.services.unstructured_parser as parser


def _patch_elements(monkeypatch, elements):
    """Make extract_elements return the given elements regardless of path."""
    monkeypatch.setattr(parser, "extract_elements", lambda file_path, hi_res=False: elements)


# ----------------------------------------------------------------- Text
def test_text_chunk_has_element_type_text(monkeypatch):
    """A composite of Title + NarrativeText should be element_type='Text'."""
    title = Title(text="Introduction", metadata=ElementMetadata(page_number=1))
    narrative = NarrativeText(
        text="This document describes the system architecture.",
        metadata=ElementMetadata(page_number=1),
    )

    _patch_elements(monkeypatch, [title, narrative])

    chunks = parser.chunk_document_multimodal("fake.pdf")

    assert len(chunks) == 1
    assert chunks[0]["element_type"] == "Text"
    assert chunks[0]["table_html"] is None
    assert chunks[0]["image_base64"] is None
    assert "Introduction" in chunks[0]["content"]


# ----------------------------------------------------------------- Table
def test_table_chunk_separates_html_from_content(monkeypatch):
    """A Table chunk should have table_html separate from content (text)."""
    html = (
        "<table>"
        "<tr><td>Product</td><td>Price</td></tr>"
        "<tr><td>Widget</td><td>10</td></tr>"
        "</table>"
    )

    table = Table(
        text="Product Price Widget 10",
        metadata=ElementMetadata(text_as_html=html, page_number=2),
    )

    _patch_elements(monkeypatch, [table])

    chunks = parser.chunk_document_multimodal("fake.pdf")

    assert len(chunks) == 1
    assert chunks[0]["element_type"] == "Table"
    assert chunks[0]["table_html"] == html
    # Content is the text representation, NOT the HTML
    assert chunks[0]["content"] != html
    assert "Product" in chunks[0]["content"]
    assert "Widget" in chunks[0]["content"]
    assert chunks[0]["page_number"] == 2


def test_table_without_html_has_null_table_html(monkeypatch):
    """A Table chunk without text_as_html should have table_html=None."""
    table = Table(
        text="Name Age Alice 30",
        metadata=ElementMetadata(page_number=3),
    )

    _patch_elements(monkeypatch, [table])

    chunks = parser.chunk_document_multimodal("fake.pdf")

    assert len(chunks) == 1
    assert chunks[0]["element_type"] == "Table"
    assert chunks[0]["table_html"] is None
    assert "Name" in chunks[0]["content"]


# ----------------------------------------------------------------- Image
def test_image_chunk_extracts_base64_payload(monkeypatch):
    """An Image element should produce an Image chunk with base64 payload."""
    image = Image(
        text="",
        metadata=ElementMetadata(
            image_base64="iVBORw0KGgo=",
            image_mime_type="image/png",
            page_number=4,
        ),
    )

    _patch_elements(monkeypatch, [image])

    chunks = parser.chunk_document_multimodal("fake.pdf")

    assert len(chunks) == 1
    assert chunks[0]["element_type"] == "Image"
    assert chunks[0]["image_base64"] == "iVBORw0KGgo="
    assert chunks[0]["image_mime_type"] == "image/png"
    assert chunks[0]["table_html"] is None
    assert chunks[0]["page_number"] == 4
    # Content is a placeholder since the image has no text
    assert "[Image" in chunks[0]["content"]


def test_image_with_text_uses_text_as_content(monkeypatch):
    """An Image element with text should use that text as content."""
    image = Image(
        text="Figure 1: Architecture diagram",
        metadata=ElementMetadata(
            image_base64="iVBORw0KGgo=",
            image_mime_type="image/png",
            page_number=5,
        ),
    )

    _patch_elements(monkeypatch, [image])

    chunks = parser.chunk_document_multimodal("fake.pdf")

    assert len(chunks) == 1
    assert chunks[0]["element_type"] == "Image"
    assert chunks[0]["content"] == "Figure 1: Architecture diagram"
    assert chunks[0]["image_base64"] == "iVBORw0KGgo="


def test_image_without_base64_has_null_payload(monkeypatch):
    """An Image element without image_base64 should still be an Image chunk."""
    image = Image(
        text="Chart showing revenue growth",
        metadata=ElementMetadata(page_number=6),
    )

    _patch_elements(monkeypatch, [image])

    chunks = parser.chunk_document_multimodal("fake.pdf")

    assert len(chunks) == 1
    assert chunks[0]["element_type"] == "Image"
    assert chunks[0]["image_base64"] is None


# -------------------------------------------------------- Mixed document
def test_mixed_document_produces_all_chunk_types(monkeypatch):
    """A document with text, a table, and an image produces all three types."""
    title = Title(text="Report", metadata=ElementMetadata(page_number=1))
    narrative = NarrativeText(
        text="The quarterly results are shown below.",
        metadata=ElementMetadata(page_number=1),
    )
    table = Table(
        text="Q1 Q2 Q3 Q4",
        metadata=ElementMetadata(
            text_as_html="<table><tr><td>Q1</td></tr></table>",
            page_number=2,
        ),
    )
    image = Image(
        text="Revenue chart",
        metadata=ElementMetadata(
            image_base64="YmFzZTY0",
            image_mime_type="image/png",
            page_number=3,
        ),
    )

    _patch_elements(monkeypatch, [title, narrative, table, image])

    chunks = parser.chunk_document_multimodal("fake.pdf")

    types = [c["element_type"] for c in chunks]
    assert "Text" in types
    assert "Table" in types
    assert "Image" in types

    # Table chunk should have table_html
    table_chunk = next(c for c in chunks if c["element_type"] == "Table")
    assert table_chunk["table_html"] is not None

    # Image chunk should have base64
    image_chunk = next(c for c in chunks if c["element_type"] == "Image")
    assert image_chunk["image_base64"] == "YmFzZTY0"


# ---------------------------------------------------- Backward compatibility
def test_chunk_document_unchanged(monkeypatch):
    """The backward-compatible chunk_document() should still work as before."""
    html = (
        "<table>"
        "<tr><td>Product</td><td>Price</td></tr>"
        "<tr><td>Widget</td><td>10</td></tr>"
        "</table>"
    )

    table = Table(
        text="Product Price Widget 10",
        metadata=ElementMetadata(text_as_html=html, page_number=1),
    )

    _patch_elements(monkeypatch, [table])

    chunks = parser.chunk_document("fake.pdf")

    assert len(chunks) == 1
    # chunk_document folds table_html into content (original behavior)
    assert chunks[0]["content"] == html
    assert chunks[0]["page_number"] == 1
    # No extra keys
    assert "element_type" not in chunks[0]


# ---------------------------------------------------- Data-URI stripping
def test_extract_image_info_strips_data_uri_prefix():
    """_extract_image_info should strip data-URI prefixes and return raw base64."""
    metadata = {
        "image_base64": "data:image/jpeg;base64,/9j/4AAQ=",
    }
    b64, mime = parser._extract_image_info(metadata)
    assert b64 == "/9j/4AAQ="
    assert mime == "image/jpeg"


def test_extract_image_info_handles_raw_base64():
    """_extract_image_info should handle raw base64 without data-URI prefix."""
    metadata = {
        "image_base64": "iVBORw0KGgo=",
        "image_mime_type": "image/png",
    }
    b64, mime = parser._extract_image_info(metadata)
    assert b64 == "iVBORw0KGgo="
    assert mime == "image/png"


def test_extract_image_info_returns_none_for_missing_image():
    """_extract_image_info should return (None, None) when no image_base64."""
    b64, mime = parser._extract_image_info({})
    assert b64 is None
    assert mime is None
