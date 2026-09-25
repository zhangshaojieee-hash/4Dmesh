from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models import User, UserFollow
from app.api.users import get_current_user
from app.api.notifications import create_notification

router = APIRouter()


@router.post("/{user_id}/follow")
def toggle_follow(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能关注自己")

    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")

    existing = db.query(UserFollow).filter(
        UserFollow.follower_id == current_user.id,
        UserFollow.following_id == user_id,
    ).first()

    if existing:
        db.delete(existing)
        db.commit()
        followed = False
    else:
        follow = UserFollow(follower_id=current_user.id, following_id=user_id)
        db.add(follow)
        create_notification(
            db,
            user_id=user_id,
            actor_user_id=current_user.id,
            type="follow",
            title="新的关注者",
            message=f"{current_user.username} 关注了你",
            link="/profile?tab=follows",
        )
        db.commit()
        followed = True

    followers_count = db.query(UserFollow).filter(UserFollow.following_id == user_id).count()
    following_count = db.query(UserFollow).filter(UserFollow.follower_id == user_id).count()

    return {"followed": followed, "followers_count": followers_count, "following_count": following_count}


@router.get("/{user_id}/followers")
def get_followers(user_id: int, skip: int = 0, limit: int = 20, db: Session = Depends(get_db)):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")

    total = db.query(UserFollow).filter(UserFollow.following_id == user_id).count()
    follows = db.query(UserFollow).filter(
        UserFollow.following_id == user_id,
    ).offset(skip).limit(limit).all()

    users = []
    for f in follows:
        user = db.query(User).filter(User.id == f.follower_id).first()
        if user:
            users.append({"id": user.id, "username": user.username, "avatar_path": user.avatar_path})

    return {"total": total, "users": users}


@router.get("/{user_id}/following")
def get_following(user_id: int, skip: int = 0, limit: int = 20, db: Session = Depends(get_db)):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")

    total = db.query(UserFollow).filter(UserFollow.follower_id == user_id).count()
    follows = db.query(UserFollow).filter(
        UserFollow.follower_id == user_id,
    ).offset(skip).limit(limit).all()

    users = []
    for f in follows:
        user = db.query(User).filter(User.id == f.following_id).first()
        if user:
            users.append({"id": user.id, "username": user.username, "avatar_path": user.avatar_path})

    return {"total": total, "users": users}


@router.get("/{user_id}/follow-status")
def get_follow_status(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    is_followed = db.query(UserFollow).filter(
        UserFollow.follower_id == current_user.id,
        UserFollow.following_id == user_id,
    ).first() is not None

    followers_count = db.query(UserFollow).filter(UserFollow.following_id == user_id).count()
    following_count = db.query(UserFollow).filter(UserFollow.follower_id == user_id).count()

    return {"is_followed": is_followed, "followers_count": followers_count, "following_count": following_count}
