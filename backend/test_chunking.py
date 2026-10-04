from app.services.documents import extract_pages_from_pdf
from app.services.chunking import split_pages


pdf_path = r"C:\Users\Lenovo\Downloads\CUBEXO campus drice for B.Tech 27 batch.pdf"

pages = extract_pages_from_pdf(pdf_path)

chunks = split_pages(pages)

for i, chunk in enumerate(chunks):

    print(f"\n--- Chunk {i} ---")
    print("Page:", chunk["page_number"])
    print(chunk["content"])