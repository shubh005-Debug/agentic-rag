"""
Celery application configuration.

The API process creates tasks; the worker process runs them.
Both import this module to get the same `celery_app` instance.

Required env var:
    REDIS_URL — broker + result backend (default: redis://localhost:6379/0)

Task modules registered here so Celery can discover them:
    app.tasks.ingestion_tasks  — document parsing and embedding
    app.tasks.summary_tasks    — chunk summarisation (runs after ingestion)
"""

import os

from celery import Celery
from dotenv import load_dotenv

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "rag_project",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "app.tasks.ingestion_tasks",
        "app.tasks.summary_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Kolkata",
    enable_utc=False,
)
