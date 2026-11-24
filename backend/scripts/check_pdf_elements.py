"""
Checks what the RAG multimodal parser actually extracts from the PDF
and compares to what's physically in the PDF (via PyMuPDF).
"""
import os
import sys

# Set env before importing
os.environ['PDF_HI_RES_ENABLED'] = 'true'
os.environ['TESSERACT_CMD'] = r'D:\shubham\rag-project\Tesseract-OCR\tesseract.exe'

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

pdf_path = r'd:\shubham\NIPS-2017-attention-is-all-you-need-Paper.pdf'

# ── 1. PyMuPDF ground truth ───────────────────────────────────────────────
print("=" * 60)
print("GROUND TRUTH  (PyMuPDF)")
print("=" * 60)

import pymupdf
doc = pymupdf.open(pdf_path)
print(f"Total pages : {len(doc)}")

pdf_images = []
pdf_tables = []

for i, page in enumerate(doc, 1):
    for img in page.get_images(full=True):
        xref = img[0]
        base_img = doc.extract_image(xref)
        pdf_images.append({
            "page": i,
            "width": base_img["width"],
            "height": base_img["height"],
            "ext": base_img["ext"],
        })
    try:
        tabs = page.find_tables()
        for t in tabs.tables:
            pdf_tables.append({"page": i, "rows": t.row_count, "cols": t.col_count})
    except Exception:
        pass

print(f"\nImages found by PyMuPDF : {len(pdf_images)}")
for img in pdf_images:
    print(f"  Page {img['page']} | {img['width']}x{img['height']} px | .{img['ext']}")

print(f"\nTables found by PyMuPDF : {len(pdf_tables)}")
for t in pdf_tables:
    print(f"  Page {t['page']} | {t['rows']} rows x {t['cols']} cols")

# ── 2. RAG multimodal parser ──────────────────────────────────────────────
print()
print("=" * 60)
print("RAG MULTIMODAL PARSER  (chunk_document_multimodal, hi_res)")
print("=" * 60)

from app.services.unstructured_parser import chunk_document_multimodal

print("Parsing PDF (this may take a minute)...")
chunks = chunk_document_multimodal(pdf_path)

text_chunks  = [c for c in chunks if c["element_type"] == "Text"]
table_chunks = [c for c in chunks if c["element_type"] == "Table"]
image_chunks = [c for c in chunks if c["element_type"] == "Image"]

print(f"\nTotal chunks : {len(chunks)}")
print(f"  Text       : {len(text_chunks)}")
print(f"  Table      : {len(table_chunks)}")
print(f"  Image      : {len(image_chunks)}")

print(f"\nTable chunks detail:")
for i, c in enumerate(table_chunks, 1):
    has_html = bool(c.get("table_html"))
    print(f"  [{i}] page={c['page_number']} | has_html={has_html} | preview: {c['content'][:100]}")

print(f"\nImage chunks detail:")
for i, c in enumerate(image_chunks, 1):
    has_b64 = bool(c.get("image_base64"))
    print(f"  [{i}] page={c['page_number']} | has_base64={has_b64} | mime={c.get('image_mime_type')} | content: {c['content'][:80]}")

# ── 3. Diff summary ───────────────────────────────────────────────────────
print()
print("=" * 60)
print("DIFFERENCE SUMMARY")
print("=" * 60)
print(f"Images  — PDF has: {len(pdf_images)}  |  RAG fetched: {len(image_chunks)}  |  Missed: {len(pdf_images) - len(image_chunks)}")
print(f"Tables  — PDF has: {len(pdf_tables)}   |  RAG fetched: {len(table_chunks)}  |  Missed: {len(pdf_tables) - len(table_chunks)}")

# Supabase stored element_counts for reference
print()
print("Supabase DB stored  →  Image: 3 | Table: 2 | Text: 37")
print(f"PyMuPDF ground truth →  Image: {len(pdf_images)} | Table: {len(pdf_tables)}")
print(f"RAG parser (this run) → Image: {len(image_chunks)} | Table: {len(table_chunks)}")
