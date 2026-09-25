from fastapi import APIRouter, HTTPException, Depends, File, UploadFile, Form, Query, BackgroundTasks
from fastapi.responses import FileResponse, RedirectResponse
from typing import List, Optional, Literal
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel
import json
import os
import shutil
import uuid
from urllib.parse import unquote, urlparse
from app.core.database import get_db
from app.core.file_io import remove_dir_quietly, remove_file_quietly, safe_filename, save_httpx_response_stream, save_upload_file
from app.core.limits import run_heavy_task
from app.core.model_lifecycle import (
    MODEL_STATUS_DRAFT,
    MODEL_STATUS_SAVED,
    is_saved_model,
    retain_model as retain_model_record,
)
from app.core.model_thumbnails import ensure_model_thumbnail, generate_model_thumbnail_file
from app.core.paths import (
    BACKEND_DIR as BACKEND_DIR_PATH,
    MODEL_UPLOAD_DIR,
    SLICE_OUTPUT_DIR,
    THUMBNAIL_DIR,
    upload_relative_path,
    resolve_upload_relative_path,
)
from app.schemas import ModelResponse
from app.models import Model, ModelLike, User, ModelFavorite, Notification, PrintFeedback, PrintHistory, Project
from app.api.users import get_current_user, get_optional_user
from app.api.notifications import notify_model_owner

router = APIRouter()

BACKEND_DIR = os.fspath(BACKEND_DIR_PATH)
UPLOAD_DIR = MODEL_UPLOAD_DIR
VIEWER_ENVIRONMENT_DIR = os.path.join(BACKEND_DIR, "resources", "viewer-environments")
DEFAULT_VIEWER_ENVIRONMENT_FILE = os.path.join(VIEWER_ENVIRONMENT_DIR, "default.hdr")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(THUMBNAIL_DIR, exist_ok=True)
os.makedirs(VIEWER_ENVIRONMENT_DIR, exist_ok=True)

ALLOWED_MODEL_EXTENSIONS = {".stl", ".obj", ".3mf", ".step", ".glb", ".gltf"}
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_MODEL_SIZE = 100 * 1024 * 1024  # 100MB
MAX_THUMBNAIL_SIZE = 5 * 1024 * 1024  # 5MB


def inspect_gltf_references(content: bytes) -> tuple[list[str], list[str]]:
    try:
        payload = json.loads(content.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail=".gltf 文件必须是 UTF-8 编码的 JSON") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f".gltf 文件不是有效的 JSON: {exc.msg}") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail=".gltf 文件内容无效：根节点必须是 JSON 对象")

    referenced_sidecars = []

    for image in payload.get("images", []):
        if not isinstance(image, dict):
            continue
        uri = image.get("uri")
        if isinstance(uri, str) and uri and not uri.startswith("data:"):
            referenced_sidecars.append(uri)

    for buffer in payload.get("buffers", []):
        if not isinstance(buffer, dict):
            continue
        uri = buffer.get("uri")
        if isinstance(uri, str) and uri and not uri.startswith("data:"):
            referenced_sidecars.append(uri)

    resolvable_sidecars = []
    unsupported_sidecars = []
    for uri in referenced_sidecars:
        decoded_uri = unquote(uri)
        parsed = urlparse(decoded_uri)
        normalized_path = decoded_uri.replace("\\", "/")

        if parsed.scheme and parsed.scheme not in {"", "file"}:
            unsupported_sidecars.append(uri)
            continue
        if parsed.netloc:
            unsupported_sidecars.append(uri)
            continue
        if normalized_path.startswith("/") or normalized_path.startswith("../") or "/../" in normalized_path:
            unsupported_sidecars.append(uri)
            continue
        if not normalized_path.strip():
            unsupported_sidecars.append(uri)
            continue
        resolvable_sidecars.append(uri)

    return resolvable_sidecars, unsupported_sidecars


