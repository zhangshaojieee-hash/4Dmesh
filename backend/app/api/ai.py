import os
import uuid
import hashlib
import httpx
import logging
import asyncio
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env')
load_dotenv(env_path)

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Literal
from app.core.file_io import remove_file_quietly, safe_filename, save_httpx_response_stream, save_upload_file
from app.core.database import get_db
from app.core.limits import run_heavy_task
from app.core.model_lifecycle import create_draft_model_record, model_file_url
from app.core.model_thumbnails import generate_model_thumbnail_file
from app.core.paths import MODEL_UPLOAD_DIR, TEMP_DIR as CONFIGURED_TEMP_DIR
from app.models import User
from app.api.models import _validate_gltf_upload
from app.api.users import get_current_user
from app.api.gcode import _load_scene_or_mesh, _export_mesh_as_glb, _release_process_memory

logger = logging.getLogger(__name__)

router = APIRouter()

TRIPO_API_URL = os.getenv("TRIPO_API_URL", "https://api.tripo3d.ai/v2/openapi").rstrip("/")

UPLOAD_DIR = MODEL_UPLOAD_DIR
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Proxy for external API calls (e.g. Tripo). Set HTTP_PROXY in .env if needed.
_PROXY_URL = os.getenv("HTTP_PROXY") or os.getenv("HTTPS_PROXY") or os.getenv("ALL_PROXY") or None

def _make_client(**kwargs) -> httpx.AsyncClient:
    """Create httpx client with optional proxy from env."""
    if _PROXY_URL:
        kwargs.setdefault("proxy", _PROXY_URL)
    return httpx.AsyncClient(**kwargs)


async def _tripo_post_with_retries(
    client: httpx.AsyncClient,
    url: str,
    *,
    action: str,
    attempts: int = 2,
    **kwargs,
) -> httpx.Response:
    for attempt in range(1, attempts + 1):
        try:
            return await client.post(url, **kwargs)
        except httpx.HTTPError as exc:
            if attempt >= attempts:
                logger.error(
                    "%s failed after %d attempts: %s: %r",
                    action,
                    attempt,
                    type(exc).__name__,
                    exc,
                    exc_info=True,
                )
                raise HTTPException(
                    status_code=502,
                    detail=f"{action}失败：无法连接 Tripo API（{type(exc).__name__}），请稍后重试或检查代理。",
                ) from exc
            logger.warning(
                "%s failed on attempt %d/%d: %s: %r; retrying",
                action,
                attempt,
                attempts,
                type(exc).__name__,
                exc,
            )
            await asyncio.sleep(0.8 * attempt)

    raise HTTPException(status_code=502, detail=f"{action}失败：无法连接 Tripo API")


def _get_api_key() -> str:
    key = os.getenv("TRIPO_API_KEY", "")
    if not key or key.startswith("your-"):
        raise HTTPException(status_code=503, detail="未配置 TRIPO_API_KEY，请在 backend/.env 中设置")
    if not key.startswith("tsk_"):
        raise HTTPException(
            status_code=503,
            detail=f"TRIPO_API_KEY 格式错误：当前以 '{key[:5]}...' 开头，Tripo API 要求以 'tsk_' 开头。请到 https://platform.tripo3d.ai 重新生成 API Key。"
        )
    return key


def _tripo_headers(api_key: str) -> dict[str, str]:
    """Build common headers for Tripo API calls, including China region if configured."""
    headers = {"Authorization": f"Bearer {api_key}"}
    if os.getenv("TRIPO_REGION", "").lower() in ("cn", "china", "rg2"):
        headers["X-Tripo-Region"] = "rg2"
    return headers


