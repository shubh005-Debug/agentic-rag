"""Tests for Tesseract OCR path configuration in unstructured_parser.

_configure_tesseract() accepts injectable dependencies so these tests require
no Tesseract binary, no real filesystem access, and no heavy Unstructured
import chains.
"""

import logging
import types

import pytest

from app.services.unstructured_parser import _configure_tesseract


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_tess_stub():
    """Return a simple object that mimics the pytesseract shim."""
    return types.SimpleNamespace(pytesseract_command="tesseract")


def _run(monkeypatch, env_vars: dict, tess_on_path: bool, windows_paths: list[str]):
    """Call _configure_tesseract with controlled env and injected stubs.

    Returns the stub pytesseract object so tests can inspect pytesseract_command.
    """
    for key in ("TESSERACT_CMD",):
        monkeypatch.delenv(key, raising=False)
    for key, val in env_vars.items():
        monkeypatch.setenv(key, val)

    stub = _make_tess_stub()

    _configure_tesseract(
        tess_module=stub,
        which_fn=lambda name: "/usr/bin/tesseract" if tess_on_path else None,
        path_exists_fn=lambda p: p in windows_paths,
    )

    return stub


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_explicit_tesseract_cmd_is_used(monkeypatch):
    """TESSERACT_CMD env var sets the pytesseract command path."""
    explicit = r"D:\custom\Tesseract-OCR\tesseract.exe"
    stub = _run(
        monkeypatch,
        env_vars={"TESSERACT_CMD": explicit},
        tess_on_path=False,
        windows_paths=[],
    )
    assert stub.pytesseract_command == explicit


def test_tesseract_on_path_leaves_command_unchanged(monkeypatch):
    """When Tesseract is on PATH and no TESSERACT_CMD is set, command is unchanged."""
    stub = _run(
        monkeypatch,
        env_vars={},
        tess_on_path=True,
        windows_paths=[],
    )
    # _configure_tesseract returns early without touching pytesseract_command
    assert stub.pytesseract_command == "tesseract"


def test_windows_fallback_path_is_used(monkeypatch):
    """When Tesseract is not on PATH, a known Windows install path is used."""
    win_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    stub = _run(
        monkeypatch,
        env_vars={},
        tess_on_path=False,
        windows_paths=[win_path],
    )
    assert stub.pytesseract_command == win_path


def test_second_windows_fallback_used_when_first_missing(monkeypatch):
    """Falls through to the second Windows path when the first does not exist."""
    second_path = r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"
    stub = _run(
        monkeypatch,
        env_vars={},
        tess_on_path=False,
        windows_paths=[second_path],  # first path absent
    )
    assert stub.pytesseract_command == second_path


def test_missing_tesseract_emits_warning(monkeypatch, caplog):
    """When Tesseract cannot be found anywhere, a WARNING is logged."""
    with caplog.at_level(logging.WARNING, logger="app.services.unstructured_parser"):
        _run(
            monkeypatch,
            env_vars={},
            tess_on_path=False,
            windows_paths=[],
        )
    assert any("Tesseract OCR binary not found" in r.message for r in caplog.records)


def test_missing_tesseract_does_not_raise(monkeypatch):
    """A missing Tesseract binary must not raise an exception."""
    _run(
        monkeypatch,
        env_vars={},
        tess_on_path=False,
        windows_paths=[],
    )


def test_explicit_cmd_takes_priority_over_path_and_windows(monkeypatch):
    """TESSERACT_CMD takes priority even when Tesseract is also on PATH."""
    explicit = r"D:\custom\tesseract.exe"
    stub = _run(
        monkeypatch,
        env_vars={"TESSERACT_CMD": explicit},
        tess_on_path=True,
        windows_paths=[r"C:\Program Files\Tesseract-OCR\tesseract.exe"],
    )
    assert stub.pytesseract_command == explicit
