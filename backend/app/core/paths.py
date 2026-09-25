import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[2]


def _resolve_data_dir() -> Path:
    configured = os.getenv("DATA_DIR", "").strip()
    raw_path = Path(configured) if configured else BACKEND_DIR
    if not raw_path.is_absolute():
        raw_path = BACKEND_DIR / raw_path
    return raw_path.resolve()


DATA_DIR_PATH = _resolve_data_dir()


def _resolve_runtime_path(env_name: str, default_relative: str) -> Path:
    configured = os.getenv(env_name, "").strip()
    raw_path = Path(configured) if configured else DATA_DIR_PATH / default_relative
    if not raw_path.is_absolute():
        raw_path = DATA_DIR_PATH / raw_path
    return raw_path.resolve()


UPLOAD_ROOT_PATH = _resolve_runtime_path("UPLOAD_ROOT", "uploads")
MODEL_UPLOAD_DIR_PATH = UPLOAD_ROOT_PATH / "models"
THUMBNAIL_DIR_PATH = UPLOAD_ROOT_PATH / "thumbnails"
TEMP_DIR_PATH = UPLOAD_ROOT_PATH / "temp"
AVATAR_DIR_PATH = UPLOAD_ROOT_PATH / "avatars"
SLICE_OUTPUT_DIR_PATH = UPLOAD_ROOT_PATH / "slices"
GCODE_DIR_PATH = UPLOAD_ROOT_PATH / "gcode"

DATA_DIR = str(DATA_DIR_PATH)
UPLOAD_ROOT = str(UPLOAD_ROOT_PATH)
MODEL_UPLOAD_DIR = str(MODEL_UPLOAD_DIR_PATH)
THUMBNAIL_DIR = str(THUMBNAIL_DIR_PATH)
TEMP_DIR = str(TEMP_DIR_PATH)
AVATAR_DIR = str(AVATAR_DIR_PATH)
SLICE_OUTPUT_DIR = str(SLICE_OUTPUT_DIR_PATH)
GCODE_DIR = str(GCODE_DIR_PATH)


def ensure_upload_dirs() -> None:
    for directory in (
        UPLOAD_ROOT_PATH,
        MODEL_UPLOAD_DIR_PATH,
        THUMBNAIL_DIR_PATH,
        TEMP_DIR_PATH,
        AVATAR_DIR_PATH,
        SLICE_OUTPUT_DIR_PATH,
        GCODE_DIR_PATH,
    ):
        directory.mkdir(parents=True, exist_ok=True)


def upload_relative_path(path: str | os.PathLike[str]) -> str:
    return os.path.relpath(os.fspath(path), UPLOAD_ROOT).replace("\\", "/")


def resolve_upload_relative_path(relative_path: str) -> str:
    normalized_relative_path = str(relative_path).replace("\\", "/").lstrip("/")
    candidate = (UPLOAD_ROOT_PATH / normalized_relative_path).resolve()
    if not candidate.is_relative_to(UPLOAD_ROOT_PATH):
        raise ValueError("Path is outside UPLOAD_ROOT")
    return str(candidate)
