"""
API routes for conversations.

Endpoints:
  GET    /projects/{project_id}/conversations        — list conversations in a project
  POST   /projects/{project_id}/conversations        — create a conversation
  PATCH  /conversations/{id}                         — rename a conversation
  DELETE /conversations/{id}                         — delete conversation + messages
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.database.supabase import supabase

router = APIRouter(tags=["conversations"])


# ─── Pydantic models ──────────────────────────────────────────────────────

class CreateConversationRequest(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=200)

class RenameConversationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)


# ─── Routes ───────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/conversations")
def list_conversations(project_id: UUID):
    """Return all conversations for a project, newest first."""
    # Verify the project exists first.
    proj = (
        supabase.table("projects")
        .select("id")
        .eq("id", str(project_id))
        .execute()
    )
    if not proj.data:
        raise HTTPException(status_code=404, detail="Project not found")

    result = (
        supabase.table("conversations")
        .select("id, project_id, title, created_at, updated_at")
        .eq("project_id", str(project_id))
        .order("created_at", desc=True)
        .execute()
    )
    return {"conversations": result.data}


@router.post("/projects/{project_id}/conversations", status_code=201)
def create_conversation(project_id: UUID, body: CreateConversationRequest):
    """Create a new conversation inside a project."""
    proj = (
        supabase.table("projects")
        .select("id")
        .eq("id", str(project_id))
        .execute()
    )
    if not proj.data:
        raise HTTPException(status_code=404, detail="Project not found")

    result = (
        supabase.table("conversations")
        .insert({"project_id": str(project_id), "title": body.title})
        .execute()
    )
    return {"conversation": result.data[0]}


@router.patch("/conversations/{conversation_id}")
def rename_conversation(conversation_id: UUID, body: RenameConversationRequest):
    """Rename a conversation."""
    result = (
        supabase.table("conversations")
        .update({"title": body.title})
        .eq("id", str(conversation_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {"conversation": result.data[0]}


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: UUID):
    """
    Delete a conversation.
    Messages cascade-delete automatically (ON DELETE CASCADE).
    """
    result = (
        supabase.table("conversations")
        .select("id")
        .eq("id", str(conversation_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Conversation not found")

    supabase.table("conversations").delete().eq("id", str(conversation_id)).execute()
    return {"message": "Conversation deleted", "conversation_id": str(conversation_id)}
