"""Unit tests for FastAPI upload validation and chunk/image inspection endpoints.

All Supabase, Storage, and Celery calls are mocked using TestClient with
dependency overrides or by patching module-level objects.

No real services are contacted.
"""

import io
import sys
import zipfile
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Stub out Celery and Redis before importing main to avoid connection attempts
# ---------------------------------------------------------------------------

def _stub_celery():
    """Insert lightweight stubs for celery_app and ingestion_tasks."""
    import types

    # Stub celery_app module
    fake_celery = MagicMock()
    fake_celery_mod = types.ModuleType("celery_app")
    fake_celery_mod.celery_app = fake_celery
    sys.modules.setdefault("celery_app", fake_celery_mod)

    # Stub app.tasks.ingestion_tasks.process_document
    fake_task = MagicMock()
    fake_task.delay.return_value = SimpleNamespace(id="task-uuid")

    fake_ingestion_mod = types.ModuleType("app.tasks.ingestion_tasks")
    fake_ingestion_mod.process_document = fake_task
    sys.modules.setdefault("app.tasks.ingestion_tasks", fake_ingestion_mod)

    return fake_task


_MOCK_TASK = _stub_celery()


# Now safe to import main (Celery never actually connects)
import main as app_module  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers to build valid in-memory file bytes
# ---------------------------------------------------------------------------

MINIMAL_PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<<>>\nstartxref\n9\n%%EOF"


def _make_docx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<doc/>")
    return buf.getvalue()


def _make_pptx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("ppt/presentation.xml", "<prs/>")
    return buf.getvalue()


def _make_xlsx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("xl/workbook.xml", "<wb/>")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Client fixture with Supabase and Celery mocked
# ---------------------------------------------------------------------------

@pytest.fixture()
def client(monkeypatch):
    """TestClient with all external I/O mocked out."""
    mock_supa = MagicMock()

    # No duplicate documents
    mock_supa.table.return_value.select.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[])

    # Insert returns a document record
    mock_supa.table.return_value.insert.return_value.execute.return_value = SimpleNamespace(data=[{
        "id": "doc-test-uuid",
        "filename": "test.pdf",
        "storage_path": "some-uuid_test.pdf",
        "status": "uploaded",
        "created_at": "2026-01-01T00:00:00",
    }])

    # Storage upload
    mock_supa.storage.from_.return_value.upload.return_value = SimpleNamespace(data={})

    monkeypatch.setattr(app_module, "supabase", mock_supa)

    mock_task = MagicMock()
    mock_task.id = "task-uuid"

    with patch("app.tasks.ingestion_tasks.process_document") as mock_process:
        mock_process.delay.return_value = mock_task
        monkeypatch.setattr(app_module, "process_document", mock_process)
        yield TestClient(app_module.app), mock_supa


# ---------------------------------------------------------------------------
# Upload validation tests
# ---------------------------------------------------------------------------

def test_upload_accepts_valid_pdf(client):
    tc, _ = client
    response = tc.post(
        "/upload",
        files={"file": ("report.pdf", MINIMAL_PDF, "application/pdf")},
    )
    assert response.status_code == 200
    data = response.json()
    assert "document" in data
    assert data["document"]["status"] == "uploaded"


