import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { InitialAnnotations } from '../components/preview-workspace';
import { FormatDownloadMenu } from '../components/ai-create/FormatDownloadMenu';
import ModelPublishModal from '../components/ModelPublishModal';
import {
  createProject,
  downloadModelProxy,
  getDraftModels,
  getModelFileUrl,
  getTaskStatus,
  imageTo3D,
  textTo3D,
  updateProject,
  uploadTemp,
  type ModelData,
} from '../services/api';
import { useAuth } from '../stores/auth';
import { useToast } from '../stores/toast';
import { useProjectDispatch } from '../stores/project';
import type { Module, VolumeRegion, SurfaceRegion, ProcessRule } from '../components/lib/editor-types';
import type { RegionData, FacePaintData, TaskStatus, MagnetDirection } from '../types';
import { getFileExtension, getFileName } from '../utils/path';

type InputMode = 'image' | 'text' | 'upload';
type QualityTier = 'fast' | 'quality' | 'pro';
type SurfacePaintGridSnapshot = { bbox_min: number[]; bbox_max: number[]; resolution: number; data_b64: string } | null;

const QUALITY_OPTIONS: { key: QualityTier; label: string; desc: string }[] = [
  { key: 'fast', label: '⚡ 快速', desc: '~30秒' },
  { key: 'quality', label: '✨ 均衡', desc: '~1分钟' },
  { key: 'pro', label: '🎯 质量', desc: '3-5分钟' },
];

const AI_DRAFT_STORAGE_PREFIX = 'ai-draft';
type AiDraftStorageKind = 'result' | 'annotations' | 'pending-task';
const PROMPT_MIN_LENGTH = 3;
const PROMPT_MAX_LENGTH = 1024;
const EXAMPLE_PROMPTS = [
  '参数化桌面收纳盒，圆角倒角，分隔槽清晰，适合 PLA 打印，无文字标识',
  '可打印的模块化灯罩，蜂窝透光纹理，壁厚均匀，底部平整，暖白色材质',
  '装配式机械夹具，三件结构，螺丝孔清晰，边缘倒角，适合 0.20mm 层高',
];

const PROMPT_BUILDER_STEPS = ['主体对象', '使用场景', '几何约束', '材料颜色', '打印限制'];

const PROMPT_QUALITY_CHECKS = [
  '一次只描述一个主要对象，避免多个主体互相融合',
  '写清尺寸、用途、平底、壁厚或孔位等打印约束',
  '避免 Logo、品牌名、文字和版权角色',
  '图片参考尽量干净、单物体、背景简单',
];

const MODEL_CATEGORIES = [
  { name: '家居生活', key: 'home' },
  { name: '工具配件', key: 'tool' },
  { name: '艺术装饰', key: 'art' },
  { name: '教育学习', key: 'education' },
  { name: '机械结构', key: '3dprint' },
  { name: '角色模型', key: 'cosplay' },
  { name: '建筑空间', key: 'miniature' },
  { name: 'AI 生成', key: 'ai' },
];

const UPLOAD_REQUIREMENTS = [
  '使用真实打印封面或清晰实物图',
  '补全标题、分类与用途描述',
  '在描述中写明标签、授权或二创来源',
  '提供打印配置、3MF 或可切片模型文件',
  '补充层高、耗材、支撑和装配说明',
];

const PreviewWorkspace = React.lazy(() =>
  import('../components/preview-workspace/PreviewWorkspace').then((module) => ({
    default: module.PreviewWorkspace,
  })),
);

const ViewerLoadingFallback: React.FC = () => (
  <div style={{ height: '100%', minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', background: 'var(--bg-page)' }}>
    <div className="loading-spinner" />
    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>正在加载 3D 工作区...</div>
  </div>
);

const EmptyAiViewer: React.FC<{ message?: string }> = ({ message }) => (
  <div style={{
    width: '100%', height: '100%', minHeight: '300px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(160deg, var(--bg-page) 0%, var(--bg-secondary) 100%)',
  }}>
    <div className="model-viewer-empty-card" style={{ textAlign: 'center' }}>
      <div style={{
        width: 72, height: 72, margin: '0 auto 16px',
        background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)',
        borderRadius: '18px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '24px', color: 'white', fontWeight: 800,
        boxShadow: '0 8px 24px rgba(255, 140, 66, 0.25)',
      }}>
        3D
      </div>
      <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>开始生成你的 3D 模型</div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
        {message || '上传图片、输入描述或直接上传 3D 文件'}
      </p>
    </div>
  </div>
);

interface PendingTaskMetadata {
  taskId: string;
  startedAt: number;
  inputMode?: InputMode;
  prompt?: string;
  qualityTier?: QualityTier;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isInputMode = (value: unknown): value is InputMode =>
  value === 'image' || value === 'text' || value === 'upload';

const isQualityTier = (value: unknown): value is QualityTier =>
  value === 'fast' || value === 'quality' || value === 'pro';

const isPendingTaskMetadata = (value: unknown): value is PendingTaskMetadata =>
  isRecord(value) && typeof value.taskId === 'string' && typeof value.startedAt === 'number';

type AICreateResult = {
  model_url: string;
  preview_url: string;
  format?: string;
  modelId?: number | null;
  publishedModelId?: number | string;
  retentionExpiresAt?: string | null;
  sourceType?: InputMode;
  sourceName?: string;
  sourcePrompt?: string;
  qualityTier?: QualityTier;
};

const isTemporaryAiUrl = (url: string | undefined): boolean =>
  typeof url === 'string' && url.startsWith('/api/ai/temp/');

const getScopedAiStorageKey = (user: { id: number | string } | null | undefined, kind: AiDraftStorageKind): string | null => {
  if (!user) return null;
  const prefix = AI_DRAFT_STORAGE_PREFIX;
  if (kind === 'result') return `ai-draft:${user.id}:result`;
  if (kind === 'annotations') return `ai-draft:${user.id}:annotations`;
  if (prefix) return `ai-draft:${user.id}:pending-task`;
  return null;
};

const loadStoredResult = (storageKey: string | null): AICreateResult | null => {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed) && typeof parsed.model_url === 'string' && parsed.model_url) {
      if (isTemporaryAiUrl(parsed.model_url)) {
        localStorage.removeItem(storageKey);
        return null;
      }
      const publishedModelId =
        typeof parsed.publishedModelId === 'number' || typeof parsed.publishedModelId === 'string'
          ? parsed.publishedModelId
          : undefined;
      const modelId = typeof parsed.modelId === 'number' ? parsed.modelId : null;
      return {
        model_url: parsed.model_url,
        preview_url:
          typeof parsed.preview_url === 'string' && !isTemporaryAiUrl(parsed.preview_url)
            ? parsed.preview_url
            : parsed.model_url,
        format: typeof parsed.format === 'string' ? parsed.format : undefined,
        modelId,
        publishedModelId,
        retentionExpiresAt: typeof parsed.retentionExpiresAt === 'string' ? parsed.retentionExpiresAt : null,
        sourceType: isInputMode(parsed.sourceType) ? parsed.sourceType : undefined,
        sourceName: typeof parsed.sourceName === 'string' ? parsed.sourceName : undefined,
        sourcePrompt: typeof parsed.sourcePrompt === 'string' ? parsed.sourcePrompt : undefined,
        qualityTier: isQualityTier(parsed.qualityTier) ? parsed.qualityTier : undefined,
      };
    }
  } catch (error) {
    console.warn('Failed to load scoped AI draft result', error);
    return null;
  }
  return null;
};

