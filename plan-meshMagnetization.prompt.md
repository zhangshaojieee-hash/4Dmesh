## 方案：规则网格磁化原型

建议先搭建“规则立方体网格交互原型”，验证模型网格化、单元选择、磁场参数编辑和项目保存恢复；暂不直接接入 HyperMesh/ANSYS，也暂不生成四面体有限元网格。后续再增加四面体网格导入适配器。

### 实施步骤

#### 阶段一：确定网格数据结构

1. 新增版本化的规则网格数据结构，记录：
   - 模型包围盒；
   - 网格尺寸，单位为 mm；
   - X/Y/Z 方向单元数量；
   - 有效单元 ID；
   - 每个单元的磁场强度；
   - 每个单元的磁场方向；
   - 模型坐标系和模型指纹。
2. 强度采用连续值 `0–100`。
3. 方向首期限定为 X+/X-/Y+/Y-/Z+/Z- 六个轴向。
4. 使用紧凑数组或稀疏结构保存网格，避免每个网格创建一个独立 Three.js 对象。
5. 设置最大网格数量限制，防止大模型导致浏览器卡顿或内存溢出。

#### 阶段二：三维网格显示

在现有模型预览区域增加网格覆盖层：

- 用户输入网格尺寸，例如 `2 mm`、`5 mm`、`10 mm`；
- 根据模型包围盒生成规则立方体网格；
- 根据模型几何判断哪些单元有效；
- 使用 Instanced Mesh 或批量线框渲染；
- 支持网格显示/隐藏；
- 支持透明度调节；
- 根据磁场强度显示不同颜色；
- 显示网格总数量、有效数量和当前选中数量。

主要复用 `ModelCanvas`、`PreviewWorkspace`、当前模型包围盒计算逻辑以及 Three.js 场景和变换逻辑。

#### 阶段三：网格选择和磁场编辑

增加网格选择工具：

- 单击选择；
- 框选；
- 套索选择；
- 刷选；
- 反选；
- 全选；
- 清空选择；
- 按 Z 层选择；
- 批量设置属性。

选择结果必须基于网格单元 ID，不能和现有三角面索引混用。

增加磁场参数面板：

- 磁场强度输入：`0–100`；
- 方向选择：六个轴向；
- 批量应用；
- 取消磁化；
- 显示当前选中网格的统计信息；
- 对不同网格设置不同强度和方向。

主要复用 `SurfaceSelectionLayer`、`VolumeEditLayer`、`FloatingInspector`、`SelectableModelViewer` 以及当前 Three.js Raycast/BVH 选择机制。

#### 阶段四：编辑器状态和项目保存

扩展 `editor.tsx`、`project.tsx`、`editor-types.ts` 和 `GcodeEditor.tsx`，支持：

- 生成网格；
- 修改网格尺寸；
- 选择网格；
- 设置磁场参数；
- 清空网格标注；
- 项目保存；
- 项目恢复；
- 模型更换后检测旧网格是否仍然有效。

项目中应保存网格尺寸、网格范围、单元数量、有效单元、磁场属性、模型指纹和网格数据版本。

如果模型文件发生变化，旧网格标注应拒绝直接复用，并提示重新生成。

#### 阶段五：后端数据校验和预留

在后端增加网格数据的可选请求字段和校验：

- 网格尺寸必须大于零；
- 网格单元数量不能超过上限；
- 单元 ID 必须在合法范围内；
- 强度必须在 `0–100`；
- 方向必须是六轴方向；
- 模型指纹必须匹配；
- 拒绝异常大的请求体。

同时增加独立的网格坐标映射模块，为后续将 G-code 路径点映射到网格单元做准备。

本阶段默认不改变最终 G-code 注入逻辑，避免在坐标系未验证前生成错误磁化结果。

#### 阶段六：后续四面体网格支持

四面体网格不建议第一阶段直接自动生成，因为当前项目没有 HyperMesh SDK、ANSYS 自动化接口、四面体网格生成库或 `.msh`、`.inp`、`.cdb` 等有限元网格解析统一层。

建议后续路线：

1. 先支持外部软件导出的网格文件导入；
2. 统一转换为内部节点、单元、邻接关系格式；
3. 再增加 HyperMesh/ANSYS 命令行批处理；
4. 最后考虑自动调用商业软件生成网格。

正式接入前，需要确定 HyperMesh 或 ANSYS 的具体版本、安装路径、无界面批处理能力、许可证限制、导出格式以及节点和单元编号规则。

### 关键文件

- `frontend/src/pages/GcodeEditor.tsx`：工作台入口、模型上传、项目保存和 4D 处理入口。
- `frontend/src/components/preview-workspace/ModelCanvas.tsx`：模型场景、变换和包围盒复用。
- `frontend/src/components/preview-workspace/PreviewWorkspace.tsx`：新增网格覆盖层和交互层的主要组合位置。
- `frontend/src/components/preview-workspace/SurfaceSelectionLayer.tsx`：参考现有表面选择逻辑。
- `frontend/src/components/preview-workspace/VolumeEditLayer.tsx`：参考三维区域选择和编辑逻辑。
- `frontend/src/components/preview-workspace/FloatingInspector.tsx`：接入强度和方向编辑面板。
- `frontend/src/components/lib/editor-types.ts`：新增网格和网格磁场数据类型。
- `frontend/src/stores/editor.tsx`：管理网格生成、选中单元和磁场编辑状态。
- `frontend/src/stores/project.tsx`：管理网格数据的项目级持久化。
- `backend/app/api/gcode.py`：增加网格请求校验和后续 G-code 路径映射入口。
- `backend/app/api/projects.py`：保存和恢复网格数据。
- `backend/app/models/__init__.py`：增加项目网格 JSON 字段。
- `backend/tests/test_pipeline.py`：增加网格坐标映射和磁化处理测试。
- `frontend/tests/gcode-editor-adaptation.test.mjs`：增加网格编辑器结构和交互契约测试。

### 验证方式

1. 输入不同网格尺寸，网格数量计算正确。
2. 对非正数、过小尺寸和超大网格数量给出明确错误。
3. 网格覆盖层与模型缩放、旋转、位置保持一致。
4. 点选、框选、套索、刷选只修改有效网格单元。
5. 强度始终限制在 `0–100`。
6. 方向只允许六个轴向。
7. 保存后刷新页面，网格和磁场属性能够恢复。
8. 模型更换后，旧网格标注不会错误套用到新模型。
9. 旧项目没有网格字段时仍能正常打开。
10. 运行后端测试：

```text
cd backend
python -m pytest -q
```

11. 运行前端构建：

```text
cd frontend
npm run build
```

### 已确定的范围

- 首期：规则立方体网格。
- 后续：四面体网格。
- 首期：交互原型。
- 磁场强度：连续 `0–100`。
- 磁场方向：六个轴向。
- 选择工具：点选、框选、套索、刷选、按层、批量、反选和清空。
- 首期不自动调用 HyperMesh/ANSYS。
- 首期不直接修改最终 G-code 注入逻辑。
- 不新建独立的 G-code 处理链路，继续复用现有 `process_gcode_magnetic_by_path`。

这个方案可以先验证最关键的用户体验和数据结构，再接入四面体有限元网格，避免一开始就被商业软件接口、许可证和网格格式拖慢。
