import os
import shutil
from pathlib import Path

import aiofiles
import httpx
from fastapi import HTTPException, UploadFile


DEFAULT_CHUNK_SIZE = 1024 * 1024


def safe_filename(filename: str) -> str:
    normalized = str(filename).replace("\\", "/")
    return os.path.basename(normalized).replace("..", "").replace("/", "").replace("\\", "")


def remove_file_quietly(path: str | os.PathLike[str] | None) -> None:
    if not path:
        return
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        pass


def remove_dir_quietly(path: str | os.PathLike[str] | None) -> None:
    if not path:
        return
    try:
        shutil.rmtree(path)
    except FileNotFoundError:
        pass
    except NotADirectoryError:
        remove_file_quietly(path)
    except OSError:
        pass


async def save_upload_file(
    upload: UploadFile,
    destination: str | os.PathLike[str],
    *,
    max_size: int,
    too_large_detail: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> int:
    destination_path = Path(destination)
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination_path.with_name(f"{destination_path.name}.uploading")
    total_size = 0

    try:
        async with aiofiles.open(temp_path, "wb") as output:
            while chunk := await upload.read(chunk_size):
                total_size += len(chunk)
                if total_size > max_size:
                    raise HTTPException(status_code=400, detail=too_large_detail)
                await output.write(chunk)
        os.replace(temp_path, destination_path)
        return total_size
    except Exception:
        remove_file_quietly(temp_path)
        remove_file_quietly(destination_path)
        raise


async def save_httpx_response_stream(
    response: httpx.Response,
    destination: str | os.PathLike[str],
    *,
    max_size: int | None = None,
    too_large_detail: str = "下载文件过大",
) -> int:
    destination_path = Path(destination)
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination_path.with_name(f"{destination_path.name}.download")
    total_size = 0

    try:
        async with aiofiles.open(temp_path, "wb") as output:
            async for chunk in response.aiter_bytes(DEFAULT_CHUNK_SIZE):
                total_size += len(chunk)
                if max_size is not None and total_size > max_size:
                    raise HTTPException(status_code=400, detail=too_large_detail)
                await output.write(chunk)
        os.replace(temp_path, destination_path)
        return total_size
    except Exception:
        remove_file_quietly(temp_path)
        remove_file_quietly(destination_path)
        raise
