import logging
import os
import sqlite3

from sqlalchemy.engine import Engine


logger = logging.getLogger("makerworld")


def migrate_sqlite_database(engine: Engine) -> None:
    if not engine.url.get_backend_name().startswith("sqlite"):
        return
    db_path = engine.url.database
    if not db_path:
        return
    if not os.path.exists(db_path):
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(models)")
    existing_cols = {row[1] for row in cursor.fetchall()}
    new_cols = {
        "category": "VARCHAR DEFAULT 'other'",
        "thumbnail_path": "VARCHAR",
        "downloads": "INTEGER DEFAULT 0",
        "likes": "INTEGER DEFAULT 0",
        "updated_at": "DATETIME",
        "version_number": "INTEGER DEFAULT 1",
        "parent_model_id": "INTEGER REFERENCES models(id)",
        "lifecycle_status": "VARCHAR(32) NOT NULL DEFAULT 'saved'",
        "retention_expires_at": "DATETIME",
        "source_type": "VARCHAR(50)",
    }
    for col, col_type in new_cols.items():
        if col not in existing_cols:
            try:
                cursor.execute(f"ALTER TABLE models ADD COLUMN {col} {col_type}")
                logger.info("Added column models.%s", col)
            except Exception as e:
                logger.warning("Failed to add models.%s: %s", col, e)
    cursor.execute("PRAGMA table_info(models)")
    model_cols = {row[1] for row in cursor.fetchall()}
    if "lifecycle_status" in model_cols:
        try:
            cursor.execute("UPDATE models SET lifecycle_status = 'saved' WHERE lifecycle_status IS NULL OR lifecycle_status = ''")
        except Exception as e:
            logger.warning("Failed to backfill models.lifecycle_status: %s", e)

    cursor.execute("PRAGMA table_info(users)")
    user_cols = {row[1] for row in cursor.fetchall()}
    user_new_cols = {
        "updated_at": "DATETIME",
        "avatar_path": "VARCHAR",
        "is_admin": "BOOLEAN DEFAULT 0",
        "phone": "VARCHAR",
        "email_verified": "BOOLEAN DEFAULT 0",
        "wechat_openid": "VARCHAR(128)",
        "wechat_unionid": "VARCHAR(128)",
        "wechat_nickname": "VARCHAR(80)",
    }
    for col, col_type in user_new_cols.items():
        if col not in user_cols:
            try:
                cursor.execute(f"ALTER TABLE users ADD COLUMN {col} {col_type}")
                logger.info("Added column users.%s", col)
            except Exception as e:
                logger.warning("Failed to add users.%s: %s", col, e)

    cursor.execute("PRAGMA table_info(projects)")
    project_cols = {row[1] for row in cursor.fetchall()}
    project_new_cols = {
        "user_id": "INTEGER",
        "model_id": "INTEGER REFERENCES models(id)",
        "name": "VARCHAR(200) DEFAULT 'Untitled project'",
        "model_url": "TEXT DEFAULT ''",
        "model_name": "VARCHAR(255)",
        "regions": "JSON",
        "paint_data": "JSON",
        "modules": "JSON",
        "volume_regions": "JSON",
        "surface_regions": "JSON",
        "process_rules": "JSON",
        "surface_paint_grid": "JSON",
        "surface_direction": "JSON",
        "grid_magnetization": "JSON",
        "input_type": "VARCHAR",
        "source_file": "JSON",
        "gcode_info": "JSON",
        "step": "VARCHAR(32) DEFAULT 'idle'",
        "split_result": "JSON",
        "model_result": "JSON",
        "slice_result": "JSON",
        "gcode_result": "JSON",
        "printer_profile": "VARCHAR(50) DEFAULT 'prusa_i3_mk3'",
        "quality_preset": "VARCHAR(20) DEFAULT '0.20mm'",
        "created_at": "DATETIME",
        "updated_at": "DATETIME",
    }
    for col, col_type in project_new_cols.items():
        if col not in project_cols:
            try:
                cursor.execute(f"ALTER TABLE projects ADD COLUMN {col} {col_type}")
                logger.info("Added column projects.%s", col)
            except Exception as e:
                logger.warning("Failed to add projects.%s: %s", col, e)

    cursor.execute("PRAGMA table_info(print_history)")
    print_history_cols = {row[1] for row in cursor.fetchall()}
    print_history_new_cols = {
        "model_id": "INTEGER REFERENCES models(id)",
        "device_id": "INTEGER REFERENCES devices(id)",
        "remote_path": "VARCHAR",
        "updated_at": "DATETIME",
    }
    for col, col_type in print_history_new_cols.items():
        if col not in print_history_cols:
            try:
                cursor.execute(f"ALTER TABLE print_history ADD COLUMN {col} {col_type}")
                logger.info("Added column print_history.%s", col)
            except Exception as e:
                logger.warning("Failed to add print_history.%s: %s", col, e)

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS process_4d_tasks (
            id INTEGER PRIMARY KEY,
            task_id VARCHAR(12) UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'queued',
            progress INTEGER NOT NULL DEFAULT 0,
            current_stage VARCHAR(80),
            message TEXT,
            logs JSON,
            result JSON,
            error TEXT,
            created_at DATETIME,
            updated_at DATETIME
        )
        """
    )

    conn.commit()
    conn.close()