def _validate_gltf_upload(content: bytes) -> None:
    resolvable_sidecars, unsupported_sidecars = inspect_gltf_references(content)

    if resolvable_sidecars or unsupported_sidecars:
        details = []
        if resolvable_sidecars:
            details.append(
                "当前上传接口只接收单个 .gltf 文件，无法同时接收其外部 sidecar 资源。"
                f" 检测到外部资源引用: {', '.join(sorted(set(resolvable_sidecars)))}。"
            )
        if unsupported_sidecars:
            details.append(
                "检测到不可解析的 .gltf 外部资源引用（仅支持同目录下的直接文件名，且不支持 URL、绝对路径或父目录跳转）: "
                f"{', '.join(sorted(set(unsupported_sidecars)))}。"
            )
        details.append("请改用 .glb，或将所有 buffer/image 资源内嵌为 data URI 后重新上传 .gltf。")
        raise HTTPException(status_code=400, detail="".join(details))


async def _save_thumbnail_upload(thumbnail: Optional[UploadFile]) -> tuple[str | None, str | None]:
    if not thumbnail or not thumbnail.filename:
        return None, None
    thumb_ext = os.path.splitext(thumbnail.filename)[1].lower()
    if thumb_ext not in ALLOWED_IMAGE_EXTENSIONS:
        return None, None
    thumb_path = os.path.join(THUMBNAIL_DIR, f"{uuid.uuid4().hex}{thumb_ext}")
    try:
        await save_upload_file(
            thumbnail,
            thumb_path,
            max_size=MAX_THUMBNAIL_SIZE,
            too_large_detail="缩略图不能超过 5MB",
        )
    except HTTPException:
        remove_file_quietly(thumb_path)
        raise
    return os.path.basename(thumb_path), thumb_path


def _resolve_viewer_environment_path() -> Optional[str]:
    configured_path = os.environ.get("MODEL_VIEWER_HDR_PATH", "").strip()
    if configured_path:
        resolved_path = configured_path if os.path.isabs(configured_path) else os.path.join(BACKEND_DIR, configured_path)
        resolved_path = os.path.abspath(resolved_path)
        if os.path.isfile(resolved_path):
            return resolved_path

    if os.path.isfile(DEFAULT_VIEWER_ENVIRONMENT_FILE):
        return DEFAULT_VIEWER_ENVIRONMENT_FILE

    for filename in sorted(os.listdir(VIEWER_ENVIRONMENT_DIR)):
        if not filename.lower().endswith(".hdr"):
            continue
        candidate = os.path.join(VIEWER_ENVIRONMENT_DIR, filename)
        if os.path.isfile(candidate):
            return candidate

    return None


@router.post("/")
async def create_model(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(""),
    category: str = Form("other"),
    thumbnail: Optional[UploadFile] = File(None),
    parent_model_id: Optional[int] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Validate model file extension
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_MODEL_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: {ext}。支持: {', '.join(ALLOWED_MODEL_EXTENSIONS)}",
        )

    unique_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_name)
    thumbnail_name = None
    thumbnail_file_path = None
    try:
        file_size = await save_upload_file(
            file,
            file_path,
            max_size=MAX_MODEL_SIZE,
            too_large_detail="模型文件不能超过 100MB",
        )
        if ext == ".gltf":
            with open(file_path, "rb") as f:
                _validate_gltf_upload(f.read())

        if thumbnail and thumbnail.filename:
            thumbnail_name, thumbnail_file_path = await _save_thumbnail_upload(thumbnail)
        elif file_size is not None:
            thumbnail_name = generate_model_thumbnail_file(file_path, file_size)
            thumbnail_file_path = os.path.join(THUMBNAIL_DIR, thumbnail_name) if thumbnail_name else None

        # Determine version number
        if parent_model_id:
            parent = db.query(Model).filter(Model.id == parent_model_id).first()
            if not parent:
                raise HTTPException(status_code=404, detail="父模型不存在")
            if parent.user_id != current_user.id:
                raise HTTPException(status_code=403, detail="只能为自己的模型上传新版本")
            max_ver = db.query(func.max(Model.version_number)).filter(
                (Model.parent_model_id == parent_model_id) | (Model.id == parent_model_id)
            ).scalar() or 0
            version_number = max_ver + 1
        else:
            version_number = 1

        # Create DB record
        db_model = Model(
            name=name,
            description=description,
            category=category,
            file_path=unique_name,
            thumbnail_path=thumbnail_name,
            user_id=current_user.id,
            version_number=version_number,
            parent_model_id=parent_model_id,
            lifecycle_status=MODEL_STATUS_SAVED,
            retention_expires_at=None,
            source_type="library_upload",
        )
        db.add(db_model)
        if parent_model_id:
            notify_model_owner(
                db,
                model=parent,
                actor=current_user,
                type="model_version",
                title="模型版本已更新",
                message=f"{current_user.username} 上传了「{parent.name}」的新版本",
                link=f"/models/{parent.id}?tab=versions",
            )
        db.commit()
    except Exception:
        db.rollback()
        remove_file_quietly(file_path)
        remove_file_quietly(thumbnail_file_path)
        raise

    db.refresh(db_model)

    return _model_to_response(db_model, db)


