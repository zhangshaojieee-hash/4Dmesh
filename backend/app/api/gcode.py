import os
import re
import json
import uuid
import logging as _log
import subprocess
import asyncio
import platform
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from urllib.parse import unquote, urlparse
from typing import Any, Callable, Dict, List, Optional, Tuple
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session
from app.core.file_io import remove_dir_quietly, remove_file_quietly, safe_filename, save_httpx_response_stream
from app.core.limits import heavy_task_limiter, run_heavy_task
from app.api.models import _validate_gltf_upload
from app.api.notifications import create_notification
from app.api.users import get_current_user
from app.core.database import SessionLocal, get_db
from app.core.paths import MODEL_UPLOAD_DIR, TEMP_DIR, SLICE_OUTPUT_DIR
from app.models import Process4DTask, User
from app.utils.gcode_parser import parse_gcode_statistics

router = APIRouter()
logger = _log.getLogger(__name__)

UPLOAD_DIR = MODEL_UPLOAD_DIR
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(SLICE_OUTPUT_DIR, exist_ok=True)

# 安全白名单
VALID_PRINTER_PROFILES = {"prusa_i3_mk3", "prusa_mini", "ender3", "bambu_x1c"}
VALID_QUALITY_PRESETS = {"0.10mm", "0.15mm", "0.20mm", "0.30mm"}
MAX_SURFACE_GRID_RESOLUTION = 128
MAX_SURFACE_GRID_RLE_BYTES = MAX_SURFACE_GRID_RESOLUTION ** 3 * 2

def _resolve_model_path(model_url: str) -> str:
    """
    将前端传来的 model_url 解析为实际文件路径。
    支持:
      - /api/ai/temp/xxx.3mf → uploads/temp/xxx.3mf
      - /api/models/download/xxx.3mf → uploads/models/xxx.3mf
      - 纯文件名 xxx.3mf → uploads/models/xxx.3mf
    """
    # 从 URL 路径中提取文件名
    url_path = model_url.lstrip("/")
    filename = safe_filename(os.path.basename(url_path))

    # 根据 URL 前缀判断目录
    if "ai/temp/" in url_path or "temp/" in url_path:
        path = os.path.join(TEMP_DIR, filename)
        if os.path.exists(path):
            return path

    if "models/download/" in url_path:
        path = os.path.join(UPLOAD_DIR, filename)
        if os.path.exists(path):
            return path

    # 默认：先查 temp，再查 models
    for directory in [TEMP_DIR, UPLOAD_DIR, SLICE_OUTPUT_DIR]:
        path = os.path.join(directory, filename)
        if os.path.exists(path):
            return path

    # 最后回退到 models 目录（即使不存在，让调用方报 404）
    return os.path.join(UPLOAD_DIR, filename)


class RegionData(BaseModel):
    id: str
    name: str
    meshName: str
    color: str
    strength: float = 1.0
    direction: Optional[str] = None
    faceIndices: Optional[List[int]] = None


class VolumeRegionData(BaseModel):
    """前端 VolumeRegion 的序列化格式 — 空间区域定义"""
    region_id: str
    name: str = ""
    method: str = "box"  # box | cylinder | sphere
    transform: Dict[str, Any] = {}  # {position, rotation, scale}
    tag: str = "magnetic"
    strengthId: Optional[str] = None
    direction: Optional[List[float]] = None
    z_range: Optional[Dict[str, float]] = None


class SurfacePaintGrid(BaseModel):
    bbox_min: List[float]
    bbox_max: List[float]
    resolution: int
    data_b64: str


class GridMagnetCell(BaseModel):
    # 磁场强度使用 Tesla 作为传输单位；前端可显示为 mT 或 T。
    strength: float = Field(ge=0, le=1_000_000_000)
    direction: str

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, value: str) -> str:
        if value not in {"X+", "X-", "Y+", "Y-", "Z+", "Z-"}:
            raise ValueError("网格磁场方向必须是 X+/X-/Y+/Y-/Z+/Z-")
        return value


class GridMagnetization(BaseModel):
    version: int = 1
    cellSize: float = Field(gt=0, le=1000)
    bboxMin: List[float] = Field(min_length=3, max_length=3)
    bboxMax: List[float] = Field(min_length=3, max_length=3)
    dimensions: List[int] = Field(min_length=3, max_length=3)
    activeCells: Dict[str, GridMagnetCell] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_grid(self):
        if any(value <= 0 for value in self.dimensions):
            raise ValueError("网格维度必须为正整数")
        if self.dimensions[0] * self.dimensions[1] * self.dimensions[2] > 4000:
            raise ValueError("网格单元数量不能超过 4000")
        for key in self.activeCells:
            parts = key.split(":")
            if len(parts) != 3 or any(not part.isdigit() for part in parts):
                raise ValueError("网格单元索引格式无效")
            if any(int(part) >= self.dimensions[index] for index, part in enumerate(parts)):
                raise ValueError("网格单元索引超出范围")
        return self


class SplitModelRequest(BaseModel):
    model_url: str
    regions: List[RegionData]
    output_format: str = "3mf"
    paint_data: Optional[Dict[str, Any]] = None
    volume_regions: Optional[List[VolumeRegionData]] = None
    surface_paint_grid: Optional[SurfacePaintGrid] = None


class SliceRequest(BaseModel):
    model_path: str
    printer_profile: str = "prusa_i3_mk3"
    quality: str = "0.20mm"


class GcodeProcessRequest(BaseModel):
    gcode_path: str
    regions: List[RegionData]
    mag_start_code: str = "MAG_ON"
    mag_end_code: str = "MAG_OFF"
    grid_magnetization: Optional[GridMagnetization] = None


class Process4DRequest(BaseModel):
    model_url: str
    regions: List[RegionData]
    printer_profile: str = "prusa_i3_mk3"
    quality: str = "0.20mm"
    paint_data: Optional[Dict[str, Any]] = None
    volume_regions: Optional[List[VolumeRegionData]] = None
    surface_paint_grid: Optional[SurfacePaintGrid] = None
    surface_direction: Optional[List[float]] = None
    grid_magnetization: Optional[GridMagnetization] = None


PROCESS_4D_TASK_LIMIT = 50
_PROCESS_4D_TASKS: Dict[str, Dict[str, Any]] = {}
_PROCESS_4D_TASK_LOCK = Lock()


def _queued_or_running_process_4d_tasks_locked() -> int:
    return sum(
        1 for task in _PROCESS_4D_TASKS.values()
        if task.get("status") in {"queued", "running"}
    )


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serialize_process_4d_task(task: Dict[str, Any]) -> Dict[str, Any]:
    status = task.get("status")
    return {
        "success": status not in {"failed", "cancelled"},
        "task_id": task["task_id"],
        "status": status,
        "progress": task["progress"],
        "current_stage": task.get("current_stage"),
        "message": task.get("message"),
        "logs": list(task.get("logs", [])),
        "result": task.get("result"),
        "error": task.get("error"),
        "created_at": task["created_at"],
        "updated_at": task["updated_at"],
    }


def _serialize_process_4d_task_summary(task: Dict[str, Any]) -> Dict[str, Any]:
    result = task.get("result") or {}
    return {
        "task_id": task["task_id"],
        "status": task["status"],
        "progress": task["progress"],
        "current_stage": task.get("current_stage"),
        "message": task.get("message"),
        "error": task.get("error"),
        "filename": result.get("filename"),
        "download_url": result.get("download_url"),
        "created_at": task["created_at"],
        "updated_at": task["updated_at"],
    }


def _prune_process_4d_tasks_locked() -> None:
    while len(_PROCESS_4D_TASKS) > PROCESS_4D_TASK_LIMIT:
        finished = [
            item for item in _PROCESS_4D_TASKS.items()
            if item[1].get("status") in {"succeeded", "failed", "cancelled"}
        ]
        candidates = finished or list(_PROCESS_4D_TASKS.items())
        oldest_task_id = min(candidates, key=lambda item: item[1].get("updated_at", ""))[0]
        _PROCESS_4D_TASKS.pop(oldest_task_id, None)


def _create_process_4d_task(owner_user_id: Any) -> Dict[str, Any]:
    now = _utc_now_iso()
    task_id = uuid.uuid4().hex[:12]
    task = {
        "task_id": task_id,
        "owner_user_id": owner_user_id,
        "status": "queued",
        "progress": 0,
        "current_stage": "queued",
        "message": "任务已创建，等待开始处理",
        "logs": [{
            "time": now,
            "stage": "queued",
            "status": "queued",
            "progress": 0,
            "message": "任务已创建，等待开始处理",
        }],
        "result": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }
    with _PROCESS_4D_TASK_LOCK:
        if (
            _queued_or_running_process_4d_tasks_locked()
            >= heavy_task_limiter.concurrency + heavy_task_limiter.queue_limit
        ):
            raise HTTPException(status_code=429, detail="4D处理任务繁忙，请稍后再试")
        _PROCESS_4D_TASKS[task_id] = task
        _prune_process_4d_tasks_locked()
    return task


def _update_process_4d_task(
    task_id: str,
    *,
    status: Optional[str] = None,
    progress: Optional[int] = None,
    current_stage: Optional[str] = None,
    message: Optional[str] = None,
    result: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
) -> None:
    now = _utc_now_iso()
    with _PROCESS_4D_TASK_LOCK:
        task = _PROCESS_4D_TASKS.get(task_id)
        if not task:
            return
        if status is not None:
            task["status"] = status
        if progress is not None:
            task["progress"] = max(0, min(100, int(progress)))
        if current_stage is not None:
            task["current_stage"] = current_stage
        if message is not None:
            task["message"] = message
            logs = task.setdefault("logs", [])
            logs.append({
                "time": now,
                "stage": task.get("current_stage"),
                "status": task.get("status"),
                "progress": task.get("progress"),
                "message": message,
            })
            if len(logs) > 200:
                del logs[:-200]
        if result is not None:
            task["result"] = result
        if error is not None:
            task["error"] = error
        task["updated_at"] = now


def _http_exception_detail(exc: HTTPException) -> str:
    if isinstance(exc.detail, str):
        return exc.detail
    return json.dumps(exc.detail, ensure_ascii=False)


def _process_task_now() -> datetime:
    return datetime.now(timezone.utc)


def _process_task_dt(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value)


def _process_4d_task_to_dict(task: Process4DTask) -> Dict[str, Any]:
    return {
        "task_id": task.task_id,
        "owner_user_id": str(task.user_id),
        "user_id": task.user_id,
        "status": task.status,
        "progress": task.progress,
        "current_stage": task.current_stage,
        "message": task.message,
        "logs": list(task.logs or []),
        "result": task.result,
        "error": task.error,
        "created_at": _process_task_dt(task.created_at),
        "updated_at": _process_task_dt(task.updated_at),
    }


def _queued_or_running_process_4d_tasks_locked() -> int:
    db = SessionLocal()
    try:
        return db.query(Process4DTask).filter(Process4DTask.status.in_(["queued", "running"])).count()
    finally:
        db.close()


def _serialize_process_4d_task(task: Dict[str, Any] | Process4DTask) -> Dict[str, Any]:
    data = _process_4d_task_to_dict(task) if isinstance(task, Process4DTask) else task
    status = data.get("status")
    return {
        "success": status not in {"failed", "cancelled"},
        "task_id": data["task_id"],
        "status": status,
        "progress": data.get("progress", 0),
        "current_stage": data.get("current_stage"),
        "message": data.get("message"),
        "logs": list(data.get("logs") or []),
        "result": data.get("result"),
        "error": data.get("error"),
        "created_at": data.get("created_at"),
        "updated_at": data.get("updated_at"),
    }


def _serialize_process_4d_task_summary(task: Dict[str, Any] | Process4DTask) -> Dict[str, Any]:
    data = _process_4d_task_to_dict(task) if isinstance(task, Process4DTask) else task
    result = data.get("result") or {}
    return {
        "task_id": data["task_id"],
        "status": data.get("status"),
        "progress": data.get("progress", 0),
        "current_stage": data.get("current_stage"),
        "message": data.get("message"),
        "error": data.get("error"),
        "filename": result.get("filename"),
        "download_url": result.get("download_url"),
        "created_at": data.get("created_at"),
        "updated_at": data.get("updated_at"),
    }


def _prune_process_4d_tasks_locked() -> None:
    db = SessionLocal()
    try:
        total = db.query(Process4DTask).count()
        if total <= PROCESS_4D_TASK_LIMIT:
            return
        removable = (
            db.query(Process4DTask)
            .filter(Process4DTask.status.in_(["succeeded", "failed", "cancelled"]))
            .order_by(Process4DTask.updated_at.asc())
            .limit(total - PROCESS_4D_TASK_LIMIT)
            .all()
        )
        if not removable:
            removable = (
                db.query(Process4DTask)
                .order_by(Process4DTask.updated_at.asc())
                .limit(total - PROCESS_4D_TASK_LIMIT)
                .all()
            )
        for row in removable:
            db.delete(row)
        db.commit()
    finally:
        db.close()


