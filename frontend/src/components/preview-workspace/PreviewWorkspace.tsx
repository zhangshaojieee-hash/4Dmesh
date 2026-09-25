/**
 * PreviewWorkspace.tsx — 预览/编辑一体区主容器
 *
 * 组装 PreviewToolbar + ModelCanvas + 交互层 + FloatingInspector + ZMiniTimeline
 */
import React, { useRef, useCallback, useEffect, useState } from 'react';
import * as THREE from 'three';
import { EditorProvider, useEditor, useEditorDispatch } from '../../stores/editor';
import { PreviewToolbar } from './PreviewToolbar';
import { ModelCanvas, useModelLoader } from './ModelCanvas';
import { ModuleSelectionLayer } from './ModuleSelectionLayer';
import { VolumeEditLayer } from './VolumeEditLayer';
import { SurfaceEditLayer } from './SurfaceEditLayer';
import { FloatingInspector } from './FloatingInspector';
import { VolumeWireframeOverlay } from './VolumeWireframeOverlay';
import { HelpPanel } from './HelpPanel';
import { ZMiniTimeline } from './ZMiniTimeline';
import { PaintHistory } from '../lib/paint-history';
import { prepareMesh, exportPaintData, applyFaceColors } from '../lib/bvh-painter';
import type { PreparedMesh } from '../lib/bvh-painter';
import { detectModules } from '../lib/module-detector';
import type { ModuleCandidate } from '../lib/editor-types';
import type { RegionData, FacePaintData, MagnetDirection } from '../../types';
import type { OrbitControlsLike } from '../preview-common/ThreeControls';
import { MAGNET_PRESETS } from '../../types';
import type { Module, VolumeRegion, SurfaceRegion, ProcessRule } from '../lib/editor-types';
import { VoxelGrid } from '../lib/voxel-grid';
import { createSurfaceShaderMaterial } from '../lib/volume-shader';
import { SurfacePaintHistory } from '../lib/surface-paint-history';

/* ═══ Initial annotations (restore) ═══ */

export interface InitialAnnotations {
  paintData?: FacePaintData;
  modules?: Module[];
  volumeRegions?: VolumeRegion[];
  surfaceRegions?: SurfaceRegion[];
  processRules?: ProcessRule[];
  surfacePaintGrid?: { bbox_min: number[]; bbox_max: number[]; resolution: number; data_b64: string } | null;
  surfaceDirection?: MagnetDirection;
}

/* ═══ Inner (needs EditorContext) ═══ */

interface InnerProps {
  url?: string;
  modelKey?: string;
  initialAnnotations?: InitialAnnotations;
  onRegionSelect?: (regions: RegionData[]) => void;
  onPaintDataChange?: (data: FacePaintData) => void;
  onAnnotationChange?: (data: {
    modules: Module[];
    volumeRegions: VolumeRegion[];
    surfaceRegions: SurfaceRegion[];
    processRules: ProcessRule[];
  }) => void;
  getSurfacePaintGridRef?: React.MutableRefObject<(() => unknown) | null>;
  getSurfaceDirectionRef?: React.MutableRefObject<(() => [number, number, number]) | null>;
}

