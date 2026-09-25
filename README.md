# 4D-Print

4D-Print 是一个面向 4D 打印工作流的全栈应用。当前程序包含模型市场、AI 生成、3D 模型查看、磁性区域编辑、切片/G-code 处理、项目保存、设备控制、打印历史、评论反馈和后台管理。

本仓库以当前代码、脚本和测试为准。`docs/plans/` 中的计划文档可作为背景资料，但不要把它们当作最新运行事实。

## 技术栈

- 前端：React 19、TypeScript、Vite、Three.js、React Three Fiber
- 后端：FastAPI、SQLAlchemy、PyMySQL、SQLite、Tripo 3D、OpenAI SDK、Moonraker WebSocket/HTTP
- 本地入口：`run.py`
- Linux 部署入口：`scripts/deploy-server.sh`
- 运行数据：数据库、上传模型、缩略图、头像、临时文件、切片输出、G-code

## 目录

```text
backend/                  FastAPI 后端
backend/app/api/          API 路由
backend/app/core/         数据库、路径、文件、安全、清理等共享逻辑
backend/app/models/       SQLAlchemy 模型
backend/configs/          PrusaSlicer 打印机和质量配置
backend/resources/        后端资源，例如模型查看器 HDR
backend/tests/            后端 pytest
frontend/                 React/Vite 前端
frontend/src/services/    前端 API 和设备服务封装
frontend/src/utils/       前端共享工具
frontend/tests/           Node 测试
scripts/                  部署、迁移、打包和辅助脚本
docs/plans/               设计和部署计划
run.py                    本地统一启动入口
```

不要提交运行时上传文件、数据库、虚拟环境、`node_modules` 或 `frontend/dist`。

## 本地开发

建议在 Windows 开发，也可以在 Linux 上运行同一套命令。后端需要 Python 3.10+，前端部署构建按 Node.js 20+ 设计。

首次准备：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt

cd ..\frontend
npm ci
```

如果使用 Linux/macOS，把后端 venv Python 路径换成：

```bash
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

复制配置模板：

```powershell
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```

本地启动：

```powershell
python run.py
```

启动后访问：

```text
前端: http://localhost:5173
后端: http://localhost:8000
API 文档: http://localhost:8000/docs
健康检查: http://localhost:8000/health
```

`run.py` 会自动寻找可用的 Python 3.10+，优先级为 `BACKEND_PYTHON`、`backend/.venv`、当前解释器、系统 `python3.12`/`python3.11`/`python3.10`/`python3`，Windows 下最后尝试 `py -3`。不要把开发脚本硬编码到单一 Python 小版本。

如果端口 8000 或 5173 被占用，先确认占用进程再停止。Windows 可用：

```powershell
Get-NetTCPConnection -LocalPort 8000,5173 | Select-Object LocalPort,OwningProcess
```

## 配置

后端读取 `backend/.env`。关键变量：

```env
DATABASE_URL=
DATA_DIR=
UPLOAD_ROOT=
JWT_SECRET_KEY=
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
TRIPO_API_KEY=
OPENAI_API_KEY=
AGNES_API_KEY=
AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
AGNES_MODEL=agnes-2.0-flash
IFLYTEK_APP_ID=
IFLYTEK_API_KEY=
IFLYTEK_API_SECRET=
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_USE_TLS=true
PRUSASLICER_PATH=
MOONRAKER_URL=http://localhost:7125
MODEL_VIEWER_HDR_PATH=resources/viewer-environments/default.hdr
MODEL_VIEWER_HDR_URL=
```

数据库行为：

- `DATABASE_URL` 为空时，后端使用 `${DATA_DIR}/makerworld.db`。
- `DATA_DIR` 未配置时回退到 `backend/`。
- `UPLOAD_ROOT` 未配置时使用 `${DATA_DIR}/uploads`。
- MySQL 使用 `mysql+pymysql://user:password@host:3306/dbname`。
- 相对 SQLite 路径会按 `DATA_DIR` 归一化。