def _create_process_4d_task(owner_user_id: Any) -> Dict[str, Any]:
    try:
        user_id = int(owner_user_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Authentication required")

    now = _process_task_now()
    task_id = uuid.uuid4().hex[:12]
    with _PROCESS_4D_TASK_LOCK:
        if (
            _queued_or_running_process_4d_tasks_locked()
            >= heavy_task_limiter.concurrency + heavy_task_limiter.queue_limit
        ):
            raise HTTPException(status_code=429, detail="4D processing queue is busy, please try again later")

        db = SessionLocal()
        try:
            task = Process4DTask(
                task_id=task_id,
                user_id=user_id,
                status="queued",
                progress=0,
                current_stage="queued",
                message="4D processing task queued",
                logs=[{
                    "time": now.isoformat(),
                    "stage": "queued",
                    "status": "queued",
                    "progress": 0,
                    "message": "4D processing task queued",
                }],
                created_at=now,
                updated_at=now,
            )
            db.add(task)
            db.commit()
            db.refresh(task)
            data = _process_4d_task_to_dict(task)
        finally:
            db.close()
        _prune_process_4d_tasks_locked()
    return data


def _update_process_4d_task(
    task_id: str,
    *,
    status: Optional[str] = None,
    progress: Optional[int] = None,
    current_stage: Optional[str] = None,
    message: Optional[str] = None,
    result: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
) -> None:
    now = _process_task_now()
    db = SessionLocal()
    try:
        task = db.query(Process4DTask).filter(Process4DTask.task_id == task_id).first()
        if not task:
            return
        if status is not None:
            task.status = status
        if progress is not None:
            task.progress = max(0, min(100, int(progress)))
        if current_stage is not None:
            task.current_stage = current_stage
        if message is not None:
            task.message = message
            logs = list(task.logs or [])
            logs.append({
                "time": now.isoformat(),
                "stage": task.current_stage,
                "status": task.status,
                "progress": task.progress,
                "message": message,
            })
            task.logs = logs[-200:]
        if result is not None:
            task.result = result
        if error is not None:
            task.error = error
        task.updated_at = now
        db.commit()
    finally:
        db.close()


def _notify_process_4d_task_done(task_id: str, success: bool) -> None:
    db = SessionLocal()
    try:
        task = db.query(Process4DTask).filter(Process4DTask.task_id == task_id).first()
        if not task:
            return
        create_notification(
            db,
            user_id=task.user_id,
            type="process_4d_succeeded" if success else "process_4d_failed",
            title="4D task completed" if success else "4D task failed",
            message=task.message or ("Your 4D processing task is ready." if success else "Your 4D processing task failed."),
            link=f"/projects?tab=tasks&task={task.task_id}",
            commit=True,
        )
    except Exception:
        logger.debug("Unable to create 4D task notification", exc_info=True)
    finally:
        db.close()


def _is_process_4d_task_cancelled(task_id: str) -> bool:
    db = SessionLocal()
    try:
        task = db.query(Process4DTask.status).filter(Process4DTask.task_id == task_id).first()
        return bool(task and task.status == "cancelled")
    finally:
        db.close()


ProgressCallback = Callable[[str, int, str], None]


def _emit_progress(progress_callback: Optional[ProgressCallback], stage: str, progress: int, message: str) -> None:
    if progress_callback:
        progress_callback(stage, progress, message)


def _release_process_4d_request_payload(request: Process4DRequest) -> None:
    for attr, value in (
        ("regions", []),
        ("paint_data", None),
        ("volume_regions", None),
        ("surface_paint_grid", None),
        ("surface_direction", None),
    ):
        try:
            setattr(request, attr, value)
        except Exception:
            logger.debug("Unable to clear Process4DRequest.%s", attr, exc_info=True)


def _release_process_memory() -> None:
    import gc

    gc.collect()
    if platform.system() != "Linux":
        return
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        _log.getLogger(__name__).debug("malloc_trim unavailable", exc_info=True)


def _read_meminfo_kb() -> Dict[str, int]:
    if platform.system() != "Linux":
        return {}
    values: Dict[str, int] = {}
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as meminfo:
            for line in meminfo:
                parts = line.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    values[parts[0].rstrip(":")] = int(parts[1])
    except OSError:
        return {}
    return values


def _decode_surface_grid_rle(data_b64: str, resolution: int):
    import base64
    import binascii
    import numpy as np

    if resolution <= 0 or resolution > MAX_SURFACE_GRID_RESOLUTION:
        raise ValueError(f"surface paint grid resolution must be between 1 and {MAX_SURFACE_GRID_RESOLUTION}")

    try:
        rle_bytes = base64.b64decode(data_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("surface paint grid data is not valid base64") from exc

    if len(rle_bytes) > MAX_SURFACE_GRID_RLE_BYTES:
        raise ValueError("surface paint grid RLE payload is too large")

    expected = resolution ** 3
    flat = bytearray(expected)
    pos = 0
    i = 0
    while i < len(rle_bytes) - 1 and pos < expected:
        value = int(rle_bytes[i])
        count = min(int(rle_bytes[i + 1]), expected - pos)
        if count > 0:
            flat[pos:pos + count] = bytes((value,)) * count
            pos += count
        i += 2

    return np.frombuffer(flat, dtype=np.uint8).reshape(
        (resolution, resolution, resolution),
        order="F",
    )


def _get_slicing_face_limit() -> int:
    env_value = os.environ.get("GCODE_SLICE_MAX_FACES")
    if env_value:
        try:
            return max(20_000, int(env_value))
        except ValueError:
            logger.warning("Invalid GCODE_SLICE_MAX_FACES=%s, using automatic limit", env_value)

    meminfo = _read_meminfo_kb()
    mem_total_mb = int(meminfo.get("MemTotal", 0) / 1024)
    if not mem_total_mb:
        return 180_000
    if mem_total_mb <= 2_500:
        limit = 30_000
    elif mem_total_mb <= 4_500:
        limit = 180_000
    else:
        limit = 600_000
    logger.info("Using slicing face limit %s for MemTotal=%sMB", limit, mem_total_mb)
    return limit


def _get_printer_bed_center(printer: str) -> str:
    bed_center = "125,105"
    try:
        ini_path = os.path.join("configs", f"{printer}.ini")
        if os.path.exists(ini_path):
            with open(ini_path, "r", encoding="utf-8") as ini_f:
                for ini_line in ini_f:
                    if ini_line.strip().startswith("bed_shape"):
                        parts = ini_line.split("=", 1)[1].strip().split(",")
                        xs = []
                        ys = []
                        for pt in parts:
                            xy = pt.strip().split("x")
                            if len(xy) == 2:
                                xs.append(float(xy[0]))
                                ys.append(float(xy[1]))
                        if xs and ys:
                            cx = (min(xs) + max(xs)) / 2
                            cy = (min(ys) + max(ys)) / 2
                            bed_center = f"{cx:.0f},{cy:.0f}"
                        break
    except Exception:
        logger.debug("Unable to parse printer bed center for %s", printer, exc_info=True)
    return bed_center


def _parse_bed_center_tuple(bed_center: str) -> Tuple[float, float]:
    try:
        x_value, y_value = bed_center.split(",", 1)
        return float(x_value), float(y_value)
    except (ValueError, TypeError):
        return (125.0, 105.0)


def _cluster_simplify_mesh(mesh, target_faces: int):
    import math
    import numpy as np
    import trimesh

    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if len(faces) <= target_faces or len(vertices) == 0:
        return mesh

    bounds = np.asarray(mesh.bounds, dtype=np.float64)
    extents = bounds[1] - bounds[0]
    max_dim = float(np.max(extents))
    if not np.isfinite(max_dim) or max_dim <= 0:
        return mesh

    divisions = max(24, int(math.sqrt(max(target_faces, 1) / 4.0)))
    best_mesh = None
    best_face_count = len(faces)

    for _attempt in range(6):
        cell_size = max_dim / max(divisions, 1)
        if cell_size <= 0:
            break

        quantized = np.floor((vertices - bounds[0]) / cell_size).astype(np.int64)
        _unique_q, inverse = np.unique(quantized, axis=0, return_inverse=True)
        cluster_count = int(inverse.max()) + 1 if len(inverse) else 0
        if cluster_count == 0:
            break

        counts = np.bincount(inverse, minlength=cluster_count).astype(np.float64)
        new_vertices = np.empty((cluster_count, 3), dtype=np.float64)
        for axis in range(3):
            new_vertices[:, axis] = np.bincount(
                inverse,
                weights=vertices[:, axis],
                minlength=cluster_count,
            ) / np.maximum(counts, 1.0)

        new_faces = inverse[faces]
        valid = (
            (new_faces[:, 0] != new_faces[:, 1])
            & (new_faces[:, 1] != new_faces[:, 2])
            & (new_faces[:, 0] != new_faces[:, 2])
        )
        new_faces = new_faces[valid]
        if len(new_faces) == 0:
            break

        canonical_faces = np.sort(new_faces, axis=1)
        _unique_faces, unique_indices = np.unique(canonical_faces, axis=0, return_index=True)
        new_faces = new_faces[np.sort(unique_indices)]
        referenced, remapped = np.unique(new_faces.reshape(-1), return_inverse=True)
        simplified = trimesh.Trimesh(
            vertices=new_vertices[referenced],
            faces=remapped.reshape((-1, 3)),
            process=False,
        )
        face_count = len(simplified.faces)
        if best_mesh is None or abs(face_count - target_faces) < abs(best_face_count - target_faces):
            best_mesh = simplified
            best_face_count = face_count
        if face_count <= target_faces:
            return simplified
        scale = max(0.35, min(0.9, math.sqrt(target_faces / max(face_count, 1)) * 0.9))
        divisions = max(12, int(divisions * scale))

    return best_mesh if best_mesh is not None else mesh


def _mesh_face_count(mesh) -> int:
    faces = getattr(mesh, "faces", None)
    return int(len(faces)) if faces is not None else 0


def _simplify_mesh_for_slicing(mesh, max_faces: Optional[int] = None):
    import trimesh

    face_count = _mesh_face_count(mesh)
    if max_faces is None or face_count <= max_faces:
        return mesh

    logger.info("Simplifying mesh before slicing: %s faces -> target %s", face_count, max_faces)
    try:
        simplified = mesh.simplify_quadric_decimation(face_count=max_faces)
        if simplified is not None and len(simplified.faces) > 0:
            logger.info("Quadric simplification complete: %s faces", len(simplified.faces))
            return simplified
    except Exception as exc:
        logger.warning("Quadric simplification unavailable, using vertex clustering: %s", exc)

    simplified = _cluster_simplify_mesh(mesh, max_faces)
    if simplified is not mesh:
        try:
            trimesh.repair.fix_normals(simplified)
        except Exception:
            logger.debug("Unable to repair simplified mesh normals", exc_info=True)
        logger.info("Vertex clustering simplification complete: %s faces", len(simplified.faces))
    return simplified


def _flatten_to_mesh(scene_or_mesh, repair: bool = True):
    import trimesh
    if isinstance(scene_or_mesh, trimesh.Scene):
        geos = [
            geo for geo in scene_or_mesh.dump(concatenate=False)
            if hasattr(geo, "faces") and hasattr(geo, "vertices")
        ]
        if not geos:
            raise ValueError("模型中没有有效的几何体")
        mesh = trimesh.util.concatenate(geos) if len(geos) > 1 else geos[0]
    else:
        mesh = scene_or_mesh
    if repair and hasattr(mesh, 'merge_vertices'):
        mesh.merge_vertices()
    if repair and hasattr(mesh, 'fix_normals'):
        mesh.fix_normals()
    return mesh


def _auto_scale_to_mm(mesh, target_max_mm: float = 200.0) -> float:
    extents = mesh.extents
    max_dim = max(extents) if len(extents) else 0
    if max_dim < 0.001:
        return 1.0
    if max_dim < 1.0:
        scaled = max_dim * 1000.0
        if scaled > target_max_mm:
            return target_max_mm / max_dim
        return 1000.0
    if max_dim > target_max_mm:
        return target_max_mm / max_dim
    return 1.0


def _compute_3mf_export_transform(mesh, auto_scale: bool = True) -> Dict[str, Any]:
    import numpy as np

    scale = _auto_scale_to_mm(mesh) if auto_scale else 1.0
    bounds = np.asarray(mesh.bounds, dtype=np.float64)
    if bounds.shape != (2, 3):
        raise HTTPException(status_code=400, detail="模型边界无效，无法导出 3MF")
    scaled_bounds = bounds * scale
    center = (scaled_bounds[1] + scaled_bounds[0]) / 2.0
    z_min = float(scaled_bounds[0][2])
    return {
        "scale": float(scale),
        "center_xy": [float(center[0]), float(center[1])],
        "z_min": z_min,
    }


def _apply_3mf_export_transform(mesh, transform: Dict[str, Any]):
    import numpy as np

    scale = float(transform.get("scale", 1.0))
    center_xy = transform.get("center_xy", [0.0, 0.0])
    z_min = float(transform.get("z_min", 0.0))
    verts = np.asarray(mesh.vertices, dtype=np.float64) * scale
    verts[:, 0] -= float(center_xy[0])
    verts[:, 1] -= float(center_xy[1])
    verts[:, 2] -= z_min
    return verts


_TEXT_BATCH_CHAR_LIMIT = 1 << 20


def _write_utf8(file_obj, text: str) -> None:
    file_obj.write(text.encode("utf-8"))


def _write_batched_utf8(file_obj, pieces) -> None:
    buffer: List[str] = []
    char_count = 0
    for piece in pieces:
        buffer.append(piece)
        char_count += len(piece)
        if char_count >= _TEXT_BATCH_CHAR_LIMIT:
            _write_utf8(file_obj, "".join(buffer))
            buffer.clear()
            char_count = 0
    if buffer:
        _write_utf8(file_obj, "".join(buffer))


def _iter_3mf_vertices(mesh, scale: float, center_xy: List[float], z_min: float):
    center_x = float(center_xy[0])
    center_y = float(center_xy[1])
    for vertex in mesh.vertices:
        x = (float(vertex[0]) * scale) - center_x
        y = (float(vertex[1]) * scale) - center_y
        z = (float(vertex[2]) * scale) - z_min
        yield f'          <vertex x="{x:.6f}" y="{y:.6f}" z="{z:.6f}" />\n'


def _iter_3mf_triangles(mesh):
    for face in mesh.faces:
        yield f'          <triangle v1="{int(face[0])}" v2="{int(face[1])}" v3="{int(face[2])}" />\n'


def _write_3mf_package_parts(zf, write_model_xml) -> None:
    rels_xml = '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>'''

    content_types_xml = '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>'''

    zf.writestr("[Content_Types].xml", content_types_xml)
    zf.writestr("_rels/.rels", rels_xml)
    with zf.open("3D/3dmodel.model", "w") as model_file:
        write_model_xml(model_file)


def _export_mesh_as_3mf(scene_or_mesh, output_path: str, auto_scale: bool = True, repair: bool = True) -> Dict[str, Any]:
    import zipfile

    mesh = _flatten_to_mesh(scene_or_mesh, repair=repair)

    export_transform = _compute_3mf_export_transform(mesh, auto_scale=auto_scale)
    scale = float(export_transform["scale"])
    center_xy = export_transform["center_xy"]
    z_min = float(export_transform["z_min"])

    def write_model_xml(model_file) -> None:
        _write_utf8(
            model_file,
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
            '  <resources>\n'
            '    <object id="1" type="model">\n'
            '      <mesh>\n'
            '        <vertices>\n',
        )
        _write_batched_utf8(model_file, _iter_3mf_vertices(mesh, scale, center_xy, z_min))
        _write_utf8(
            model_file,
            '        </vertices>\n'
            '        <triangles>\n',
        )
        _write_batched_utf8(model_file, _iter_3mf_triangles(mesh))
        _write_utf8(
            model_file,
            '        </triangles>\n'
            '      </mesh>\n'
            '    </object>\n'
            '  </resources>\n'
            '  <build>\n'
            '    <item objectid="1" />\n'
            '  </build>\n'
            '</model>',
        )

    try:
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            _write_3mf_package_parts(zf, write_model_xml)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"3MF写入失败: {exc}") from exc

    return export_transform


def _export_multi_object_3mf(named_meshes: Dict[str, "Any"], output_path: str, auto_scale: bool = True):
    """Export multiple named meshes into a single 3MF with shared coordinate system.

    All meshes are scaled/centered together so relative positions are preserved.
    PrusaSlicer treats each <object> as a separate print object and emits
    ``; printing object <name>`` comments in the G-code.
    """
    import zipfile
    import numpy as np
    from xml.sax.saxutils import escape

    if not named_meshes:
        raise HTTPException(status_code=500, detail="No meshes to export into 3MF")

    meshes: Dict[str, "Any"] = {n: _flatten_to_mesh(m) for n, m in named_meshes.items()}

    _logger = _log.getLogger(__name__)
    for name, m in list(meshes.items()):
        v, f = m.vertices, m.faces
        if len(v) == 0 or len(f) == 0:
            _logger.warning(f"Skipping empty mesh object: {name}")
            del meshes[name]
            continue
        if np.any(np.isnan(v)) or np.any(np.isinf(v)):
            _logger.warning(f"Mesh {name} has NaN/Inf vertices, cleaning")
            valid_mask = ~np.any(np.isnan(v) | np.isinf(v), axis=1)
            if not np.all(valid_mask):
                del meshes[name]
                continue
        if np.any(f >= len(v)) or np.any(f < 0):
            _logger.warning(f"Mesh {name} has out-of-range face indices, skipping")
            del meshes[name]
            continue
        _logger.info(f"3MF object '{name}': {len(v)} verts, {len(f)} faces, "
                     f"bounds=[{v.min(axis=0)}, {v.max(axis=0)}]")

    if not meshes:
        raise HTTPException(status_code=500, detail="No valid meshes to export into 3MF")

    min_corner = np.min([m.bounds[0] for m in meshes.values()], axis=0)
    max_corner = np.max([m.bounds[1] for m in meshes.values()], axis=0)
    extents = max_corner - min_corner
    max_dim = float(max(extents)) if len(extents) else 0.0

    if auto_scale:
        target_max_mm = 200.0
        if max_dim < 0.001:
            scale = 1.0
        elif max_dim < 1.0:
            scaled = max_dim * 1000.0
            scale = (target_max_mm / max_dim) if scaled > target_max_mm else 1000.0
        elif max_dim > target_max_mm:
            scale = target_max_mm / max_dim
        else:
            scale = 1.0
    else:
        scale = 1.0

    scaled_min = min_corner * scale
    scaled_max = max_corner * scale
    center_xy = ((scaled_max[:2] + scaled_min[:2]) / 2.0).tolist()
    z_min = float(scaled_min[2])

    def write_model_xml(model_file) -> None:
        _write_utf8(
            model_file,
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
            '  <resources>\n',
        )

        build_items: List[str] = []
        for obj_id, (name, mesh) in enumerate(meshes.items(), start=1):
            safe_name = escape(str(name), {'"': '&quot;'})
            _write_utf8(
                model_file,
                f'    <object id="{obj_id}" name="{safe_name}" type="model">\n'
                '      <mesh>\n'
                '        <vertices>\n',
            )
            _write_batched_utf8(model_file, _iter_3mf_vertices(mesh, scale, center_xy, z_min))
            _write_utf8(
                model_file,
                '        </vertices>\n'
                '        <triangles>\n',
            )
            _write_batched_utf8(model_file, _iter_3mf_triangles(mesh))
            _write_utf8(
                model_file,
                '        </triangles>\n'
                '      </mesh>\n'
                '    </object>\n',
            )
            build_items.append(f'    <item objectid="{obj_id}" />\n')

        _write_utf8(
            model_file,
            '  </resources>\n'
            '  <build>\n',
        )
        _write_batched_utf8(model_file, build_items)
        _write_utf8(
            model_file,
            '  </build>\n'
            '</model>',
        )

    try:
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            _write_3mf_package_parts(zf, write_model_xml)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"3MF写入失败: {exc}") from exc


