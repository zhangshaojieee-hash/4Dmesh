import sqlite3

from sqlalchemy import create_engine

from app.core.sqlite_migrations import migrate_sqlite_database


def _columns(db_path, table_name):
    conn = sqlite3.connect(db_path)
    try:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()}
    finally:
        conn.close()


def test_migrate_db_adds_model_lifecycle_columns_to_legacy_sqlite(tmp_path):
    db_path = tmp_path / "legacy.db"
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("CREATE TABLE models (id INTEGER PRIMARY KEY, name VARCHAR, file_path VARCHAR)")
        conn.execute("INSERT INTO models (id, name, file_path) VALUES (1, 'legacy', 'legacy.stl')")
        conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR)")
        conn.execute("CREATE TABLE projects (id VARCHAR PRIMARY KEY, name VARCHAR)")
        conn.execute("CREATE TABLE print_history (id INTEGER PRIMARY KEY, model_name VARCHAR)")
        conn.commit()
    finally:
        conn.close()

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        migrate_sqlite_database(engine)
    finally:
        engine.dispose()

    model_cols = _columns(db_path, "models")
    assert {"lifecycle_status", "retention_expires_at", "source_type"}.issubset(model_cols)
    project_cols = _columns(db_path, "projects")
    assert {
        "model_id",
        "slice_result",
        "gcode_result",
        "surface_paint_grid",
        "surface_direction",
        "gcode_info",
    }.issubset(project_cols)
    history_cols = _columns(db_path, "print_history")
    assert {"model_id", "device_id", "remote_path", "updated_at"}.issubset(history_cols)
    task_cols = _columns(db_path, "process_4d_tasks")
    assert {"task_id", "status", "progress", "result", "error"}.issubset(task_cols)

    conn = sqlite3.connect(db_path)
    try:
        status = conn.execute("SELECT lifecycle_status FROM models WHERE id = 1").fetchone()[0]
    finally:
        conn.close()

    assert status == "saved"
