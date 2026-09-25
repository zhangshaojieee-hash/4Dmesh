# 阶段 0：可追踪基线

- 日期：2026-09-25
- 项目：4D-print
- 分支：`feature/mesh-magnetization-printing`
- 基线目的：为网格划分、充磁写入、G-code 编辑和上机打印后续开发提供可重复对照点。

## 1. Git 基线

本项目目录原先没有 `.git`，父目录也不是 Git 工作副本。本阶段已在项目目录初始化 Git，并创建功能分支：

```text
feature/mesh-magnetization-printing
```

阶段 0 已创建初始基线提交：

```text
f2fa4f4 chore: establish stage 0 project baseline
```

提交前已将临时讲义图片、简历审阅图片和根目录临时图片加入 `.gitignore`，运行数据、数据库、上传目录和构建产物也没有进入提交。

## 2. 当前代码基线

已确认的核心实现位置：

- 网格和连续磁化 G-code：`backend/app/api/gcode.py`
- G-code 统计：`backend/app/utils/gcode_parser.py`
- G-code 工作台和网格编辑：`frontend/src/pages/GcodeEditor.tsx`
- 网格三维覆盖层：`frontend/src/components/gcode-preview/GridMagnetizationOverlay.tsx`
- 项目保存和恢复：`backend/app/api/projects.py`、`backend/app/models/__init__.py`、`frontend/src/stores/project.tsx`
- 打印机设备控制：`backend/app/api/device.py`、`frontend/src/pages/DeviceControl.tsx`

当前默认磁场指令样例：

```text
MAG_ON S=100 DIR=Z+
MAG_OFF
```

该格式目前代表软件侧控制协议原型，不代表已经完成固件和磁场执行机构验证。

## 3. 自动化验证基线

### 前端构建

执行：

```powershell
cd frontend
npm.cmd run build
```

结果：**通过**。

构建输出包含 `dist/`，该目录由 `.gitignore` 排除。构建过程中存在以下非阻断警告：

- `react-router` 包中的 `use client` module directive 被 Vite 忽略；
- 部分构建 chunk 超过 500 kB，属于后续性能优化项。

### 后端测试

计划执行：

```powershell
cd backend
python -m pytest -q
```

结果：**未能执行，不能标记为通过或失败**。

原因：当前可见的项目虚拟环境 `backend/.venv` 和 `4D-print-master/.venv` 的 `pyvenv.cfg` 都引用了已不存在的 Python 安装路径，运行环境返回 `No Python`。系统 Python Launcher 也指向同一条失效路径。

后续处理要求：

1. 安装或恢复可用的 Python 3.10+。
2. 在 `backend/.venv` 中重新创建环境，或明确配置新的后端解释器。
3. 安装 `backend/requirements.txt`。
4. 重新运行完整测试并把结果追加到本文档。

本次没有删除或覆盖现有虚拟环境，以保留现场信息。

## 4. 示例输入输出指纹

当前仓库中找到的示例磁化 G-code：

```text
backend/uploads/slices/continuous_392a8cc2_mag.gcode
```

SHA-256：

```text
0919E62B40220D4CDB9798A2E799282F910AAC8676F5641FE7636AB14EA7886C
```

注意：`backend/uploads/` 已被 `.gitignore` 排除，因此该文件只作为当前工作区的本地样例。要让团队成员复现基线，应在后续增加不含敏感信息、体积可控的固定测试 fixture，并在测试中生成相同结果。

## 5. 阶段 0 结论

已完成：

- 项目 Git 仓库初始化；
- 功能分支创建；
- 前端生产构建基线记录；
- 后端测试环境阻塞原因记录；
- 示例 G-code SHA-256 指纹记录；
- 核心代码入口和当前协议记录。

未完成：

- 后端完整测试尚未成功运行；
- 初始 Git 提交尚未创建；
- 设备固件版本、控制器、线圈/磁铁和目标打印机尚未登记；
- 可公开提交的固定模型和 G-code fixture 尚未建立。

阶段 0 的代码追踪基础已经建立。后端测试环境仍需恢复，因此阶段 0 的软件测试部分保持“待补验证”状态；版本管理和基线记录部分已完成。

## 6. 下一步

1. 修复后端 Python 环境并运行 `pytest -q`，将结果追加到本文档。
2. 进入阶段 1：网格数据、模型指纹和坐标映射可信化。
