import os

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

from app.api.device import _safe_gcode_filename
from app.core.file_io import safe_filename
import app.core.paths as paths


def test_upload_relative_path_uses_forward_slashes(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "UPLOAD_ROOT", str(tmp_path))
    monkeypatch.setattr(paths, "UPLOAD_ROOT_PATH", tmp_path)
    nested = tmp_path / "avatars" / "user.png"
    nested.parent.mkdir(parents=True, exist_ok=True)
    nested.write_bytes(b"data")

    assert paths.upload_relative_path(nested).replace("\\", "/") == "avatars/user.png"


def test_resolve_upload_relative_path_accepts_windows_separators(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "UPLOAD_ROOT", str(tmp_path))
    monkeypatch.setattr(paths, "UPLOAD_ROOT_PATH", tmp_path)
    expected = tmp_path / "avatars" / "user.png"
    expected.parent.mkdir(parents=True, exist_ok=True)
    expected.write_bytes(b"data")

    resolved = paths.resolve_upload_relative_path(r"avatars\user.png")

    assert resolved == os.fspath(expected.resolve())


def test_safe_filename_accepts_windows_paths():
    assert safe_filename(r"C:\Users\Dev\Desktop\avatar.png") == "avatar.png"


def test_device_gcode_filename_rejects_windows_paths():
    with pytest.raises(HTTPException):
        _safe_gcode_filename(r"C:\Users\Dev\Desktop\part.gcode")