interface StoredAnnotations {
  model_url: string;
  regions: RegionData[];
  paintData: FacePaintData;
  modules: Module[];
  volumeRegions: VolumeRegion[];
  surfaceRegions: SurfaceRegion[];
  processRules: ProcessRule[];
  surfacePaintGrid: SurfacePaintGridSnapshot;
  surfaceDirection: MagnetDirection | null;
}

const loadStoredAnnotations = (modelUrl: string | undefined, storageKey: string | null): StoredAnnotations | null => {
  if (!modelUrl || !storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed) && parsed.model_url === modelUrl) {
      return parsed as unknown as StoredAnnotations;
    }
  } catch (error) {
    console.warn('Failed to load scoped AI draft annotations', error);
    return null;
  }
  return null;
};

const detailToMessage = (detail: unknown): string | null => {
  if (typeof detail === 'string') return detail.trim() || null;
  if (Array.isArray(detail)) {
    const messages = detail
      .map(item => detailToMessage(item))
      .filter((message): message is string => Boolean(message));
    return messages.length ? messages.join('；') : null;
  }
  if (isRecord(detail)) {
    const message = detail.message ?? detail.msg;
    if (typeof message === 'string' && message.trim()) return message;
  }
  try {
    const serialized = JSON.stringify(detail);
    return typeof serialized === 'string' ? serialized : null;
  } catch {
    return null;
  }
};

const getErrorMessage = (err: unknown, fallback: string) => {
  if (isRecord(err)) {
    const response = err.response;
    if (isRecord(response)) {
      const data = response.data;
      if (isRecord(data)) {
        const detailMessage = detailToMessage(data.detail);
        if (detailMessage) return detailMessage;
      }
    }
    const message = err.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
};

const getModelExtension = (result: AICreateResult): string => {
  const format = result.format?.toLowerCase().replace(/^\./, '');
  if (format && /^[a-z0-9]+$/.test(format) && format !== 'unknown') return format;
  const urlExtension = getFileExtension(result.model_url);
  if (urlExtension) return urlExtension;
  return 'glb';
};

const formatDraftExpiry = (value?: string | null): string => {
  if (!value) return '未设置到期时间';
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) return '到期时间异常';
  const dateText = expiresAt.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const diffMs = expiresAt.getTime() - Date.now();
  if (diffMs <= 0) return `${dateText} 已到期`;
  const hours = Math.ceil(diffMs / (60 * 60 * 1000));
  if (hours < 24) return `${dateText} 到期（约 ${hours} 小时）`;
  return `${dateText} 到期（约 ${Math.ceil(hours / 24)} 天）`;
};

const draftSourceLabel = (sourceType?: string | null): string => {
  if (sourceType === 'manual_upload_draft') return '上传模型';
  if (sourceType === 'ai_generated') return 'AI 生成';
  return '临时草稿';
};

