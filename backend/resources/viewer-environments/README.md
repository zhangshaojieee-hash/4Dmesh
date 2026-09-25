# 模型查看器 HDR 资源目录

这个目录用于统一管理 3D 模型查看器使用的 HDR 环境贴图资源。

## 默认文件

- `default.hdr`：项目默认使用的环境贴图

## 后端读取顺序

后端接口 `/api/models/viewer-environment` 按以下顺序选择资源：

1. `MODEL_VIEWER_HDR_PATH`
2. 本目录中的 `default.hdr`
3. `MODEL_VIEWER_HDR_URL`

## 维护约定

- 优先替换本目录下的 `default.hdr`，不要把查看器 HDR 放到 `backend/uploads/`
- 如果需要保留多个候选 HDR 文件，也统一放在本目录下
- 修改 HDR 资源后，重启后端即可生效
