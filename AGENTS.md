# 4D-Print 工程环境与 AI 协作约束

本文档给开发者和不同 AI 编程助手使用。修改本项目之前，先读完本文档，再读相关代码和脚本。不要只根据旧对话、旧 README 或单个报错做判断。

## 项目定位

4D-Print 是一个 Windows 开发、Linux 部署的全栈 4D 打印应用。

- 前端：React 19 + TypeScript + Vite，目录 `frontend/`。
- 后端：FastAPI + SQLAlchemy，目录 `backend/`。
- 本地统一启动入口：`run.py`。
- Linux 一键部署入口：`scripts/deploy-server.sh`。
- 主要运行数据：数据库、上传模型、缩略图、头像、切片输出、G-code。
- 主要外部能力：Tripo 3D AI、OpenAI/Agnes 文本模型、讯飞语音、SMTP 邮箱验证码、PrusaSlicer、Klipper/Moonraker。

当前仓库中可能存在历史文档和文件编码问题。以当前代码、脚本和测试为准；旧文档只能作为背景，不可作为唯一事实来源。

## 目录边界

```text
backend/                  FastAPI 后端
backend/app/api/          API 路由
backend/app/core/         数据库、路径、文件、安全、限流等共享逻辑
backend/app/models/       SQLAlchemy 模型
backend/configs/          PrusaSlicer 配置
backend/resources/        后端资源，例如模型查看器 HDR
backend/tests/            后端 pytest
frontend/                 React/Vite 前端
frontend/src/services/    前端 API 封装
frontend/src/utils/       前端共享工具，例如路径处理
frontend/tests/           Node 测试
scripts/                  开发、部署、迁移、打包脚本
docs/plans/               设计和部署计划；可能不是最新运行事实
run.py                    Windows/本地开发统一启动入口
```

不要把运行时上传文件、数据库、虚拟环境、`node_modules`、`frontend/dist` 当作源码提交或依赖。

## Windows 开发环境

推荐在 Windows 上开发，项目路径可能是：

```text
G:\4d-print\4D-print
```

本地启动：

```powershell
python run.py
```

启动后：

```text
后端: http://localhost:8000
前端: http://localhost:5173
API 文档: http://localhost:8000/docs
```

`run.py` 会按顺序寻找后端 Python：

1. 环境变量 `BACKEND_PYTHON`
2. `backend/.venv/Scripts/python.exe`
3. `backend/.venv/bin/python`
4. 当前 `sys.executable`
5. `python3.12` / `python3.11` / `python3.10` / `python3`
6. Windows `py -3`

后端要求 Python 3.10+。不要再把本地开发硬编码为 `py -3.11` 或任何单一 Python 小版本。

前端由 `run.py` 调用：

```powershell
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

如果端口被占用，优先查清进程：

```powershell
Get-NetTCPConnection -LocalPort 8000,5173 | Select-Object LocalPort,OwningProcess
```

不要盲目杀进程；确认是本项目残留的 `run.py`、`uvicorn main:app` 或 Vite 后再停止。

## Linux 部署环境

Linux 部署入口是：

```bash
sudo bash scripts/deploy-server.sh
```

当前线上服务器资源：2 核 2G。任何新增功能、并发、后台任务、构建步骤和常驻进程都要按这个资源预算评估，避免默认假设更大的机器。

支持的服务器类型以脚本检测为准：

- Debian/Ubuntu：`apt-get`
- RHEL/CentOS/Alibaba Cloud Linux 类系统：`dnf` 或 `yum`

默认部署形态：

```text
代码目录: /opt/4d-print
数据目录: /var/lib/4d-print
后端服务: 127.0.0.1:8000
前端静态文件: /opt/4d-print/frontend/dist
反向代理: Nginx
systemd 服务: 4d-print-api.service
```

部署脚本当前以 MySQL URL 生成为默认 `.env` 行为：

```text
DATABASE_URL=mysql+pymysql://...
```

SQLite 仍由后端支持；迁移到 MySQL 使用：

```bash
sudo bash scripts/deploy-server.sh --migrate-sqlite --source-sqlite /path/to/makerworld.db
```

不要把旧文档中“默认 SQLite”的说法当作当前部署脚本事实。判断部署行为时读 `scripts/deploy-server.sh`。

部署脚本关键约束：

- Python 默认命令是 `python3`，并自动选择 `python3.12`、`python3.11`、`python3.10`、`python3` 中可用且满足 3.10+ 的版本。
- `--python-bin` 是显式选择，不能被自动候选覆盖。
- Debian 系服务用户是 `www-data`，RHEL 系服务用户是 `nginx`。
- `/opt/4d-print/backend/.env` 应为 `root:www-data` 或 `root:nginx`，权限 `640`，保证 systemd 后端进程可读但不公开。
- systemd 应使用 `${APP_DIR}/backend/.venv/bin/python -m uvicorn main:app` 启动，不要依赖 venv 内 `uvicorn` 可执行文件路径。
- `build_backend` 必须在 `run_sqlite_migration` 之前执行，因为迁移脚本依赖后端 venv 里的依赖。
- 运行时数据目录 `/var/lib/4d-print` 归服务用户所有，不应混入代码目录。

## 配置和运行时数据

后端配置来自 `backend/.env` 或部署后的 `/opt/4d-print/backend/.env`。

重要变量：

```env
DATABASE_URL=
DATA_DIR=/var/lib/4d-print
UPLOAD_ROOT=/var/lib/4d-print/uploads
JWT_SECRET_KEY=
CORS_ORIGINS=
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

