"""
API routes for projects.

Endpoints:
  GET    /projects              — list all projects (newest first)
  POST   /projects              — create a project
  PATCH  /projects/{id}         — rename / update description
  DELETE /projects/{id}         — delete project + all its conversations + messages
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.database.supabase import supabase

router = APIRouter(prefix="/projects", tags=["projects"])


# ─── Pydantic models ──────────────────────────────────────────────────────

class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)

class UpdateProjectRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)


# ─── Routes ───────────────────────────────────────────────────────────────

@router.get("")
def list_projects():
    """Return all projects ordered newest first."""
    result = (
        supabase.table("projects")
        .select("id, name, description, created_at, updated_at")
        .order("created_at", desc=True)
        .execute()
    )
    return {"projects": result.data}


@router.post("", status_code=201)
def create_project(body: CreateProjectRequest):
    """Create a new project."""
    result = (
        supabase.table("projects")
        .insert({"name": body.name, "description": body.description})
        .execute()
    )
    return {"project": result.data[0]}


@router.patch("/{project_id}")
def update_project(project_id: UUID, body: UpdateProjectRequest):
    """Rename a project or update its description."""
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.description is not None:
        updates["description"] = body.description

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    result = (
        supabase.table("projects")
        .update(updates)
        .eq("id", str(project_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    return {"project": result.data[0]}


@router.delete("/{project_id}")
def delete_project(project_id: UUID):
    """
    Delete a project.
    Conversations and messages cascade-delete automatically (ON DELETE CASCADE).
    """
    result = (
        supabase.table("projects")
        .select("id")
        .eq("id", str(project_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    supabase.table("projects").delete().eq("id", str(project_id)).execute()
    return {"message": "Project deleted", "project_id": str(project_id)}
