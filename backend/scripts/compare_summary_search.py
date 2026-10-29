"""
Compare retrieval WITH and WITHOUT chunk-summary search, on your own questions.

Run from the backend folder (venv active):

    python -m scripts.compare_summary_search "What accuracy does LungAI achieve?" "List all projects"
    python -m scripts.compare_summary_search --doc <document_id> "question"
    python -m scripts.compare_summary_search --full "question"      # also runs rerank + LLM

Default mode only runs retrieval (Hugging Face + Supabase): no Cohere or Groq calls.
Chunk text is never printed, only chunk numbers and scores.
"""

import argparse
import contextlib
import io
import time

from app.services.rag import ask_rag, retrieve_candidates


def _indexes(chunks):
    return [c["chunk_index"] for c in chunks]


def _quiet(func, *args, **kwargs):
    # retrieve_candidates prints a similarity table; keep this output readable
    with contextlib.redirect_stdout(io.StringIO()):
        return func(*args, **kwargs)


def compare_retrieval(question, document_id):
    base = _quiet(retrieve_candidates, question, document_id, False)
    plus = _quiet(retrieve_candidates, question, document_id, True)

    base_idx, plus_idx = _indexes(base), _indexes(plus)
    added = [i for i in plus_idx if i not in base_idx]
    dropped = [i for i in base_idx if i not in plus_idx]

    print(f"\nQ: {question}")
    print(f"   without summaries (top 10 chunk numbers): {base_idx}")
    print(f"   with summaries    (top 10 chunk numbers): {plus_idx}")
    print(f"   newly in top 10: {added or '-'}   |   pushed out: {dropped or '-'}   |   "
          f"top-5 order {'CHANGED' if base_idx[:5] != plus_idx[:5] else 'same'}")


def compare_full(question, document_id, pause):
    print(f"   full pipeline:")
    for label, flag in (("without", False), ("with   ", True)):
        result = _quiet(ask_rag, question, document_id, flag)
        scores = [(s["chunk_index"], round(s["rerank_score"], 2)) for s in result["sources"]]
        print(f"     {label} summaries -> sources (chunk, rerank): {scores or '-'}")
        print(f"                         answer: {result['answer'][:110].replace(chr(10), ' ')}")
        time.sleep(pause)     # stay under trial-key rate limits of the reranker


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("questions", nargs="+")
    parser.add_argument("--doc", default=None, help="limit to one document id")
    parser.add_argument("--full", action="store_true", help="also run rerank + answer generation")
    parser.add_argument("--pause", type=float, default=7.0, help="seconds between full runs")
    args = parser.parse_args(argv)

    for question in args.questions:
        compare_retrieval(question, args.doc)
        if args.full:
            compare_full(question, args.doc, args.pause)


if __name__ == "__main__":
    main()