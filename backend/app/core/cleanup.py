import logging
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

from app.core.database import SessionLocal
from app.core.model_lifecycle import cleanup_expired_draft_models
from app.core.paths import MODEL_UPLOAD_DIR_PATH, SLICE_OUTPUT_DIR_PATH, TEMP_DIR_PATH, UPLOAD_ROOT_PATH


logger = logging.getLogger(__name__)

RUNTIME_TEMP_FILE_SUFFIXES = (".tmp", ".download", ".uploading")
SLICE_OUTPUT_FILE_PREFIXES = (
    "slice_",
    "processed_",
    "continuous_",
    "gcode_",
    "edited_",
    "mag_",
    "model_",
    "model_split_",
)
MODEL_RUNTIME_CHILD_DIRS = ("split", "continuous")
MODEL_RUNTIME_FILE_PREFIXES = ("remote_", "temp_", "glb_", "3mf_")


@dataclass
class CleanupStats:
    files_removed: int = 0
    dirs_removed: int = 0
    bytes_removed: int = 0

    def add(self, other: "CleanupStats") -> None:
        self.files_removed += other.files_removed
        self.dirs_removed += other.dirs_removed
        self.bytes_removed += other.bytes_removed


def _env_float(name: str, default: float) -> float:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return default
    try:
        return float(raw_value)
    except ValueError:
        return default


def _is_older(path: Path, cutoff: float) -> bool:
    try:
        return path.stat().st_mtime < cutoff
    except OSError:
        return False


def _remove_file(path: Path, stats: CleanupStats) -> None:
    try:
        size = path.stat().st_size
        path.unlink()
        stats.files_removed += 1
        stats.bytes_removed += size
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.debug("Could not remove expired file %s: %s", path, exc)


def _remove_tree(path: Path, stats: CleanupStats) -> None:
    try:
        total_size = sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
        shutil.rmtree(path)
        stats.dirs_removed += 1
        stats.bytes_removed += total_size
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.debug("Could not remove expired directory %s: %s", path, exc)


def _cleanup_files_by_age(root: Path, cutoff: float, *, prefixes: tuple[str, ...] = (), suffixes: tuple[str, ...] = ()) -> CleanupStats:
    stats = CleanupStats()
    if not root.exists():
        return stats

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        name = path.name
        if prefixes and not name.startswith(prefixes):
            continue
        if suffixes and not name.endswith(suffixes):
            continue
        if _is_older(path, cutoff):
            _remove_file(path, stats)

    for directory in sorted((p for p in root.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        try:
            if not any(directory.iterdir()) and _is_older(directory, cutoff):
                directory.rmdir()
                stats.dirs_removed += 1
        except OSError:
            pass
    return stats


def _cleanup_child_dirs_by_age(root: Path, cutoff: float, names: tuple[str, ...]) -> CleanupStats:
    stats = CleanupStats()
    if not root.exists():
        return stats
    for name in names:
        parent = root / name
        if not parent.exists():
            continue
        for child in parent.iterdir():
            if child.is_dir() and _is_older(child, cutoff):
                _remove_tree(child, stats)
            elif child.is_file() and _is_older(child, cutoff):
                _remove_file(child, stats)
    return stats


def cleanup_runtime_files() -> CleanupStats:
    temp_hours = _env_float("TEMP_FILE_MAX_AGE_HOURS", 24)
    generated_hours = _env_float("GENERATED_FILE_MAX_AGE_HOURS", 24 * 7)
    now = time.time()
    stats = CleanupStats()

    if temp_hours > 0:
        temp_cutoff = now - temp_hours * 3600
        stats.add(_cleanup_files_by_age(
            UPLOAD_ROOT_PATH,
            temp_cutoff,
            suffixes=RUNTIME_TEMP_FILE_SUFFIXES,
        ))
        stats.add(_cleanup_files_by_age(TEMP_DIR_PATH, temp_cutoff))

    if generated_hours > 0:
        generated_cutoff = now - generated_hours * 3600
        stats.add(_cleanup_files_by_age(
            SLICE_OUTPUT_DIR_PATH,
            generated_cutoff,
            prefixes=SLICE_OUTPUT_FILE_PREFIXES,
        ))
        stats.add(_cleanup_child_dirs_by_age(MODEL_UPLOAD_DIR_PATH, generated_cutoff, MODEL_RUNTIME_CHILD_DIRS))
        stats.add(_cleanup_files_by_age(
            MODEL_UPLOAD_DIR_PATH,
            generated_cutoff,
            prefixes=MODEL_RUNTIME_FILE_PREFIXES,
        ))

    if stats.files_removed or stats.dirs_removed:
        logger.info(
            "Runtime cleanup removed %d files, %d directories, %.1f MB",
            stats.files_removed,
            stats.dirs_removed,
            stats.bytes_removed / 1024 / 1024,
        )
    return stats


def cleanup_runtime_resources() -> CleanupStats:
    stats = cleanup_runtime_files()
    db = SessionLocal()
    try:
        cleanup_expired_draft_models(db)
    finally:
        db.close()
    return stats
