"""
create_admin.py — 创建或提升 4D-Print 后端管理员账号。

用法（在 backend 目录下运行，与启动服务相同的工作目录）:

    # 交互式
    python create_admin.py

    # 命令行参数（适合脚本/CI）
    python create_admin.py --username admin --email admin@example.com --password "ChangeMe123"

    # 仅把已存在的用户提升为管理员（无需密码）
    python create_admin.py --email someone@example.com --promote

    # 列出当前所有管理员
    python create_admin.py --list

行为:
    - 若 email 已存在: 提升为管理员（提供 --password 时同时重置密码）。
    - 若 email 不存在: 用提供的 username/email/password 新建管理员。
    - 复用应用同一套数据库配置(DATABASE_URL，默认 sqlite:///./makerworld.db)与 bcrypt 哈希。
"""
import argparse
import getpass
import os
import re
import sys

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import bcrypt

from sqlalchemy import inspect, text

from app.core.database import SessionLocal, engine, Base
from app.models import User

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def ensure_is_admin_column() -> None:
    Base.metadata.create_all(bind=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    if "is_admin" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT 0"))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def validate_password(password: str) -> str | None:
    if len(password) < 8:
        return "密码长度不能少于 8 位"
    if not re.search(r"[a-zA-Z]", password):
        return "密码必须包含至少一个字母"
    if not re.search(r"\d", password):
        return "密码必须包含至少一个数字"
    return None


def list_admins() -> int:
    db = SessionLocal()
    try:
        admins = db.query(User).filter(User.is_admin.is_(True)).all()
        if not admins:
            print("当前没有管理员账号。")
            return 0
        print(f"当前管理员（{len(admins)}）:")
        for u in admins:
            print(f"  #{u.id}  {u.username}  <{u.email}>")
        return 0
    finally:
        db.close()


def prompt(label: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{label}{suffix}: ").strip()
    return value or (default or "")


def main() -> int:
    parser = argparse.ArgumentParser(description="创建或提升 4D-Print 管理员账号")
    parser.add_argument("--username", help="用户名（新建时使用）")
    parser.add_argument("--email", help="邮箱（作为账号唯一标识）")
    parser.add_argument("--password", help="密码（≥8 位且含字母与数字）")
    parser.add_argument("--promote", action="store_true", help="仅提升已存在用户为管理员，不要求密码")
    parser.add_argument("--list", action="store_true", help="列出所有管理员后退出")
    args = parser.parse_args()

    ensure_is_admin_column()

    if args.list:
        return list_admins()

    email = (args.email or prompt("管理员邮箱")).lower().strip()
    if not EMAIL_RE.match(email):
        print("错误: 邮箱格式不正确", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == email).first()

        if existing:
            existing.is_admin = True
            action = "已提升为管理员"
            if not args.promote:
                password = args.password
                if password is None and sys.stdin.isatty():
                    entered = getpass.getpass("重置密码（留空跳过）: ").strip()
                    password = entered or None
                if password:
                    err = validate_password(password)
                    if err:
                        print(f"错误: {err}", file=sys.stderr)
                        return 1
                    existing.hashed_password = hash_password(password)
                    action = "已提升为管理员并重置密码"
            db.commit()
            db.refresh(existing)
            print(f"用户 {existing.username} <{existing.email}> {action}。")
            return 0

        if args.promote:
            print(f"错误: 用户 {email} 不存在，无法提升", file=sys.stderr)
            return 1

        username = (args.username or prompt("管理员用户名", "admin")).strip()
        if len(username) < 2:
            print("错误: 用户名至少 2 个字符", file=sys.stderr)
            return 1

        if db.query(User).filter(User.username == username).first():
            print(f"错误: 用户名 {username} 已被占用", file=sys.stderr)
            return 1

        password = args.password
        if password is None:
            if not sys.stdin.isatty():
                print("错误: 非交互模式下必须提供 --password", file=sys.stderr)
                return 1
            password = getpass.getpass("管理员密码: ").strip()
            confirm = getpass.getpass("确认密码: ").strip()
            if password != confirm:
                print("错误: 两次输入的密码不一致", file=sys.stderr)
                return 1
        err = validate_password(password)
        if err:
            print(f"错误: {err}", file=sys.stderr)
            return 1

        user = User(
            username=username,
            email=email,
            hashed_password=hash_password(password),
            is_admin=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"管理员已创建: #{user.id} {user.username} <{user.email}>")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
