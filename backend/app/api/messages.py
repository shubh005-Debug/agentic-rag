"""
API routes for messages.

Endpoints:
  GET   /conversations/{id}/messages   — load message history
  POST  /conversations/{id}/messages   — save a new message (user or assistant)
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database.supabase import supabase

router = APIRouter(tags=["messages"])


# ─── Pydantic models ──────────────────────────────────────────────────────

class SaveMessageRequest(BaseModel):
    role: str                       # "user" or "assistant"
    content: str
    sources: list | None = None     # only set on assistant messages


# ─── Routes ───────────────────────────────────────────────────────────────

@router.get("/conversations/{conversation_id}/messages")
def list_messages(conversation_id: UUID):
    """Return all messages in a conversation, oldest first."""
    conv = (
        supabase.table("conversations")
        .select("id")
        .eq("id", str(conversation_id))
        .execute()
    )
    if not conv.data:
        raise HTTPException(status_code=404, detail="Conversation not found")

    result = (
        supabase.table("messages")
        .select("id, conversation_id, role, content, sources, created_at")
        .eq("conversation_id", str(conversation_id))
        .order("created_at")
        .execute()
    )
    return {"messages": result.data}


@router.post("/conversations/{conversation_id}/messages", status_code=201)
def save_message(conversation_id: UUID, body: SaveMessageRequest):
    """
    Save a message to the database.

    Call this twice per exchange:
      1. After the user submits their question (role='user')
      2. After the backend returns its answer (role='assistant', include sources)
    """
    if body.role not in ("user", "assistant"):
        raise HTTPException(status_code=400, detail="role must be 'user' or 'assistant'")

    conv = (
        supabase.table("conversations")
        .select("id")
        .eq("id", str(conversation_id))
        .execute()
    )
    if not conv.data:
        raise HTTPException(status_code=404, detail="Conversation not found")

    result = (
        supabase.table("messages")
        .insert({
            "conversation_id": str(conversation_id),
            "role": body.role,
            "content": body.content,
            "sources": body.sources,
        })
        .execute()
    )

    # Bump the conversation's updated_at so the list stays sorted by activity.
    supabase.table("conversations").update(
        {"updated_at": "now()"}
    ).eq("id", str(conversation_id)).execute()

    return {"message": result.data[0]}