@router.get("/")
async def get_models(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: Optional[str] = Query("newest"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    query = db.query(Model).options(joinedload(Model.owner)).filter(Model.lifecycle_status == MODEL_STATUS_SAVED)

    if category and category != "all":
        query = query.filter(Model.category == category)

    if search:
        query = query.filter(Model.name.ilike(f"%{search}%"))

    total = query.count()

    sort_options = {
        "newest": Model.created_at.desc(),
        "oldest": Model.created_at.asc(),
        "most_downloaded": Model.downloads.desc(),
        "most_liked": Model.likes.desc(),
        "name": Model.name.asc(),
    }
    order = sort_options.get(sort_by or "newest", Model.created_at.desc())
    models = query.order_by(order).offset(skip).limit(limit).all()

    liked_ids: set = set()
    if current_user:
        liked_ids = {row.model_id for row in db.query(ModelLike.model_id).filter(
            ModelLike.user_id == current_user.id,
            ModelLike.model_id.in_([m.id for m in models])
        ).all()}

    return {
        "total": total,
        "page": skip // limit if limit else 0,
        "page_size": limit,
        "has_next": (skip + limit) < total,
        "models": [{**_model_to_response(m, db), "liked_by_current_user": m.id in liked_ids} for m in models],
    }


class DownloadSplitRequest(BaseModel):
    model_url: str
    regions: list = []
    paint_data: dict = {}
    volume_regions: Optional[list] = None
    surface_paint_grid: Optional[dict] = None


@router.post("/{model_id}/retain")
async def retain_model(
    model_id: int,
    name: str = Form(...),
    description: str = Form(""),
    category: str = Form("other"),
    thumbnail: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model = db.query(Model).options(joinedload(Model.owner)).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if model.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to retain this model")

    thumbnail_name = None
    thumbnail_file_path = None
    old_thumbnail_path = None
    try:
        if thumbnail and thumbnail.filename:
            thumbnail_name, thumbnail_file_path = await _save_thumbnail_upload(thumbnail)
            if thumbnail_name and model.thumbnail_path:
                old_thumbnail_path = os.path.join(THUMBNAIL_DIR, safe_filename(model.thumbnail_path))
        elif not model.thumbnail_path and model.file_path:
            model_filename = safe_filename(model.file_path)
            model_path = os.path.join(UPLOAD_DIR, model_filename) if model_filename else None
            if model_path and os.path.exists(model_path):
                thumbnail_name = ensure_model_thumbnail(model, model_path)
                thumbnail_file_path = os.path.join(THUMBNAIL_DIR, thumbnail_name) if thumbnail_name else None

        model.name = name
        model.description = description
        model.category = category
        if thumbnail_name:
            model.thumbnail_path = thumbnail_name
        retain_model_record(model, source_type=model.source_type or "retained_model")

        db.commit()
        db.refresh(model)
    except Exception:
        db.rollback()
        remove_file_quietly(thumbnail_file_path)
        raise

    if old_thumbnail_path:
        remove_file_quietly(old_thumbnail_path)
    return _model_to_response(model, db)


@router.get("/drafts")
async def get_my_draft_models(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Model).options(joinedload(Model.owner)).filter(
        Model.user_id == current_user.id,
        Model.lifecycle_status == MODEL_STATUS_DRAFT,
    )
    total = query.count()
    models = query.order_by(Model.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "total": total,
        "page": skip // limit if limit else 0,
        "page_size": limit,
        "has_next": (skip + limit) < total,
        "models": [_model_to_response(m, db) for m in models],
    }


@router.get("/download-as")
async def download_as(
    background_tasks: BackgroundTasks,
    model_url: str = Query(...),
    format: Literal["glb", "3mf", "original"] = Query(...),
):
    from app.api.gcode import _resolve_model_path, _load_scene_or_mesh, _scene_to_geometry_map, _export_mesh_as_glb, _export_mesh_as_3mf
    from app.api.ai import _make_client
    import urllib.parse

    cleanup_paths: list[str] = []
    output_path: Optional[str] = None
    # Handle remote URLs: download to local temp first
    decoded_url = urllib.parse.unquote(model_url)
    if decoded_url.startswith("http://") or decoded_url.startswith("https://"):
        try:
            async with _make_client(timeout=180.0) as client:
                async with client.stream("GET", decoded_url, follow_redirects=True) as resp:
                    resp.raise_for_status()
                    parsed = urllib.parse.urlparse(decoded_url)
                    ext = os.path.splitext(parsed.path)[1] or ".glb"
                    temp_name = f"remote_{uuid.uuid4().hex[:8]}{ext}"
                    model_path = os.path.join(UPLOAD_DIR, temp_name)
                    cleanup_paths.append(model_path)
                    await save_httpx_response_stream(
                        resp,
                        model_path,
                        max_size=100 * 1024 * 1024,
                        too_large_detail="远程模型不能超过 100MB",
                    )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"远程模型下载失败: {e}")
    else:
        model_path = _resolve_model_path(model_url)
        if not os.path.exists(model_path):
            raise HTTPException(status_code=404, detail="模型文件不存在")

    file_uuid = uuid.uuid4().hex[:8]

    if format == "original":
        original_ext = os.path.splitext(model_path)[1]
        filename = f"model_{file_uuid}{original_ext}"
        response = FileResponse(
            path=model_path,
            filename=filename,
            media_type="application/octet-stream",
            background=background_tasks,
        )
        for cleanup_path in cleanup_paths:
            background_tasks.add_task(remove_file_quietly, cleanup_path)
        return response

    try:
        scene_or_mesh = _load_scene_or_mesh(model_path)
        _, merged_mesh = _scene_to_geometry_map(scene_or_mesh)

        if format == "glb":
            output_path = os.path.join(UPLOAD_DIR, f"temp_{file_uuid}.glb")
            _export_mesh_as_glb(merged_mesh, output_path)
            filename = f"model_{file_uuid}.glb"
        else:
            output_path = os.path.join(UPLOAD_DIR, f"temp_{file_uuid}.3mf")
            _export_mesh_as_3mf(merged_mesh, output_path, repair=False)
            filename = f"model_{file_uuid}.3mf"

        response = FileResponse(
            path=output_path,
            filename=filename,
            media_type="application/octet-stream",
            background=background_tasks,
        )
        for cleanup_path in cleanup_paths:
            background_tasks.add_task(remove_file_quietly, cleanup_path)
        background_tasks.add_task(remove_file_quietly, output_path)
        return response
    except HTTPException:
        if output_path:
            remove_file_quietly(output_path)
        for cleanup_path in cleanup_paths:
            remove_file_quietly(cleanup_path)
        raise
    except Exception as e:
        if output_path:
            remove_file_quietly(output_path)
        for cleanup_path in cleanup_paths:
            remove_file_quietly(cleanup_path)
        raise HTTPException(status_code=500, detail=f"格式转换失败: {e}")


@router.post("/download-split")
async def download_split(request: DownloadSplitRequest):
    """按加磁区域切分模型并打包下载"""
    from app.api.gcode import (
        _resolve_model_path, split_model_by_regions, create_3mf_package,
        RegionData,
    )

    if not request.regions and not request.paint_data and not request.volume_regions and not request.surface_paint_grid:
        raise HTTPException(status_code=400, detail="请先选择加磁区域")

    model_path = _resolve_model_path(request.model_url)
    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail="模型文件不存在")

    output_dir = None
    try:
        regions = [RegionData(**r) for r in request.regions]

        output_dir = os.path.join(UPLOAD_DIR, "split", uuid.uuid4().hex[:8])
        os.makedirs(output_dir, exist_ok=True)

        split_files = split_model_by_regions(
            model_path, regions, output_dir, request.paint_data,
            volume_regions=request.volume_regions,
            surface_paint_grid=request.surface_paint_grid,
        )

        if not split_files:
            raise HTTPException(status_code=400, detail="切分结果为空，请检查加磁区域设置")

        individual_files = split_files.get("_individual_files", {})

        output_zip = os.path.join(SLICE_OUTPUT_DIR, f"model_split_{uuid.uuid4().hex[:8]}.zip")
        import zipfile
        import logging as _mlog
        _mlogger = _mlog.getLogger(__name__)
        _mlogger.info(f"[download-split] split_files keys: {list(split_files.keys())}")
        _mlogger.info(f"[download-split] individual_files: {individual_files}")
        with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
            if individual_files:
                for obj_name, file_path in individual_files.items():
                    exists = os.path.exists(file_path)
                    _mlogger.info(f"[download-split] adding {obj_name}.3mf from {file_path}, exists={exists}")
                    if exists:
                        zf.write(file_path, f"{obj_name}.3mf")
            else:
                combined = split_files.get("combined") or split_files.get("base")
                if combined and os.path.exists(combined):
                    zf.write(combined, os.path.basename(combined))

        zip_size = os.path.getsize(output_zip)
        _mlogger.info(f"[download-split] ZIP created: {output_zip}, size={zip_size} bytes")

        download_path = upload_relative_path(output_zip)
        return {"download_url": f"/api/models/download-split-file?path={download_path}"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"模型切分失败: {e}")
    finally:
        if output_dir:
            remove_dir_quietly(output_dir)


@router.get("/download-split-file")
async def download_split_file(path: str = Query(...), background_tasks: BackgroundTasks = None):
    if ".." in path:
        raise HTTPException(status_code=400, detail="Invalid path")
    try:
        resolved_path = resolve_upload_relative_path(path)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.exists(resolved_path):
        raise HTTPException(status_code=404, detail="File not found")
    response = FileResponse(
        path=resolved_path,
        filename=os.path.basename(resolved_path),
        media_type="application/zip",
    )
    if background_tasks:
        background_tasks.add_task(remove_file_quietly, resolved_path)
        response.background = background_tasks
    return response

@router.get("/download/{filename}")
async def download_model(filename: str, db: Session = Depends(get_db)):
    """Download model file and increment download count"""
    safe_name = safe_filename(filename)
    filepath = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")

    # Increment download count
    model = db.query(Model).filter(Model.file_path == safe_name).first()
    if model:
        model.downloads += 1
        db.commit()

    return FileResponse(
        path=filepath,
        filename=safe_name,
        media_type="application/octet-stream",
    )


@router.get("/file/{filename}")
async def get_model_file(filename: str):
    """Serve model file for preview/import without incrementing download count."""
    safe_name = safe_filename(filename)
    filepath = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=filepath,
        filename=safe_name,
        media_type="application/octet-stream",
    )


