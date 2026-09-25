import os
import logging
import json
import asyncio
import importlib
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.notifications import create_notification
from app.api.users import get_current_user
from app.core.database import get_db
from app.core.file_io import safe_filename
from app.core.paths import GCODE_DIR, SLICE_OUTPUT_DIR
from app.models import Device, Model, PrintHistory, User

logger = logging.getLogger(__name__)
router = APIRouter()

JsonDict = dict[str, Any]
MOONRAKER_URL = os.getenv("MOONRAKER_URL", "http://localhost:7125")
STATUS_QUERY_PATH = "/printer/objects/query?extruder&heater_bed&print_stats&display_status&virtual_sdcard"
MOONRAKER_STATUS_OBJECTS = {
    "toolhead": ["position", "status"],
    "extruder": ["temperature", "target"],
    "heater_bed": ["temperature", "target"],
    "print_stats": ["state", "filename", "print_duration", "total_duration", "filament_used", "info"],
    "display_status": ["progress"],
    "virtual_sdcard": ["progress", "file_position", "is_active"],
}


def _normalize_host_input(raw_value: str, default_port: int = 7125) -> tuple[str, str, str]:
    candidate = (raw_value or "").strip()
    if not candidate:
        raise ValueError("Invalid host or IP address.")

    if "://" not in candidate:
        candidate = f"http://{candidate}"

    try:
        parsed = urlsplit(candidate)
    except ValueError as exc:
        raise ValueError("Invalid host or IP address.") from exc

    if not parsed.hostname:
        raise ValueError("Invalid host or IP address.")

    host = parsed.hostname.strip()
    if not host:
        raise ValueError("Invalid host or IP address.")

    scheme = "https" if parsed.scheme == "wss" else "http" if parsed.scheme in {"", "ws"} else parsed.scheme
    port = parsed.port or default_port
    formatted_host = f"[{host}]" if ":" in host and not host.startswith("[") else host
    moonraker_url = f"{scheme}://{formatted_host}:{port}"
    fluidd_url = f"{scheme}://{formatted_host}"
    return host, moonraker_url, fluidd_url


def _input_has_explicit_port(raw_value: str) -> bool:
    candidate = (raw_value or "").strip()
    if not candidate:
        return False
    if "://" not in candidate:
        candidate = f"http://{candidate}"
    try:
        return urlsplit(candidate).port is not None
    except ValueError:
        return False


def _candidate_connections(raw_value: str) -> list[tuple[str, str, str]]:
    primary = _normalize_host_input(raw_value, default_port=7125)
    if _input_has_explicit_port(raw_value):
        return [primary]

    candidates = [primary, _normalize_host_input(raw_value, default_port=80)]
    unique: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for candidate in candidates:
        if candidate[1] in seen:
            continue
        seen.add(candidate[1])
        unique.append(candidate)
    return unique


def _moonraker_ws_details(moonraker_url: str) -> tuple[str, str]:
    parsed = urlsplit(moonraker_url)
    ws_scheme = "wss" if parsed.scheme == "https" else "ws"
    ws_url = f"{ws_scheme}://{parsed.netloc}/websocket"
    origin = f"{parsed.scheme or 'http'}://{parsed.netloc}"
    return ws_url, origin


async def _moonraker_get(path: str, moonraker_url: str = MOONRAKER_URL) -> JsonDict:
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            resp = await client.get(f"{moonraker_url}{path}")
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, dict) else {}
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail=f"请求 Moonraker 超时: {moonraker_url}")
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail=f"无法连接到 Moonraker: {moonraker_url}")
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=str(exc))


async def _moonraker_post(
    path: str,
    json_data: Optional[JsonDict] = None,
    moonraker_url: str = MOONRAKER_URL,
) -> JsonDict:
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.post(f"{moonraker_url}{path}", json=json_data or {})
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, dict) else {}
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail=f"请求 Moonraker 超时: {moonraker_url}")
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail=f"无法连接到 Moonraker: {moonraker_url}")
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=str(exc))


