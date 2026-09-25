from fastapi import APIRouter, HTTPException, Depends, status, UploadFile, File, Request
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from jose import jwt, JWTError
from datetime import datetime, timedelta, timezone
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Optional
from email.message import EmailMessage
from urllib.parse import urlencode
import os
import uuid
import logging
import bcrypt
import secrets
import smtplib
import httpx
from app.core.database import get_db
from app.core.file_io import remove_file_quietly, safe_filename
from app.core.paths import AVATAR_DIR
from app.schemas import (
    EmailCodeLoginRequest,
    LoginRequest,
    Token,
    UserCreate,
    UserResponse,
    UserUpdate,
    VerificationCodeRequest,
    VerificationCodeResponse,
    VerificationPurpose,
    WeChatLoginRequest,
    WeChatLoginResponse,
    WeChatLoginUrlResponse,
)
from app.models import User, VerificationCode
from app.core.rate_limit import auth_limiter, get_client_ip

logger = logging.getLogger(__name__)

_jwt_secret = os.getenv("JWT_SECRET_KEY")
if not _jwt_secret:
    logger.error("JWT_SECRET_KEY environment variable is required but not set")
    raise RuntimeError("JWT_SECRET_KEY must be set in environment variables. Generate one with: python -c 'import secrets; print(secrets.token_hex(32))'")
SECRET_KEY = _jwt_secret
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24
VERIFICATION_CODE_EXPIRE_MINUTES = 10
WECHAT_STATE_EXPIRE_MINUTES = 10
WECHAT_QRCONNECT_URL = "https://open.weixin.qq.com/connect/qrconnect"
WECHAT_ACCESS_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token"
WECHAT_USERINFO_URL = "https://api.weixin.qq.com/sns/userinfo"

verification_codes: dict[str, tuple[str, datetime]] = {}

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/users/login")

router = APIRouter()


@dataclass(frozen=True, slots=True)
class WeChatConfig:
    app_id: str
    app_secret: str
    redirect_uri: str
    scope: str


@dataclass(frozen=True, slots=True)
class WeChatProfile:
    openid: str
    nickname: str
    unionid: str | None = None
    avatar_url: str | None = None

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode('utf-8'), 
        hashed_password.encode('utf-8')
    )

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def create_access_token(data: Mapping[str, str], expires_delta: Optional[timedelta] = None) -> str:
    to_encode: dict[str, object] = dict(data)
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_token_response(user: User) -> dict[str, object]:
    access_token = create_access_token(data={"sub": str(user.email)})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": UserResponse.model_validate(user),
    }


def sanitize_redirect_path(redirect_url: str | None) -> str:
    if redirect_url and redirect_url.startswith("/") and not redirect_url.startswith("//"):
        return redirect_url
    return "/"


def get_wechat_config() -> WeChatConfig | None:
    app_id = os.getenv("WECHAT_APP_ID", "").strip()
    app_secret = os.getenv("WECHAT_APP_SECRET", "").strip()
    redirect_uri = os.getenv("WECHAT_REDIRECT_URI", "").strip()
    scope = os.getenv("WECHAT_SCOPE", "snsapi_login").strip() or "snsapi_login"
    if not app_id or not app_secret or not redirect_uri:
        return None
    return WeChatConfig(app_id=app_id, app_secret=app_secret, redirect_uri=redirect_uri, scope=scope)


def create_wechat_state(redirect_url: str | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=WECHAT_STATE_EXPIRE_MINUTES)
    payload: dict[str, object] = {
        "typ": "wechat_oauth_state",
        "redirect_url": sanitize_redirect_path(redirect_url),
        "nonce": secrets.token_urlsafe(16),
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_wechat_state(state: str) -> str:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=400, detail="微信登录状态已失效，请重新发起登录") from None
    if payload.get("typ") != "wechat_oauth_state":
        raise HTTPException(status_code=400, detail="微信登录状态无效")
    redirect_url = payload.get("redirect_url")
    return sanitize_redirect_path(redirect_url if isinstance(redirect_url, str) else None)


def build_wechat_auth_url(config: WeChatConfig, state: str) -> str:
    query = urlencode(
        {
            "appid": config.app_id,
            "redirect_uri": config.redirect_uri,
            "response_type": "code",
            "scope": config.scope,
            "state": state,
        }
    )
    return f"{WECHAT_QRCONNECT_URL}?{query}#wechat_redirect"

