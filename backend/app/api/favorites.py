from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.model_lifecycle import MODEL_STATUS_SAVED
from app.models import User, Model, ModelFavorite
from app.api.users import get_current_user
from app.api.notifications import notify_model_owner

router = APIRouter()


@router.post("/{model_id}/favorite")
def toggle_favorite(model_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    model = db.query(Model).filter(
        Model.id == model_id,
        Model.lifecycle_status == MODEL_STATUS_SAVED,
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")

    existing = db.query(ModelFavorite).filter(
        ModelFavorite.user_id == current_user.id,
        ModelFavorite.model_id == model_id,
    ).first()

    if existing:
        db.delete(existing)
        db.commit()
        favorited = False
    else:
        fav = ModelFavorite(user_id=current_user.id, model_id=model_id)
        db.add(fav)
        notify_model_owner(
            db,
            model=model,
            actor=current_user,
            type="favorite",
            title="模型被收藏",
            message=f"{current_user.username} 收藏了你的模型「{model.name}」",
            link=f"/models/{model.id}",
        )
        db.commit()
        favorited = True

    count = db.query(ModelFavorite).filter(ModelFavorite.model_id == model_id).count()
    return {"favorited": favorited, "favorites_count": count}


@router.get("/{model_id}/favorite-status")
def get_favorite_status(model_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    model = db.query(Model.id).filter(
        Model.id == model_id,
        Model.lifecycle_status == MODEL_STATUS_SAVED,
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")

    is_favorited = db.query(ModelFavorite).filter(
        ModelFavorite.user_id == current_user.id,
        ModelFavorite.model_id == model_id,
    ).first() is not None

    count = db.query(ModelFavorite).filter(ModelFavorite.model_id == model_id).count()
    return {"is_favorited": is_favorited, "favorites_count": count}


@router.get("/my-favorites")
def get_my_favorites(skip: int = 0, limit: int = 20, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    base_query = db.query(ModelFavorite).join(Model, Model.id == ModelFavorite.model_id).filter(
        ModelFavorite.user_id == current_user.id,
        Model.lifecycle_status == MODEL_STATUS_SAVED,
    )
    total = base_query.count()
    favs = base_query.order_by(ModelFavorite.created_at.desc()).offset(skip).limit(limit).all()

    models = []
    for f in favs:
        model = db.query(Model).filter(
            Model.id == f.model_id,
            Model.lifecycle_status == MODEL_STATUS_SAVED,
        ).first()
        if model:
            author = db.query(User).filter(User.id == model.user_id).first()
            models.append({
                "id": model.id,
                "name": model.name,
                "description": model.description,
                "category": model.category,
                "file_path": model.file_path,
                "thumbnail_path": model.thumbnail_path,
                "downloads": model.downloads,
                "likes": model.likes,
                "user_id": model.user_id,
                "author": author.username if author else None,
                "created_at": model.created_at.isoformat() if model.created_at else None,
            })

    return {"total": total, "models": models}