const WorkspaceInner: React.FC<InnerProps> = ({
  url,
  modelKey,
  initialAnnotations,
  onRegionSelect,
  onPaintDataChange,
  onAnnotationChange,
  getSurfacePaintGridRef,
  getSurfaceDirectionRef,
}) => {
  const state = useEditor();
  const dispatch = useEditorDispatch();

  const orbitRef = useRef<OrbitControlsLike | null>(null);
  const historyRef = useRef(new PaintHistory());
  const preparedRef = useRef<PreparedMesh[]>([]);
  const getPrepared = useRef<() => PreparedMesh[]>(() => preparedRef.current);
  const moduleCandidatesRef = useRef<ModuleCandidate[]>([]);

  const surfaceGridRef = useRef<VoxelGrid | null>(null);
  const surfaceHistoryRef = useRef<SurfacePaintHistory>(new SurfacePaintHistory());
  const surfaceShaderRef = useRef<THREE.ShaderMaterial | null>(null);
  const surfaceSavedMatsRef = useRef<Map<THREE.Mesh, THREE.Material>>(new Map());

  const initialRef = useRef<InitialAnnotations | undefined>(initialAnnotations);
  const paintSeededRef = useRef(false);
  const gridSeededRef = useRef(false);
  const storeSeededRef = useRef(false);
  const notifyPaintChangeRef = useRef<(() => void) | null>(null);
  const activeModelKeyRef = useRef<string | undefined>(modelKey ?? url);

  const { scene, loading, loadError } = useModelLoader(url);

  const [ctrlPressed, setCtrlPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlPressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    const nextKey = modelKey ?? url;
    if (activeModelKeyRef.current === nextKey) return;
    activeModelKeyRef.current = nextKey;
    initialRef.current = initialAnnotations;
    paintSeededRef.current = false;
    gridSeededRef.current = false;
    storeSeededRef.current = false;
    historyRef.current = new PaintHistory();
    surfaceHistoryRef.current = new SurfacePaintHistory();
    preparedRef.current = [];
    moduleCandidatesRef.current = [];
    surfaceGridRef.current = null;
    surfaceShaderRef.current = null;
    surfaceSavedMatsRef.current.clear();
    dispatch({ type: 'RESET' });
    onRegionSelect?.([]);
    onPaintDataChange?.({});
    onAnnotationChange?.({ modules: [], volumeRegions: [], surfaceRegions: [], processRules: [] });
  }, [modelKey, url, initialAnnotations, dispatch, onRegionSelect, onPaintDataChange, onAnnotationChange]);

  // Detect modules BEFORE prepareMesh (needs indexed geometry)
  useEffect(() => {
    if (!scene) return;
    moduleCandidatesRef.current = detectModules(scene);
    paintSeededRef.current = false;
    gridSeededRef.current = false;
    storeSeededRef.current = false;
  }, [scene]);

  // Prepare meshes once when scene loads — shared across all edit modes
  useEffect(() => {
    if (!scene) return;
    const prepared: PreparedMesh[] = [];
    let idx = 0;
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry) return;
      const name = child.name || `mesh_${idx}`;
      child.name = name;
      child.castShadow = true;
      child.receiveShadow = true;
      prepared.push(prepareMesh(child, name));
      idx++;
    });
    preparedRef.current = prepared;

    const savedPaint = initialRef.current?.paintData;
    if (savedPaint && !paintSeededRef.current) {
      const presetIds = new Set(MAGNET_PRESETS.map(p => p.id));
      let seededAny = false;
      for (const p of prepared) {
        const groups = savedPaint[p.name];
        if (!groups) continue;
        for (const [sid, faces] of Object.entries(groups)) {
          if (!presetIds.has(sid)) continue;
          for (const fi of faces) p.paintMap.set(fi, sid);
        }
        applyFaceColors(p);
        seededAny = true;
      }
      paintSeededRef.current = true;
      if (seededAny) notifyPaintChangeRef.current?.();
    }

    return () => {
      for (const p of preparedRef.current) {
        p.mesh.material = p.origMaterial;
        p.paintMaterial.dispose();
      }
      preparedRef.current = [];
    };
  }, [scene]);

  useEffect(() => {
    if (!scene) return;
    const meshes: THREE.Mesh[] = [];
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry && child.visible) {
        if (child.geometry.type === 'RingGeometry' || child.geometry.type === 'WireframeGeometry') return;
        meshes.push(child);
      }
    });
    if (meshes.length === 0) return;

    const bbox = new THREE.Box3();
    for (const m of meshes) {
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox!;
      bbox.union(b.clone().applyMatrix4(m.matrixWorld));
    }
    bbox.expandByScalar(bbox.getSize(new THREE.Vector3()).length() * 0.05);

    const grid = new VoxelGrid(bbox, 128);
    surfaceGridRef.current = grid;

    const savedGrid = initialRef.current?.surfacePaintGrid;
    if (savedGrid && !gridSeededRef.current) {
      if (grid.importRLE(savedGrid)) {
        grid.uploadToTexture();
      }
      gridSeededRef.current = true;
    }

    const mat = createSurfaceShaderMaterial();
    surfaceShaderRef.current = mat;

    const saved = new Map<THREE.Mesh, THREE.Material>();
    for (const mesh of meshes) {
      saved.set(mesh, mesh.material as THREE.Material);
    }
    surfaceSavedMatsRef.current = saved;

    return () => {
      mat.dispose();
      grid.dispose();
      surfaceGridRef.current = null;
      surfaceShaderRef.current = null;
      surfaceSavedMatsRef.current.clear();
      surfaceHistoryRef.current = new SurfacePaintHistory();
    };
  }, [scene]);

  // preview mode → origMaterial, edit mode → paintMaterial
  useEffect(() => {
    for (const p of preparedRef.current) {
      p.mesh.material = state.mode === 'edit' ? p.paintMaterial : p.origMaterial;
    }
  }, [state.mode]);

  useEffect(() => {
    if (!scene || storeSeededRef.current) return;
    const init = initialRef.current;
    if (!init) { storeSeededRef.current = true; return; }
    const patch: {
      modules?: Module[];
      volumeRegions?: VolumeRegion[];
      surfaceRegions?: SurfaceRegion[];
      processRules?: ProcessRule[];
    } = {};
    if (init.modules?.length) patch.modules = init.modules;
    if (init.volumeRegions?.length) patch.volumeRegions = init.volumeRegions;
    if (init.surfaceRegions?.length) patch.surfaceRegions = init.surfaceRegions;
    if (init.processRules?.length) patch.processRules = init.processRules;
    if (Object.keys(patch).length > 0) dispatch({ type: 'LOAD_STATE', state: patch });
    if (init.surfaceDirection) dispatch({ type: 'SET_DIRECTION', direction: init.surfaceDirection });
    storeSeededRef.current = true;
  }, [scene, dispatch]);

  useEffect(() => {
    onAnnotationChange?.({
      modules: state.modules,
      volumeRegions: state.volumeRegions,
      surfaceRegions: state.surfaceRegions,
      processRules: state.processRules,
    });
  }, [state.modules, state.volumeRegions, state.surfaceRegions, state.processRules, onAnnotationChange]);

  const notifyPaintChange = useCallback(() => {
    const prepared = preparedRef.current;
    if (prepared.length === 0) return;
    const data = exportPaintData(prepared) as FacePaintData;
    // Also produce regions from paintData so download checks pass
    const regions: RegionData[] = [];
    for (const [mn, groups] of Object.entries(data)) {
      for (const [sid, faces] of Object.entries(groups)) {
        if (sid === 'none') {
          regions.push({ id: `${mn}_none`, name: '无磁', meshName: mn, color: '#cccccc', strength: 0, faceIndices: faces });
          continue;
        }
        const p = MAGNET_PRESETS.find(x => x.id === sid);
        if (!p || faces.length === 0) continue;
        regions.push({ id: `${mn}_${sid}`, name: p.label, meshName: mn, color: p.color, strength: p.strength, faceIndices: faces });
      }
    }
    onRegionSelect?.(regions);
    onPaintDataChange?.(data);
  }, [onRegionSelect, onPaintDataChange]);

  notifyPaintChangeRef.current = notifyPaintChange;

  const [, setHistoryRev] = useState(0);
  const bumpHistory = useCallback(() => setHistoryRev(r => r + 1), []);
  const canUndo = historyRef.current.canUndo();
  const canRedo = historyRef.current.canRedo();

  // Toolbar actions
  const handleUndo = useCallback(() => { scene?.userData.undo?.(); bumpHistory(); }, [scene, bumpHistory]);
  const handleRedo = useCallback(() => { scene?.userData.redo?.(); bumpHistory(); }, [scene, bumpHistory]);
  const handleClear = useCallback(() => { scene?.userData.clearAllPaint?.(); bumpHistory(); }, [scene, bumpHistory]);
  const handleSelectAll = useCallback(() => { scene?.userData.selectAll?.(); bumpHistory(); }, [scene, bumpHistory]);
  const handleInvert = useCallback(() => { scene?.userData.invertSelection?.(); bumpHistory(); }, [scene, bumpHistory]);

  const handleConfirmVolume = useCallback(() => { scene?.userData.confirmPendingVolume?.(); }, [scene]);
  const handleCancelVolume = useCallback(() => { scene?.userData.cancelPendingVolume?.(); }, [scene]);

  // Expose getSurfacePaintGrid to parent
  useEffect(() => {
    if (getSurfacePaintGridRef) {
      getSurfacePaintGridRef.current = () => {
        const grid = surfaceGridRef.current;
        if (!grid?.hasAnyPaint()) return null;
        return grid.exportRLE();
      };
    }
    if (getSurfaceDirectionRef) {
      getSurfaceDirectionRef.current = () => scene?.userData.getSurfaceDirection?.() ?? [0, 0, 1];
    }
    return () => {
      if (getSurfacePaintGridRef) getSurfacePaintGridRef.current = null;
      if (getSurfaceDirectionRef) getSurfaceDirectionRef.current = null;
    };
  }, [scene, getSurfacePaintGridRef, getSurfaceDirectionRef]);

  return (
    <div style={containerStyle}>
      <PreviewToolbar
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClear}
        onSelectAll={handleSelectAll}
        onInvert={handleInvert}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      <div style={canvasAreaStyle}>
        <ModelCanvas scene={scene} loading={loading} loadError={loadError} orbitRef={orbitRef} ctrlPressed={ctrlPressed}>
          {scene && state.mode === 'edit' && state.subMode === 'module' && (
            <ModuleSelectionLayer scene={scene} candidates={moduleCandidatesRef.current} getPrepared={getPrepared} notifyPaintChange={notifyPaintChange} />
          )}
          {scene && state.mode === 'edit' && state.subMode === 'volume' && (
            <VolumeEditLayer
              scene={scene}
              orbitRef={orbitRef}
            />
          )}
          {scene && state.mode === 'edit' && state.subMode === 'surface' && surfaceGridRef.current && surfaceShaderRef.current && (
            <>
              <SurfaceEditLayer
                scene={scene}
                orbitRef={orbitRef}
                grid={surfaceGridRef.current}
                history={surfaceHistoryRef.current}
                shaderMat={surfaceShaderRef.current}
                savedMats={surfaceSavedMatsRef.current}
              />
              <VolumeWireframeOverlay />
            </>
          )}
        </ModelCanvas>

        <FloatingInspector onConfirmVolume={handleConfirmVolume} onCancelVolume={handleCancelVolume} />
        <HelpPanel />
        <ZMiniTimeline />
      </div>
    </div>
  );
};

