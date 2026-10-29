"""Unstructured document parsing with multimodal element preservation.

Provides two entry points:

* ``chunk_document`` – backward-compatible: returns ``{"content", "page_number"}``
  with table HTML folded into *content* (same behaviour as before).

* ``chunk_document_multimodal`` – extended: also returns ``element_type``,
  ``table_html`` (kept separate from *content*), and image payloads
  (``image_base64``, ``image_mime_type``) when hi_res PDF extraction is enabled.
"""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

from unstructured.chunking.title import chunk_by_title

from unstructured.partition.pdf import partition_pdf
from unstructured.partition.docx import partition_docx
from unstructured.partition.pptx import partition_pptx
from unstructured.partition.text import partition_text
from unstructured.partition.csv import partition_csv
from unstructured.partition.xlsx import partition_xlsx
from unstructured.partition.html import partition_html

load_dotenv()

# ---------------------------------------------------------------------------
# Tesseract OCR path configuration
#
# The Tesseract binary is needed only when PDF_HI_RES_ENABLED=true.
# Priority:
#   1. TESSERACT_CMD env var  — explicit path, works on any OS / layout.
#   2. System PATH            — standard install (Linux/macOS homebrew, etc.)
#   3. Windows default paths  — common Windows installer locations, tried in
#                               order so a missing binary produces a clear
#                               warning rather than a cryptic OSError later.
#
# The path is set on the unstructured_pytesseract shim (which Unstructured
# uses internally).  Standard pytesseract is NOT required.
# ---------------------------------------------------------------------------

_WINDOWS_TESSERACT_FALLBACKS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
]

logger = logging.getLogger(__name__)


def _configure_tesseract(
    *,
    tess_module=None,
    which_fn=None,
    path_exists_fn=None,
) -> None:
    """Point unstructured_pytesseract at the Tesseract binary.

    Called once at module import.  Safe to call when hi_res is disabled —
    the binary is never invoked, only the path variable is set.

    Parameters (injectable for testing):
        tess_module:   the pytesseract object (attribute: pytesseract_command).
                       Defaults to importing from unstructured_pytesseract.
        which_fn:      callable(name) -> path|None.  Defaults to shutil.which.
        path_exists_fn: callable(path_str) -> bool.  Defaults to Path.is_file.
    """
    if tess_module is None:
        try:
            from unstructured_pytesseract import pytesseract as tess_module
        except ImportError:
            logger.debug("unstructured_pytesseract not installed; hi_res OCR unavailable")
            return

    if which_fn is None:
        import shutil
        which_fn = shutil.which

    if path_exists_fn is None:
        path_exists_fn = lambda p: Path(p).is_file()

    explicit = os.getenv("TESSERACT_CMD", "").strip()
    if explicit:
        tess_module.pytesseract_command = explicit
        logger.debug("Tesseract path set from TESSERACT_CMD: %s", explicit)
        return

    if which_fn("tesseract"):
        logger.debug("Tesseract found on PATH")
        return

    for candidate in _WINDOWS_TESSERACT_FALLBACKS:
        if path_exists_fn(candidate):
            tess_module.pytesseract_command = candidate
            logger.debug("Tesseract found at Windows default path: %s", candidate)
            return

    logger.warning(
        "Tesseract OCR binary not found. "
        "hi_res PDF extraction (PDF_HI_RES_ENABLED=true) will fail. "
        "Set TESSERACT_CMD in .env or add Tesseract to your PATH."
    )


SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".docx",
    ".pptx",
    ".txt",
    ".csv",
    ".xlsx",
    ".html",
    ".htm",
}

# Element categories that count as "Image" for multimodal chunking.
_IMAGE_CATEGORIES = {"Image"}

# Configure Tesseract at import time so hi_res extraction works immediately
# when PDF_HI_RES_ENABLED=true.  Safe to call even when hi_res is disabled.
_configure_tesseract()


