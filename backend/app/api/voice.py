import os
import json
import base64
import hashlib
import hmac
import asyncio
import logging
from contextlib import suppress
from datetime import datetime
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

try:
    import websockets
except ImportError:
    websockets = None  # type: ignore

try:
    from openai import AsyncOpenAI
except ImportError:
    AsyncOpenAI = None  # type: ignore

router = APIRouter()
logger = logging.getLogger(__name__)

IFLYTEK_APP_ID = os.getenv("IFLYTEK_APP_ID", "")
IFLYTEK_API_KEY = os.getenv("IFLYTEK_API_KEY", "")
IFLYTEK_API_SECRET = os.getenv("IFLYTEK_API_SECRET", "")

AGNES_API_KEY = os.getenv("AGNES_API_KEY", "")
AGNES_BASE_URL = os.getenv("AGNES_BASE_URL", "https://apihub.agnes-ai.com/v1")
AGNES_MODEL = os.getenv("AGNES_MODEL", "agnes-2.0-flash")

SYSTEM_PROMPT = (
    "你是创客学堂的AI语音助手。用简洁友好的中文回答，每次不超过100字。"
    "你可以帮助用户：1.使用AI生成3D模型 2.指导打印机操作 "
    "3.解释4D打印流程 4.回答3D打印基础问题。"
)
MAX_SYSTEM_PROMPT_LENGTH = 800
MAX_USER_TEXT_LENGTH = 500
MAX_HISTORY_MESSAGES = 12
MAX_HISTORY_CHARS = 3600


def _normalize_system_prompt(value: object) -> str:
    if not isinstance(value, str):
        return SYSTEM_PROMPT
    prompt = value.strip()
    if not prompt:
        return SYSTEM_PROMPT
    return prompt[:MAX_SYSTEM_PROMPT_LENGTH]


def _normalize_user_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:MAX_USER_TEXT_LENGTH]