def cleanup_verification_codes(db: Session | None = None) -> None:
    now = datetime.now(timezone.utc)
    expired = [email for email, (_, expires_at) in verification_codes.items() if expires_at <= now]
    for email in expired:
        _ = verification_codes.pop(email, None)
    if db is not None:
        query = db.query(VerificationCode).filter(VerificationCode.expires_at <= now)
        if hasattr(query, "delete"):
            query.delete(synchronize_session=False)
            db.commit()


def store_verification_code(db: Session, email: str, code: str, expires_at: datetime) -> None:
    verification_codes[email] = (code, expires_at)
    try:
        existing = db.query(VerificationCode).filter(VerificationCode.email == email).first()
        if existing:
            setattr(existing, "code", code)
            setattr(existing, "expires_at", expires_at)
            setattr(existing, "created_at", datetime.now(timezone.utc))
        else:
            db.add(VerificationCode(email=email, code=code, expires_at=expires_at))
        db.commit()
    except Exception:
        logger.debug("Verification code DB persistence unavailable", exc_info=True)


def get_stored_verification_code(db: Session, email: str) -> tuple[str, datetime] | None:
    stored = verification_codes.get(email)
    if stored:
        return stored
    row = db.query(VerificationCode).filter(VerificationCode.email == email).first()
    if row:
        expires_at = getattr(row, "expires_at")
        return str(getattr(row, "code")), expires_at
    return None


def pop_verification_code(db: Session, email: str) -> None:
    _ = verification_codes.pop(email, None)
    try:
        row = db.query(VerificationCode).filter(VerificationCode.email == email).first()
        if row:
            db.delete(row)
            db.commit()
    except Exception:
        logger.debug("Verification code DB cleanup unavailable", exc_info=True)

def send_email_code(email: str, code: str, purpose: VerificationPurpose) -> bool:
    smtp_host = os.getenv("SMTP_HOST")
    if not smtp_host:
        logger.info("SMTP_HOST is not set; generated development verification code for %s", email)
        return False

    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USERNAME")
    smtp_password = os.getenv("SMTP_PASSWORD")
    smtp_from = os.getenv("SMTP_FROM") or smtp_user
    use_tls = os.getenv("SMTP_USE_TLS", "true").lower() != "false"
    if not smtp_from:
        logger.warning("SMTP_FROM or SMTP_USERNAME must be set before sending verification email")
        return False

    action = "登录" if purpose == "login" else "注册"
    message = EmailMessage()
    message["Subject"] = f"创客学堂{action}验证码"
    message["From"] = smtp_from
    message["To"] = email
    message.set_content(f"你的创客学堂{action}验证码是：{code}\n\n验证码 {VERIFICATION_CODE_EXPIRE_MINUTES} 分钟内有效。")

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            if use_tls:
                _ = server.starttls()
            if smtp_user and smtp_password:
                _ = server.login(smtp_user, smtp_password)
            _ = server.send_message(message)
        return True
    except Exception as exc:
        logger.warning("Failed to send verification email to %s: %s", email, exc)
        return False


def read_wechat_error(data: object, fallback: str) -> str:
    if isinstance(data, dict):
        message = data.get("errmsg")
        if isinstance(message, str) and message:
            return message
    return fallback


async def fetch_wechat_profile(code: str) -> WeChatProfile:
    config = get_wechat_config()
    if config is None:
        raise HTTPException(status_code=503, detail="微信登录暂未配置")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            token_response = await client.get(
                WECHAT_ACCESS_TOKEN_URL,
                params={
                    "appid": config.app_id,
                    "secret": config.app_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                },
            )
            token_response.raise_for_status()
            token_data = token_response.json()
            if not isinstance(token_data, dict):
                raise HTTPException(status_code=502, detail="微信授权响应异常")
            access_token = token_data.get("access_token")
            openid = token_data.get("openid")
            if not isinstance(access_token, str) or not isinstance(openid, str):
                detail = read_wechat_error(token_data, "微信授权失败，请重新扫码")
                raise HTTPException(status_code=400, detail=detail)

            user_response = await client.get(
                WECHAT_USERINFO_URL,
                params={
                    "access_token": access_token,
                    "openid": openid,
                    "lang": "zh_CN",
                },
            )
            user_response.raise_for_status()
            user_data = user_response.json()
    except httpx.HTTPError:
        logger.warning("WeChat OAuth request failed", exc_info=True)
        raise HTTPException(status_code=503, detail="微信服务暂时不可用，请稍后再试") from None
    except ValueError:
        logger.warning("WeChat OAuth response was not JSON", exc_info=True)
        raise HTTPException(status_code=502, detail="微信授权响应异常") from None

    if not isinstance(user_data, dict):
        raise HTTPException(status_code=502, detail="微信用户信息响应异常")
    nickname = user_data.get("nickname")
    unionid = user_data.get("unionid")
    avatar_url = user_data.get("headimgurl")
    return WeChatProfile(
        openid=openid,
        nickname=nickname if isinstance(nickname, str) and nickname.strip() else f"微信用户{openid[-6:]}",
        unionid=unionid if isinstance(unionid, str) and unionid else None,
        avatar_url=avatar_url if isinstance(avatar_url, str) and avatar_url else None,
    )


