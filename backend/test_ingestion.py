from app.tasks.ingestion_tasks import process_document


document_id = "2eab183f-2e10-4c03-bda8-1790b67f04a4"

file_path = r"D:\shubham\kody1.pdf"

result = process_document.delay(
    document_id,
    file_path
)

print("Task ID:", result.id)
print("Result:", result.get(timeout=120))