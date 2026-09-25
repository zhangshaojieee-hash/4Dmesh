/** 磁场强度等级 */
export interface MagnetStrength {
  id: string;
  label: string;
  color: string;
  /** 磁场强度 0-1 */
  strength: number;
}

/** 磁场强度预设 */
export const MAGNET_PRESETS: MagnetStrength[] = [
  { id: 'strong', label: '强磁', color: '#EF4444', strength: 1.0 },
  { id: 'medium', label: '中磁', color: '#F59E0B', strength: 0.6 },
  { id: 'weak',   label: '弱磁', color: '#3B82F6', strength: 0.3 },
];

/** 磁场方向向量 [x, y, z] */
export type MagnetDirection = [number, number, number];

/** 磁场方向预设 */
export interface DirectionPreset {
  id: string;
  label: string;
  direction: MagnetDirection;
}

export const DIRECTION_PRESETS: DirectionPreset[] = [
  { id: '+x', label: '+X', direction: [1, 0, 0] },
  { id: '-x', label: '−X', direction: [-1, 0, 0] },
  { id: '+y', label: '+Y', direction: [0, 1, 0] },
  { id: '-y', label: '−Y', direction: [0, -1, 0] },
  { id: '+z', label: '+Z', direction: [0, 0, 1] },
  { id: '-z', label: '−Z', direction: [0, 0, -1] },
];

export const DEFAULT_DIRECTION: MagnetDirection = [0, 0, 1];

/**
 * 面级选区数据 - 按磁场强度分组的三角面索引
 * key = meshName, value = { strengthId -> Set<faceIndex> }
 */
export interface FacePaintData {
  [meshName: string]: {
    [strengthId: string]: number[];
  };
}

/** 旧版 RegionData - 保留兼容 AICreate 的 4D 流程 */
export interface RegionData {
  id: string;
  name: string;
  meshName: string;
  color: string;
  strength: number;
  direction?: string;
  /** 该区域包含的三角面索引 */
  faceIndices?: number[];
  createdAt?: Date;
}

/** AI task polling status */
export interface TaskStatus {
  status: string;
  progress?: number;
  running_left_time?: number;
  queuing_num?: number;
  error_code?: number;
  error_msg?: string;
  model_url?: string;
  preview_url?: string;
  output?: {
    pbr_model?: string;
    model?: string;
    base_model?: string;
    rendered_image?: string;
  };
}
