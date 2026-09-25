import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../stores/auth';
import { useToast } from '../stores/toast';
import { useProjectDispatch } from '../stores/project';
import ModelCard from '../components/ModelCard';
import {
  getDraftModels,
  getModelFileUrl,
  getThumbnailUrl,
  listProjects,
  deleteProject,
  getUserModels,
  listProcess4DTasks,
  downloadGcodeUrl,
  type ModelData,
  type ProjectData,
  type Process4DTaskSummary,
  type Process4DTaskStatus,
} from '../services/api';
import type { RegionData, FacePaintData } from '../types';
import type { Module, VolumeRegion, SurfaceRegion, ProcessRule } from '../components/lib/editor-types';
import type {
  GcodeInfo,
  GcodeResult,
  InputType,
  ModelResult,
  PipelineStep,
  SliceResult,
  SourceFile,
  SplitResult,
  SurfacePaintGrid,
  GridMagnetization,
} from '../stores/project';
import { getFileExtension, getFileName } from '../utils/path';

type ProjectsTab = 'projects' | 'models' | 'tasks' | 'exports';
type ProjectsMobilePanel = 'tabs' | 'actions' | 'summary' | null;
type ModelCollectionView = 'saved' | 'draft';

const VALID_TABS: ProjectsTab[] = ['projects', 'models', 'tasks', 'exports'];
const VALID_PROJECT_STEPS: PipelineStep[] = ['idle', 'annotated', 'splitting', 'split', 'slicing', 'sliced', 'processing', 'processed', 'ready'];
const VALID_INPUT_TYPES: InputType[] = ['ai_project', 'standalone_model', 'gcode', 'none'];