def _moonraker_http_result(response: httpx.Response) -> Any:
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"Moonraker 返回了非 JSON 响应: {exc}")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Moonraker 返回格式异常")
    if "error" in payload:
        raise HTTPException(status_code=502, detail=_jsonrpc_error_detail(payload.get("error")))
    return payload.get("result", payload)


def _jsonrpc_error_detail(error_payload: Any) -> str:
    if isinstance(error_payload, dict):
        message = error_payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
        return json.dumps(error_payload, ensure_ascii=False)
    return str(error_payload or "Moonraker JSON-RPC error")


async def _moonraker_rpc_message(
    moonraker_url: str,
    method: str,
    params: Optional[JsonDict] = None,
    timeout: float = 6.0,
) -> JsonDict:
    try:
        websockets_module = importlib.import_module("websockets")
        ws_connect = getattr(websockets_module, "connect")
    except (ImportError, AttributeError) as exc:
        raise HTTPException(status_code=503, detail=f"WebSocket Moonraker 客户端不可用: {exc}")

    ws_url, origin = _moonraker_ws_details(moonraker_url)
    request_id = 1001
    request_payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params or {},
        "id": request_id,
    }

    try:
        async with ws_connect(ws_url, origin=origin, open_timeout=timeout, close_timeout=1) as websocket:
            await websocket.send(json.dumps(request_payload, ensure_ascii=False))
            while True:
                raw_message = await asyncio.wait_for(websocket.recv(), timeout=timeout)
                message = json.loads(raw_message)
                if not isinstance(message, dict):
                    continue
                if message.get("method") == "notify_ping":
                    continue
                if message.get("id") != request_id:
                    continue
                if "error" in message:
                    raise HTTPException(status_code=502, detail=_jsonrpc_error_detail(message.get("error")))
                return message
    except HTTPException:
        raise
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=f"Moonraker WebSocket 请求超时: {moonraker_url}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"Moonraker WebSocket 返回格式错误: {exc}")
    except OSError as exc:
        raise HTTPException(status_code=503, detail=f"无法连接到 Moonraker WebSocket: {moonraker_url} ({exc})")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"无法连接到 Moonraker WebSocket: {moonraker_url} ({exc})")


async def _moonraker_rpc_result(
    moonraker_url: str,
    method: str,
    params: Optional[JsonDict] = None,
    timeout: float = 6.0,
) -> Any:
    message = await _moonraker_rpc_message(moonraker_url, method, params, timeout)
    return message.get("result")


async def _moonraker_server_info(moonraker_url: str) -> JsonDict:
    result = await _moonraker_rpc_result(moonraker_url, "server.info", timeout=6.0)
    return result if isinstance(result, dict) else {}


async def _moonraker_status_snapshot(moonraker_url: str) -> JsonDict:
    result = await _moonraker_rpc_result(
        moonraker_url,
        "printer.objects.subscribe",
        {"objects": MOONRAKER_STATUS_OBJECTS},
        timeout=6.0,
    )
    if not isinstance(result, dict):
        return {}
    status = result.get("status")
    return status if isinstance(status, dict) else {}


async def _moonraker_send_gcode(moonraker_url: str, script: str) -> None:
    normalized_script = script.strip()
    if not normalized_script:
        raise HTTPException(status_code=400, detail="G-code 指令不能为空")
    await _moonraker_rpc_result(
        moonraker_url,
        "printer.gcode.script",
        {"script": normalized_script},
        timeout=10.0,
    )


class DeviceVerifyRequest(BaseModel):
    host: Optional[str] = None
    moonrakerUrl: Optional[str] = None
    moonraker_url: Optional[str] = None


class DeviceCreateRequest(DeviceVerifyRequest):
    name: str


