import os
from dotenv import load_dotenv
from huggingface_hub import InferenceClient

load_dotenv()

HF_TOKEN = os.getenv("HF_TOKEN")

if not HF_TOKEN:
    raise ValueError("HF_TOKEN is missing")

client = InferenceClient(
    api_key=HF_TOKEN
)

MODEL_NAME = "BAAI/bge-small-en-v1.5"


def generate_embedding(text: str):

    embedding = client.feature_extraction(
        text,
        model=MODEL_NAME
    )

    return embedding.tolist()


def generate_embeddings(
    texts: list[str],
    batch_size: int = 20
):
    all_embeddings = []

    for i in range(0, len(texts), batch_size):

        batch = texts[i:i + batch_size]

        embeddings = client.feature_extraction(
            batch,
            model=MODEL_NAME
        )

        all_embeddings.extend(embeddings.tolist())

    return all_embeddings