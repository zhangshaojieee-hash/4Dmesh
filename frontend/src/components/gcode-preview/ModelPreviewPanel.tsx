/**
 * ModelPreviewPanel.tsx — Lightweight 3D model preview for GcodeEditor.
 *
 * Self-contained: does NOT depend on EditorStore.
 * Supports STL/OBJ/3MF/GLB/GLTF via multi-format loader.
 */
import React, { useEffect, useMemo } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { flatten3MFGroup } from '../lib/flatten-3mf';
import { createPreviewMaterial, PreviewEnvironment, PreviewLights, PREVIEW_GL_PROPS } from '../lib/preview-scene';
import PreviewViewportControls from '../preview-common/PreviewViewportControls';
import { ContactShadows, Grid, OrbitControls } from '../preview-common/ThreeControls';
import type { GcodeViewPreset } from './GcodePreviewCanvas';
import type { GridMagnetization, GridSelectionMode } from '../../stores/project';
import { GridMagnetizationOverlay } from './GridMagnetizationOverlay';

interface Props {
  modelUrl: string;
  showGrid?: boolean;
  showAxes?: boolean;
  viewPreset?: GcodeViewPreset;
  viewResetSignal?: number;
  gridMagnetization?: GridMagnetization | null;
  gridVisible?: boolean;
  selectedGridCells?: Set<string>;
  onGridCellToggle?: (key: string, additive: boolean) => void;
  onGridBounds?: (bboxMin: [number, number, number], bboxMax: [number, number, number]) => void;
  printerBed?: { width: number; depth: number; height: number };
  bottomFaceSelectionMode?: boolean;
  onBottomFaceSelected?: (rotation: [number, number, number, number]) => void;
  modelRotation?: [number, number, number, number];
  gridSelectionMode?: GridSelectionMode;
  onGridCellsSelect?: (keys: string[], additive: boolean) => void;
  validGridCellKeys?: Set<string> | null;
  onValidGridCells?: (keys: string[]) => void;
}

const DEFAULT_BED = { width: 250, depth: 210, height: 210 };

const modelViewFactors: Record<GcodeViewPreset, [number, number, number]> = {
  perspective: [0.6, 0.5, 0.6],
  top: [0, 1, 0.001],
  front: [0, 0, 1],
  side: [1, 0, 0],
};

