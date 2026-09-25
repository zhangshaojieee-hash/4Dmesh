# 4D-Print Linux 服务器部署说明

这份文档说明如何把当前仓库部署到 Linux 服务器。部署行为以 `scripts/deploy-server.sh` 当前脚本为准；本文只记录脚本已经实现的流程和需要人工准备的条件。

## 1. 部署前准备

推荐服务器规格按当前线上预算控制：

- CPU：至少 2 核
- 内存：至少 2 GB，服务器构建前端时内存越大越稳
- 磁盘：至少 20 GB 可用空间
- 权限：可以使用 `sudo`
- 系统：Ubuntu/Debian，或 RHEL/CentOS/Alibaba Cloud Linux 类系统

脚本支持的包管理器：

- Debian/Ubuntu：`apt-get`
- RHEL/CentOS/Alibaba Cloud Linux：`dnf` 或 `yum`

后端需要 Python 3.10+。部署脚本会优先选择 `python3.12`、`python3.11`、`python3.10`、`python3` 中可用且满足要求的版本；如果传入 `--python-bin`，则使用显式指定的解释器。

前端构建按 Node.js 20+ 设计。脚本会在需要构建前端时检查并安装 Node.js 20。

## 2. 数据库要求

当前部署脚本首次创建 `/opt/4d-print/backend/.env` 时，默认写入 MySQL URL：

```env
DATABASE_URL=mysql+pymysql://makerworld:密码@localhost:3306/makerworld
```

脚本不会创建 MySQL 服务、数据库或账号。正式部署前请先准备 MySQL，并把 `--mysql-*` 参数传给脚本，或部署后编辑 `.env`。

示例：

```bash
sudo bash scripts/deploy-server.sh \
  --domain print.example.com \
  --mysql-host localhost \
  --mysql-port 3306 \
  --mysql-user makerworld \
  --mysql-name makerworld \
  --mysql-password 'your-password'
```

后端仍支持 SQLite。如果只是小规模试运行，可以部署后把 `/opt/4d-print/backend/.env` 中的 `DATABASE_URL` 改成：

```env
DATABASE_URL=sqlite:////var/lib/4d-print/makerworld.db
```

然后重启：

```bash
sudo systemctl restart 4d-print-api
```

从 SQLite 迁移到 MySQL：

```bash
sudo bash scripts/deploy-server.sh \
  --migrate-sqlite \
  --source-sqlite /path/to/makerworld.db \
  --mysql-password 'your-password'
```

迁移脚本依赖后端虚拟环境，部署脚本会先构建后端，再运行迁移。

## 3. 部署完成后的形态

```text
代码目录: /opt/4d-print
数据目录: /var/lib/4d-print
上传目录: /var/lib/4d-print/uploads
后端配置: /opt/4d-print/backend/.env
后端服务: 127.0.0.1:8000
前端静态文件: /opt/4d-print/frontend/dist
反向代理: Nginx
systemd 服务: 4d-print-api.service
```

服务用户：

- Debian/Ubuntu：`www-data`
- RHEL/CentOS/Alibaba Cloud Linux：`nginx`

`.env` 权限会设置为 `root:www-data` 或 `root:nginx`，权限 `640`。运行时数据目录归服务用户所有。

## 4. 在本地打包

