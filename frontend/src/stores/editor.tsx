/**
 * editor.tsx — 编辑器全局状态 (Context + useReducer)
 */
import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import type {
  EditorMode, EditSubMode, ViewMode, SurfaceTool, VolumeMethod,
  Module, VolumeRegion, SurfaceRegion, ProcessRule, VolumeTransform,
} from '../components/lib/editor-types';
import { generateId } from '../components/lib/editor-types';
import { DEFAULT_DIRECTION } from '../types';
import type { MagnetDirection } from '../types';

/* ═══ State ═══ */

export interface EditorState {
  mode: EditorMode;
  subMode: EditSubMode;
  viewMode: ViewMode;

  // Surface
  surfaceTool: SurfaceTool;
  /** Normalized brush size 0–1 (actual world radius = brushNorm * modelExtent * BRUSH_SCALE) */
  brushNorm: number;
  activeStrengthIdx: number;
  activeDirection: MagnetDirection;
  xray: boolean;
  /** Backface culling for brush — when true, only front-facing triangles are painted */
  brushBackfaceCull: boolean;
  /** Max faces per single brush dab — 0 = unlimited */
  brushMaxFaces: number;
  /** Show wireframe overlay in surface mode */
  surfaceWireframe: boolean;
  /** Show debug overlay with brush stats */
  debugOverlay: boolean;
  /** Paint thickness 0.1–1.0 (scales brush sphere radius for surface painting) */
  paintThickness: number;

  // Model metrics
  modelExtent: number;

  // Section
  sectionEnabled: boolean;
  sectionHeight: number;
  modelBounds: { min: number; max: number };

  // Module
  modules: Module[];
  selectedModuleId: string | null;
  hoveredModuleId: string | null;

  // Volume
  volumeRegions: VolumeRegion[];
  selectedVolumeId: string | null;
  pendingVolume: { method: VolumeMethod; transform: VolumeTransform } | null;
  activeVolumeMethod: VolumeMethod;
  volumeGizmoMode: 'translate' | 'rotate' | 'scale';
  /** Normalized volume size 0.05–0.8 (actual scale = volumeSizeNorm * modelExtent) */
  volumeSizeNorm: number;
  volumeHandMode: boolean;

  // Surface regions
  surfaceRegions: SurfaceRegion[];

  // Process rules
  processRules: ProcessRule[];

  // Painted face stats
  paintedFaceCount: number;

  // Slab (surface sub-tool)
  slabMin: number;
  slabMax: number;
}

const initialState: EditorState = {
  mode: 'edit',
  subMode: 'surface',
  viewMode: 'solid',
  surfaceTool: 'hand',
  brushNorm: 0.15,
  activeStrengthIdx: 0,
  activeDirection: DEFAULT_DIRECTION,
  xray: false,
  brushBackfaceCull: false,
  brushMaxFaces: 2000,
  surfaceWireframe: false,
  debugOverlay: false,
  paintThickness: 0.5,
  modelExtent: 1,
  sectionEnabled: false,
  sectionHeight: 0,
  modelBounds: { min: -2, max: 2 },
  modules: [],
  selectedModuleId: null,
  hoveredModuleId: null,
  volumeRegions: [],
  selectedVolumeId: null,
  pendingVolume: null,
  activeVolumeMethod: 'box',
  volumeGizmoMode: 'translate',
  volumeSizeNorm: 0.25,
  volumeHandMode: true,
  surfaceRegions: [],
  processRules: [],
  paintedFaceCount: 0,
  slabMin: 0,
  slabMax: 0,
};

/* ═══ Actions ═══ */