class DeviceUpdateRequest(DeviceVerifyRequest):
    name: Optional[str] = None


class TempRequest(BaseModel):
    temp: float


class GcodeRequest(BaseModel):
    gcode: str


class UploadGcodeRequest(BaseModel):
    filename: str
    start_print: bool = False
    model_id: Optional[int] = None
    model_name: Optional[str] = None


def _extract_host_input(
    host: Optional[str] = None,
    moonraker_url: Optional[str] = None,
    moonraker_url_snake: Optional[str] = None,
) -> str:
    raw_value = (host or moonraker_url or moonraker_url_snake or "").strip()
    if not raw_value:
        raise HTTPException(status_code=400, detail="host is required")
    return raw_value


def _owner_id(user: User) -> int:
    return int(user.id)


def _parse_device_id(device_id: str) -> int:
    try:
        return int(device_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="设备不存在")


def _get_device(db: Session, device_id: str, owner_id: int) -> Device:
    device = db.query(Device).filter(
        Device.id == _parse_device_id(device_id),
        Device.user_id == owner_id,
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    return device


def _find_device_by_host(
    db: Session,
    host: str,
    moonraker_url: Optional[str] = None,
    owner_id: Optional[int] = None,
) -> Optional[Device]:
    endpoint = moonraker_url or f"http://{host}:7125"
    query = db.query(Device).filter(or_(Device.host == host, Device.moonraker_url == endpoint))
    if owner_id is None:
        return query.first()
    return query.filter(Device.user_id == owner_id).first()


def _as_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _format_time(seconds: float) -> str:
    whole_seconds = max(int(seconds), 0)
    hours = whole_seconds // 3600
    minutes = (whole_seconds % 3600) // 60
    return f"{hours}h {minutes:02d}m"


def _format_device_timestamp(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def _device_base_payload(device: Device) -> JsonDict:
    return {
        "id": str(device.id),
        "name": device.name,
        "host": device.host,
        "moonrakerUrl": device.moonraker_url,
        "moonraker_url": device.moonraker_url,
        "fluiddUrl": device.fluidd_url,
        "fluidd_url": device.fluidd_url,
        "createdAt": _format_device_timestamp(device.created_at),
        "updatedAt": _format_device_timestamp(device.updated_at),
    }


def _safe_gcode_filename(filename: str) -> str:
    raw_name = (filename or "").strip()
    safe_name = safe_filename(raw_name)
    if not safe_name or safe_name != raw_name or ".." in safe_name:
        raise HTTPException(status_code=400, detail="G-code 文件名无效")
    return safe_name


def _is_probably_moonraker_response(result: Any) -> bool:
    if not isinstance(result, dict):
        return False
    expected_keys = {
        "moonraker_version",
        "klippy_state",
        "klippy_connected",
        "warnings",
        "failed_components",
        "registered_directories",
    }
    return any(key in result for key in expected_keys)


def _connect_error_payload(message: str) -> tuple[str, str]:
    lowered = message.lower()
    if "refused" in lowered or "10061" in lowered or "actively refused" in lowered:
        return "connection_refused", "Connection refused while connecting to Moonraker."
    return "unknown", "Unable to connect to the requested host."


async def _verify_moonraker_host(raw_host: str) -> JsonDict:
    logger.info(f"[VERIFY] Starting verification for host: {raw_host}")

    try:
        candidates = _candidate_connections(raw_host)
        logger.info("[VERIFY] Candidate Moonraker endpoints: %s", [candidate[1] for candidate in candidates])
    except ValueError as exc:
        logger.warning(f"[VERIFY] Invalid host format: {exc}")
        return {
            "success": False,
            "verified": False,
            "reasonCode": "invalid_host",
            "message": str(exc),
        }

    last_failure: Optional[JsonDict] = None

    for host, moonraker_url, fluidd_url in candidates:
        base_payload = {
            "host": host,
            "moonrakerUrl": moonraker_url,
            "moonraker_url": moonraker_url,
            "fluiddUrl": fluidd_url,
            "fluidd_url": fluidd_url,
        }

        try:
            logger.info("[VERIFY] Attempting Moonraker WebSocket connection to %s", moonraker_url)
            result = await _moonraker_server_info(moonraker_url)
            logger.info("[VERIFY] WebSocket connection successful")
        except HTTPException as exc:
            logger.warning("[VERIFY] WebSocket verification failed for %s: %s", moonraker_url, exc.detail)
            reason_code = "timeout" if exc.status_code == 504 else "connection_refused" if exc.status_code == 503 else "moonraker_error"
            last_failure = {
                **base_payload,
                "success": False,
                "verified": False,
                "reasonCode": reason_code,
                "message": str(exc.detail),
            }
            continue
        except Exception as exc:
            logger.error("[VERIFY] Unexpected error: %s", exc, exc_info=True)
            last_failure = {
                **base_payload,
                "success": False,
                "verified": False,
                "reasonCode": "unknown",
                "message": f"Unexpected verification failure: {exc}",
            }
            continue

        if not _is_probably_moonraker_response(result):
            logger.warning("[VERIFY] Response does not match Moonraker signature")
            last_failure = {
                **base_payload,
                "success": False,
                "verified": False,
                "reasonCode": "not_moonraker",
                "message": "Host responded, but it does not appear to be Moonraker.",
            }
            continue

        klippy_state = str(result.get("klippy_state") or "unknown")
        klippy_connected = result.get("klippy_connected")
        moonraker_version = result.get("moonraker_version")

        reason_code = "verified"
        message = "Moonraker verified successfully."
        warning_code = None
        warning_message = None
        if klippy_state != "ready":
            logger.info("[VERIFY] Klippy state is '%s' (not ready)", klippy_state)
            reason_code = "klippy_not_ready"
            message = f"Moonraker is reachable, but Klippy state is '{klippy_state}'."
            warning_code = "klippy_not_ready"
            warning_message = message
        else:
            logger.info("[VERIFY] Verification successful - Klippy ready, version: %s", moonraker_version)

        return {
            **base_payload,
            "success": True,
            "verified": True,
            "reasonCode": reason_code,
            "message": message,
            "warningCode": warning_code,
            "warningMessage": warning_message,
            "moonrakerVersion": moonraker_version,
            "klippyState": klippy_state,
            "klippyConnected": klippy_connected,
        }

    return last_failure or {
        "success": False,
        "verified": False,
        "reasonCode": "unknown",
        "message": "Unable to connect to the requested Moonraker host.",
    }


def _telemetry_from_status(status_result: JsonDict, fallback_state: str = "unknown") -> JsonDict:
    extruder_raw = status_result.get("extruder")
    extruder: JsonDict = extruder_raw if isinstance(extruder_raw, dict) else {}
    
    bed_raw = status_result.get("heater_bed")
    bed: JsonDict = bed_raw if isinstance(bed_raw, dict) else {}
    
    stats_raw = status_result.get("print_stats")
    stats: JsonDict = stats_raw if isinstance(stats_raw, dict) else {}
    
    display_raw = status_result.get("display_status")
    display: JsonDict = display_raw if isinstance(display_raw, dict) else {}
    
    sdcard_raw = status_result.get("virtual_sdcard")
    sdcard: JsonDict = sdcard_raw if isinstance(sdcard_raw, dict) else {}
    
    info_raw = stats.get("info")
    info: JsonDict = info_raw if isinstance(info_raw, dict) else {}

    progress_fraction = _as_float(sdcard.get("progress")) or _as_float(display.get("progress"))
    progress_percent = round(progress_fraction * 100, 1)
    print_duration = _as_float(stats.get("print_duration"))
    total_duration = _as_float(stats.get("total_duration"))
    elapsed = print_duration or total_duration

    remaining = 0.0
    if progress_fraction > 0 and print_duration > 0:
        remaining = (print_duration / progress_fraction) * (1 - progress_fraction)

    filament_used_m = _as_float(stats.get("filament_used")) / 1000
    state = str(stats.get("state") or fallback_state or "unknown")
    if state == "ready":
        state = "standby"
    elif state == "complete":
        state = "standby"
    elif state and state not in {"standby", "printing", "paused", "error", "offline"}:
        state = "error" if state == "cancelled" else "unknown"

    print_name = str(stats.get("filename") or "")
    if not print_name:
        if state == "offline":
            print_name = "设备离线"
        elif state == "standby":
            print_name = "待机中"

    current_layer = info.get("current_layer") or info.get("currentLayer") or 0
    total_layers = info.get("total_layer") or info.get("totalLayers") or 0

    return {
        "nozzleTemp": round(_as_float(extruder.get("temperature")), 1),
        "nozzleTarget": round(_as_float(extruder.get("target")), 1),
        "bedTemp": round(_as_float(bed.get("temperature")), 1),
        "bedTarget": round(_as_float(bed.get("target")), 1),
        "progress": progress_percent,
        "currentLayer": int(current_layer or 0),
        "totalLayers": int(total_layers or 0),
        "timeElapsed": _format_time(elapsed),
        "timeRemaining": _format_time(remaining) if remaining > 0 else "--",
        "filamentUsed": f"{filament_used_m:.1f}m",
        "printName": print_name,
        "state": state,
    }


async def _build_device_snapshot(device: Device) -> JsonDict:
    payload = _device_base_payload(device)

    try:
        info_result = await _moonraker_server_info(device.moonraker_url)
        klippy_state = str(info_result.get("klippy_state") or "unknown")
        mapped_state = "standby" if klippy_state == "ready" else klippy_state

        payload.update(
            {
                "status": "online",
                "klippyState": klippy_state,
                "klippyConnected": info_result.get("klippy_connected"),
                "moonrakerVersion": info_result.get("moonraker_version"),
            }
        )
    except HTTPException as exc:
        payload.update(
            {
                "status": "offline",
                "isPrinting": False,
                "state": "offline",
                "nozzleTemp": 0.0,
                "nozzleTarget": 0.0,
                "bedTemp": 0.0,
                "bedTarget": 0.0,
                "progress": 0.0,
                "currentLayer": 0,
                "totalLayers": 0,
                "timeElapsed": "--",
                "timeRemaining": "--",
                "filamentUsed": "0.0m",
                "printName": "设备离线",
                "errorMessage": exc.detail,
            }
        )
        return payload

    try:
        status_result = await _moonraker_status_snapshot(device.moonraker_url)
        telemetry = _telemetry_from_status(status_result, fallback_state=mapped_state)
    except HTTPException as exc:
        telemetry = {
            "nozzleTemp": 0.0,
            "nozzleTarget": 0.0,
            "bedTemp": 0.0,
            "bedTarget": 0.0,
            "progress": 0.0,
            "currentLayer": 0,
            "totalLayers": 0,
            "timeElapsed": "0h 00m",
            "timeRemaining": "--",
            "filamentUsed": "0.0m",
            "printName": "待机中" if mapped_state == "standby" else "",
            "state": mapped_state,
        }
        payload.update(
            {
                "warningCode": "status_unavailable",
                "warningMessage": exc.detail,
            }
        )

    payload.update(telemetry)
    payload["state"] = telemetry.get("state") or mapped_state
    payload["isPrinting"] = payload["state"] == "printing"
    return payload


@router.post("/verify")
async def verify_device(request: DeviceVerifyRequest, _: User = Depends(get_current_user)) -> JsonDict:
    host = _extract_host_input(request.host, request.moonrakerUrl, request.moonraker_url)
    logger.info(f"[API /verify] Received verification request for host: {host}")
    result = await _verify_moonraker_host(host)
    logger.info(f"[API /verify] Verification result: success={result.get('success')}, reasonCode={result.get('reasonCode')}")
    return result


@router.get("")
async def list_devices(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[JsonDict]:
    logger.info("[API /devices] Listing all devices")
    owner_id = _owner_id(current_user)
    devices = db.query(Device).filter(Device.user_id == owner_id).order_by(Device.id.asc()).all()
    
    logger.info(f"[API /devices] Found {len(devices)} devices in database")
    results: list[JsonDict] = []
    for device in devices:
        results.append(await _build_device_snapshot(device))
    return results


@router.get("/list")
async def list_devices_legacy(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[JsonDict]:
    return await list_devices(current_user, db)


@router.post("")
async def create_device(
    request: DeviceCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JsonDict:
    name = request.name.strip()
    owner_id = _owner_id(current_user)
    logger.info(f"[API /devices POST] Creating device: name={name}")
    
    if not name:
        logger.warning("[API /devices POST] Rejected: empty name")
        raise HTTPException(status_code=400, detail="name is required")

    raw_host = _extract_host_input(request.host, request.moonrakerUrl, request.moonraker_url)
    logger.info(f"[API /devices POST] Verifying host: {raw_host}")
    
    verification = await _verify_moonraker_host(raw_host)
    if not verification.get("success"):
        logger.warning(f"[API /devices POST] Verification failed: {verification.get('reasonCode')}")
        raise HTTPException(status_code=400, detail=verification)

    host = str(verification["host"])
    moonraker_url = str(verification["moonrakerUrl"])
    fluidd_url = str(verification["fluiddUrl"])

    existing = _find_device_by_host(db, host, moonraker_url, owner_id)
    if existing:
        logger.warning(f"[API /devices POST] Rejected: device with host {host} already exists (id={existing.id})")
        raise HTTPException(status_code=409, detail="A device with the same host already exists.")

    device = Device(
        name=name,
        host=host,
        moonraker_url=moonraker_url,
        fluidd_url=fluidd_url,
        user_id=owner_id,
    )
    db.add(device)
    db.commit()
    db.refresh(device)

    logger.info(f"[API /devices POST] Device created successfully: id={device.id}, name={name}, host={host}")
    
    payload = await _build_device_snapshot(device)
    payload.update(
        {
            "reasonCode": verification.get("reasonCode"),
            "message": verification.get("message"),
            "warningCode": verification.get("warningCode") or payload.get("warningCode"),
            "warningMessage": verification.get("warningMessage") or payload.get("warningMessage"),
        }
    )
    return payload


@router.post("/add")
async def create_device_legacy(
    request: DeviceCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JsonDict:
    return await create_device(request, current_user, db)


@router.put("/{device_id}")
async def update_device(
    device_id: str,
    request: DeviceUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JsonDict:
    logger.info(f"[API /devices/{device_id} PUT] Updating device")
    owner_id = _owner_id(current_user)
    existing = _get_device(db, device_id, owner_id)

    incoming_name = request.name.strip() if request.name is not None else existing.name
    if not incoming_name:
        logger.warning(f"[API /devices/{device_id} PUT] Rejected: empty name")
        raise HTTPException(status_code=400, detail="name is required")

    raw_host = request.host or request.moonrakerUrl or request.moonraker_url
    next_host = existing.host
    next_moonraker_url = existing.moonraker_url
    next_fluidd_url = existing.fluidd_url
    verification: Optional[JsonDict] = None

    if raw_host is not None and raw_host.strip():
        logger.info(f"[API /devices/{device_id} PUT] Host change requested: {raw_host}")
        try:
            normalized_host, normalized_moonraker_url, _ = _normalize_host_input(raw_host)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        host_changed = normalized_host != existing.host or normalized_moonraker_url != existing.moonraker_url
        if host_changed:
            conflict = _find_device_by_host(db, normalized_host, normalized_moonraker_url, owner_id)
            if conflict and str(conflict.id) != device_id:
                logger.warning(f"[API /devices/{device_id} PUT] Rejected: host conflict with device id={conflict.id}")
                raise HTTPException(status_code=409, detail="A device with the same host already exists.")

            verification = await _verify_moonraker_host(raw_host)
            if not verification.get("success"):
                logger.warning(f"[API /devices/{device_id} PUT] Verification failed: {verification.get('reasonCode')}")
                raise HTTPException(status_code=400, detail=verification)

            next_host = str(verification["host"])
            next_moonraker_url = str(verification["moonrakerUrl"])
            next_fluidd_url = str(verification["fluiddUrl"])
            logger.info(f"[API /devices/{device_id} PUT] Host verified and updated")

    existing.name = incoming_name
    existing.host = next_host
    existing.moonraker_url = next_moonraker_url
    existing.fluidd_url = next_fluidd_url
    existing.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(existing)

    logger.info(f"[API /devices/{device_id} PUT] Device updated successfully")
    
    payload = await _build_device_snapshot(existing)
    if verification:
        payload.update(
            {
                "reasonCode": verification.get("reasonCode"),
                "message": verification.get("message"),
                "warningCode": verification.get("warningCode") or payload.get("warningCode"),
                "warningMessage": verification.get("warningMessage") or payload.get("warningMessage"),
            }
        )
    return payload


@router.delete("/{device_id}")
async def remove_device(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JsonDict:
    logger.info(f"[API /devices/{device_id} DELETE] Deleting device")
    owner_id = _owner_id(current_user)
    device = _get_device(db, device_id, owner_id)
    db.delete(device)
    db.commit()
    logger.info(f"[API /devices/{device_id} DELETE] Device deleted successfully")
    return {"ok": True, "success": True}


@router.get("/{device_id}/status")
async def get_device_status(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JsonDict:
    logger.info(f"[API /devices/{device_id}/status] Fetching device status")
    device = _get_device(db, device_id, _owner_id(current_user))
    snapshot = await _build_device_snapshot(device)
    if snapshot.get("status") == "offline":
        logger.warning(f"[API /devices/{device_id}/status] Device is offline")
        raise HTTPException(status_code=503, detail=snapshot.get("errorMessage") or "设备离线")

    return {
        "nozzleTemp": snapshot.get("nozzleTemp", 0.0),
        "nozzleTarget": snapshot.get("nozzleTarget", 0.0),
        "bedTemp": snapshot.get("bedTemp", 0.0),
        "bedTarget": snapshot.get("bedTarget", 0.0),
        "progress": snapshot.get("progress", 0.0),
        "currentLayer": snapshot.get("currentLayer", 0),
        "totalLayers": snapshot.get("totalLayers", 0),
        "timeElapsed": snapshot.get("timeElapsed", "0h 00m"),
        "timeRemaining": snapshot.get("timeRemaining", "--"),
        "filamentUsed": snapshot.get("filamentUsed", "0.0m"),
        "printName": snapshot.get("printName", "待机中"),
        "state": snapshot.get("state", "unknown"),
        "warningCode": snapshot.get("warningCode"),
        "warningMessage": snapshot.get("warningMessage"),
        "klippyState": snapshot.get("klippyState"),
    }


@router.post("/{device_id}/command/{command}")
async def send_command(
    device_id: str,
    command: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JsonDict:
    device = _get_device(db, device_id, _owner_id(current_user))

    gcode_map = {
        "pause": "PAUSE",
        "resume": "RESUME",
        "stop": "CANCEL_PRINT",
        "beep": "M300 S1000 P200",
    }

    gcode = gcode_map.get(command)
    if not gcode:
        raise HTTPException(status_code=400, detail=f"不支持的命令: {command}")

    await _moonraker_send_gcode(device.moonraker_url, gcode)
    return {"ok": True}


@router.post("/{device_id}/nozzle-temp")
async def set_nozzle_temp(
    device_id: str,
    req: TempRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JsonDict:
    device = _get_device(db, device_id, _owner_id(current_user))
    await _moonraker_send_gcode(device.moonraker_url, f"SET_HEATER_TEMPERATURE HEATER=extruder TARGET={req.temp}")
    return {"ok": True}


@router.post("/{device_id}/bed-temp")
async def set_bed_temp(
    device_id: str,
    req: TempRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JsonDict:
    device = _get_device(db, device_id, _owner_id(current_user))
    await _moonraker_send_gcode(device.moonraker_url, f"SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET={req.temp}")
    return {"ok": True}


@router.post("/{device_id}/gcode")
async def send_gcode(
    device_id: str,
    req: GcodeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JsonDict:
    device = _get_device(db, device_id, _owner_id(current_user))
    await _moonraker_send_gcode(device.moonraker_url, req.gcode)
    return {"ok": True}


@router.post("/{device_id}/upload-gcode")
async def upload_gcode_to_device(
    device_id: str,
    request: UploadGcodeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JsonDict:
    device = _get_device(db, device_id, _owner_id(current_user))
    safe_filename = _safe_gcode_filename(request.filename)

    candidate_paths = [
        os.path.join(SLICE_OUTPUT_DIR, safe_filename),
        os.path.join(GCODE_DIR, safe_filename),
    ]

    file_path = next((path for path in candidate_paths if os.path.isfile(path)), None)
    if not file_path:
        raise HTTPException(status_code=404, detail=f"文件不存在: {safe_filename}")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=5.0)) as client:
            with open(file_path, "rb") as file_handle:
                response = await client.post(
                    f"{device.moonraker_url}/server/files/upload",
                    data={"root": "gcodes", "print": "true" if request.start_print else "false"},
                    files={"file": (safe_filename, file_handle, "application/octet-stream")},
                )
                response.raise_for_status()
                upload_result_raw = _moonraker_http_result(response)

            upload_result: JsonDict = upload_result_raw if isinstance(upload_result_raw, dict) else {}
            item_raw = upload_result.get("item")
            item: JsonDict = item_raw if isinstance(item_raw, dict) else {}
            remote_path = str(item.get("path") or safe_filename)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail=f"请求 Moonraker 超时: {device.moonraker_url}")
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail=f"无法连接到 Moonraker: {device.moonraker_url}")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=str(exc))
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Moonraker 请求失败: {exc}")

    print_started = bool(upload_result.get("print_started", False))
    print_queued = bool(upload_result.get("print_queued", False))
    model_id = request.model_id
    if model_id is not None and not db.query(Model.id).filter(Model.id == model_id).first():
        model_id = None

    history = PrintHistory(
        user_id=current_user.id,
        model_id=model_id,
        device_id=device.id,
        model_name=(request.model_name or os.path.splitext(safe_filename)[0])[:255],
        gcode_filename=safe_filename,
        remote_path=remote_path,
        status="started" if request.start_print and print_started else "queued" if request.start_print and print_queued else "uploaded",
        started_at=datetime.now(timezone.utc),
        notes=f"Uploaded to {device.name}",
    )
    db.add(history)
    create_notification(
        db,
        user_id=current_user.id,
        type="print_started" if request.start_print else "gcode_uploaded",
        title="4D print started" if request.start_print and (print_started or print_queued) else "G-code uploaded",
        message=f"{safe_filename} uploaded to {device.name}",
        link="/profile?tab=prints",
    )
    db.commit()
    db.refresh(history)

    return {
        "success": True,
        "filename": safe_filename,
        "remotePath": remote_path,
        "remote_path": remote_path,
        "uploaded": True,
        "printStarted": print_started,
        "print_started": print_started,
        "printQueued": print_queued,
        "print_queued": print_queued,
        "history_id": history.id,
    }
