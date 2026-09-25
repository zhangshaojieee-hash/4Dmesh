#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Callable, TypeVar

from dotenv import load_dotenv
from sqlalchemy import create_engine, delete, text
from sqlalchemy.orm import Session, sessionmaker


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
DEFAULT_SQLITE_DB = BACKEND_DIR / "makerworld.db"
DEFAULT_ENV_FILE = BACKEND_DIR / ".env"

T = TypeVar("T")


def _bootstrap_imports() -> None:
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))


def _resolve_sqlite_url(path: Path) -> str:
    return f"sqlite:///{path.resolve()}"


def _load_models():
    _bootstrap_imports()
    from app.models import (  # type: ignore
        Base,
        Comment,
        Device,
        GcodeFile,
        Model,
        ModelFavorite,
        ModelLike,
        PrintHistory,
        Process4DTask,
        Project,
        User,
        UserFollow,
    )

    return {
        "Base": Base,
        "Comment": Comment,
        "Device": Device,
        "GcodeFile": GcodeFile,
        "Model": Model,
        "ModelFavorite": ModelFavorite,
        "ModelLike": ModelLike,
        "PrintHistory": PrintHistory,
        "Process4DTask": Process4DTask,
        "Project": Project,
        "User": User,
        "UserFollow": UserFollow,
    }


def _make_engine(url: str):
    kwargs: dict[str, Any] = {"pool_pre_ping": True, "future": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)


def _deep_value(value: Any) -> Any:
    return copy.deepcopy(value)


def _write_env_file(env_file: Path, updates: dict[str, str]) -> None:
    if env_file.exists():
        backup = env_file.with_suffix(env_file.suffix + ".bak")
        shutil.copy2(env_file, backup)

    lines: list[str] = []
    if env_file.exists():
        lines = env_file.read_text(encoding="utf-8").splitlines()

    for key, value in updates.items():
        prefix = f"{key}="
        for idx, line in enumerate(lines):
            if line.startswith(prefix):
                lines[idx] = f"{key}={value}"
                break
        else:
            lines.append(f"{key}={value}")

    env_file.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _copy_upload_tree(source_root: Path, target_root: Path) -> None:
    if source_root.resolve() == target_root.resolve():
        return
    if not source_root.exists():
        return
    target_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source_root, target_root, dirs_exist_ok=True)


def _clear_target(dst: Session, models: dict[str, Any]) -> None:
    for table in (
        models["UserFollow"],
        models["ModelFavorite"],
        models["ModelLike"],
        models["Comment"],
        models["Process4DTask"],
        models["PrintHistory"],
        models["GcodeFile"],
        models["Device"],
        models["Project"],
        models["Model"],
        models["User"],
    ):
        dst.execute(delete(table))


