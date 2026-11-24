"""
Database client — Supabase.

Creates a single shared `supabase` client from environment variables.
Import this module anywhere database access is needed:

    from app.database.supabase import supabase

Required env vars (set in backend/.env):
    SUPABASE_URL  — the project URL from your Supabase dashboard
    SUPABASE_KEY  — the service-role key (never the anon key)
"""

import os

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL:
    raise ValueError("SUPABASE_URL is missing from .env")

if not SUPABASE_KEY:
    raise ValueError("SUPABASE_KEY is missing from .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