export type EditorAction =
  | { type: 'SET_MODE'; mode: EditorMode }
  | { type: 'SET_SUB_MODE'; subMode: EditSubMode }
  | { type: 'SET_VIEW_MODE'; viewMode: ViewMode }
  | { type: 'SET_SURFACE_TOOL'; tool: SurfaceTool }
  | { type: 'SET_BRUSH_NORM'; norm: number }
  | { type: 'SET_STRENGTH_IDX'; idx: number }
  | { type: 'SET_DIRECTION'; direction: MagnetDirection }
  | { type: 'TOGGLE_XRAY' }
  | { type: 'TOGGLE_BRUSH_BACKFACE_CULL' }
  | { type: 'SET_BRUSH_BACKFACE_CULL'; enabled: boolean }
  | { type: 'SET_BRUSH_MAX_FACES'; max: number }
  | { type: 'SET_PAINT_THICKNESS'; thickness: number }
  | { type: 'TOGGLE_SURFACE_WIREFRAME' }
  | { type: 'SET_SURFACE_WIREFRAME'; enabled: boolean }
  | { type: 'TOGGLE_DEBUG_OVERLAY' }
  | { type: 'SET_DEBUG_OVERLAY'; enabled: boolean }
  | { type: 'SET_SECTION'; enabled: boolean; height?: number }
  | { type: 'SET_MODEL_BOUNDS'; min: number; max: number; extent?: number }
  | { type: 'SET_SLAB'; min?: number; max?: number }
  // Module
  | { type: 'ADD_MODULE'; module: Module }
  | { type: 'UPDATE_MODULE'; id: string; changes: Partial<Module> }
  | { type: 'DELETE_MODULE'; id: string }
  | { type: 'SELECT_MODULE'; id: string | null }
  | { type: 'HOVER_MODULE'; id: string | null }
  // Volume
  | { type: 'SET_VOLUME_METHOD'; method: VolumeMethod }
  | { type: 'SET_VOLUME_GIZMO_MODE'; gizmoMode: 'translate' | 'rotate' | 'scale' }
  | { type: 'SET_VOLUME_SIZE_NORM'; norm: number }
  | { type: 'SET_VOLUME_HAND_MODE'; enabled: boolean }
  | { type: 'START_PENDING_VOLUME'; method: VolumeMethod; transform: VolumeTransform }
  | { type: 'UPDATE_PENDING_VOLUME'; transform: VolumeTransform }
  | { type: 'CONFIRM_PENDING_VOLUME'; name?: string; tag?: 'magnetic' | 'normal'; strengthId?: string; direction?: MagnetDirection; z_range?: { z_min: number; z_max: number } }
  | { type: 'CANCEL_PENDING_VOLUME' }
  | { type: 'UPDATE_VOLUME'; id: string; changes: Partial<VolumeRegion> }
  | { type: 'DELETE_VOLUME'; id: string }
  | { type: 'SELECT_VOLUME'; id: string | null }
  // Surface region
  | { type: 'ADD_SURFACE_REGION'; region: SurfaceRegion }
  | { type: 'DELETE_SURFACE_REGION'; id: string }
  // Process rule
  | { type: 'ADD_PROCESS_RULE'; rule: ProcessRule }
  | { type: 'DELETE_PROCESS_RULE'; id: string }
  | { type: 'SET_PAINTED_FACE_COUNT'; count: number }
  // Reset
  | { type: 'RESET' }
  | { type: 'LOAD_STATE'; state: Partial<EditorState> };

