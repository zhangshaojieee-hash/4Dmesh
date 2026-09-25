import os
import uuid

from app.core.paths import THUMBNAIL_DIR
from app.models import Model
from app.utils.thumbnail_generator import generate_thumbnail, should_generate_thumbnail


def generate_model_thumbnail_file(model_path: str, file_size: int | None = None) -> str | None:
    if not should_generate_thumbnail(model_path, file_size):
        return None

    thumbnail_name = f"{uuid.uuid4().hex}.png"
    thumbnail_path = os.path.join(THUMBNAIL_DIR, thumbnail_name)
    os.makedirs(THUMBNAIL_DIR, exist_ok=True)
    if not generate_thumbnail(model_path, thumbnail_path):
        return None
    return thumbnail_name


def ensure_model_thumbnail(model: Model, model_path: str, file_size: int | None = None) -> str | None:
    if model.thumbnail_path:
        return model.thumbnail_path

    thumbnail_name = generate_model_thumbnail_file(model_path, file_size)
    if not thumbnail_name:
        return None
    model.thumbnail_path = thumbnail_name
    return thumbnail_name
