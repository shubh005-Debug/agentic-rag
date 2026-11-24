"""
LLM answer generation — Groq.

Uses the Groq API to generate a final answer from retrieved context chunks.
The model is instructed to answer only from the provided context and to say
so explicitly when the answer is not there.

Required env var:
    GROQ_API_KEY

Public function:
    generate_answer(question, context) -> str
"""

import os

from dotenv import load_dotenv
from groq import Groq

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY is missing from .env")

# LLM used for answering questions.
# Change this if you want to use a different model.
ANSWER_MODEL = "openai/gpt-oss-20b"

client = Groq(api_key=GROQ_API_KEY)


def generate_answer(question: str, context: str) -> str:
    """
    Call the LLM with the question and the retrieved context.

    The model is told to answer ONLY from the context.
    If the answer is not in the context it returns the standard
    "could not find" phrase, which rag.py detects to hide sources.
    """
    prompt = f"""You are a helpful RAG assistant.

Answer the question using ONLY the provided context.

If the answer is not present in the context, say exactly:
"I could not find this information in the uploaded documents."

Context:
{context}

Question:
{question}

Answer:"""

    response = client.chat.completions.create(
        model=ANSWER_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )

    return response.choices[0].message.content