async def _upload_file_to_tripo(file_path: str, api_key: str) -> str:
    async with _make_client(timeout=60.0) as client:
        filename = os.path.basename(file_path)
        with open(file_path, "rb") as f:
            resp = await _tripo_post_with_retries(
                client,
                f"{TRIPO_API_URL}/upload",
                action="Tripo 图片上传",
                headers=_tripo_headers(api_key),
                files={"file": (filename, f, "application/octet-stream")},
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Tripo upload failed: {resp.text}")
        data = resp.json()
        if data.get("code") != 0:
            raise HTTPException(status_code=502, detail=data.get("message", "Upload error"))
        return data["data"]["image_token"]


# model_version mapping: user-facing quality tier → Tripo model version
_QUALITY_TO_MODEL_VERSION = {
    "fast": "Turbo-v1.0-20250506",
    "quality": "v2.5-20250123",
    "pro": "v3.0-20250812",
}

@router.post("/image-to-3d")
async def image_to_3d(
    file: UploadFile = File(...),
    quality: str = Form("fast"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    api_key = _get_api_key()
    model_version = _QUALITY_TO_MODEL_VERSION.get(quality, _QUALITY_TO_MODEL_VERSION["fast"])

    safe_name = safe_filename(file.filename or "")
    file_ext = os.path.splitext(safe_name)[1].lower() or ".jpg"
    image_filename = f"{uuid.uuid4()}{file_ext}"
    image_path = os.path.join(UPLOAD_DIR, image_filename)

    try:
        await save_upload_file(
            file,
            image_path,
            max_size=20 * 1024 * 1024,
            too_large_detail="图片不能超过 20MB",
        )
        image_token = await _upload_file_to_tripo(image_path, api_key)

        async with _make_client(timeout=60.0) as client:
            task_headers = {**_tripo_headers(api_key), "Content-Type": "application/json"}
            resp = await _tripo_post_with_retries(
                client,
                f"{TRIPO_API_URL}/task",
                action="Tripo 图片生成任务创建",
                headers=task_headers,
                json={
                    "type": "image_to_model",
                    "model_version": model_version,
                    "file": {"type": "jpg", "file_token": image_token},
                },
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Tripo API error: {resp.text}")
            result = resp.json()
            if result.get("code") != 0:
                raise HTTPException(status_code=502, detail=result.get("message", "API error"))

            return {
                "success": True,
                "task_id": result["data"]["task_id"],
            }
    except HTTPException:
        raise
    except (httpx.HTTPError, OSError) as e:
        logger.error("Image-to-3D failed: %s: %r", type(e).__name__, e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"图片生成任务创建失败：{type(e).__name__}，请稍后重试或检查代理。")
    except Exception as e:
        logger.error("Image-to-3D unexpected error: %s: %r", type(e).__name__, e, exc_info=True)
        raise
    finally:
        remove_file_quietly(image_path)


QualityTier = Literal["fast", "quality", "pro"]


class TextTo3DRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1024)
    quality: QualityTier = "fast"

@router.post("/text-to-3d")
async def text_to_3d(
    request: TextTo3DRequest,
    current_user: User = Depends(get_current_user)
):
    api_key = _get_api_key()
    prompt = request.prompt.strip()
    if len(prompt) < 3:
        raise HTTPException(status_code=400, detail="描述至少需要 3 个字符")

    model_version = _QUALITY_TO_MODEL_VERSION[request.quality]
    payload = {
        "type": "text_to_model",
        "prompt": prompt,
        "model_version": model_version,
    }

    try:
        async with _make_client(timeout=60.0) as client:
            response = await client.post(
                f"{TRIPO_API_URL}/task",
                headers={**_tripo_headers(api_key), "Content-Type": "application/json"},
                json=payload,
            )

            if response.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Tripo API error: {response.text}")

            result = response.json()
            if result.get("code") != 0:
                raise HTTPException(status_code=502, detail=result.get("message", "API error"))

            task_data = result.get("data")
            if not isinstance(task_data, dict) or not task_data.get("task_id"):
                logger.warning(
                    "Text-to-3D response missing task_id. Response keys: %s",
                    list(result.keys()) if isinstance(result, dict) else type(result).__name__,
                )
                raise HTTPException(status_code=502, detail="Tripo API 返回格式异常：缺少 task_id")

            return {
                "success": True,
                "task_id": task_data["task_id"],
                "quality": request.quality,
                "model_version": model_version,
                "input_type": "text",
            }
    except HTTPException:
        raise
    except (httpx.HTTPError, OSError, KeyError, ValueError) as e:
        logger.error("Text-to-3D failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"文字生成任务创建失败: {str(e)}")
    except Exception as e:
        logger.error("Text-to-3D unexpected error: %s", e, exc_info=True)
        raise


@router.get("/task/{task_id}")
async def get_task_status(task_id: str):
    api_key = _get_api_key()

    try:
        async with _make_client(timeout=30.0) as client:
            response = await client.get(
                f"{TRIPO_API_URL}/task/{task_id}",
                headers=_tripo_headers(api_key),
            )

            if response.status_code != 200:
                raise HTTPException(status_code=502, detail="Tripo API 请求失败")

            data = response.json()
            if data.get("code") != 0:
                raise HTTPException(status_code=502, detail=data.get("message", "API error"))

            task_data = data.get("data", {})
            status = task_data.get("status", "unknown")

            # Log full Tripo response when task completes for debugging
            if status == "success":
                logger.info("Tripo task %s completed. Full task_data keys: %s", task_id, list(task_data.keys()))
                logger.info("Tripo task %s result: %s", task_id, task_data.get("result"))
                logger.info("Tripo task %s output: %s", task_id, task_data.get("output"))

            # Tripo API v2 returns output as flat URL strings:
            #   output.pbr_model = "https://..."
            #   output.model = "https://..."
            #   output.base_model = "https://..."
            # Prefer "output" (official field name), fallback to "result" for compat
            output_data = task_data.get("output") or task_data.get("result") or {}
            model_url = None
            if status == "success" and isinstance(output_data, dict):
                for key in ["pbr_model", "model", "base_model"]:
                    val = output_data.get(key)
                    # Official SDK: flat URL string. Legacy: nested {url: "..."}
                    if isinstance(val, str) and val:
                        model_url = val
                        logger.info("Tripo task %s: found model URL at output.%s", task_id, key)
                        break
                    elif isinstance(val, dict) and val.get("url"):
                        model_url = val["url"]
                        logger.info("Tripo task %s: found model URL at output.%s.url (legacy)", task_id, key)
                        break
                if not model_url:
                    logger.warning("Tripo task %s: NO model URL found in output! Keys: %s", task_id, list(output_data.keys()))

            return {
                "status": status,
                "task_id": task_id,
                "progress": task_data.get("progress", 0),
                "running_left_time": task_data.get("running_left_time"),
                "queuing_num": task_data.get("queuing_num"),
                "error_code": task_data.get("error_code"),
                "error_msg": task_data.get("error_msg"),
                "output": output_data if status == "success" else None,
                "model_url": model_url,
            }
    except HTTPException:
        raise
    except (httpx.HTTPError, KeyError, ValueError) as e:
        raise HTTPException(status_code=500, detail=f"查询任务状态失败: {str(e)}")
    except Exception as e:
        raise


@router.get("/balance")
async def check_balance(current_user: User = Depends(get_current_user)):
    api_key = _get_api_key()

    try:
        async with _make_client(timeout=10.0) as client:
            response = await client.get(
                f"{TRIPO_API_URL}/user/balance",
                headers=_tripo_headers(api_key),
            )

            if response.status_code != 200:
                return {"balance": 0, "currency": "credits", "message": "API 查询失败"}

            data = response.json()
            if data.get("code") != 0:
                return {"balance": 0, "currency": "credits", "message": data.get("message", "API error")}

            return data.get("data", {})
    except (httpx.HTTPError, OSError, KeyError, ValueError):
        return {"balance": 0, "currency": "credits", "message": "无法连接 Tripo API"}


@router.get("/download-model")
async def download_model_proxy(
    url: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    import urllib.parse

    ALLOWED_DOMAINS = {"tripo3d.ai", "tripo3d.com", "api.tripo3d.ai", "cdn.tripo3d.ai", "model-download.tripo3d.ai", "data-freetrial.tripo3d.ai", "amazonaws.com", "cloudfront.net"}

    try:
        decoded_url = urllib.parse.unquote(url)
        parsed = urllib.parse.urlparse(decoded_url)

        if parsed.scheme not in ("https", "http"):
            raise HTTPException(status_code=400, detail="仅支持 HTTP/HTTPS 协议")

        hostname = parsed.hostname or ""
        if not any(hostname == d or hostname.endswith(f".{d}") for d in ALLOWED_DOMAINS):
            raise HTTPException(status_code=403, detail=f"不允许从该域名下载: {hostname}")

        async with _make_client(timeout=180.0) as client:
            async with client.stream("GET", decoded_url, follow_redirects=True) as response:
                response.raise_for_status()

                ext = os.path.splitext(parsed.path)[1] or ".glb"
                filename = f"draft_{current_user.id}_{uuid.uuid4().hex[:8]}{ext}"
                local_path = os.path.join(UPLOAD_DIR, filename)
                file_size = await save_httpx_response_stream(
                    response,
                    local_path,
                    max_size=100 * 1024 * 1024,
                    too_large_detail="模型文件不能超过 100MB",
                )
                thumbnail_name = generate_model_thumbnail_file(local_path, file_size)

                draft = create_draft_model_record(
                    db,
                    current_user=current_user,
                    name=os.path.basename(parsed.path) or "AI 创作模型",
                    file_path=filename,
                    thumbnail_path=thumbnail_name,
                    source_type="ai_generated",
                )
                file_url = model_file_url(filename)
                return {
                    "success": True,
                    "local_url": file_url,
                    "filename": filename,
                    "model_id": draft.id,
                    "retention_expires_at": draft.retention_expires_at.isoformat() if draft.retention_expires_at else None,
                }

    except HTTPException:
        raise
    except (httpx.HTTPError, OSError) as e:
        logger.warning("Model download failed: %s, returning original URL", e)
        return {
            "success": False,
            "local_url": urllib.parse.unquote(url),
            "filename": None,
            "error": str(e)
        }
    except Exception as e:
        logger.warning("Model download unexpected error: %s, returning original URL", e)
        raise


TEMP_DIR = CONFIGURED_TEMP_DIR
os.makedirs(TEMP_DIR, exist_ok=True)

ALLOWED_3D_EXTENSIONS = {".obj", ".stl", ".3mf", ".step", ".glb", ".gltf"}

@router.post("/upload-temp")
async def upload_temp_model(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_3D_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {ext}")

    filename = f"draft_{current_user.id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    try:
        file_size = await save_upload_file(
            file,
            filepath,
            max_size=100 * 1024 * 1024,
            too_large_detail="文件不能超过 100MB",
        )
        if ext == ".gltf":
            with open(filepath, "rb") as f:
                _validate_gltf_upload(f.read())
    except Exception:
        remove_file_quietly(filepath)
        raise

    thumbnail_name = generate_model_thumbnail_file(filepath, file_size)

    model_fingerprint = hashlib.sha256()
    with open(filepath, "rb") as saved_file:
        for chunk in iter(lambda: saved_file.read(1024 * 1024), b""):
            model_fingerprint.update(chunk)

    draft = create_draft_model_record(
        db,
        current_user=current_user,
        name=safe_filename(file.filename or "") or "上传模型",
        file_path=filename,
        thumbnail_path=thumbnail_name,
        source_type="manual_upload_draft",
    )

    model_url = model_file_url(filename)
    preview_url = model_url
    browser_preview_extensions = {".glb", ".gltf", ".obj", ".stl", ".3mf"}

    def convert_to_glb():
        glb_filepath = None
        try:
            glb_filename = f"{os.path.splitext(filename)[0]}_preview.glb"
            glb_filepath = os.path.join(UPLOAD_DIR, glb_filename)
            mesh = _load_scene_or_mesh(filepath, skip_materials=True)
            try:
                _export_mesh_as_glb(mesh, glb_filepath)
            finally:
                mesh = None
                _release_process_memory()
            if not os.path.exists(glb_filepath) or os.path.getsize(glb_filepath) <= 0:
                raise RuntimeError("GLB preview file was not created")
            return model_file_url(glb_filename)
        except Exception as exc:
            remove_file_quietly(glb_filepath)
            logger.warning("Temporary model preview conversion failed for %s: %s", filename, exc)
            return None

    if ext not in browser_preview_extensions:
        glb_url = await run_heavy_task("临时模型预览转换", convert_to_glb)
        if glb_url:
            preview_url = glb_url

    return {
        "model_url": model_url,
        "preview_url": preview_url,
        "format": os.path.splitext(preview_url)[1].lstrip(".").lower() or ext.lstrip("."),
        "model_id": draft.id,
        "model_fingerprint": model_fingerprint.hexdigest(),
        "retention_expires_at": draft.retention_expires_at.isoformat() if draft.retention_expires_at else None,
    }


@router.get("/temp/{filename}")
async def serve_temp_model(filename: str):
    safe_name = safe_filename(filename)
    filepath = os.path.join(TEMP_DIR, safe_name)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(filepath)
