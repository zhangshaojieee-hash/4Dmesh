/**
 * editor-types.ts — 编辑器系统类型定义
 */

/* ═══ 枚举/联合类型 ═══ */

export type EditorMode = 'preview' | 'edit';
export type EditSubMode = 'module' | 'volume' | 'surface';
export type ViewMode = 'solid' | 'wireframe' | 'transparent';
export type SurfaceTool = 'hand' | 'brush' | 'eraser' | 'fill' | 'boxSelect' | 'lassoSelect' | 'slabSelect';
export type VolumeMethod = 'box' | 'cylinder' | 'sphere';
/** @deprecated — 保留向后兼容，新代码不再使用 */
export type BooleanMode = 'intersect' | 'union' | 'subtract';
export type TagType = 'magnetic' | 'normal' | 'module';
export type SurfaceTag = 'helper_region' | 'magnetic_hint';
export type MaterialMode = 'magnetic' | 'normal' | 'custom';

/* ═══ 核心数据结构 ═══ */

export interface Module {
  module_id: string;
  name: string;
  source_segments: string[];
  visible: boolean;
  locked: boolean;
  export_enabled: boolean;
  tag: TagType;
  color: string;
}

export interface VolumeTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface VolumeRegion {
  region_id: string;
  name: string;
  type: 'magnetic_volume';
  method: VolumeMethod;
  transform: VolumeTransform;
  tag: 'magnetic' | 'normal';
  strengthId?: string;
  /** 磁场方向向量 [x, y, z]，默认 [0, 0, 1] */
  direction?: [number, number, number];
  linked_module_id?: string;
  z_range: { z_min: number; z_max: number };
}

export interface SurfaceRegion {
  region_id: string;
  name: string;
  type: 'surface_selection';
  method: string;
  tag: SurfaceTag;
  linked_module_id?: string;
  face_data: import('../../types').FacePaintData;
}

export interface ProcessRule {
  rule_id: string;
  target_id: string;
  rule_type: 'magnetic_field' | 'material_switch' | 'export_module';
  export_as_module: boolean;
  material_mode: MaterialMode;
  params: Record<string, unknown>;
}

export interface AnnotationData {
  project_id: string;
  model_id: string;
  model_url: string;
  modules: Module[];
  volume_regions: VolumeRegion[];
  surface_regions: SurfaceRegion[];
  process_rules: ProcessRule[];
  created_at: string;
  updated_at: string;
}

/* ═══ 模块检测 ═══ */

export interface ModuleCandidate {
  id: string;
  name: string;
  meshNames: string[];
  /** Face indices belonging to this module (set when detected via connected component analysis) */
  faceIndices?: number[];
}

/* ═══ 显示颜色常量 ═══ */

export const EDITOR_COLORS = {
  moduleSelected: '#3B82F6',
  moduleHover: '#FBBF24',
  moduleSaved: '#60A5FA',
  volumeActive: 'rgba(239, 68, 68, 0.35)',
  volumeSaved: 'rgba(239, 68, 68, 0.15)',
  volumeHover: 'rgba(239, 68, 68, 0.5)',
  autoCandidate: '#A78BFA',
  defaultGray: '#D1D5DB',
} as const;

/* ═══ ID 生成 ═══ */

let _counter = 0;
export function generateId(prefix: string): string {
  _counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${_counter.toString(36)}`;
}

/* ═══ 默认 VolumeTransform ═══ */

export function defaultVolumeTransform(): VolumeTransform {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}
