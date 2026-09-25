import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.paths import BACKEND_DIR, DATA_DIR_PATH

_BACKEND_DIR = os.fspath(BACKEND_DIR)
_DATA_DIR = os.fspath(DATA_DIR_PATH)


def _resolve_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        return f"sqlite:///{os.path.join(_DATA_DIR, 'makerworld.db')}"
    # Normalize a relative sqlite path to absolute against DATA_DIR, keeping the
    # previous backend-dir anchor when DATA_DIR is not configured.
    prefix = "sqlite:///"
    if url.startswith(prefix):
        path = url[len(prefix):]
        if path and not path.startswith("/") and not os.path.isabs(path):
            abs_path = os.path.normpath(os.path.join(_DATA_DIR, path))
            return f"sqlite:///{abs_path}"
    return url


DATABASE_URL = _resolve_database_url()

engine_kwargs = {}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_kwargs)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
