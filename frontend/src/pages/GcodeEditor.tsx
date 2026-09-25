import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import {
  uploadGcode,
  getGcodeContent,
  createProcess4DTask,
  getProcess4DTask,
  cancelProcess4DTask,
  sliceModel,
  downloadGcodeUrl,
  saveGcode,
  uploadTemp,
  createProject,
  updateProject,
  type Process4DResponse,
  type Process4DTask,
} from '../services/api';
import { useProject, useProjectDispatch } from '../stores/project';
import type { GridMagnetDirection, GridMagnetization, GridSelectionMode, ProjectState } from '../stores/project';
import { useToast } from '../stores/toast';
import type { GcodeViewPreset } from '../components/gcode-preview/GcodePreviewCanvas';
import MagTimeline from '../components/gcode-editor/MagTimeline';
import PrePrintCheck from '../components/gcode-editor/PrePrintCheck';
import { parseMagProgram } from '../utils/gcode/parseMagProgram';
import { validateGcodeStats, type ValidationDiscrepancy } from '../utils/gcodeValidator';
import { getFileName } from '../utils/path';
import { getFileExtension } from '../utils/path';
import { createGridSpec, gridCellCount, MAX_CELLS } from '../components/gcode-preview/GridMagnetizationOverlay';

interface ErrorDetailShape {
  msg?: unknown;
  message?: unknown;
}

interface ErrorShape {
  response?: {
    data?: {
      detail?: unknown;
    };
  };
  message?: unknown;
}

function normalizeError(err: unknown): string {
  const error = err as ErrorShape | undefined;
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => d?.msg || JSON.stringify(d)).join('；');
  }
  if (detail && typeof detail === 'object') {
    const objectDetail = detail as ErrorDetailShape;
    if (typeof objectDetail.msg === 'string') return objectDetail.msg;
    if (typeof objectDetail.message === 'string') return objectDetail.message;
    return JSON.stringify(detail);
  }
  if (typeof error?.message === 'string') return error.message;
  return '请求失败';
}

const pipelineSteps = [
  { key: 'annotated', label: '已标注' },
  { key: 'split', label: '已分割' },
  { key: 'sliced', label: '已切片' },
  { key: 'processed', label: '已处理' },
  { key: 'ready', label: '可打印' },
] as const;


type PreviewTab = 'model' | 'gcode' | 'analysis';

const MAX_ANALYSIS_PREVIEW_CHARS = 120_000;

type ProjectSaveSnapshot = Partial<Pick<
  ProjectState,
  'step' | 'splitResult' | 'modelResult' | 'sliceResult' | 'gcodeResult' | 'gcodeInfo'
>>;

const GcodePreviewPanel = React.lazy(() => import('../components/gcode-preview/GcodePreviewPanel'));
const ModelPreviewPanel = React.lazy(() => import('../components/gcode-preview/ModelPreviewPanel'));

const PreviewLoadingFallback: React.FC = () => (
  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', background: 'var(--bg-page)' }}>
    <div className="loading-spinner" />
    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>正在加载预览...</div>
  </div>
);

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const printerOptions = [
  { value: 'prusa_i3_mk3', label: 'Prusa i3 MK3', bed: [250, 210, 210] as const },
  { value: 'prusa_mini', label: 'Prusa Mini', bed: [180, 180, 180] as const },
  { value: 'ender3', label: 'Ender 3', bed: [220, 220, 250] as const },
  { value: 'bambu_x1c', label: 'Bambu X1C', bed: [256, 256, 256] as const },
];

const qualityOptions = [
  { value: '0.10mm', label: '0.10mm - 精细' },
  { value: '0.20mm', label: '0.20mm - 标准' },
  { value: '0.30mm', label: '0.30mm - 快速' },
];

const qualityChips = [
  { value: '0.20mm', label: '标准' },
  { value: '0.10mm', label: '精细' },
  { value: '0.30mm', label: '高速' },
];

const viewPresetOptions: { value: GcodeViewPreset; label: string }[] = [
  { value: 'perspective', label: '透视' },
  { value: 'top', label: '顶视' },
  { value: 'front', label: '前视' },
  { value: 'side', label: '侧视' },
];