前端读取 `frontend/.env`。常用变量：

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/api/voice/ws
VITE_FLUIDD_URL=http://localhost
VITE_USE_KLIPPER=true
VITE_DEVICE_SERVICE_MODE=
VITE_MODEL_VIEWER_HDR_URL=
```

## 主要功能

- 模型市场：上传、列表、搜索、分类、详情、版本、下载、缩略图、收藏、点赞。
- AI 生成：Tripo 文生 3D、图生 3D、任务查询、余额查询、外部模型下载代理、临时模型上传。
- 4D/G-code：模型拆分、3MF/GLB 转换、PrusaSlicer 切片、磁性区域指令插入、异步处理任务、G-code 编辑保存和下载。
- 项目保存：保存模型来源、磁性区域、表面涂色、体积区域、切片结果、G-code 结果和当前步骤。
- 设备控制：Moonraker 设备校验、添加、状态读取、暂停/恢复/停止、温度设置、G-code 发送和上传打印。
- 用户社区：邮箱验证码、注册登录、头像、评论、关注、通知、打印反馈、模型举报。
- 后台管理：用户、模型、项目、举报和基础统计。
- 语音助手：讯飞语音识别/合成，Agnes/OpenAI 兼容文本模型。

## 常用命令

后端测试：

```powershell
cd backend
python -m pytest -q
```

前端构建：

```powershell
cd frontend
npm run build
```

路径兼容测试：

```powershell
cd backend
python -m pytest -q tests/test_paths.py
cd ..\frontend
node --test tests/path-utils.test.mjs
```

部署脚本文本契约测试：

```powershell
cd backend
python -m pytest -q tests/test_deploy_script.py
```

如果环境有 Bash：

```bash
bash -n scripts/deploy-server.sh
```

## Linux 部署

一键部署脚本：

```bash
sudo bash scripts/deploy-server.sh
```

默认部署形态：

```text
代码目录: /opt/4d-print
数据目录: /var/lib/4d-print
后端服务: 127.0.0.1:8000
前端静态文件: /opt/4d-print/frontend/dist
反向代理: Nginx
systemd 服务: 4d-print-api.service
```

当前部署脚本会在首次创建 `.env` 时生成 MySQL `DATABASE_URL`：

```text
DATABASE_URL=mysql+pymysql://...
```

脚本不会替你创建 MySQL 实例和数据库账号。正式部署前请先准备 MySQL，或部署后手动把 `/opt/4d-print/backend/.env` 改成 SQLite URL。后端仍支持 SQLite，本地轻量开发可以直接让 `DATABASE_URL` 为空。

更多服务器步骤见 [Linux 服务器部署说明](docs/plans/2026-06-15-server-deployment-plan.md)。

## 打包发布

在 Windows 开发机运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-release.ps1
```

脚本会生成 `release/4d-print-server-*.zip`，并排除 `.env`、数据库、上传文件、虚拟环境、`node_modules` 和构建产物。

## 路径和文件规则

路径解析集中在 `backend/app/core/paths.py`：

- 数据根目录由 `DATA_DIR` 决定。
- 上传根目录由 `UPLOAD_ROOT` 决定。
- 存进数据库或返回前端的上传相对路径统一使用 `/`。
- 后端接收前端传入路径时同时兼容 Windows `\` 和 POSIX `/`。
- 下载、读取和删除文件时必须防止路径逃逸。

前端文件 URL 和文件名处理使用 `frontend/src/utils/path.ts` 与 `frontend/src/services/api.ts`，页面组件不要手写路径拆分或直接拼接反斜杠 URL。

## 外部依赖说明

- Tripo 3D：`TRIPO_API_KEY`，当前代码校验 key 需以 `tsk_` 开头。
- PrusaSlicer：`PRUSASLICER_PATH` 或系统 PATH，用于切片。
- Moonraker/Klipper：`MOONRAKER_URL`，用于设备控制。
- SMTP：未配置时开发模式会返回/记录验证码；生产环境应配置邮件服务。
- 讯飞语音：`IFLYTEK_APP_ID`、`IFLYTEK_API_KEY`、`IFLYTEK_API_SECRET`。
- Agnes/OpenAI 兼容文本模型：`AGNES_API_KEY`、`AGNES_BASE_URL`、`AGNES_MODEL`。
