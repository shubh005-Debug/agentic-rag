

"""
Standalone parser diagnostic.

Run from the backend folder (venv active):

    python -m scripts.debug_parser [--hi-res] [--pdf PATH]

Prints:
  - Which strategy is active and whether Tesseract is reachable
  - Raw element category counts (fast vs hi_res)
  - First example of every non-text category (Table, Image, Figure, etc.)
  - chunk_document_multimodal() output summary
  - Any exception / fallback that fires during chunking
"""

import argparse
import collections
import logging
import os
import sys
import traceback

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)

DEFAULT_PDF = r"D:\shubham\rag-project\backend\uploads\attention_debug.pdf"


def _check_tesseract():
    import subprocess
    tess_cmd = os.getenv("TESSERACT_CMD", "tesseract")
    try:
        r = subprocess.run(
            [tess_cmd, "--version"],
            capture_output=True, text=True, timeout=5,
        )
        first_line = (r.stdout or r.stderr or "").splitlines()[0]
        print(f"  Tesseract OK: {first_line}  (cmd={tess_cmd!r})")
        return True
    except Exception as exc:
        print(f"  Tesseract FAILED: {exc}  (cmd={tess_cmd!r})")
        return False


def _element_summary(elements, label):
    print(f"\n{'='*60}")
    print(f"  {label}  ({len(elements)} elements)")
    print("="*60)

    counts = collections.Counter(
        getattr(e, "category", type(e).__name__) for e in elements
    )
    for cat, n in sorted(counts.items()):
        print(f"  {cat:35s}  {n:4d}")

    # Print first example of every interesting category
    SKIP = {"NarrativeText", "Title", "UncategorizedText", "ListItem", "Text"}
    seen = set()
    for e in elements:
        cat = getattr(e, "category", type(e).__name__)
        if cat in SKIP or cat in seen:
            continue
        seen.add(cat)
        meta = e.metadata.to_dict() if e.metadata else {}
        b64 = meta.get("image_base64") or ""
        b64_info = f"  image_base64={b64[:30]!r}..." if b64 else "  image_base64=None"
        print(f"\n  >>> First [{cat}] example")
        print(f"      page={meta.get('page_number')}")
        print(f"      text={str(e)[:120]!r}")
        print(f"      text_as_html={str(meta.get('text_as_html',''))[:120]!r}")
        print(b64_info)


def _chunk_summary(chunks, label):
    print(f"\n{'='*60}")
    print(f"  {label} chunks ({len(chunks)} total)")
    print("="*60)

    counts = collections.Counter(c.get("element_type", "?") for c in chunks)
    for et, n in sorted(counts.items()):
        print(f"  {et:20s}  {n:4d}")

    has_table_html = sum(1 for c in chunks if c.get("table_html"))
    has_image_b64  = sum(1 for c in chunks if c.get("image_base64"))
    print(f"\n  chunks with table_html   : {has_table_html}")
    print(f"  chunks with image_base64 : {has_image_b64}")

    # First Table and Image chunk details
    for et in ("Table", "Image"):
        ex = next((c for c in chunks if c.get("element_type") == et), None)
        if ex:
            print(f"\n  >>> First {et} chunk")
            print(f"      page_number : {ex.get('page_number')}")
            print(f"      content     : {ex.get('content','')[:120]!r}")
            if et == "Table":
                html = ex.get("table_html") or ""
                print(f"      table_html  : {html[:200]!r}")
            if et == "Image":
                b64 = ex.get("image_base64") or ""
                print(f"      image_base64: {b64[:40]!r}...")
                print(f"      image_mime  : {ex.get('image_mime_type')}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hi-res", action="store_true",
                        help="Force hi_res strategy (overrides PDF_HI_RES_ENABLED)")
    parser.add_argument("--fast", action="store_true",
                        help="Force fast strategy")
    parser.add_argument("--pdf", default=DEFAULT_PDF)
    args = parser.parse_args()

    # Apply overrides before importing the module
    if args.hi_res:
        os.environ["PDF_HI_RES_ENABLED"] = "true"
    if args.fast:
        os.environ["PDF_HI_RES_ENABLED"] = "false"

    from app.services.unstructured_parser import (
        extract_elements,
        chunk_document_multimodal,
        pdf_hi_res_enabled,
    )

    print("\n" + "="*60)
    print("  CONFIGURATION")
    print("="*60)
    print(f"  PDF_HI_RES_ENABLED env : {os.getenv('PDF_HI_RES_ENABLED','(unset)')!r}")
    print(f"  pdf_hi_res_enabled()   : {pdf_hi_res_enabled()}")
    print(f"  TESSERACT_CMD          : {os.getenv('TESSERACT_CMD','(unset)')!r}")
    _check_tesseract()
    print(f"  PDF file               : {args.pdf}")

    use_hi_res = pdf_hi_res_enabled()

    # ---- Step 1: raw elements ----
    print(f"\n  Calling extract_elements(hi_res={use_hi_res}) ...")
    try:
        elements = extract_elements(args.pdf, hi_res=use_hi_res)
        _element_summary(elements, f"extract_elements(hi_res={use_hi_res})")
    except Exception:
        print("\n  extract_elements RAISED:")
        traceback.print_exc()
        sys.exit(1)

    # ---- Step 2: chunk_document_multimodal ----
    print(f"\n  Calling chunk_document_multimodal() ...")
    try:
        chunks = chunk_document_multimodal(args.pdf)
        _chunk_summary(chunks, "chunk_document_multimodal()")
    except Exception:
        print("\n  chunk_document_multimodal RAISED:")
        traceback.print_exc()


if __name__ == "__main__":
    main()
