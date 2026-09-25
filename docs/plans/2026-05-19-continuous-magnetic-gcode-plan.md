# 连续模型磁场 G-code 生成改造计划

> 日期：2026-05-19  
> 状态：待实施  
> 目标范围：`backend/app/api/gcode.py`、G-code 后处理、前后端接口类型、流水线测试  
> 核心约束：最终交付必须是已经插入磁场控制指令的 `_mag.gcode` 文件；打印时不做坐标查询。

---

## 1. 当前结论

当前磁场流水线的问题不是 PrusaSlicer 参数问题，而是架构问题：系统为了表达磁区，把一个连续模型按磁场强度物理切成多个独立闭合实体，再交给 PrusaSlicer 作为多对象切片。这会让原本应连续打印的物体被切片器当成多个对象处理，导致边界不连续、对象标签不稳定、磁场注入依赖对象名等问题。

新的主流程应改为：保留模型为单连续实体切片，磁区只作为后端 metadata 存在；切片完成后，后端离线读取 G-code 路径，根据磁区 metadata 在正确 extrusion 段前后写入 `MAG_ON` / `MAG_OFF`，最终输出完整的 `_mag.gcode` 文件。

---

## 2. 必须满足的产品目标

1. 用户最终下载或发送到设备的文件必须是完整 G-code 文件。
2. 磁场强度指令必须在后端生成阶段预先写入 G-code。
3. 打印机打印时只执行 G-code，不查询模型坐标、不访问后端、不做运行时区域判断。
4. 单个模型的主体几何必须保持连续，不再因为磁区不同被物理拆成多个 print object。
5. 至少稳定支持现有强度语义：`strong`、`medium`、`weak`、`none`。

---

## 3. 非目标

1. 本阶段不实现磁场方向控制。
   - 原因：当前 G-code 指令只有 `MAG_ON S=...` 强度参数，没有统一方向协议。
   - 如果后续需要方向，应另行定义设备协议，例如 `MAG_ON S=100 DIR=X+` 或 `MAG_ON S=100 DX=1 DY=0 DZ=0`。
2. 本阶段不重建前端标注工具。
3. 本阶段不替换 PrusaSlicer，只改变切片前后的数据表达方式。
4. 本阶段不删除 legacy 多对象切分能力，只是不再让它作为 `process-4d` 默认主流程。

---

## 4. 新主流程

```text
前端标注数据
  ├─ regions
  ├─ paint_data
  ├─ volume_regions
  └─ surface_paint_grid
        ↓
后端构建 magnetic metadata
        ↓
原始模型导出为单对象 3MF
        ↓
PrusaSlicer 对单连续模型切片
        ↓
后端离线解析普通 G-code 的 X/Y/Z/E 路径
        ↓
根据路径位置匹配磁区强度
        ↓
插入 MAG_ON S=100/50/25 与 MAG_OFF
        ↓
输出最终 *_mag.gcode
```

---

## 5. 后端改造计划

### 5.1 新增单连续模型准备函数

建议新增：

```python
prepare_single_model_with_metadata(...)
```

职责：

- 加载模型；
- 保留 scene transform 后合并为连续 mesh；
- 导出单对象 3MF；
- 记录导出时的 scale、translation、Z offset、bed center；
- 构建供 G-code 后处理使用的 magnetic metadata。

验收标准：

- 输出 3MF 中只有一个 `<object>`；
- `<build>` 中只有一个 `<item>`；
- 不调用 `_split_mesh_by_voxel_strength()`；
- 保留导出坐标变换信息。

---

### 5.2 修复 scene transform 处理

当前 `_scene_to_geometry_map()` 对 `trimesh.Scene` 直接读取 `scene.geometry` 并 concatenate，可能丢失 scene graph 中的节点 transform。

需要改为：

- 使用 `scene.dump(concatenate=False)` 获取已应用 transform 的 mesh；或
- 遍历 scene graph，将每个 node transform bake 到 mesh 顶点。

验收标准：

- GLB/3MF 中带 transform 的多个子 mesh 导入后位置不丢失；
- 合并 mesh 与原始预览位置一致。

---

### 5.3 新增磁区 metadata 与 evaluator

建议统一为：

```python
MagneticMetadata
MagneticRegionEvaluator
```

最低要求：

- 支持 `volume_regions` 的 box/sphere/cylinder 空间判断；
- 支持 `surface_paint_grid` 的体素采样；
- 支持 `paint_data` 或旧 `regions` 的兼容路径；
- 对任意 G-code 坐标点返回 `strong` / `medium` / `weak` / `none`。

