import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import admin as admin_api
from app.api import community, gcode, models as models_api, notifications, print_history, projects
from app.api import favorites as favorites_api
from app.core import model_lifecycle
from app.core.database import Base
from app.models import Model, Notification, PrintFeedback, PrintHistory, Process4DTask, Project, User

_PHONE_SEQUENCE = 0


@pytest.fixture()
def db(monkeypatch: pytest.MonkeyPatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_conn, _connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(gcode, "SessionLocal", TestingSessionLocal)

    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def run(coro):
    return asyncio.run(coro)


def create_user(db, username: str, *, is_admin: bool = False) -> User:
    global _PHONE_SEQUENCE
    _PHONE_SEQUENCE += 1
    user = User(
        username=username,
        email=f"{username}@example.com",
        phone=f"1380000{_PHONE_SEQUENCE:04d}",
        hashed_password="hashed",
        is_admin=is_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_model(db, owner: User, name: str = "4D actuator") -> Model:
    model = Model(
        name=name,
        description="community 4D print model",
        category="4dprint",
        file_path=f"{name.replace(' ', '_')}.stl",
        user_id=owner.id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


def create_draft_model(db, owner: User, name: str = "AI draft") -> Model:
    model = Model(
        name=name,
        description="draft model",
        category="ai",
        file_path=f"{name.replace(' ', '_')}.glb",
        user_id=owner.id,
        lifecycle_status=model_lifecycle.MODEL_STATUS_DRAFT,
        retention_expires_at=datetime.now(timezone.utc) + timedelta(days=3),
        source_type="ai_generated",
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


def test_community_report_notification_and_admin_review_loop(db):
    owner = create_user(db, "owner")
    reporter = create_user(db, "reporter")
    admin = create_user(db, "admin", is_admin=True)
    model = create_model(db, owner)

    report = run(
        community.create_model_report(
            model.id,
            community.ReportCreate(reason="quality", details="bad metadata"),
            reporter,
            db,
        )
    )

    assert report.model_id == model.id
    admin_notice = db.query(Notification).filter_by(user_id=admin.id, type="model_report").one()
    assert admin_notice.model_id == model.id
    assert admin_notice.link == "/admin?tab=reports"

    report_rows = run(community.list_model_reports(None, admin, db))["reports"]
    assert report_rows[0]["id"] == report.id
    assert report_rows[0]["status"] == "pending"

    reviewed = run(community.update_model_report_status(report.id, "resolved", admin, db))
    assert reviewed.status == "resolved"
    assert reviewed.reviewer_id == admin.id
    assert reviewed.reviewed_at is not None


def test_print_history_feedback_notification_and_delete_loop(db):
    owner = create_user(db, "owner")
    printer = create_user(db, "printer")
    model = create_model(db, owner)

    history = run(
        print_history.create_print_history(
            print_history.PrintHistoryCreate(
                model_name=model.name,
                model_id=model.id,
                gcode_filename="job.gcode",
                status="started",
            ),
            printer,
            db,
        )
    )
    assert history["model_id"] == model.id
    assert history["status"] == "started"

    completed = run(
        print_history.update_print_history(
            history["id"],
            print_history.PrintHistoryUpdate(
                status="completed",
                completed_at=datetime.now(timezone.utc),
            ),
            printer,
            db,
        )
    )
    assert completed["status"] == "completed"

    feedback = run(
        community.create_print_feedback(
            model.id,
            community.FeedbackCreate(
                rating=5,
                content="printed cleanly",
                print_history_id=history["id"],
            ),
            printer,
            db,
        )
    )
    assert feedback["model_id"] == model.id
    assert feedback["print_history_id"] == history["id"]
    assert feedback["gcode_filename"] == "job.gcode"

    owner_notice = db.query(Notification).filter_by(user_id=owner.id, type="print_feedback").one()
    assert owner_notice.link == f"/models/{model.id}?tab=feedback"

    listed = run(community.list_print_feedback(model.id, skip=0, limit=20, db=db))
    assert listed["total"] == 1
    assert listed["feedback"][0]["id"] == feedback["id"]

    deleted = run(print_history.delete_print_history(history["id"], printer, db))
    assert deleted["message"] == "Print history record deleted"
    db.expire_all()
    retained_feedback = db.query(PrintFeedback).filter_by(id=feedback["id"]).one()
    assert retained_feedback.print_history_id is None


def test_feedback_rejects_history_from_another_model(db):
    owner = create_user(db, "owner")
    printer = create_user(db, "printer")
    model_a = create_model(db, owner, "model-a")
    model_b = create_model(db, owner, "model-b")
    history = PrintHistory(
        user_id=printer.id,
        model_id=model_a.id,
        model_name=model_a.name,
        status="completed",
    )
    db.add(history)
    db.commit()
    db.refresh(history)

    with pytest.raises(HTTPException) as exc_info:
        run(
            community.create_print_feedback(
                model_b.id,
                community.FeedbackCreate(
                    rating=4,
                    content="wrong model",
                    print_history_id=history.id,
                ),
                printer,
                db,
            )
        )

    assert exc_info.value.status_code == 400


def test_notifications_can_be_listed_and_marked_read(db):
    user = create_user(db, "user")
    notifications.create_notification(
        db,
        user_id=user.id,
        type="system",
        title="hello",
        message="world",
        link="/profile?tab=notifications",
        commit=True,
    )

    listed = run(notifications.list_notifications(False, 0, 20, user, db))
    assert listed["unread_count"] == 1
    notice_id = listed["notifications"][0]["id"]

    read = run(notifications.mark_notification_read(notice_id, user, db))
    assert read.read_at is not None

    run(notifications.mark_all_notifications_read(user, db))
    listed_again = run(notifications.list_notifications(False, 0, 20, user, db))
    assert listed_again["unread_count"] == 0


def test_project_model_id_is_persisted_and_validated(db):
    owner = create_user(db, "owner")
    model = create_model(db, owner)

    project = run(
        projects.create_project(
            projects.ProjectCreate(
                name="source project",
                model_url="/api/models/download/source.stl",
                model_id=model.id,
                model_name=model.name,
                input_type="standalone_model",
            ),
            owner,
            db,
        )
    )
    assert project.model_id == model.id

    restored = run(projects.get_project(project.id, owner, db))
    assert restored.model_id == model.id

    with pytest.raises(HTTPException) as exc_info:
        run(
            projects.update_project(
                project.id,
                projects.ProjectUpdate(model_id=9999),
                owner,
                db,
            )
        )
    assert exc_info.value.status_code == 400


def test_draft_model_hidden_until_retained(db):
    owner = create_user(db, "draft-owner")
    draft = create_draft_model(db, owner)

    public_models = run(models_api.get_models(category=None, search=None, sort_by="newest", skip=0, limit=20, current_user=None, db=db))["models"]
    user_models = run(models_api.get_user_models(owner.id, skip=0, limit=20, db=db))["models"]
    assert draft.id not in {model["id"] for model in public_models}
    assert draft.id not in {model["id"] for model in user_models}

    retained = run(
        models_api.retain_model(
            draft.id,
            name="Published draft",
            description="published",
            category="ai",
            thumbnail=None,
            current_user=owner,
            db=db,
        )
    )

    assert retained["id"] == draft.id
    assert retained["lifecycle_status"] == model_lifecycle.MODEL_STATUS_SAVED
    assert retained["retention_expires_at"] is None
    assert draft.id in {
        model["id"]
        for model in run(models_api.get_models(category=None, search=None, sort_by="newest", skip=0, limit=20, current_user=None, db=db))["models"]
    }


def test_retain_draft_generates_cover_when_thumbnail_not_uploaded(db, tmp_path, monkeypatch):
    owner = create_user(db, "draft-retain-cover-owner")
    draft = create_draft_model(db, owner, "retain cover draft")
    draft.file_path = r"retain\cover.glb"
    db.commit()

    model_dir = tmp_path / "models"
    model_dir.mkdir()
    (model_dir / "cover.glb").write_bytes(b"glb")
    calls = []

    def fake_ensure_model_thumbnail(model, model_path, file_size=None):
        calls.append((model.id, model_path, file_size))
        model.thumbnail_path = "retained-cover.png"
        return "retained-cover.png"

    monkeypatch.setattr(models_api, "UPLOAD_DIR", str(model_dir))
    monkeypatch.setattr(models_api, "ensure_model_thumbnail", fake_ensure_model_thumbnail)

    retained = run(
        models_api.retain_model(
            draft.id,
            name="retained draft",
            description="published",
            category="ai",
            thumbnail=None,
            current_user=owner,
            db=db,
        )
    )

    db.refresh(draft)
    assert calls == [(draft.id, str(model_dir / "cover.glb"), None)]
    assert draft.lifecycle_status == model_lifecycle.MODEL_STATUS_SAVED
    assert draft.thumbnail_path == "retained-cover.png"
    assert retained["thumbnail_path"] == "retained-cover.png"


def test_my_draft_models_lists_only_current_user_drafts(db):
    owner = create_user(db, "draft-list-owner")
    other_user = create_user(db, "draft-list-other")
    draft = create_draft_model(db, owner, "visible draft")
    other_draft = create_draft_model(db, other_user, "hidden draft")
    saved = create_model(db, owner, "saved model")

    response = run(
        models_api.get_my_draft_models(
            skip=0,
            limit=20,
            current_user=owner,
            db=db,
        )
    )

    model_ids = {model["id"] for model in response["models"]}
    assert response["total"] == 1
    assert draft.id in model_ids
    assert other_draft.id not in model_ids
    assert saved.id not in model_ids
    row = response["models"][0]
    assert row["lifecycle_status"] == model_lifecycle.MODEL_STATUS_DRAFT
    assert row["retention_expires_at"] is not None
    assert row["file_path"] == draft.file_path


def test_project_save_retains_draft_and_upserts_by_model_id(db):
    owner = create_user(db, "project-draft-owner")
    draft = create_draft_model(db, owner)

    created = run(
        projects.create_project(
            projects.ProjectCreate(
                name="draft project",
                model_url=f"/api/models/file/{draft.file_path}",
                model_id=draft.id,
                model_name=draft.name,
                input_type="ai_project",
                step="annotated",
            ),
            owner,
            db,
        )
    )

    db.refresh(draft)
    assert draft.lifecycle_status == model_lifecycle.MODEL_STATUS_SAVED
    assert draft.retention_expires_at is None
    assert created.model_id == draft.id

    updated = run(
        projects.create_project(
            projects.ProjectCreate(
                name="draft project updated",
                model_url=f"/api/models/file/{draft.file_path}",
                model_id=draft.id,
                model_name=draft.name,
                input_type="ai_project",
                step="ready",
                slice_result={"gcode_path": "job.gcode", "download_url": "/api/gcode/download/job.gcode"},
            ),
            owner,
            db,
        )
    )

    assert updated.id == created.id
    assert updated.name == "draft project updated"
    assert updated.step == "ready"
    assert updated.slice_result == {"gcode_path": "job.gcode", "download_url": "/api/gcode/download/job.gcode"}


def test_project_save_generates_and_returns_model_cover(db, tmp_path, monkeypatch):
    owner = create_user(db, "project-cover-owner")
    draft = create_draft_model(db, owner, "cover draft")
    draft.file_path = r"nested\cover-draft.glb"
    db.commit()

    model_dir = tmp_path / "models"
    model_dir.mkdir()
    (model_dir / "cover-draft.glb").write_bytes(b"glb")
    calls = []

    def fake_ensure_model_thumbnail(model, model_path, file_size=None):
        calls.append((model.id, model_path, file_size))
        model.thumbnail_path = "project-cover.png"
        return "project-cover.png"

    monkeypatch.setattr(projects, "MODEL_UPLOAD_DIR", str(model_dir))
    monkeypatch.setattr(projects, "ensure_model_thumbnail", fake_ensure_model_thumbnail)

    created = run(
        projects.create_project(
            projects.ProjectCreate(
                name="project with cover",
                model_url="/api/models/file/cover-draft.glb",
                model_id=draft.id,
                model_name=draft.name,
                input_type="ai_project",
            ),
            owner,
            db,
        )
    )

    db.refresh(draft)
    assert calls == [(draft.id, str(model_dir / "cover-draft.glb"), None)]
    assert draft.thumbnail_path == "project-cover.png"
    assert created.thumbnail_path == "project-cover.png"

    listed = run(projects.list_projects(owner, db))
    assert len(listed) == 1
    assert listed[0].id == created.id
    assert listed[0].thumbnail_path == "project-cover.png"


def test_expired_draft_cleanup_deletes_only_unretained_drafts(db, tmp_path, monkeypatch):
    owner = create_user(db, "cleanup-owner")
    expired = create_draft_model(db, owner, "expired")
    saved = create_model(db, owner, "model_saved")
    expired.retention_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    saved.file_path = "model_saved.glb"
    db.commit()

    model_dir = tmp_path / "models"
    thumb_dir = tmp_path / "thumbnails"
    model_dir.mkdir()
    thumb_dir.mkdir()
    expired_file = model_dir / expired.file_path
    saved_file = model_dir / saved.file_path
    expired_file.write_bytes(b"expired")
    saved_file.write_bytes(b"saved")
    monkeypatch.setattr(model_lifecycle, "MODEL_UPLOAD_DIR", str(model_dir))
    monkeypatch.setattr(model_lifecycle, "THUMBNAIL_DIR", str(thumb_dir))

    removed = model_lifecycle.cleanup_expired_draft_models(db)

    assert removed == 1
    assert db.query(Model).filter_by(id=expired.id).first() is None
    assert not expired_file.exists()
    assert db.query(Model).filter_by(id=saved.id).one().lifecycle_status == model_lifecycle.MODEL_STATUS_SAVED
    assert saved_file.exists()


def test_favorites_ignore_draft_models(db):
    owner = create_user(db, "favorite-owner")
    viewer = create_user(db, "favorite-viewer")
    draft = create_draft_model(db, owner)
    saved = create_model(db, owner, "favorite saved")

    with pytest.raises(HTTPException) as exc_info:
        favorites_api.toggle_favorite(draft.id, db, viewer)
    assert exc_info.value.status_code == 404

    favorites_api.toggle_favorite(saved.id, db, viewer)
    favorites = favorites_api.get_my_favorites(db=db, current_user=viewer)
    assert favorites["total"] == 1
    assert [model["id"] for model in favorites["models"]] == [saved.id]


def test_process_4d_task_persistence_and_cancel_semantics(db):
    user = create_user(db, "worker")

    task = gcode._create_process_4d_task(user.id)
    assert task["status"] == "queued"
    assert db.query(Process4DTask).filter_by(task_id=task["task_id"], user_id=user.id).one()

    cancelled = run(gcode.cancel_process_4d_task(task["task_id"], user, db))
    assert cancelled["status"] == "cancelled"
    assert cancelled["success"] is False

    persisted = run(gcode.get_process_4d_task(task["task_id"], user, db))
    assert persisted["status"] == "cancelled"
    assert persisted["success"] is False


def test_model_delete_nulls_history_notification_and_project_links(db):
    owner = create_user(db, "owner")
    model = create_model(db, owner)
    history = PrintHistory(user_id=owner.id, model_id=model.id, model_name=model.name, status="completed")
    project = Project(
        user_id=owner.id,
        model_id=model.id,
        name="linked project",
        model_url="/api/models/download/linked.stl",
        model_name=model.name,
    )
    notice = Notification(
        user_id=owner.id,
        model_id=model.id,
        type="system",
        title="linked",
        message="linked",
    )
    db.add_all([history, project, notice])
    db.commit()

    run(models_api.delete_model(model.id, owner, db))

    db.expire_all()
    assert db.query(PrintHistory).filter_by(id=history.id).one().model_id is None
    assert db.query(Project).filter_by(id=project.id).one().model_id is None
    assert db.query(Notification).filter_by(id=notice.id).one().model_id is None


def test_admin_model_delete_nulls_history_notification_and_project_links(db):
    owner = create_user(db, "owner")
    admin = create_user(db, "admin", is_admin=True)
    model = create_model(db, owner)
    history = PrintHistory(user_id=owner.id, model_id=model.id, model_name=model.name, status="completed")
    project = Project(
        user_id=owner.id,
        model_id=model.id,
        name="linked project",
        model_url="/api/models/download/linked.stl",
        model_name=model.name,
    )
    notice = Notification(
        user_id=owner.id,
        model_id=model.id,
        type="system",
        title="linked",
        message="linked",
    )
    db.add_all([history, project, notice])
    db.commit()

    run(admin_api.delete_model(model.id, admin, db))

    db.expire_all()
    assert db.query(PrintHistory).filter_by(id=history.id).one().model_id is None
    assert db.query(Project).filter_by(id=project.id).one().model_id is None
    assert db.query(Notification).filter_by(id=notice.id).one().model_id is None