def normalize_wechat_username(nickname: str, openid: str) -> str:
    base = nickname.strip().replace("\x00", "") or f"微信用户{openid[-6:]}"
    if len(base) < 2:
        base = f"微信用户{openid[-6:]}"
    return base[:24]


def create_unique_wechat_username(db: Session, nickname: str, openid: str) -> str:
    base = normalize_wechat_username(nickname, openid)
    for index in range(20):
        suffix = "" if index == 0 else str(index + 1)
        candidate = f"{base[:30 - len(suffix)]}{suffix}"
        existing = db.query(User).filter(User.username == candidate).first()
        if not existing:
            return candidate
    return f"微信用户{secrets.token_hex(4)}"


def upsert_wechat_user(db: Session, profile: WeChatProfile) -> User:
    user = None
    if profile.unionid:
        user = db.query(User).filter(User.wechat_unionid == profile.unionid).first()
    if user is None:
        user = db.query(User).filter(User.wechat_openid == profile.openid).first()
    if user is not None:
        setattr(user, "wechat_openid", profile.openid)
        setattr(user, "wechat_unionid", profile.unionid)
        setattr(user, "wechat_nickname", profile.nickname)
        db.commit()
        db.refresh(user)
        return user

    email = f"wechat_{profile.openid}@wechat.local"
    existing_email_user = db.query(User).filter(User.email == email).first()
    if existing_email_user is not None:
        setattr(existing_email_user, "wechat_openid", profile.openid)
        setattr(existing_email_user, "wechat_unionid", profile.unionid)
        setattr(existing_email_user, "wechat_nickname", profile.nickname)
        db.commit()
        db.refresh(existing_email_user)
        return existing_email_user

    db_user = User(
        username=create_unique_wechat_username(db, profile.nickname, profile.openid),
        email=email,
        phone=None,
        hashed_password=get_password_hash(secrets.token_urlsafe(32)),
        avatar_path=None,
        email_verified=False,
        wechat_openid=profile.openid,
        wechat_unionid=profile.unionid,
        wechat_nickname=profile.nickname,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub") or ""
        if not email:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
    return user

async def get_optional_user(
    token: Optional[str] = Depends(OAuth2PasswordBearer(tokenUrl="/api/users/login", auto_error=False)),
    db: Session = Depends(get_db),
) -> Optional[User]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub") or ""
        if not email:
            return None
        return db.query(User).filter(User.email == email).first()
    except JWTError:
        return None

async def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    if not bool(current_user.is_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user

@router.post("/verification-code", response_model=VerificationCodeResponse)
async def request_verification_code(payload: VerificationCodeRequest, request: Request, db: Session = Depends(get_db)):
    email = payload.email
    auth_limiter.check(f"verification-code:{get_client_ip(request)}:{email}")
    cleanup_verification_codes(db)
    existing = db.query(User).filter(User.email == email).first()
    if payload.purpose == "register" and existing:
        raise HTTPException(status_code=400, detail="该邮箱已注册")
    if payload.purpose == "login" and not existing:
        raise HTTPException(status_code=400, detail="该邮箱尚未注册")

    code = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=VERIFICATION_CODE_EXPIRE_MINUTES)
    store_verification_code(db, email, code, expires_at)
    sent = send_email_code(email, code, payload.purpose)
    if not sent and os.getenv("SMTP_HOST"):
        pop_verification_code(db, email)
        raise HTTPException(status_code=503, detail="验证码发送失败，请稍后再试")
    action = "登录" if payload.purpose == "login" else "注册"
    return {
        "success": True,
        "message": f"{action}验证码已发送到邮箱" if sent else f"开发模式{action}验证码已生成",
        "dev_code": None if sent else code,
    }

@router.post("/register", response_model=Token)
async def register(user: UserCreate, request: Request, db: Session = Depends(get_db)):
    auth_limiter.check(f"register:{get_client_ip(request)}")
    cleanup_verification_codes(db)
    email = user.email
    stored_code = get_stored_verification_code(db, email)
    if not stored_code or stored_code[0] != user.verification_code or stored_code[1] <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="验证码错误或已过期")

    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    existing_username = db.query(User).filter(User.username == user.username).first()
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already taken")

    existing_phone = db.query(User).filter(User.phone == user.phone).first()
    if existing_phone:
        raise HTTPException(status_code=400, detail="该手机号已注册")
    
    hashed_password = get_password_hash(user.password)
    db_user = User(
        username=user.username,
        email=user.email,
        phone=user.phone,
        hashed_password=hashed_password,
        email_verified=True,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    pop_verification_code(db, email)
    return create_token_response(db_user)

@router.post("/login", response_model=Token)
async def login(login_req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    auth_limiter.check(f"login:{get_client_ip(request)}")
    user = db.query(User).filter(User.email == login_req.email).first()
    if not user:
        raise HTTPException(status_code=401, detail="该邮箱尚未注册")
    if not verify_password(login_req.password, str(user.hashed_password)):
        raise HTTPException(status_code=401, detail="密码错误")

    return create_token_response(user)


@router.post("/login/code", response_model=Token)
async def login_with_verification_code(login_req: EmailCodeLoginRequest, request: Request, db: Session = Depends(get_db)):
    auth_limiter.check(f"login-code:{get_client_ip(request)}:{login_req.email}")
    cleanup_verification_codes(db)
    user = db.query(User).filter(User.email == login_req.email).first()
    if not user:
        raise HTTPException(status_code=401, detail="该邮箱尚未注册")
    stored_code = get_stored_verification_code(db, login_req.email)
    if not stored_code or stored_code[0] != login_req.verification_code or stored_code[1] <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="验证码错误或已过期")
    setattr(user, "email_verified", True)
    db.commit()
    db.refresh(user)
    pop_verification_code(db, login_req.email)
    return create_token_response(user)


@router.get("/wechat/login-url", response_model=WeChatLoginUrlResponse)
async def get_wechat_login_url(redirect: str = "/"):
    config = get_wechat_config()
    if config is None:
        raise HTTPException(status_code=503, detail="微信登录暂未配置")
    state = create_wechat_state(redirect)
    return {"auth_url": build_wechat_auth_url(config, state)}


@router.post("/wechat/login", response_model=WeChatLoginResponse)
async def login_with_wechat(payload: WeChatLoginRequest, request: Request, db: Session = Depends(get_db)):
    auth_limiter.check(f"wechat-login:{get_client_ip(request)}")
    redirect_url = decode_wechat_state(payload.state)
    profile = await fetch_wechat_profile(payload.code)
    user = upsert_wechat_user(db, profile)
    token_response = create_token_response(user)
    token_response["redirect_url"] = redirect_url
    return token_response

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)

