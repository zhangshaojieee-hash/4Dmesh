# 4D-Print Frontend

这是 4D-Print 的 React/Vite 前端。页面覆盖模型市场、AI 生成、4D/G-code 编辑、设备控制、项目管理、个人资料、后台管理和法律文档。

## 技术栈

- React 19
- TypeScript
- Vite
- React Router
- Axios
- Three.js / React Three Fiber
- three-mesh-bvh

## 目录

```text
src/pages/                 路由页面
src/components/            通用组件和工作台组件
src/components/lib/        3D 编辑、涂色、体积选择等领域逻辑
src/services/              API、设备和发现服务
src/stores/                Auth、Toast、Project、Editor 状态
src/utils/                 路径、格式化、G-code 工具
tests/                     Node 测试
public/assets/             静态视觉资源
```

## 本地运行

仓库根目录推荐直接运行：

```powershell
python run.py
```

只启动前端：

```powershell
cd frontend
npm ci
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

构建：

```powershell
cd frontend
npm run build
```

预览构建产物：

```powershell
cd frontend
npm run preview
```

## 环境变量

复制模板：

```powershell
copy .env.example .env
```

常用变量：

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/api/voice/ws
VITE_FLUIDD_URL=http://localhost
VITE_USE_KLIPPER=true
VITE_DEVICE_SERVICE_MODE=
VITE_MODEL_VIEWER_HDR_URL=
```

说明：

- `VITE_API_BASE_URL`：Axios API 基地址。本地可指向 `http://localhost:8000`；同域部署使用 `/api`。
- `VITE_WS_URL`：语音助手 WebSocket 地址。
- `VITE_FLUIDD_URL`：Fluidd 嵌入入口。
- `VITE_USE_KLIPPER=false` 或 `VITE_DEVICE_SERVICE_MODE=mock`：启用前端设备演示模式。
- `VITE_MODEL_VIEWER_HDR_URL`：覆盖默认 `/api/models/viewer-environment`。

## 路由

```text
/                 首页
/models           模型市场
/models/:id       模型详情
/ai               AI 生成
/editor           4D/G-code 编辑器
/projects         项目列表
/device           设备控制
/profile          个人资料
/admin            后台管理
/login            登录/注册
/terms            服务条款
/privacy          隐私政策
```

`/device`、`/ai`、`/editor`、`/projects`、`/profile`、`/admin` 需要登录。

## API 封装

主要封装在 `src/services/api.ts`：

- 模型：列表、上传、详情、版本、下载、缩略图、点赞、收藏。
- G-code：上传、读取、保存、切片、4D 处理任务、下载。
- AI：图生 3D、文生 3D、任务状态、余额、临时模型上传。
- 社区：评论、关注、通知、反馈、举报。
- 项目：创建、列表、读取、更新、删除。
- 后台：统计、用户、模型、项目、举报。

设备控制在 `src/services/device.ts`。默认使用 Klipper/Moonraker 后端接口；设置 `VITE_USE_KLIPPER=false` 或 `VITE_DEVICE_SERVICE_MODE=mock` 后使用 mock 数据。

## 路径规则

文件名和上传相对路径必须使用 `src/utils/path.ts` 与 `src/services/api.ts` 的封装处理。不要在页面组件里手写 `split('/')`，也不要直接拼接可能包含 Windows 反斜杠的 URL。

相关测试：

```powershell
cd frontend
node --test tests/path-utils.test.mjs
```

## 验证

前端改动至少运行：

```powershell
cd frontend
npm run build
```

路径逻辑改动同时运行：

```powershell
node --test tests/path-utils.test.mjs
```

视觉或工作台交互改动应在 360px、390px、430px 和桌面宽度检查无横向溢出、文字不竖排、按钮不被语音助手或底部命令栏遮挡。