function formatBytes(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function sourceLabel(inputType: string): string {
  switch (inputType) {
    case 'ai_project': return 'AI 创作项目';
    case 'standalone_model': return '上传模型';
    case 'gcode': return '上传 G-code';
    default: return '未选择';
  }
}

function firstNumericMatch(content: string, pattern: RegExp): number | null {
  const match = content.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function formatDurationLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '待解析';
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.round((safeSeconds % 3600) / 60);
  if (hours <= 0) return `${Math.max(1, minutes)} min`;
  return `${hours}h ${minutes}m`;
}

const GcodeEditor: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const project = useProject();
  const projectDispatch = useProjectDispatch();


  const [runningPipeline, setRunningPipeline] = useState(false);
  const [slicing, setSlicing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [activePreview, setActivePreview] = useState<PreviewTab>('model');
  const [, setValidationWarning] = useState<ValidationDiscrepancy[]>([]);
  const [processProgress, setProcessProgress] = useState(0);
  const [processStatusText, setProcessStatusText] = useState('');
  const [, setProcessLogs] = useState<Process4DTask['logs']>([]);
  const [activeProcessTaskId, setActiveProcessTaskId] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null);
  const [showTravel, setShowTravel] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [viewPreset, setViewPreset] = useState<GcodeViewPreset>('perspective');
  const [viewResetSignal, setViewResetSignal] = useState(0);
  const [mobilePanel, setMobilePanel] = useState<'config' | 'actions' | null>(null);
  const [gridCellSize, setGridCellSize] = useState(5);
  const [gridVisible, setGridVisible] = useState(false);
  const [selectedGridCells, setSelectedGridCells] = useState<Set<string>>(new Set());
  const [modelBounds, setModelBounds] = useState<{ min: [number, number, number]; max: [number, number, number] } | null>(null);
  const [gridStrength, setGridStrength] = useState(100);
  const [gridDirection, setGridDirection] = useState<GridMagnetDirection>('Z+');
  const [gridSelectionMode, setGridSelectionMode] = useState<GridSelectionMode>('click');
  const [gridStrengthUnit, setGridStrengthUnit] = useState<'mT' | 'T'>('mT');
  const [gridZLayer, setGridZLayer] = useState(0);
  const [gridAxis, setGridAxis] = useState<'X' | 'Y' | 'Z'>('Z');
  const [gridAxisLayer, setGridAxisLayer] = useState(0);
  const [validGridCellKeys, setValidGridCellKeys] = useState<Set<string> | null>(null);
  const [bottomFaceSelectionMode, setBottomFaceSelectionMode] = useState(false);
  const [modelRotation, setModelRotation] = useState<[number, number, number, number]>([0, 0, 0, 1]);
  const pipelineCancelledRef = useRef(false);
  const handledImportModelRef = useRef<string | null>(null);

  useEffect(() => () => {
    pipelineCancelledRef.current = true;
    THREE.Cache.clear();
  }, []);

  useEffect(() => {
    document.body.classList.add('gcode-workbench-route-active');
    document.body.classList.toggle('gcode-mobile-panel-open', mobilePanel !== null);
    return () => {
      document.body.classList.remove('gcode-workbench-route-active');
      document.body.classList.remove('gcode-mobile-panel-open');
    };
  }, [mobilePanel]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);

  const handleGridBounds = useCallback((bboxMin: [number, number, number], bboxMax: [number, number, number]) => {
    setModelBounds((current) => current && current.min.every((value, index) => value === bboxMin[index]) && current.max.every((value, index) => value === bboxMax[index])
      ? current
      : { min: bboxMin, max: bboxMax });
  }, []);

  const toggleGridCell = useCallback((key: string, additive: boolean) => {
    setSelectedGridCells((current) => {
      const next = additive ? new Set(current) : new Set<string>();
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const selectGridCells = useCallback((keys: string[], additive: boolean) => {
    setSelectedGridCells((current) => {
      const next = additive ? new Set(current) : new Set<string>();
      keys.forEach((key) => next.add(key));
      return next;
    });
  }, []);

  const allGridCellKeys = useCallback((grid: GridMagnetization) => {
    const keys: string[] = [];
    for (let z = 0; z < grid.dimensions[2]; z++) for (let y = 0; y < grid.dimensions[1]; y++) for (let x = 0; x < grid.dimensions[0]; x++) keys.push(`${x}:${y}:${z}`);
    return keys;
  }, []);

  const createGrid = useCallback(() => {
    if (!modelBounds) return;
    const spec = createGridSpec(new THREE.Box3(new THREE.Vector3(...modelBounds.min), new THREE.Vector3(...modelBounds.max)), gridCellSize);
    const count = gridCellCount(spec.dimensions);
    if (count > MAX_CELLS) {
      setError(`当前网格共有 ${count.toLocaleString()} 个单元，请增大网格尺寸（最多 ${MAX_CELLS.toLocaleString()} 个）`);
      return;
    }
    const grid: GridMagnetization = {
      version: 1,
      cellSize: spec.cellSize,
      bboxMin: spec.bboxMin,
      bboxMax: spec.bboxMax,
      dimensions: spec.dimensions,
      activeCells: project.gridMagnetization?.cellSize === spec.cellSize ? project.gridMagnetization.activeCells : {},
    };
    projectDispatch({ type: 'SET_GRID_MAGNETIZATION', grid });
    setValidGridCellKeys(null);
    setSelectedGridCells(new Set());
    setGridVisible(true);
    setError('');
    showToast(`已生成 ${count.toLocaleString()} 个规则网格单元`, 'success');
  }, [gridCellSize, modelBounds, project.gridMagnetization, projectDispatch, showToast]);

  const applyGridMagnetization = useCallback(() => {
    if (!project.gridMagnetization || selectedGridCells.size === 0) return;
    const activeCells = { ...project.gridMagnetization.activeCells };
    selectedGridCells.forEach((key) => {
      activeCells[key] = { strength: gridStrengthUnit === 'mT' ? gridStrength / 1000 : gridStrength, direction: gridDirection };
    });
    projectDispatch({ type: 'SET_GRID_MAGNETIZATION', grid: { ...project.gridMagnetization, activeCells } });
    showToast(`已为 ${selectedGridCells.size} 个网格设置磁场`, 'success');
  }, [gridDirection, gridStrength, gridStrengthUnit, project.gridMagnetization, projectDispatch, selectedGridCells, showToast]);

  const clearGridMagnetization = useCallback(() => {
    if (!project.gridMagnetization || selectedGridCells.size === 0) return;
    const activeCells = { ...project.gridMagnetization.activeCells };
    selectedGridCells.forEach((key) => delete activeCells[key]);
    projectDispatch({ type: 'SET_GRID_MAGNETIZATION', grid: { ...project.gridMagnetization, activeCells } });
  }, [project.gridMagnetization, projectDispatch, selectedGridCells]);

  const invertGridSelection = useCallback(() => {
    if (!project.gridMagnetization) return;
    const all = new Set(allGridCellKeys(project.gridMagnetization));
    selectedGridCells.forEach((key) => all.delete(key));
    setSelectedGridCells(all);
  }, [allGridCellKeys, project.gridMagnetization, selectedGridCells]);

  const selectGridZLayer = useCallback(() => {
    if (!project.gridMagnetization) return;
    const [nx, ny, nz] = project.gridMagnetization.dimensions;
    const z = Math.max(0, Math.min(nz - 1, gridZLayer));
    const keys: string[] = [];
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) keys.push(`${x}:${y}:${z}`);
    setSelectedGridCells(new Set(keys));
  }, [gridZLayer, project.gridMagnetization]);

  const handleValidGridCells = useCallback((keys: string[]) => {
    setValidGridCellKeys((current) => {
      if (current && current.size === keys.length && keys.every((key) => current.has(key))) return current;
      return new Set(keys);
    });
  }, []);

  const selectGridAxisLayer = useCallback(() => {
    if (!project.gridMagnetization) return;
    const [nx, ny, nz] = project.gridMagnetization.dimensions;
    const axisIndex = gridAxis === 'X' ? 0 : gridAxis === 'Y' ? 1 : 2;
    const axisSize = project.gridMagnetization.dimensions[axisIndex];
    const layer = Math.max(0, Math.min(axisSize - 1, gridAxisLayer));
    const keys: string[] = [];
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if ((axisIndex === 0 && x === layer) || (axisIndex === 1 && y === layer) || (axisIndex === 2 && z === layer)) keys.push(`${x}:${y}:${z}`);
    }
    setSelectedGridCells(new Set(keys));
  }, [gridAxis, gridAxisLayer, project.gridMagnetization]);

  // Read from store
  const { gcodeContent, gcodeInfo, inputType } = project;
  
  const canPreviewModel = Boolean(project.modelUrl && inputType !== 'gcode');
  const canPreviewGcode = Boolean(gcodeContent);
  const selectedPrinter = printerOptions.find((option) => option.value === project.printerProfile) ?? printerOptions[0];
  const printerBed = useMemo(() => ({ width: selectedPrinter.bed[0], depth: selectedPrinter.bed[1], height: selectedPrinter.bed[2] }), [selectedPrinter.bed]);

  useEffect(() => {
    setModelRotation([0, 0, 0, 1]);
    setBottomFaceSelectionMode(false);
  }, [project.modelUrl]);
  const currentFilename = project.gcodeResult?.output_path ? getFileName(project.gcodeResult.output_path) : null;

  const buildProjectPayload = (snapshot: ProjectSaveSnapshot = {}) => {
    const next = { ...project, ...snapshot };
    const snapshotGcodeInfo = snapshot.gcodeInfo === undefined ? project.gcodeInfo : snapshot.gcodeInfo;
    const snapshotGcodeResult = snapshot.gcodeResult === undefined ? project.gcodeResult : snapshot.gcodeResult;
    const gcodeDownloadUrl =
      snapshotGcodeResult?.download_url
      || (snapshotGcodeInfo ? downloadGcodeUrl(snapshotGcodeInfo.filename) : null)
      || (currentFilename ? downloadGcodeUrl(currentFilename) : null);
    const savedModelUrl = next.modelUrl || gcodeDownloadUrl || '';
    const savedName = next.modelName || snapshotGcodeInfo?.original_name || currentFilename || 'G-code 项目';
    return {
      name: savedName,
      model_url: savedModelUrl,
      model_id: next.modelId,
      model_name: next.modelName || snapshotGcodeInfo?.original_name || currentFilename,
      regions: next.regions,
      paint_data: next.paintData as Record<string, unknown>,
      modules: next.modules,
      volume_regions: next.volumeRegions,
      surface_regions: next.surfaceRegions,
      process_rules: next.processRules,
      surface_paint_grid: next.surfacePaintGrid as Record<string, unknown> | null,
      surface_direction: next.surfaceDirection,
      grid_magnetization: next.gridMagnetization as unknown as Record<string, unknown> | null,
      input_type: next.inputType,
      source_file: next.sourceFile as Record<string, unknown> | null,
      gcode_info: snapshotGcodeInfo as unknown as Record<string, unknown> | null,
      step: next.step,
      split_result: next.splitResult as unknown as Record<string, unknown> | null,
      model_result: next.modelResult as unknown as Record<string, unknown> | null,
      slice_result: next.sliceResult as unknown as Record<string, unknown> | null,
      gcode_result: next.gcodeResult as unknown as Record<string, unknown> | null,
      printer_profile: next.printerProfile,
      quality_preset: next.qualityPreset,
    };
  };

  const persistExistingProject = async (snapshot: ProjectSaveSnapshot) => {
    if (!project.projectId) return;
    try {
      await updateProject(project.projectId, buildProjectPayload(snapshot));
    } catch (error) {
      console.warn('Failed to sync project results', error);
      showToast('处理结果已生成，但项目中心同步失败，请手动保存', 'error');
    }
  };

  const handleSaveOrEdit = async () => {
    if (editMode) {
      const targetFilename = currentFilename || gcodeInfo?.filename;
      if (!targetFilename) {
        setError('当前没有可保存的 G-code 文件名');
        return;
      }
      try {
        const saved = await saveGcode(targetFilename, editContent);
        projectDispatch({ type: 'SET_GCODE_CONTENT', content: editContent });
        projectDispatch({ type: 'SET_GCODE_INFO', info: {
          filename: saved.filename,
          original_name: saved.filename,
          total_lines: saved.total_lines,
          total_layers: saved.total_layers,
          has_magnetic: saved.mag_on_count > 0,
          mag_on_count: saved.mag_on_count,
          mag_off_count: saved.mag_off_count,
        }});
        projectDispatch({
          type: 'SET_GCODE_RESULT',
          result: {
            output_path: saved.filename,
            download_url: saved.download_url,
            stats: {
              mag_on_count: saved.mag_on_count,
              mag_off_count: saved.mag_off_count,
              total_lines: saved.total_lines,
            },
          },
        });
        setEditMode(false);
        showToast('G-code 已保存', 'success');
      } catch (err: unknown) {
        setError(normalizeError(err));
      }
    } else {
      setEditContent(gcodeContent);
      setEditMode(true);
    }
  };

  const handleCancelEdit = () => {
    setEditContent(gcodeContent);
    setEditMode(false);
  };

  useEffect(() => {
    if (!currentFilename || gcodeContent) return;
    let cancelled = false;
    (async () => {
      try {
        const contentRes = await getGcodeContent(currentFilename);
        if (cancelled) return;
        projectDispatch({ type: 'SET_GCODE_CONTENT', content: contentRes.content });
        projectDispatch({ type: 'SET_GCODE_INFO', info: {
          filename: currentFilename,
          original_name: currentFilename,
          total_lines: project.gcodeResult?.stats.total_lines ?? contentRes.content.split('\n').length,
          total_layers: (contentRes.content.match(/;LAYER:\s*\d+|; Layer \d+/gi) || []).length,
          has_magnetic: (project.gcodeResult?.stats.mag_on_count ?? 0) > 0,
          mag_on_count: project.gcodeResult?.stats.mag_on_count ?? 0,
          mag_off_count: project.gcodeResult?.stats.mag_off_count ?? 0,
        }});
      } catch (error: unknown) {
        setError(normalizeError(error));
      }
    })();
    return () => { cancelled = true; };
  }, [currentFilename, gcodeContent, project.gcodeResult, projectDispatch]);

  useEffect(() => {
    const importModelUrl = searchParams.get('importModel');
    if (importModelUrl === handledImportModelRef.current) return;
    if (importModelUrl) {
      handledImportModelRef.current = importModelUrl;
      const importedModelId = Number(searchParams.get('modelId'));
      const importedModelName = searchParams.get('modelName') || 'Imported Model';
      projectDispatch({
        type: 'SET_MODEL',
        modelUrl: decodeURIComponent(importModelUrl),
        modelId: Number.isFinite(importedModelId) && importedModelId > 0 ? importedModelId : null,
        modelName: importedModelName,
      });
      projectDispatch({ type: 'SET_SOURCE', inputType: 'ai_project', sourceFile: { name: importedModelName, format: 'url' } });
      projectDispatch({ type: 'SET_STEP', step: 'annotated' });
      setActivePreview('model');
      setSelectedLayer(null);
      setEditMode(false);
      setEditContent('');
      resetPreviewView();
      showToast('模型已导入，可直接切片或返回 AI 创作页标注磁性区域', 'success');
    }
  }, [searchParams, projectDispatch, showToast]);

  useEffect(() => {
    if (!canPreviewModel && canPreviewGcode) {
      setActivePreview('gcode');
    }
  }, [canPreviewGcode, canPreviewModel]);

  const handleUploadGcode = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    projectDispatch({ type: 'CLEAR_ACTIVE_FILE' });
    setActivePreview('gcode');
    setSelectedLayer(null);
    setEditMode(false);
    setEditContent('');
    setProcessProgress(0);
    setProcessStatusText('正在加载 G-code...');
    setLoading(true);
    setError('');
    try {
      const res = await uploadGcode(file);
      const contentRes = await getGcodeContent(res.filename);
      
      projectDispatch({ type: 'SET_GCODE_SOURCE', sourceFile: { name: file.name, size: file.size, format: 'gcode' } });
      projectDispatch({ type: 'SET_GCODE_INFO', info: res });
      projectDispatch({ type: 'SET_GCODE_CONTENT', content: contentRes.content });
      projectDispatch({ type: 'SET_GCODE_RESULT', result: {
        output_path: res.filename,
        download_url: downloadGcodeUrl(res.filename),
        stats: {
          mag_on_count: res.mag_on_count || 0,
          mag_off_count: res.mag_off_count || 0,
          total_lines: res.total_lines || 0,
        },
      }});
      projectDispatch({ type: 'SET_STEP', step: 'ready' });
      setActivePreview('gcode');
      setSelectedLayer(null);
      showToast('G-code 已加载', 'success');
    } catch (err: unknown) {
      setError(normalizeError(err));
    } finally {
      setLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleUploadModel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = getFileExtension(file.name);
    if (!['glb', 'gltf', 'obj', 'stl', '3mf', 'step'].includes(ext || '')) {
      setError('支持格式: GLB, GLTF, OBJ, STL, 3MF, STEP');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError('文件不能超过 100MB');
      return;
    }
    setLoading(true);
    setError('');
    projectDispatch({ type: 'CLEAR_ACTIVE_FILE' });
    setActivePreview('model');
    setSelectedLayer(null);
    setEditMode(false);
    setEditContent('');
    setProcessProgress(0);
    setProcessStatusText('正在上传并加载新模型...');
    try {
      const res = await uploadTemp(file);
      projectDispatch({
        type: 'SET_PROJECT',
        payload: {
          projectId: null,
          modelUrl: res.model_url || res.preview_url,
          modelId: res.model_id ?? null,
          modelName: file.name,
          regions: [],
          paintData: {},
          modules: [],
          volumeRegions: [],
          surfaceRegions: [],
          processRules: [],
          sourceFile: { name: file.name, size: file.size, format: ext },
        },
      });
      projectDispatch({ type: 'SET_STEP', step: 'annotated' });
      setActivePreview('model');
      resetPreviewView();
      showToast('模型已加载', 'success');
    } catch (err: unknown) {
      setError(normalizeError(err));
    } finally {
      setLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const applyProcess4DResult = async (res: Process4DResponse) => {
    if (!res.success || !res.output_path || !res.filename) {
      throw new Error(res.error || res.message || '一键处理失败');
    }

    const splitResult = res.split_result ?? project.splitResult;
    const modelResult = res.model_result ?? project.modelResult;
    const sliceResult = res.slice_result ?? project.sliceResult;
    const gcodeResult = {
      output_path: res.output_path,
      download_url: res.download_url || downloadGcodeUrl(res.filename),
      stats: {
        mag_on_count: res.stats?.mag_on_count ?? 0,
        mag_off_count: res.stats?.mag_off_count ?? 0,
        total_lines: res.stats?.total_lines ?? 0,
      },
    };

    if (res.split_result) {
      projectDispatch({ type: 'SET_SPLIT_RESULT', result: res.split_result });
    }
    if (res.model_result) {
      projectDispatch({ type: 'SET_MODEL_RESULT', result: res.model_result });
    }
    if (res.slice_result) {
      projectDispatch({ type: 'SET_SLICE_RESULT', result: res.slice_result });
    }
    projectDispatch({
      type: 'SET_GCODE_RESULT',
      result: gcodeResult,
    });
    projectDispatch({ type: 'SET_STEP', step: 'ready' });

    const contentRes = await getGcodeContent(res.filename);
    const gcodeInfo = {
      filename: res.filename,
      original_name: res.filename,
      total_lines: res.stats?.total_lines ?? contentRes.content.split('\n').length,
      total_layers: (contentRes.content.match(/;LAYER:\s*\d+|; Layer \d+/gi) || []).length,
      has_magnetic: (res.stats?.mag_on_count ?? 0) > 0,
      mag_on_count: res.stats?.mag_on_count ?? 0,
      mag_off_count: res.stats?.mag_off_count ?? 0,
    };
    projectDispatch({ type: 'SET_GCODE_CONTENT', content: contentRes.content });
    projectDispatch({ type: 'SET_GCODE_INFO', info: gcodeInfo });
    await persistExistingProject({
      step: 'ready',
      splitResult,
      modelResult,
      sliceResult,
      gcodeResult,
      gcodeInfo,
    });

    setActivePreview('gcode');
    setSelectedLayer(null);

    showToast(res.message || 'G-code 处理完成', 'success');

    const validation = await validateGcodeStats(res.download_url || downloadGcodeUrl(res.filename), {
      mag_on_count: res.stats?.mag_on_count ?? 0,
      mag_off_count: res.stats?.mag_off_count ?? 0,
      total_lines: res.stats?.total_lines ?? 0,
    });
    if (!validation.isValid) {
      setValidationWarning(validation.discrepancies);
    }
  };

  const handleRunPipeline = async () => {
    const hasData = project.regions.length > 0 || (project.volumeRegions && project.volumeRegions.length > 0) || !!project.surfacePaintGrid || !!project.gridMagnetization?.activeCells && Object.keys(project.gridMagnetization.activeCells).length > 0 || Object.keys(project.paintData || {}).length > 0;
    if (!project.modelUrl || !hasData) {
      setError('当前没有可处理的项目数据');
      return;
    }
    setRunningPipeline(true);
    setError('');
    setProcessProgress(0);
    setProcessStatusText('正在创建处理任务');
    setProcessLogs([]);
    pipelineCancelledRef.current = false;
    try {
      projectDispatch({ type: 'SET_STEP', step: 'processing' });

      const task = await createProcess4DTask({
        model_url: project.modelUrl,
        regions: project.regions,
        paint_data: project.paintData,
        volume_regions: project.volumeRegions,
        surface_paint_grid: project.surfacePaintGrid,
        surface_direction: project.surfaceDirection,
        grid_magnetization: project.gridMagnetization,
        printer_profile: project.printerProfile,
        quality: project.qualityPreset,
      });
      setActiveProcessTaskId(task.task_id);
      setProcessProgress(task.progress);
      setProcessStatusText(task.message || '任务已创建');
      setProcessLogs(task.logs || []);

      let pollingErrors = 0;
      let latestTask = task;
      const startedAt = Date.now();
      while (!pipelineCancelledRef.current) {
        if (Date.now() - startedAt > 60 * 60 * 1000) {
          throw new Error('处理任务超时，请稍后在任务结果中重试');
        }
        await wait(latestTask.status === 'queued' ? 5000 : 2000);
        if (pipelineCancelledRef.current) return;
        try {
          latestTask = await getProcess4DTask(task.task_id);
          pollingErrors = 0;
          setProcessProgress(latestTask.progress);
          setProcessStatusText(latestTask.message || latestTask.current_stage || '处理中');
          setProcessLogs(latestTask.logs || []);
        } catch {
          pollingErrors += 1;
          if (pollingErrors >= 10) {
            throw new Error('处理任务状态查询失败，请检查后端服务');
          }
          continue;
        }

        if (latestTask.status === 'succeeded') {
          if (!latestTask.result) {
            throw new Error('处理任务完成但没有返回结果');
          }
          await applyProcess4DResult(latestTask.result);
          break;
        }
        if (latestTask.status === 'failed') {
          throw new Error(latestTask.error || latestTask.message || '处理任务失败');
        }
        if (latestTask.status === 'cancelled') {
          setProcessStatusText('已取消当前切片任务');
          return;
        }
      }
    } catch (err: unknown) {
      const detail = normalizeError(err);
      setError(detail);
    } finally {
      setRunningPipeline(false);
      setActiveProcessTaskId(null);
    }
  };

  const handleSliceOnly = async () => {
    if (!project.modelUrl) {
      setError('当前没有可切片的模型');
      return;
    }
    setSlicing(true);
    setError('');
    try {
      projectDispatch({ type: 'SET_STEP', step: 'slicing' });

      const res = await sliceModel({
        model_path: project.modelUrl,
        printer_profile: project.printerProfile,
        quality: project.qualityPreset,
      });

      if (!res.success || !res.gcode_path) {
        throw new Error(res.error || res.message || '切片失败');
      }

      const filename = res.filename || getFileName(res.gcode_path);
      const sliceResult = {
        gcode_path: res.gcode_path,
        download_url: res.download_url || downloadGcodeUrl(filename),
      };
      const gcodeResult = {
        output_path: res.gcode_path,
        download_url: res.download_url || downloadGcodeUrl(filename),
        stats: {
          mag_on_count: 0,
          mag_off_count: 0,
          total_lines: 0,
        },
      };

      projectDispatch({
        type: 'SET_SLICE_RESULT',
        result: sliceResult,
      });

      projectDispatch({
        type: 'SET_GCODE_RESULT',
        result: gcodeResult,
      });
      projectDispatch({ type: 'SET_STEP', step: 'ready' });

      const contentRes = await getGcodeContent(filename);
      const gcodeInfo = {
        filename,
        original_name: filename,
        total_lines: contentRes.content.split('\n').length,
        total_layers: (contentRes.content.match(/;LAYER:\s*\d+|; Layer \d+/gi) || []).length,
        has_magnetic: false,
        mag_on_count: 0,
        mag_off_count: 0,
      };
      projectDispatch({ type: 'SET_GCODE_CONTENT', content: contentRes.content });
      projectDispatch({ type: 'SET_GCODE_INFO', info: gcodeInfo });
      await persistExistingProject({
        step: 'ready',
        sliceResult,
        gcodeResult,
        gcodeInfo,
      });
      setActivePreview('gcode');
      setSelectedLayer(null);

    } catch (err: unknown) {
      const detail = normalizeError(err);
      setError(detail);
    } finally {
      setSlicing(false);
    }
  };

  const handleDownload = () => {
    const url = project.gcodeResult?.download_url || (gcodeInfo ? downloadGcodeUrl(gcodeInfo.filename) : null);
    if (url) window.open(url, '_blank');
  };

  const handleGoToDevice = () => {
    if (!project.gcodeResult) return;
    navigate('/device');
  };

  const handleCancelProcessing = async () => {
    pipelineCancelledRef.current = true;
    if (activeProcessTaskId) {
      await cancelProcess4DTask(activeProcessTaskId).catch(() => undefined);
    }
    setSlicing(false);
    setRunningPipeline(false);
    setActiveProcessTaskId(null);
    setProcessProgress(0);
    setProcessStatusText('已取消当前切片任务');
    projectDispatch({ type: 'SET_STEP', step: project.gcodeResult ? 'ready' : 'annotated' });
  };

  const handleSaveProject = async () => {
    if (!canPreviewModel && !canPreviewGcode) {
      showToast('当前没有可保存的项目', 'error');
      return;
    }
    setSavingProject(true);
    try {
      const payload = buildProjectPayload();
      if (project.projectId) {
        await updateProject(project.projectId, payload);
        showToast('项目已更新', 'success');
      } else {
        const created = await createProject(payload);
        projectDispatch({ type: 'SET_PROJECT_ID', projectId: created.id });
        showToast('项目已保存到项目中心', 'success');
      }
    } catch {
      showToast('保存项目失败，请稍后重试', 'error');
    } finally {
      setSavingProject(false);
    }
  };

  const stepIndex = pipelineSteps.findIndex((s) => s.key === (project.step === 'ready' ? 'ready' : project.step));
  const modelProcessSummary = project.modelResult?.continuous_model
    ? '连续模型'
    : project.splitResult
      ? `${project.splitResult.split_count} 个分件`
      : '—';

  const gcodeMetrics = useMemo(() => {
    const content = gcodeContent;
    const totalLines = gcodeInfo?.total_lines ?? project.gcodeResult?.stats.total_lines ?? (content ? content.split('\n').length : 0);
    const totalLayers = gcodeInfo?.total_layers ?? (content ? (content.match(/;LAYER:\s*\d+|; Layer \d+/gi) || []).length : 0);
    const nozzleTemp = firstNumericMatch(content, /M(?:104|109)\s+S([\d.]+)/i);
    const bedTemp = firstNumericMatch(content, /M(?:140|190)\s+S([\d.]+)/i);
    const estimatedSeconds = firstNumericMatch(content, /;\s*(?:TIME|estimated printing time).*?(\d+)/i);
    const filamentMeters = firstNumericMatch(content, /;\s*Filament used:\s*([\d.]+)\s*m/i);
    return { totalLines, totalLayers, nozzleTemp, bedTemp, estimatedSeconds, filamentMeters };
  }, [gcodeContent, gcodeInfo, project.gcodeResult]);

  const analysisContent = editMode ? editContent : gcodeContent;
  const analysisPreviewContent = useMemo(() => {
    if (analysisContent.length <= MAX_ANALYSIS_PREVIEW_CHARS) return analysisContent;
    return analysisContent.slice(0, MAX_ANALYSIS_PREVIEW_CHARS);
  }, [analysisContent]);
  const magProgram = useMemo(() => parseMagProgram(analysisContent), [analysisContent]);
  const hiddenAnalysisChars = Math.max(0, analysisContent.length - analysisPreviewContent.length);
  const analysisMetrics = useMemo(() => {
    const totalLines = analysisContent ? analysisContent.split(/\r?\n/).length : 0;
    const totalLayers = magProgram.layerCount || gcodeMetrics.totalLayers;
    return {
      totalLines,
      totalLayers,
      magOnCount: magProgram.magOnCount,
      magOffCount: magProgram.magOffCount,
      balanced: magProgram.balanced,
      nozzleTemp: magProgram.nozzleTemp,
      bedTemp: magProgram.bedTemp,
      estimatedSeconds: magProgram.estimatedSeconds,
    };
  }, [analysisContent, gcodeMetrics.totalLayers, magProgram]);

  const maxLayerIndex = Math.max(0, gcodeMetrics.totalLayers - 1);

  useEffect(() => {
    setSelectedLayer((layer) => layer === null ? null : Math.min(layer, maxLayerIndex));
  }, [maxLayerIndex]);

  const resetPreviewView = () => {
    setViewPreset('perspective');
    setViewResetSignal((signal) => signal + 1);
  };

  const qualityLabel = qualityOptions.find((option) => option.value === project.qualityPreset)?.label ?? project.qualityPreset;
  const currentStage = project.step === 'processing'
    ? '处理中'
    : project.step === 'slicing'
      ? '切片中'
      : pipelineSteps[Math.max(0, stepIndex)]?.label ?? '待开始';
  const sourceName = project.sourceFile?.name || project.modelName || currentFilename || '未选择文件';
  const sourceFormat = project.sourceFile?.format || getFileExtension(sourceName).toUpperCase() || '—';
  const hasProcessData = project.regions.length > 0 || project.volumeRegions.length > 0 || Boolean(project.surfacePaintGrid) || Boolean(project.gridMagnetization && Object.keys(project.gridMagnetization.activeCells).length > 0) || Object.keys(project.paintData || {}).length > 0;
  const shouldProcessMagnetic = inputType === 'ai_project' || Boolean(project.gridMagnetization && Object.keys(project.gridMagnetization.activeCells).length > 0) || project.regions.length > 0 || project.volumeRegions.length > 0 || Boolean(project.surfacePaintGrid) || Object.keys(project.paintData || {}).length > 0;
  const primaryActionLabel = runningPipeline ? '处理中...' : slicing ? '切片中...' : inputType === 'ai_project' ? '一键处理' : '一键切片';
  const estimatedDurationLabel = formatDurationLabel(gcodeMetrics.estimatedSeconds);
  const layerShellTop = gcodeContent && gcodeMetrics.totalLayers > 0 ? `${gcodeMetrics.totalLayers}` : '100%';
  const previewSummaryLabel = activePreview === 'analysis' ? '代码分析' : activePreview === 'gcode' ? '切片路径预览' : '3D 模型预览';
  void modelProcessSummary;
  void qualityLabel;
  void currentStage;
  void sourceFormat;
  void hasProcessData;
  void primaryActionLabel;
  void estimatedDurationLabel;
  void layerShellTop;
  void previewSummaryLabel;
  const recentFiles: { name: string; meta: string; size: string }[] = [];
  if (project.modelName || project.sourceFile?.name) {
    recentFiles.push({ name: project.modelName || project.sourceFile?.name || '模型文件', meta: sourceLabel(inputType), size: formatBytes(project.sourceFile?.size) });
  }
  if (gcodeInfo) {
    recentFiles.push({ name: gcodeInfo.original_name, meta: `${gcodeMetrics.totalLayers || '—'} 层`, size: `${gcodeMetrics.totalLines || '—'} 行` });
  }
  if (currentFilename && !recentFiles.some((file) => file.name === currentFilename)) {
    recentFiles.push({ name: currentFilename, meta: '输出 G-code', size: project.gcodeResult ? `${project.gcodeResult.stats.mag_on_count} MAG_ON` : '—' });
  }
  return (
    <div className={`gcode-workbench-page page-enter ${mobilePanel ? `mobile-panel-${mobilePanel}` : ''}`} style={{ height: '100%' }}>
      <div className="route-shell__rail route-shell__rail--wide gcode-workbench-rail" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 0, gap: 0, background: 'var(--bg-page)' }}>
        {mobilePanel && (
          <div className="mobile-panel-backdrop gcode-mobile-backdrop" aria-hidden="true" onClick={() => setMobilePanel(null)} />
        )}
        
        {/* 1. Header (Compact) */}
        <header className="gcode-workbench-header" style={{ 
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
          padding: '12px 24px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)',
          flexShrink: 0 
        }}>
          <div className="gcode-workbench-title-group" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>G-code 处理工作台</h1>
            <div style={{ width: '1px', height: '20px', background: 'var(--border-light)' }} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>导入模型，配置打印参数并生成可执行 G-code</span>
          </div>
          <div className="gcode-workbench-header-right" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="gcode-mobile-header-actions" aria-label="G-code mobile tools">
              <button
                type="button"
                aria-expanded={mobilePanel === 'config'}
                aria-controls="gcode-config-panel"
                className={mobilePanel === 'config' ? 'is-active' : ''}
                onClick={() => setMobilePanel('config')}
              >
                参数
              </button>
              <button
                type="button"
                aria-expanded={mobilePanel === 'actions'}
                aria-controls="gcode-action-panel"
                className={mobilePanel === 'actions' ? 'is-active' : ''}
                onClick={() => setMobilePanel('actions')}
              >
                操作
              </button>
            </div>
            <div style={{ 
              display: 'flex', alignItems: 'center', gap: '6px', 
              padding: '4px 10px', background: 'var(--bg-secondary)', borderRadius: '999px',
              fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' 
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: canPreviewModel || canPreviewGcode ? '#10B981' : '#F59E0B' }} />
              {canPreviewGcode ? '已生成 G-code' : canPreviewModel ? '模型已导入' : '未导入模型'}
            </div>
            <button onClick={() => modelInputRef.current?.click()} style={{
              background: 'var(--primary)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 6px rgba(255,140,66,0.2)'
            }}>导入模型</button>
          </div>
        </header>

        {error && (
          <div style={{ margin: '12px 24px 0', padding: '10px 16px', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', borderRadius: '6px', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
            <span>{error}</span>
            <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#B91C1C', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* 2. Main Workspace Body */}
        <div className="gcode-workbench-body" style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: '16px 24px', gap: '20px' }}>
          
          {/* Left Parameter Panel */}
          <aside id="gcode-config-panel" className="gcode-config-panel" style={{ 
            width: '300px', flexShrink: 0, background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-light)', 
            display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.03)'
          }}>
            <div className="mobile-panel-head gcode-mobile-panel-head">
              <div>
                <strong>切片参数</strong>
                <span>打印机、材料、质量与高级选项</span>
              </div>
              <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
            </div>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border-light)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              参数配置
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
              
              <details open style={{ marginBottom: '12px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                <summary style={{ padding: '10px 12px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', outline: 'none', userSelect: 'none', color: 'var(--text-secondary)' }}>1. 项目信息</summary>
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-tertiary)' }}>项目名称</span><span style={{ color: 'var(--text-primary)', fontWeight: 500, maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.modelName || currentFilename || (canPreviewModel || canPreviewGcode ? '未命名' : '等待导入')}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-tertiary)' }}>文件体积</span><span style={{ color: 'var(--text-primary)' }}>{canPreviewModel || canPreviewGcode ? formatBytes(project.sourceFile?.size) : '—'}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-tertiary)' }}>当前状态</span><span style={{ color: 'var(--text-primary)' }}>{canPreviewGcode ? '已切片' : canPreviewModel ? '已导入' : '未导入'}</span></div>
                </div>
              </details>

              <details open style={{ marginBottom: '12px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                <summary style={{ padding: '10px 12px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', outline: 'none', userSelect: 'none', color: 'var(--text-secondary)' }}>2. 打印机</summary>
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>打印机型号</label>
                    <select disabled={!canPreviewModel && !canPreviewGcode} value={project.printerProfile} onChange={e => projectDispatch({ type: 'SET_PRINTER_CONFIG', printerProfile: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', fontSize: '0.8rem', background: 'var(--bg-page)', outline: 'none', color: 'var(--text-primary)' }}>
                      {!canPreviewModel && !canPreviewGcode && <option>等待模型导入</option>}
                      {canPreviewModel || canPreviewGcode ? printerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>) : null}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>喷嘴直径</label>
                      <input disabled value={canPreviewModel || canPreviewGcode ? '0.4 mm' : '—'} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', fontSize: '0.8rem', background: 'var(--bg-page)', color: 'var(--text-secondary)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>打印区域</label>
                      <input disabled value={canPreviewModel || canPreviewGcode ? `${printerBed.width}×${printerBed.depth}×${printerBed.height}` : '—'} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', fontSize: '0.8rem', background: 'var(--bg-page)', color: 'var(--text-secondary)' }} />
                    </div>
                  </div>
                </div>
              </details>

              <details open style={{ marginBottom: '12px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                <summary style={{ padding: '10px 12px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', outline: 'none', userSelect: 'none', color: 'var(--text-secondary)' }}>3. 网格磁化</summary>
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>网格平面与当前打印床一致：{printerBed.width} × {printerBed.depth} mm；模型会自动放置在床面中心。</div>
                  <button type="button" disabled={!canPreviewModel} onClick={() => setBottomFaceSelectionMode((active) => !active)} style={{ padding: '7px 8px', border: bottomFaceSelectionMode ? '1px solid #0F766E' : '1px solid var(--border-medium)', borderRadius: '5px', background: bottomFaceSelectionMode ? '#CCFBF1' : 'var(--bg-page)', color: bottomFaceSelectionMode ? '#0F766E' : 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: 700, cursor: canPreviewModel ? 'pointer' : 'not-allowed' }}>{bottomFaceSelectionMode ? '请在模型上点击要贴床的面' : '选择底面并放置'}</button>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                    网格边长（mm）
                    <input disabled={!canPreviewModel} type="number" min="0.1" step="0.1" value={gridCellSize} onChange={(event) => setGridCellSize(Math.max(0.1, Number(event.target.value) || 0.1))} style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                  </label>
                  <button type="button" disabled={!canPreviewModel || !modelBounds} onClick={createGrid} style={{ padding: '7px 8px', border: 'none', borderRadius: '5px', background: 'var(--primary)', color: '#fff', fontSize: '0.78rem', fontWeight: 700, cursor: canPreviewModel && modelBounds ? 'pointer' : 'not-allowed', opacity: canPreviewModel && modelBounds ? 1 : 0.55 }}>{project.gridMagnetization ? '重新生成网格' : '生成规则网格'}</button>
                  {project.gridMagnetization && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}><span>单元数</span><strong style={{ color: 'var(--text-primary)' }}>{gridCellCount(project.gridMagnetization.dimensions).toLocaleString()}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}><span>已磁化 / 已选择</span><strong style={{ color: 'var(--text-primary)' }}>{Object.keys(project.gridMagnetization.activeCells).length} / {selectedGridCells.size}</strong></div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.78rem', color: 'var(--text-primary)' }}><input type="checkbox" checked={gridVisible} onChange={(event) => setGridVisible(event.target.checked)} /> 显示网格覆盖层</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '6px', border: '1px solid var(--border-medium)', borderRadius: '5px', background: 'var(--bg-page)' }}>
                        {([['click', '单击'], ['box', '框选'], ['lasso', '套索'], ['brush', '刷选']] as const).map(([mode, label]) => (
                          <button key={mode} type="button" onClick={() => setGridSelectionMode(mode)} style={{ flex: '1 0 45%', padding: '5px 3px', border: 'none', borderRadius: '4px', background: gridSelectionMode === mode ? 'var(--primary-soft)' : 'transparent', color: gridSelectionMode === mode ? 'var(--primary)' : 'var(--text-secondary)', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>{label}</button>
                        ))}
                        <button type="button" onClick={() => setSelectedGridCells(new Set(allGridCellKeys(project.gridMagnetization)))} style={{ flex: '1 0 45%', padding: '5px 3px', border: 'none', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.7rem', cursor: 'pointer' }}>全选</button>
                        <button type="button" onClick={invertGridSelection} style={{ flex: '1 0 45%', padding: '5px 3px', border: 'none', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.7rem', cursor: 'pointer' }}>反选</button>
                        <button type="button" onClick={() => setSelectedGridCells(new Set())} style={{ flex: '1 0 45%', padding: '5px 3px', border: 'none', background: 'transparent', color: '#B91C1C', fontSize: '0.7rem', cursor: 'pointer' }}>清空选择</button>
                      </div>
                      <div style={{ display: 'flex', gap: '5px', alignItems: 'end' }}>
                        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Z 层
                          <input type="number" min="0" max={project.gridMagnetization.dimensions[2] - 1} step="1" value={gridZLayer} onChange={(event) => setGridZLayer(Math.max(0, Number(event.target.value) || 0))} style={{ padding: '5px 6px', borderRadius: '4px', border: '1px solid var(--border-medium)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                        </label>
                        <button type="button" onClick={selectGridZLayer} style={{ padding: '6px 7px', border: '1px solid var(--border-medium)', borderRadius: '4px', background: 'var(--bg-page)', color: 'var(--text-secondary)', fontSize: '0.7rem', cursor: 'pointer' }}>按 Z 层选择</button>
                      </div>
                      <div style={{ display: 'flex', gap: '5px', alignItems: 'end' }}>
                        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>选择轴
                          <select value={gridAxis} onChange={(event) => setGridAxis(event.target.value as 'X' | 'Y' | 'Z')} style={{ padding: '5px 6px', borderRadius: '4px', border: '1px solid var(--border-medium)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}><option value="X">X 轴</option><option value="Y">Y 轴</option><option value="Z">Z 轴</option></select>
                        </label>
                        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>层索引
                          <input type="number" min="0" step="1" value={gridAxisLayer} onChange={(event) => setGridAxisLayer(Math.max(0, Number(event.target.value) || 0))} style={{ padding: '5px 6px', borderRadius: '4px', border: '1px solid var(--border-medium)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                        </label>
                        <button type="button" onClick={selectGridAxisLayer} style={{ padding: '6px 7px', border: '1px solid var(--border-medium)', borderRadius: '4px', background: 'var(--bg-page)', color: 'var(--text-secondary)', fontSize: '0.7rem', cursor: 'pointer' }}>选择切片</button>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button type="button" onClick={() => setSelectedGridCells(new Set(Object.keys(project.gridMagnetization.activeCells)))} style={{ flex: 1, padding: '6px 4px', border: '1px solid var(--border-medium)', borderRadius: '4px', background: 'var(--bg-page)', color: 'var(--text-secondary)', fontSize: '0.72rem', cursor: 'pointer' }}>选择已磁化</button>
                      </div>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        磁化强度（可输入任意非负值）
                        <div style={{ display: 'flex', gap: '5px' }}><input type="number" min="0" step="any" value={gridStrength} onChange={(event) => setGridStrength(Math.max(0, Number(event.target.value) || 0))} style={{ flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} /><select value={gridStrengthUnit} onChange={(event) => setGridStrengthUnit(event.target.value as 'mT' | 'T')} style={{ width: '58px', padding: '6px 3px', borderRadius: '4px', border: '1px solid var(--border-medium)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}><option value="mT">mT</option><option value="T">T</option></select></div>
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        磁场方向
                        <select value={gridDirection} onChange={(event) => setGridDirection(event.target.value as GridMagnetDirection)} style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                          {['X+', 'X-', 'Y+', 'Y-', 'Z+', 'Z-'].map((direction) => <option key={direction} value={direction}>{direction}</option>)}
                        </select>
                      </label>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button type="button" disabled={selectedGridCells.size === 0} onClick={applyGridMagnetization} style={{ flex: 1, padding: '7px 4px', border: 'none', borderRadius: '4px', background: '#0F766E', color: '#fff', fontSize: '0.72rem', fontWeight: 700, cursor: selectedGridCells.size ? 'pointer' : 'not-allowed', opacity: selectedGridCells.size ? 1 : 0.5 }}>应用磁场</button>
                        <button type="button" disabled={selectedGridCells.size === 0} onClick={clearGridMagnetization} style={{ flex: 1, padding: '7px 4px', border: '1px solid #FCA5A5', borderRadius: '4px', background: '#FEF2F2', color: '#B91C1C', fontSize: '0.72rem', cursor: selectedGridCells.size ? 'pointer' : 'not-allowed', opacity: selectedGridCells.size ? 1 : 0.5 }}>取消磁化</button>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>按住 Shift 后再点击或拖动选择网格单元；不按 Shift 时，鼠标用于旋转和移动三维预览。</div>
                    </>
                  )}
                </div>
              </details>

              <details open style={{ marginBottom: '12px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                <summary style={{ padding: '10px 12px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', outline: 'none', userSelect: 'none', color: 'var(--text-secondary)' }}>4. 材料</summary>
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>材料类型</label>
                    <select disabled={!canPreviewModel && !canPreviewGcode} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', fontSize: '0.8rem', background: 'var(--bg-page)', outline: 'none', color: 'var(--text-primary)' }}>
                      {!canPreviewModel && !canPreviewGcode && <option>等待模型导入</option>}
                      {canPreviewModel || canPreviewGcode ? <><option>PLA</option><option>PETG</option><option>ABS</option></> : null}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>喷嘴温度</label>
                      <input disabled value={canPreviewModel || canPreviewGcode ? (gcodeMetrics.nozzleTemp ? `${gcodeMetrics.nozzleTemp}°C` : '210°C') : '—'} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', fontSize: '0.8rem', background: 'var(--bg-page)', color: 'var(--text-secondary)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>热床温度</label>
                      <input disabled value={canPreviewModel || canPreviewGcode ? (gcodeMetrics.bedTemp ? `${gcodeMetrics.bedTemp}°C` : '60°C') : '—'} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', fontSize: '0.8rem', background: 'var(--bg-page)', color: 'var(--text-secondary)' }} />
                    </div>
                  </div>
                </div>
              </details>

              <details open style={{ marginBottom: '12px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                <summary style={{ padding: '10px 12px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', outline: 'none', userSelect: 'none', color: 'var(--text-secondary)' }}>5. 质量</summary>
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '4px', padding: '4px', background: 'var(--bg-page)', borderRadius: '4px', border: '1px solid var(--border-medium)' }}>
                    {qualityChips.map(chip => (
                      <button key={chip.value} disabled={!canPreviewModel && !canPreviewGcode} onClick={() => projectDispatch({ type: 'SET_PRINTER_CONFIG', qualityPreset: chip.value })} style={{
                        flex: 1, padding: '4px 0', border: 'none', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, cursor: (!canPreviewModel && !canPreviewGcode) ? 'not-allowed' : 'pointer',
                        background: project.qualityPreset === chip.value ? 'var(--primary-soft)' : 'transparent',
                        color: project.qualityPreset === chip.value ? 'var(--primary)' : 'var(--text-tertiary)'
                      }}>{chip.label}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>层高</label>
                      <input disabled value={canPreviewModel || canPreviewGcode ? project.qualityPreset : '—'} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', fontSize: '0.8rem', background: 'var(--bg-page)', color: 'var(--text-secondary)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>壁厚/填充</label>
                      <input disabled value={canPreviewModel || canPreviewGcode ? '3 层 / 15%' : '—'} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', fontSize: '0.8rem', background: 'var(--bg-page)', color: 'var(--text-secondary)' }} />
                    </div>
                  </div>
                </div>
              </details>

              <details open style={{ marginBottom: '12px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                <summary style={{ padding: '10px 12px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', outline: 'none', userSelect: 'none', color: 'var(--text-secondary)' }}>6. 支撑与粘附</summary>
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                    <input type="checkbox" disabled={!canPreviewModel && !canPreviewGcode} /> 开启支撑
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>支撑类型</label>
                    <select disabled={!canPreviewModel && !canPreviewGcode} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', fontSize: '0.8rem', background: 'var(--bg-page)', outline: 'none', color: 'var(--text-primary)' }}>
                      {!canPreviewModel && !canPreviewGcode ? <option>等待模型导入</option> : <><option>仅接触构建板</option><option>到处</option></>}
                    </select>
                  </div>
                </div>
              </details>

              <details style={{ background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                <summary style={{ padding: '10px 12px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', outline: 'none', userSelect: 'none', color: 'var(--text-secondary)' }}>7. 高级设置</summary>
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                   <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>高级参数(速度、回抽、冷却等)将在切片生成后自动同步。</p>
                </div>
              </details>

            </div>
          </aside>

          {/* Middle Main Preview */}
          <main className="gcode-preview-shell-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-light)', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
            
            {/* Main Toolbar */}
            <div className="gcode-preview-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
              <div className="gcode-preview-mode-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button onClick={() => modelInputRef.current?.click()} style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid var(--border-medium)', background: 'var(--bg-page)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  {canPreviewModel || canPreviewGcode ? '重新导入' : '导入模型'}
                </button>
                <div style={{ width: 1, height: 16, background: 'var(--border-medium)', margin: '0 4px' }} />
                <div className="gcode-preview-mode-tabs" role="group" aria-label="预览模式" style={{ display: 'flex', background: 'var(--bg-page)', padding: '2px', borderRadius: '4px', border: '1px solid var(--border-medium)' }}>
                  <button disabled={!canPreviewModel} aria-pressed={activePreview === 'model'} onClick={() => setActivePreview('model')} style={{ padding: '4px 12px', borderRadius: '3px', border: 'none', background: activePreview === 'model' ? 'var(--bg-secondary)' : 'transparent', color: activePreview === 'model' ? 'var(--text-primary)' : 'var(--text-tertiary)', fontSize: '0.8rem', fontWeight: 600, cursor: canPreviewModel ? 'pointer' : 'not-allowed', boxShadow: activePreview === 'model' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>
                    3D 模型
                  </button>
                  <button disabled={!canPreviewGcode} aria-pressed={activePreview === 'gcode'} onClick={() => setActivePreview('gcode')} style={{ padding: '4px 12px', borderRadius: '3px', border: 'none', background: activePreview === 'gcode' ? 'var(--bg-secondary)' : 'transparent', color: activePreview === 'gcode' ? 'var(--text-primary)' : 'var(--text-tertiary)', fontSize: '0.8rem', fontWeight: 600, cursor: canPreviewGcode ? 'pointer' : 'not-allowed', boxShadow: activePreview === 'gcode' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>
                    打印路径
                  </button>
                  <button disabled={!canPreviewGcode} aria-pressed={activePreview === 'analysis'} onClick={() => setActivePreview('analysis')} style={{ padding: '4px 12px', borderRadius: '3px', border: 'none', background: activePreview === 'analysis' ? 'var(--bg-secondary)' : 'transparent', color: activePreview === 'analysis' ? 'var(--text-primary)' : 'var(--text-tertiary)', fontSize: '0.8rem', fontWeight: 600, cursor: canPreviewGcode ? 'pointer' : 'not-allowed', boxShadow: activePreview === 'analysis' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>
                    代码分析
                  </button>
                </div>
              </div>

              {/* View Controls */}
              {activePreview === 'gcode' && canPreviewGcode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <select value={showTravel ? 'all' : 'extrusion'} onChange={e => setShowTravel(e.target.value === 'all')} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', fontSize: '0.75rem', background: 'var(--bg-page)', outline: 'none' }}>
                    <option value="extrusion">仅挤出路径</option>
                    <option value="all">显示空走</option>
                  </select>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => setShowGrid(!showGrid)} title="切换网格" style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: showGrid ? 'var(--primary-soft)' : 'transparent', color: showGrid ? 'var(--primary)' : 'var(--text-secondary)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>网</button>
                    <button onClick={() => setShowAxes(!showAxes)} title="切换坐标轴" style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: showAxes ? 'var(--primary-soft)' : 'transparent', color: showAxes ? 'var(--primary)' : 'var(--text-secondary)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>轴</button>
                    <button onClick={resetPreviewView} title="重置视角" style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: 'var(--text-secondary)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>居</button>
                  </div>
                  <select value={viewPreset} onChange={e => setViewPreset(e.target.value as GcodeViewPreset)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-medium)', fontSize: '0.75rem', background: 'var(--bg-page)', outline: 'none' }}>
                    {viewPresetOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Canvas Area */}
            <div style={{ flex: 1, position: 'relative', background: '#f8f9fa' }}>
              {loading && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  background: 'rgba(248,249,250,0.9)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                }}>
                  <div className="loading-spinner" />
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {processStatusText || '正在加载文件...'}
                  </div>
                </div>
              )}
              {(!canPreviewModel && !canPreviewGcode) ? (
                <div className="gcode-empty-preview" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <div style={{ width: 56, height: 56, background: 'var(--bg-tertiary)', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                  </div>
                  <h3 style={{ fontSize: '1.15rem', margin: '0 0 8px', color: 'var(--text-primary)', fontWeight: 600 }}>请先导入 3D 模型</h3>
                  <p style={{ margin: '0 0 24px', fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>支持 STL、OBJ、3MF、GLB 等格式，或直接上传 G-code</p>
                  <div className="gcode-empty-actions" style={{ display: 'flex', gap: '12px' }}>
                    <button className="gcode-import-card primary" onClick={() => modelInputRef.current?.click()} style={{ background: 'var(--primary)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(255,140,66,0.25)', transition: 'transform 0.1s' }}>
                      <span className="gcode-import-card-title">本地导入模型</span>
                      <span className="gcode-import-card-desc">STL / OBJ / 3MF / GLB</span>
                    </button>
                    <button className="gcode-import-card" onClick={() => fileInputRef.current?.click()} style={{ background: 'var(--bg-page)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)', padding: '10px 20px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                      <span className="gcode-import-card-title">导入 G-code</span>
                      <span className="gcode-import-card-desc">直接预览或编辑</span>
                    </button>
                    <button className="gcode-import-card" onClick={() => navigate('/models')} style={{ background: 'var(--bg-page)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)', padding: '10px 20px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                      <span className="gcode-import-card-title">从模型库选择</span>
                      <span className="gcode-import-card-desc">使用社区模型</span>
                    </button>
                    <button className="gcode-import-card" onClick={() => navigate('/ai')} style={{ background: 'var(--bg-page)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)', padding: '10px 20px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                      <span className="gcode-import-card-title">从 AI 创作导入</span>
                      <span className="gcode-import-card-desc">继续生成结果</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
                  <React.Suspense fallback={<PreviewLoadingFallback />}>
                    {activePreview === 'model' && canPreviewModel && (
                      <ModelPreviewPanel
                        modelUrl={project.modelUrl!}
                        showGrid={showGrid}
                        showAxes={showAxes}
                        viewPreset={viewPreset}
                        viewResetSignal={viewResetSignal}
                        gridMagnetization={project.gridMagnetization}
                        gridVisible={gridVisible}
                        selectedGridCells={selectedGridCells}
                        onGridCellToggle={toggleGridCell}
                        onGridBounds={handleGridBounds}
                        printerBed={printerBed}
                        bottomFaceSelectionMode={bottomFaceSelectionMode}
                        gridSelectionMode={gridSelectionMode}
                        onGridCellsSelect={selectGridCells}
                        validGridCellKeys={validGridCellKeys}
                        onValidGridCells={handleValidGridCells}
                        onBottomFaceSelected={(rotation) => {
                          setModelRotation(rotation);
                          setBottomFaceSelectionMode(false);
                          setGridVisible(false);
                          showToast('已将所选面放置到打印床上，请重新生成网格', 'success');
                        }}
                        modelRotation={modelRotation}
                      />
                    )}
                    {activePreview === 'gcode' && canPreviewGcode && (
                      <GcodePreviewPanel gcodeContent={gcodeContent} showTravel={showTravel} currentLayer={selectedLayer} showGrid={showGrid} showAxes={showAxes} viewPreset={viewPreset} viewResetSignal={viewResetSignal} />
                    )}
                  </React.Suspense>
                  {activePreview === 'analysis' && canPreviewGcode && (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-page)' }}>
                      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--bg-card)', flexShrink: 0 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>G-code 代码分析</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '4px' }}>{editMode ? '编辑草稿实时分析，保存后同步到项目状态' : '查看当前文件的结构、磁场指令和打印前校验'}</div>
                        </div>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
                          {editMode && (
                            <button type="button" onClick={handleCancelEdit} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-medium)', background: 'var(--bg-page)', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}>
                              取消编辑
                            </button>
                          )}
                          <button type="button" onClick={handleSaveOrEdit} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--primary)', color: 'var(--text-light)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(255,140,66,0.25)', transition: 'all 0.15s' }}>
                            {editMode ? '保存代码' : '编辑代码'}
                          </button>
                        </div>
                      </div>

                      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '20px', display: 'grid', gridTemplateColumns: 'minmax(300px, 0.4fr) minmax(460px, 1fr)', gap: '20px' }}>
                        <section aria-label="G-code 指标" style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
                            {[
                              { label: '总行数', value: analysisMetrics.totalLines || '—' },
                              { label: '总层数', value: analysisMetrics.totalLayers || '—' },
                              { label: 'MAG_ON', value: analysisMetrics.magOnCount },
                              { label: 'MAG_OFF', value: analysisMetrics.magOffCount },
                              { label: '指令配对', value: analysisMetrics.balanced ? '平衡' : '需检查' },
                              { label: '预计时间', value: formatDurationLabel(analysisMetrics.estimatedSeconds) },
                              { label: '喷嘴温度', value: analysisMetrics.nozzleTemp !== null ? `${analysisMetrics.nozzleTemp}°C` : '待解析' },
                              { label: '热床温度', value: analysisMetrics.bedTemp !== null ? `${analysisMetrics.bedTemp}°C` : '待解析' },
                            ].map((item) => (
                              <div key={item.label} style={{ padding: '14px 16px', borderRadius: '10px', background: 'var(--bg-card)', border: '1px solid var(--border-light)', boxShadow: '0 2px 8px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>{item.label}</div>
                                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: item.label === '指令配对' && !analysisMetrics.balanced ? 'var(--warning)' : 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>{item.value}</div>
                              </div>
                            ))}
                          </div>

                          <div style={{ borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-light)', boxShadow: '0 2px 10px rgba(0,0,0,0.03)', overflow: 'hidden' }}>
                            <MagTimeline gcodeContent={analysisContent} program={magProgram} />
                          </div>

                          <div style={{ borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-light)', boxShadow: '0 2px 10px rgba(0,0,0,0.03)', overflow: 'hidden' }}>
                            <PrePrintCheck gcodeContent={analysisContent} program={magProgram} expectsMagnetic={inputType === 'ai_project'} printerProfile={project.printerProfile} />
                          </div>
                        </section>

                        <section aria-label="G-code 代码面板" style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-light)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexShrink: 0, background: 'var(--bg-card)' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)' }}>代码内容</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600, padding: '4px 10px', background: 'var(--bg-page)', borderRadius: '6px' }}>{editMode ? '可编辑' : '只读预览'}</span>
                          </div>
                          {analysisContent.trim() ? (
                            editMode ? (
                              <textarea
                                aria-label="编辑 G-code 内容"
                                value={editContent}
                                onChange={(event) => setEditContent(event.target.value)}
                                spellCheck={false}
                                style={{ flex: 1, minHeight: '420px', width: '100%', resize: 'none', border: 'none', outline: 'none', padding: '20px', background: '#1E1E1E', color: '#D4D4D4', fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace", fontSize: '0.85rem', lineHeight: 1.6, overflow: 'auto', whiteSpace: 'pre' }}
                              />
                            ) : (
                              <>
                                {hiddenAnalysisChars > 0 && (
                                  <div style={{ padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#252526', color: '#C8C8C8', fontSize: '0.78rem', fontWeight: 600 }}>
                                    只显示前 {analysisPreviewContent.length.toLocaleString()} 个字符，已省略 {hiddenAnalysisChars.toLocaleString()} 个字符；指标和磁场分析仍基于完整 G-code。
                                  </div>
                                )}
                                <pre aria-label="当前 G-code 内容" style={{ flex: 1, minHeight: '420px', margin: 0, padding: '20px', background: '#1E1E1E', color: '#D4D4D4', fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace", fontSize: '0.85rem', lineHeight: 1.6, overflow: 'auto', whiteSpace: 'pre' }}>{analysisPreviewContent}</pre>
                              </>
                            )
                          ) : (
                            <div style={{ flex: 1, minHeight: '420px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: '0.9rem', padding: '32px', textAlign: 'center', background: '#fafafa' }}>
                              暂无可分析的 G-code 内容。
                            </div>
                          )}
                        </section>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Layer Slider for G-code */}
              {activePreview === 'gcode' && canPreviewGcode && gcodeMetrics.totalLayers > 0 && (
                <div aria-label="层预览" style={{ position: 'absolute', left: '50%', bottom: '58px', transform: 'translateX(-50%)', maxWidth: 'calc(100% - 32px)', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.92)', padding: '8px 10px', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-light)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 10 }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>层预览</span>
                  <div role="group" aria-label="层预览模式" style={{ display: 'flex', gap: '4px', padding: '2px', background: 'var(--bg-page)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)' }}>
                    <button type="button" aria-label="显示全部层" aria-pressed={selectedLayer === null} onClick={() => setSelectedLayer(null)} style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', background: selectedLayer === null ? 'var(--primary-soft)' : 'transparent', color: selectedLayer === null ? 'var(--primary)' : 'var(--text-tertiary)', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>全部</button>
                    <button type="button" aria-label="显示单层" aria-pressed={selectedLayer !== null} onClick={() => setSelectedLayer((layer) => layer === null ? 0 : layer)} style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', background: selectedLayer !== null ? 'var(--primary-soft)' : 'transparent', color: selectedLayer !== null ? 'var(--primary)' : 'var(--text-tertiary)', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>单层</button>
                  </div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{selectedLayer === null ? `全部 ${gcodeMetrics.totalLayers} 层` : `${selectedLayer} / ${maxLayerIndex}`}</span>
                  {selectedLayer !== null && (
                    <input type="range" aria-label="选择预览层" min={0} max={maxLayerIndex} value={selectedLayer} onChange={e => setSelectedLayer(Number(e.target.value))} style={{ width: '180px', maxWidth: '28vw', minWidth: '96px', cursor: 'pointer', accentColor: 'var(--primary)' }} />
                  )}
                </div>
              )}
            </div>
          </main>
        </div>

        {/* 3. Bottom Status Bar */}
        <footer id="gcode-action-panel" className="gcode-action-panel" style={{ 
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
          padding: '12px 24px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-light)',
          flexShrink: 0, gap: '20px'
        }}>
          <div className="mobile-panel-head gcode-mobile-panel-head">
            <div>
              <strong>处理与导出</strong>
              <span>切片进度、保存、下载和发送到设备</span>
            </div>
            <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
          </div>
          {/* Left: Status & Logs */}
          <div className="gcode-action-status" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <strong style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                {!canPreviewModel && !canPreviewGcode ? '未导入模型' : slicing || runningPipeline ? '切片中' : canPreviewGcode ? 'G-code 已生成' : '等待切片'}
              </strong>
              {(slicing || runningPipeline) && (
                <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>{processProgress}%</span>
              )}
              {canPreviewGcode && gcodeMetrics.estimatedSeconds && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>
                  预计打印时长: {formatDurationLabel(gcodeMetrics.estimatedSeconds)}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {!canPreviewModel && !canPreviewGcode ? '请先导入 3D 模型' : 
               (slicing || runningPipeline) ? (processStatusText || '正在生成...') :
               canPreviewGcode ? '切片完成，请导出 G-code 或发送至设备' : '已配置打印参数，准备开始切片'}
            </div>
          </div>

          {/* Middle: Steps */}
          <div className="gcode-action-steps" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-page)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
            {[
              { label: '导入模型', active: true, done: canPreviewModel || canPreviewGcode },
              { label: '配置参数', active: canPreviewModel || canPreviewGcode, done: canPreviewGcode || slicing || runningPipeline },
              { label: '开始切片', active: (canPreviewModel || canPreviewGcode) && !slicing && !runningPipeline, done: canPreviewGcode },
              { label: '导出 G-code', active: canPreviewGcode, done: false }
            ].map((step, i, arr) => (
              <React.Fragment key={step.label}>
                <div style={{ 
                  display: 'flex', alignItems: 'center', gap: '6px', 
                  color: step.active ? (step.done ? '#10B981' : 'var(--primary)') : 'var(--text-tertiary)',
                  fontWeight: step.active ? 600 : 500, fontSize: '0.75rem'
                }}>
                  <div style={{ 
                    width: 14, height: 14, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem',
                    background: step.active ? (step.done ? '#D1FAE5' : 'var(--primary-soft)') : 'var(--bg-tertiary)',
                    color: step.active ? (step.done ? '#059669' : 'var(--primary)') : 'var(--text-tertiary)'
                  }}>
                    {step.done ? '✓' : i + 1}
                  </div>
                  {step.label}
                </div>
                {i < arr.length - 1 && <div style={{ width: 12, height: 1, background: 'var(--border-medium)' }} />}
              </React.Fragment>
            ))}
          </div>

          {/* Right: Actions */}
          <div className="gcode-action-buttons" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            {slicing || runningPipeline ? (
              <button onClick={handleCancelProcessing} style={{ background: 'var(--bg-page)', border: '1px solid var(--border-medium)', color: 'var(--text-secondary)', padding: '8px 16px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>取消切片</button>
            ) : (
              <button 
                onClick={shouldProcessMagnetic ? handleRunPipeline : handleSliceOnly}
                disabled={!canPreviewModel}
                style={{ background: !canPreviewModel ? 'var(--bg-tertiary)' : 'var(--primary)', color: !canPreviewModel ? 'var(--text-tertiary)' : '#fff', border: 'none', padding: '8px 20px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: !canPreviewModel ? 'not-allowed' : 'pointer', boxShadow: canPreviewModel ? '0 2px 6px rgba(255,140,66,0.2)' : 'none' }}
              >
                {shouldProcessMagnetic ? '开始切片 (含磁场)' : '开始切片'}
              </button>
            )}
            
            <button 
              onClick={handleDownload}
              disabled={!canPreviewGcode}
              style={{ background: canPreviewGcode ? 'var(--bg-page)' : 'var(--bg-tertiary)', border: `1px solid ${canPreviewGcode ? 'var(--border-medium)' : 'transparent'}`, color: canPreviewGcode ? 'var(--text-primary)' : 'var(--text-tertiary)', padding: '8px 16px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: !canPreviewGcode ? 'not-allowed' : 'pointer' }}
            >
              导出 G-code
            </button>
            <button 
              onClick={handleSaveProject}
              disabled={(!canPreviewModel && !canPreviewGcode) || savingProject}
              style={{ background: (canPreviewModel || canPreviewGcode) && !savingProject ? 'var(--bg-page)' : 'var(--bg-tertiary)', border: `1px solid ${(canPreviewModel || canPreviewGcode) && !savingProject ? 'var(--border-medium)' : 'transparent'}`, color: (canPreviewModel || canPreviewGcode) && !savingProject ? 'var(--text-primary)' : 'var(--text-tertiary)', padding: '8px 16px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: (!canPreviewModel && !canPreviewGcode) || savingProject ? 'not-allowed' : 'pointer' }}
            >
              {savingProject ? '保存中...' : project.projectId ? '更新项目' : '保存项目'}
            </button>
            <button 
              onClick={handleGoToDevice}
              disabled={!canPreviewGcode}
              style={{ background: canPreviewGcode ? 'var(--bg-page)' : 'var(--bg-tertiary)', border: `1px solid ${canPreviewGcode ? 'var(--border-medium)' : 'transparent'}`, color: canPreviewGcode ? 'var(--text-primary)' : 'var(--text-tertiary)', padding: '8px 16px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: !canPreviewGcode ? 'not-allowed' : 'pointer' }}
            >
              发送到设备
            </button>
          </div>
        </footer>

        {/* Hidden inputs */}
        <input ref={modelInputRef} type="file" accept=".glb,.gltf,.obj,.stl,.3mf,.step" style={{ display: 'none' }} onChange={handleUploadModel} />
        <input ref={fileInputRef} type="file" accept=".gcode" style={{ display: 'none' }} onChange={handleUploadGcode} />
      </div>
    </div>
  );
};

export default GcodeEditor;