@router.get("/thumbnail/{filename}")
async def get_thumbnail(filename: str):
    """Serve thumbnail image"""
    safe_name = safe_filename(filename)
    filepath = os.path.join(THUMBNAIL_DIR, safe_name)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(path=filepath)


@router.get("/viewer-environment")
async def get_viewer_environment():
    viewer_environment_path = _resolve_viewer_environment_path()
    if viewer_environment_path:
        return FileResponse(path=viewer_environment_path, filename=os.path.basename(viewer_environment_path))

    viewer_environment_url = os.environ.get("MODEL_VIEWER_HDR_URL", "").strip()
    if viewer_environment_url:
        return RedirectResponse(url=viewer_environment_url, status_code=307)

    raise HTTPException(status_code=404, detail="Viewer environment asset not configured")


@router.get("/{model_id}")
async def get_model(model_id: int, current_user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    model = db.query(Model).options(joinedload(Model.owner)).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    liked = False
    if current_user:
        liked = db.query(ModelLike).filter(ModelLike.user_id == current_user.id, ModelLike.model_id == model_id).first() is not None
    return {**_model_to_response(model, db), "liked_by_current_user": liked}


@router.put("/{model_id}")
async def update_model(
    model_id: int,
    name: str = Form(...),
    description: str = Form(""),
    category: str = Form("other"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model = db.query(Model).options(joinedload(Model.owner)).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if model.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to edit this model")

    model.name = name
    model.description = description
    model.category = category

    db.commit()
    db.refresh(model)
    return _model_to_response(model, db)


@router.delete("/{model_id}")
async def delete_model(
    model_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if model.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this model")

    for table in (PrintHistory, Notification, Project):
        db.query(table).filter(table.model_id == model_id).update(
            {table.model_id: None},
            synchronize_session=False,
        )

    # Delete files
    model_file = os.path.join(UPLOAD_DIR, safe_filename(model.file_path))
    remove_file_quietly(model_file)
    if model.thumbnail_path:
        thumb_file = os.path.join(THUMBNAIL_DIR, safe_filename(model.thumbnail_path))
        remove_file_quietly(thumb_file)

    # Cascade handles likes, gcodes, comments via relationship config
    db.delete(model)
    db.commit()
    return {"message": "Model deleted successfully"}


@router.get("/{model_id}/versions")
def get_model_versions(model_id: int, db: Session = Depends(get_db)):
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")
    root_id = model.parent_model_id or model.id
    versions = db.query(Model).filter(
        (Model.id == root_id) | (Model.parent_model_id == root_id)
    ).order_by(Model.version_number.desc()).all()
    return [_model_to_response(v, db) for v in versions]


@router.post("/{model_id}/like")
async def like_model(
    model_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    # Check if already liked
    existing = db.query(ModelLike).filter(
        ModelLike.user_id == current_user.id,
        ModelLike.model_id == model_id,
    ).first()

    if existing:
        # Unlike
        db.delete(existing)
        model.likes = max(0, model.likes - 1)
        db.commit()
        return {"likes": model.likes, "liked": False}
    else:
        # Like
        db.add(ModelLike(user_id=current_user.id, model_id=model_id))
        model.likes += 1
        notify_model_owner(
            db,
            model=model,
            actor=current_user,
            type="like",
            title="模型收到点赞",
            message=f"{current_user.username} 点赞了你的模型「{model.name}」",
            link=f"/models/{model.id}",
        )
        db.commit()
        return {"likes": model.likes, "liked": True}


@router.get("/user/{user_id}")
async def get_user_models(
    user_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get all models by a specific user"""
    query = db.query(Model).options(joinedload(Model.owner)).filter(
        Model.user_id == user_id,
        Model.lifecycle_status == MODEL_STATUS_SAVED,
    )
    total = query.count()
    models = query.order_by(Model.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "total": total,
        "page": skip // limit if limit else 0,
        "page_size": limit,
        "has_next": (skip + limit) < total,
        "models": [_model_to_response(m, db) for m in models],
    }


def _model_to_response(model: Model, db: Optional[Session] = None) -> dict:
    favorites_count = None
    feedback_count = None
    rating = None
    if db is not None:
        favorites_count = db.query(ModelFavorite).filter(ModelFavorite.model_id == model.id).count()
        feedback_count = db.query(PrintFeedback).filter(PrintFeedback.model_id == model.id).count()
        avg_rating = db.query(func.avg(PrintFeedback.rating)).filter(PrintFeedback.model_id == model.id).scalar()
        rating = round(float(avg_rating), 1) if avg_rating is not None else None
    return {
        "id": model.id,
        "name": model.name,
        "description": model.description or "",
        "category": model.category or "other",
        "file_path": model.file_path,
        "thumbnail_path": model.thumbnail_path,
        "downloads": model.downloads or 0,
        "likes": model.likes or 0,
        "favorites": favorites_count if favorites_count is not None else len(model.favorited_by) if hasattr(model, "favorited_by") else 0,
        "feedback_count": feedback_count if feedback_count is not None else len(model.feedback) if hasattr(model, "feedback") else 0,
        "rating": rating,
        "user_id": model.user_id,
        "author": model.owner.username if model.owner else "Unknown",
        "created_at": model.created_at.isoformat() if model.created_at else "",
        "version_number": model.version_number if hasattr(model, 'version_number') else 1,
        "parent_model_id": model.parent_model_id if hasattr(model, 'parent_model_id') else None,
        "lifecycle_status": getattr(model, "lifecycle_status", MODEL_STATUS_SAVED) or MODEL_STATUS_SAVED,
        "retention_expires_at": model.retention_expires_at.isoformat() if getattr(model, "retention_expires_at", None) else None,
        "source_type": getattr(model, "source_type", None),
    }


class ConvertToGLBRequest(BaseModel):
    model_url: str


class DownloadAsRequest(BaseModel):
    model_url: str
    format: Literal["glb", "3mf", "original"]


async def _convert_to_glb_task(model_path: str, output_path: str):
    from app.api.gcode import _load_scene_or_mesh, _scene_to_geometry_map, _export_mesh_as_glb
    def convert() -> None:
        scene_or_mesh = _load_scene_or_mesh(model_path)
        _, merged_mesh = _scene_to_geometry_map(scene_or_mesh)
        _export_mesh_as_glb(merged_mesh, output_path)

    await run_heavy_task("GLB转换", convert)


@router.post("/convert-to-glb")
async def convert_to_glb(
    request: ConvertToGLBRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    from app.api.gcode import _resolve_model_path, _load_scene_or_mesh, _scene_to_geometry_map, _export_mesh_as_glb

    model_path = _resolve_model_path(request.model_url)
    if not os.path.exists(model_path):
        raise HTTPException(status_code=400, detail="模型文件不存在")

    glb_filename = f"glb_{uuid.uuid4().hex[:8]}.glb"
    glb_path = os.path.join(UPLOAD_DIR, glb_filename)

    file_size = os.path.getsize(model_path)

    if file_size > 10 * 1024 * 1024:
        background_tasks.add_task(_convert_to_glb_task, model_path, glb_path)
        return {
            "status": "processing",
            "glb_url": f"/api/models/download/{glb_filename}",
            "message": "大文件正在后台处理"
        }

    try:
        def convert() -> None:
            scene_or_mesh = _load_scene_or_mesh(model_path)
            _, merged_mesh = _scene_to_geometry_map(scene_or_mesh)
            _export_mesh_as_glb(merged_mesh, glb_path)

        await run_heavy_task("GLB转换", convert)

        return {
            "status": "complete",
            "glb_url": f"/api/models/download/{glb_filename}"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GLB转换失败: {e}")


class ConvertTo3MFRequest(BaseModel):
    model_url: str


@router.post("/convert-to-3mf")
async def convert_to_3mf(request: ConvertTo3MFRequest):
    from app.api.gcode import _resolve_model_path, _load_scene_or_mesh, _scene_to_geometry_map, _export_mesh_as_3mf
    import asyncio

    model_path = _resolve_model_path(request.model_url)
    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail="模型文件不存在")

    try:
        threemf_filename = f"3mf_{uuid.uuid4().hex[:8]}.3mf"
        threemf_path = os.path.join(UPLOAD_DIR, threemf_filename)

        def convert() -> None:
            scene_or_mesh = _load_scene_or_mesh(model_path)
            _, merged_mesh = _scene_to_geometry_map(scene_or_mesh)
            _export_mesh_as_3mf(merged_mesh, threemf_path, repair=False)

        await run_heavy_task("3MF转换", convert)

        return {
            "status": "complete",
            "threemf_url": f"/api/models/download/{threemf_filename}"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"3MF转换失败: {e}")