建议优先级：

```text
surface_paint_grid > volume_regions > paint_data/regions > none
```

如果要沿用旧逻辑，也可以保持：

```text
paint_data → volume_regions 覆盖 → surface_paint_grid 覆盖
```

但必须在代码和测试中固定下来，不能隐式分散在多个函数里。

---

### 5.4 新增离线 G-code 路径后处理函数

建议新增：

```python
process_gcode_magnetic_by_path(
    gcode_path: str,
    output_path: str,
    magnetic_metadata: MagneticMetadata,
    mag_start: str = "MAG_ON",
    mag_end: str = "MAG_OFF",
) -> dict
```

职责：

- 读取普通 G-code 文件；
- 解析 `G0` / `G1`；
- 维护当前 `X/Y/Z/E/F` 状态；
- 支持 `G90` / `G91`、`M82` / `M83`、`G92 E0`；
- 识别 extrusion move；
- 对 extrusion segment 的中点或采样点判断磁场强度；
- 强度变化时插入 `MAG_ON S=...` 或 `MAG_OFF`；
- 文件结束前保证磁场关闭。

强度映射：

```text
strong  -> MAG_ON S=100
medium  -> MAG_ON S=50
weak    -> MAG_ON S=25
none    -> MAG_OFF / 不开启
```

验收标准：

- 同一模型多强度区域能生成多个对应 `MAG_ON S=...`；
- 离开磁区时有 `MAG_OFF`；
- 没有磁区时不插入多余磁场指令；
- 不依赖 `; printing object ...` 注释；
- 输出仍是完整 G-code 文件。

---

### 5.5 修改 `process_4d_print()` 默认主流程

当前默认流程：

```text
split_model_by_regions()
  → 多对象 3MF
  → slice_with_prusaslicer()
  → process_gcode_magnetic_regions()
```

目标默认流程：

```text
prepare_single_model_with_metadata()
  → 单对象 3MF
  → slice_with_prusaslicer()
  → process_gcode_magnetic_by_path()
```

旧函数保留为 legacy：

```text
split_model_by_regions()
process_gcode_magnetic_regions()
```

但不再作为 `POST /api/gcode/process-4d` 的默认路径。

---

## 6. 接口与数据修复

### 6.1 修复 `/gcode/split-model` 漏传 `volume_regions`

当前 split endpoint 支持请求字段，但调用 `split_model_by_regions()` 时漏传 `volume_regions`。

需要补上：

```python
volume_regions=request.volume_regions
```

---

### 6.2 对齐 `process4D` 返回结构

当前后端返回：

```python
split_result: {
    "combined_3mf": ...,
    "object_count": ...,
}
```

而前端类型仍期望：

```ts
split_result?: {
  files: Record<string, { filename: string; download_url: string }>;
  split_count: number;
}
```

新流程建议改为：

```python
model_result: {
    "single_model_3mf": "...",
    "continuous_model": True,
    "magnetic_mode": "offline_gcode_path",
}
```

前端类型同步为：

```ts
model_result?: {
  single_model_3mf: string;
  continuous_model: boolean;
  magnetic_mode: 'offline_gcode_path' | 'legacy_object_label';
}
```

---

### 6.3 补齐 `splitModel()` 的 `surface_paint_grid` 类型

前端 `splitModel()` 请求类型当前缺少 `surface_paint_grid`，但后端 `SplitModelRequest` 支持。需要补齐类型，避免表面涂刷数据无法通过独立 split endpoint 发送。

---

## 7. 测试计划

### 7.1 单对象 3MF 导出测试

构造简单 mesh，调用新单对象导出路径，解压 3MF 并检查：

- `3D/3dmodel.model` 只有一个 `<object>`；
- `<build>` 只有一个 `<item>`；
- 对象名不再依赖 `magstrong` / `magweak`。

---

### 7.2 G-code 路径磁场注入测试

输入示例：

```gcode
G90
M82
G1 X0 Y0 Z0.2 E0.1
G1 X10 Y0 E0.2
G1 X20 Y0 E0.3
```

metadata：

```text
X 0-10: strong
X 10-20: none
```

期望：

```gcode
MAG_ON S=100
G1 X0 Y0 Z0.2 E0.1
G1 X10 Y0 E0.2
MAG_OFF
G1 X20 Y0 E0.3
```

---

### 7.3 多强度测试

同一模型设置三个区域：

```text
strong / medium / weak
```

验收：

