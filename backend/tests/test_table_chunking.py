"""Focused tests for Stage 1: table-structure preservation in chunk_document().

These tests patch extract_elements() so no real file is needed. They verify
that chunk_document() preserves metadata.text_as_html for Table chunks and
falls back to the plain-text representation when it is absent.
"""

from unstructured.documents.elements import (
    ElementMetadata,
    NarrativeText,
    Table,
    Title,
)

import app.services.unstructured_parser as parser


def _patch_elements(monkeypatch, elements):
    """Make extract_elements return the given elements regardless of path."""
    monkeypatch.setattr(parser, "extract_elements", lambda file_path: elements)


# ---------------------------------------------------------------- test 1
def test_table_with_html_metadata_preserves_html(monkeypatch):
    """A multi-row, multi-column Table chunk should use text_as_html as content."""
    # Use <td> throughout: Unstructured re-serializes text_as_html during
    # chunking (e.g. <th> -> <td>), and real table extraction emits <td>.
    html = (
        "<table>"
        "<tr><td>Product</td><td>Price</td><td>Stock</td></tr>"
        "<tr><td>Widget</td><td>10</td><td>200</td></tr>"
        "<tr><td>Gadget</td><td>25</td><td>75</td></tr>"
        "<tr><td>Gizmo</td><td>8</td><td>500</td></tr>"
        "</table>"
    )

    table = Table(
        text="Product Price Stock Widget 10 200 Gadget 25 75 Gizmo 8 500",
        metadata=ElementMetadata(text_as_html=html, page_number=1),
    )

    _patch_elements(monkeypatch, [table])

    chunks = parser.chunk_document("fake.pdf")

    assert len(chunks) == 1
    assert chunks[0]["content"] == html
    assert chunks[0]["page_number"] == 1


# ---------------------------------------------------------------- test 2
def test_non_table_text_chunk_uses_plain_text(monkeypatch):
    """A CompositeElement (title + narrative) should use str(chunk), not HTML."""
    title = Title(text="Quarterly Report", metadata=ElementMetadata(page_number=2))
    narrative = NarrativeText(
        text="Revenue grew 15 percent this quarter driven by strong widget sales.",
        metadata=ElementMetadata(page_number=2),
    )

    _patch_elements(monkeypatch, [title, narrative])

    chunks = parser.chunk_document("fake.pdf")

    assert len(chunks) == 1

    # Content must be plain text, containing the heading and the narrative.
    content = chunks[0]["content"]
    assert "Quarterly Report" in content
    assert "Revenue grew" in content
    # Must NOT be HTML-wrapped.
    assert "<table>" not in content
    assert "<td>" not in content

    assert chunks[0]["page_number"] == 2


# ---------------------------------------------------------------- test 3
def test_table_without_html_metadata_falls_back_to_plain_text(monkeypatch):
    """A Table chunk with no text_as_html should fall back to str(chunk)."""
    table = Table(
        text="Name Age City Alice 30 NYC Bob 25 LA",
        metadata=ElementMetadata(page_number=3),
    )

    _patch_elements(monkeypatch, [table])

    chunks = parser.chunk_document("fake.pdf")

    assert len(chunks) == 1

    # No text_as_html -> content is the plain-text flattening, not HTML.
    content = chunks[0]["content"]
    assert "Name Age City" in content
    assert "<table>" not in content

    assert chunks[0]["page_number"] == 3
