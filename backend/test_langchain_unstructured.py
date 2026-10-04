from langchain_community.document_loaders import UnstructuredPDFLoader


file_path = r"D:\shubham\kody.pdf"

print("Starting loader...")

loader = UnstructuredPDFLoader(
    file_path,
    strategy="fast"
)

documents = loader.load()

print("Number of documents:", len(documents))

for i, document in enumerate(documents[:10], start=1):
    print(f"\n--- Document {i} ---")
    print("Content:", document.page_content[:300])
    print("Metadata:", document.metadata)