路径解析集中在 `backend/app/core/paths.py`。Windows 和 Linux 都必须遵守：

- 数据根目录由 `DATA_DIR` 决定，未配置时回退到 `backend/`。
- 上传根目录由 `UPLOAD_ROOT` 决定，未配置时为 `${DATA_DIR}/uploads`。
- 存进数据库或发给前端的上传相对路径应使用 `/`。
- 接收用户或前端传入的相对路径时，必须同时接受 Windows `\` 和 POSIX `/`，再做安全归一化。
- 任何下载、读取、删除接口都必须防止路径逃逸。

前端路径拼接应使用 `frontend/src/utils/path.ts` 和 `frontend/src/services/api.ts` 中的封装。不要在页面组件里手写 `split('/')` 处理文件名，也不要直接拼接带反斜杠的 URL。

## 数据库

后端数据库入口是 `backend/app/core/database.py`。

- 如果 `DATABASE_URL` 为空，后端会使用 `${DATA_DIR}/makerworld.db`。
- 相对 SQLite 路径会按 `DATA_DIR` 归一化。
- MySQL 使用 `mysql+pymysql://...`。
- Windows 本地可以使用 SQLite 做轻量开发；Linux 正式部署通常使用部署脚本生成的 MySQL URL。

修改模型字段时必须同步考虑：

- `backend/app/models/__init__.py`
- 对应 API schema/response
- 迁移脚本 `scripts/migrate_sqlite_to_mysql.py`
- 现有测试和必要的新测试

## 关键业务模块

AI 生成：

- 路由主要在 `backend/app/api/ai.py`
- 依赖 `TRIPO_API_KEY`
- Key 格式有校验，Tripo key 预期以 `tsk_` 开头

模型、缩略图、查看器环境：

- 路由主要在 `backend/app/api/models.py`
- HDR 默认资源在 `backend/resources/viewer-environments/default.hdr`
- 前端查看器默认从 `/api/models/viewer-environment` 取环境贴图

G-code、切片、磁性区域处理：

- 路由和核心处理主要在 `backend/app/api/gcode.py`
- PrusaSlicer 路径来自 `PRUSASLICER_PATH` 或系统 PATH
- G-code 文件名必须经过安全文件名处理

设备控制：

- 路由主要在 `backend/app/api/device.py`
- 默认 Moonraker 地址来自 `MOONRAKER_URL`
- 需要兼容 HTTP 和 WebSocket Moonraker 请求

用户、验证码、头像：

- 路由主要在 `backend/app/api/users.py`
- 邮件验证码依赖 SMTP 变量
- 未配置 SMTP 时，开发模式会返回/记录开发验证码
- 头像路径要走统一上传路径规则

项目保存：

- 路由主要在 `backend/app/api/projects.py`
- 保存模型 URL、磁性区域、涂色数据、切片/G-code 结果等复杂 JSON 字段

## 测试和验证命令

改后端逻辑后至少运行：

```powershell
cd backend
python -m pytest -q
```

