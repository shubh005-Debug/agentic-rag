from langchain_community.embeddings import FastEmbedEmbeddings

embeddings = FastEmbedEmbeddings(
    model_name="BAAI/bge-small-en-v1.5"
)

# Document embeddings
document_vectors = embeddings.embed_documents([
    "LungAI achieves 92% accuracy.",
    "The project uses FastAPI and Supabase."
])

# User query embedding
query_vector = embeddings.embed_query(
    "What accuracy does LungAI achieve?"
)

print("Document dimensions:", len(document_vectors[0]))
print("Query dimensions:", len(query_vector))