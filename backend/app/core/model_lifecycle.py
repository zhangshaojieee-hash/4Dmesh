import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

from sqlalchemy.orm import Session

from app.core.file_io import remove_file_quietly, safe_filename
from app.core.paths import MODEL_UPLOAD_DIR, THUMBNAIL_DIR
from app.models import Model, Project, User


logger = logging.getLogger(__name__)

MODEL_STATUS_DRAFT = "draft"
MODEL_STATUS_SAVED = "saved"
DEFAULT_DRAFT_MODEL_RETENTION_DAYS = 3


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def draft_model_expires_at() -> datetime:
    raw_days = os.getenv("DRAFT_MODEL_RETENTION_DAYS", "").strip()
    try:
        days = float(raw_days) if raw_days else DEFAULT_DRAFT_MODEL_RETENTION_DAYS
    except ValueError:
        days = DEFAULT_DRAFT_MODEL_RETENTION_DAYS
    return _utcnow() + timedelta(days=max(0.25, days))


def is_saved_model(model: Model) -> bool:
    return (getattr(model, "lifecycle_status", None) or MODEL_STATUS_SAVED) == MODEL_STATUS_SAVED


def retain_model(model: Model, *, source_type: str | None = None) -> None:
    model.lifecycle_status = MODEL_STATUS_SAVED
    model.retention_expires_at = None
    if source_type and not model.source_type:
        model.source_type = source_type


def create_draft_model_record(
    db: Session,
    *,
    current_user: User,
    name: str,
    file_path: str,
    category: str = "ai",
    source_type: str = "ai_generated",
    description: str = "",
    thumbnail_path: str | None = None,
) -> Model:
    db_model = Model(
        name=(name or "AI 创作模型")[:255],
        description=description,
        category=category or "ai",
        file_path=safe_filename(file_path),
        thumbnail_path=thumbnail_path,
        user_id=current_user.id,
        lifecycle_status=MODEL_STATUS_DRAFT,
        retention_expires_at=draft_model_expires_at(),
        source_type=source_type,
    )
    db.add(db_model)
    db.commit()
    db.refresh(db_model)
    return db_model


def model_file_url(file_path: str) -> str:
    return f"/api/models/file/{safe_filename(file_path)}"


def _filename_from_model_url(model_url: str | None) -> str | None:
    if not model_url:
        return None
    decoded = unquote(str(model_url))
    parsed = urlparse(decoded)
    path = parsed.path or decoded
    filename = safe_filename(os.path.basename(path.lstrip("/")))
    return filename or None


def find_owned_model_for_url(db: Session, *, user_id: int, model_url: str | None) -> Model | None:
    filename = _filename_from_model_url(model_url)
    if not filename:
        return None
    return db.query(Model).filter(Model.user_id == user_id, Model.file_path == filename).first()


def retain_project_model(
    db: Session,
    *,
    current_user: User,
    model_id: int | None,
    model_url: str | None,
) -> int | None:
    model: Model | None = None
    if model_id is not None:
        model = db.query(Model).filter(Model.id == model_id).first()
        if not model:
            return None
        if model.user_id != current_user.id:
            return model_id
    else:
        model = find_owned_model_for_url(db, user_id=current_user.id, model_url=model_url)

    if model and model.user_id == current_user.id:
        retain_model(model, source_type=model.source_type or "project_saved")
        return model.id
    return model_id


def _remove_model_files(model: Model) -> None:
    if model.file_path:
        filename = safe_filename(model.file_path)
        model_path = Path(MODEL_UPLOAD_DIR) / filename
        remove_file_quietly(os.fspath(model_path))
        stem = model_path.stem
        for preview in model_path.parent.glob(f"{stem}_preview.*"):
            remove_file_quietly(os.fspath(preview))
    if model.thumbnail_path:
        remove_file_quietly(os.path.join(THUMBNAIL_DIR, safe_filename(model.thumbnail_path)))


def cleanup_expired_draft_models(db: Session) -> int:
    now = _utcnow()
    drafts = db.query(Model).filter(Model.lifecycle_status == MODEL_STATUS_DRAFT).all()
    removed = 0
    for model in drafts:
        expires_at = _as_aware_utc(model.retention_expires_at)
        if expires_at is None or expires_at > now:
            continue
        if db.query(Project.id).filter(Project.model_id == model.id).first():
            retain_model(model, source_type=model.source_type or "project_saved")
            continue
        _remove_model_files(model)
        db.delete(model)
        removed += 1
    if removed:
        db.commit()
        logger.info("Removed %d expired draft models", removed)
    elif drafts:
        db.commit()
    return removed