const AICreate: React.FC = () => {
  const { showToast } = useToast();
  const { user, isAuthenticated, isHydrated } = useAuth();
  const navigate = useNavigate();
  const projectDispatch = useProjectDispatch();
  const [searchParams] = useSearchParams();

  const resultStorageKey = getScopedAiStorageKey(user, 'result');
  const annotationStorageKey = getScopedAiStorageKey(user, 'annotations');
  const pendingTaskStorageKey = getScopedAiStorageKey(user, 'pending-task');

  const [inputMode, setInputMode] = useState<InputMode>('image');
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [converting, setConverting] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [eta, setEta] = useState<number | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [result, setResult] = useState<AICreateResult | null>(null);
  const [draftModels, setDraftModels] = useState<ModelData[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [error, setError] = useState('');

  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [qualityTier, setQualityTier] = useState<QualityTier>('fast');
  const modelInputRef = useRef<HTMLInputElement>(null);
  const [uploadedModelName, setUploadedModelName] = useState('');

  const surfacePaintGridRef = useRef<(() => SurfacePaintGridSnapshot) | null>(null);
  const surfaceDirectionRef = useRef<(() => [number, number, number]) | null>(null);

  const [selectedRegions, setSelectedRegions] = useState<RegionData[]>([]);
  const [paintData, setPaintData] = useState<FacePaintData>({});
  const [annotations, setAnnotations] = useState<{
    modules: Module[];
    volumeRegions: VolumeRegion[];
    surfaceRegions: SurfaceRegion[];
    processRules: ProcessRule[];
  }>({
    modules: [],
    volumeRegions: [],
    surfaceRegions: [],
    processRules: [],
  });

  const initialAnnotationsRef = useRef<InitialAnnotations>({});
  const initialAnnotationsModelRef = useRef<string | null>(null);
  if (initialAnnotationsModelRef.current !== (result?.model_url ?? null)) {
    initialAnnotationsModelRef.current = result?.model_url ?? null;
    const stored = loadStoredAnnotations(result?.model_url, annotationStorageKey);
    initialAnnotationsRef.current = stored
      ? {
          paintData: stored.paintData,
          modules: stored.modules,
          volumeRegions: stored.volumeRegions,
          surfaceRegions: stored.surfaceRegions,
          processRules: stored.processRules,
          surfacePaintGrid: stored.surfacePaintGrid,
          surfaceDirection: stored.surfaceDirection ?? undefined,
        }
      : {};
  }

  const annotationSnapshotRef = useRef({ selectedRegions, paintData, annotations });
  annotationSnapshotRef.current = { selectedRegions, paintData, annotations };

  const resultRef = useRef(result);
  resultRef.current = result;

  const refreshDraftModels = useCallback(async () => {
    if (!isAuthenticated) {
      setDraftModels([]);
      return;
    }
    setDraftsLoading(true);
    try {
      const response = await getDraftModels({ skip: 0, limit: 8 });
      setDraftModels(response.models);
    } catch (err) {
      console.warn('Failed to load AI draft model records', err);
    } finally {
      setDraftsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isHydrated) return;
    void refreshDraftModels();
  }, [isHydrated, result?.modelId, result?.retentionExpiresAt, refreshDraftModels]);

  useEffect(() => {
    const modelUrl = result?.model_url;
    if (!modelUrl) {
      setSelectedRegions([]);
      setPaintData({});
      setAnnotations({ modules: [], volumeRegions: [], surfaceRegions: [], processRules: [] });
      setSavedProjectId(null);
      return;
    }
    const stored = loadStoredAnnotations(modelUrl, annotationStorageKey);
    setSelectedRegions(stored?.regions ?? []);
    setPaintData(stored?.paintData ?? {});
    setAnnotations({
      modules: stored?.modules ?? [],
      volumeRegions: stored?.volumeRegions ?? [],
      surfaceRegions: stored?.surfaceRegions ?? [],
      processRules: stored?.processRules ?? [],
    });
    setSavedProjectId(null);
  }, [result?.model_url, annotationStorageKey]);

  const persistAnnotations = useCallback(() => {
    const modelUrl = resultRef.current?.model_url;
    if (!modelUrl) return;
    const snap = annotationSnapshotRef.current;
    const payload: StoredAnnotations = {
      model_url: modelUrl,
      regions: snap.selectedRegions,
      paintData: snap.paintData,
      modules: snap.annotations.modules,
      volumeRegions: snap.annotations.volumeRegions,
      surfaceRegions: snap.annotations.surfaceRegions,
      processRules: snap.annotations.processRules,
      surfacePaintGrid: surfacePaintGridRef.current?.() ?? null,
      surfaceDirection: surfaceDirectionRef.current?.() ?? null,
    };
    try {
      if (annotationStorageKey) localStorage.setItem(annotationStorageKey, JSON.stringify(payload));
    } catch (error) {
      console.warn('Failed to persist scoped AI draft annotations', error);
    }
  }, [annotationStorageKey]);

  useEffect(() => {
    window.addEventListener('pagehide', persistAnnotations);
    return () => {
      window.removeEventListener('pagehide', persistAnnotations);
      persistAnnotations();
    };
  }, [persistAnnotations]);

  const resetAnnotationState = useCallback(() => {
    setSelectedRegions([]);
    setPaintData({});
    setAnnotations({ modules: [], volumeRegions: [], surfaceRegions: [], processRules: [] });
    surfacePaintGridRef.current = null;
    surfaceDirectionRef.current = null;
    initialAnnotationsRef.current = {};
    initialAnnotationsModelRef.current = null;
    setSavedProjectId(null);
    if (annotationStorageKey) localStorage.removeItem(annotationStorageKey);
  }, [annotationStorageKey]);

  const restoreDraftModel = useCallback((draft: ModelData) => {
    const modelUrl = getModelFileUrl(draft.file_path);
    resetAnnotationState();
    setInputMode('upload');
    setUploadedModelName(draft.name);
    setResult({
      model_url: modelUrl,
      preview_url: modelUrl,
      format: getFileExtension(draft.file_path) || 'glb',
      modelId: draft.id,
      retentionExpiresAt: draft.retention_expires_at ?? null,
      sourceType: 'upload',
      sourceName: draft.name,
    });
    setHasResult(true);
    setError('');
    showToast('已恢复草稿模型', 'success');
  }, [resetAnnotationState, showToast]);

  /* ── Handlers ── */

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('图片不能超过 10MB'); return; }
    setSelectedImage(file);
    setError('');
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  /** 临时上传，不发布到模型库 */
  const handleModelUpload = useCallback(async (file: File) => {
    const ext = getFileExtension(file.name);
    if (!['glb', 'gltf', 'obj', 'stl', '3mf', 'step'].includes(ext || '')) {
      setError('支持格式: GLB, GLTF, OBJ, STL, 3MF, STEP'); return;
    }
    if (file.size > 100 * 1024 * 1024) { setError('文件不能超过 100MB'); return; }
    setError('');
    setResult(null);
    setHasResult(false);
    resetAnnotationState();
    setGenerating(true);
    setProgress(10);
    setStatusText('模型上传中...');
    try {
      const res = await uploadTemp(file);
      setProgress(100);
      setResult({
        model_url: res.model_url,
        preview_url: res.preview_url,
        format: res.format,
        modelId: res.model_id ?? null,
        retentionExpiresAt: res.retention_expires_at ?? null,
        sourceType: 'upload',
        sourceName: file.name,
      });
      setUploadedModelName(file.name);
      setInputMode('upload');
      setHasResult(true);
      showToast('模型已加载（未发布）', 'success');
    } catch (err: unknown) {
      setError(getErrorMessage(err, '上传失败'));
    } finally { setGenerating(false); }
  }, [resetAnnotationState, showToast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleModelUpload(file);
  }, [handleModelUpload]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!isAuthenticated || !resultStorageKey) {
      setResult(null);
      setHasResult(false);
      return;
    }
    const stored = loadStoredResult(resultStorageKey);
    setResult(stored);
    setHasResult(Boolean(stored));
    if (stored?.sourceType) setInputMode(stored.sourceType);
    if (stored?.sourceType === 'upload' && stored.sourceName) setUploadedModelName(stored.sourceName);
    if (stored?.sourceType === 'text' && stored.sourcePrompt) setPrompt(stored.sourcePrompt);
    if (stored?.qualityTier) setQualityTier(stored.qualityTier);
  }, [isAuthenticated, isHydrated, resultStorageKey]);

  useEffect(() => {
    if (!resultStorageKey) return;
    try {
      if (result?.model_url) {
        localStorage.setItem(resultStorageKey, JSON.stringify(result));
      } else {
        localStorage.removeItem(resultStorageKey);
      }
    } catch (error) {
      console.warn('Failed to persist scoped AI draft result', error);
    }
  }, [result, resultStorageKey]);

  useEffect(() => {
    const importModelUrl = searchParams.get('importModel');
    if (importModelUrl) {
      setInputMode('upload');
      const decodedImportModelUrl = decodeURIComponent(importModelUrl);
      const importedModelIdRaw = searchParams.get('modelId');
      const importedModelId = importedModelIdRaw && /^\d+$/.test(importedModelIdRaw) ? Number(importedModelIdRaw) : null;
      const importName = searchParams.get('modelName') || getFileName(decodedImportModelUrl) || '导入模型';
      const importRetentionExpiresAt = searchParams.get('retentionExpiresAt');
      const importedSourceType = searchParams.get('sourceType');
      resetAnnotationState();
      setUploadedModelName(importName);
      setResult({
        model_url: decodedImportModelUrl,
        preview_url: decodedImportModelUrl,
        format: getFileExtension(decodedImportModelUrl) || 'unknown',
        modelId: importedModelId,
        retentionExpiresAt: importRetentionExpiresAt || null,
        sourceType: 'upload',
        sourceName: importName,
        sourcePrompt: importedSourceType === 'ai_generated' ? importName : undefined,
      });
      setHasResult(true);
      showToast('模型已导入，请标注磁性区域', 'success');
    }
  }, [resetAnnotationState, searchParams, showToast]);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !pendingTaskStorageKey) return;
    const saved = localStorage.getItem(pendingTaskStorageKey);
    if (!saved) return;
    try {
      const parsed: unknown = JSON.parse(saved);
      if (!isPendingTaskMetadata(parsed) || Date.now() - parsed.startedAt > 60 * 60 * 1000) {
        localStorage.removeItem(pendingTaskStorageKey);
        return;
      }
      const { taskId, startedAt } = parsed;
      const restoredMode = isInputMode(parsed.inputMode) ? parsed.inputMode : 'image';
      if (isInputMode(parsed.inputMode)) setInputMode(parsed.inputMode);
      if (typeof parsed.prompt === 'string') setPrompt(parsed.prompt);
      if (isQualityTier(parsed.qualityTier)) setQualityTier(parsed.qualityTier);
      setGenerating(true);
      setProgress(0);
      setStatusText(restoredMode === 'text' ? '恢复文字生成任务...' : '恢复生成任务...');
      (async () => {
        const TERMINAL_FAILURE = new Set(['failed', 'cancelled', 'banned', 'expired']);
          const MAX_DURATION_MS = 60 * 60 * 1000;
          let consecutiveErrors = 0;
          while (true) {
            if (Date.now() - startedAt > MAX_DURATION_MS) {
              localStorage.removeItem(pendingTaskStorageKey);
              setError('任务超时（已等待60分钟）');
              setGenerating(false);
              return;
          }
          let sd: TaskStatus;
          try {
            sd = await getTaskStatus(taskId, { timeout: 60000 });
            consecutiveErrors = 0;
            } catch {
              consecutiveErrors++;
              if (consecutiveErrors >= 10) {
                localStorage.removeItem(pendingTaskStorageKey);
                setError('连续10次查询失败，请检查网络后重试');
                setGenerating(false);
                return;
            }
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }
          const st = sd.status?.toLowerCase();
          if (st === 'success') {
            setProgress(100);
            setStatusText('生成完成');
            localStorage.removeItem(pendingTaskStorageKey);
            const mUrl = sd.model_url || sd.output?.pbr_model || sd.output?.model || sd.output?.base_model;
            const restoredSourceType = restoredMode;
            const restoredSourceName =
              restoredSourceType === 'text'
                ? (typeof parsed.prompt === 'string' ? parsed.prompt.trim().slice(0, 40) : '文生 3D 模型')
                : '图生 3D 模型';
            const restoredSourcePrompt = typeof parsed.prompt === 'string' ? parsed.prompt : undefined;
            const restoredQualityTier = isQualityTier(parsed.qualityTier) ? parsed.qualityTier : undefined;
            if (mUrl) {
              const isLocal = mUrl.startsWith('/api/');
              if (isLocal) {
                setResult({
                  model_url: mUrl,
                  preview_url: mUrl,
                  format: 'glb',
                  sourceType: restoredSourceType,
                  sourceName: restoredSourceName,
                  sourcePrompt: restoredSourcePrompt,
                  qualityTier: restoredQualityTier,
                });
              } else {
                try {
                  const d = await downloadModelProxy(mUrl, { timeout: 180000 });
	                  setResult({
	                    model_url: d.local_url,
	                    preview_url: d.local_url,
	                    format: 'glb',
	                    modelId: d.model_id ?? null,
	                    retentionExpiresAt: d.retention_expires_at ?? null,
	                    sourceType: restoredSourceType,
	                    sourceName: restoredSourceName,
                    sourcePrompt: restoredSourcePrompt,
                    qualityTier: restoredQualityTier,
                  });
                } catch {
                  setResult({
                    model_url: mUrl,
                    preview_url: mUrl,
                    format: 'unknown',
                    sourceType: restoredSourceType,
                    sourceName: restoredSourceName,
                    sourcePrompt: restoredSourcePrompt,
                    qualityTier: restoredQualityTier,
                  });
                }
              }
            } else {
              setResult({
                model_url: '',
                preview_url: '',
                format: 'unknown',
                sourceType: restoredSourceType,
                sourceName: restoredSourceName,
                sourcePrompt: restoredSourcePrompt,
                qualityTier: restoredQualityTier,
              });
            }
            setHasResult(true); setGenerating(false); showToast('3D 模型生成完成', 'success'); return;
          }
          if (TERMINAL_FAILURE.has(st || '')) {
            localStorage.removeItem(pendingTaskStorageKey);
            setError(sd.error_msg || { failed: 'AI 生成失败', cancelled: '任务已取消', banned: '任务被禁止', expired: '任务已过期' }[st || ''] || 'AI 生成失败');
            setGenerating(false);
            return;
          }
          const realProgress = sd.progress ?? 0;
          setProgress(Math.max(realProgress, 1));
          if (st === 'queued') {
            setStatusText(sd.queuing_num ? `排队中（第${sd.queuing_num}位）` : '排队中...');
          } else if (st === 'running') {
            const leftTime = sd.running_left_time;
            setStatusText(leftTime && leftTime > 0 ? `生成中 ${realProgress}%（约${Math.ceil(leftTime / 60)}分钟）` : `生成中 ${realProgress}%`);
          } else {
            setStatusText(`处理中 ${realProgress}%`);
          }
          const interval = st === 'queued' ? 5000 : 2000;
          await new Promise(r => setTimeout(r, interval));
        }
      })();
    } catch (error) {
      console.warn('Failed to restore scoped AI pending task', error);
      localStorage.removeItem(pendingTaskStorageKey);
    }
  }, [isAuthenticated, isHydrated, pendingTaskStorageKey, showToast]);

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim();
    if (!pendingTaskStorageKey) { setError('请先登录后再生成模型'); return; }
    if (inputMode === 'image' && !selectedImage) { setError('请上传一张图片'); return; }
    if (inputMode === 'text' && trimmedPrompt.length < PROMPT_MIN_LENGTH) { setError(`描述至少需要 ${PROMPT_MIN_LENGTH} 个字符`); return; }
    if (inputMode === 'text' && trimmedPrompt.length > PROMPT_MAX_LENGTH) { setError(`描述不能超过 ${PROMPT_MAX_LENGTH} 个字符`); return; }
    if (inputMode === 'upload') return;
    setGenerating(true); setError(''); setProgress(0); setHasResult(false); setResult(null);
    resetAnnotationState();
    setStatusText(inputMode === 'text' ? '正在创建文字生成任务...' : '正在创建生成任务...');
    try {
      let data: { task_id: string };
      if (inputMode === 'image' && selectedImage) {
        data = await imageTo3D(selectedImage, qualityTier);
      } else if (inputMode === 'text') {
        data = await textTo3D({
          prompt: trimmedPrompt,
          quality: qualityTier,
        });
      } else {
        return;
      }
      const taskId = data.task_id;
      localStorage.setItem(pendingTaskStorageKey, JSON.stringify({
        taskId,
        startedAt: Date.now(),
        inputMode,
        prompt: trimmedPrompt,
        qualityTier,
      } satisfies PendingTaskMetadata));

      const TERMINAL_FAILURE = new Set(['failed', 'cancelled', 'banned', 'expired']);
      const MAX_DURATION_MS = 60 * 60 * 1000; // 60 minutes safety cap
      const startTime = Date.now();
      let consecutiveErrors = 0;

      while (true) {
        // Safety timeout
        if (Date.now() - startTime > MAX_DURATION_MS) {
          localStorage.removeItem(pendingTaskStorageKey);
          throw new Error('任务超时（已等待60分钟）');
        }

        let sd: TaskStatus;
        try {
          sd = await getTaskStatus(taskId, { timeout: 60000 });
          consecutiveErrors = 0;
        } catch {
          consecutiveErrors++;
          if (consecutiveErrors >= 10) throw new Error('连续10次查询失败，请检查网络后重试');
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }

        const st = sd.status?.toLowerCase();

        // Terminal success
        if (st === 'success') {
          setProgress(100);
          setStatusText('生成完成');
          setEta(null);
          localStorage.removeItem(pendingTaskStorageKey);
          const mUrl = sd.model_url || sd.output?.pbr_model || sd.output?.model || sd.output?.base_model;
          const generatedSourceType = inputMode;
          const generatedSourceName =
            generatedSourceType === 'text'
              ? trimmedPrompt.slice(0, 40)
              : selectedImage?.name || '图生 3D 模型';
          if (mUrl) {
            const isLocal = mUrl.startsWith('/api/');
            if (isLocal) {
              setResult({
                model_url: mUrl,
                preview_url: mUrl,
                format: 'glb',
                sourceType: generatedSourceType,
                sourceName: generatedSourceName,
                sourcePrompt: generatedSourceType === 'text' ? trimmedPrompt : undefined,
                qualityTier,
              });
            } else {
              try {
                const d = await downloadModelProxy(mUrl, { timeout: 180000 });
	                setResult({
	                  model_url: d.local_url,
	                  preview_url: d.local_url,
	                  format: 'glb',
	                  modelId: d.model_id ?? null,
	                  retentionExpiresAt: d.retention_expires_at ?? null,
	                  sourceType: generatedSourceType,
	                  sourceName: generatedSourceName,
                  sourcePrompt: generatedSourceType === 'text' ? trimmedPrompt : undefined,
                  qualityTier,
                });
              } catch {
                setResult({
                  model_url: mUrl,
                  preview_url: mUrl,
                  format: 'unknown',
                  sourceType: generatedSourceType,
                  sourceName: generatedSourceName,
                  sourcePrompt: generatedSourceType === 'text' ? trimmedPrompt : undefined,
                  qualityTier,
                });
              }
            }
          } else {
            setResult({
              model_url: '',
              preview_url: '',
              format: 'unknown',
              sourceType: generatedSourceType,
              sourceName: generatedSourceName,
              sourcePrompt: generatedSourceType === 'text' ? trimmedPrompt : undefined,
              qualityTier,
            });
          }
          setHasResult(true); setGenerating(false); showToast('3D 模型生成完成', 'success'); return;
        }

        // Terminal failure
        if (TERMINAL_FAILURE.has(st || '')) {
          localStorage.removeItem(pendingTaskStorageKey);
          const messages: Record<string, string> = {
            failed: 'AI 生成失败',
            cancelled: '任务已取消',
            banned: '任务被禁止',
            expired: '任务已过期',
          };
          throw new Error(sd.error_msg || messages[st || ''] || 'AI 生成失败');
        }

        // Non-terminal: update progress + status text
        const realProgress = sd.progress ?? 0;
        setProgress(Math.max(realProgress, 1)); // at least 1% to show activity

        if (st === 'queued') {
          const queueNum = sd.queuing_num;
          setStatusText(queueNum ? `排队中（第${queueNum}位）` : '排队中...');
          setEta(null);
        } else if (st === 'running') {
          const leftTime = sd.running_left_time;
          if (leftTime && leftTime > 0) {
            setEta(leftTime);
            const mins = Math.ceil(leftTime / 60);
            setStatusText(`生成中 ${realProgress}%（约${mins}分钟）`);
          } else {
            setStatusText(`生成中 ${realProgress}%`);
            setEta(null);
          }
        } else {
          setStatusText(`处理中 ${realProgress}%`);
          setEta(null);
        }

        // Adaptive polling interval
        const interval = st === 'queued' ? 5000 : 2000;
        await new Promise(r => setTimeout(r, interval));
      }
    } catch (err: unknown) { setError(getErrorMessage(err, '生成出错')); setGenerating(false); }
  };



  const inferModelName = () => {
    if (result?.sourceName) {
      return result.sourceName;
    }
    if (result?.sourceType === 'upload' && uploadedModelName) {
      return uploadedModelName;
    }
    if (result?.sourceType === 'text' && result.sourcePrompt) {
      return result.sourcePrompt.trim().slice(0, 40);
    }
    if (inputMode === 'upload' && modelInputRef.current?.files?.[0]?.name) {
      return modelInputRef.current.files[0].name;
    }
    if (inputMode === 'upload' && uploadedModelName) {
      return uploadedModelName;
    }
    if (inputMode === 'image' && selectedImage?.name) {
      return selectedImage.name;
    }
    if (inputMode === 'text' && prompt.trim()) {
      return prompt.trim().slice(0, 40);
    }
    return 'AI 创作模型';
  };

  const handlePublishModel = async () => {
    if (!result?.model_url) {
      setError('当前没有可发布的模型');
      return;
    }
    if (!result.modelId) {
      setError('当前模型缺少草稿记录，请重新生成或上传后发布');
      return;
    }
    setError('');
    setPublishModalOpen(true);
  };

  const handleEnterGcode = async () => {
    if (!result?.model_url) {
      setError('当前没有可处理的模型');
      return;
    }
    
    setConverting(true);
    setError('');
    
    try {
      projectDispatch({
        type: 'SET_PROJECT',
        payload: {
          projectId: savedProjectId,
          modelId: result.modelId ?? null,
          modelUrl: result.model_url,
          modelName: inferModelName(),
          regions: selectedRegions,
          paintData: paintData,
          modules: annotations.modules,
          volumeRegions: annotations.volumeRegions,
          surfaceRegions: annotations.surfaceRegions,
          processRules: annotations.processRules,
          surfacePaintGrid: surfacePaintGridRef.current?.() ?? null,
          surfaceDirection: surfaceDirectionRef.current?.() ?? undefined,
        },
      });
      
      navigate('/editor');
    } catch (err: unknown) {
      const errMsg = getErrorMessage(err, '进入 G-code 处理器失败');
      setError(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setConverting(false);
    }
  };

  const handleSaveProject = async () => {
    if (!result?.model_url) {
      showToast('当前没有可保存的模型', 'error');
      return;
    }
    setSavingProject(true);
    try {
      const surfaceGrid = surfacePaintGridRef.current?.() ?? null;
      const surfaceDirection = surfaceDirectionRef.current?.() ?? null;
      const modelName = inferModelName();
      const payload = {
        name: modelName || 'AI 创作项目',
        model_url: result.model_url,
        model_id: result.modelId ?? null,
        model_name: modelName,
        regions: selectedRegions,
        paint_data: paintData as Record<string, unknown>,
        modules: annotations.modules,
        volume_regions: annotations.volumeRegions,
        surface_regions: annotations.surfaceRegions,
        process_rules: annotations.processRules,
        surface_paint_grid: surfaceGrid as Record<string, unknown> | null,
        surface_direction: surfaceDirection,
        input_type: 'ai_project',
        source_file: {
          name: modelName,
          format: getModelExtension(result),
          sourceType: result.sourceType ?? inputMode,
        },
        step: 'annotated',
        split_result: null,
        model_result: null,
        slice_result: null,
        gcode_result: null,
        printer_profile: 'prusa_i3_mk3',
        quality_preset: '0.20mm',
      };
      if (savedProjectId) {
        const updated = await updateProject(savedProjectId, payload);
        if (updated.model_id) {
          setResult(current => current ? { ...current, modelId: updated.model_id, retentionExpiresAt: null } : current);
        }
        showToast('项目已更新', 'success');
      } else {
        const created = await createProject(payload);
        setSavedProjectId(created.id);
        if (created.model_id) {
          setResult(current => current ? { ...current, modelId: created.model_id, retentionExpiresAt: null } : current);
        }
        showToast('项目已保存到项目中心', 'success');
      }
    } catch {
      showToast('保存项目失败，请稍后重试', 'error');
    } finally {
      setSavingProject(false);
    }
  };

  const clearDraftState = () => {
    setHasResult(false); setResult(null); setSelectedRegions([]);
    setError(''); setProgress(0); setSelectedImage(null); setImagePreview(null);
    setPrompt(''); setPaintData({}); setPublishModalOpen(false);
    setUploadedModelName('');
    setStatusText(''); setEta(null);
    if (pendingTaskStorageKey) localStorage.removeItem(pendingTaskStorageKey);
    if (resultStorageKey) localStorage.removeItem(resultStorageKey);
    if (annotationStorageKey) localStorage.removeItem(annotationStorageKey);
    setAnnotations({ modules: [], volumeRegions: [], surfaceRegions: [], processRules: [] });
  };

  const resetAll = () => {
    if (result?.model_url && result.publishedModelId === undefined && !savedProjectId) {
      const confirmed = window.confirm('本模型没有发布，重新开始会删除当前未发布模型。确定继续吗？');
      if (!confirmed) return;
    }
    clearDraftState();
  };

  const handleInputModeChange = (nextMode: InputMode) => {
    if (generating) return;
    setInputMode(nextMode);
    setError('');
  };

  /* ── Render ── */

  useEffect(() => {
    document.body.classList.add('ai-create-route-active');
    document.body.classList.toggle('ai-mobile-tools-open', mobileToolsOpen);
    return () => {
      document.body.classList.remove('ai-create-route-active');
      document.body.classList.remove('ai-mobile-tools-open');
    };
  }, [mobileToolsOpen]);

  const inputTabs: { key: InputMode; label: string }[] = [
    { key: 'image', label: '图生 3D' },
    { key: 'text', label: '文生 3D' },
    { key: 'upload', label: '上传模型' },
  ];

  const promptLength = prompt.trim().length;
  const textPromptInvalid = promptLength < PROMPT_MIN_LENGTH || promptLength > PROMPT_MAX_LENGTH;
  const disableGen = generating || (inputMode === 'image' ? !selectedImage : inputMode === 'text' ? textPromptInvalid : false);
  const resultSourceType = result?.sourceType ?? inputMode;
  const resultSourceLabel =
    resultSourceType === 'image' ? '图生 3D' : resultSourceType === 'text' ? '文生 3D' : '上传模型';
  const resultQualityTier = result?.qualityTier ?? qualityTier;
  const activeDraftModels = draftModels.filter((draft) => draft.id !== result?.modelId);

  return (
    <div className={`ai-create-page page-enter ${mobileToolsOpen ? 'mobile-tools-open' : ''} ${hasResult ? 'has-result' : 'is-compose'}`}>
      <div className="route-shell__rail route-shell__rail--wide ai-create-workspace">
      <div className="ai-mobile-command-bar" aria-label="AI mobile actions">
        <button type="button" onClick={() => setMobileToolsOpen(true)}>
          创作设置
        </button>
        {hasResult && (
          <button type="button" onClick={handleEnterGcode} disabled={!result?.model_url || converting}>
            {converting ? '转换中' : '进入 G-code'}
          </button>
        )}
        <button type="button" onClick={resetAll}>
          重新开始
        </button>
      </div>
      {mobileToolsOpen && (
        <div
          className="mobile-panel-backdrop ai-create-mobile-backdrop"
          aria-hidden="true"
          onClick={() => setMobileToolsOpen(false)}
        />
      )}
      {/* ════════ Left Panel ════════ */}
      <div className={`ai-create-side-panel ${mobileToolsOpen ? 'is-mobile-open' : ''}`}>
        <div className="mobile-panel-head ai-create-mobile-panel-head">
          <div>
            <strong>创作与设置</strong>
            <span>生成、下载、发布和项目选项</span>
          </div>
          <button type="button" onClick={() => setMobileToolsOpen(false)}>关闭</button>
        </div>
        <section className="ai-create-hero-panel" style={{ paddingBottom: '0' }}>
          <div>
            <h1 style={{ fontSize: '1.4rem', margin: '0 0 8px' }}>AI 创作</h1>
            <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>用图片、文字或本地模型生成 3D 内容</p>
          </div>
        </section>

        {/* Input mode tabs */}
        <div className="ai-create-tabs-wrapper">
          {inputTabs.map(t => (
            <button
              key={t.key}
              className={`ai-create-tab-btn ${inputMode === t.key ? 'active' : ''}`}
              onClick={() => handleInputModeChange(t.key)}
              disabled={generating}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Input card */}
        {!generating && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {inputMode === 'image' && (
              <>
                <div className={`ai-upload-box ${imagePreview ? 'has-image' : 'empty'}`} onClick={() => imageInputRef.current?.click()}>
                  {imagePreview ? (
                    <img src={imagePreview} alt="preview" style={{ width: '100%', height: 'auto', maxHeight: '180px', objectFit: 'contain', display: 'block' }} />
                  ) : (
                    <div style={{ color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                      <div style={{ color: 'var(--primary)', opacity: 0.9 }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      </div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>上传参考图片</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>拖拽图片到这里，或点击选择文件<br/>支持 JPG / PNG / WebP，最大 10MB</div>
                    </div>
                  )}
                  <input ref={imageInputRef} type="file" accept=".jpg,.jpeg,.png,.webp" onChange={handleImageSelect} style={{ display: 'none' }} />
                </div>
                <div className="ai-quality-grid">
                  {QUALITY_OPTIONS.map(q => (
                    <button key={q.key} className={`ai-quality-btn ${qualityTier === q.key ? 'active' : ''}`} onClick={() => setQualityTier(q.key)} disabled={generating}>
                      <span className="ai-quality-title">{q.label}</span>
                      <span className="ai-quality-desc">{q.desc}</span>
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                  <button className="ai-generate-btn" onClick={handleGenerate} disabled={disableGen}>
                    生成 3D 模型
                  </button>
                  {disableGen && <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>请先上传图片后再生成</div>}
                </div>
              </>
            )}

            {inputMode === 'text' && (
              <>
                <textarea
                  placeholder={'描述你想要的 3D 模型\n\n例如: 一只可爱的猫咪坐在盒子上'}
                  value={prompt} onChange={e => setPrompt(e.target.value)} disabled={generating} rows={5}
                  maxLength={PROMPT_MAX_LENGTH}
                  style={{
                    width: '100%', padding: '16px', borderRadius: '18px',
                    border: '1.5px solid var(--border-light)', fontSize: '0.88rem',
                    outline: 'none', color: 'var(--text-primary)', background: 'var(--bg-page)',
                    resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box', transition: 'border-color 0.2s',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--border-light)')}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '0.72rem' }}>
                  <span style={{ color: textPromptInvalid ? '#C62828' : 'var(--text-tertiary)' }}>
                    {promptLength < PROMPT_MIN_LENGTH ? `至少 ${PROMPT_MIN_LENGTH} 个字符` : '描述越具体，模型结构越稳定'}
                  </span>
                  <span style={{ color: prompt.length > PROMPT_MAX_LENGTH * 0.9 ? 'var(--primary)' : 'var(--text-tertiary)' }}>
                    {prompt.length}/{PROMPT_MAX_LENGTH}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {EXAMPLE_PROMPTS.map(example => (
                    <button key={example} type="button" disabled={generating} onClick={() => { setPrompt(example); setError(''); }} style={{
                      padding: '5px 8px', borderRadius: '999px', border: '1px solid var(--border-light)',
                      background: 'var(--bg-page)', color: 'var(--text-secondary)', fontSize: '0.72rem',
                      cursor: generating ? 'not-allowed' : 'pointer',
                    }}>{example}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {QUALITY_OPTIONS.map(q => (
                    <button key={q.key} onClick={() => setQualityTier(q.key)} disabled={generating} style={{
                      flex: 1, padding: '4px 2px', borderRadius: 'var(--radius-sm)', border: '1.5px solid',
                      borderColor: qualityTier === q.key ? 'var(--primary)' : 'var(--border-light)',
                      background: qualityTier === q.key ? 'var(--primary-soft)' : 'var(--bg-page)',
                      cursor: generating ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                    }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: qualityTier === q.key ? 'var(--primary)' : 'var(--text-primary)' }}>{q.label}</span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{q.desc}</span>
                    </button>
                  ))}
                </div>
                <button onClick={handleGenerate} disabled={disableGen} style={{
                  width: '100%', padding: '11px', borderRadius: 'var(--radius-md)', fontSize: '0.88rem', fontWeight: 700, border: 'none',
                  cursor: disableGen ? 'not-allowed' : 'pointer',
                  background: disableGen ? 'var(--bg-tertiary)' : 'var(--primary)',
                  color: disableGen ? 'var(--text-tertiary)' : '#fff',
                  boxShadow: disableGen ? 'none' : '0 2px 8px rgba(255,140,66,0.3)', transition: 'all 0.2s',
                }}>生成 3D 模型</button>
              </>
            )}

            {inputMode === 'upload' && (
              <>
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => modelInputRef.current?.click()}
                  style={{
                    border: `1.5px dashed ${dragOver ? 'var(--primary)' : 'var(--border-light)'}`,
                    borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.2s',
                    background: dragOver ? 'var(--primary-soft)' : 'var(--bg-page)',
                    padding: '32px 16px', textAlign: 'center',
                  }}
                >
                  <div style={{ color: dragOver ? 'var(--primary)' : 'var(--text-secondary)' }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>
                      {dragOver ? '松开上传' : '拖拽或点击上传模型'}
                    </div>
                    <div style={{ fontSize: '0.75rem', marginTop: '4px', color: 'var(--text-tertiary)' }}>GLB, GLTF, OBJ, STL, 3MF, STEP</div>
                  </div>
                  <input ref={modelInputRef} type="file" accept=".glb,.gltf,.obj,.stl,.3mf,.step"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleModelUpload(f); e.currentTarget.value = ''; }}
                    style={{ display: 'none' }}
                  />
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                  仅用于预览和区域选择，不会发布到模型库
                </div>
              </>
            )}
          </div>
        )}

        {/* Generating State */}
        {generating && (
          <div style={{
            background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-sm)',
            padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px',
          }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                <span>{statusText || (inputMode === 'text' ? '文字生成中...' : 'AI 生成中...')}</span>
                <span>{progress}%</span>
              </div>
              <div style={{ height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'var(--primary)', borderRadius: '3px', transition: 'width 0.4s ease' }} />
              </div>
              {eta !== null && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '8px', textAlign: 'right' }}>
                  约 {Math.ceil(eta / 60)} 分钟
                </div>
              )}
            </div>
            <button onClick={() => {
              if (window.confirm('确定要取消生成并清除数据吗？')) {
                resetAll();
                setGenerating(false);
              }
            }} style={{
              width: '100%', padding: '9px', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontWeight: 600,
              background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-light)', cursor: 'pointer'
            }}>取消生成</button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', background: '#FFF0F0', color: '#C62828', border: '1px solid #FECACA', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
            <span style={{ flex: 1 }}>{error}</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {error.includes('转换失败') && (
                <button onClick={handleEnterGcode} style={{ background: '#C62828', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>重试</button>
              )}
              <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#C62828', cursor: 'pointer', padding: '2px 6px', fontSize: '1rem' }}>×</button>
            </div>
          </div>
        )}

        {!hasResult && !generating && isAuthenticated && (
          <details open={draftModels.length > 0} style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', overflow: 'hidden', marginTop: '16px' }}>
            <summary style={{ padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none', outline: 'none', background: 'var(--bg-secondary)' }}>
              草稿记录
            </summary>
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>
                未发布模型默认保留 3 天；点击记录可恢复到工作区。
              </span>
              <button type="button" onClick={() => void refreshDraftModels()} disabled={draftsLoading} style={{
                alignSelf: 'flex-start',
                border: 'none',
                background: 'transparent',
                color: 'var(--primary)',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: draftsLoading ? 'wait' : 'pointer',
                padding: 0,
              }}>
                {draftsLoading ? '刷新中' : '刷新记录'}
              </button>
              {draftsLoading && draftModels.length === 0 ? (
                <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>正在读取草稿记录...</span>
              ) : draftModels.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {draftModels.slice(0, 5).map((draft) => (
                    <button key={draft.id} type="button" onClick={() => restoreDraftModel(draft)} style={{
                      width: '100%',
                      border: '1px solid var(--border-light)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-page)',
                      padding: '8px 10px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'grid',
                      gap: '3px',
                    }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {draft.name || getFileName(draft.file_path) || `草稿 #${draft.id}`}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                        {draftSourceLabel(draft.source_type)} · {formatDraftExpiry(draft.retention_expires_at)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>暂无未发布草稿。</span>
              )}
            </div>
          </details>
        )}

        {/* Model Task Console (Result Actions) */}
        {hasResult && !generating && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Current Model Card */}
            <div style={{
              background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-sm)',
              padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px'
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>当前模型</div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {imagePreview && resultSourceType === 'image' && (
                  <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-sm)', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--border-light)' }}>
                    <img src={imagePreview} alt="thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ margin: '0 0 6px', fontSize: '1rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {inferModelName()}
                  </h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '0.72rem' }}>
                    <span style={{ padding: '2px 6px', background: '#FFF3E0', color: '#E65100', borderRadius: '4px', fontWeight: 600 }}>
                      {resultSourceType === 'upload' ? '已上传' : '已生成'}
                    </span>
                    <span style={{ padding: '2px 6px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', borderRadius: '4px' }}>
                      {resultSourceLabel}
                    </span>
                    {resultSourceType !== 'upload' && (
                      <span style={{ padding: '2px 6px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', borderRadius: '4px' }}>
                        {QUALITY_OPTIONS.find(q => q.key === resultQualityTier)?.label.replace(/[^快速均衡质量]/g, '') || resultQualityTier}质量
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Primary Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={handleEnterGcode}
                disabled={!result?.model_url || converting}
                style={{
                  width: '100%', padding: '12px', borderRadius: 'var(--radius-md)',
                  fontSize: '0.9rem', fontWeight: 700, border: 'none',
                  cursor: !result?.model_url || converting ? 'not-allowed' : 'pointer',
                  background: !result?.model_url || converting ? 'var(--bg-tertiary)' : 'var(--primary)',
                  color: !result?.model_url || converting ? 'var(--text-tertiary)' : '#fff',
                  boxShadow: !result?.model_url || converting ? 'none' : '0 2px 10px rgba(255,140,66,0.25)',
                  transition: 'all 0.2s',
                }}
              >
                {converting ? '转换中...' : '进入 G-code 处理器'}
              </button>

              <div style={{ display: 'flex', gap: '8px' }}>
                {result?.model_url && (
                  <div style={{ flex: 1 }}>
                    <FormatDownloadMenu 
                      modelUrl={result.model_url} 
                      originalFormat={result.format}
                      regions={selectedRegions}
                      paintData={paintData}
                      volumeRegions={annotations.volumeRegions}
                      getSurfacePaintGrid={() => surfacePaintGridRef.current?.() ?? null}
                    />
                  </div>
                )}

                <button onClick={handleSaveProject} disabled={!result?.model_url || savingProject} style={{
                  flex: 1, padding: '9px', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontWeight: 600,
                  background: !result?.model_url || savingProject ? 'var(--bg-tertiary)' : 'var(--bg-page)',
                  color: !result?.model_url || savingProject ? 'var(--text-tertiary)' : 'var(--text-primary)',
                  border: '1px solid var(--border-medium)', cursor: !result?.model_url || savingProject ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                }}>
                  {savingProject ? '保存中...' : savedProjectId ? '更新项目' : '保存项目'}
                </button>
                
                {resultSourceType !== 'upload' && inputMode === resultSourceType && (
                  <button onClick={handleGenerate} disabled={generating} style={{
                    flex: 1, padding: '9px', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontWeight: 600,
                    background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                    border: '1px solid var(--border-light)', cursor: generating ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                  }}>
                    重新生成
                  </button>
                )}
              </div>
            </div>

            {/* Collapsible Settings */}
            <details style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', overflow: 'hidden' }}>
              <summary style={{ padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none', outline: 'none', background: 'var(--bg-secondary)' }}>
                生成设置
              </summary>
              <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.78rem' }}>
                {resultSourceType === 'image' && (
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '6px' }}>参考图片</div>
                    <button onClick={() => imageInputRef.current?.click()} style={{ padding: '8px 12px', background: 'var(--bg-page)', border: '1px dashed var(--border-medium)', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-secondary)', width: '100%', textAlign: 'center', fontSize: '0.78rem' }}>更换图片</button>
                  </div>
                )}
                {resultSourceType === 'text' && (
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '6px' }}>提示词</div>
                    <textarea value={result?.sourcePrompt ?? prompt} readOnly rows={3} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)', background: 'var(--bg-page)', color: 'var(--text-primary)', resize: 'vertical' }} />
                  </div>
                )}
                {resultSourceType !== 'upload' && (
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '6px' }}>生成质量</div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {QUALITY_OPTIONS.map(q => (
                        <button key={q.key} onClick={() => setQualityTier(q.key)} style={{
                          flex: 1, padding: '6px 2px', borderRadius: '4px', border: '1px solid',
                          borderColor: qualityTier === q.key ? 'var(--primary)' : 'var(--border-light)',
                          background: qualityTier === q.key ? 'var(--primary-soft)' : 'var(--bg-page)',
                          cursor: 'pointer', fontSize: '0.75rem', color: qualityTier === q.key ? 'var(--primary)' : 'var(--text-primary)', textAlign: 'center'
                        }}>{q.label}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>

            <details style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', overflow: 'hidden' }}>
              <summary style={{ padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none', outline: 'none', background: 'var(--bg-secondary)' }}>
                发布选项
              </summary>
              <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {result?.modelId && !result?.publishedModelId && (
                  <div style={{
                    padding: '9px 10px',
                    border: '1px solid var(--border-light)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-page)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>当前草稿记录</span>
                    <strong style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>#{result.modelId} · {formatDraftExpiry(result.retentionExpiresAt)}</strong>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>
                      默认保留 3 天；发布或保存项目后会永久保留。
                    </span>
                  </div>
                )}
                <button onClick={handlePublishModel} disabled={!result?.model_url || !result?.modelId} style={{
                  width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', fontWeight: 600,
                  border: '1px solid var(--primary)', cursor: !result?.model_url || !result?.modelId ? 'not-allowed' : 'pointer',
                  background: result?.publishedModelId ? 'var(--primary-soft)' : 'transparent', color: 'var(--primary)', marginTop: '4px'
                }}>
                  {result?.publishedModelId ? '已发布，可再次发布更新' : '发布模型'}
                </button>
                {!result?.modelId && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                    当前结果缺少草稿记录，请重新生成或上传后再发布。
                  </span>
                )}
                <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>最近草稿记录</strong>
                    <button type="button" onClick={() => void refreshDraftModels()} disabled={draftsLoading} style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--primary)',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: draftsLoading ? 'wait' : 'pointer',
                      padding: 0,
                    }}>
                      {draftsLoading ? '刷新中' : '刷新'}
                    </button>
                  </div>
                  {draftsLoading && draftModels.length === 0 ? (
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>正在读取草稿记录...</span>
                  ) : activeDraftModels.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {activeDraftModels.slice(0, 5).map((draft) => (
                        <button key={draft.id} type="button" onClick={() => restoreDraftModel(draft)} style={{
                          width: '100%',
                          border: '1px solid var(--border-light)',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-page)',
                          padding: '8px 10px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          display: 'grid',
                          gap: '3px',
                        }}>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {draft.name || getFileName(draft.file_path) || `草稿 #${draft.id}`}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                            {draftSourceLabel(draft.source_type)} · {formatDraftExpiry(draft.retention_expires_at)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>
                      暂无其他未发布草稿。
                    </span>
                  )}
                </div>
              </div>
            </details>
          </div>
        )}

        {/* Usage guide - below result actions */}
        <details style={{
          background: 'var(--bg-card)',
          border: '1px solid #F0E7DC',
          borderRadius: '18px',
          padding: '14px 16px',
          marginTop: '16px',
          boxShadow: 'var(--shadow-xs)'
        }}>
          <summary style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', outline: 'none', userSelect: 'none', display: 'flex', alignItems: 'center' }}>
            ▸ 提示词结构与使用说明
          </summary>
          <div style={{ marginTop: '16px' }}>
            <div className="ai-prompt-builder" aria-label="提示词结构">
              <strong style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>提示词结构</strong>
              <div style={{ marginTop: '8px' }}>
                {PROMPT_BUILDER_STEPS.map((step) => <span key={step}>{step}</span>)}
              </div>
            </div>
            <ul className="ai-prompt-quality-list" aria-label="提示词质量检查" style={{ marginTop: '12px', fontSize: '0.78rem', color: 'var(--text-tertiary)', paddingLeft: '20px' }}>
              {PROMPT_QUALITY_CHECKS.map((item) => <li key={item} style={{ marginBottom: '6px' }}>{item}</li>)}
            </ul>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '16px', marginBottom: '8px' }}>
              使用说明
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: 'var(--primary)', fontWeight: 600, flexShrink: 0 }}>1.</span>
                <span>生成或上传 3D 模型，在右侧工具栏切换表面/体积/模块模式标记加磁区域</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: 'var(--primary)', fontWeight: 600, flexShrink: 0 }}>2.</span>
                <span>选择磁场强度后涂选或放置选区，Shift+滚轮调整大小，涂选可直接覆盖</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: 'var(--primary)', fontWeight: 600, flexShrink: 0 }}>3.</span>
                <span>完成后下载分磁模型或跳转 G-code 编辑器进行切片</span>
              </div>
            </div>
          </div>
        </details>
      </div>

      {/* ════════ Right - 3D Viewer (always editable) ════════ */}
      <div className="ai-create-viewer-panel">
        {generating && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(250,251,252,0.85)', backdropFilter: 'blur(6px)', gap: '14px',
          }}>
            <div style={{ width: 40, height: 40, border: '3px solid var(--bg-tertiary)', borderTop: '3px solid var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                {inputMode === 'upload' ? '加载中...' : (statusText || 'AI 生成中...')}
              </div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: '4px' }}>
                {progress > 0 ? `${progress}%` : '准备中'}
              </div>
            </div>
          </div>
        )}

        {hasResult ? (
          <React.Suspense fallback={<ViewerLoadingFallback />}>
            <PreviewWorkspace
              url={result?.preview_url || result?.model_url}
              modelKey={result?.model_url}
              initialAnnotations={initialAnnotationsRef.current}
              onRegionSelect={setSelectedRegions}
              onPaintDataChange={setPaintData}
              onAnnotationChange={setAnnotations}
              getSurfacePaintGridRef={surfacePaintGridRef}
              getSurfaceDirectionRef={surfaceDirectionRef}
            />
          </React.Suspense>
        ) : (
          <EmptyAiViewer message="上传图片、输入描述或直接上传 3D 文件" />
        )}
      </div>
      {publishModalOpen && result?.modelId && createPortal(
        <ModelPublishModal
          mode="retain"
          title="发布模型"
          subtitle="发布当前 AI 创作结果并永久保留"
          preset={{
            modelId: result.modelId,
            modelName: inferModelName(),
            modelUrl: result.model_url,
            sourceLabel: resultSourceLabel,
          }}
          categories={MODEL_CATEGORIES}
          requirements={UPLOAD_REQUIREMENTS}
          onClose={() => setPublishModalOpen(false)}
          onPublished={(model) => {
            const modelUrl = getModelFileUrl(model.file_path);
            setResult(current => current ? {
              ...current,
              modelId: model.id,
              publishedModelId: model.id,
              retentionExpiresAt: null,
              model_url: modelUrl,
              preview_url: modelUrl,
            } : current);
            setPublishModalOpen(false);
            showToast('模型已发布并永久保留', 'success');
          }}
        />,
        document.body,
      )}
      </div>
    </div>
  );
};

export default AICreate;
