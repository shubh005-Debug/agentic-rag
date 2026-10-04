from langchain_text_splitters import RecursiveCharacterTextSplitter


def split_pages(pages: list):

    splitter = RecursiveCharacterTextSplitter(
        separators=["\n\n", "\n", ". ", " ", ""],
        chunk_size=1000,
        chunk_overlap=100
    )

    chunks = []

    for page in pages:

        page_chunks = splitter.split_text(
            page["text"]
        )

        for chunk in page_chunks:

            chunks.append({
                "content": chunk,
                "page_number": page["page_number"]
            })

    return chunks