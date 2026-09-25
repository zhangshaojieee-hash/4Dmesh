import os

from app.utils.thumbnail_generator import should_generate_thumbnail


def test_large_supported_model_skips_auto_thumbnail(tmp_path):
    model_path = tmp_path / "large.glb"
    model_path.write_bytes(b"placeholder")

    assert not should_generate_thumbnail(os.fspath(model_path), 11 * 1024 * 1024)


def test_small_supported_model_allows_auto_thumbnail(tmp_path):
    model_path = tmp_path / "small.glb"
    model_path.write_bytes(b"placeholder")

    assert should_generate_thumbnail(os.fspath(model_path), 10 * 1024 * 1024)


def test_auto_thumbnail_can_be_disabled(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTO_THUMBNAIL_MAX_MODEL_SIZE_MB", "0")
    model_path = tmp_path / "small.stl"
    model_path.write_bytes(b"placeholder")

    assert not should_generate_thumbnail(os.fspath(model_path), 1)


def test_unsupported_model_extension_skips_auto_thumbnail(tmp_path):
    model_path = tmp_path / "model.step"
    model_path.write_bytes(b"placeholder")

    assert not should_generate_thumbnail(os.fspath(model_path), 1)
