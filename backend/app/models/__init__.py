from app.core.database import Base
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, JSON, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid


def _utcnow():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(30), unique=True, index=True)
    email = Column(String(254), unique=True, index=True)
    phone = Column(String(20), unique=True, nullable=True, index=True)
    hashed_password = Column(String(255))
    avatar_path = Column(String(255), nullable=True)
    is_admin = Column(Boolean, default=False, nullable=False)
    email_verified = Column(Boolean, default=False, nullable=False)
    wechat_openid = Column(String(128), unique=True, nullable=True, index=True)
    wechat_unionid = Column(String(128), unique=True, nullable=True, index=True)
    wechat_nickname = Column(String(80), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    models = relationship("Model", back_populates="owner")
    liked_models = relationship("ModelLike", back_populates="user")
    devices = relationship("Device", back_populates="owner", cascade="all, delete-orphan")
    notifications = relationship("Notification", foreign_keys="Notification.user_id", back_populates="user", cascade="all, delete-orphan")


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    host = Column(String(255), nullable=False, index=True)
    moonraker_url = Column(String(512), nullable=False, index=True)
    fluidd_url = Column(String(512), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    owner = relationship("User", back_populates="devices")

class Model(Base):
    __tablename__ = "models"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255))
    description = Column(Text, nullable=True)
    category = Column(String(50), default="other", index=True)
    file_path = Column(String(255))
    thumbnail_path = Column(String(255), nullable=True)
    downloads = Column(Integer, default=0)
    likes = Column(Integer, default=0)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    version_number = Column(Integer, default=1)
    parent_model_id = Column(Integer, ForeignKey("models.id"), nullable=True, index=True)
    lifecycle_status = Column(String(32), default="saved", nullable=False, index=True)
    retention_expires_at = Column(DateTime, nullable=True, index=True)
    source_type = Column(String(50), nullable=True, index=True)

    owner = relationship("User", back_populates="models")
    gcodes = relationship("GcodeFile", back_populates="model", cascade="all, delete-orphan")
    liked_by = relationship("ModelLike", back_populates="model", cascade="all, delete-orphan")
    favorited_by = relationship("ModelFavorite", back_populates="model", cascade="all, delete-orphan")
    comments = relationship("Comment", back_populates="model", cascade="all, delete-orphan")
    reports = relationship("ModelReport", back_populates="model", cascade="all, delete-orphan")
    feedback = relationship("PrintFeedback", back_populates="model", cascade="all, delete-orphan")
    parent = relationship("Model", remote_side=[id], backref="versions")

class ModelLike(Base):
    __tablename__ = "model_likes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    model_id = Column(Integer, ForeignKey("models.id"), index=True)
    created_at = Column(DateTime, default=_utcnow)

    __table_args__ = (UniqueConstraint('user_id', 'model_id', name='uq_user_model_like'),)

    user = relationship("User", back_populates="liked_models")
    model = relationship("Model", back_populates="liked_by")

class UserFollow(Base):
    __tablename__ = "user_follows"

    id = Column(Integer, primary_key=True, index=True)
    follower_id = Column(Integer, ForeignKey("users.id"), index=True)
    following_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=_utcnow)

    __table_args__ = (UniqueConstraint('follower_id', 'following_id', name='uq_user_follow'),)

    follower = relationship("User", foreign_keys=[follower_id], backref="following_list")
    following = relationship("User", foreign_keys=[following_id], backref="followers_list")

class ModelFavorite(Base):
    __tablename__ = "model_favorites"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    model_id = Column(Integer, ForeignKey("models.id"), index=True)
    created_at = Column(DateTime, default=_utcnow)

    __table_args__ = (UniqueConstraint('user_id', 'model_id', name='uq_user_model_favorite'),)

    user = relationship("User", backref="favorites")
    model = relationship("Model", back_populates="favorited_by")

class GcodeFile(Base):
    __tablename__ = "gcode_files"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255))
    file_path = Column(String(255))
    model_id = Column(Integer, ForeignKey("models.id"), index=True)
    created_at = Column(DateTime, default=_utcnow)

    model = relationship("Model", back_populates="gcodes")