function disposeMaterial(material: THREE.Material) {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry?.dispose();
    const material = child.material;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function useModelLoader(url: string | undefined) {
  const [scene, setScene] = React.useState<THREE.Group | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const sceneRef = React.useRef<THREE.Group | null>(null);

  useEffect(() => {
    return () => {
      if (sceneRef.current) {
        disposeObject3D(sceneRef.current);
        sceneRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!url) {
      if (sceneRef.current) {
        disposeObject3D(sceneRef.current);
        sceneRef.current = null;
      }
      setScene(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setScene(null);
    if (sceneRef.current) {
      disposeObject3D(sceneRef.current);
      sceneRef.current = null;
    }

    const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();

    const handleLoadedGroup = (group: THREE.Group) => {
      if (cancelled) {
        disposeObject3D(group);
        return;
      }
      sceneRef.current = group;
      setScene(group);
      setLoading(false);
    };

    const handleError = (msg: string) => {
      if (cancelled) return;
      setScene(null);
      setLoadError(msg);
      setLoading(false);
    };

    if (ext === 'stl') {
      new STLLoader().load(
        url,
        (geometry) => {
          const mesh = new THREE.Mesh(geometry, createPreviewMaterial());
          const group = new THREE.Group();
          group.add(mesh);
          handleLoadedGroup(group);
        },
        undefined,
        () => handleError('STL 模型加载失败'),
      );
    } else if (ext === 'obj') {
      new OBJLoader().load(
        url,
        (obj) => handleLoadedGroup(obj),
        undefined,
        () => handleError('OBJ 模型加载失败'),
      );
    } else if (ext === '3mf') {
      new ThreeMFLoader().load(
        url,
        (obj) => handleLoadedGroup(flatten3MFGroup(obj)),
        undefined,
        () => handleError('3MF 模型加载失败'),
      );
    } else if (ext === 'glb' || ext === 'gltf') {
      new GLTFLoader().load(
        url,
        (gltf) => handleLoadedGroup(gltf.scene),
        undefined,
        () => handleError('GLB/GLTF 模型加载失败'),
      );
    } else {
      handleError(`不支持的模型格式: ${ext ?? 'unknown'}`);
    }

    return () => {
      cancelled = true;
      THREE.Cache.remove(url);
    };
  }, [url]);

  return { scene, loading, loadError };
}

const SceneContent: React.FC<{
  scene: THREE.Group;
  showGrid: boolean;
  showAxes: boolean;
  viewPreset: GcodeViewPreset;
  viewResetSignal: number;
  gridMagnetization: GridMagnetization | null;
  gridVisible: boolean;
  selectedGridCells: Set<string>;
  onGridCellToggle?: (key: string, additive: boolean) => void;
  onGridBounds?: (bboxMin: [number, number, number], bboxMax: [number, number, number]) => void;
  printerBed: { width: number; depth: number; height: number };
  bottomFaceSelectionMode: boolean;
  onBottomFaceSelected?: (rotation: [number, number, number, number]) => void;
  modelRotation: [number, number, number, number];
  gridSelectionMode: GridSelectionMode;
  onGridCellsSelect?: (keys: string[], additive: boolean) => void;
  validGridCellKeys?: Set<string> | null;
  onValidGridCells?: (keys: string[]) => void;
}> = ({ scene, showGrid, showAxes, viewPreset, viewResetSignal, gridMagnetization, gridVisible, selectedGridCells, onGridCellToggle, onGridBounds, printerBed, bottomFaceSelectionMode, onBottomFaceSelected, modelRotation, gridSelectionMode, onGridCellsSelect, validGridCellKeys, onValidGridCells }) => {
  const { camera, gl, raycaster } = useThree();
  const gridGroupRef = React.useRef<THREE.Group | null>(null);

  useEffect(() => {
    if (gridMagnetization) onValidGridCells?.([]);
  }, [gridMagnetization, onValidGridCells]);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleShiftGridPointerDown = (event: PointerEvent) => {
      if (!event.shiftKey || !gridGroupRef.current || !gridMagnetization) return;
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const intersections = raycaster.intersectObjects(gridGroupRef.current.children, true);
      const hit = intersections.find((item) => typeof item.object.userData.gridCellKey === 'string');
      if (!hit) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const key = hit.object.userData.gridCellKey as string;
      if (gridSelectionMode === 'click') {
        onGridCellToggle?.(key, true);
      }
    };
    canvas.addEventListener('pointerdown', handleShiftGridPointerDown, true);
    return () => canvas.removeEventListener('pointerdown', handleShiftGridPointerDown, true);
  }, [camera, gl, gridMagnetization, gridSelectionMode, onGridCellToggle, raycaster]);

  useEffect(() => {
    scene.position.set(0, 0, 0);
    scene.quaternion.set(...modelRotation).normalize();
    const box = new THREE.Box3().setFromObject(scene);
    const rotatedCenter = box.getCenter(new THREE.Vector3());
    scene.position.set(
      printerBed.width / 2 - rotatedCenter.x,
      -box.min.y,
      -printerBed.depth / 2 - rotatedCenter.z,
    );
    const placedBox = new THREE.Box3().setFromObject(scene);
    const min: [number, number, number] = [placedBox.min.x, placedBox.min.y, placedBox.min.z];
    const max: [number, number, number] = [placedBox.max.x, placedBox.max.y, placedBox.max.z];
    onGridBounds?.(min, max);
    const sphere = placedBox.getBoundingSphere(new THREE.Sphere());

    const radius = sphere.radius || 1;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 45;
    const dist = radius / Math.sin((fov * Math.PI) / 360) * 1.2;
    const [x, y, z] = modelViewFactors[viewPreset];
    camera.position.set(dist * x, dist * y, dist * z);
    camera.lookAt(placedBox.getCenter(new THREE.Vector3()));
    (camera as THREE.PerspectiveCamera).near = radius * 0.01;
    (camera as THREE.PerspectiveCamera).far = radius * 100;
    camera.updateProjectionMatrix();
  }, [scene, camera, viewPreset, viewResetSignal, onGridBounds, printerBed.width, printerBed.depth, printerBed.height, modelRotation]);

  const handleModelPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!bottomFaceSelectionMode || !event.face || !(event.object instanceof THREE.Mesh)) return;
    event.stopPropagation();
    const normal = event.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(event.object.matrixWorld)).normalize();
    const correction = new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, -1, 0));
    const nextRotation = correction.multiply(scene.quaternion).normalize();
    onBottomFaceSelected?.([nextRotation.x, nextRotation.y, nextRotation.z, nextRotation.w]);
  };

  return (
    <>
      <PreviewLights />
      <PreviewEnvironment />
      <ContactShadows position={[0, -2, 0]} opacity={0.4} scale={10} blur={2.5} far={4} />
      {showGrid && (
        <Grid
          args={[printerBed.width, printerBed.depth]}
          cellColor="#D1D5DB"
          sectionColor="#94A3B8"
          fadeDistance={printerBed.width * 1.5}
          fadeStrength={0.35}
          position={[printerBed.width / 2, 0, -printerBed.depth / 2]}
        />
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[printerBed.width / 2, -0.08, -printerBed.depth / 2]}>
        <planeGeometry args={[printerBed.width, printerBed.depth]} />
        <meshBasicMaterial color="#E2E8F0" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      {showAxes && <axesHelper args={[5]} />}
      {gridVisible && gridMagnetization && (
        <GridMagnetizationOverlay
          modelCenter={new THREE.Vector3()}
          grid={gridMagnetization}
          selectedCells={selectedGridCells}
          onToggleCell={onGridCellToggle ?? (() => undefined)}
          selectionMode={gridSelectionMode}
          onSelectCells={onGridCellsSelect}
          onGroupReady={(group) => { gridGroupRef.current = group; }}
          validCellKeys={validGridCellKeys}
        />
      )}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={0.01}
        maxDistance={500}
        disableRotatePanWhileShift
      />
      <primitive object={scene} onPointerDown={handleModelPointerDown} />
    </>
  );
};

