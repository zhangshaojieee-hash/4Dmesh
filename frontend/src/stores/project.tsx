/**
 * project.tsx — Pipeline project state (Context + useReducer)
 */
import React, { createContext, useContext, useReducer, useEffect, type Dispatch } from 'react';
import type { RegionData, FacePaintData } from '../types';
import type { Module, VolumeRegion, SurfaceRegion, ProcessRule } from '../components/lib/editor-types';
import { getFileExtension } from '../utils/path';

/* ═══ State ═══ */

export type PipelineStep = 'idle' | 'annotated' | 'splitting' | 'split' | 'slicing' | 'sliced' | 'processing' | 'processed' | 'ready';

export type InputType = 'ai_project' | 'standalone_model' | 'gcode' | 'none';

export interface SourceFile {
  name: string;
  size?: number;
  format?: string;
}

export type GridMagnetDirection = 'X+' | 'X-' | 'Y+' | 'Y-' | 'Z+' | 'Z-';
export type GridSelectionMode = 'click' | 'box' | 'lasso' | 'brush';

export interface GridMagnetCell {
  strength: number;
  direction: GridMagnetDirection;
}

export interface GridMagnetization {
  version: 1;
  cellSize: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  dimensions: [number, number, number];
  activeCells: Record<string, GridMagnetCell>;
}

export interface GcodeInfo {
  filename: string;
  original_name: string;
  total_lines: number;
  total_layers: number;
  has_magnetic: boolean;
  mag_on_count: number;
  mag_off_count: number;
}

export interface ProjectState {
  projectId: string | null;
  modelUrl: string | null;
  modelId: number | null;
  modelName: string | null;
  // Unified source tracking
  inputType: InputType;
  sourceFile: SourceFile | null;
  gcodeContent: string;
  gcodeInfo: GcodeInfo | null;

  // Annotation data from AI Create
  regions: RegionData[];
  paintData: FacePaintData;
  modules: Module[];
  volumeRegions: VolumeRegion[];
  surfaceRegions: SurfaceRegion[];
  processRules: ProcessRule[];

  // Pipeline progress
  step: PipelineStep;

  // Split results
  splitResult: {
    files: Record<string, { filename: string; download_url: string }>;
    split_count: number;
    package_url?: string;
  } | null;

  modelResult: {
    single_model_3mf: string;
    continuous_model: boolean;
    magnetic_mode: 'offline_gcode_path' | 'legacy_object_label';
  } | null;

  // Slice results
  sliceResult: {
    gcode_path: string | null;
    download_url: string | null;
  } | null;

  // Final processed gcode
  gcodeResult: {
    output_path: string;
    download_url: string;
    stats: {
      mag_on_count: number;
      mag_off_count: number;
      total_lines: number;
    };
  } | null;

  surfacePaintGrid: SurfacePaintGrid | null;
  /** 表面画刷的全局磁场方向 */
  surfaceDirection: [number, number, number] | null;
  gridMagnetization: GridMagnetization | null;

  // Printer config
  printerProfile: string;
  qualityPreset: string;
}

export type SplitResult = ProjectState['splitResult'];
export type ModelResult = ProjectState['modelResult'];
export type SliceResult = ProjectState['sliceResult'];
export type GcodeResult = ProjectState['gcodeResult'];

const PROJECT_DRAFT_STORAGE_PREFIX = '4dprint.project';
const STORAGE_KEY = PROJECT_DRAFT_STORAGE_PREFIX;

const initialState: ProjectState = {
  projectId: null,
  modelUrl: null,
  modelId: null,
  modelName: null,
  inputType: 'none',
  sourceFile: null,
  gcodeContent: '',
  gcodeInfo: null,
  regions: [],
  paintData: {} as FacePaintData,
  modules: [],
  volumeRegions: [],
  surfaceRegions: [],
  processRules: [],
  surfacePaintGrid: null,
  surfaceDirection: null,
  gridMagnetization: null,
  step: 'idle',
  splitResult: null,
  modelResult: null,
  sliceResult: null,
  gcodeResult: null,
  printerProfile: 'prusa_i3_mk3',
  qualityPreset: '0.20mm',
};

export interface SurfacePaintGrid {
  bbox_min: number[];
  bbox_max: number[];
  resolution: number;
  data_b64: string;
}

function inferSourceFormat(modelUrl: string): string {
  return getFileExtension(modelUrl);
}

/* ═══ Actions ═══ */