def _normalize_history(value: object) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, str]] = []
    total_chars = 0
    for item in value[-MAX_HISTORY_MESSAGES:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        if role not in {"user", "assistant"}:
            continue
        content = item.get("content")
        if not isinstance(content, str):
            continue
        text = content.strip()
        if not text:
            continue
        remaining = MAX_HISTORY_CHARS - total_chars
        if remaining <= 0:
            break
        clipped = text[: min(1200, remaining)]
        normalized.append({"role": role, "content": clipped})
        total_chars += len(clipped)

    return normalized


def _build_auth_url(api_url: str) -> str:
    parsed = urlparse(api_url)
    now = datetime.utcnow()
    date = now.strftime("%a, %d %b %Y %H:%M:%S GMT")

    signature_origin = f"host: {parsed.hostname}\ndate: {date}\nGET {parsed.path} HTTP/1.1"
    signature_sha = hmac.new(
        IFLYTEK_API_SECRET.encode(), signature_origin.encode(), digestmod=hashlib.sha256
    ).digest()
    signature = base64.b64encode(signature_sha).decode()

    authorization_origin = (
        f'api_key="{IFLYTEK_API_KEY}", algorithm="hmac-sha256", '
        f'headers="host date request-line", signature="{signature}"'
    )
    authorization = base64.b64encode(authorization_origin.encode()).decode()

    params = {"authorization": authorization, "date": date, "host": parsed.hostname}
    return f"{api_url}?{urlencode(params)}"


async def stt_recognize(audio_frames: list[bytes]) -> str:
    if not IFLYTEK_APP_ID or not IFLYTEK_API_KEY or not IFLYTEK_API_SECRET:
        return "[语音服务未配置]"

    url = _build_auth_url("wss://iat-api.xfyun.cn/v2/iat")
    result_text = ""

    try:
        async with websockets.connect(url) as ws:
            for i, frame in enumerate(audio_frames):
                status = 0 if i == 0 else (2 if i == len(audio_frames) - 1 else 1)
                data = {
                    "status": status,
                    "format": "audio/L16;rate=16000",
                    "encoding": "raw",
                    "audio": base64.b64encode(frame).decode(),
                }
                payload: dict[str, object] = {"data": data}
                if status == 0:
                    payload["common"] = {"app_id": IFLYTEK_APP_ID}
                    payload["business"] = {
                        "language": "zh_cn",
                        "domain": "iat",
                        "accent": "mandarin",
                        "vad_eos": 3000,
                        "dwa": "wpgs",
                        "ptt": 1,
                    }

                await ws.send(json.dumps(payload))
                if status == 0:
                    await asyncio.sleep(0.04)

            while True:
                try:
                    resp = await asyncio.wait_for(ws.recv(), timeout=5)
                    resp_data = json.loads(resp)
                    if resp_data.get("code") != 0:
                        break
                    for w in resp_data.get("data", {}).get("result", {}).get("ws", []):
                        for cw in w.get("cw", []):
                            result_text += cw.get("w", "")
                    if resp_data.get("data", {}).get("status") == 2:
                        break
                except asyncio.TimeoutError:
                    break
    except Exception as e:
        return f"[语音识别错误: {str(e)[:50]}]"

    return result_text.strip()


async def llm_chat(user_text: str, history: list[dict[str, str]], system_prompt: str = SYSTEM_PROMPT) -> str:
    if not AGNES_API_KEY:
        return "语音助手未配置，请在 .env 中设置 AGNES_API_KEY"
    if AsyncOpenAI is None:
        return "[AI回复错误: openai package unavailable]"

    client = AsyncOpenAI(
        api_key=AGNES_API_KEY,
        base_url=AGNES_BASE_URL,
    )

    messages = [{"role": "system", "content": _normalize_system_prompt(system_prompt)}]
    messages.extend(history[-10:])
    messages.append({"role": "user", "content": user_text})

    try:
        response = await client.chat.completions.create(
            model=AGNES_MODEL,
            messages=messages,
            max_tokens=200,
            temperature=0.7,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        return f"[AI回复错误: {str(e)[:50]}]"
    finally:
        with suppress(Exception):
            await client.close()


async def tts_synthesize(text: str) -> bytes:
    if not IFLYTEK_APP_ID or not IFLYTEK_API_KEY or not IFLYTEK_API_SECRET:
        return b""

    url = _build_auth_url("wss://tts-api.xfyun.cn/v2/tts")
    audio_data = bytearray()

    try:
        async with websockets.connect(url) as ws:
            payload = {
                "common": {"app_id": IFLYTEK_APP_ID},
                "business": {
                    "aue": "lame",
                    "auf": "audio/L16;rate=16000",
                    "vcn": "xiaoyan",
                    "tte": "UTF8",
                    "speed": 60,
                },
                "data": {"status": 2, "text": base64.b64encode(text.encode()).decode()},
            }
            await ws.send(json.dumps(payload))

            while True:
                try:
                    resp = await asyncio.wait_for(ws.recv(), timeout=10)
                    resp_data = json.loads(resp)
                    if resp_data.get("code") != 0:
                        break
                    audio_b64 = resp_data.get("data", {}).get("audio", "")
                    if audio_b64:
                        audio_data.extend(base64.b64decode(audio_b64))
                    if resp_data.get("data", {}).get("status") == 2:
                        break
                except asyncio.TimeoutError:
                    break
    except Exception as e:
        logger.warning("TTS synthesis failed: %s", e)

    return bytes(audio_data)


@router.websocket("/ws")
async def voice_chat(ws: WebSocket):
    await ws.accept()
    history: list[dict[str, str]] = []
    system_prompt = SYSTEM_PROMPT

    try:
        while True:
            msg = await ws.receive()

            if msg.get("type") != "websocket.receive":
                continue

            if "bytes" in msg and msg["bytes"]:
                raw = msg["bytes"]
                frames = [raw[i:i + 3200] for i in range(0, len(raw), 3200)]

                await ws.send_json({"type": "status", "text": "识别中..."})
                user_text = await stt_recognize(frames)

                if not user_text:
                    await ws.send_json({"type": "status", "text": "未识别到语音"})
                    continue

                await ws.send_json({"type": "stt", "text": user_text})
                await ws.send_json({"type": "status", "text": "思考中..."})

                reply = await llm_chat(user_text, history, system_prompt)
                history.append({"role": "user", "content": user_text})
                history.append({"role": "assistant", "content": reply})

                await ws.send_json({"type": "llm", "text": reply})
                await ws.send_json({"type": "status", "text": "合成语音..."})

                audio = await tts_synthesize(reply)
                if audio:
                    await ws.send_bytes(audio)

                await ws.send_json({"type": "done"})

            elif "text" in msg and msg["text"]:
                try:
                    data = json.loads(msg["text"])
                except json.JSONDecodeError:
                    await ws.send_json({"type": "status", "text": "消息格式错误"})
                    continue

                if data.get("type") == "config":
                    system_prompt = _normalize_system_prompt(data.get("system_prompt"))
                    if "history" in data:
                        history = _normalize_history(data.get("history"))
                    await ws.send_json({"type": "config", "text": "助手定制与上下文已应用"})
                    continue

                if data.get("type") == "text":
                    user_text = _normalize_user_text(data.get("text", ""))
                    if not user_text:
                        await ws.send_json({"type": "status", "text": "请输入问题"})
                        continue
                    await ws.send_json({"type": "status", "text": "思考中..."})

                    reply = await llm_chat(user_text, history, system_prompt)
                    history.append({"role": "user", "content": user_text})
                    history.append({"role": "assistant", "content": reply})

                    await ws.send_json({"type": "llm", "text": reply})

                    audio = await tts_synthesize(reply)
                    if audio:
                        await ws.send_bytes(audio)

                    await ws.send_json({"type": "done"})

    except WebSocketDisconnect:
        logger.debug("Voice assistant websocket disconnected")
    except Exception:
        try:
            await ws.close()
        except Exception as close_error:
            logger.debug("Voice assistant websocket close failed: %s", close_error)