/* ═══ 公开组件（包裹 Provider） ═══ */

export interface PreviewWorkspaceProps {
  url?: string;
  modelKey?: string;
  initialAnnotations?: InitialAnnotations;
  onRegionSelect?: (regions: RegionData[]) => void;
  onPaintDataChange?: (data: FacePaintData) => void;
  onAnnotationChange?: (data: {
    modules: Module[];
    volumeRegions: VolumeRegion[];
    surfaceRegions: SurfaceRegion[];
    processRules: ProcessRule[];
  }) => void;
  getSurfacePaintGridRef?: React.MutableRefObject<(() => unknown) | null>;
  getSurfaceDirectionRef?: React.MutableRefObject<(() => [number, number, number]) | null>;
}

export const PreviewWorkspace: React.FC<PreviewWorkspaceProps> = (props) => (
  <EditorProvider key={props.modelKey ?? props.url ?? 'empty-model'}>
    <WorkspaceInner {...props} />
  </EditorProvider>
);

/* ═══ Styles ═══ */

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  position: 'relative',
  overflow: 'hidden',
  borderRadius: 'var(--radius-lg, 16px)',
  border: '1px solid rgba(255,255,255,0.5)',
  background: 'var(--bg-secondary, #F3F5F7)',
  boxShadow: '0 2px 20px rgba(0,0,0,0.06), 0 0 0 1px var(--border-light, #E8EBED)',
};

const canvasAreaStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};
