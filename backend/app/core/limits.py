import asyncio
import os
from contextvars import ContextVar
from contextlib import asynccontextmanager
from typing import AsyncIterator, TypeVar

from fastapi import HTTPException


T = TypeVar("T")
_heavy_task_depth: ContextVar[int] = ContextVar("heavy_task_depth", default=0)


def _positive_int_from_env(name: str, default: int) -> int:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return default
    try:
        value = int(raw_value)
    except ValueError:
        return default
    return max(1, value)


class HeavyTaskLimiter:
    def __init__(self, *, concurrency: int, queue_limit: int) -> None:
        self.concurrency = concurrency
        self.queue_limit = queue_limit
        self._active = 0
        self._waiting = 0
        self._condition = asyncio.Condition()

    @property
    def active(self) -> int:
        return self._active

    @property
    def waiting(self) -> int:
        return self._waiting

    def can_queue(self) -> bool:
        return (self._active + self._waiting) < (self.concurrency + self.queue_limit)

    async def acquire(self, label: str) -> None:
        async with self._condition:
            if self._active < self.concurrency:
                self._active += 1
                return
            if self._waiting >= self.queue_limit:
                raise HTTPException(
                    status_code=429,
                    detail=f"{label}任务繁忙，请稍后再试",
                )
            self._waiting += 1
            try:
                while self._active >= self.concurrency:
                    await self._condition.wait()
                self._waiting -= 1
                self._active += 1
            except Exception:
                self._waiting = max(0, self._waiting - 1)
                self._condition.notify_all()
                raise

    async def release(self) -> None:
        async with self._condition:
            self._active = max(0, self._active - 1)
            self._condition.notify_all()

    @asynccontextmanager
    async def run(self, label: str) -> AsyncIterator[None]:
        depth = _heavy_task_depth.get()
        if depth > 0:
            token = _heavy_task_depth.set(depth + 1)
            try:
                yield
            finally:
                _heavy_task_depth.reset(token)
            return

        await self.acquire(label)
        token = _heavy_task_depth.set(1)
        try:
            yield
        finally:
            _heavy_task_depth.reset(token)
            await self.release()


heavy_task_limiter = HeavyTaskLimiter(
    concurrency=_positive_int_from_env("HEAVY_TASK_CONCURRENCY", 1),
    queue_limit=_positive_int_from_env("HEAVY_TASK_QUEUE_LIMIT", 4),
)


async def run_heavy_task(label: str, func, /, *args, **kwargs):
    async with heavy_task_limiter.run(label):
        return await asyncio.to_thread(func, *args, **kwargs)