const STATUS_LABEL: Record<Process4DTaskStatus, string> = {
  queued: '排队中',
  running: '处理中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_TONE: Record<Process4DTaskStatus, string> = {
  queued: 'var(--text-secondary)',
  running: 'var(--primary)',
  succeeded: 'var(--success, #16a34a)',
  failed: 'var(--error, #dc2626)',
  cancelled: 'var(--text-tertiary)',
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function projectStepLabel(step: string): string {
  const labels: Record<string, string> = {
    idle: '未开始',
    annotated: '已标注',
    splitting: '分割中',
    split: '已分割',
    slicing: '切片中',
    sliced: '已切片',
    processing: '处理中',
    processed: '已处理',
    ready: '可打印',
  };
  return labels[step] || step;
}

function formatDraftExpiry(value?: string | null): string {
  if (!value) return '未设置到期时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '到期时间异常';
  const dateText = date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return `${dateText} 已到期`;
  const hours = Math.ceil(diffMs / (60 * 60 * 1000));
  return hours < 24 ? `${dateText} 到期（约 ${hours} 小时）` : `${dateText} 到期（约 ${Math.ceil(hours / 24)} 天）`;
}

function draftSourceLabel(sourceType?: string | null): string {
  if (sourceType === 'manual_upload_draft') return '上传模型';
  if (sourceType === 'ai_generated') return 'AI 生成';
  return '临时模型';
}

// Icons
const IconCube = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
const IconUpload = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
const IconLibrary = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>;
const IconSettings = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
const IconPackage = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
const IconFileText = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;

const PROJECT_TAB_ITEMS: { id: ProjectsTab; label: string; shortLabel: string }[] = [
  { id: 'projects', label: '最近项目', shortLabel: '项目' },
  { id: 'models', label: '我的模型', shortLabel: '模型' },
  { id: 'tasks', label: '切片任务', shortLabel: '任务' },
  { id: 'exports', label: '导出记录', shortLabel: '导出' },
];


const Projects: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, user } = useAuth();
  const { showToast } = useToast();
  const projectDispatch = useProjectDispatch();

  const initialTab = (searchParams.get('tab') as ProjectsTab) || 'projects';
  const [activeTab, setActiveTab] = useState<ProjectsTab>(VALID_TABS.includes(initialTab) ? initialTab : 'projects');
  
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [models, setModels] = useState<ModelData[]>([]);
  const [draftModels, setDraftModels] = useState<ModelData[]>([]);
  const [modelCollectionView, setModelCollectionView] = useState<ModelCollectionView>('saved');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsTotal, setModelsTotal] = useState(0);
  const [draftModelsTotal, setDraftModelsTotal] = useState(0);
  const [tasks, setTasks] = useState<Process4DTaskSummary[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<ProjectsMobilePanel>(null);

  const switchTab = (tab: ProjectsTab) => {
    setActiveTab(tab);
    setMobilePanel(null);
    const params = new URLSearchParams(searchParams);
    if (tab === 'projects') params.delete('tab');
    else params.set('tab', tab);
    setSearchParams(params, { replace: true });
  };

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      setProjects(await listProjects());
    } catch {
      showToast('加载项目列表失败', 'error');
    } finally {
      setProjectsLoading(false);
    }
  }, [showToast]);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      setTasks(await listProcess4DTasks());
    } catch {
      showToast('加载切片任务失败', 'error');
    } finally {
      setTasksLoading(false);
    }
  }, [showToast]);

  const loadModels = useCallback(async () => {
    if (!user) return;
    setModelsLoading(true);
    try {
      const [savedData, draftData] = await Promise.all([
        getUserModels(user.id),
        getDraftModels({ skip: 0, limit: 100 }),
      ]);
      setModels(savedData.models);
      setModelsTotal(savedData.total);
      setDraftModels(draftData.models);
      setDraftModelsTotal(draftData.total);
    } catch {
      showToast('加载模型列表失败', 'error');
    } finally {
      setModelsLoading(false);
    }
  }, [showToast, user]);

  useEffect(() => {
    const tab = searchParams.get('tab') as ProjectsTab | null;
    if (VALID_TABS.includes(tab as ProjectsTab)) {
      setActiveTab(tab as ProjectsTab);
      return;
    }
    setActiveTab('projects');
  }, [searchParams]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (isAuthenticated) loadProjects();
  }, [isAuthenticated, loadProjects]);

  useEffect(() => {
    if (isAuthenticated && (activeTab === 'tasks' || activeTab === 'exports')) loadTasks();
  }, [isAuthenticated, activeTab, loadTasks]);

  useEffect(() => {
    if (isAuthenticated && activeTab === 'models') loadModels();
  }, [isAuthenticated, activeTab, loadModels]);

  useEffect(() => {
    if (activeTab !== 'tasks' && activeTab !== 'exports') return;
    const hasActive = tasks.some((t) => t.status === 'queued' || t.status === 'running');
    if (!hasActive) return;
    const timer = setInterval(loadTasks, 3000);
    return () => clearInterval(timer);
  }, [activeTab, tasks, loadTasks]);

  useEffect(() => {
    document.body.classList.toggle('projects-mobile-panel-open', mobilePanel !== null);
    return () => document.body.classList.remove('projects-mobile-panel-open');
  }, [mobilePanel]);

  const handleOpenProject = (proj: ProjectData) => {
    const restoredStep = VALID_PROJECT_STEPS.includes(proj.step as PipelineStep) ? (proj.step as PipelineStep) : 'annotated';
    const restoredInputType = VALID_INPUT_TYPES.includes(proj.input_type as InputType) ? (proj.input_type as InputType) : 'standalone_model';
    projectDispatch({
      type: 'RESTORE_PROJECT',
      payload: {
        projectId: proj.id,
        modelUrl: proj.model_url,
        modelId: proj.model_id,
        modelName: proj.model_name || proj.name,
        inputType: restoredInputType,
        sourceFile: (proj.source_file as SourceFile | null) || { name: proj.model_name || proj.name, format: getFileExtension(proj.model_url) || 'model' },
        regions: (proj.regions as RegionData[]) || [],
        paintData: (proj.paint_data as FacePaintData) || ({} as FacePaintData),
        modules: (proj.modules as Module[]) || [],
        volumeRegions: (proj.volume_regions as VolumeRegion[]) || [],
        surfaceRegions: (proj.surface_regions as SurfaceRegion[]) || [],
        processRules: (proj.process_rules as ProcessRule[]) || [],
        surfacePaintGrid: (proj.surface_paint_grid as SurfacePaintGrid | null) || null,
        surfaceDirection: proj.surface_direction,
        gridMagnetization: (proj.grid_magnetization as GridMagnetization | null) || null,
        step: restoredStep,
        splitResult: proj.split_result as SplitResult,
        modelResult: proj.model_result as ModelResult,
        sliceResult: proj.slice_result as SliceResult,
        gcodeResult: proj.gcode_result as GcodeResult,
        gcodeInfo: (proj.gcode_info as GcodeInfo | null) || null,
        printerProfile: proj.printer_profile,
        qualityPreset: proj.quality_preset,
      },
    });
    navigate('/editor');
  };

  const handleContinueDraft = (model: ModelData) => {
    const modelUrl = getModelFileUrl(model.file_path);
    const params = new URLSearchParams({
      importModel: modelUrl,
      modelId: String(model.id),
      modelName: model.name || getFileName(model.file_path) || '临时模型',
      retentionExpiresAt: model.retention_expires_at || '',
      sourceType: model.source_type || 'manual_upload_draft',
    });
    navigate(`/ai?${params.toString()}`);
  };

  const handleOpenDraftInEditor = (model: ModelData) => {
    const modelUrl = getModelFileUrl(model.file_path);
    const modelName = model.name || getFileName(model.file_path) || '临时模型';
    projectDispatch({
      type: 'SET_PROJECT',
      payload: {
        projectId: null,
        modelId: model.id,
        modelUrl,
        modelName,
        regions: [],
        paintData: {} as FacePaintData,
        modules: [],
        volumeRegions: [],
        surfaceRegions: [],
        processRules: [],
        surfacePaintGrid: null,
        sourceFile: {
          name: modelName,
          format: getFileExtension(model.file_path) || 'model',
        },
      },
    });
    navigate('/editor');
  };

  const handleDeleteProject = async (proj: ProjectData) => {
    if (!window.confirm(`确认删除项目「${proj.name}」？此操作不可恢复。`)) return;
    setDeletingId(proj.id);
    try {
      await deleteProject(proj.id);
      setProjects((prev) => prev.filter((p) => p.id !== proj.id));
      showToast('项目已删除', 'success');
    } catch {
      showToast('删除项目失败', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  // Data processing
  const slicingTasks = tasks.filter((t) => t.status !== 'succeeded');
  const exportTasks = tasks.filter((t) => t.status === 'succeeded' && t.filename);
  const activeTabLabel = PROJECT_TAB_ITEMS.find((tab) => tab.id === activeTab)?.shortLabel || '项目';

  return (
    <div className={`page-enter projects-page ${mobilePanel ? `mobile-panel-${mobilePanel}` : ''}`}>
      <div className="route-shell__rail route-shell__rail--wide projects-rail">
        {mobilePanel && (
          <button
            type="button"
            className="mobile-panel-backdrop projects-mobile-backdrop"
            aria-label="关闭移动端项目面板"
            onClick={() => setMobilePanel(null)}
          />
        )}
        
        {/* Top Header */}
        <div className="projects-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: '0 0 8px 0', color: 'var(--text-primary)' }}>项目中心</h1>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>管理你的模型、创作项目和切片任务</p>
          </div>
          <div className="projects-desktop-actions" style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-secondary" onClick={() => navigate('/editor')}>新建项目</button>
            <button className="btn btn-secondary" onClick={() => navigate('/models')}>上传模型</button>
            <button className="btn btn-primary" onClick={() => navigate('/ai')}>去 AI 创作</button>
          </div>
        </div>

        <div className="projects-mobile-command-bar" aria-label="项目中心移动操作栏">
          <button type="button" onClick={() => setMobilePanel('tabs')}>当前：{activeTabLabel}</button>
          <button type="button" onClick={() => setMobilePanel('actions')}>新建</button>
          <button type="button" onClick={() => setMobilePanel('summary')}>概览</button>
        </div>

        <div className="projects-mobile-tabs-panel">
          <div className="mobile-panel-head">
            <div>
              <strong>切换内容</strong>
              <span>只保留当前任务在主屏中展示</span>
            </div>
            <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
          </div>
          <div className="projects-mobile-panel-list">
            {PROJECT_TAB_ITEMS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => switchTab(tab.id)}
              >
                <span>{tab.label}</span>
                {activeTab === tab.id && <strong>当前</strong>}
              </button>
            ))}
          </div>
        </div>

        <div className="projects-mobile-actions-panel">
          <div className="mobile-panel-head">
            <div>
              <strong>开始新任务</strong>
              <span>移动端只保留高频入口</span>
            </div>
            <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
          </div>
          <div className="projects-mobile-action-list">
            <button type="button" onClick={() => navigate('/ai')}><IconCube /> AI 创作</button>
            <button type="button" onClick={() => navigate('/models')}><IconUpload /> 上传模型</button>
            <button type="button" onClick={() => navigate('/')}><IconLibrary /> 浏览模型库</button>
            <button type="button" onClick={() => navigate('/editor')}><IconSettings /> 打开 G-code</button>
          </div>
        </div>

        <div className="projects-mobile-summary-panel">
          <div className="mobile-panel-head">
            <div>
              <strong>项目概览</strong>
              <span>统计信息不占用移动端主流程</span>
            </div>
            <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
          </div>
          <div className="projects-mobile-summary-grid">
            <div><strong>{projects.length}</strong><span>进行中项目</span></div>
            <div><strong>{modelsTotal}</strong><span>已保存模型</span></div>
            <div><strong>{slicingTasks.length}</strong><span>待处理任务</span></div>
            <div><strong>{exportTasks.length}</strong><span>已导出文件</span></div>
          </div>
        </div>

        {/* Data Overview Cards */}
        <div className="projects-summary-strip" style={{ marginBottom: '32px' }}>
          <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)', border: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{projects.length}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginTop: '8px', fontWeight: 600 }}>进行中项目</div>
          </div>
          <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)', border: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{modelsTotal}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginTop: '8px', fontWeight: 600 }}>已保存模型</div>
          </div>
          <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)', border: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{slicingTasks.length}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginTop: '8px', fontWeight: 600 }}>待处理任务</div>
          </div>
          <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)', border: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{exportTasks.length}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginTop: '8px', fontWeight: 600 }}>已导出文件</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="projects-quick-actions" style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 16px 0', color: 'var(--text-primary)' }}>开始一个新项目</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            <div onClick={() => navigate('/ai')} style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-light)', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', gap: '16px', alignItems: 'center' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--primary-soft)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconCube />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '4px' }}>AI 创作</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>用图片或文字生成 3D 模型</div>
              </div>
            </div>
            <div onClick={() => navigate('/models')} style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-light)', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', gap: '16px', alignItems: 'center' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--brand-secondary-soft)', color: 'var(--brand-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconUpload />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '4px' }}>上传模型</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>上传 STL, OBJ, 3MF, GLB 文件</div>
              </div>
            </div>
            <div onClick={() => navigate('/')} style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-light)', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', gap: '16px', alignItems: 'center' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--brand-accent-soft)', color: 'var(--brand-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconLibrary />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '4px' }}>浏览模型库</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>从社区模型中选择并保存</div>
              </div>
            </div>
            <div onClick={() => navigate('/editor')} style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-light)', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', gap: '16px', alignItems: 'center' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconSettings />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '4px' }}>打开 G-code</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>配置打印参数并生成 G-code</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs List */}
        <div className="projects-tabs" style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid var(--border-light)', paddingBottom: '16px' }}>
          {PROJECT_TAB_ITEMS.map(tab => (
            <button
              key={tab.id}
              className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => switchTab(tab.id as ProjectsTab)}
              style={activeTab === tab.id ? {
                background: 'var(--primary-soft)', color: 'var(--primary)', border: 'none', fontWeight: 700
              } : { border: 'none', background: 'transparent' }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content: Projects */}
        {activeTab === 'projects' && (
          <div>
            {projectsLoading ? (
              <div style={{ padding: '60px', textAlign: 'center' }}><div className="loading-spinner" /></div>
            ) : projects.length === 0 ? (
              <div style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-medium)', borderRadius: 'var(--radius-lg)', height: '240px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
                <div style={{ color: 'var(--text-tertiary)' }}><IconPackage /></div>
                <div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '1.05rem', color: 'var(--text-primary)', textAlign: 'center' }}>还没有保存的项目</h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>你可以从 AI 创作、上传模型或模型库收藏开始创建项目</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className="btn btn-primary" onClick={() => navigate('/ai')}>去 AI 创作</button>
                  <button className="btn btn-secondary" onClick={() => navigate('/models')}>上传模型</button>
                  <button className="btn btn-secondary" onClick={() => navigate('/')}>浏览模型库</button>
                </div>
              </div>
            ) : (
              <div className="projects-project-grid stagger-children">
                {projects.map((proj) => {
                  const coverUrl = proj.thumbnail_path ? getThumbnailUrl(proj.thumbnail_path) : null;
                  const format = getFileExtension(proj.model_url).toUpperCase() || '3D';
                  return (
                    <article key={proj.id} className="projects-project-card">
                      <div className="projects-project-cover">
                        {coverUrl ? (
                          <img src={coverUrl} alt={proj.name} loading="lazy" />
                        ) : (
                          <span>{format}</span>
                        )}
                        <strong>{projectStepLabel(proj.step)}</strong>
                      </div>
                      <div className="projects-project-body">
                        <div>
                          <h3 title={proj.name}>{proj.name}</h3>
                          <p>模型：{proj.model_name || '未命名模型'}</p>
                        </div>
                        <div className="projects-project-meta">
                          <span>{proj.printer_profile}</span>
                          <span>{proj.quality_preset}</span>
                        </div>
                        <div className="projects-project-data">
                          {[
                            proj.surface_paint_grid ? '表面涂选' : null,
                            proj.gcode_result ? 'G-code' : null,
                            proj.model_result ? '连续模型' : null,
                          ].filter(Boolean).join(' · ') || '模型与标注'}
                        </div>
                        <div className="projects-project-updated">
                          更新于 {formatTime(proj.updated_at)}
                        </div>
                        <div className="projects-project-actions">
                          <button className="btn btn-primary" onClick={() => handleOpenProject(proj)}>
                            继续编辑
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => handleDeleteProject(proj)}
                            disabled={deletingId === proj.id}
                          >
                            {deletingId === proj.id ? '...' : '删除'}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab Content: Models */}
        {activeTab === 'models' && (
          <div>
            <div className="projects-models-toolbar">
              <div className="projects-models-switch" role="tablist" aria-label="我的模型类型">
                <button
                  type="button"
                  role="tab"
                  aria-selected={modelCollectionView === 'saved'}
                  className={modelCollectionView === 'saved' ? 'active' : ''}
                  onClick={() => setModelCollectionView('saved')}
                >
                  已保存模型
                  <span>{modelsTotal}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={modelCollectionView === 'draft'}
                  className={modelCollectionView === 'draft' ? 'active' : ''}
                  onClick={() => setModelCollectionView('draft')}
                >
                  临时模型
                  <span>{draftModelsTotal}</span>
                </button>
              </div>
              <button className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '7px 14px' }} onClick={loadModels} disabled={modelsLoading}>
                {modelsLoading ? '刷新中...' : '刷新'}
              </button>
            </div>
            {modelsLoading ? (
              <div style={{ padding: '60px', textAlign: 'center' }}><div className="loading-spinner" /></div>
            ) : modelCollectionView === 'saved' && models.length === 0 ? (
              <div style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-medium)', borderRadius: 'var(--radius-lg)', height: '240px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
                <div style={{ color: 'var(--text-tertiary)' }}><IconUpload /></div>
                <div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '1.05rem', color: 'var(--text-primary)', textAlign: 'center' }}>还没有上传的模型</h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>你可以从本地上传或者前往模型库选择</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className="btn btn-primary" onClick={() => navigate('/models')}>去上传模型</button>
                  <button className="btn btn-secondary" onClick={() => navigate('/')}>浏览模型库</button>
                </div>
              </div>
            ) : modelCollectionView === 'saved' ? (
              <div className="projects-models-grid stagger-children">
                {models.map((model) => (
                  <ModelCard key={model.id} model={model} />
                ))}
              </div>
            ) : draftModels.length === 0 ? (
              <div style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-medium)', borderRadius: 'var(--radius-lg)', height: '240px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
                <div style={{ color: 'var(--text-tertiary)' }}><IconCube /></div>
                <div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '1.05rem', color: 'var(--text-primary)', textAlign: 'center' }}>暂无临时模型</h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>AI 生成或临时上传后，会在这里保留 3 天</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className="btn btn-primary" onClick={() => navigate('/ai')}>去 AI 创作</button>
                </div>
              </div>
            ) : (
              <div className="projects-models-grid projects-models-grid--draft stagger-children">
                {draftModels.map((model) => {
                  const format = getFileExtension(model.file_path).toUpperCase() || '3D';
                  const previewUrl = model.thumbnail_path ? getThumbnailUrl(model.thumbnail_path) : null;
                  return (
                    <article key={model.id} className="projects-draft-model-card">
                      <div className="projects-draft-model-thumb">
                        {previewUrl ? (
                          <img src={previewUrl} alt={model.name} loading="lazy" />
                        ) : (
                          <span>{format}</span>
                        )}
                        <strong>临时</strong>
                      </div>
                      <div className="projects-draft-model-body">
                        <div>
                          <h3 title={model.name}>{model.name || getFileName(model.file_path) || `临时模型 #${model.id}`}</h3>
                          <p>{draftSourceLabel(model.source_type)} · {formatDraftExpiry(model.retention_expires_at)}</p>
                        </div>
                        <div className="projects-draft-model-meta">
                          <span>#{model.id}</span>
                          <span>{format}</span>
                          <span>{getFileName(model.file_path)}</span>
                        </div>
                        <div className="projects-draft-model-note">
                          临时模型不会出现在公开模型库；发布或保存项目后会永久保留。
                        </div>
                        <div className="projects-draft-model-actions">
                          <button type="button" className="btn btn-primary" onClick={() => handleContinueDraft(model)}>
                            继续创作
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={() => handleOpenDraftInEditor(model)}>
                            进入 G-code
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab Content: Tasks */}
        {activeTab === 'tasks' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <button className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '4px 12px' }} onClick={loadTasks} disabled={tasksLoading}>
                {tasksLoading ? '刷新中...' : '刷新任务'}
              </button>
            </div>
            {tasksLoading && tasks.length === 0 ? (
              <div style={{ padding: '60px', textAlign: 'center' }}><div className="loading-spinner" /></div>
            ) : slicingTasks.length === 0 ? (
               <div style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-medium)', borderRadius: 'var(--radius-lg)', height: '240px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
                <div style={{ color: 'var(--text-tertiary)' }}><IconSettings /></div>
                <div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '1.05rem', color: 'var(--text-primary)', textAlign: 'center' }}>暂无切片任务记录</h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>切片任务将在这里显示进度状态</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className="btn btn-primary" onClick={() => navigate('/editor')}>打开 G-code 工作台</button>
                </div>
              </div>
            ) : (
              <div className="stagger-children" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {slicingTasks.map((task) => (
                  <div key={task.task_id} style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid var(--border-light)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontWeight: 700, color: STATUS_TONE[task.status] }}>{STATUS_LABEL[task.status]}</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.95rem' }}>{task.filename ? task.filename : '未知模型任务'}</span>
                      </div>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>{formatTime(task.created_at)}</span>
                    </div>
                    {task.status !== 'failed' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ flex: 1, height: '6px', borderRadius: '999px', background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                          <div style={{ width: `${task.progress}%`, height: '100%', background: STATUS_TONE[task.status], transition: 'width 0.2s ease' }} />
                        </div>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: '40px', textAlign: 'right' }}>{task.progress}%</span>
                      </div>
                    )}
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      {task.message || task.current_stage || '处理中...'}
                    </div>
                    {task.status === 'failed' && task.error && (
                      <div style={{ color: STATUS_TONE.failed, fontSize: '0.85rem', background: 'var(--error-soft, #fef2f2)', padding: '8px 12px', borderRadius: '6px' }}>
                        错误：{task.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Content: Exports */}
        {activeTab === 'exports' && (
          <div>
             <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <button className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '4px 12px' }} onClick={loadTasks} disabled={tasksLoading}>
                {tasksLoading ? '刷新中...' : '刷新记录'}
              </button>
            </div>
            {tasksLoading && tasks.length === 0 ? (
              <div style={{ padding: '60px', textAlign: 'center' }}><div className="loading-spinner" /></div>
            ) : exportTasks.length === 0 ? (
               <div style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-medium)', borderRadius: 'var(--radius-lg)', height: '240px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
                <div style={{ color: 'var(--text-tertiary)' }}><IconFileText /></div>
                <div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '1.05rem', color: 'var(--text-primary)', textAlign: 'center' }}>暂无导出文件</h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>这里将展示所有生成成功的 G-code 文件</p>
                </div>
              </div>
            ) : (
              <div className="stagger-children" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {exportTasks.map((task) => (
                   <div key={task.task_id} style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--border-light)', transition: 'all 0.2s' }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary-light)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-light)'}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ color: 'var(--primary)', background: 'var(--primary-soft)', padding: '12px', borderRadius: '10px' }}>
                         <IconFileText />
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem', marginBottom: '4px' }}>
                          {task.filename}
                        </div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', display: 'flex', gap: '12px' }}>
                          <span>格式：G-code</span>
                          <span>导出于：{formatTime(task.created_at)}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '8px 24px', fontSize: '0.9rem', color: 'var(--primary)', borderColor: 'var(--primary-light)', background: 'var(--primary-soft)' }}
                      onClick={() => window.open(task.download_url || downloadGcodeUrl(task.filename as string), '_blank')}
                    >
                      下载文件
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default Projects;
