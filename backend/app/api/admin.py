from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel
import os

from app.core.database import get_db
from app.core.file_io import remove_file_quietly, safe_filename
from app.core.paths import MODEL_UPLOAD_DIR, THUMBNAIL_DIR
from app.api.users import get_current_admin
from app.models import (
    Comment,
    GcodeFile,
    Model,
    ModelFavorite,
    ModelLike,
    ModelReport,
    Notification,
    PrintFeedback,
    PrintHistory,
    Process4DTask,
    Project,
    User,
    UserFollow,
)

router = APIRouter()


class AdminStats(BaseModel):
    users: int
    admins: int
    models: int
    projects: int
    gcode_files: int
    comments: int
    print_history: int


class AdminUserRow(BaseModel):
    id: int
    username: str
    email: str
    is_admin: bool
    avatar_path: Optional[str] = None
    model_count: int
    project_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class AdminModelRow(BaseModel):
    id: int
    name: str
    category: Optional[str] = None
    user_id: Optional[int] = None
    author: Optional[str] = None
    downloads: int = 0
    likes: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class AdminProjectRow(BaseModel):
    id: str
    name: str
    user_id: int
    author: Optional[str] = None
    model_name: Optional[str] = None
    step: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


@router.get("/stats", response_model=AdminStats)
async def get_stats(_: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    return AdminStats(
        users=db.query(func.count(User.id)).scalar() or 0,
        admins=db.query(func.count(User.id)).filter(User.is_admin.is_(True)).scalar() or 0,
        models=db.query(func.count(Model.id)).scalar() or 0,
        projects=db.query(func.count(Project.id)).scalar() or 0,
        gcode_files=db.query(func.count(GcodeFile.id)).scalar() or 0,
        comments=db.query(func.count(Comment.id)).scalar() or 0,
        print_history=db.query(func.count(PrintHistory.id)).scalar() or 0,
    )


@router.get("/users", response_model=List[AdminUserRow])
async def list_users(_: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    rows: List[AdminUserRow] = []
    for u in users:
        rows.append(AdminUserRow(
            id=u.id,
            username=u.username,
            email=u.email,
            is_admin=bool(u.is_admin),
            avatar_path=u.avatar_path,
            model_count=db.query(func.count(Model.id)).filter(Model.user_id == u.id).scalar() or 0,
            project_count=db.query(func.count(Project.id)).filter(Project.user_id == u.id).scalar() or 0,
            created_at=u.created_at,
        ))
    return rows


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除当前登录的管理员账号")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    db.query(Notification).filter(
        or_(Notification.user_id == user_id, Notification.actor_user_id == user_id)
    ).delete(synchronize_session=False)
    db.query(UserFollow).filter(
        or_(UserFollow.follower_id == user_id, UserFollow.following_id == user_id)
    ).delete(synchronize_session=False)
    db.query(ModelReport).filter(ModelReport.reporter_id == user_id).delete(synchronize_session=False)
    db.query(ModelReport).filter(ModelReport.reviewer_id == user_id).update(
        {ModelReport.reviewer_id: None},
        synchronize_session=False,
    )
    db.query(PrintFeedback).filter(PrintFeedback.user_id == user_id).delete(synchronize_session=False)
    db.query(ModelFavorite).filter(ModelFavorite.user_id == user_id).delete(synchronize_session=False)
    db.query(ModelLike).filter(ModelLike.user_id == user_id).delete(synchronize_session=False)
    db.query(Comment).filter(Comment.user_id == user_id).delete(synchronize_session=False)
    db.query(Process4DTask).filter(Process4DTask.user_id == user_id).delete(synchronize_session=False)
    db.query(PrintHistory).filter(PrintHistory.user_id == user_id).delete(synchronize_session=False)
    db.query(Project).filter(Project.user_id == user_id).delete(synchronize_session=False)
    db.query(Model).filter(Model.user_id == user_id).update({Model.user_id: None}, synchronize_session=False)
    db.delete(user)
    db.commit()
    return {"success": True, "message": "用户已删除"}


@router.get("/models", response_model=List[AdminModelRow])
async def list_models(_: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    models = db.query(Model).order_by(Model.created_at.desc()).all()
    rows: List[AdminModelRow] = []
    for m in models:
        rows.append(AdminModelRow(
            id=m.id,
            name=m.name,
            category=m.category,
            user_id=m.user_id,
            author=m.owner.username if m.owner else None,
            downloads=m.downloads or 0,
            likes=m.likes or 0,
            created_at=m.created_at,
        ))
    return rows


@router.delete("/models/{model_id}")
async def delete_model(model_id: int, _: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")
    file_path = os.path.join(MODEL_UPLOAD_DIR, safe_filename(model.file_path)) if model.file_path else None
    thumb_path = os.path.join(THUMBNAIL_DIR, safe_filename(model.thumbnail_path)) if model.thumbnail_path else None
    for table in (PrintHistory, Notification, Project):
        db.query(table).filter(table.model_id == model_id).update(
            {table.model_id: None},
            synchronize_session=False,
        )
    db.delete(model)
    db.commit()
    for path in (file_path, thumb_path):
        remove_file_quietly(path)
    return {"success": True, "message": "模型已删除"}


@router.get("/projects", response_model=List[AdminProjectRow])
async def list_projects(_: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(Project.updated_at.desc()).all()
    rows: List[AdminProjectRow] = []
    for p in projects:
        rows.append(AdminProjectRow(
            id=p.id,
            name=p.name,
            user_id=p.user_id,
            author=p.owner.username if p.owner else None,
            model_name=p.model_name,
            step=p.step,
            created_at=p.created_at,
            updated_at=p.updated_at,
        ))
    return rows


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, _: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    db.delete(project)
    db.commit()
    return {"success": True, "message": "项目已删除"}