export type ProjectAction =
  | { type: 'SET_PROJECT'; payload: { projectId?: string | null; modelUrl: string; modelId?: number | null; modelName: string; sourceFile?: SourceFile; regions: RegionData[]; paintData: FacePaintData; modules?: Module[]; volumeRegions?: VolumeRegion[]; surfaceRegions?: SurfaceRegion[]; processRules?: ProcessRule[]; surfacePaintGrid?: SurfacePaintGrid | null; surfaceDirection?: [number, number, number]; gridMagnetization?: GridMagnetization | null } }
  | { type: 'RESTORE_PROJECT'; payload: Partial<ProjectState> & { modelUrl: string; modelName: string } }
  | { type: 'SET_MODEL'; modelUrl: string; modelName: string; modelId?: number | null }
  | { type: 'SET_GCODE_SOURCE'; sourceFile: SourceFile }
  | { type: 'SET_SOURCE'; inputType: InputType; sourceFile: SourceFile }
  | { type: 'SET_GCODE_CONTENT'; content: string }
  | { type: 'SET_GCODE_INFO'; info: GcodeInfo }
  | { type: 'CLEAR_GCODE_DATA' }
  | { type: 'CLEAR_ACTIVE_FILE' }
  | { type: 'SET_STEP'; step: PipelineStep }
  | { type: 'SET_SPLIT_RESULT'; result: ProjectState['splitResult'] }
  | { type: 'SET_MODEL_RESULT'; result: ProjectState['modelResult'] }
  | { type: 'SET_SLICE_RESULT'; result: ProjectState['sliceResult'] }
  | { type: 'SET_GCODE_RESULT'; result: ProjectState['gcodeResult'] }
  | { type: 'SET_GRID_MAGNETIZATION'; grid: GridMagnetization | null }
  | { type: 'SET_PRINTER_CONFIG'; printerProfile?: string; qualityPreset?: string }
  | { type: 'SET_PROJECT_ID'; projectId: string | null }
  | { type: 'RESET' };

/* ═══ Reducer ═══ */

function hydrateInitialState(): ProjectState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<ProjectState>;
    return {
      ...initialState,
      printerProfile: parsed.printerProfile ?? initialState.printerProfile,
      qualityPreset: parsed.qualityPreset ?? initialState.qualityPreset,
    };
  } catch {
    return initialState;
  }
}

