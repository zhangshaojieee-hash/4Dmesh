# 4D-Print 开发与发布计划

## 目标

本阶段围绕两个目标推进：

1. 保持规则网格磁化、路径切分和 G-code 磁化命令链路可验证。
2. 保留正式登录/注册，同时为本地开发和团队联调增加不依赖 SMTP 的开发者模式入口。

开发者模式只用于本地开发或受控联调环境，正式部署必须关闭。
当前阶段按需求暂不检测运行环境，开发者模式按钮直接可用。公开部署前必须重新增加鉴权或关闭该入口。

## 当前基线

- 前端：React 19、TypeScript、Vite、Three.js、React Three Fiber。
- 后端：FastAPI、SQLAlchemy、Pydantic。
- 切片：PrusaSlicer CLI。
- 设备：Klipper/Moonraker。
- 代码分支：`feature/mesh-magnetization-printing`。
- 远程仓库：`https://github.com/zhangshaojieee-hash/4Dmesh.git`。
- 本地后端：`http://localhost:8000`。
- 本地前端：`http://localhost:5173`。

## 网格磁化现状

网格数据记录以下信息：

- `cellSize`
- `bboxMin`、`bboxMax`
- `dimensions`
- `activeCells`
- 模型指纹
- 坐标系版本
- 导出变换版本

活动单元使用 `x:y:z` 作为键，每个单元保存磁场强度和六轴方向。后端负责校验网格范围、模型指纹和方向值。

G-code 处理需要考虑：

- `G90/G91` 绝对/相对坐标；
- `M82/M83` 绝对/相对挤出；
- 退料和回抽；
- 一条 `G1` 跨越磁化边界时按交点拆分；
- `MAG_ON` 必须位于进入磁化区间之后；
- `MAG_OFF` 必须位于离开磁化区间之前；
- 网格坐标和 PrusaSlicer 打印床坐标必须使用同一床中心变换。

不能只根据 PrusaSlicer 的路径颜色判断磁化状态。验收应查看生成文件中的 `MAG_ON/MAG_OFF` 以及拆分后的 G-code 端点。

## 开发者模式设计

### 用户体验

登录页保留：

- 密码登录；
- 邮箱验证码登录；
- 注册；
- 微信登录（已配置时）。

在登录区域旁增加“开发者模式”按钮。按钮只在 Vite 开发构建显示，队友启动本地项目后无需手工修改环境变量或配置 SMTP 即可进入工作台。
在登录区域旁增加“开发者模式”按钮。按钮始终显示，队友启动项目后无需手工修改环境变量或配置 SMTP 即可进入工作台。
- 当前不检测运行环境，接口可直接调用；
- 公开部署前需要重新增加生产环境保护；
公开发布前重新增加开发者模式保护，并配置真实 SMTP、随机 JWT 密钥、数据库和 CORS。

### 后端约束

开发者登录必须由后端发放 JWT，不能只在前端写入伪造 Token。开发接口应满足：

- 仅在非生产环境开启；
- 每个本地开发实例使用独立标识；
- 不创建管理员权限；
- 复用现有 `Token`/`UserResponse` 响应；
- 生产环境直接拒绝请求；
- 不影响正式注册接口；
- 不绕过项目和设备资源的用户隔离。

推荐配置：

```env
APP_ENV=development
DEVELOPER_MODE_ENABLED=true
```

正式部署应设置：

```env
APP_ENV=production
DEVELOPER_MODE_ENABLED=false
```

### SMTP 与本地注册

正式注册仍依赖邮箱验证码。未配置 SMTP 的本地开发环境可以使用开发者模式；开发验证码只能在非生产环境返回，不能作为生产认证方案。

## 发布前检查

### 后端

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

### 前端

PowerShell 如果禁止执行 `npm.ps1`，使用：

```powershell
cd frontend
npm.cmd run lint
npm.cmd run build
```

### 安全文件检查

不要提交：

- `backend/.env`
- `frontend/.env`
- 数据库文件
- `backend/uploads/`
- `backend/.venv/`
- `node_modules/`
- `frontend/dist/`

### Git 发布

```powershell
git status --short --branch
git diff --check
git add <相关源码和测试>
git commit -m "feat: add local developer login mode"
git push origin feature/mesh-magnetization-printing
```

推送后核对远程分支和提交 SHA。

## 后续路线

1. 完成开发者模式和认证测试。
2. 完成当前网格坐标、路径切分的真实 G-code 回归样例。
3. 增加任务状态和 G-code 预览摘要接口。
4. 评估使用小程序原生页面或 `web-view` 承载 3D 网格编辑器。
5. 正式发布前关闭开发者模式并配置真实 SMTP、随机 JWT 密钥、数据库和 CORS。