@router.put("/me", response_model=UserResponse)
async def update_me(user_data: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current_email = str(current_user.email)
    current_username = str(current_user.username)
    current_phone = getattr(current_user, "phone", None)
    current_phone_value = current_phone if isinstance(current_phone, str) else None

    if user_data.email is not None and user_data.email != current_email:
        existing = db.query(User).filter(User.email == user_data.email).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
    
    if user_data.username is not None and user_data.username != current_username:
        existing = db.query(User).filter(User.username == user_data.username).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already in use")

    if user_data.phone is not None and user_data.phone != current_phone_value:
        existing = db.query(User).filter(User.phone == user_data.phone).first()
        if existing:
            raise HTTPException(status_code=400, detail="Phone already in use")
    
    if user_data.username is not None:
        setattr(current_user, "username", user_data.username)
    if user_data.email is not None:
        setattr(current_user, "email", user_data.email)
    if user_data.phone is not None:
        setattr(current_user, "phone", user_data.phone)
    
    db.commit()
    db.refresh(current_user)
    
    return UserResponse.model_validate(current_user)


os.makedirs(AVATAR_DIR, exist_ok=True)

@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        raise HTTPException(status_code=400, detail="不支持的图片格式")
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="头像不能超过 2MB")
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(AVATAR_DIR, filename)
    with open(filepath, "wb") as f:
        _ = f.write(content)
    old_avatar = getattr(current_user, "avatar_path", None)
    if isinstance(old_avatar, str) and old_avatar:
        old_path = os.path.join(AVATAR_DIR, safe_filename(old_avatar))
        remove_file_quietly(old_path)
    setattr(current_user, "avatar_path", filename)
    db.commit()
    db.refresh(current_user)
    return {"avatar_path": filename}

@router.get("/avatar/{filename}")
async def get_avatar(filename: str):
    safe_name = safe_filename(filename)
    filepath = os.path.join(AVATAR_DIR, safe_name)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Avatar not found")
    return FileResponse(path=filepath)