def test_upload_rejects_disallowed_extension(client):
    tc, _ = client
    response = tc.post(
        "/upload",
        files={"file": ("malware.exe", b"MZ...", "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "Allowed formats" in response.json()["detail"]


def test_upload_rejects_empty_file(client):
    tc, _ = client
    response = tc.post(
        "/upload",
        files={"file": ("empty.pdf", b"", "application/pdf")},
    )
    assert response.status_code == 400


def test_upload_rejects_pdf_with_wrong_magic(client):
    tc, _ = client
    response = tc.post(
        "/upload",
        files={"file": ("fake.pdf", b"This is not a PDF", "application/pdf")},
    )
    assert response.status_code == 400
    assert "valid PDF" in response.json()["detail"]


def test_upload_accepts_valid_docx(client):
    tc, _ = client
    docx = _make_docx()
    response = tc.post(
        "/upload",
        files={"file": ("doc.docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert response.status_code == 200


def test_upload_rejects_invalid_docx_structure(client):
    tc, _ = client
    bad_docx = io.BytesIO()
    with zipfile.ZipFile(bad_docx, "w") as z:
        z.writestr("random.xml", "<data/>")
    bad_docx.seek(0)
    response = tc.post(
        "/upload",
        files={"file": ("bad.docx", bad_docx.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert response.status_code == 400
    assert "DOCX" in response.json()["detail"]


def test_upload_accepts_valid_pptx(client):
    tc, _ = client
    response = tc.post(
        "/upload",
        files={"file": ("slides.pptx", _make_pptx(), "application/vnd.openxmlformats-officedocument.presentationml.presentation")},
    )
    assert response.status_code == 200


def test_upload_accepts_valid_xlsx(client):
    tc, _ = client
    response = tc.post(
        "/upload",
        files={"file": ("data.xlsx", _make_xlsx(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert response.status_code == 200


def test_upload_rejects_invalid_xlsx_structure(client):
    tc, _ = client
    bad_xlsx = io.BytesIO()
    with zipfile.ZipFile(bad_xlsx, "w") as z:
        z.writestr("junk.txt", "not excel")
    bad_xlsx.seek(0)
    response = tc.post(
        "/upload",
        files={"file": ("bad.xlsx", bad_xlsx.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert response.status_code == 400
    assert "XLSX" in response.json()["detail"]


def test_upload_accepts_valid_csv(client):
    tc, _ = client
    csv_bytes = b"col1,col2\nval1,val2\n"
    response = tc.post(
        "/upload",
        files={"file": ("data.csv", csv_bytes, "text/csv")},
    )
    assert response.status_code == 200


def test_upload_rejects_empty_csv(client):
    tc, _ = client
    response = tc.post(
        "/upload",
        files={"file": ("empty.csv", b"   \n  ", "text/csv")},
    )
    assert response.status_code == 400


def test_upload_accepts_valid_html(client):
    tc, _ = client
    html = b"<html><body><p>Hello</p></body></html>"
    response = tc.post(
        "/upload",
        files={"file": ("page.html", html, "text/html")},
    )
    assert response.status_code == 200


def test_upload_rejects_non_utf8_csv(client):
    tc, _ = client
    # Latin-1 encoded content that is not valid UTF-8
    latin_bytes = "col1,col2\nÄÖÜ,test\n".encode("latin-1")
    response = tc.post(
        "/upload",
        files={"file": ("latin.csv", latin_bytes, "text/csv")},
    )
    assert response.status_code == 400
    assert "UTF-8" in response.json()["detail"]


# ---------------------------------------------------------------------------
# Chunk inspection API tests
# ---------------------------------------------------------------------------

@pytest.fixture()
def chunk_client(monkeypatch):
    """Client fixture for chunk/image inspection endpoints."""
    mock_supa = MagicMock()
    monkeypatch.setattr(app_module, "supabase", mock_supa)
    return TestClient(app_module.app), mock_supa


def test_get_chunks_returns_chunk_list(chunk_client):
    tc, mock_supa = chunk_client

    DOC_ID = "00000000-0000-0000-0000-000000000001"
    CHUNK_ID = "00000000-0000-0000-0000-000000000002"

    # Document exists
    mock_supa.table.return_value.select.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[{"id": DOC_ID}])

    # Chunks query
    mock_supa.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value = SimpleNamespace(data=[
        {
            "id": CHUNK_ID,
            "document_id": DOC_ID,
            "content": "Some text.",
            "chunk_index": 0,
            "page_number": 1,
            "element_type": "Text",
            "table_html": None,
            "image_caption": None,
            "summary": None,
            "image_storage_path": None,
        }
    ])

    response = tc.get(f"/documents/{DOC_ID}/chunks")
    assert response.status_code == 200
    data = response.json()
    assert data["document_id"] == DOC_ID
    assert len(data["chunks"]) == 1
    assert data["chunks"][0]["has_image"] is False


def test_get_chunks_returns_404_for_missing_document(chunk_client):
    tc, mock_supa = chunk_client
    mock_supa.table.return_value.select.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[])

    response = tc.get("/documents/00000000-0000-0000-0000-000000000099/chunks")
    assert response.status_code == 404


def test_get_chunk_image_returns_image_bytes(chunk_client):
    tc, mock_supa = chunk_client

    DOC_ID = "00000000-0000-0000-0000-000000000001"
    CHUNK_ID = "00000000-0000-0000-0000-000000000002"

    mock_supa.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[{
        "id": CHUNK_ID,
        "document_id": DOC_ID,
        "image_storage_path": f"{DOC_ID}/images/0.png",
        "image_mime_type": "image/png",
    }])

    fake_png = b"\x89PNG\r\n\x1a\n"
    mock_supa.storage.from_.return_value.download.return_value = fake_png

    response = tc.get(f"/documents/{DOC_ID}/chunks/{CHUNK_ID}/image")
    assert response.status_code == 200
    assert response.content == fake_png
    assert "image/png" in response.headers["content-type"]


def test_get_chunk_image_returns_404_for_chunk_without_image(chunk_client):
    tc, mock_supa = chunk_client

    DOC_ID = "00000000-0000-0000-0000-000000000001"
    CHUNK_ID = "00000000-0000-0000-0000-000000000002"

    mock_supa.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[{
        "id": CHUNK_ID,
        "document_id": DOC_ID,
        "image_storage_path": None,
        "image_mime_type": None,
    }])

    response = tc.get(f"/documents/{DOC_ID}/chunks/{CHUNK_ID}/image")
    assert response.status_code == 404


def test_get_chunk_image_returns_404_for_missing_chunk(chunk_client):
    tc, mock_supa = chunk_client

    DOC_ID = "00000000-0000-0000-0000-000000000001"
    CHUNK_ID = "00000000-0000-0000-0000-000000000002"

    mock_supa.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[])

    response = tc.get(f"/documents/{DOC_ID}/chunks/{CHUNK_ID}/image")
    assert response.status_code == 404


def test_get_chunks_has_image_true_when_storage_path_present(chunk_client):
    tc, mock_supa = chunk_client

    DOC_ID = "00000000-0000-0000-0000-000000000001"
    CHUNK_ID = "00000000-0000-0000-0000-000000000002"

    mock_supa.table.return_value.select.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[{"id": DOC_ID}])
    mock_supa.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value = SimpleNamespace(data=[
        {
            "id": CHUNK_ID,
            "document_id": DOC_ID,
            "content": "[Image on page 1]",
            "chunk_index": 0,
            "page_number": 1,
            "element_type": "Image",
            "table_html": None,
            "image_caption": "A chart.",
            "summary": None,
            "image_storage_path": f"{DOC_ID}/images/0.png",
        }
    ])

    response = tc.get(f"/documents/{DOC_ID}/chunks")
    assert response.status_code == 200
    chunk = response.json()["chunks"][0]
    assert chunk["has_image"] is True