在 Windows 开发机的仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-release.ps1
```

成功后生成：

```text
release/4d-print-server-YYYYMMDD-HHMMSS.zip
```

打包包含：

- 后端源码
- 前端源码
- 部署脚本
- 迁移脚本
- `backend/configs/*.ini`
- `backend/resources/viewer-environments/default.hdr`
- `frontend/package-lock.json`
- `backend/requirements.txt`

打包排除：

- `.env`
- 数据库文件
- 上传文件
- `node_modules`
- `frontend/dist`
- Python 虚拟环境
- 日志和缓存

## 5. 上传并解压

把 zip 上传到服务器，例如 `~/4d-print-server-YYYYMMDD-HHMMSS.zip`。

安装 unzip：

```bash
sudo apt-get update
sudo apt-get install -y unzip
```

RHEL/CentOS/Alibaba Cloud Linux：

```bash
sudo yum install -y unzip
```

解压：

```bash
cd ~
unzip 4d-print-server-*.zip -d 4d-print-release
cd 4d-print-release
```

确认能看到：

```text
backend  frontend  scripts  docs
```

## 6. 一键部署

没有域名、只用服务器 IP 测试：

```bash
sudo bash scripts/deploy-server.sh --mysql-password 'your-password'
```

有域名：

```bash
sudo bash scripts/deploy-server.sh \
  --domain print.example.com \
  --mysql-password 'your-password'
```

常用参数：

```text
--domain DOMAIN              Nginx server_name，默认 _
--app-dir PATH               代码目录，默认 /opt/4d-print
--data-dir PATH              运行数据目录，默认 /var/lib/4d-print
--api-port PORT              后端本机端口，默认 8000
--mirror china|default       是否切换国内镜像，默认 china
--install-prusaslicer        缺少 PrusaSlicer 时安装，失败则终止
--skip-prusaslicer           跳过 PrusaSlicer 安装
--python-bin COMMAND         显式指定 Python
--skip-frontend-build        跳过服务器前端构建
--frontend-dist PATH         使用已有 frontend/dist
--mysql-host HOST            MySQL 地址
--mysql-port PORT            MySQL 端口
--mysql-user USER            MySQL 用户
--mysql-name NAME            MySQL 数据库名
--mysql-password PASS        MySQL 密码
--migrate-sqlite             导入 SQLite 到 MySQL
--source-sqlite PATH         SQLite 源文件
```

脚本会执行：

- 检测系统和包管理器
- 可选切换国内软件源
- 安装 Python、Node.js 20、Nginx、编译工具和 3D 处理库
- 尝试安装 PrusaSlicer
- 同步代码到 `/opt/4d-print`
- 创建 `/var/lib/4d-print/uploads` 和备份目录
- 创建或补全 `backend/.env`
- 创建后端虚拟环境并安装依赖
- 可选执行 SQLite 到 MySQL 迁移
- 构建前端或复制已有 `frontend/dist`
- 写入 systemd 服务
- 写入 Nginx 配置
- 检查 `/health`

国内镜像默认开启：

- apt：清华源
- NodeSource：清华源
- pip：清华 PyPI 源
- npm：npmmirror

如果不想改服务器软件源：

```bash
sudo bash scripts/deploy-server.sh --mirror default --mysql-password 'your-password'
```

## 7. 验证访问

后端本机健康检查：

```bash
curl http://127.0.0.1:8000/health
```

Nginx 健康检查：

```bash
curl http://127.0.0.1/health
```

正常响应类似：

```json
{"status":"healthy","checks":{"api":"ok","database":"ok","uploads_writable":"ok"}}
```

浏览器访问：

```text
http://服务器IP
http://你的域名
```

## 8. 部署后配置

配置文件：

```text
/opt/4d-print/backend/.env
```

查看：

```bash
sudo nano /opt/4d-print/backend/.env
```

常用配置：

```env
DATABASE_URL=mysql+pymysql://makerworld:password@localhost:3306/makerworld
DATA_DIR=/var/lib/4d-print
UPLOAD_ROOT=/var/lib/4d-print/uploads
JWT_SECRET_KEY=部署脚本自动生成
CORS_ORIGINS=https://你的域名,http://你的域名
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
PRUSASLICER_PATH=/usr/bin/prusa-slicer
MOONRAKER_URL=http://localhost:7125
MODEL_VIEWER_HDR_PATH=resources/viewer-environments/default.hdr
MODEL_VIEWER_HDR_URL=
```

修改后重启后端：

```bash
sudo systemctl restart 4d-print-api
```

## 9. 常用运维命令

查看后端：

```bash
sudo systemctl status 4d-print-api
```

重启后端：

```bash
sudo systemctl restart 4d-print-api
```

查看日志：

```bash
sudo journalctl -u 4d-print-api -n 200
sudo journalctl -u 4d-print-api -f
```

检查 Nginx：

```bash
sudo nginx -t
sudo systemctl status nginx
```

重载 Nginx：

```bash
sudo systemctl reload nginx
```

Debian/Ubuntu 的 Nginx 配置：

```text
/etc/nginx/sites-available/4d-print
/etc/nginx/sites-enabled/4d-print
```

RHEL/CentOS/Alibaba Cloud Linux 的 Nginx 配置：

```text
/etc/nginx/conf.d/4d-print.conf
```

## 10. PrusaSlicer

切片功能依赖 PrusaSlicer。脚本会先检查：

```bash
prusa-slicer
prusa-slicer-console
prusaslicer
```

如果系统包管理器没有可用包，脚本会提示手动配置。检查：

```bash
which prusa-slicer
prusa-slicer --version
```

在 `.env` 中设置：

```env
PRUSASLICER_PATH=/usr/bin/prusa-slicer
```

修改后：

```bash
sudo systemctl restart 4d-print-api
```

如果暂时不需要切片：

```bash
sudo bash scripts/deploy-server.sh --skip-prusaslicer --mysql-password 'your-password'
```

## 11. 常见问题

### alinux 是否支持

支持。Alibaba Cloud Linux 会走 RHEL 分支，包管理器使用 `dnf` 或 `yum`，服务用户为 `nginx`。

### 网页打不开

检查 Nginx 和防火墙：

```bash
sudo nginx -t
sudo systemctl status nginx
curl http://127.0.0.1/health
```

云服务器安全组至少开放：

```text
80/tcp
```

如果配置 HTTPS，还需要开放：

```text
443/tcp
```

### 页面能打开但接口报错

检查后端：

```bash
sudo systemctl status 4d-print-api
sudo journalctl -u 4d-print-api -n 200
curl http://127.0.0.1:8000/health
```

如果 `database` 报错，优先检查 `DATABASE_URL`、MySQL 是否运行、账号是否有权限。

### 上传模型失败

检查数据目录权限。Debian/Ubuntu：

```bash
sudo chown -R www-data:www-data /var/lib/4d-print
sudo systemctl restart 4d-print-api
```

RHEL/CentOS/Alibaba Cloud Linux：

```bash
sudo chown -R nginx:nginx /var/lib/4d-print
sudo systemctl restart 4d-print-api
```

### AI 生成功能不可用

检查：

```env
TRIPO_API_KEY=
```

Tripo key 当前预期以 `tsk_` 开头。未配置时 AI 生成功能不可用，但其他模块仍可运行。

### 邮件验证码不可用

检查 SMTP：

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_USE_TLS=true
```

未配置 SMTP 时，开发模式会返回或记录验证码；生产环境应配置真实邮箱服务。

### 设备控制不可用

检查 Moonraker 地址：

```env
MOONRAKER_URL=http://打印机IP:7125
```

也可以在前端设备页面添加具体设备，后端会校验 Moonraker HTTP/WebSocket 能力。

## 12. 更新版本

重新打包并上传新版 zip，然后运行：

```bash
sudo bash scripts/deploy-server.sh --domain print.example.com --mysql-password 'your-password'
```

脚本会重新同步代码、安装依赖、构建前端并重启服务。运行数据位于 `/var/lib/4d-print`，不会跟代码目录混在一起。

如果已有 `.env`，脚本会保留现有值，只补缺失的关键行。

## 13. 备份

MySQL 请使用数据库自身备份工具，例如：

```bash
mysqldump -u makerworld -p makerworld > makerworld-$(date +%Y%m%d-%H%M%S).sql
```

SQLite 试运行环境：

```bash
sudo mkdir -p /var/lib/4d-print/backups
sudo cp /var/lib/4d-print/makerworld.db /var/lib/4d-print/backups/makerworld-$(date +%Y%m%d-%H%M%S).db
```

上传文件备份：

```bash
sudo tar -C /var/lib -czf 4d-print-uploads-$(date +%Y%m%d-%H%M%S).tar.gz 4d-print/uploads
```

## 14. 部署脚本文档验证

修改部署脚本后至少运行：

```bash
cd backend
python -m pytest -q tests/test_deploy_script.py
```

如果环境有 Bash：

```bash
bash -n scripts/deploy-server.sh
```

不能执行 Bash 语法检查时，不要声称已经完成该项验证，只说明已用文本测试覆盖部署契约。