def _export_mesh_as_glb(mesh, output_path: str):
    try:
        mesh.export(output_path, file_type="glb")
    except (OSError, ValueError, AttributeError) as exc:
        raise HTTPException(
            status_code=500,
            detail=f"无法导出 GLB 文件: {exc}",
        ) from exc
    except Exception as exc:
        raise


def _resolve_gltf_sidecar_path(model_path: str, uri: str) -> str:
    decoded_uri = unquote(uri)
    parsed = urlparse(decoded_uri)
    normalized_path = decoded_uri.replace("\\", "/")

    if parsed.scheme and parsed.scheme not in {"", "file"}:
        raise HTTPException(
            status_code=400,
            detail=f".gltf 引用了不支持的外部资源 URI: {uri}。仅支持同目录下的本地 sidecar 文件。",
        )
    if parsed.netloc:
        raise HTTPException(
            status_code=400,
            detail=f".gltf 引用了无法解析的外部资源 URI: {uri}。请改用 .glb 或内嵌 data URI。",
        )
    if normalized_path.startswith("/") or normalized_path.startswith("../") or "/../" in normalized_path:
        raise HTTPException(
            status_code=400,
            detail=f".gltf 引用了越界路径 sidecar: {uri}。仅支持模型同目录下的直接文件名。",
        )

    sidecar_name = os.path.basename(normalized_path)
    if sidecar_name != normalized_path or not sidecar_name.strip():
        raise HTTPException(
            status_code=400,
            detail=f".gltf sidecar 路径无效: {uri}。仅支持模型同目录下的直接文件名。",
        )

    sidecar_path = os.path.join(os.path.dirname(model_path), sidecar_name)
    if not os.path.exists(sidecar_path):
        raise HTTPException(
            status_code=400,
            detail=f".gltf 缺少必需的外部资源文件: {sidecar_name}。请补齐 sidecar 文件，或改用 .glb / data URI 内嵌资源。",
        )
    return sidecar_path


def _load_scene_or_mesh(model_path: str, *, skip_materials: bool = False):
    try:
        import trimesh
        from trimesh.resolvers import FilePathResolver
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="缺少 trimesh，无法处理 3D 模型") from exc

    ext = os.path.splitext(model_path)[1].lower()
    load_kwargs = {}

    if ext == ".gltf":
        with open(model_path, "rb") as fh:
            content = fh.read()
        try:
            _validate_gltf_upload(content)
        except HTTPException as upload_error:
            if ".gltf 文件" in str(upload_error.detail):
                raise
        payload = json.loads(content.decode("utf-8"))
        for collection_name in ("images", "buffers"):
            for item in payload.get(collection_name, []):
                if not isinstance(item, dict):
                    continue
                uri = item.get("uri")
                if isinstance(uri, str) and uri and not uri.startswith("data:"):
                    _resolve_gltf_sidecar_path(model_path, uri)
        load_kwargs["resolver"] = FilePathResolver(os.path.dirname(model_path) or ".")
    if skip_materials and ext in {".glb", ".gltf"}:
        load_kwargs["skip_materials"] = True

    try:
        return trimesh.load(model_path, **load_kwargs)
    except HTTPException:
        raise
    except (ImportError, OSError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=f"无法加载模型 {os.path.basename(model_path)}: {exc}") from exc
    except Exception as exc:
        raise


def _scene_to_geometry_map(scene_or_mesh):
    import trimesh

    if isinstance(scene_or_mesh, trimesh.Scene):
        geometry_map: Dict[str, Any] = {}

        try:
            for node_name in scene_or_mesh.graph.nodes_geometry:
                transform, geometry_name = scene_or_mesh.graph[node_name]
                geometry = scene_or_mesh.geometry.get(geometry_name)
                if geometry is None or not hasattr(geometry, "faces") or not hasattr(geometry, "vertices"):
                    continue
                mesh = geometry.copy()
                mesh.apply_transform(transform)
                key = str(geometry_name)
                if key in geometry_map:
                    key = str(node_name)
                if key in geometry_map:
                    key = f"{geometry_name}_{node_name}"
                geometry_map[key] = mesh
        except Exception as exc:
            _log.getLogger(__name__).warning("Scene graph transform bake failed, falling back to dump(): %s", exc)
            geometry_map = {}

        if not geometry_map:
            dumped = [
                geo for geo in scene_or_mesh.dump(concatenate=False)
                if hasattr(geo, "faces") and hasattr(geo, "vertices")
            ]
            geometry_map = {f"mesh_{idx}": geo for idx, geo in enumerate(dumped)}

        if not geometry_map:
            raise HTTPException(status_code=400, detail="场景中没有可处理的网格几何体")
        merged_mesh = trimesh.util.concatenate(list(geometry_map.values()))
        return geometry_map, merged_mesh

    if hasattr(scene_or_mesh, "faces") and hasattr(scene_or_mesh, "vertices"):
        return {"mesh_0": scene_or_mesh}, scene_or_mesh

    raise HTTPException(status_code=400, detail="模型不是可处理的网格或场景")


def _normalize_model_for_processing(
    model_path: str,
    output_dir: str,
    preferred_format: str = "3mf",
    max_faces: Optional[int] = None,
) -> str:
    source_ext = os.path.splitext(model_path)[1].lower()
    if source_ext in {".3mf", ".stl", ".obj", ".step", ".stp"} and max_faces is None:
        return model_path

    scene_or_mesh = _load_scene_or_mesh(model_path, skip_materials=True)
    geometry_map, merged_mesh = _scene_to_geometry_map(scene_or_mesh)
    scene_or_mesh = None
    geometry_map = None
    _release_process_memory()
    if max_faces is not None:
        merged_mesh = _simplify_mesh_for_slicing(merged_mesh, max_faces=max_faces)
    normalized_ext = ".3mf" if preferred_format == "3mf" else ".stl"
    normalized_path = os.path.join(output_dir, f"normalized_{uuid.uuid4().hex[:8]}{normalized_ext}")
    if normalized_ext == ".3mf":
        _export_mesh_as_3mf(merged_mesh, normalized_path, repair=False)
    else:
        merged_mesh.export(normalized_path, file_type="stl")
    merged_mesh = None
    _release_process_memory()
    return normalized_path


def _prepare_model_for_slicing(model_path: str, output_dir: str) -> str:
    ext = os.path.splitext(model_path)[1].lower()
    if ext in {".step", ".stp", ".svg", ".amf"}:
        return model_path
    if ext == ".3mf" and os.path.basename(model_path).endswith("_continuous.3mf"):
        return model_path
    max_faces = _get_slicing_face_limit()
    if ext in {".stl", ".obj", ".3mf"}:
        try:
            scene_or_mesh = _load_scene_or_mesh(model_path)
            _geometry_map, merged_mesh = _scene_to_geometry_map(scene_or_mesh)
            face_count = _mesh_face_count(merged_mesh)
            scene_or_mesh = None
            _geometry_map = None
            merged_mesh = None
            _release_process_memory()
            if face_count <= max_faces:
                return model_path
        except HTTPException:
            logger.warning("Unable to inspect model before slicing, using original file", exc_info=True)
            return model_path
        except Exception as exc:
            logger.warning("Unable to inspect model before slicing, using original file: %s", exc)
            return model_path
    preferred_format = "stl" if ext in {".stl", ".obj", ".3mf"} else "3mf"
    return _normalize_model_for_processing(
        model_path,
        output_dir,
        preferred_format=preferred_format,
        max_faces=max_faces,
    )


def _map_strength_to_value(strength_name: str) -> int:
    strength_map = {
        "strong": 100,
        "medium": 50,
        "weak": 25,
        "none": 0,
    }
    return strength_map.get(strength_name.lower(), 0)


def _normalize_strength_name(strength: Any) -> str:
    if strength is None:
        return "none"
    if isinstance(strength, (int, float)):
        value = float(strength)
        if value >= 0.75:
            return "strong"
        if value >= 0.4:
            return "medium"
        if value > 0:
            return "weak"
        return "none"

    value = str(strength).strip().lower()
    mapping = {
        "magstrong": "strong",
        "magmedium": "medium",
        "magweak": "weak",
        "unmag": "none",
        "strong": "strong",
        "medium": "medium",
        "weak": "weak",
        "none": "none",
        "off": "none",
        "0": "none",
    }
    return mapping.get(value, "none")


def _normalize_direction(direction: Any) -> Optional[str]:
    if direction is None:
        return None
    if isinstance(direction, str):
        value = direction.strip().upper().replace(" ", "")
        aliases = {
            "X": "X+",
            "+X": "X+",
            "XP": "X+",
            "X+": "X+",
            "-X": "X-",
            "XN": "X-",
            "X-": "X-",
            "Y": "Y+",
            "+Y": "Y+",
            "YP": "Y+",
            "Y+": "Y+",
            "-Y": "Y-",
            "YN": "Y-",
            "Y-": "Y-",
            "Z": "Z+",
            "+Z": "Z+",
            "ZP": "Z+",
            "Z+": "Z+",
            "-Z": "Z-",
            "ZN": "Z-",
            "Z-": "Z-",
        }
        return aliases.get(value)
    if isinstance(direction, (list, tuple)) and len(direction) >= 3:
        try:
            values = [float(direction[0]), float(direction[1]), float(direction[2])]
        except (TypeError, ValueError):
            return None
        max_index = max(range(3), key=lambda idx: abs(values[idx]))
        if abs(values[max_index]) <= _GCODE_EPSILON:
            return None
        axis = ("X", "Y", "Z")[max_index]
        sign = "+" if values[max_index] >= 0 else "-"
        return f"{axis}{sign}"
    return None


def _build_face_direction_map(
    source_mesh: Any,
    regions: Optional[List[RegionData]] = None,
) -> Dict[int, str]:
    faces = getattr(source_mesh, "faces", None)
    if faces is None or not regions:
        return {}

    face_count = len(faces)
    face_direction_map: Dict[int, str] = {}
    for region in regions:
        if _normalize_strength_name(region.strength) == "none":
            continue
        direction = _normalize_direction(region.direction)
        if not direction:
            continue
        for idx in region.faceIndices or []:
            if isinstance(idx, int) and 0 <= idx < face_count:
                face_direction_map[idx] = direction
    return face_direction_map


def _build_face_strength_map(
    source_mesh: Any,
    regions: Optional[List[RegionData]] = None,
    paint_data: Optional[Dict[str, Any]] = None,
) -> Dict[int, str]:
    faces = getattr(source_mesh, "faces", None)
    if faces is None:
        return {}

    face_count = len(faces)
    face_strength_map: Dict[int, str] = {}
    strength_order = ["strong", "medium", "weak"]

    if paint_data:
        for strength_map in paint_data.values():
            if not isinstance(strength_map, dict):
                continue
            for strength in strength_order:
                face_indices = strength_map.get(strength) or []
                if not isinstance(face_indices, list):
                    continue
                normalized_strength = _normalize_strength_name(strength)
                for idx in face_indices:
                    if isinstance(idx, int) and 0 <= idx < face_count:
                        face_strength_map[idx] = normalized_strength

    if regions:
        for region in regions:
            face_indices = region.faceIndices or []
            if not face_indices:
                continue
            region_strength = _normalize_strength_name(region.strength)
            if region_strength == "none":
                continue
            for idx in face_indices:
                if isinstance(idx, int) and 0 <= idx < face_count:
                    face_strength_map[idx] = region_strength

    return face_strength_map