- 最终 `_mag.gcode` 包含 `MAG_ON S=100`；
- 包含 `MAG_ON S=50`；
- 包含 `MAG_ON S=25`；
- 强度切换前正确关闭或切换磁场；
- 不依赖 object label。

---

### 7.4 坐标变换测试

必须验证：

```text
前端/模型坐标
  ↔ 导出 3MF 坐标
  ↔ PrusaSlicer bed 坐标
  ↔ G-code X/Y/Z
```

如果这一步失败，磁场指令虽然会插入，但会插错位置。

---

### 7.5 回归测试

保留旧测试：

- `_parse_object_strength()`；
- `_map_strength_to_value()`；
- `process_gcode_magnetic_regions()`。

目的：保证 legacy object-label 模式仍可作为兼容路径使用。

---

## 8. 风险与处理

| 风险 | 影响 | 处理 |
|---|---|---|
| 坐标映射错误 | 磁场插入位置错误 | 第一阶段就保存并测试 export transform |
| G-code extrusion 判断不完整 | 漏插或误插磁场 | 支持 absolute/relative extrusion、retract、G92 |
| 单条 extrusion 穿越多个磁区 | 边界精度不足 | 初版用中点判断；后续可采样或拆分 segment |
| Surface grid 与模型坐标不一致 | 表面磁区错位 | 使用同一 bbox/resolution 转换函数并测试 |
| 设备不识别强度参数 | 磁场无效 | 与固件确认 `MAG_ON S=100/50/25` 协议 |

---

## 9. 执行顺序

1. 修复 scene transform 与单对象导出，确保连续模型切片。
2. 建立 magnetic metadata 与坐标变换记录。
3. 实现 G-code parser 与 `process_gcode_magnetic_by_path()`。
4. 修改 `process_4d_print()` 默认走连续模型离线注入流程。
5. 修复接口类型和 split endpoint 漏传字段。
6. 补齐单元测试和最小端到端 fixture。
7. 验证真实模型生成的 `_mag.gcode` 中强度指令位置正确。

---

## 10. 旧计划书清理判断

本次清理后，项目只保留仍可作为当前参考的文档，删除已完成、重复、过期或与当前架构冲突的计划书。

### 已删除

| 文件 | 判断 | 原因 |
|---|---|---|
| `goal.md` | 废弃 | 内容混合产品说明、旧 G-code 页面计划、旧编辑器计划；含临时生成痕迹，与当前 `PIPELINE.md` 和本计划重复。 |
| `volume.md` | 已完成/被合并 | Volume 模式已在当前代码和 `PIPELINE.md` 中收敛为空间定义 + Shader/后端求值，该单独计划不再需要。 |
| `pencilpainter.md` | 废弃 | 文档计划 Surface 走空间区域集合，但当前实现已转为 `surface_paint_grid` / VoxelGrid 路线，继续保留会误导。 |
| `docs/plans/2026-03-12-gcode-editor-refactoring.md` | 过期 | 计划中的 store 字段、source tracking、保存逻辑等已部分落地，剩余内容与当前磁场主问题无关，且状态仍写“待实施”。 |
| `frontend/docs/gcode-preview-prototype-summary.md` | 已完成 | 只是 prototype 完成总结；实际组件和 integration guide 已存在，不再作为计划书保留。 |

### 保留

| 文件 | 判断 | 原因 |
|---|---|---|
| `PIPELINE.md` | 保留，后续需更新 | 仍是全链路架构说明；但 Stage C 仍描述旧 split → slice → object-label 注入，完成本计划后需要更新。 |
| `问题.md` | 保留 | 仍是产品/技术问题清单，包含文件名依赖、流程混乱等未完全关闭的问题。 |
| `frontend/docs/gcode-preview-integration.md` | 保留 | 是库集成参考文档，不是一次性计划书。 |
| `SETUP.md` / `迁移指南.md` | 保留 | 属于安装/迁移说明，不是本次计划清理对象。 |

---

## 11. 完成标准

本计划完成后，应满足：

- `process-4d` 默认不再物理切分磁区；
- PrusaSlicer 输入是单连续模型；
- 最终输出 `_mag.gcode`；
- 强度区域能稳定插入 `MAG_ON S=100/50/25`；
- 离开磁区能插入 `MAG_OFF`；
- 打印时不需要任何坐标查询；
- 旧 object-label 方案只作为 legacy 兼容路径存在；
- 测试覆盖单对象导出、路径注入、多强度、坐标变换和 legacy 回归。
