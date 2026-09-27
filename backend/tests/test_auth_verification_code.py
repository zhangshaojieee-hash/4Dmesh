import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import cast

import pytest
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

_ = os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

from app.api import users
from app.models import User
from app.schemas import DeveloperLoginRequest, EmailCodeLoginRequest, UserCreate, UserResponse, VerificationCodeRequest, WeChatLoginRequest


def make_request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/users/verification-code",
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


class EmptyQuery:
    def filter(self, *_args: object) -> "EmptyQuery":
        return self

    def first(self) -> None:
        return None


class EmptyDb:
    added_user: object | None

    def __init__(self) -> None:
        self.added_user = None

    def query(self, _model: object) -> EmptyQuery:
        return EmptyQuery()

    def add(self, user: User) -> None:
        self.added_user = user
        setattr(user, "id", 1)
        setattr(user, "created_at", datetime.now(timezone.utc))
        setattr(user, "is_admin", False)
        setattr(user, "avatar_path", None)

    def commit(self) -> None:
        pass

    def refresh(self, _user: User) -> None:
        pass


class ExistingUserQuery:
    def __init__(self, user: User) -> None:
        self.user = user

    def filter(self, *_args: object) -> "ExistingUserQuery":
        return self

    def first(self) -> User:
        return self.user


class ExistingUserDb:
    def __init__(self, user: User) -> None:
        self.user = user

    def query(self, model: object) -> EmptyQuery | ExistingUserQuery:
        if model is User:
            return ExistingUserQuery(self.user)
        return EmptyQuery()

    def commit(self) -> None:
        pass

    def refresh(self, _user: User) -> None:
        pass


def as_session(db: EmptyDb) -> Session:
    return cast(Session, cast(object, db))


def as_existing_session(db: ExistingUserDb) -> Session:
    return cast(Session, cast(object, db))


def make_user() -> User:
    user = User(
        username="tester",
        email="user@example.com",
        phone="13800138000",
        hashed_password="hashed-password",
    )
    setattr(user, "id", 1)
    setattr(user, "created_at", datetime.now(timezone.utc))
    setattr(user, "is_admin", False)
    setattr(user, "avatar_path", None)
    setattr(user, "email_verified", False)
    return user


@pytest.fixture(autouse=True)
def reset_verification_state():
    users.verification_codes.clear()
    yield
    users.verification_codes.clear()


def test_verification_code_request_normalizes_email_before_validation():
    payload = VerificationCodeRequest(email=" User@Example.COM ")

    assert payload.email == "user@example.com"


def test_user_create_normalizes_email_and_verification_code():
    payload = UserCreate(
        username="tester",
        email=" User@Example.COM ",
        phone="13800138000",
        password="pass1234",
        verification_code=" 123456 ",
    )

    assert payload.email == "user@example.com"
    assert payload.verification_code == "123456"


def test_request_verification_code_dev_mode_stores_normalized_email(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)

    db = EmptyDb()
    result = asyncio.run(
        users.request_verification_code(
            VerificationCodeRequest(email=" User@Example.COM "),
            make_request(),
            as_session(db),
        )
    )

    dev_code = result["dev_code"]
    assert result["success"] is True
    assert isinstance(dev_code, str)
    assert len(dev_code) == 6
    assert "user@example.com" in users.verification_codes
    assert " User@Example.COM " not in users.verification_codes


