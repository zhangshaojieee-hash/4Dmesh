import logging
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session, joinedload

from app.api.users import get_current_user
from app.core.database import get_db
from app.core.file_io import safe_filename
from app.core.model_lifecycle import retain_project_model
from app.core.model_thumbnails import ensure_model_thumbnail
from app.core.paths import MODEL_UPLOAD_DIR
from app.models import Model, Project, User

logger = logging.getLogger(__name__)

router = APIRouter()


class ProjectCreate(BaseModel):
    name: str = Field(max_length=200)
    model_url: str
    model_id: int | None = None
    model_name: str | None = None
    regions: list[dict[str, object]] = Field(default_factory=list)
    paint_data: dict[str, object] = Field(default_factory=dict)
    modules: list[dict[str, object]] = Field(default_factory=list)
    volume_regions: list[dict[str, object]] = Field(default_factory=list)
    surface_regions: list[dict[str, object]] = Field(default_factory=list)
    process_rules: list[dict[str, object]] = Field(default_factory=list)
    surface_paint_grid: dict[str, object] | None = None
    surface_direction: list[float] | None = None
    grid_magnetization: dict[str, object] | None = None
    input_type: str | None = None
    source_file: dict[str, object] | None = None
    gcode_info: dict[str, object] | None = None
    step: str = "idle"
    split_result: dict[str, object] | None = None
    model_result: dict[str, object] | None = None
    slice_result: dict[str, object] | None = None
    gcode_result: dict[str, object] | None = None
    printer_profile: str = "prusa_i3_mk3"
    quality_preset: str = "0.20mm"


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    model_url: str | None = None
    model_id: int | None = None
    model_name: str | None = None
    regions: list[dict[str, object]] | None = None
    paint_data: dict[str, object] | None = None
    modules: list[dict[str, object]] | None = None
    volume_regions: list[dict[str, object]] | None = None
    surface_regions: list[dict[str, object]] | None = None
    process_rules: list[dict[str, object]] | None = None
    surface_paint_grid: dict[str, object] | None = None
    surface_direction: list[float] | None = None
    grid_magnetization: dict[str, object] | None = None
    input_type: str | None = None
    source_file: dict[str, object] | None = None
    gcode_info: dict[str, object] | None = None
    step: str | None = None
    split_result: dict[str, object] | None = None
    model_result: dict[str, object] | None = None
    slice_result: dict[str, object] | None = None
    gcode_result: dict[str, object] | None = None
    printer_profile: str | None = None
    quality_preset: str | None = None


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: int
    name: str
    model_url: str
    model_id: int | None = None
    model_name: str | None = None
    regions: list[dict[str, object]] = Field(default_factory=list)
    paint_data: dict[str, object] = Field(default_factory=dict)
    modules: list[dict[str, object]] = Field(default_factory=list)
    volume_regions: list[dict[str, object]] = Field(default_factory=list)
    surface_regions: list[dict[str, object]] = Field(default_factory=list)
    process_rules: list[dict[str, object]] = Field(default_factory=list)
    surface_paint_grid: dict[str, object] | None = None
    surface_direction: list[float] | None = None
    grid_magnetization: dict[str, object] | None = None
    input_type: str | None = None
    source_file: dict[str, object] | None = None
    gcode_info: dict[str, object] | None = None
    step: str = "idle"
    split_result: dict[str, object] | None = None
    model_result: dict[str, object] | None = None
    slice_result: dict[str, object] | None = None
    gcode_result: dict[str, object] | None = None
    printer_profile: str = "prusa_i3_mk3"
    quality_preset: str = "0.20mm"
    created_at: datetime
    updated_at: datetime
    thumbnail_path: str | None = None


def _get_project_or_404(project_id: str, current_user: User, db: Session) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    project_user_id = getattr(project, "user_id")
    current_user_id = getattr(current_user, "id")
    if project_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access this project")
    return project


def _normalize_model_id(model_id: int | None, db: Session) -> int | None:
    if model_id is None:
        return None
    exists = db.query(Model.id).filter(Model.id == model_id).first()
    if not exists:
        raise HTTPException(status_code=400, detail="model_id does not reference an existing model")
    return model_id


