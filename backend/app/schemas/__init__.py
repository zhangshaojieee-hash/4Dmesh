from pydantic import BaseModel, Field, field_validator
from typing import Literal, Optional
from datetime import datetime
import re

VerificationPurpose = Literal["register", "login"]


def _normalize_email(v: str) -> str:
    email = v.lower().strip()
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        raise ValueError('邮箱格式不正确')
    return email


class UserBase(BaseModel):
    username: str = Field(min_length=2, max_length=30)
    email: str = Field(max_length=254)

    @field_validator('email', mode='before')
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _normalize_email(v)

class UserCreate(UserBase):
    phone: str = Field(min_length=11, max_length=20)
    password: str = Field(max_length=128)
    verification_code: str = Field(min_length=6, max_length=6)

    @field_validator('password')
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError('密码长度不能少于8位')
        if not re.search(r'[a-zA-Z]', v):
            raise ValueError('密码必须包含至少一个字母')
        if not re.search(r'\d', v):
            raise ValueError('密码必须包含至少一个数字')
        return v

    @field_validator('phone')
    @classmethod
    def validate_phone(cls, v: str) -> str:
        normalized = v.strip()
        if not re.match(r'^1[3-9]\d{9}$', normalized):
            raise ValueError('手机号格式不正确')
        return normalized

    @field_validator('verification_code', mode='before')
    @classmethod
    def validate_verification_code(cls, v: str) -> str:
        code = v.strip()
        if not re.match(r'^\d{6}$', code):
            raise ValueError('验证码必须为6位数字')
        return code

class UserResponse(UserBase):
    id: int
    created_at: datetime
    phone: Optional[str] = None
    avatar_path: Optional[str] = None
    is_admin: bool = False
    email_verified: bool = False

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)

    @field_validator('email', mode='before')
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _normalize_email(v)


class DeveloperLoginRequest(BaseModel):
    client_id: str = Field(min_length=16, max_length=128)

    @field_validator('client_id')
    @classmethod
    def validate_client_id(cls, v: str) -> str:
        client_id = v.strip()
        if not re.match(r'^[A-Za-z0-9_-]+$', client_id):
            raise ValueError('开发者客户端标识格式不正确')
        return client_id

class VerificationCodeRequest(BaseModel):
    email: str = Field(max_length=254)
    purpose: VerificationPurpose = "register"

    @field_validator('email', mode='before')
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _normalize_email(v)

class VerificationCodeResponse(BaseModel):
    success: bool
    message: str
    dev_code: Optional[str] = None

class EmailCodeLoginRequest(BaseModel):
    email: str = Field(max_length=254)
    verification_code: str = Field(min_length=6, max_length=6)

    @field_validator('email', mode='before')
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _normalize_email(v)

    @field_validator('verification_code', mode='before')
    @classmethod
    def validate_verification_code(cls, v: str) -> str:
        code = v.strip()
        if not re.match(r'^\d{6}$', code):
            raise ValueError('验证码必须为6位数字')
        return code

class WeChatLoginUrlResponse(BaseModel):
    auth_url: str

class WeChatLoginRequest(BaseModel):
    code: str = Field(min_length=1, max_length=512)
    state: str = Field(min_length=1, max_length=1024)

class WeChatLoginResponse(Token):
    redirect_url: str

class UserUpdate(BaseModel):
    username: str = Field(min_length=2, max_length=30)
    email: str = Field(max_length=254)
    phone: Optional[str] = Field(None, min_length=11, max_length=20)

    @field_validator('email', mode='before')
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _normalize_email(v)

    @field_validator('phone')
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        normalized = v.strip()
        if not re.match(r'^1[3-9]\d{9}$', normalized):
            raise ValueError('手机号格式不正确')
        return normalized

class ModelBase(BaseModel):
    name: str = Field(max_length=200)
    description: Optional[str] = Field(None, max_length=5000)
    category: Optional[str] = Field("other", max_length=50)

class ModelResponse(ModelBase):
    id: int
    file_path: str
    thumbnail_path: Optional[str] = None
    downloads: int = 0
    likes: int = 0
    user_id: int
    author: Optional[str] = None
    created_at: datetime
    version_number: int = 1
    parent_model_id: Optional[int] = None

    class Config:
        from_attributes = True

class GcodeResponse(BaseModel):
    id: int
    name: str
    file_path: str
    model_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class FollowResponse(BaseModel):
    followed: bool
    followers_count: int
    following_count: int