改前端逻辑后至少运行：

```powershell
cd frontend
npm run build
```

改路径兼容逻辑后运行：

```powershell
cd backend
python -m pytest -q tests/test_paths.py
cd ..\frontend
node --test tests/path-utils.test.mjs
```

改部署脚本后运行：

```powershell
cd backend
python -m pytest -q tests/test_deploy_script.py
```

如果本机有可用 Bash，还应运行：

```bash
bash -n scripts/deploy-server.sh
```

当前 Windows 环境可能存在 WSL 的 `bash.exe` 损坏问题，表现为 `/bin/bash` 不存在。遇到这种情况不要声称完成了 Bash 语法验证，只能说明已用文本测试覆盖关键部署契约。

运行时烟测：

```powershell
python run.py
```

确认：

```text
http://localhost:8000/health
http://localhost:5173/
http://localhost:5173/api/models/?sort_by=newest&limit=1
```

都返回 200 后，再停止服务。

## AI 协作规则

不同 AI 模型接手时必须遵守以下约束：

1. 先理解当前代码再修改。优先读相关入口、共享工具和测试，不要只看报错点。
2. Windows 开发、Linux 部署是核心约束。任何路径、脚本、依赖、权限改动都要同时考虑两边。
3. 不要硬编码单一 Python 小版本。后端最低要求是 Python 3.10+。
4. 不要在前端页面组件里手写文件路径拆分；使用共享 path 工具和 API service。
5. 不要把 Windows 路径分隔符 `\` 写进 URL 或数据库相对路径；存储和传输统一使用 `/`。
6. 不要把上传文件、数据库、虚拟环境、依赖目录或构建产物提交进源码。
7. 不要大范围修复 mojibake 或换行符，除非任务明确要求。编码清理很容易污染 diff。
8. 不要重写部署脚本的服务用户、`.env` 权限、systemd 启动命令和迁移顺序，除非有测试覆盖。
9. 不要信任过期文档。脚本和代码是当前事实来源；文档如冲突，应修正文档或明确指出冲突。
10. 不要回滚用户已有改动。工作区可能是 dirty 的，只改和任务直接相关的文件。
11. 修改后给出实际执行过的验证命令和结果；未能执行的验证要明确说明原因。
12. 涉及外部网络、AI API、SMTP、Moonraker、PrusaSlicer 的问题，要区分代码缺陷、配置缺失和第三方服务不可用。

## 推荐排查顺序

本地启动失败：

1. 看 `python run.py` 输出的后端解释器。
2. 确认 Python 版本 3.10+。
3. 确认 `backend/.venv` 是否存在且依赖完整。
4. 确认 8000/5173 端口未被占用。
5. 分别进入 `backend`、`frontend` 单独启动定位。

Linux 部署失败：

1. 先看 `scripts/deploy-server.sh` 当前内容。
2. 确认系统包管理器是 `apt-get`、`dnf` 或 `yum`。
3. 确认 Python 3.10+ 和 Node.js 20+。
4. 看 `/opt/4d-print/backend/.env` 权限和内容。
5. 看 `systemctl status 4d-print-api` 和 `journalctl -u 4d-print-api -n 200`。
6. 看 `nginx -t` 和 Nginx 站点配置。
7. 用 `curl http://127.0.0.1:8000/health` 与 `curl http://127.0.0.1/health` 分别区分后端和反代问题。

路径或文件访问失败：

1. 看 `DATA_DIR` 和 `UPLOAD_ROOT`。
2. 看数据库里保存的是相对路径还是绝对路径。
3. 确认 API URL 是否经过 `encodeURIComponent`。
4. 检查后端是否使用 `safe_filename()` 或 `resolve_upload_relative_path()`。
5. 为 Windows `\` 和 Linux `/` 都补测试。

## 交付标准

兼容性修复不能只靠“看起来对”。至少要有以下一种或多种证据：

- 后端 pytest 通过。
- 前端 build 或相关 Node 测试通过。
- 部署脚本文本测试或 Bash 语法检查通过。
- 本地 `python run.py` 烟测通过。
- 对 Linux 行为的结论来自脚本、systemd/Nginx 配置、命令输出或专门测试，而不是猜测。

如果某项验证受当前环境限制无法执行，必须在回复中明确写出限制和替代验证。
