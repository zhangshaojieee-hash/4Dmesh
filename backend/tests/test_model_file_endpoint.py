from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import main
from app.api import models as models_api
from app.core.database import Base, get_db
from app.models import Model, User


def test_model_file_endpoint_does_not_increment_downloads(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'models.db'}", connect_args={"check_same_thread": False})
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    (upload_dir / "sample.stl").write_text("solid sample\nendsolid sample\n", encoding="ascii")

    old_upload_dir = models_api.UPLOAD_DIR
    models_api.UPLOAD_DIR = str(upload_dir)

    db = session_factory()
    user = User(username="tester", email="tester@example.com", phone="13800138000", hashed_password="x")
    db.add(user)
    db.commit()
    db.refresh(user)
    db.add(Model(name="sample", file_path="sample.stl", user_id=user.id, downloads=0))
    db.commit()
    db.close()

    def override_db():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    main.app.dependency_overrides[get_db] = override_db
    try:
        client = TestClient(main.app)

        assert client.get("/api/models/file/sample.stl").status_code == 200
        db = session_factory()
        assert db.query(Model).filter(Model.file_path == "sample.stl").first().downloads == 0
        db.close()

        assert client.get("/api/models/download/sample.stl").status_code == 200
        db = session_factory()
        assert db.query(Model).filter(Model.file_path == "sample.stl").first().downloads == 1
        db.close()
    finally:
        main.app.dependency_overrides.clear()
        models_api.UPLOAD_DIR = old_upload_dir
        engine.dispose()