/* ═══ Reducer ═══ */

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.mode };
    case 'SET_SUB_MODE':
      return { ...state, subMode: action.subMode, selectedModuleId: null, selectedVolumeId: null, pendingVolume: null, hoveredModuleId: null, surfaceTool: action.subMode === 'surface' ? 'brush' : state.surfaceTool };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.viewMode };
    case 'SET_SURFACE_TOOL':
      return { ...state, surfaceTool: action.tool };
    case 'SET_BRUSH_NORM':
      return { ...state, brushNorm: Math.max(0.01, Math.min(0.3, action.norm)) };
    case 'SET_STRENGTH_IDX':
      return { ...state, activeStrengthIdx: action.idx };
    case 'SET_DIRECTION':
      return { ...state, activeDirection: action.direction };
    case 'TOGGLE_XRAY':
      return { ...state, xray: !state.xray };
    case 'TOGGLE_BRUSH_BACKFACE_CULL':
      return { ...state, brushBackfaceCull: !state.brushBackfaceCull };
    case 'SET_BRUSH_BACKFACE_CULL':
      return { ...state, brushBackfaceCull: action.enabled };
    case 'SET_BRUSH_MAX_FACES':
      return { ...state, brushMaxFaces: Math.max(0, action.max) };
    case 'SET_PAINT_THICKNESS':
      return { ...state, paintThickness: Math.max(0.1, Math.min(1.0, action.thickness)) };
    case 'TOGGLE_SURFACE_WIREFRAME':
      return { ...state, surfaceWireframe: !state.surfaceWireframe };
    case 'SET_SURFACE_WIREFRAME':
      return { ...state, surfaceWireframe: action.enabled };
    case 'TOGGLE_DEBUG_OVERLAY':
      return { ...state, debugOverlay: !state.debugOverlay };
    case 'SET_DEBUG_OVERLAY':
      return { ...state, debugOverlay: action.enabled };
    case 'SET_SECTION':
      return {
        ...state,
        sectionEnabled: action.enabled,
        ...(action.height !== undefined ? { sectionHeight: action.height } : {}),
      };
    case 'SET_MODEL_BOUNDS': {
      const extent = action.extent ?? Math.max(action.max - action.min, 0.01);
      return { ...state, modelBounds: { min: action.min, max: action.max }, modelExtent: extent, sectionHeight: action.max, slabMin: action.min, slabMax: action.max };
    }
    case 'SET_SLAB':
      return {
        ...state,
        ...(action.min !== undefined ? { slabMin: action.min } : {}),
        ...(action.max !== undefined ? { slabMax: action.max } : {}),
      };

    // Module
    case 'ADD_MODULE':
      return { ...state, modules: [...state.modules, action.module] };
    case 'UPDATE_MODULE':
      return { ...state, modules: state.modules.map(m => m.module_id === action.id ? { ...m, ...action.changes } : m) };
    case 'DELETE_MODULE':
      return {
        ...state,
        modules: state.modules.filter(m => m.module_id !== action.id),
        selectedModuleId: state.selectedModuleId === action.id ? null : state.selectedModuleId,
      };
    case 'SELECT_MODULE':
      return { ...state, selectedModuleId: action.id };
    case 'HOVER_MODULE':
      return { ...state, hoveredModuleId: action.id };

    // Volume
    case 'SET_VOLUME_METHOD':
      return { ...state, activeVolumeMethod: action.method, volumeHandMode: false };
    case 'SET_VOLUME_GIZMO_MODE':
      return { ...state, volumeGizmoMode: action.gizmoMode };
    case 'SET_VOLUME_SIZE_NORM':
      return { ...state, volumeSizeNorm: Math.max(0.05, Math.min(0.8, action.norm)) };
    case 'SET_VOLUME_HAND_MODE':
      return { ...state, volumeHandMode: action.enabled };
    case 'START_PENDING_VOLUME':
      return { ...state, pendingVolume: { method: action.method, transform: action.transform }, selectedVolumeId: null };
    case 'UPDATE_PENDING_VOLUME':
      return state.pendingVolume ? { ...state, pendingVolume: { ...state.pendingVolume, transform: action.transform } } : state;
    case 'CONFIRM_PENDING_VOLUME': {
      if (!state.pendingVolume) return state;
      const newRegion: VolumeRegion = {
        region_id: generateId('vol'),
        name: action.name || `体积区域 ${state.volumeRegions.length + 1}`,
        type: 'magnetic_volume',
        method: state.pendingVolume.method,
        transform: state.pendingVolume.transform,
        tag: action.tag || 'magnetic',
        strengthId: action.strengthId,
        direction: action.direction ?? state.activeDirection,
        z_range: action.z_range || { z_min: state.modelBounds.min, z_max: state.modelBounds.max },
      };
      return {
        ...state,
        volumeRegions: [...state.volumeRegions, newRegion],
        selectedVolumeId: newRegion.region_id,
        pendingVolume: null,
      };
    }
    case 'CANCEL_PENDING_VOLUME':
      return { ...state, pendingVolume: null };
    case 'UPDATE_VOLUME':
      return { ...state, volumeRegions: state.volumeRegions.map(v => v.region_id === action.id ? { ...v, ...action.changes } : v) };
    case 'DELETE_VOLUME':
      return {
        ...state,
        volumeRegions: state.volumeRegions.filter(v => v.region_id !== action.id),
        selectedVolumeId: state.selectedVolumeId === action.id ? null : state.selectedVolumeId,
      };
    case 'SELECT_VOLUME':
      return { ...state, selectedVolumeId: action.id };

    // Surface region
    case 'ADD_SURFACE_REGION':
      return { ...state, surfaceRegions: [...state.surfaceRegions, action.region] };
    case 'DELETE_SURFACE_REGION':
      return { ...state, surfaceRegions: state.surfaceRegions.filter(r => r.region_id !== action.id) };

    // Process rule
    case 'ADD_PROCESS_RULE':
      return { ...state, processRules: [...state.processRules, action.rule] };
    case 'DELETE_PROCESS_RULE':
      return { ...state, processRules: state.processRules.filter(r => r.rule_id !== action.id) };
    case 'SET_PAINTED_FACE_COUNT':
      return { ...state, paintedFaceCount: action.count };

    // Reset / Load
    case 'RESET':
      return { ...initialState };
    case 'LOAD_STATE':
      return { ...state, ...action.state };

    default:
      return state;
  }
}

/* ═══ Context ═══ */

const EditorContext = createContext<EditorState>(initialState);
const EditorDispatchContext = createContext<Dispatch<EditorAction>>(() => {});

export function useEditor(): EditorState {
  return useContext(EditorContext);
}

const BRUSH_SCALE = 0.12;

export function getBrushWorldRadius(norm: number, extent: number): number {
  return norm * extent * BRUSH_SCALE;
}

export function useEditorDispatch(): Dispatch<EditorAction> {
  return useContext(EditorDispatchContext);
}

/* ═══ Provider ═══ */

export const EditorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(editorReducer, initialState);
  return (
    <EditorContext.Provider value={state}>
      <EditorDispatchContext.Provider value={dispatch}>
        {children}
      </EditorDispatchContext.Provider>
    </EditorContext.Provider>
  );
};