class MagneticRegionEvaluator:
    def __init__(
        self,
        source_mesh: Optional[Any] = None,
        face_strength_map: Optional[Dict[int, str]] = None,
        face_direction_map: Optional[Dict[int, str]] = None,
        volume_regions: Optional[List[Dict[str, Any]]] = None,
        surface_paint_grid: Optional[Dict[str, Any]] = None,
        surface_direction: Optional[Any] = None,
        grid_magnetization: Optional[Dict[str, Any]] = None,
    ):
        import numpy as np

        self.source_mesh = None
        self.face_strength_map = face_strength_map or {}
        self.face_direction_map = face_direction_map or {}
        self.face_centroids = None
        self.face_lookup_tree = None
        if source_mesh is not None and (self.face_strength_map or self.face_direction_map):
            centroids = getattr(source_mesh, "triangles_center", None)
            if centroids is not None:
                self.face_centroids = np.asarray(centroids, dtype=np.float64)
                try:
                    from scipy.spatial import cKDTree
                    self.face_lookup_tree = cKDTree(self.face_centroids)
                except Exception:
                    _log.getLogger(__name__).warning("Unable to build face centroid KDTree; using chunked nearest-face lookup", exc_info=True)

        self.volume_regions = self._prepare_volume_regions(volume_regions or [])
        self.surface_grid = self._decode_surface_paint_grid(surface_paint_grid)
        self.surface_direction = _normalize_direction(surface_direction)
        self.grid_magnetization = self._prepare_grid_magnetization(grid_magnetization)

    @staticmethod
    def _prepare_grid_magnetization(grid: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not grid:
            return None
        try:
            dimensions = tuple(int(value) for value in grid["dimensions"])
            bbox_min = tuple(float(value) for value in grid["bboxMin"])
            bbox_max = tuple(float(value) for value in grid["bboxMax"])
            cell_size = float(grid["cellSize"])
            active_cells = grid.get("activeCells") or {}
            if len(dimensions) != 3 or len(bbox_min) != 3 or len(bbox_max) != 3 or cell_size <= 0:
                return None
            return {
                "dimensions": dimensions,
                "bbox_min": bbox_min,
                "bbox_max": bbox_max,
                "cell_size": cell_size,
                "active_cells": active_cells,
            }
        except (KeyError, TypeError, ValueError):
            _log.getLogger(__name__).warning("Invalid grid magnetization metadata", exc_info=True)
            return None

    def strength_at_point(self, x: float, y: float, z: float) -> str:
        strength, _direction = self.magnetic_at_point(x, y, z)
        return strength

    def magnetic_at_point(self, x: float, y: float, z: float) -> Tuple[str, Optional[str]]:
        import numpy as np

        point = np.array([x, y, z], dtype=np.float64)
        nearest_face = self._nearest_face_index(point)
        strength = _normalize_strength_name(
            self.face_strength_map.get(nearest_face, "none") if nearest_face is not None else "none"
        )
        direction = self.face_direction_map.get(nearest_face) if nearest_face is not None else None

        for region in self.volume_regions:
            if self._volume_region_contains(region, point):
                strength = region["strength"]
                direction = region.get("direction") or direction

        surface_strength = self._surface_strength_at_point(point)
        if surface_strength is not None:
            strength = surface_strength
            direction = self.surface_direction or direction

        grid_strength, grid_direction = self._grid_magnetic_at_point(point)
        if grid_strength is not None:
            strength = grid_strength
            direction = grid_direction or direction

        normalized_strength = _normalize_strength_name(strength)
        if normalized_strength == "none":
            return normalized_strength, None
        return normalized_strength, direction

    def _grid_magnetic_at_point(self, point) -> Tuple[Optional[str], Optional[str]]:
        grid = self.grid_magnetization
        if not grid:
            return None, None
        import numpy as np

        local = (np.asarray(point, dtype=np.float64) - np.asarray(grid["bbox_min"], dtype=np.float64)) / grid["cell_size"]
        indices = np.floor(local).astype(int)
        dimensions = grid["dimensions"]
        if any(index < 0 or index >= dimensions[axis] for axis, index in enumerate(indices)):
            return None, None
        key = ":".join(str(int(index)) for index in indices)
        cell = grid["active_cells"].get(key)
        if not isinstance(cell, dict):
            return None, None
        strength = cell.get("strength", 0)
        try:
            strength_value = float(strength)
        except (TypeError, ValueError):
            return None, None
        if strength_value > 1.0:
            # 兼容早期前端保存的 0–100 强度值。
            strength_value /= 100.0
        if strength_value <= 0:
            return "none", None
        direction = cell.get("direction")
        # 网格 UI 以 Tesla 保存：100 mT 为强，50 mT 为中，其余正值为弱。
        strength_name = "strong" if strength_value >= 0.1 else "medium" if strength_value >= 0.05 else "weak"
        return strength_name, _normalize_direction(direction)

    def _nearest_face_index(self, point) -> Optional[int]:
        if self.face_centroids is None or not (self.face_strength_map or self.face_direction_map):
            return None
        if self.face_lookup_tree is not None:
            _distance, idx = self.face_lookup_tree.query(point, k=1)
            return int(idx)
        import numpy as np

        best_idx = 0
        best_dist = float("inf")
        chunk_size = 65536
        for start in range(0, len(self.face_centroids), chunk_size):
            chunk = self.face_centroids[start:start + chunk_size]
            deltas = chunk - point
            distances = np.einsum("ij,ij->i", deltas, deltas)
            local_idx = int(np.argmin(distances))
            local_dist = float(distances[local_idx])
            if local_dist < best_dist:
                best_dist = local_dist
                best_idx = start + local_idx
        return best_idx

    def _face_strength_at_point(self, point) -> str:
        if not self.face_strength_map:
            return "none"
        nearest_face = self._nearest_face_index(point)
        if nearest_face is None:
            return "none"
        return _normalize_strength_name(self.face_strength_map.get(nearest_face, "none"))

    def _face_direction_at_point(self, point) -> Optional[str]:
        if not self.face_direction_map:
            return None
        nearest_face = self._nearest_face_index(point)
        if nearest_face is None:
            return None
        return self.face_direction_map.get(nearest_face)

    def _prepare_volume_regions(self, volume_regions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        import numpy as np

        prepared: List[Dict[str, Any]] = []
        for region in volume_regions:
            tag = region.get("tag", "magnetic")
            strength_id = region.get("strengthId")
            if tag != "magnetic" or strength_id is None:
                continue

            transform = region.get("transform", {}) or {}
            pos = np.array(transform.get("position", [0, 0, 0]), dtype=np.float64)
            rot_deg = np.array(transform.get("rotation", [0, 0, 0]), dtype=np.float64)
            scale = np.array(transform.get("scale", [1, 1, 1]), dtype=np.float64)
            if np.any(np.isclose(scale, 0.0)):
                continue

            rot_rad = np.radians(rot_deg)
            cx, cy, cz = np.cos(rot_rad)
            sx, sy, sz = np.sin(rot_rad)
            rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
            ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
            rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
            rotation = rz @ ry @ rx

            volume_matrix = np.eye(4)
            volume_matrix[:3, :3] = rotation * scale
            volume_matrix[:3, 3] = pos

            try:
                inverse_matrix = np.linalg.inv(volume_matrix)
            except np.linalg.LinAlgError:
                continue

            prepared.append({
                "method": str(region.get("method", "box")).lower(),
                "strength": _normalize_strength_name(strength_id),
                "direction": _normalize_direction(region.get("direction")),
                "inverse_matrix": inverse_matrix,
            })

        return prepared

    def _volume_region_contains(self, region: Dict[str, Any], point) -> bool:
        local = region["inverse_matrix"][:3, :3] @ point + region["inverse_matrix"][:3, 3]
        method = region["method"]
        if method == "box":
            return bool((abs(local) <= 0.5).all())
        if method == "sphere":
            return bool((local ** 2).sum() <= 0.25)
        if method == "cylinder":
            in_height = abs(float(local[1])) <= 0.5
            in_radius = float(local[0] ** 2 + local[2] ** 2) <= 0.25
            return in_height and in_radius
        return False

    def _decode_surface_paint_grid(self, grid_data: Optional[Dict[str, Any]]):
        if not grid_data:
            return None

        import numpy as np

        try:
            bbox_min = np.array(grid_data["bbox_min"], dtype=np.float64)
            bbox_max = np.array(grid_data["bbox_max"], dtype=np.float64)
            resolution = int(grid_data["resolution"])
            if resolution <= 0:
                return None
            bbox_size = bbox_max - bbox_min
            max_dim = float(np.max(bbox_size))
            if max_dim <= 0:
                return None

            data = _decode_surface_grid_rle(grid_data["data_b64"], resolution)
            return {
                "bbox_min": bbox_min,
                "max_dim": max_dim,
                "resolution": resolution,
                "data": data,
            }
        except (KeyError, ValueError, TypeError):
            _log.getLogger(__name__).warning("Invalid surface paint grid metadata", exc_info=True)
            return None

    def _surface_strength_at_point(self, point) -> Optional[str]:
        if self.surface_grid is None:
            return None
        import numpy as np

        grid = self.surface_grid
        normalized = (point - grid["bbox_min"]) / grid["max_dim"]
        if np.any(normalized < 0) or np.any(normalized > 1):
            return None

        resolution = int(grid["resolution"])
        voxel_idx = np.clip((normalized * resolution).astype(int), 0, resolution - 1)
        data = np.asarray(grid["data"])
        ix, iy, iz = (int(voxel_idx[0]), int(voxel_idx[1]), int(voxel_idx[2]))
        value = int(data[ix, iy, iz])
        strength_map = {1: "strong", 2: "medium", 3: "weak"}
        return strength_map.get(value)


@dataclass
class MagneticMetadata:
    source_mesh: Optional[Any]
    export_transform: Dict[str, Any]
    bed_center: Tuple[float, float] = (110.0, 110.0)
    regions: Optional[List[RegionData]] = None
    paint_data: Optional[Dict[str, Any]] = None
    volume_regions: Optional[List[Dict[str, Any]]] = None
    surface_paint_grid: Optional[Dict[str, Any]] = None
    surface_direction: Optional[Any] = None
    grid_magnetization: Optional[Dict[str, Any]] = None
    face_strength_map: Optional[Dict[int, str]] = None
    face_direction_map: Optional[Dict[int, str]] = None
    evaluator: MagneticRegionEvaluator = field(init=False)

    def __post_init__(self):
        self.evaluator = MagneticRegionEvaluator(
            source_mesh=self.source_mesh,
            face_strength_map=self.face_strength_map,
            face_direction_map=self.face_direction_map,
            volume_regions=self.volume_regions,
            surface_paint_grid=self.surface_paint_grid,
            surface_direction=self.surface_direction,
            grid_magnetization=self.grid_magnetization,
        )
        self.source_mesh = None

    def release_face_lookup(self) -> None:
        self.face_strength_map = None
        self.face_direction_map = None
        if hasattr(self.evaluator, "face_strength_map"):
            self.evaluator.face_strength_map = {}
        if hasattr(self.evaluator, "face_direction_map"):
            self.evaluator.face_direction_map = {}
        if hasattr(self.evaluator, "face_centroids"):
            self.evaluator.face_centroids = None
        if hasattr(self.evaluator, "face_lookup_tree"):
            self.evaluator.face_lookup_tree = None

    def release_pre_slice_payload(self) -> None:
        self.source_mesh = None
        self.regions = None
        self.paint_data = None
        self.volume_regions = None
        self.surface_paint_grid = None
        self.surface_direction = None
        if not self.face_strength_map and not self.face_direction_map:
            self.release_face_lookup()

    def gcode_to_model_point(self, x: float, y: float, z: float) -> Tuple[float, float, float]:
        scale = float(self.export_transform.get("scale", 1.0)) or 1.0
        center_xy = self.export_transform.get("center_xy", [0.0, 0.0])
        z_min = float(self.export_transform.get("z_min", 0.0))
        bed_x, bed_y = self.bed_center
        model_x = (float(x) - float(bed_x) + float(center_xy[0])) / scale
        model_y = (float(y) - float(bed_y) + float(center_xy[1])) / scale
        model_z = (float(z) + z_min) / scale
        return model_x, model_y, model_z

    def strength_at_gcode_position(self, x: float, y: float, z: float) -> str:
        model_point = self.gcode_to_model_point(x, y, z)
        return self.evaluator.strength_at_point(*model_point)

    def magnetic_at_gcode_position(self, x: float, y: float, z: float) -> Tuple[str, Optional[str]]:
        grid_result = self._grid_magnetic_at_gcode_position(x, y, z)
        if grid_result[0] is not None:
            return grid_result
        model_point = self.gcode_to_model_point(x, y, z)
        return self.evaluator.magnetic_at_point(*model_point)

    def magnetic_at_gcode_segment(
        self,
        previous: Dict[str, float],
        next_position: Dict[str, float],
    ) -> Tuple[str, Optional[str]]:
        """按起点、中点、终点检查一段挤出路径，优先返回网格磁化结果。"""
        samples = (
            previous,
            {
                axis: (previous[axis] + next_position[axis]) / 2.0
                for axis in ("X", "Y", "Z")
            },
            next_position,
        )
        fallback = ("none", None)
        for sample in samples:
            result = self.magnetic_at_gcode_position(sample["X"], sample["Y"], sample["Z"])
            if result[0] != "none":
                return result
            fallback = result
        return fallback

    def _grid_magnetic_at_gcode_position(self, x: float, y: float, z: float) -> Tuple[Optional[str], Optional[str]]:
        """将 G-code 坐标转换为预览网格的 Three.js 坐标并查询 cell ID。

        预览网格坐标为 [X, vertical-Y, depth-Z]，而 FDM G-code 为 [X, bed-Y, Z]。
        因此对应关系为 grid=[gcode.X, gcode.Z, -gcode.Y]。
        """
        grid = self.evaluator.grid_magnetization
        if not grid:
            return None, None
        # 当前前端网格使用打印床世界坐标：X、竖直 Y、深度 Z。
        preview_point = (float(x), float(z), -float(y))
        result = self.evaluator._grid_magnetic_at_point(preview_point)
        if result[0] is not None:
            return result

        # 兼容早期保存的模型局部坐标网格。导出变换会把 G-code 坐标
        # 转回模型坐标；同时尝试模型坐标的 Three.js 轴向排列。
        model_point = self.gcode_to_model_point(x, y, z)
        for candidate in (
            model_point,
            (model_point[0], model_point[2], -model_point[1]),
        ):
            result = self.evaluator._grid_magnetic_at_point(candidate)
            if result[0] is not None:
                return result
        return None, None


def _select_annotation_source_mesh(
    geometry_map: Dict[str, Any],
    merged_mesh: Any,
    paint_data: Optional[Dict[str, Any]] = None,
) -> Any:
    if paint_data:
        for mesh_name, strength_map in paint_data.items():
            if not isinstance(strength_map, dict):
                continue
            candidate = geometry_map.get(mesh_name)
            if candidate is None and len(geometry_map) == 1:
                candidate = next(iter(geometry_map.values()))
            if candidate is not None and getattr(candidate, "faces", None) is not None:
                return candidate
    return merged_mesh


def _has_painted_magnetic_faces(paint_data: Optional[Dict[str, Any]] = None) -> bool:
    if not paint_data:
        return False
    for strength_map in paint_data.values():
        if not isinstance(strength_map, dict):
            continue
        for strength in ("strong", "medium", "weak"):
            face_indices = strength_map.get(strength)
            if isinstance(face_indices, list) and face_indices:
                return True
    return False


def _has_face_annotations(
    regions: Optional[List[RegionData]] = None,
    paint_data: Optional[Dict[str, Any]] = None,
) -> bool:
    if regions and any(
        region.faceIndices and _normalize_strength_name(region.strength) != "none"
        for region in regions
    ):
        return True
    return _has_painted_magnetic_faces(paint_data)


def _has_magnetic_annotations(
    regions: Optional[List[RegionData]] = None,
    paint_data: Optional[Dict[str, Any]] = None,
    volume_regions: Optional[List[Dict[str, Any]]] = None,
    surface_paint_grid: Optional[Dict[str, Any]] = None,
    grid_magnetization: Optional[Dict[str, Any]] = None,
) -> bool:
    return bool(
        _has_face_annotations(regions, paint_data)
        or (volume_regions and len(volume_regions) > 0)
        or surface_paint_grid
        or bool(grid_magnetization and grid_magnetization.get("activeCells"))
    )


def prepare_single_model_with_metadata(
    model_path: str,
    regions: List[RegionData],
    output_dir: str,
    paint_data: Optional[Dict[str, Any]] = None,
    volume_regions: Optional[List[Dict[str, Any]]] = None,
    surface_paint_grid: Optional[Dict[str, Any]] = None,
    surface_direction: Optional[Any] = None,
    grid_magnetization: Optional[Dict[str, Any]] = None,
    bed_center: Tuple[float, float] = (110.0, 110.0),
) -> Dict[str, Any]:
    scene_or_mesh = _load_scene_or_mesh(model_path)
    geometry_map, merged_mesh = _scene_to_geometry_map(scene_or_mesh)
    has_face_annotations = _has_face_annotations(regions, paint_data)
    source_mesh = _select_annotation_source_mesh(geometry_map, merged_mesh, paint_data) if has_face_annotations else None
    original_face_count = _mesh_face_count(merged_mesh)
    max_faces = _get_slicing_face_limit()
    if original_face_count > max_faces:
        merged_mesh = _simplify_mesh_for_slicing(merged_mesh, max_faces=max_faces)
        if not has_face_annotations:
            source_mesh = None

    os.makedirs(output_dir, exist_ok=True)
    base_name = os.path.splitext(os.path.basename(model_path))[0]
    single_model_3mf = os.path.join(output_dir, f"{base_name}_continuous.3mf")
    export_transform = _export_mesh_as_3mf(merged_mesh, single_model_3mf, repair=False)

    face_strength_map = _build_face_strength_map(source_mesh, regions, paint_data) if source_mesh is not None else {}
    face_direction_map = _build_face_direction_map(source_mesh, regions) if source_mesh is not None else {}
    metadata = MagneticMetadata(
        source_mesh=source_mesh,
        export_transform={**export_transform, "bed_center": [float(bed_center[0]), float(bed_center[1])]},
        bed_center=bed_center,
        regions=regions,
        paint_data=paint_data,
        volume_regions=volume_regions,
        surface_paint_grid=surface_paint_grid,
        surface_direction=surface_direction,
        face_strength_map=face_strength_map,
        face_direction_map=face_direction_map,
        grid_magnetization=grid_magnetization,
    )

    return {
        "single_model_3mf": single_model_3mf,
        "metadata": metadata,
        "export_transform": export_transform,
        "continuous_model": True,
        "has_face_annotations": has_face_annotations,
        "original_face_count": original_face_count,
        "sliced_face_count": _mesh_face_count(merged_mesh),
    }


_GCODE_WORD_RE = re.compile(r"([A-Za-z])\s*(-?(?:\d+(?:\.\d*)?|\.\d+))")
_GCODE_EPSILON = 1e-6


def _parse_gcode_words(line: str) -> List[Tuple[str, float]]:
    code = line.split(";", 1)[0]
    return [(letter.upper(), float(value)) for letter, value in _GCODE_WORD_RE.findall(code)]


def process_gcode_magnetic_by_path(
    gcode_path: str,
    output_path: str,
    magnetic_metadata: MagneticMetadata,
    mag_start: str = "MAG_ON",
    mag_end: str = "MAG_OFF",
) -> Dict[str, Any]:
    logger = _log.getLogger(__name__)
    logger.info("Processing gcode with path-based magnetic metadata: %s", gcode_path)

    current = {"X": 0.0, "Y": 0.0, "Z": 0.0, "E": 0.0}
    absolute_xyz = True
    absolute_e = True
    retraction_debt = 0.0
    current_strength_value = 0
    current_direction: Optional[str] = None
    mag_on_count = 0
    mag_off_count = 0
    grid_hit_count = 0
    total_lines = 0

    def axis_changed(previous: Dict[str, float], next_position: Dict[str, float], axes: Tuple[str, ...]) -> bool:
        return any(abs(next_position[axis] - previous[axis]) > _GCODE_EPSILON for axis in axes)

    def resolve_next_position(previous: Dict[str, float], params: Dict[str, float]) -> Tuple[Dict[str, float], float]:
        next_position = previous.copy()
        for axis in ("X", "Y", "Z"):
            if axis in params:
                next_position[axis] = params[axis] if absolute_xyz else previous[axis] + params[axis]

        delta_e = 0.0
        if "E" in params:
            if absolute_e:
                next_position["E"] = params["E"]
                delta_e = next_position["E"] - previous["E"]
            else:
                next_position["E"] = previous["E"] + params["E"]
                delta_e = params["E"]

        return next_position, delta_e

    end_tokens = {"; End of Gcode", "M84", "M30"}

    with open(gcode_path, "r", encoding="utf-8", errors="ignore") as src, open(output_path, "w", encoding="utf-8") as dst:
        def write_line(text: str) -> None:
            nonlocal total_lines
            dst.write(text)
            total_lines += 1

        def append_mag_off() -> None:
            nonlocal current_strength_value, current_direction, mag_off_count
            if current_strength_value > 0:
                write_line(f"{mag_end}\n")
                mag_off_count += 1
                current_strength_value = 0
                current_direction = None

        def append_mag_on(strength_value: int, direction: Optional[str] = None) -> None:
            nonlocal current_strength_value, current_direction, mag_on_count
            if strength_value <= 0:
                append_mag_off()
                return
            normalized_direction = _normalize_direction(direction)
            if current_strength_value == strength_value and current_direction == normalized_direction:
                return
            append_mag_off()
            direction_part = f" DIR={normalized_direction}" if normalized_direction else ""
            write_line(f"{mag_start} S={strength_value}{direction_part}\n")
            mag_on_count += 1
            current_strength_value = strength_value
            current_direction = normalized_direction

        for line in src:
            stripped = line.strip()
            words = _parse_gcode_words(line)
            command = None
            params: Dict[str, float] = {}
            for letter, value in words:
                if command is None and letter in {"G", "M"}:
                    command = f"{letter}{int(value)}"
                params[letter] = value

            if command == "G90":
                absolute_xyz = True
                write_line(line)
                continue
            if command == "G91":
                absolute_xyz = False
                write_line(line)
                continue
            if command == "M82":
                absolute_e = True
                write_line(line)
                continue
            if command == "M83":
                absolute_e = False
                write_line(line)
                continue
            if command == "G92":
                axes = [axis for axis in ("X", "Y", "Z", "E") if axis in params]
                if axes:
                    for axis in axes:
                        current[axis] = params[axis]
                else:
                    for axis in current:
                        current[axis] = 0.0
                write_line(line)
                continue

            if command in {"G0", "G1", "G2", "G3"}:
                previous = current.copy()
                next_position, delta_e = resolve_next_position(current, params)
                xy_moved = axis_changed(previous, next_position, ("X", "Y"))

                deposition_delta = 0.0
                if delta_e < -_GCODE_EPSILON:
                    retraction_debt += -delta_e
                elif delta_e > _GCODE_EPSILON:
                    debt_repayment = min(retraction_debt, delta_e)
                    retraction_debt -= debt_repayment
                    deposition_delta = delta_e - debt_repayment

                if command in {"G2", "G3"}:
                    if deposition_delta > _GCODE_EPSILON:
                        append_mag_off()
                        logger.warning("Arc extrusion detected in %s; magnetic commands left off for safety", gcode_path)
                    elif not xy_moved:
                        append_mag_off()
                    write_line(line)
                    current = next_position
                    continue

                extruding = xy_moved and deposition_delta > _GCODE_EPSILON
                if extruding:
                    nonlocal_grid = magnetic_metadata.evaluator.grid_magnetization
                    if nonlocal_grid:
                        dx = next_position["X"] - previous["X"]
                        dy = next_position["Y"] - previous["Y"]
                        dz = next_position["Z"] - previous["Z"]
                        segment_length = (dx * dx + dy * dy + dz * dz) ** 0.5
                        cell_size = float(nonlocal_grid["cell_size"])
                        sample_count = max(2, min(256, int(segment_length / max(cell_size * 0.5, 0.01)) + 1))
                        strength_name, direction = "none", None
                        for sample_index in range(sample_count + 1):
                            ratio = sample_index / sample_count
                            sample = {
                                axis: previous[axis] + (next_position[axis] - previous[axis]) * ratio
                                for axis in ("X", "Y", "Z")
                            }
                            candidate_strength, candidate_direction = magnetic_metadata.magnetic_at_gcode_position(
                                sample["X"], sample["Y"], sample["Z"]
                            )
                            if candidate_strength != "none":
                                strength_name, direction = candidate_strength, candidate_direction
                                grid_hit_count += 1
                                break
                    else:
                        strength_name, direction = magnetic_metadata.magnetic_at_gcode_segment(previous, next_position)
                    append_mag_on(_map_strength_to_value(strength_name), direction)
                else:
                    append_mag_off()

                write_line(line)
                current = next_position
                continue

            if stripped.startswith("; End of Gcode") or command in {"M84", "M30"} or stripped in end_tokens:
                append_mag_off()

            write_line(line)

        append_mag_off()

    logger.info(
        "Path magnetic processing complete: %s MAG_ON, %s MAG_OFF inserted",
        mag_on_count,
        mag_off_count,
    )
    return {
        "output_path": output_path,
        "mag_on_count": mag_on_count,
        "mag_off_count": mag_off_count,
        "grid_hit_count": grid_hit_count,
        "total_lines": total_lines,
    }



def _split_mesh_by_voxel_strength(mesh, face_strength_map: Dict[int, str], pitch_divisor: int = 80) -> Dict[str, "Any"]:
    """体素化原始闭合网格，按面强度分配体素，每组 marching_cubes 生成不重叠的闭合实体。"""
    import trimesh
    import numpy as np

    _logger = _log.getLogger(__name__)

    max_dim = float(mesh.extents.max())
    if max_dim <= 0:
        return {}

    scale = 1.0
    if max_dim < 1.0:
        scale = 1000.0
    elif max_dim > 200.0:
        scale = 200.0 / max_dim

    if scale != 1.0:
        work_mesh = mesh.copy()
        work_mesh.apply_scale(scale)
        _logger.info(f"Scaled mesh for voxelization: {max_dim:.4f} -> {work_mesh.extents.max():.1f} (scale={scale:.1f})")
    else:
        work_mesh = mesh

    pitch = float(work_mesh.extents.max()) / pitch_divisor
    pitch = max(min(pitch, 4.0), 1.0)
    if pitch <= 0:
        return {}

    voxel_grid = work_mesh.voxelized(pitch)
    filled_indices = voxel_grid.sparse_indices

    _logger.info(f"Voxelized mesh: pitch={pitch:.4f}mm, {len(filled_indices)} filled voxels")

    origins = voxel_grid.indices_to_points(filled_indices)

    closest_points, distances, face_indices = trimesh.proximity.closest_point(work_mesh, origins)

    strength_voxels: Dict[str, list] = {}
    for i, fi in enumerate(face_indices):
        strength = face_strength_map.get(int(fi), "none")
        strength_voxels.setdefault(strength, []).append(i)

    for s, vl in strength_voxels.items():
        _logger.info(f"Voxel group '{s}': {len(vl)} voxels")
    _logger.info(f"face_strength_map has {len(face_strength_map)} entries, mesh has {len(work_mesh.faces)} faces")

    result: Dict[str, "Any"] = {}
    shape = voxel_grid.shape

    grids: Dict[str, "np.ndarray"] = {}
    for strength, voxel_idx_list in strength_voxels.items():
        grid = np.zeros(shape, dtype=bool)
        for vi in voxel_idx_list:
            idx = tuple(filled_indices[vi])
            grid[idx] = True
        grids[strength] = grid

    for strength, grid in grids.items():
        z_min_filled = np.where(grid.any(axis=(0, 1)))[0]
        if len(z_min_filled) > 0 and z_min_filled[0] > 0:
            anchor_x, anchor_y = np.where(grid[:, :, z_min_filled[0]])
            if len(anchor_x) > 0:
                ax, ay = int(anchor_x[0]), int(anchor_y[0])
                pad = 2
                x_lo = max(0, ax - pad)
                x_hi = min(shape[0], ax + pad + 1)
                y_lo = max(0, ay - pad)
                y_hi = min(shape[1], ay + pad + 1)
                for z in range(0, z_min_filled[0]):
                    grid[x_lo:x_hi, y_lo:y_hi, z] = True
                for other_s, other_g in grids.items():
                    if other_s != strength:
                        for z in range(0, z_min_filled[0]):
                            other_g[x_lo:x_hi, y_lo:y_hi, z] = False
                _logger.info(f"Added voxel pillar for '{strength}': Z 0-{z_min_filled[0]-1}, {x_hi-x_lo}x{y_hi-y_lo} cross-section")

    for strength, grid in grids.items():
        sub_voxel = trimesh.voxel.VoxelGrid(
            trimesh.voxel.encoding.DenseEncoding(grid),
            transform=voxel_grid.transform,
        )
        try:
            solid = sub_voxel.marching_cubes
            if solid is not None and not solid.is_empty:
                trimesh.repair.fix_normals(solid)
                if not solid.is_watertight:
                    trimesh.repair.fill_holes(solid)
                    trimesh.repair.fix_winding(solid)
                    trimesh.repair.fix_normals(solid)
                if not solid.is_watertight:
                    try:
                        repair_pitch = pitch * 0.8
                        repair_vg = solid.voxelized(repair_pitch)
                        repaired = repair_vg.marching_cubes
                        if repaired is not None and not repaired.is_empty:
                            trimesh.repair.fix_normals(repaired)
                            _logger.info(f"Re-voxelized '{strength}' for watertight: {len(repaired.faces)} faces, watertight={repaired.is_watertight}")
                            solid = repaired
                    except Exception as rv_err:
                        _logger.warning(f"Re-voxelize failed for '{strength}': {rv_err}")
                max_faces = 100_000
                if len(solid.faces) > max_faces:
                    try:
                        solid = solid.simplify_quadric_decimation(face_count=max_faces)
                        trimesh.repair.fix_normals(solid)
                        _logger.info(f"Decimated '{strength}' to {len(solid.faces)} faces")
                    except Exception as dec_err:
                        _logger.warning(f"Decimation failed for '{strength}': {dec_err}, using original {len(solid.faces)} faces")
                _logger.info(f"Voxel split '{strength}': {len(solid.faces)} faces, watertight={solid.is_watertight}")
                if scale != 1.0:
                    solid.apply_scale(1.0 / scale)
                result[strength] = solid
        except Exception as e:
            _logger.warning(f"Marching cubes failed for '{strength}': {e}")

    return result


def _parse_object_strength(object_name: str) -> Optional[str]:
    """
    Extract strength level from PrusaSlicer object name.

    PrusaSlicer preserves the input filename in object comments:
    "; printing object model_strong.3mf id:0 copy 0"

    This function extracts the strength keyword from the LAST underscore-separated
    segment of the filename (before extension).

    Args:
        object_name: Object name from gcode comment (e.g., "model_strong.3mf")

    Returns:
        Strength level ("strong", "medium", "weak", "none") or None if not found
    """
    parts = object_name.split()
    if not parts:
        return None
    name_clean = parts[0]
    name_without_ext = name_clean.rsplit('.', 1)[0]

    _NAME_TO_STRENGTH = {
        "magstrong": "strong",
        "magmedium": "medium",
        "magweak": "weak",
        "unmag": "none",
        "strong": "strong",
        "medium": "medium",
        "weak": "weak",
        "none": "none",
    }

    if '_' in name_without_ext:
        last_segment = name_without_ext.rsplit('_', 1)[1].lower()
        if last_segment in _NAME_TO_STRENGTH:
            return _NAME_TO_STRENGTH[last_segment]

    return None


def _evaluate_volume_regions(
    mesh,
    volume_regions: List[Dict[str, Any]],
) -> Dict[int, str]:
    import trimesh
    import numpy as np
    _logger = _log.getLogger(__name__)

    face_strength_map: Dict[int, str] = {}
    if not volume_regions:
        return face_strength_map

    centroids = mesh.triangles_center
    _logger.info(f"[volume_eval] mesh faces={len(mesh.faces)}, centroids shape={centroids.shape}, bounds={mesh.bounds.tolist()}")

    for vr in volume_regions:
        tag = vr.get("tag", "magnetic")
        strength_id = vr.get("strengthId")
        _logger.info(f"[volume_eval] region: tag={tag}, strengthId={strength_id}, method={vr.get('method')}, transform={vr.get('transform')}")
        if tag != "magnetic" or not strength_id:
            _logger.info(f"[volume_eval] SKIPPED region (tag={tag}, strengthId={strength_id})")
            continue

        method = vr.get("method", "box")
        transform = vr.get("transform", {})
        pos = np.array(transform.get("position", [0, 0, 0]), dtype=np.float64)
        rot_deg = np.array(transform.get("rotation", [0, 0, 0]), dtype=np.float64)
        scale = np.array(transform.get("scale", [1, 1, 1]), dtype=np.float64)

        vol_mat = np.eye(4)
        rot_rad = np.radians(rot_deg)
        cx, cy, cz = np.cos(rot_rad)
        sx, sy, sz = np.sin(rot_rad)
        Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
        Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
        Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
        R = Rz @ Ry @ Rx
        vol_mat[:3, :3] = R * scale
        vol_mat[:3, 3] = pos

        inv_mat = np.linalg.inv(vol_mat)
        local_pts = (inv_mat[:3, :3] @ centroids.T).T + inv_mat[:3, 3]

        if method == "box":
            mask = np.all(np.abs(local_pts) <= 0.5, axis=1)
        elif method == "sphere":
            mask = np.sum(local_pts ** 2, axis=1) <= 0.25
        elif method == "cylinder":
            in_height = np.abs(local_pts[:, 1]) <= 0.5
            in_radius = local_pts[:, 0] ** 2 + local_pts[:, 2] ** 2 <= 0.25
            mask = in_height & in_radius
        else:
            continue

        for fi in np.where(mask)[0]:
            face_strength_map[int(fi)] = strength_id
        _logger.info(f"[volume_eval] method={method}, matched {int(mask.sum())}/{len(mask)} faces for strength={strength_id}")

    _logger.info(f"[volume_eval] total face_strength_map: {len(face_strength_map)} entries")
    return face_strength_map


def _evaluate_surface_paint_grid(
    mesh,
    grid_data: Dict[str, Any],
) -> Dict[int, str]:
    import numpy as np
    _logger = _log.getLogger(__name__)

    bbox_min = np.array(grid_data["bbox_min"], dtype=np.float64)
    bbox_max = np.array(grid_data["bbox_max"], dtype=np.float64)
    res = int(grid_data["resolution"])
    bbox_size = bbox_max - bbox_min
    max_dim = float(np.max(bbox_size))
    if max_dim <= 0:
        return {}

    try:
        data = _decode_surface_grid_rle(grid_data["data_b64"], res)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"表面涂选网格无效: {exc}") from exc

    STRENGTH_MAP = {1: "strong", 2: "medium", 3: "weak"}

    centroids = mesh.triangles_center
    normalized = (centroids - bbox_min) / max_dim
    voxel_idx = np.clip((normalized * res).astype(int), 0, res - 1)
    values = data[voxel_idx[:, 0], voxel_idx[:, 1], voxel_idx[:, 2]]

    face_strength_map: Dict[int, str] = {}
    for fi in np.where(values > 0)[0]:
        v = int(values[fi])
        if v in STRENGTH_MAP:
            face_strength_map[int(fi)] = STRENGTH_MAP[v]

    _logger.info(f"[surface_grid_eval] res={res}, matched {len(face_strength_map)}/{len(mesh.faces)} faces")
    return face_strength_map


def split_model_by_regions(
    model_path: str,
    regions: List[RegionData],
    output_dir: str,
    paint_data: Optional[Dict[str, Any]] = None,
    volume_regions: Optional[List[Dict[str, Any]]] = None,
    surface_paint_grid: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    try:
        import trimesh
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="缺少 trimesh，无法分割模型") from exc

    geometry_map, merged_mesh = _scene_to_geometry_map(_load_scene_or_mesh(model_path))

    has_paint = _has_painted_magnetic_faces(paint_data)
    has_volume = volume_regions and len(volume_regions) > 0
    has_surface_grid = surface_paint_grid is not None

    if not has_paint and not has_volume and not has_surface_grid:
        normalized_path = _normalize_model_for_processing(model_path, output_dir, preferred_format="3mf")
        return {"base": normalized_path}

    strength_order = ["strong", "medium", "weak"]

    source_mesh = merged_mesh
    if has_paint and paint_data:
        for mesh_name, strength_map in paint_data.items():
            if not isinstance(strength_map, dict):
                continue
            candidate = geometry_map.get(mesh_name)
            if candidate is None and len(geometry_map) == 1:
                candidate = next(iter(geometry_map.values()))
            if candidate is not None and getattr(candidate, "faces", None) is not None:
                source_mesh = candidate
                break

    source_faces = getattr(source_mesh, "faces", None)
    if source_mesh is None or source_faces is None:
        normalized_path = _normalize_model_for_processing(model_path, output_dir, preferred_format="3mf")
        return {"base": normalized_path}

    face_count = len(source_faces)
    face_strength_map: Dict[int, str] = {}

    if has_paint and paint_data:
        for mesh_name, strength_map in paint_data.items():
            if not isinstance(strength_map, dict):
                continue
            for strength in strength_order:
                face_indices = strength_map.get(strength) or []
                if not isinstance(face_indices, list):
                    continue
                for idx in face_indices:
                    if isinstance(idx, int) and 0 <= idx < face_count:
                        face_strength_map[idx] = strength

    if has_volume and volume_regions:
        vol_map = _evaluate_volume_regions(source_mesh, volume_regions)
        for fi, sid in vol_map.items():
            face_strength_map[fi] = sid

    if has_surface_grid and surface_paint_grid:
        spg_map = _evaluate_surface_paint_grid(source_mesh, surface_paint_grid)
        for fi, sid in spg_map.items():
            face_strength_map[fi] = sid

    if not face_strength_map:
        normalized_path = _normalize_model_for_processing(model_path, output_dir, preferred_format="3mf")
        return {"base": normalized_path}

    strength_solids = _split_mesh_by_voxel_strength(source_mesh, face_strength_map)

    if strength_solids:
        _STRENGTH_TO_NAME = {
            "none": "unmag",
            "strong": "magstrong",
            "medium": "magmedium",
            "weak": "magweak",
        }
        named_meshes: Dict[str, Any] = {}
        base_name = os.path.splitext(os.path.basename(model_path))[0]
        for strength, solid in strength_solids.items():
            suffix = _STRENGTH_TO_NAME.get(strength, strength)
            named_meshes[f"{base_name}_{suffix}"] = solid

        if not named_meshes:
            raise HTTPException(
                status_code=400,
                detail="未能从模型中提取任何有效区域。",
            )

        combined_path = os.path.join(output_dir, f"{base_name}_combined.3mf")
        _export_multi_object_3mf(named_meshes, combined_path)

        individual_files: Dict[str, str] = {}
        for obj_name, solid in named_meshes.items():
            ind_path = os.path.join(output_dir, f"{obj_name}.3mf")
            _export_multi_object_3mf({obj_name: solid}, ind_path)
            individual_files[obj_name] = ind_path

        return {
            "combined": combined_path,
            "_object_count": str(len(named_meshes)),
            "_individual_files": individual_files,
        }

    normalized_path = _normalize_model_for_processing(model_path, output_dir, preferred_format="3mf")
    return {"base": normalized_path}


def create_3mf_package(model_files: Dict[str, str], regions: List[RegionData], output_path: str) -> str:
    """创建3MF文件包"""
    import zipfile

    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, path in model_files.items():
            if os.path.exists(path):
                zf.write(path, f"3D/Models/{os.path.basename(path)}")

        metadata = {
            "regions": [
                {"id": r.id, "name": r.name, "mesh": r.meshName, "strength": r.strength, "direction": r.direction}
                for r in regions
            ]
        }
        zf.writestr('Metadata/mag_regions.json', json.dumps(metadata, indent=2))

    return output_path


_prusaslicer_cache: str | None = None
_prusaslicer_searched = False


def reset_prusaslicer_cache() -> None:
    global _prusaslicer_cache, _prusaslicer_searched
    _prusaslicer_cache = None
    _prusaslicer_searched = False


def find_prusaslicer() -> str | None:
    global _prusaslicer_cache, _prusaslicer_searched
    if _prusaslicer_searched:
        return _prusaslicer_cache
    _prusaslicer_searched = True

    import logging as _log
    _logger = _log.getLogger(__name__)

    configured_path = os.environ.get("PRUSASLICER_PATH")
    configured_dir = os.environ.get("PRUSASLICER_DIR")
    candidates = [
        configured_path,
        shutil.which("prusa-slicer-console"),
        shutil.which("prusa-slicer"),
        shutil.which("prusaslicer"),
    ]

    if configured_dir:
        candidates += [
            os.path.join(configured_dir, "prusa-slicer"),
            os.path.join(configured_dir, "prusa-slicer-console"),
            os.path.join(configured_dir, "prusaslicer"),
            os.path.join(configured_dir, "PrusaSlicer.AppImage"),
        ]

    system = platform.system()
    if system == "Windows":
        import glob
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        local = os.environ.get("LOCALAPPDATA", "")
        candidates += [
            os.path.join(pf, "Prusa3D", "PrusaSlicer", "prusa-slicer-console.exe"),
            os.path.join(pf86, "Prusa3D", "PrusaSlicer", "prusa-slicer-console.exe"),
            os.path.join(local, "PrusaSlicer", "prusa-slicer-console.exe") if local else None,
        ]
        candidates += glob.glob(r"C:\Program Files\Prusa3D\PrusaSlicer*\prusa-slicer-console.exe")
    elif system == "Darwin":
        candidates += [
            "/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer",
            "/Applications/Original Prusa Drivers/PrusaSlicer.app/Contents/MacOS/PrusaSlicer",
            "/opt/homebrew/bin/prusa-slicer",
            "/usr/local/bin/prusa-slicer",
        ]
    else:
        candidates += [
            "/usr/bin/prusa-slicer",
            "/usr/local/bin/prusa-slicer",
            "/snap/bin/prusa-slicer",
            "/opt/PrusaSlicer/prusa-slicer",
            "/opt/PrusaSlicer/PrusaSlicer.AppImage",
            "/opt/prusaslicer/prusa-slicer",
            "/opt/prusaslicer/PrusaSlicer.AppImage",
            os.path.expanduser("~/.local/bin/prusa-slicer"),
        ]

    for path in candidates:
        if path and os.path.isfile(path) and os.access(path, os.X_OK):
            try:
                subprocess.run([path, "--version"], capture_output=True, timeout=8)
                _prusaslicer_cache = path
                _logger.info(f"PrusaSlicer found: {path}")
                return path
            except (OSError, subprocess.TimeoutExpired):
                continue
            except Exception:
                raise

    _logger.warning("PrusaSlicer not found")
    return None


def slice_with_prusaslicer(model_paths: List[str], output_path: str, printer: str = "prusa_i3_mk3", quality: str = "0.20mm") -> str:
    """
    使用 PrusaSlicer CLI 切片（支持多文件）

    Args:
        model_paths: 模型文件路径列表（支持多个文件一起切片）
        output_path: 输出 gcode 路径
        printer: 打印机配置（必须在 VALID_PRINTER_PROFILES 中）
        quality: 质量预设（必须在 VALID_QUALITY_PRESETS 中）

    Returns:
        输出 gcode 文件路径

    Raises:
        HTTPException: 参数验证失败、文件不存在、PrusaSlicer 未安装或切片失败
    """
    import logging
    logger = logging.getLogger(__name__)

    if printer not in VALID_PRINTER_PROFILES:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的打印机配置: {printer}. 支持的配置: {', '.join(VALID_PRINTER_PROFILES)}"
        )
    if quality not in VALID_QUALITY_PRESETS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的质量预设: {quality}. 支持的预设: {', '.join(VALID_QUALITY_PRESETS)}"
        )

    if not model_paths:
        raise HTTPException(status_code=400, detail="模型文件列表不能为空")

    missing_files = [path for path in model_paths if not os.path.exists(path)]
    if missing_files:
        raise HTTPException(
            status_code=404,
            detail=f"模型文件不存在: {', '.join(missing_files)}"
        )

    prusaslicer_path = find_prusaslicer()

    if not prusaslicer_path:
        raise HTTPException(
            status_code=501,
            detail=(
                "服务器未配置 PrusaSlicer，无法切片。请在运行后端的服务器上安装 PrusaSlicer，"
                "或在 backend/.env 中设置 PRUSASLICER_PATH 为服务器上的可执行文件路径，"
                "然后重启后端服务。"
            )
        )

    logger.info(
        f"Slicing {len(model_paths)} model(s) with PrusaSlicer: "
        f"{[os.path.basename(p) for p in model_paths]}"
    )

    normalized_temp_dir = os.path.join(TEMP_DIR, f"slice_{uuid.uuid4().hex[:8]}")
    os.makedirs(normalized_temp_dir, exist_ok=True)
    resolved_paths: List[str] = []

    proc = None
    try:
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        for model_path in model_paths:
            resolved_paths.append(_prepare_model_for_slicing(model_path, normalized_temp_dir))
        _release_process_memory()

        bed_center = _get_printer_bed_center(printer)

        logger.info(f"Using bed center: {bed_center} for printer: {printer}")

        cmd = [
            prusaslicer_path,
            "-g",
            "--gcode-label-objects", "octoprint",
            "--load", f"configs/{printer}.ini",
            "--load", f"configs/quality_{quality}.ini",
            "--center", bed_center,
            "--ensure-on-bed",
            "-o", output_path,
            *resolved_paths
        ]

        logger.debug(f"PrusaSlicer command: {' '.join(cmd)}")

        popen_kwargs = {
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "text": True,
        }
        if platform.system() != "Windows":
            popen_kwargs["start_new_session"] = True
        proc = subprocess.Popen(cmd, **popen_kwargs)
        try:
            result = proc.communicate(timeout=300)
        except subprocess.TimeoutExpired:
            logger.error("PrusaSlicer timeout after 300 seconds")
            if platform.system() != "Windows":
                import signal
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except OSError:
                    pass
            else:
                proc.terminate()
            try:
                proc.communicate(timeout=10)
            except Exception:
                if platform.system() != "Windows":
                    import signal
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except OSError:
                        pass
                else:
                    proc.kill()
            raise HTTPException(status_code=500, detail="切片超时（5分钟）")
        stdout = result[0] if isinstance(result, tuple) else ""
        stderr = result[1] if isinstance(result, tuple) else ""

        if proc.returncode != 0:
            logger.error(f"PrusaSlicer failed with return code {proc.returncode}")
            logger.error(f"stderr: {stderr}")
            if proc.returncode == -9:
                meminfo = _read_meminfo_kb()
                available_mb = int(meminfo.get("MemAvailable", 0) / 1024) if meminfo else 0
                memory_hint = f"，当前可用内存约 {available_mb}MB" if available_mb else ""
                raise HTTPException(
                    status_code=500,
                    detail=f"切片器被系统终止（SIGKILL），通常是模型过复杂或内存不足{memory_hint}。已启用模型轻量化，请尝试减少标注范围或使用更简单模型。",
                )
            raise HTTPException(
                status_code=500,
                detail=f"切片失败: {stderr or stdout or f'PrusaSlicer 返回码 {proc.returncode}'}"
            )

        if not os.path.exists(output_path):
            raise HTTPException(
                status_code=500,
                detail=f"切片完成但未生成输出文件。Slicer output: {stdout} {stderr}"
            )

        logger.info(f"Slicing successful: {output_path}")
        return output_path

    except HTTPException:
        raise
    except (OSError, ValueError) as e:
        logger.error(f"Unexpected error during slicing: {e}")
        raise HTTPException(status_code=500, detail=f"切片过程中发生错误: {str(e)}")
    except Exception:
        raise
    finally:
        if proc and proc.poll() is None:
            try:
                if platform.system() != "Windows":
                    import signal
                    os.killpg(proc.pid, signal.SIGKILL)
                else:
                    proc.kill()
            except OSError:
                pass
        remove_dir_quietly(normalized_temp_dir)