function projectReducer(state: ProjectState, action: ProjectAction): ProjectState {
  switch (action.type) {
    case 'SET_PROJECT': {
      const { projectId, modelUrl, modelId, modelName, regions, paintData, modules, volumeRegions, surfaceRegions, processRules, surfacePaintGrid, surfaceDirection, gridMagnetization } = action.payload;
      const hasAnnotations = regions.length > 0 || (volumeRegions && volumeRegions.length > 0) || !!surfacePaintGrid || !!gridMagnetization && Object.keys(gridMagnetization.activeCells).length > 0 || Object.keys(paintData || {}).length > 0;
      return {
        ...state,
        projectId: projectId === undefined ? state.projectId : projectId,
        modelId: modelId ?? null,
        modelUrl, modelName,
        regions, paintData,
        modules: modules ?? [],
        volumeRegions: volumeRegions ?? [],
        surfaceRegions: surfaceRegions ?? [],
        processRules: processRules ?? [],
        surfacePaintGrid: surfacePaintGrid ?? null,
        surfaceDirection: surfaceDirection ?? null,
        gridMagnetization: gridMagnetization ?? null,
        step: 'annotated',
        splitResult: null, modelResult: null, sliceResult: null, gcodeResult: null,
        gcodeContent: '', gcodeInfo: null,
        inputType: hasAnnotations ? 'ai_project' as InputType : 'standalone_model' as InputType,
        sourceFile: action.payload.sourceFile ?? { name: modelName, format: inferSourceFormat(modelUrl) },
      };
    }
    case 'RESTORE_PROJECT': {
      const payload = action.payload;
      return {
        ...initialState,
        projectId: payload.projectId ?? null,
        modelUrl: payload.modelUrl,
        modelId: payload.modelId ?? null,
        modelName: payload.modelName,
        regions: payload.regions ?? [],
        paintData: payload.paintData ?? ({} as FacePaintData),
        modules: payload.modules ?? [],
        volumeRegions: payload.volumeRegions ?? [],
        surfaceRegions: payload.surfaceRegions ?? [],
        processRules: payload.processRules ?? [],
        surfacePaintGrid: payload.surfacePaintGrid ?? null,
        surfaceDirection: payload.surfaceDirection ?? null,
        gridMagnetization: payload.gridMagnetization ?? null,
        step: payload.step ?? 'annotated',
        splitResult: payload.splitResult ?? null,
        modelResult: payload.modelResult ?? null,
        sliceResult: payload.sliceResult ?? null,
        gcodeResult: payload.gcodeResult ?? null,
        gcodeInfo: payload.gcodeInfo ?? null,
        inputType: payload.inputType ?? 'standalone_model',
        sourceFile: payload.sourceFile ?? { name: payload.modelName, format: inferSourceFormat(payload.modelUrl) },
        gcodeContent: '',
        printerProfile: payload.printerProfile ?? state.printerProfile,
        qualityPreset: payload.qualityPreset ?? state.qualityPreset,
      };
    }
    case 'SET_MODEL':
      return {
        ...initialState,
        projectId: null,
        modelUrl: action.modelUrl,
        modelId: action.modelId ?? null,
        modelName: action.modelName,
        printerProfile: state.printerProfile,
        qualityPreset: state.qualityPreset,
        inputType: 'standalone_model' as InputType,
        sourceFile: { name: action.modelName, format: inferSourceFormat(action.modelUrl) },
      };
    case 'SET_GCODE_SOURCE':
      return {
        ...initialState,
        projectId: null,
        inputType: 'gcode' as InputType,
        sourceFile: action.sourceFile,
        printerProfile: state.printerProfile,
        qualityPreset: state.qualityPreset,
      };
    case 'SET_SOURCE':
      return { ...state, inputType: action.inputType, sourceFile: action.sourceFile };
    case 'SET_GCODE_CONTENT':
      return { ...state, gcodeContent: action.content };
    case 'SET_GCODE_INFO':
      return { ...state, gcodeInfo: action.info };
    case 'CLEAR_GCODE_DATA':
      return { ...state, gcodeContent: '', gcodeInfo: null, gcodeResult: null };
    case 'CLEAR_ACTIVE_FILE':
      return {
        ...initialState,
        printerProfile: state.printerProfile,
        qualityPreset: state.qualityPreset,
      };
    case 'SET_STEP':
      return { ...state, step: action.step };
    case 'SET_SPLIT_RESULT':
      return { ...state, splitResult: action.result, step: 'split' };
    case 'SET_MODEL_RESULT':
      return { ...state, modelResult: action.result };
    case 'SET_SLICE_RESULT':
      return { ...state, sliceResult: action.result, step: 'sliced' };
    case 'SET_GCODE_RESULT':
      return { ...state, gcodeResult: action.result, step: 'ready' };
    case 'SET_GRID_MAGNETIZATION':
      return { ...state, gridMagnetization: action.grid };
    case 'SET_PRINTER_CONFIG':
      return {
        ...state,
        printerProfile: action.printerProfile ?? state.printerProfile,
        qualityPreset: action.qualityPreset ?? state.qualityPreset,
      };
    case 'SET_PROJECT_ID':
      return { ...state, projectId: action.projectId };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

/* ═══ Contexts ═══ */

const ProjectStateCtx = createContext<ProjectState>(initialState);
const ProjectDispatchCtx = createContext<Dispatch<ProjectAction>>(() => {});

/* ═══ Provider ═══ */

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(projectReducer, undefined as unknown as ProjectState, hydrateInitialState);

  useEffect(() => {
    try {
      // Persist only what hydrateInitialState reads back. Serializing the full state
      // (large gcodeContent / base64 surface grid) on every dispatch stalled the main thread.
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          printerProfile: state.printerProfile,
          qualityPreset: state.qualityPreset,
        }),
      );
    } catch {
      // Persisting UI preferences is best-effort.
    }
  }, [state.printerProfile, state.qualityPreset]);

  return (
    <ProjectStateCtx.Provider value={state}>
      <ProjectDispatchCtx.Provider value={dispatch}>
        {children}
      </ProjectDispatchCtx.Provider>
    </ProjectStateCtx.Provider>
  );
}

/* ═══ Hooks ═══ */

export function useProject(): ProjectState {
  return useContext(ProjectStateCtx);
}

export function useProjectDispatch(): Dispatch<ProjectAction> {
  return useContext(ProjectDispatchCtx);
}
