from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session, joinedload

from app.api.notifications import create_notification, notify_model_owner
from app.api.users import get_current_admin, get_current_user
from app.core.database import get_db
from app.models import Model, ModelReport, PrintFeedback, PrintHistory, User

router = APIRouter()


class ReportCreate(BaseModel):
    reason: str = Field(min_length=1, max_length=100)
    details: str | None = Field(None, max_length=2000)


class ReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    model_id: int
    reporter_id: int
    reason: str
    details: str | None = None
    status: str
    created_at: datetime
    reviewed_at: datetime | None = None
    reviewer_id: int | None = None


class FeedbackCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    content: str = Field(min_length=1, max_length=3000)
    printer_model: str | None = Field(None, max_length=255)
    material: str | None = Field(None, max_length=100)
    print_history_id: int | None = None
    gcode_filename: str | None = Field(None, max_length=255)


class FeedbackResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    model_id: int
    user_id: int
    username: str
    rating: int
    content: str
    printer_model: str | None = None
    material: str | None = None
    gcode_filename: str | None = None
    print_history_id: int | None = None
    created_at: datetime


def _feedback_to_response(feedback: PrintFeedback) -> dict[str, Any]:
    return {
        "id": feedback.id,
        "model_id": feedback.model_id,
        "user_id": feedback.user_id,
        "username": feedback.user.username if feedback.user else "Unknown",
        "rating": feedback.rating,
        "content": feedback.content,
        "printer_model": feedback.printer_model,
        "material": feedback.material,
        "gcode_filename": feedback.gcode_filename,
        "print_history_id": feedback.print_history_id,
        "created_at": feedback.created_at,
    }


@router.post("/models/{model_id}/reports", response_model=ReportResponse)
async def create_model_report(
    model_id: int,
    payload: ReportCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    report = ModelReport(
        model_id=model_id,
        reporter_id=current_user.id,
        reason=payload.reason.strip(),
        details=(payload.details or "").strip() or None,
        status="pending",
    )
    db.add(report)

    admins = db.query(User).filter(User.is_admin.is_(True)).all()
    for admin in admins:
        create_notification(
            db,
            user_id=int(admin.id),
            actor_user_id=int(current_user.id),
            model_id=model_id,
            type="model_report",
            title="模型举报待处理",
            message=f"{current_user.username} 举报了模型「{model.name}」：{report.reason}",
            link=f"/admin?tab=reports",
        )

    db.commit()
    db.refresh(report)
    return ReportResponse.model_validate(report)


@router.get("/admin/reports")
async def list_model_reports(
    status: str | None = Query(None),
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    query = db.query(ModelReport).options(joinedload(ModelReport.model), joinedload(ModelReport.reporter))
    if status:
        query = query.filter(ModelReport.status == status)
    rows = query.order_by(ModelReport.created_at.desc()).limit(200).all()
    return {
        "reports": [
            {
                "id": row.id,
                "model_id": row.model_id,
                "model_name": row.model.name if row.model else None,
                "reporter_id": row.reporter_id,
                "reporter": row.reporter.username if row.reporter else None,
                "reason": row.reason,
                "details": row.details,
                "status": row.status,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
            }
            for row in rows
        ]
    }


@router.put("/admin/reports/{report_id}", response_model=ReportResponse)
async def update_model_report_status(
    report_id: int,
    status: str,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    normalized = status.strip().lower()
    if normalized not in {"pending", "reviewed", "dismissed", "resolved"}:
        raise HTTPException(status_code=400, detail="Invalid report status")
    report = db.query(ModelReport).filter(ModelReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    report.status = normalized
    report.reviewed_at = datetime.now(timezone.utc)
    report.reviewer_id = admin.id
    db.commit()
    db.refresh(report)
    return ReportResponse.model_validate(report)


@router.post("/models/{model_id}/feedback", response_model=FeedbackResponse)
async def create_print_feedback(
    model_id: int,
    payload: FeedbackCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    history = None
    if payload.print_history_id is not None:
        history = db.query(PrintHistory).filter(
            PrintHistory.id == payload.print_history_id,
            PrintHistory.user_id == current_user.id,
        ).first()
        if not history:
            raise HTTPException(status_code=404, detail="Print history record not found")
        if history.model_id is not None and history.model_id != model_id:
            raise HTTPException(status_code=400, detail="Print history does not belong to this model")

    feedback = PrintFeedback(
        model_id=model_id,
        user_id=current_user.id,
        print_history_id=payload.print_history_id,
        rating=payload.rating,
        content=payload.content.strip(),
        printer_model=(payload.printer_model or "").strip() or None,
        material=(payload.material or "").strip() or None,
        gcode_filename=(payload.gcode_filename or "").strip() or (history.gcode_filename if history else None),
    )
    db.add(feedback)

    notify_model_owner(
        db,
        model=model,
        actor=current_user,
        type="print_feedback",
        title="收到新的打印反馈",
        message=f"{current_user.username} 分享了模型「{model.name}」的打印反馈",
        link=f"/models/{model.id}?tab=feedback",
    )

    db.commit()
    db.refresh(feedback)
    return _feedback_to_response(feedback)


@router.get("/models/{model_id}/feedback")
async def list_print_feedback(
    model_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    query = db.query(PrintFeedback).options(joinedload(PrintFeedback.user)).filter(PrintFeedback.model_id == model_id)
    total = query.count()
    rows = query.order_by(PrintFeedback.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "total": total,
        "page": skip // limit if limit else 0,
        "page_size": limit,
        "has_next": (skip + limit) < total,
        "feedback": [_feedback_to_response(row) for row in rows],
    }