def test_request_login_verification_code_requires_registered_email(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)

    with pytest.raises(HTTPException) as exc_info:
        _ = asyncio.run(
            users.request_verification_code(
                VerificationCodeRequest(email="missing@example.com", purpose="login"),
                make_request(),
                as_session(EmptyDb()),
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "该邮箱尚未注册"
    assert "missing@example.com" not in users.verification_codes


def test_request_login_verification_code_allows_registered_email(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    db = ExistingUserDb(make_user())

    result = asyncio.run(
        users.request_verification_code(
            VerificationCodeRequest(email="User@Example.COM", purpose="login"),
            make_request(),
            as_existing_session(db),
        )
    )

    assert result["success"] is True
    assert isinstance(result["dev_code"], str)
    assert "user@example.com" in users.verification_codes


def test_login_with_verification_code_consumes_code_and_marks_email_verified():
    user = make_user()
    users.verification_codes["user@example.com"] = (
        "123456",
        datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    db = ExistingUserDb(user)

    result = asyncio.run(
        users.login_with_verification_code(
            EmailCodeLoginRequest(email=" User@Example.COM ", verification_code=" 123456 "),
            make_request(),
            as_existing_session(db),
        )
    )

    user_response = result["user"]
    assert isinstance(user_response, UserResponse)
    assert result["token_type"] == "bearer"
    assert user_response.email == "user@example.com"
    assert getattr(user, "email_verified") is True
    assert "user@example.com" not in users.verification_codes


def test_developer_login_creates_non_admin_user(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("DEVELOPER_MODE_ENABLED", raising=False)
    db = EmptyDb()

    result = asyncio.run(
        users.developer_login(
            DeveloperLoginRequest(client_id="client-1234567890"),
            make_request(),
            as_session(db),
        )
    )

    assert db.added_user is not None
    assert result["token_type"] == "bearer"
    assert result["user"].is_admin is False
    assert result["user"].email.endswith("@local.invalid")


def smtp_failure(_email: str, _code: str, _purpose: str) -> bool:
    return False


def test_request_verification_code_cleans_up_when_configured_smtp_fails(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(users, "send_email_code", smtp_failure)

    with pytest.raises(HTTPException) as exc_info:
        _ = asyncio.run(
            users.request_verification_code(
                VerificationCodeRequest(email="user@example.com"),
                make_request(),
                as_session(EmptyDb()),
            )
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "验证码发送失败，请稍后再试"
    assert "user@example.com" not in users.verification_codes


def fake_password_hash(_password: str) -> str:
    return "hashed-password"


def test_register_consumes_normalized_email_code_after_success(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(users, "get_password_hash", fake_password_hash)
    users.verification_codes["user@example.com"] = (
        "123456",
        datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    db = EmptyDb()

    result = asyncio.run(
        users.register(
            UserCreate(
                username="tester",
                email=" User@Example.COM ",
                phone="13800138000",
                password="pass1234",
                verification_code=" 123456 ",
            ),
            make_request(),
            as_session(db),
        )
    )

    user_response = result["user"]
    assert db.added_user is not None
    assert isinstance(user_response, UserResponse)
    assert result["token_type"] == "bearer"
    assert user_response.email == "user@example.com"
    assert getattr(db.added_user, "email") == "user@example.com"
    assert getattr(db.added_user, "email_verified") is True
    assert "user@example.com" not in users.verification_codes


def test_get_wechat_login_url_requires_config(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("WECHAT_APP_ID", raising=False)
    monkeypatch.delenv("WECHAT_REDIRECT_URI", raising=False)

    with pytest.raises(HTTPException) as exc_info:
        _ = asyncio.run(users.get_wechat_login_url())

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "微信登录暂未配置"


async def fake_wechat_profile(_code: str) -> users.WeChatProfile:
    return users.WeChatProfile(openid="wx-openid", unionid="wx-unionid", nickname="微信测试")


def test_wechat_login_creates_local_user(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(users, "fetch_wechat_profile", fake_wechat_profile)
    state = users.create_wechat_state("/projects")
    db = EmptyDb()

    result = asyncio.run(
        users.login_with_wechat(
            WeChatLoginRequest(code="wechat-code", state=state),
            make_request(),
            as_session(db),
        )
    )

    added_user = db.added_user
    user_response = result["user"]
    assert added_user is not None
    assert isinstance(user_response, UserResponse)
    assert result["redirect_url"] == "/projects"
    assert user_response.email == "wechat_wx-openid@wechat.local"
    assert getattr(added_user, "wechat_openid") == "wx-openid"
    assert getattr(added_user, "wechat_unionid") == "wx-unionid"