def process_gcode_magnetic_regions(gcode_path: str, regions: List[RegionData], output_path: str, mag_start: str = "MAG_ON", mag_end: str = "MAG_OFF") -> str:
    """
    后处理 G-code，在对象边界插入磁场控制指令

    逻辑：
    1. 扫描 G-code 中的 "; printing object <name>" 注释
    2. 从对象名称提取磁化强度（strong/medium/weak/none）
    3. 在对象开始处插入 MAG_ON S=<value>
    4. 在切换到不同强度对象时，先 MAG_OFF 再 MAG_ON
    5. none 强度不插入任何代码（保持磁场关闭）
    6. 在打印结束时确保磁场关闭
    """
    import logging
    logger = logging.getLogger(__name__)

    logger.info(f"Processing gcode with magnetic regions: {gcode_path}")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    current_strength = None
    mag_on_count = 0
    mag_off_count = 0
    with open(gcode_path, 'r', encoding='utf-8', errors='ignore') as src, open(output_path, 'w', encoding='utf-8') as dst:
        for line in src:
            obj_match = re.match(r'; printing object (\S+)', line)
            if obj_match:
                object_name = obj_match.group(1)
                strength_name = _parse_object_strength(object_name)

                logger.debug(f"Detected object: {object_name}, strength: {strength_name}")
                dst.write(line)

                if strength_name:
                    strength_value = _map_strength_to_value(strength_name)

                    if strength_name == "none" or strength_value == 0:
                        if current_strength is not None and current_strength > 0:
                            dst.write(f"{mag_end}\n")
                            mag_off_count += 1
                            logger.debug(f"Inserted {mag_end} (switching to none)")
                            current_strength = None
                    else:
                        if current_strength != strength_value:
                            if current_strength is not None and current_strength > 0:
                                dst.write(f"{mag_end}\n")
                                mag_off_count += 1
                                logger.debug(f"Inserted {mag_end} (switching from S={current_strength})")

                            dst.write(f"{mag_start} S={strength_value}\n")
                            mag_on_count += 1
                            logger.debug(f"Inserted {mag_start} S={strength_value}")
                            current_strength = strength_value
                else:
                    logger.debug(f"Unknown object (no strength): {object_name}")
                continue

            dst.write(line)

            stop_match = re.match(r'; stop printing object (\S+)', line)
            if stop_match:
                if current_strength is not None and current_strength > 0:
                    dst.write(f"{mag_end}\n")
                    mag_off_count += 1
                    logger.debug(f"Inserted {mag_end} (object stopped: {stop_match.group(1)})")
                    current_strength = None

            if line.strip() in ['; End of Gcode', 'M84', 'M30']:
                if current_strength is not None and current_strength > 0:
                    dst.write(f"{mag_end}\n")
                    mag_off_count += 1
                    logger.debug(f"Inserted {mag_end} (end of print)")
                    current_strength = None

        if current_strength is not None and current_strength > 0:
            dst.write(f"{mag_end}\n")
            mag_off_count += 1

    logger.info(
        f"Magnetic processing complete: {mag_on_count} MAG_ON, {mag_off_count} MAG_OFF inserted"
    )

    return output_path


