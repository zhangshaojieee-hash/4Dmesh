import os
import time
import logging
import asyncio
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(env_path)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("makerworld")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
from contextlib import suppress
from app.core.cleanup import cleanup_runtime_resources
from app.core.database import engine, Base, SessionLocal
from app.core.paths import UPLOAD_ROOT, ensure_upload_dirs
from app.core.sqlite_migrations import migrate_sqlite_database
from sqlalchemy import text
from app.api import models, users, gcode, ai, print_history, comments, follows, voice, favorites, device, projects, discovery, admin, notifications, community
from app.models import PrintHistory, Comment


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000
        if not request.url.path.startswith("/health"):
            logger.info("%s %s → %d (%.0fms)", request.method, request.url.path, response.status_code, duration_ms)
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


def migrate_db():
    migrate_sqlite_database(engine)


async def cleanup_runtime_files_periodically():
    interval_seconds = max(300, int(float(os.getenv("RUNTIME_CLEANUP_INTERVAL_SECONDS", "21600"))))
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await asyncio.to_thread(cleanup_runtime_resources)
        except Exception:
            logger.exception("Runtime cleanup failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_upload_dirs()
    Base.metadata.create_all(bind=engine)
    migrate_db()
    await asyncio.to_thread(cleanup_runtime_resources)
    cleanup_task = asyncio.create_task(cleanup_runtime_files_periodically())
    logger.info("MakerWorld API started")
    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task

app = FastAPI(
    title="MakerWorld Platform API",
    description="3D Model Platform with Gcode and AI features",
    version="0.1.0",
    lifespan=lifespan
)

cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174")
cors_origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "MakerWorld Platform API", "version": "0.1.0"}

@app.get("/health")
async def health():
    checks = {"api": "ok"}
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"
    checks["uploads_writable"] = "ok" if os.access(UPLOAD_ROOT, os.W_OK) else "error: not writable"
    status = "healthy" if all(v == "ok" for v in checks.values()) else "degraded"
    return {"status": status, "checks": checks}

app.include_router(favorites.router, prefix="/api/models", tags=["Favorites"])
app.include_router(models.router, prefix="/api/models", tags=["Models"])
app.include_router(users.router, prefix="/api/users", tags=["Users"])
app.include_router(gcode.router, prefix="/api/gcode", tags=["Gcode"])
app.include_router(ai.router, prefix="/api/ai", tags=["AI"])
app.include_router(print_history.router, prefix="/api/print-history", tags=["PrintHistory"])
app.include_router(comments.router, prefix="/api/comments", tags=["Comments"])
app.include_router(follows.router, prefix="/api/users", tags=["Follows"])
app.include_router(voice.router, prefix="/api/voice", tags=["Voice"])
app.include_router(device.router, prefix="/api/devices", tags=["Devices"])
app.include_router(projects.router, prefix="/api/projects", tags=["Projects"])
app.include_router(discovery.router, tags=["Discovery"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(community.router, prefix="/api/community", tags=["Community"])