class PrintHistory(Base):
    __tablename__ = "print_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    model_id = Column(Integer, ForeignKey("models.id"), nullable=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=True, index=True)
    model_name = Column(String(255))
    gcode_filename = Column(String(255), nullable=True)
    remote_path = Column(String(255), nullable=True)
    status = Column(String(32), default="completed")
    started_at = Column(DateTime, default=_utcnow)
    completed_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    user = relationship("User", backref="print_history")
    model = relationship("Model", backref="print_history")
    device = relationship("Device", backref="print_history")


class Comment(Base):
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True)
    content = Column(Text)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    model_id = Column(Integer, ForeignKey("models.id"), index=True)
    created_at = Column(DateTime, default=_utcnow)

    user = relationship("User", backref="comments")
    model = relationship("Model", back_populates="comments")


class Project(Base):
    __tablename__ = "projects"

    id = Column(String(12), primary_key=True, default=lambda: uuid.uuid4().hex[:12])
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    model_id = Column(Integer, ForeignKey("models.id"), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    model_url = Column(Text, nullable=False)
    model_name = Column(String(255), nullable=True)

    regions = Column(JSON, default=list)
    paint_data = Column(JSON, default=dict)
    modules = Column(JSON, default=list)
    volume_regions = Column(JSON, default=list)
    surface_regions = Column(JSON, default=list)
    process_rules = Column(JSON, default=list)
    surface_paint_grid = Column(JSON, nullable=True)
    surface_direction = Column(JSON, nullable=True)
    grid_magnetization = Column(JSON, nullable=True)

    input_type = Column(String(50), nullable=True)
    source_file = Column(JSON, nullable=True)
    gcode_info = Column(JSON, nullable=True)

    step = Column(String(32), default="idle")

    split_result = Column(JSON, nullable=True)
    model_result = Column(JSON, nullable=True)
    slice_result = Column(JSON, nullable=True)
    gcode_result = Column(JSON, nullable=True)

    printer_profile = Column(String(50), default="prusa_i3_mk3")
    quality_preset = Column(String(20), default="0.20mm")

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    owner = relationship("User", backref="projects")
    source_model = relationship("Model", backref="source_projects")


class VerificationCode(Base):
    __tablename__ = "verification_codes"

    email = Column(String(254), primary_key=True)
    code = Column(String(6), nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, default=_utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    model_id = Column(Integer, ForeignKey("models.id"), nullable=True, index=True)
    type = Column(String(50), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    link = Column(String(500), nullable=True)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow, index=True)

    user = relationship("User", foreign_keys=[user_id], back_populates="notifications")
    actor = relationship("User", foreign_keys=[actor_user_id])
    model = relationship("Model")


class ModelReport(Base):
    __tablename__ = "model_reports"

    id = Column(Integer, primary_key=True, index=True)
    model_id = Column(Integer, ForeignKey("models.id"), nullable=False, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    reason = Column(String(100), nullable=False)
    details = Column(Text, nullable=True)
    status = Column(String(32), default="pending", nullable=False, index=True)
    created_at = Column(DateTime, default=_utcnow, index=True)
    reviewed_at = Column(DateTime, nullable=True)
    reviewer_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    model = relationship("Model", back_populates="reports")
    reporter = relationship("User", foreign_keys=[reporter_id], backref="model_reports")
    reviewer = relationship("User", foreign_keys=[reviewer_id])


class PrintFeedback(Base):
    __tablename__ = "print_feedback"

    id = Column(Integer, primary_key=True, index=True)
    model_id = Column(Integer, ForeignKey("models.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    print_history_id = Column(Integer, ForeignKey("print_history.id"), nullable=True, index=True)
    rating = Column(Integer, nullable=False, default=5)
    content = Column(Text, nullable=False)
    printer_model = Column(String(255), nullable=True)
    material = Column(String(100), nullable=True)
    gcode_filename = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=_utcnow, index=True)

    model = relationship("Model", back_populates="feedback")
    user = relationship("User", backref="print_feedback")
    print_history = relationship("PrintHistory", backref="feedback")


class Process4DTask(Base):
    __tablename__ = "process_4d_tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(12), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String(32), nullable=False, default="queued", index=True)
    progress = Column(Integer, default=0, nullable=False)
    current_stage = Column(String(80), nullable=True)
    message = Column(Text, nullable=True)
    logs = Column(JSON, default=list)
    result = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow, index=True)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow, index=True)

    user = relationship("User", backref="process_4d_tasks")