const ModelPreviewPanel: React.FC<Props> = ({ modelUrl, showGrid = true, showAxes = true, viewPreset = 'perspective', viewResetSignal = 0, gridMagnetization = null, gridVisible = false, selectedGridCells = new Set(), onGridCellToggle, onGridBounds, printerBed = DEFAULT_BED, bottomFaceSelectionMode = false, onBottomFaceSelected, modelRotation = [0, 0, 0, 1], gridSelectionMode = 'click', onGridCellsSelect, validGridCellKeys = null, onValidGridCells }) => {
  const { scene, loading, loadError } = useModelLoader(modelUrl);
  const [localViewPreset, setLocalViewPreset] = React.useState<GcodeViewPreset>(viewPreset);
  const [localResetSignal, setLocalResetSignal] = React.useState(0);

  useEffect(() => {
    setLocalViewPreset(viewPreset);
  }, [viewPreset]);

  const stats = useMemo(() => {
    if (!scene) return null;
    let vertices = 0;
    let meshes = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshes++;
        vertices += child.geometry?.attributes?.position?.count ?? 0;
      }
    });
    const ext = modelUrl.split('?')[0].split('.').pop()?.toUpperCase() || '?';
    return { vertices, meshes, format: ext };
  }, [scene, modelUrl]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={canvasContainerStyle}>
        <PreviewViewportControls
          onTop={() => setLocalViewPreset('top')}
          onFront={() => setLocalViewPreset('front')}
          onSide={() => setLocalViewPreset('side')}
          onPerspective={() => setLocalViewPreset('perspective')}
          onReset={() => {
            setLocalViewPreset('perspective');
            setLocalResetSignal((signal) => signal + 1);
          }}
          showAxes={showAxes}
        />
        {loading && (
          <div style={loadingOverlayStyle}>
            <div style={spinnerStyle} />
            <span style={{ marginTop: 10, fontSize: '0.82rem', color: 'var(--text-tertiary, #9CA3AF)', fontWeight: 500 }}>
              加载模型中…
            </span>
          </div>
        )}

        {loadError && (
          <div style={errorOverlayStyle}>
            <span style={{ fontSize: '1.2rem' }}>⚠</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #6B7280)' }}>{loadError}</span>
          </div>
        )}

        {scene && (
          <Canvas
            camera={{ position: [5, 5, 5], fov: 45, near: 0.01, far: 1000 }}
            style={{ width: '100%', height: '100%' }}
            shadows
            dpr={[1, 1.5]}
            gl={PREVIEW_GL_PROPS}
          >
            <SceneContent scene={scene} showGrid={showGrid} showAxes={showAxes} viewPreset={localViewPreset} viewResetSignal={viewResetSignal + localResetSignal} gridMagnetization={gridMagnetization} gridVisible={gridVisible} selectedGridCells={selectedGridCells} onGridCellToggle={onGridCellToggle} onGridBounds={onGridBounds} printerBed={printerBed} bottomFaceSelectionMode={bottomFaceSelectionMode} onBottomFaceSelected={onBottomFaceSelected} modelRotation={modelRotation} gridSelectionMode={gridSelectionMode} onGridCellsSelect={onGridCellsSelect} validGridCellKeys={validGridCellKeys} onValidGridCells={onValidGridCells} />
          </Canvas>
        )}
      </div>

      {stats && (
        <div style={statsBarStyle}>
          <span>格式: {stats.format}</span>
          <span>顶点数: {stats.vertices.toLocaleString()}</span>
          <span>网格数: {stats.meshes}</span>
        </div>
      )}
    </div>
  );
};

export default ModelPreviewPanel;

const canvasContainerStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  minHeight: 0,
  background: 'linear-gradient(180deg, #F8F9FB 0%, #EBEEF2 100%)',
};

const loadingOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(248, 249, 251, 0.85)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  zIndex: 10,
};

const errorOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  zIndex: 10,
};

const spinnerStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  border: '3px solid var(--border-light, #E8EBED)',
  borderTopColor: 'var(--primary, #FF8C42)',
  borderRadius: '50%',
  animation: 'spin 0.7s linear infinite',
};

const statsBarStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderTop: '1px solid var(--border-light)',
  display: 'flex',
  gap: 20,
  fontSize: '0.82rem',
  color: 'var(--text-secondary)',
  background: 'var(--bg-secondary)',
};