@router.post("/split-model")
async def split_model(request: SplitModelRequest, current_user: User = Depends(get_current_user)):
    """根据选中的区域分割3D模型，返回各强度子模型的下载链接"""
    output_dir = None
    try:
        model_path = _resolve_model_path(request.model_url)

        if not os.path.exists(model_path):
            raise HTTPException(status_code=404, detail="模型文件不存在")

        output_dir = os.path.join(UPLOAD_DIR, "split", uuid.uuid4().hex[:8])
        os.makedirs(output_dir, exist_ok=True)

        split_files = await run_heavy_task(
            "模型分割",
            split_model_by_regions,
            model_path,
            request.regions,
            output_dir,
            request.paint_data,
            volume_regions=[vr.dict() for vr in request.volume_regions] if request.volume_regions else None,
            surface_paint_grid=request.surface_paint_grid.dict() if request.surface_paint_grid else None,
        )

        split_files.pop("_object_count", None)
        split_files.pop("_individual_files", None)

        files_info = {}
        for key, filepath in split_files.items():
            if not isinstance(filepath, str):
                continue
            basename = os.path.basename(filepath)
            # 复制到 slices 目录以便通过 download 端点访问
            dest = os.path.join(SLICE_OUTPUT_DIR, basename)
            if filepath != dest:
                shutil.copy(filepath, dest)
            files_info[key] = {
                "filename": basename,
                "download_url": f"/api/gcode/download/{basename}",
            }

        # 可选：打包为 3MF
        package_url = None
        if request.output_format == "3mf" and split_files:
            output_3mf = os.path.join(SLICE_OUTPUT_DIR, f"model_{uuid.uuid4().hex[:8]}.3mf")
            await run_heavy_task("3MF打包", create_3mf_package, split_files, request.regions, output_3mf)
            package_url = f"/api/gcode/download/{os.path.basename(output_3mf)}"

        return {
            "success": True,
            "files": files_info,
            "package_url": package_url,
            "split_count": len(files_info),
        }
    except HTTPException:
        raise
    except Exception as e:
        import logging as _log
        _log.getLogger(__name__).exception("split-model failed")
        raise HTTPException(status_code=500, detail=f"模型分割失败: {type(e).__name__}: {e}")
    finally:
        if output_dir:
            remove_dir_quietly(output_dir)