def _apply_project_data(project: Project, data: dict[str, object]) -> None:
    for field, value in data.items():
        setattr(project, field, value)


def _find_existing_project(current_user: User, data: dict[str, object], db: Session) -> Project | None:
    model_id = data.get("model_id")
    if isinstance(model_id, int):
        existing = (
            db.query(Project)
            .filter(Project.user_id == current_user.id, Project.model_id == model_id)
            .order_by(Project.updated_at.desc())
            .first()
        )
        if existing:
            return existing

    model_url = data.get("model_url")
    if isinstance(model_url, str) and model_url:
        return (
            db.query(Project)
            .filter(Project.user_id == current_user.id, Project.model_url == model_url)
            .order_by(Project.updated_at.desc())
            .first()
        )
    return None


def _ensure_project_model_thumbnail(model_id: int | None, db: Session) -> None:
    if model_id is None:
        return
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model or not model.file_path:
        return
    model_filename = safe_filename(str(model.file_path))
    if not model_filename:
        return
    model_path = os.path.join(MODEL_UPLOAD_DIR, model_filename)
    if not os.path.exists(model_path):
        return
    ensure_model_thumbnail(model, model_path)


def _project_to_response(project: Project) -> ProjectResponse:
    response = ProjectResponse.model_validate(project)
    source_model = getattr(project, "source_model", None)
    if source_model is not None:
        response.thumbnail_path = source_model.thumbnail_path
    return response


@router.post("/", response_model=ProjectResponse)
async def create_project(
    request: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        data = request.model_dump()
        data["model_id"] = _normalize_model_id(data.get("model_id"), db)
        retained_model_id = retain_project_model(
            db,
            current_user=current_user,
            model_id=data.get("model_id"),
            model_url=data.get("model_url"),
        )
        data["model_id"] = retained_model_id
        _ensure_project_model_thumbnail(retained_model_id, db)
        project = _find_existing_project(current_user, data, db)
        if project is None:
            project = Project(user_id=current_user.id, **data)
            db.add(project)
        else:
            _apply_project_data(project, data)
        db.commit()
        db.refresh(project)
        return _project_to_response(project)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("create project failed")
        raise HTTPException(status_code=500, detail=f"创建项目失败: {type(e).__name__}: {e}")


@router.get("/", response_model=list[ProjectResponse])
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    projects = (
        db.query(Project)
        .options(joinedload(Project.source_model))
        .filter(Project.user_id == current_user.id)
        .order_by(Project.updated_at.desc())
        .all()
    )
    return [_project_to_response(project) for project in projects]


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, current_user, db)
    return _project_to_response(project)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    request: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, current_user, db)

    update_data = request.model_dump(exclude_unset=True)
    if "name" in update_data and update_data["name"] is None:
        raise HTTPException(status_code=400, detail="name cannot be null")
    if "model_url" in update_data and update_data["model_url"] is None:
        raise HTTPException(status_code=400, detail="model_url cannot be null")
    if "model_id" in update_data:
        update_data["model_id"] = _normalize_model_id(update_data["model_id"], db)

    try:
        model_id = update_data.get("model_id", project.model_id)
        model_url = update_data.get("model_url", project.model_url)
        retained_model_id = retain_project_model(
            db,
            current_user=current_user,
            model_id=model_id,
            model_url=model_url,
        )
        if retained_model_id is not None:
            update_data["model_id"] = retained_model_id
            _ensure_project_model_thumbnail(retained_model_id, db)
        for field, value in update_data.items():
            setattr(project, field, value)

        db.commit()
        db.refresh(project)
        return _project_to_response(project)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("update project failed")
        raise HTTPException(status_code=500, detail=f"更新项目失败: {type(e).__name__}: {e}")


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, current_user, db)

    try:
        db.delete(project)
        db.commit()
        return {"success": True, "message": "Project deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("delete project failed")
        raise HTTPException(status_code=500, detail=f"删除项目失败: {type(e).__name__}: {e}")
