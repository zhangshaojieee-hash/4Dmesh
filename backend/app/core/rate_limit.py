import time
from collections import defaultdict
from fastapi import HTTPException, Request


class InMemoryRateLimiter:
    def __init__(self, max_requests: int = 5, window_seconds: int = 60):
        self._max = max_requests
        self._window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str) -> None:
        now = time.monotonic()
        hits = self._hits[key]
        self._hits[key] = [t for t in hits if now - t < self._window]
        if len(self._hits[key]) >= self._max:
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
        self._hits[key].append(now)


auth_limiter = InMemoryRateLimiter(max_requests=5, window_seconds=60)


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
