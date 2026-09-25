from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.users import get_current_user
from app.core.database import get_db
from app.models import Model, PrintFeedback, PrintHistory, User

router = APIRouter()

VALID_STATUSES = {"uploaded", "queued", "started", "printing", "completed", "failed", "cancelled"}


class PrintHistoryCreate(BaseModel):
    model_name: str
    model_id: int | None = None
    device_id: int | None = None
    gcode_filename: str | None = None
    remote_path: str | None = None
    status: str = "completed"
    started_at: datetime | None = None
    completed_at: datetime | None = None
    notes: str | None = None


class PrintHistoryUpdate(BaseModel):
    status: str | None = None
    completed_at: datetime | None = None
    notes: str | None = None


def _record_to_response(record: PrintHistory) -> dict:
    return {
        "id": record.id,
        "model_id": record.model_id,
        "device_id": record.device_id,
        "model_name": record.model_name,
        "gcode_filename": record.gcode_filename,
        "remote_path": record.remote_path,
        "status": record.status,
        "started_at": record.started_at.isoformat() if record.started_at else None,
        "completed_at": record.completed_at.isoformat() if record.completed_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        "notes": record.notes,
    }


@router.get("/")
async def get_print_history(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(PrintHistory).filter(PrintHistory.user_id == current_user.id)
    total = query.count()
    records = query.order_by(PrintHistory.started_at.desc()).offset(skip).limit(limit).all()

    return {
        "total": total,
        "page": skip // limit if limit else 0,
        "page_size": limit,
        "has_next": (skip + limit) < total,
        "records": [_record_to_response(record) for record in records],
    }


@router.post("/")
async def create_print_history(
    payload: PrintHistoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    status_value = payload.status.lower().strip()
    if status_value not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    if payload.model_id is not None:
        model_exists = db.query(Model.id).filter(Model.id == payload.model_id).first()
        if not model_exists:
            raise HTTPException(status_code=400, detail="model_id does not reference an existing model")

    record = PrintHistory(
        user_id=current_user.id,
        model_id=payload.model_id,
        device_id=payload.device_id,
        model_name=payload.model_name,
        gcode_filename=payload.gcode_filename,
        remote_path=payload.remote_path,
        status=status_value,
        started_at=payload.started_at,
        completed_at=payload.completed_at,
        notes=payload.notes,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return _record_to_response(record)


@router.patch("/{record_id}")
async def update_print_history(
    record_id: int,
    payload: PrintHistoryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(PrintHistory).filter(PrintHistory.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Print history record not found")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to update this record")

    if payload.status is not None:
        status_value = payload.status.lower().strip()
        if status_value not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        record.status = status_value
    if payload.completed_at is not None:
        record.completed_at = payload.completed_at
    if payload.notes is not None:
        record.notes = payload.notes
    record.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return _record_to_response(record)


@router.delete("/{record_id}")
async def delete_print_history(
    record_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(PrintHistory).filter(PrintHistory.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Print history record not found")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this record")

    db.query(PrintFeedback).filter(PrintFeedback.print_history_id == record_id).update(
        {PrintFeedback.print_history_id: None},
        synchronize_session=False,
    )
    db.delete(record)
    db.commit()
    return {"message": "Print history record deleted"}