@router.post("/slice")
async def slice_model(request: SliceRequest, current_user: User = Depends(get_current_user)):
    """使用PrusaSlicer切片模型"""
    cleanup_paths: list[str] = []
    try:
        import urllib.parse as _urlparse
        _decoded = _urlparse.unquote(request.model_path)
        if _decoded.startswith("http://") or _decoded.startswith("https://"):
            from app.api.ai import _make_client
            async with _make_client(timeout=180.0) as _client:
                async with _client.stream("GET", _decoded, follow_redirects=True) as _resp:
                    _resp.raise_for_status()
                    _parsed = _urlparse.urlparse(_decoded)
                    _ext = os.path.splitext(_parsed.path)[1] or ".glb"
                    _temp_name = f"remote_{uuid.uuid4().hex[:8]}{_ext}"
                    model_path = os.path.join(UPLOAD_DIR, _temp_name)
                    cleanup_paths.append(model_path)
                    await save_httpx_response_stream(
                        _resp,
                        model_path,
                        max_size=100 * 1024 * 1024,
                        too_large_detail="远程模型不能超过 100MB",
                    )
        else:
            model_path = _resolve_model_path(request.model_path)

        if not os.path.exists(model_path):
            raise HTTPException(status_code=404, detail="模型文件不存在")

        if os.path.splitext(model_path)[1].lower() == ".gltf":
            with open(model_path, "rb") as f:
                content = f.read()
            try:
                _validate_gltf_upload(content)
            except HTTPException as upload_error:
                if ".gltf 文件" in str(upload_error.detail):
                    raise
                payload = json.loads(content.decode("utf-8"))
                for collection_name in ("images", "buffers"):
                    for item in payload.get(collection_name, []):
                        if not isinstance(item, dict):
                            continue
                        uri = item.get("uri")
                        if isinstance(uri, str) and uri and not uri.startswith("data:"):
                            _resolve_gltf_sidecar_path(model_path, uri)

        output_gcode = os.path.join(SLICE_OUTPUT_DIR, f"slice_{uuid.uuid4().hex[:8]}.gcode")
        result_path = await run_heavy_task(
            "切片",
            slice_with_prusaslicer,
            [model_path],
            output_gcode,
            request.printer_profile,
            request.quality,
        )

        return {
            "success": True,
            "gcode_path": result_path,
            "filename": os.path.basename(result_path),
            "download_url": f"/api/gcode/download/{os.path.basename(result_path)}"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        for path in cleanup_paths:
            remove_file_quietly(path)


@router.post("/process-gcode")
async def process_gcode(request: GcodeProcessRequest, current_user: User = Depends(get_current_user)):
    """后处理G-code，插入磁场控制指令"""
    try:
        gcode_path = _resolve_model_path(request.gcode_path)

        if not os.path.exists(gcode_path):
            raise HTTPException(status_code=404, detail="G-code文件不存在")

        output_gcode = os.path.join(SLICE_OUTPUT_DIR, f"processed_{uuid.uuid4().hex[:8]}.gcode")
        if request.grid_magnetization:
            metadata = MagneticMetadata(
                source_mesh=None,
                export_transform={"scale": 1.0, "center_xy": [0.0, 0.0], "z_min": 0.0},
                grid_magnetization=request.grid_magnetization.model_dump(),
            )
            process_stats = await run_heavy_task(
                "G-code网格磁场后处理",
                process_gcode_magnetic_by_path,
                gcode_path=gcode_path,
                output_path=output_gcode,
                magnetic_metadata=metadata,
                mag_start=request.mag_start_code,
                mag_end=request.mag_end_code,
            )
            result_path = process_stats["output_path"]
        else:
            result_path = await run_heavy_task(
                "G-code后处理",
                process_gcode_magnetic_regions,
                gcode_path,
                request.regions,
                output_gcode,
                request.mag_start_code,
                request.mag_end_code,
            )

        with open(result_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()

        return {
            "success": True,
            "output_path": result_path,
            "filename": os.path.basename(result_path),
            "download_url": f"/api/gcode/download/{os.path.basename(result_path)}",
            "stats": {
                "mag_on_count": content.count(request.mag_start_code),
                "mag_off_count": content.count(request.mag_end_code),
                "regions_count": len(request.regions),
                "total_lines": len(content.splitlines()),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _process_4d_print_impl(
    request: Process4DRequest,
    progress_callback: Optional[ProgressCallback] = None,
) -> Dict[str, Any]:
    cleanup_paths: list[str] = []
    cleanup_dirs: list[str] = []
    try:
        _emit_progress(progress_callback, "resolve_model", 8, "正在解析模型来源")
        import urllib.parse as _urlparse
        _decoded = _urlparse.unquote(request.model_url)
        if _decoded.startswith("http://") or _decoded.startswith("https://"):
            _emit_progress(progress_callback, "download_model", 12, "正在下载远程模型")
            from app.api.ai import _make_client
            async with _make_client(timeout=180.0) as _client:
                async with _client.stream("GET", _decoded, follow_redirects=True) as _resp:
                    _resp.raise_for_status()
                    _parsed = _urlparse.urlparse(_decoded)
                    _ext = os.path.splitext(_parsed.path)[1] or ".glb"
                    _temp_name = f"remote_{uuid.uuid4().hex[:8]}{_ext}"
                    model_path = os.path.join(UPLOAD_DIR, _temp_name)
                    cleanup_paths.append(model_path)
                    await save_httpx_response_stream(
                        _resp,
                        model_path,
                        max_size=100 * 1024 * 1024,
                        too_large_detail="远程模型不能超过 100MB",
                    )
        else:
            model_path = _resolve_model_path(request.model_url)

        if not os.path.exists(model_path):
            raise HTTPException(status_code=404, detail="模型文件不存在")

        has_magnetic_annotations = _has_magnetic_annotations(
            request.regions,
            request.paint_data,
            [vr.dict() for vr in request.volume_regions] if request.volume_regions else None,
            request.surface_paint_grid.dict() if request.surface_paint_grid else None,
            request.grid_magnetization.model_dump() if request.grid_magnetization else None,
        )
        if not has_magnetic_annotations:
            _emit_progress(progress_callback, "slice", 50, "未检测到磁场标注，正在执行普通切片")
            output_gcode = os.path.join(SLICE_OUTPUT_DIR, f"slice_{uuid.uuid4().hex[:8]}.gcode")
            result_path = await run_heavy_task(
                "切片",
                slice_with_prusaslicer,
                [model_path],
                output_gcode,
                request.printer_profile,
                request.quality,
            )
            result = {
                "success": True,
                "output_path": result_path,
                "filename": os.path.basename(result_path),
                "download_url": f"/api/gcode/download/{os.path.basename(result_path)}",
                "stats": {
                    "mag_on_count": 0,
                    "mag_off_count": 0,
                    "total_lines": 0,
                },
                "slice_result": {
                    "gcode_path": result_path,
                    "download_url": f"/api/gcode/download/{os.path.basename(result_path)}",
                    "multi_object_mode": False,
                },
                "message": "未检测到磁场标注，已完成普通切片",
            }
            _emit_progress(progress_callback, "completed", 100, str(result["message"]))
            return result

        _emit_progress(progress_callback, "prepare_model", 25, "正在准备连续 3MF 模型与磁场元数据")
        continuous_dir = os.path.join(UPLOAD_DIR, "continuous", uuid.uuid4().hex[:8])
        cleanup_dirs.append(continuous_dir)
        bed_center = _parse_bed_center_tuple(_get_printer_bed_center(request.printer_profile))
        prepared_model = await run_heavy_task(
            "4D模型准备",
            prepare_single_model_with_metadata,
            model_path=model_path,
            regions=request.regions,
            output_dir=continuous_dir,
            paint_data=request.paint_data,
            volume_regions=[vr.dict() for vr in request.volume_regions] if request.volume_regions else None,
            surface_paint_grid=request.surface_paint_grid.dict() if request.surface_paint_grid else None,
            surface_direction=request.surface_direction,
            grid_magnetization=request.grid_magnetization.model_dump() if request.grid_magnetization else None,
            bed_center=bed_center,
        )

        single_model_3mf = prepared_model["single_model_3mf"]
        magnetic_metadata = prepared_model["metadata"]
        has_face_annotations = bool(prepared_model.get("has_face_annotations"))
        prepared_model = None
        if not single_model_3mf or not os.path.exists(single_model_3mf):
            raise HTTPException(status_code=400, detail="没有有效的连续模型可供切片")

        if not has_face_annotations:
            magnetic_metadata.release_face_lookup()
        magnetic_metadata.release_pre_slice_payload()
        _release_process_4d_request_payload(request)
        _release_process_memory()
        logger.info("Preparing to slice continuous single-object 3MF: %s", single_model_3mf)
        _emit_progress(progress_callback, "slice", 50, "正在调用 PrusaSlicer 切片，复杂模型可能会在此停留数分钟")
        combined_gcode = os.path.join(SLICE_OUTPUT_DIR, f"continuous_{uuid.uuid4().hex[:8]}.gcode")
        await run_heavy_task(
            "切片",
            slice_with_prusaslicer,
            model_paths=[single_model_3mf],
            output_path=combined_gcode,
            printer=request.printer_profile,
            quality=request.quality,
        )
        logger.info("Continuous model slicing successful: %s", combined_gcode)

        _emit_progress(progress_callback, "inject_magnetic", 78, "正在按打印路径注入磁场指令")
        mag_output = combined_gcode.replace(".gcode", "_mag.gcode")
        try:
            process_stats = await run_heavy_task(
                "G-code磁场注入",
                process_gcode_magnetic_by_path,
                gcode_path=combined_gcode,
                output_path=mag_output,
                magnetic_metadata=magnetic_metadata,
                mag_start="MAG_ON",
                mag_end="MAG_OFF",
            )
            processed = process_stats["output_path"]
            logger.info("Path magnetic processing successful: %s", processed)
        except Exception as e:
            logger.error("Path magnetic processing failed: %s", e)
            raise HTTPException(status_code=500, detail=f"磁场注入失败: {e}")

        _emit_progress(progress_callback, "collect_result", 92, "正在整理 G-code 处理结果")
        result = {
            "success": True,
            "output_path": processed,
            "filename": os.path.basename(processed),
            "download_url": f"/api/gcode/download/{os.path.basename(processed)}",
            "stats": {
                "mag_on_count": process_stats["mag_on_count"],
                "mag_off_count": process_stats["mag_off_count"],
                "grid_hit_count": process_stats.get("grid_hit_count", 0),
                "total_lines": process_stats["total_lines"],
            },
            "model_result": {
                "single_model_3mf": os.path.basename(single_model_3mf),
                "continuous_model": True,
                "magnetic_mode": "offline_gcode_path",
            },
            "slice_result": {
                "gcode_path": combined_gcode,
                "download_url": f"/api/gcode/download/{os.path.basename(combined_gcode)}",
                "multi_object_mode": False,
            },
            "message": "4D处理完成：连续模型切片 → 离线路径磁场注入"
        }
        _emit_progress(progress_callback, "completed", 100, str(result["message"]))
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        for path in cleanup_paths:
            remove_file_quietly(path)
        for directory in cleanup_dirs:
            remove_dir_quietly(directory)


async def _run_process_4d_task(task_id: str, request: Process4DRequest) -> None:
    def report(stage: str, progress: int, message: str) -> None:
        if _is_process_4d_task_cancelled(task_id):
            raise HTTPException(status_code=499, detail="4D processing task cancelled")
        _update_process_4d_task(
            task_id,
            status="running",
            current_stage=stage,
            progress=progress,
            message=message,
        )

    try:
        async with heavy_task_limiter.run("4D处理"):
            if _is_process_4d_task_cancelled(task_id):
                raise HTTPException(status_code=499, detail="4D processing task cancelled")
            _update_process_4d_task(
                task_id,
                status="running",
                current_stage="started",
                progress=2,
                message="任务已开始处理",
            )
            result = await _process_4d_print_impl(request, progress_callback=report)
        _update_process_4d_task(
            task_id,
            status="succeeded",
            current_stage="completed",
            progress=100,
            message=result.get("message") or "4D 处理完成",
            result=result,
        )
        _notify_process_4d_task_done(task_id, True)
    except HTTPException as exc:
        detail = _http_exception_detail(exc)
        if exc.status_code == 499:
            logger.info("process-4d task cancelled: %s", task_id)
            _update_process_4d_task(
                task_id,
                status="cancelled",
                current_stage="cancelled",
                progress=100,
                message=detail,
                error=None,
            )
            return
        logger.exception("process-4d task failed: %s", detail)
        _update_process_4d_task(
            task_id,
            status="failed",
            current_stage="failed",
            progress=100,
            message=detail,
            error=detail,
        )
        _notify_process_4d_task_done(task_id, False)
    except Exception as exc:
        detail = str(exc) or type(exc).__name__
        logger.exception("process-4d task failed unexpectedly")
        _update_process_4d_task(
            task_id,
            status="failed",
            current_stage="failed",
            progress=100,
            message=detail,
            error=detail,
        )
        _notify_process_4d_task_done(task_id, False)


@router.post("/process-4d/tasks")
async def create_process_4d_task(request: Process4DRequest, current_user: User = Depends(get_current_user)):
    owner_user_id = str(getattr(current_user, "id", ""))
    task = _create_process_4d_task(owner_user_id)
    asyncio.create_task(_run_process_4d_task(task["task_id"], request))
    return _serialize_process_4d_task(task)


@router.get("/process-4d/tasks")
async def list_process_4d_tasks(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owned = (
        db.query(Process4DTask)
        .filter(Process4DTask.user_id == current_user.id)
        .order_by(Process4DTask.created_at.desc())
        .limit(PROCESS_4D_TASK_LIMIT)
        .all()
    )
    tasks = [_serialize_process_4d_task_summary(task) for task in owned]
    return {"success": True, "tasks": tasks}


@router.get("/process-4d/tasks/{task_id}")
async def get_process_4d_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.query(Process4DTask).filter(
        Process4DTask.task_id == task_id,
        Process4DTask.user_id == current_user.id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="4D processing task not found")
    return _serialize_process_4d_task(task)


@router.post("/process-4d/tasks/{task_id}/cancel")
async def cancel_process_4d_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.query(Process4DTask).filter(
        Process4DTask.task_id == task_id,
        Process4DTask.user_id == current_user.id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="4D processing task not found")
    if task.status in {"succeeded", "failed", "cancelled"}:
        return _serialize_process_4d_task(task)
    task.status = "cancelled"
    task.current_stage = "cancelled"
    task.message = "4D processing task cancelled"
    task.progress = 100
    task.updated_at = datetime.now(timezone.utc)
    logs = list(task.logs or [])
    logs.append({
        "time": task.updated_at.isoformat(),
        "stage": "cancelled",
        "status": "cancelled",
        "progress": 100,
        "message": task.message,
    })
    task.logs = logs[-200:]
    db.commit()
    db.refresh(task)
    return _serialize_process_4d_task(task)


@router.post("/process-4d")
async def process_4d_print(request: Process4DRequest, current_user: User = Depends(get_current_user)):
    async with heavy_task_limiter.run("4D处理"):
        return await _process_4d_print_impl(request)


@router.post("/upload")
async def upload_gcode(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    """Upload a G-code file for editing"""
    if not file.filename or not file.filename.lower().endswith('.gcode'):
        raise HTTPException(status_code=400, detail="Only .gcode files are accepted")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="G-code 文件不能超过 10MB")

    filename = f"gcode_{uuid.uuid4().hex[:8]}.gcode"
    filepath = os.path.join(SLICE_OUTPUT_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(content)

    # Parse basic info
    text = content.decode("utf-8", errors="ignore")
    lines = text.split("\n")
    total_layers = sum(1 for l in lines if l.strip().startswith(";LAYER:") or l.strip().startswith("; Layer"))
    if total_layers == 0:
        total_layers = sum(1 for l in lines if re.match(r"G1\s+Z\d", l.strip()))

    mag_on_count = text.count("MAG_ON")
    mag_off_count = text.count("MAG_OFF")

    return {
        "success": True,
        "filename": filename,
        "original_name": file.filename,
        "total_lines": len(lines),
        "total_layers": total_layers,
        "has_magnetic": mag_on_count > 0,
        "mag_on_count": mag_on_count,
        "mag_off_count": mag_off_count,
    }


@router.get("/content/{filename}")
async def get_gcode_content(filename: str, current_user: User = Depends(get_current_user)):
    """Get G-code file content"""
    safe_name = safe_filename(filename)
    filepath = os.path.join(SLICE_OUTPUT_DIR, safe_name)
    if not os.path.exists(filepath):
        filepath = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")

    MAX_CONTENT_SIZE = 50 * 1024 * 1024
    file_size = os.path.getsize(filepath)
    if file_size > MAX_CONTENT_SIZE:
        raise HTTPException(status_code=413, detail=f"文件过大 ({file_size // 1024 // 1024}MB)，最大支持 50MB")

    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    return {"filename": filename, "content": content}


class SaveGcodeRequest(BaseModel):
    filename: str
    content: str


@router.post("/save")
async def save_gcode(request: SaveGcodeRequest, current_user: User = Depends(get_current_user)):
    safe_name = safe_filename(request.filename)
    filepath = os.path.join(SLICE_OUTPUT_DIR, safe_name)
    if not os.path.exists(filepath):
        filepath = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")

    output_filename = f"edited_{uuid.uuid4().hex[:8]}.gcode"
    output_path = os.path.join(SLICE_OUTPUT_DIR, output_filename)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(request.content)

    lines = request.content.split("\n")
    return {
        "success": True,
        "filename": output_filename,
        "download_url": f"/api/gcode/download/{output_filename}",
        "total_lines": len(lines),
        "total_layers": sum(1 for l in lines if l.strip().startswith(";LAYER:") or l.strip().startswith("; Layer")),
        "mag_on_count": request.content.count("MAG_ON"),
        "mag_off_count": request.content.count("MAG_OFF"),
    }


@router.post("/insert-magnetic")
async def insert_magnetic_command(
    filename: str = Form(...),
    layer: int = Form(...),
    strength: float = Form(1.0),
    direction: str = Form("X"),
    current_user: User = Depends(get_current_user),
):
    """Insert magnetic command at a specific layer in G-code"""
    safe_name = safe_filename(filename)
    filepath = os.path.join(SLICE_OUTPUT_DIR, safe_name)
    if not os.path.exists(filepath):
        filepath = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")

    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()

    current_layer = 0
    inserted = False
    new_lines = []

    for line in lines:
        new_lines.append(line)
        if re.match(r";LAYER:\s*\d+", line.strip()) or re.match(r"; Layer \d+", line.strip()):
            current_layer += 1
            if current_layer == layer and not inserted:
                new_lines.append(f"MAG_ON S={strength} DIR={direction} ; Magnetic field at layer {layer}\n")
                inserted = True
        elif current_layer == layer + 1 and inserted:
            new_lines.insert(len(new_lines) - 1, f"MAG_OFF ; End magnetic field\n")
            inserted = False

    if inserted:
        new_lines.append(f"MAG_OFF ; End magnetic field (last layer)\n")

    output_filename = f"mag_{uuid.uuid4().hex[:8]}.gcode"
    output_path = os.path.join(SLICE_OUTPUT_DIR, output_filename)
    with open(output_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

    return {
        "success": True,
        "filename": output_filename,
        "layer": layer,
        "strength": strength,
        "direction": direction,
    }


@router.get("/download/{filename}")
async def download_gcode(filename: str):
    """Download a G-code or split model file (no auth — filenames are random UUIDs)"""
    safe_name = safe_filename(filename)
    filepath = os.path.join(SLICE_OUTPUT_DIR, safe_name)
    if not os.path.exists(filepath):
        filepath = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=filepath,
        filename=safe_name,
        media_type="application/octet-stream",
    )


class ValidateStatsRequest(BaseModel):
    gcode_url: str
    frontend_stats: Dict[str, float]


@router.post("/validate-stats")
async def validate_gcode_stats(request: ValidateStatsRequest, current_user: User = Depends(get_current_user)):
    try:
        gcode_path = _resolve_model_path(request.gcode_url)

        if not os.path.exists(gcode_path):
            raise HTTPException(status_code=404, detail="G-code文件不存在")

        with open(gcode_path, 'r', encoding='utf-8', errors='ignore') as f:
            gcode_text = f.read()

        backend_stats = parse_gcode_statistics(gcode_text)

        issues = []
        metrics = ['layer_count', 'extrusion_length_mm', 'print_time_seconds', 'mag_on_count', 'mag_off_count']

        for metric in metrics:
            frontend_val = request.frontend_stats.get(metric, 0)
            backend_val = backend_stats.get(metric, 0)

            if metric == 'layer_count':
                if frontend_val != backend_val:
                    issues.append({
                        'metric': metric,
                        'frontend': frontend_val,
                        'backend': backend_val,
                        'severity': 'error'
                    })
            else:
                if backend_val > 0:
                    diff_pct = abs(frontend_val - backend_val) / backend_val
                    if diff_pct > 0.05:
                        issues.append({
                            'metric': metric,
                            'frontend': frontend_val,
                            'backend': backend_val,
                            'severity': 'warning' if diff_pct < 0.15 else 'error'
                        })
                elif frontend_val != backend_val:
                    issues.append({
                        'metric': metric,
                        'frontend': frontend_val,
                        'backend': backend_val,
                        'severity': 'warning'
                    })

        return {
            'isValid': len(issues) == 0,
            'discrepancies': issues,
            'backend_stats': backend_stats
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"验证失败: {str(e)}")
