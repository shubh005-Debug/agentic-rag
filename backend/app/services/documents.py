
import pymupdf


def extract_pages_from_pdf(file_path: str) -> str:
    document = pymupdf.open(file_path)

    pages=[]

    for page_number,page in enumerate(document,start=1):
        text=page.get_text()

        if text.strip():
            pages.append({
                "page_number":page_number,
                "text":text
            })
    document.close()

    return pages        

   