def pdf_hi_res_enabled() -> bool:
    """Whether hi_res PDF extraction (tables + images) is enabled.

    Defaults to *false*.  The hi_res stack (torch, unstructured_inference,
    pytesseract) must be installed; it is present in the project venv but
    deliberately excluded from ``requirements.txt`` as a baseline dependency.
    """
    return os.getenv("PDF_HI_RES_ENABLED", "false").strip().lower() in (
        "1", "true", "yes", "on",
    )


def extract_elements(file_path: str, hi_res: bool = False):
    """Extract raw Unstructured elements from supported document formats.

    When *hi_res* is True and the file is a PDF, runs the hi_res strategy
    with table-structure inference and image extraction (base64 payload).
    """
    path = Path(file_path)
    extension = path.suffix.lower()

    if not path.is_file():
        raise FileNotFoundError(f"Document not found: {path}")

    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported document format: {extension}. "
            f"Supported formats: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )

    if extension == ".pdf":
        if hi_res:
            logger.info("Using hi_res PDF strategy with image extraction")
            return partition_pdf(
                filename=str(path),
                strategy="hi_res",
                infer_table_structure=True,
                extract_images_in_pdf=True,
                extract_image_block_types=["Image", "Table"],
                extract_image_block_to_payload=True,
            )
        return partition_pdf(
            filename=str(path),
            strategy="fast",
        )

    if extension == ".docx":
        return partition_docx(filename=str(path))

    if extension == ".pptx":
        return partition_pptx(filename=str(path))

    if extension == ".txt":
        return partition_text(filename=str(path))

    if extension == ".csv":
        return partition_csv(filename=str(path))

    if extension == ".xlsx":
        return partition_xlsx(filename=str(path))

    if extension in {".html", ".htm"}:
        return partition_html(filename=str(path))

    raise ValueError(f"Unsupported document format: {extension}")


def extract_elements_from_pdf(file_path: str):
    """Preserve the existing PDF-only API."""
    elements = partition_pdf(
        filename=file_path,
        strategy="fast",
    )

    return [
        {
            "type": element.category,
            "text": str(element),
            "metadata": element.metadata.to_dict(),
        }
        for element in elements
    ]


# --------------------------------------------------------------------------- #
#  Multimodal helpers
# --------------------------------------------------------------------------- #

def _element_type_from_category(category: str) -> str:
    """Map an Unstructured chunk/element category to a simple type label."""
    if category == "Table":
        return "Table"
    if category in _IMAGE_CATEGORIES:
        return "Image"
    return "Text"


def _extract_image_info(metadata: dict) -> tuple[str | None, str | None]:
    """Extract base64 image data and MIME type from element metadata.

    Returns ``(base64_string, mime_type)`` or ``(None, None)``.
    The base64 string is raw (no data-URI prefix) so it can be decoded
    directly to bytes for storage upload.
    """
    image_base64 = metadata.get("image_base64")

    if not image_base64:
        return None, None

    # Unstructured may include a data-URI prefix ("data:image/png;base64,...");
    # strip it so the caller gets raw base64 that can be b64decoded directly.
    if image_base64.startswith("data:"):
        header, _, data = image_base64.partition(",")
        mime = "image/png"
        if ":" in header:
            mime_part = header.split(";")[0].split(":", 1)[1]
            if mime_part.startswith("image/"):
                mime = mime_part
        return data or None, mime

    mime = (
        metadata.get("image_mime_type")
        or metadata.get("image_type")
        or "image/png"
    )
    return image_base64, mime


# --------------------------------------------------------------------------- #
#  Backward-compatible entry point (unchanged contract)
# --------------------------------------------------------------------------- #

