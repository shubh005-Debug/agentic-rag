from app.services.embeddings import generate_embeddings

texts = [
    "What is Cubexo?",
    "What are the eligibility requirements?",
    "What is the internship duration?"
]

embeddings = generate_embeddings(texts)

print("Number of embeddings:", len(embeddings))
print("Embedding dimensions:", len(embeddings[0]))