def _copy_table(
    src: Session,
    dst: Session,
    model: Any,
    factory: Callable[[Any], T],
) -> int:
    rows = src.query(model).order_by(model.id.asc()).all()
    objects = [factory(row) for row in rows]
    if objects:
        dst.add_all(objects)
    return len(objects)


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate the server SQLite database into MySQL.")
    parser.add_argument("--source-sqlite", default=str(DEFAULT_SQLITE_DB), help="Source SQLite database file")
    parser.add_argument("--mysql-url", default="", help="Target MySQL URL, for example mysql+pymysql://user:pass@host:3306/db")
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE), help="backend/.env file to update")
    parser.add_argument("--upload-root", default="", help="Optional upload root to copy files into and write to .env")
    parser.add_argument("--no-env-update", action="store_true", help="Do not rewrite backend/.env after migration")
    args = parser.parse_args()

    load_dotenv(args.env_file)
    models = _load_models()

    source_db = Path(args.source_sqlite).expanduser().resolve()
    if not source_db.exists():
        raise SystemExit(f"Source SQLite database not found: {source_db}")

    target_url = (args.mysql_url or os.getenv("DATABASE_URL", "")).strip()
    if not target_url:
        raise SystemExit("Missing MySQL target URL. Pass --mysql-url or set DATABASE_URL.")
    if target_url.startswith("sqlite:"):
        raise SystemExit("Target DATABASE_URL must point to MySQL, not SQLite.")

    source_engine = _make_engine(_resolve_sqlite_url(source_db))
    _bootstrap_imports()
    from app.core.sqlite_migrations import migrate_sqlite_database  # type: ignore

    migrate_sqlite_database(source_engine)
    models["Base"].metadata.create_all(bind=source_engine)
    target_engine = _make_engine(target_url)
    SourceSession = sessionmaker(bind=source_engine, autoflush=False, autocommit=False, future=True)
    TargetSession = sessionmaker(bind=target_engine, autoflush=False, autocommit=False, future=True)

    models["Base"].metadata.create_all(bind=target_engine)

    source_upload_root = source_db.parent / "uploads"
    target_upload_root = Path(args.upload_root).expanduser().resolve() if args.upload_root else None

    with SourceSession() as src, TargetSession() as dst:
        try:
            dst.execute(text("SET FOREIGN_KEY_CHECKS=0"))
            _clear_target(dst, models)
            dst.commit()

            counts: dict[str, int] = {}

            counts["users"] = _copy_table(
                src,
                dst,
                models["User"],
                lambda row: models["User"](
                    id=row.id,
                    username=row.username,
                    email=row.email,
                    phone=row.phone,
                    hashed_password=row.hashed_password,
                    avatar_path=row.avatar_path,
                    is_admin=bool(row.is_admin),
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                ),
            )
            dst.commit()

            counts["models"] = _copy_table(
                src,
                dst,
                models["Model"],
                lambda row: models["Model"](
                    id=row.id,
                    name=row.name,
                    description=row.description,
                    category=row.category,
                    file_path=row.file_path,
                    thumbnail_path=row.thumbnail_path,
                    downloads=row.downloads or 0,
                    likes=row.likes or 0,
                    user_id=row.user_id,
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                    version_number=row.version_number or 1,
                    parent_model_id=row.parent_model_id,
                    lifecycle_status=row.lifecycle_status or "saved",
                    retention_expires_at=row.retention_expires_at,
                    source_type=row.source_type,
                ),
            )
            dst.commit()

            counts["devices"] = _copy_table(
                src,
                dst,
                models["Device"],
                lambda row: models["Device"](
                    id=row.id,
                    name=row.name,
                    host=row.host,
                    moonraker_url=row.moonraker_url,
                    fluidd_url=row.fluidd_url,
                    user_id=row.user_id,
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                ),
            )
            dst.commit()

            counts["projects"] = _copy_table(
                src,
                dst,
                models["Project"],
                lambda row: models["Project"](
                    id=row.id,
                    user_id=row.user_id,
                    name=row.name,
                    model_url=row.model_url,
                    model_id=row.model_id,
                    model_name=row.model_name,
                    regions=_deep_value(row.regions) if row.regions is not None else [],
                    paint_data=_deep_value(row.paint_data) if row.paint_data is not None else {},
                    modules=_deep_value(row.modules) if row.modules is not None else [],
                    volume_regions=_deep_value(row.volume_regions) if row.volume_regions is not None else [],
                    surface_regions=_deep_value(row.surface_regions) if row.surface_regions is not None else [],
                    process_rules=_deep_value(row.process_rules) if row.process_rules is not None else [],
                    surface_paint_grid=_deep_value(row.surface_paint_grid),
                    surface_direction=_deep_value(row.surface_direction),
                    input_type=row.input_type,
                    source_file=_deep_value(row.source_file),
                    gcode_info=_deep_value(row.gcode_info),
                    step=row.step or "idle",
                    split_result=_deep_value(row.split_result),
                    model_result=_deep_value(row.model_result),
                    slice_result=_deep_value(row.slice_result),
                    gcode_result=_deep_value(row.gcode_result),
                    printer_profile=row.printer_profile or "prusa_i3_mk3",
                    quality_preset=row.quality_preset or "0.20mm",
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                ),
            )
            dst.commit()

            counts["gcode_files"] = _copy_table(
                src,
                dst,
                models["GcodeFile"],
                lambda row: models["GcodeFile"](
                    id=row.id,
                    name=row.name,
                    file_path=row.file_path,
                    model_id=row.model_id,
                    created_at=row.created_at,
                ),
            )
            dst.commit()

            counts["comments"] = _copy_table(
                src,
                dst,
                models["Comment"],
                lambda row: models["Comment"](
                    id=row.id,
                    content=row.content,
                    user_id=row.user_id,
                    model_id=row.model_id,
                    created_at=row.created_at,
                ),
            )
            dst.commit()

            counts["print_history"] = _copy_table(
                src,
                dst,
                models["PrintHistory"],
                lambda row: models["PrintHistory"](
                    id=row.id,
                    user_id=row.user_id,
                    model_name=row.model_name,
                    model_id=row.model_id,
                    device_id=row.device_id,
                    gcode_filename=row.gcode_filename,
                    remote_path=row.remote_path,
                    status=row.status,
                    started_at=row.started_at,
                    completed_at=row.completed_at,
                    notes=row.notes,
                    updated_at=row.updated_at,
                ),
            )
            dst.commit()

            counts["process_4d_tasks"] = _copy_table(
                src,
                dst,
                models["Process4DTask"],
                lambda row: models["Process4DTask"](
                    id=row.id,
                    task_id=row.task_id,
                    user_id=row.user_id,
                    status=row.status,
                    progress=row.progress or 0,
                    current_stage=row.current_stage,
                    message=row.message,
                    logs=_deep_value(row.logs) if row.logs is not None else [],
                    result=_deep_value(row.result),
                    error=row.error,
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                ),
            )
            dst.commit()

            counts["model_likes"] = _copy_table(
                src,
                dst,
                models["ModelLike"],
                lambda row: models["ModelLike"](
                    id=row.id,
                    user_id=row.user_id,
                    model_id=row.model_id,
                    created_at=row.created_at,
                ),
            )
            dst.commit()

            counts["model_favorites"] = _copy_table(
                src,
                dst,
                models["ModelFavorite"],
                lambda row: models["ModelFavorite"](
                    id=row.id,
                    user_id=row.user_id,
                    model_id=row.model_id,
                    created_at=row.created_at,
                ),
            )
            dst.commit()

            counts["user_follows"] = _copy_table(
                src,
                dst,
                models["UserFollow"],
                lambda row: models["UserFollow"](
                    id=row.id,
                    follower_id=row.follower_id,
                    following_id=row.following_id,
                    created_at=row.created_at,
                ),
            )
            dst.commit()

            if target_upload_root is not None:
                _copy_upload_tree(source_upload_root, target_upload_root)

            if not args.no_env_update:
                updates = {"DATABASE_URL": target_url}
                if target_upload_root is not None:
                    updates["UPLOAD_ROOT"] = str(target_upload_root)
                _write_env_file(Path(args.env_file), updates)

            dst.execute(text("SET FOREIGN_KEY_CHECKS=1"))
            dst.commit()

            print("Migration completed.")
            for key, value in counts.items():
                print(f"{key}: {value}")
            return 0
        except Exception:
            dst.rollback()
            try:
                dst.execute(text("SET FOREIGN_KEY_CHECKS=1"))
                dst.commit()
            except Exception:
                pass
            raise


if __name__ == "__main__":
    raise SystemExit(main())
