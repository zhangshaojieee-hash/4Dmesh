from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.users import get_current_user
from app.core.database import get_db
from app.models import Model, Notification, User

router = APIRouter()


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    title: str
    message: str
    link: str | None = None
    read_at: datetime | None = None
    created_at: datetime
    actor_user_id: int | None = None
    model_id: int | None = None


def create_notification(
    db: Session,
    *,
    user_id: int,
    type: str,
    title: str,
    message: str,
    actor_user_id: int | None = None,
    model_id: int | None = None,
    link: str | None = None,
    commit: bool = False,
) -> Notification | None:
    if actor_user_id is not None and actor_user_id == user_id:
        return None

    notification = Notification(
        user_id=user_id,
        actor_user_id=actor_user_id,
        model_id=model_id,
        type=type,
        title=title[:200],
        message=message,
        link=link,
    )
    db.add(notification)
    if commit:
        db.commit()
        db.refresh(notification)
    return notification


def notify_model_owner(
    db: Session,
    *,
    model: Model,
    actor: User | None,
    type: str,
    title: str,
    message: str,
    link: str | None = None,
) -> Notification | None:
    if model.user_id is None:
        return None
    owner_id = int(model.user_id)
    actor_id = int(actor.id) if actor is not None else None
    return create_notification(
        db,
        user_id=owner_id,
        actor_user_id=actor_id,
        model_id=int(model.id),
        type=type,
        title=title,
        message=message,
        link=link or f"/models/{model.id}",
    )


@router.get("/")
async def list_notifications(
    unread_only: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    query = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        query = query.filter(Notification.read_at.is_(None))
    total = query.count()
    unread_count = db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.read_at.is_(None),
    ).count()
    rows = query.order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "total": total,
        "unread_count": unread_count,
        "notifications": [NotificationResponse.model_validate(row).model_dump() for row in rows],
    }


@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    notification = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id,
    ).first()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(notification)
    return NotificationResponse.model_validate(notification)


@router.post("/read-all")
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.read_at.is_(None),
    ).update({Notification.read_at: now}, synchronize_session=False)
    db.commit()
    return {"success": True}
