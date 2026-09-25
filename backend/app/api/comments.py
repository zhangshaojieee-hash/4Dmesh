from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.api.users import get_current_user
from app.api.notifications import notify_model_owner
from app.core.database import get_db
from app.models import Comment, Model, User

router = APIRouter()


class CommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


@router.get("/model/{model_id}")
async def get_model_comments(
    model_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    query = db.query(Comment).options(joinedload(Comment.user)).filter(Comment.model_id == model_id)
    total = query.count()
    comments = query.order_by(Comment.created_at.desc()).offset(skip).limit(limit).all()

    return {
        "total": total,
        "page": skip // limit if limit else 0,
        "page_size": limit,
        "has_next": (skip + limit) < total,
        "comments": [
            {
                "id": comment.id,
                "content": comment.content,
                "model_id": comment.model_id,
                "user_id": comment.user_id,
                "username": comment.user.username if comment.user else "Unknown",
                "created_at": comment.created_at.isoformat() if comment.created_at else None,
            }
            for comment in comments
        ],
    }


@router.post("/model/{model_id}")
async def create_comment(
    model_id: int,
    payload: CommentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Comment content cannot be empty")

    comment = Comment(content=content, user_id=current_user.id, model_id=model_id)
    db.add(comment)
    notify_model_owner(
        db,
        model=model,
        actor=current_user,
        type="comment",
        title="收到新的模型评论",
        message=f"{current_user.username} 评论了你的模型「{model.name}」",
        link=f"/models/{model.id}?tab=comments",
    )
    db.commit()
    db.refresh(comment)

    return {
        "id": comment.id,
        "content": comment.content,
        "model_id": comment.model_id,
        "user_id": comment.user_id,
        "username": current_user.username,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
    }


@router.delete("/{comment_id}")
async def delete_comment(
    comment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this comment")

    db.delete(comment)
    db.commit()
    return {"message": "Comment deleted"}