def chunk_document(file_path: str) -> list[dict]:
    """Extract and structure-aware chunk a supported document.

    Returns ``[{"content": str, "page_number": int | None}, ...]``.
    Table HTML is folded into *content* (preserving the original behaviour).
    """
    elements = extract_elements(file_path)

    if not elements:
        return []

    chunks = chunk_by_title(
        elements,
        max_characters=1500,
        new_after_n_chars=1200,
        combine_text_under_n_chars=300,
    )

    results = []

    for chunk in chunks:
        metadata = chunk.metadata.to_dict() if chunk.metadata else {}

        # Preserve table structure: standalone Table chunks carry text_as_html
        # in their metadata. Use it when available so row/column structure
        # survives into the embedded content; otherwise fall back to the
        # plain-text flattening produced by str(chunk).
        table_html = metadata.get("text_as_html")
        content = (
            table_html.strip()
            if table_html and table_html.strip()
            else str(chunk).strip()
        )

        if not content:
            continue

        results.append({
            "content": content,
            "page_number": metadata.get("page_number"),
        })

    return results


# --------------------------------------------------------------------------- #
#  Multimodal entry point (extended contract)
# --------------------------------------------------------------------------- #

def chunk_document_multimodal(file_path: str) -> list[dict]:
    """Extract and chunk a document, preserving element types, table HTML
    (separate from *content*), and image payloads.

    Returns a list of dicts, each guaranteed to have ``content`` and
    ``page_number`` (backward-compatible keys) plus the multimodal keys::

        {
            "content":          str,            # text representation (embedded)
            "page_number":      int | None,
            "element_type":      str,            # "Text" | "Table" | "Image"
            "table_html":        str | None,     # HTML for frontend rendering
            "image_base64":      str | None,     # raw base64 (transient, not stored in DB)
            "image_mime_type":   str | None,
        }

    *content* is always the plain-text representation (``str(chunk)``) so the
    embedding model and keyword search work on text, not HTML tags.
    *table_html* stores the HTML separately for the frontend.
    *image_base64* is transient: ingestion uploads it to Supabase Storage
    and stores only the path reference.
    """
    path = Path(file_path)
    extension = path.suffix.lower()
    use_hi_res = extension == ".pdf" and pdf_hi_res_enabled()

    elements = extract_elements(file_path, hi_res=use_hi_res)

    if not elements:
        return []

    # Separate image elements for dedicated handling (chunk_by_title does not
    # reliably create standalone Image chunks).
    image_elements = [
        e for e in elements
        if getattr(e, "category", "") in _IMAGE_CATEGORIES
    ]
    text_elements = [
        e for e in elements
        if getattr(e, "category", "") not in _IMAGE_CATEGORIES
    ]

    # Chunk text / table elements with the title-based strategy.
    chunks = (
        chunk_by_title(
            text_elements,
            max_characters=1500,
            new_after_n_chars=1200,
            combine_text_under_n_chars=300,
        )
        if text_elements
        else []
    )

    results = []

    for chunk in chunks:
        metadata = chunk.metadata.to_dict() if chunk.metadata else {}
        category = getattr(chunk, "category", "") or ""
        element_type = _element_type_from_category(category)

        # Table HTML kept separately from content.
        table_html = metadata.get("text_as_html")
        if table_html:
            table_html = table_html.strip() if table_html.strip() else None
        else:
            table_html = None

        # Content is always the text representation (for embedding / search).
        content = str(chunk).strip()

        if not content and table_html:
            # Extremely rare: a table with no text representation but valid HTML.
            import re
            content = re.sub(r"<[^>]+>", " ", table_html).strip()

        if not content:
            continue

        results.append({
            "content": content,
            "page_number": metadata.get("page_number"),
            "element_type": element_type,
            "table_html": table_html if element_type == "Table" else None,
            "image_base64": None,
            "image_mime_type": None,
        })

    # Create standalone image chunks from raw Image elements.
    for element in image_elements:
        metadata = element.metadata.to_dict() if element.metadata else {}
        image_base64, image_mime = _extract_image_info(metadata)

        text_content = str(element).strip()
        page = metadata.get("page_number", "?")

        content = text_content or f"[Image on page {page}]"

        results.append({
            "content": content,
            "page_number": metadata.get("page_number"),
            "element_type": "Image",
            "table_html": None,
            "image_base64": image_base64,
            "image_mime_type": image_mime,
        })

    return results
