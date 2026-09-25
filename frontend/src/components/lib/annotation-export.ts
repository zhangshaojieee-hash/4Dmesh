/**
 * annotation-export.ts — 标注数据导出与持久化
 */
import type { EditorState } from '../../stores/editor';
import type { AnnotationData } from './editor-types';
import { generateId } from './editor-types';
import { MAGNET_PRESETS } from '../../types';
import type { RegionData, FacePaintData } from '../../types';

const STORAGE_PREFIX = '4dp_annotations_';

/* ═══ 新格式导出 ═══ */

export function exportAnnotations(
  state: EditorState,
  modelUrl: string,
  projectId?: string,
): AnnotationData {
  const now = new Date().toISOString();
  return {
    project_id: projectId || generateId('proj'),
    model_id: generateId('model'),
    model_url: modelUrl,
    modules: state.modules,
    volume_regions: state.volumeRegions,
    surface_regions: state.surfaceRegions,
    process_rules: state.processRules,
    created_at: now,
    updated_at: now,
  };
}

/* ═══ 旧格式兼容导出 ═══ */

export function exportLegacyRegions(paintData: FacePaintData): RegionData[] {
  const regions: RegionData[] = [];
  for (const [meshName, groups] of Object.entries(paintData)) {
    for (const [strengthId, faces] of Object.entries(groups)) {
      if (faces.length === 0) continue;
      const preset = MAGNET_PRESETS.find(p => p.id === strengthId);
      if (preset) {
        regions.push({
          id: `${meshName}_${strengthId}`,
          name: preset.label,
          meshName,
          color: preset.color,
          strength: preset.strength,
          faceIndices: faces,
        });
      }
    }
  }
  return regions;
}

/* ═══ localStorage 持久化 ═══ */

export function saveAnnotationsToLocal(modelUrl: string, data: AnnotationData): void {
  try {
    const key = STORAGE_PREFIX + btoa(modelUrl).slice(0, 40);
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage 满或不可用，静默失败
  }
}

export function loadAnnotationsFromLocal(modelUrl: string): AnnotationData | null {
  try {
    const key = STORAGE_PREFIX + btoa(modelUrl).slice(0, 40);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as AnnotationData;
  } catch {
    return null;
  }
}
