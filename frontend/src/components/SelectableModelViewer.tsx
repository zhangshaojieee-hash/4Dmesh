import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { flatten3MFGroup } from './lib/flatten-3mf';
import { EmptyViewer, disposeScene } from './ModelViewer';
import { OrbitControls, PerspectiveCamera, type OrbitControlsLike } from './preview-common/ThreeControls';
import { MAGNET_PRESETS } from '../types';
import type { RegionData, FacePaintData, MagnetStrength } from '../types';
import {
  prepareMesh, queryBrushFaces, applyFaceColors, interpolateBrushPoints,
  type PreparedMesh, type FaceMap,
} from './lib/bvh-painter';
import {
  PaintHistory, captureStrokeDelta,
} from './lib/paint-history';
import { buildAdjacency, floodFill } from './lib/adjacency';
import {
  volumeBoxSelect, volumeLassoSelect, volumeSlabSelect,
  type ScreenPoint, type SelectionMode,
} from './lib/volume-select';

type ToolType = 'hand' | 'brush' | 'eraser' | 'fill' | 'boxSelect' | 'lassoSelect' | 'slabSelect';

const MODEL_VIEWER_HDR_URL = import.meta.env.VITE_MODEL_VIEWER_HDR_URL?.trim() || '/api/models/viewer-environment';
const MODEL_VIEWER_HDR_TIMEOUT_MS = 8000;

function exportPaintData(prepared: PreparedMesh[]): FacePaintData {
  const result: FacePaintData = {};
  for (const p of prepared) {
    const groups: { [s: string]: number[] } = {};
    p.paintMap.forEach((sid, fi) => {
      (groups[sid] ??= []).push(fi);
    });
    if (Object.keys(groups).length > 0) result[p.name] = groups;
  }
  return result;
}

function paintDataToRegions(data: FacePaintData): RegionData[] {
  const regions: RegionData[] = [];
  for (const [mn, groups] of Object.entries(data)) {
    for (const [sid, faces] of Object.entries(groups)) {
      if (sid === 'none') {
        regions.push({ id: `${mn}_none`, name: '\u65E0\u78C1', meshName: mn, color: '#cccccc', strength: 0, faceIndices: faces });
        continue;
      }
      const p = MAGNET_PRESETS.find(x => x.id === sid);
      if (!p || faces.length === 0) continue;
      regions.push({ id: `${mn}_${sid}`, name: p.label, meshName: mn, color: p.color, strength: p.strength, faceIndices: faces });
    }
  }
  return regions;
}

interface BrushSceneProps {
  scene: THREE.Group;
  activeStrength: MagnetStrength;
  brushRadius: number;
  tool: ToolType;
  clipY: number | null;
  previewMode: boolean;
  onPaintChange: (regions: RegionData[], data: FacePaintData) => void;
  onOverwriteSkip: () => void;
  orbitRef: React.MutableRefObject<OrbitControlsLike | null>;
  historyRef: React.MutableRefObject<PaintHistory>;
  getPrepared: React.MutableRefObject<() => PreparedMesh[]>;
}

type R3FCanvasWithState = HTMLCanvasElement & {
  __r3f?: {
    store?: {
      getState?: () => { camera?: THREE.Camera };
    };
  };
};

const SceneEnvironment: React.FC<{ url: string }> = ({ url }) => {
  const { gl, scene } = useThree();

  useEffect(() => {
    if (!url) return;

    const pmrem = new THREE.PMREMGenerator(gl);
    const loader = new HDRLoader();
    const previousEnvironment = scene.environment;
    let disposed = false;
    let activeEnvironment: THREE.Texture | null = null;
    let timeoutId: number | undefined;

    pmrem.compileEquirectangularShader();

    (async () => {
      try {
        const hdrTexture = await Promise.race([
          loader.loadAsync(url),
          new Promise<never>((_, reject) => {
            timeoutId = window.setTimeout(() => reject(new Error('HDR load timeout')), MODEL_VIEWER_HDR_TIMEOUT_MS);
          }),
        ]);
        if (disposed) return;

        activeEnvironment = pmrem.fromEquirectangular(hdrTexture).texture;
        hdrTexture.dispose();
        scene.environment = activeEnvironment;
      } catch (error) {
        if (import.meta.env.DEV && !disposed) {
          console.warn('Model viewer HDR environment unavailable, using local lights only.', error);
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    })();

    return () => {
      disposed = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      if (scene.environment === activeEnvironment) {
        scene.environment = previousEnvironment ?? null;
      }
      activeEnvironment?.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, url]);

  return null;
};

const BrushScene: React.FC<BrushSceneProps> = ({
  scene, activeStrength, brushRadius, tool, clipY, previewMode,
  onPaintChange, onOverwriteSkip, orbitRef, historyRef, getPrepared,
}) => {
  const { camera, raycaster, gl } = useThree();
  const preparedRef = useRef<PreparedMesh[]>([]);
  const adjMapsRef = useRef<Map<string, Map<number, number[]>>>(new Map());
  const pointerDown = useRef(false);
  const strokeSnapshotRef = useRef<Map<string, FaceMap>>(new Map());
  const strokeStarted = useRef(false);
  const lastPaintPoint = useRef<THREE.Vector3 | null>(null);
  const brushIndicator = useRef<THREE.Group | null>(null);
  const origMaterialsRef = useRef<Map<string, THREE.Material>>(new Map());

  // Clipping plane
  const clipPlane = useRef(new THREE.Plane(new THREE.Vector3(0, -1, 0), 0));

  useEffect(() => {
    if (clipY !== null) {
      clipPlane.current.constant = clipY;
      preparedRef.current.forEach(p => {
        (p.mesh.material as THREE.MeshStandardMaterial).clippingPlanes = [clipPlane.current];
        (p.mesh.material as THREE.MeshStandardMaterial).clipShadows = true;
      });
      gl.localClippingEnabled = true;
    } else {
      preparedRef.current.forEach(p => {
        (p.mesh.material as THREE.MeshStandardMaterial).clippingPlanes = [];
      });
      gl.localClippingEnabled = false;
    }
  }, [clipY, gl]);

  // Init meshes with BVH acceleration
  useEffect(() => {
    const prepared: PreparedMesh[] = [];
    let idx = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const name = child.name || `mesh_${idx}`;
        child.name = name;
        if (!origMaterialsRef.current.has(name)) {
          origMaterialsRef.current.set(name, (child.material as THREE.Material).clone());
        }
        child.castShadow = true;
        child.receiveShadow = true;
        const p = prepareMesh(child, name);
        applyFaceColors(p);
        if (!adjMapsRef.current.has(name)) {
          adjMapsRef.current.set(name, buildAdjacency(child.geometry as THREE.BufferGeometry));
        }
        prepared.push(p);
        idx++;
      }
    });
    preparedRef.current = prepared;
    getPrepared.current = () => preparedRef.current;
  }, [scene, getPrepared]);

  // Brush indicator
  useEffect(() => {
    const geo = new THREE.RingGeometry(0.95, 1, 48);
    geo.rotateX(-Math.PI / 2);

    const matFront = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5,
      depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const matBack = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.12,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });

    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, matFront));
    group.add(new THREE.Mesh(geo, matBack));
    group.visible = false;
    group.renderOrder = 999;
    scene.add(group);
    brushIndicator.current = group;

    return () => {
      scene.remove(group);
      geo.dispose(); matFront.dispose(); matBack.dispose();
    };
  }, [scene]);

  // Preview mode
  const paintMaterialsRef = useRef<Map<string, THREE.Material>>(new Map());
  useEffect(() => {
    preparedRef.current.forEach(p => {
      if (previewMode) {
        paintMaterialsRef.current.set(p.name, p.mesh.material as THREE.Material);
        const orig = origMaterialsRef.current.get(p.name);
        if (orig) p.mesh.material = orig;
      } else {
        const pm = paintMaterialsRef.current.get(p.name);
        if (pm) p.mesh.material = pm;
      }
    });
  }, [previewMode]);

  const emitChange = useCallback(() => {
    const data = exportPaintData(preparedRef.current);
    onPaintChange(paintDataToRegions(data), data);
  }, [onPaintChange]);

  // BVH-accelerated paint
  const paintAt = useCallback((event: PointerEvent, forceHitPoint?: THREE.Vector3) => {
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);
    const meshes = preparedRef.current.map(p => p.mesh);
    const hits = raycaster.intersectObjects(meshes, false);

    const hitPoint = forceHitPoint || (hits.length > 0 ? hits[0].point : null);
    if (!hitPoint) {
      if (brushIndicator.current) brushIndicator.current.visible = false;
      return;
    }

    if (brushIndicator.current) {
      brushIndicator.current.position.copy(hitPoint);
      brushIndicator.current.scale.setScalar(brushRadius);
      brushIndicator.current.visible = true;

      if (hits.length > 0 && hits[0].face) {
        const normal = hits[0].face.normal.clone()
          .transformDirection(hits[0].object.matrixWorld);
        brushIndicator.current.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0), normal,
        );
      }

      const isErase = tool === 'eraser';
      const ringColor = isErase ? '#ffffff' : activeStrength.color;
      brushIndicator.current.children.forEach((child: THREE.Object3D) => {
        const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        mat.color.set(ringColor);
      });
    }

    if (!pointerDown.current) return;

    // Snapshot on first paint of stroke for delta-based undo
    if (!strokeStarted.current) {
      const snap = new Map<string, FaceMap>();
      preparedRef.current.forEach(p => snap.set(p.name, new Map(p.paintMap)));
      strokeSnapshotRef.current = snap;
      strokeStarted.current = true;
    }

    let changed = false;

    if (tool === 'fill' && hits.length > 0) {
      const hit = hits[0];
      const mesh = hit.object as THREE.Mesh;
      const p = preparedRef.current.find(x => x.mesh === mesh);
      if (p && hit.faceIndex != null) {
        const adj = adjMapsRef.current.get(p.name);
        if (adj) {
          const changedFaces = floodFill(hit.faceIndex, p.paintMap, adj, activeStrength.id, event.ctrlKey);
          if (changedFaces.size > 0) {
            changed = true;
            applyFaceColors(p, changedFaces);
          }
        }
      }
    } else {
      // Interpolate between last paint point and current hit for smooth strokes
      const paintPoints = lastPaintPoint.current
        ? interpolateBrushPoints(lastPaintPoint.current, hitPoint, brushRadius)
        : [hitPoint.clone()];

      for (const pt of paintPoints) {
        for (const p of preparedRef.current) {
          const faces = queryBrushFaces(p, pt, brushRadius);
          if (faces.size === 0) continue;
          const ctrlHeld = event.ctrlKey;
          const dirtyFaces = new Set<number>();
          let skippedCount = 0;
          for (const fi of faces) {
            if (tool === 'eraser') {
              if (p.paintMap.has(fi)) { p.paintMap.delete(fi); dirtyFaces.add(fi); changed = true; }
            } else {
              const existing = p.paintMap.get(fi);
              if (existing && existing !== activeStrength.id && !ctrlHeld) { skippedCount++; continue; }
              if (existing !== activeStrength.id) { p.paintMap.set(fi, activeStrength.id); dirtyFaces.add(fi); changed = true; }
            }
          }
          if (skippedCount > 0) onOverwriteSkip();
          if (dirtyFaces.size > 0) applyFaceColors(p, dirtyFaces);
        }
      }
    }

    if (changed) {
      lastPaintPoint.current = hitPoint.clone();
      emitChange();
    }
  }, [camera, raycaster, gl, brushRadius, tool, activeStrength, emitChange, onOverwriteSkip]);

  // Pointer events
  const spaceHeld = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); spaceHeld.current = true; }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  const commitStroke = useCallback(() => {
    if (!strokeStarted.current) return;
    // Compute delta from stroke snapshot -> current state, push to history
    const before = strokeSnapshotRef.current;
    const after = new Map<string, FaceMap>();
    preparedRef.current.forEach(p => after.set(p.name, new Map(p.paintMap)));
    const delta = captureStrokeDelta(before, after);
    if (delta.meshChanges.size > 0) {
      historyRef.current.push(delta);
    }
    strokeStarted.current = false;
    lastPaintPoint.current = null;
  }, [historyRef]);

  useEffect(() => {
    const canvas = gl.domElement;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (tool === 'hand' || previewMode) return;
      if (e.altKey) {
        if (orbitRef.current) orbitRef.current.enabled = true;
        return;
      }
      pointerDown.current = true;
      strokeStarted.current = false;
      lastPaintPoint.current = null;
      if (orbitRef.current) orbitRef.current.enabled = false;
      e.stopPropagation();
      paintAt(e);
    };
    const lastHoverTime = { v: 0 };
    const onMove = (e: PointerEvent) => {
      if (spaceHeld.current) return;
      if (pointerDown.current) {
        paintAt(e);
      } else {
        const now = performance.now();
        if (now - lastHoverTime.v < 32) return;
        lastHoverTime.v = now;
        paintAt(e);
      }
    };
    const onUp = () => {
      commitStroke();
      pointerDown.current = false;
      if (orbitRef.current) orbitRef.current.enabled = true;
    };
    const onLeave = () => {
      commitStroke();
      pointerDown.current = false;
      if (orbitRef.current) orbitRef.current.enabled = true;
      if (brushIndicator.current) brushIndicator.current.visible = false;
    };

    canvas.addEventListener('pointerdown', onDown, { capture: true });
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    return () => {
      canvas.removeEventListener('pointerdown', onDown, { capture: true });
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [gl, paintAt, orbitRef, previewMode, tool, commitStroke]);

  // Expose actions via scene.userData
  useEffect(() => {
    const snapshotAll = (): Map<string, FaceMap> => {
      const s = new Map<string, FaceMap>();
      preparedRef.current.forEach(p => s.set(p.name, new Map(p.paintMap)));
      return s;
    };
    const refreshColors = () => {
      preparedRef.current.forEach(p => applyFaceColors(p));
      emitChange();
    };

    scene.userData.clearAllPaint = () => {
      const before = snapshotAll();
      preparedRef.current.forEach(p => p.paintMap.clear());
      const after = snapshotAll();
      const delta = captureStrokeDelta(before, after);
      if (delta.meshChanges.size > 0) historyRef.current.push(delta);
      refreshColors();
    };
    scene.userData.invertSelection = () => {
      const before = snapshotAll();
      preparedRef.current.forEach(p => {
        for (let fi = 0; fi < p.faceCount; fi++) {
          if (p.paintMap.has(fi)) p.paintMap.delete(fi);
          else p.paintMap.set(fi, activeStrength.id);
        }
      });
      const after = snapshotAll();
      const delta = captureStrokeDelta(before, after);
      if (delta.meshChanges.size > 0) historyRef.current.push(delta);
      refreshColors();
    };
    scene.userData.selectAll = () => {
      const before = snapshotAll();
      preparedRef.current.forEach(p => {
        for (let fi = 0; fi < p.faceCount; fi++) p.paintMap.set(fi, activeStrength.id);
      });
      const after = snapshotAll();
      const delta = captureStrokeDelta(before, after);
      if (delta.meshChanges.size > 0) historyRef.current.push(delta);
      refreshColors();
    };
    scene.userData.undo = () => {
      const delta = historyRef.current.undo();
      if (!delta) return;
      for (const [meshName, faceChanges] of delta.meshChanges) {
        const p = preparedRef.current.find(x => x.name === meshName);
        if (!p) continue;
        for (const [fi, change] of faceChanges) {
          if (change.from === undefined) p.paintMap.delete(fi);
          else p.paintMap.set(fi, change.from);
        }
      }
      refreshColors();
    };
    scene.userData.redo = () => {
      const delta = historyRef.current.redo();
      if (!delta) return;
      for (const [meshName, faceChanges] of delta.meshChanges) {
        const p = preparedRef.current.find(x => x.name === meshName);
        if (!p) continue;
        for (const [fi, change] of faceChanges) {
          if (change.to === undefined) p.paintMap.delete(fi);
          else p.paintMap.set(fi, change.to);
        }
      }
      refreshColors();
    };

    scene.userData.applyVolumeSelection = (faces: Map<string, Set<number>>, strengthId: string, erase: boolean) => {
      const before = snapshotAll();
      for (const [meshName, faceSet] of faces) {
        const p = preparedRef.current.find(x => x.name === meshName);
        if (!p) continue;
        for (const fi of faceSet) {
          if (erase) p.paintMap.delete(fi);
          else p.paintMap.set(fi, strengthId);
        }
      }
      const after = snapshotAll();
      const delta = captureStrokeDelta(before, after);
      if (delta.meshChanges.size > 0) historyRef.current.push(delta);
      refreshColors();
    };
  }, [scene, activeStrength, emitChange, historyRef]);

  return (
    <>
      <primitive object={scene} />
    </>
  );
};

/* ═══ Main component ═══ */

interface Props {
  url: string;
  onRegionSelect?: (regions: RegionData[]) => void;
  onPaintDataChange?: (data: FacePaintData) => void;
  readOnly?: boolean;
}

const SelectableModelViewer: React.FC<Props> = ({ url, onRegionSelect, onPaintDataChange, readOnly = false }) => {
  const [modelScene, setModelScene] = useState<THREE.Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const prevSceneRef = useRef<THREE.Group | null>(null);

  const [activePresetIdx, setActivePresetIdx] = useState(0);
  const [brushRadius, setBrushRadius] = useState(0.15);
  const [tool, setTool] = useState<ToolType>('hand');
  const [paintStats, setPaintStats] = useState<{ [id: string]: number }>({});
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipY, setClipY] = useState(0);
  const [modelBounds, setModelBounds] = useState<{ min: number; max: number }>({ min: -2, max: 2 });
  const [previewMode, setPreviewMode] = useState(false);
  const [xray, setXray] = useState(true);
  const [slabMin, setSlabMin] = useState(0);
  const [slabMax, setSlabMax] = useState(0);
  const [showOverwriteHint, setShowOverwriteHint] = useState(false);

  const overwriteHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orbitRef = useRef<OrbitControlsLike | null>(null);
  const historyRef = useRef(new PaintHistory());
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const getPreparedRef = useRef<() => PreparedMesh[]>(() => []);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const drawingRef = useRef(false);
  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  const lassoPointsRef = useRef<ScreenPoint[]>([]);

  const activeStrength = MAGNET_PRESETS[activePresetIdx];

  // Load model (multi-format: 3MF/STL/OBJ)
  useEffect(() => {
    if (!url) {
      if (prevSceneRef.current) {
        disposeScene(prevSceneRef.current);
        prevSceneRef.current = null;
      }
      setModelScene(null);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    if (prevSceneRef.current) {
      disposeScene(prevSceneRef.current);
      prevSceneRef.current = null;
    }
    setModelScene(null);
    setLoading(true); setError('');

    const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();

    const handleLoaded = (group: THREE.Group) => {
      if (cancelled) {
        disposeScene(group);
        return;
      }
      prevSceneRef.current = group;

      // Manual centering BEFORE computing bounds
      const rawBox = new THREE.Box3().setFromObject(group);
      const center = rawBox.getCenter(new THREE.Vector3());
      group.position.set(-center.x, -center.y, -center.z);
      group.updateMatrixWorld(true);

      // Compute bounds AFTER centering — clip/slab planes will match visible geometry
      const centeredBox = new THREE.Box3().setFromObject(group);
      setModelBounds({ min: centeredBox.min.y, max: centeredBox.max.y });
      setClipY(centeredBox.max.y);
      setSlabMin(centeredBox.min.y);
      setSlabMax(centeredBox.max.y);
      setModelScene(group);
      setLoading(false);
    };

    const handleError = () => {
      if (cancelled) return;
      setModelScene(null);
      setError('无法加载模型');
      setLoading(false);
    };

    if (ext === 'stl') {
      new STLLoader().load(url, (geometry) => {
        const material = new THREE.MeshStandardMaterial({ color: '#c8c8c8' });
        const mesh = new THREE.Mesh(geometry, material);
        const group = new THREE.Group();
        group.add(mesh);
        handleLoaded(group);
      }, undefined, handleError);
    } else if (ext === 'obj') {
      new OBJLoader().load(url, (obj) => handleLoaded(obj), undefined, handleError);
    } else {
      new ThreeMFLoader().load(url, (group) => handleLoaded(flatten3MFGroup(group)), undefined, handleError);
    }

    return () => {
      cancelled = true;
      THREE.Cache.remove(url);
      if (prevSceneRef.current) {
        disposeScene(prevSceneRef.current);
        prevSceneRef.current = null;
      }
    };
  }, [url]);

  const handlePaintChange = useCallback((regions: RegionData[], data: FacePaintData) => {
    onRegionSelect?.(regions);
    onPaintDataChange?.(data);
    const stats: { [id: string]: number } = {};
    for (const groups of Object.values(data)) {
      for (const [sid, faces] of Object.entries(groups)) stats[sid] = (stats[sid] || 0) + faces.length;
    }
    setPaintStats(stats);
  }, [onRegionSelect, onPaintDataChange]);

  const handleVolumeSelect = useCallback((faces: Map<string, Set<number>>) => {
    modelScene?.userData.applyVolumeSelection?.(faces, activeStrength.id, tool === 'eraser');
  }, [modelScene, activeStrength, tool]);

  const handleOverwriteSkip = useCallback(() => {
    setShowOverwriteHint(true);
    if (overwriteHintTimer.current !== null) {
      clearTimeout(overwriteHintTimer.current);
    }
    overwriteHintTimer.current = setTimeout(() => setShowOverwriteHint(false), 2000);
  }, []);

  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (tool === 'boxSelect' && boxStartRef.current && drawingRef.current) {
      const start = boxStartRef.current;
      ctx.strokeStyle = xray ? 'rgba(0, 180, 255, 0.9)' : 'rgba(255, 180, 0, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.fillStyle = xray ? 'rgba(0, 180, 255, 0.08)' : 'rgba(255, 180, 0, 0.08)';
      const w = (lastOverlayPos.current?.x ?? start.x) - start.x;
      const h = (lastOverlayPos.current?.y ?? start.y) - start.y;
      ctx.fillRect(start.x, start.y, w, h);
      ctx.strokeRect(start.x, start.y, w, h);
    }

    if (tool === 'lassoSelect' && lassoPointsRef.current.length > 1 && drawingRef.current) {
      const pts = lassoPointsRef.current;
      ctx.strokeStyle = xray ? 'rgba(0, 180, 255, 0.9)' : 'rgba(255, 180, 0, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = xray ? 'rgba(0, 180, 255, 0.08)' : 'rgba(255, 180, 0, 0.08)';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }, [tool, xray]);

  const lastOverlayPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const container = canvasContainerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;
    if (tool !== 'boxSelect' && tool !== 'lassoSelect') return;

    const getPos = (e: PointerEvent) => {
      const rect = overlay.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drawingRef.current = true;
      const pos = getPos(e);
      if (tool === 'boxSelect') {
        boxStartRef.current = pos;
        lastOverlayPos.current = pos;
      } else {
        lassoPointsRef.current = [pos];
      }
      if (orbitRef.current) orbitRef.current.enabled = false;
    };

    const onMove = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      const pos = getPos(e);
      if (tool === 'boxSelect') {
        lastOverlayPos.current = pos;
      } else {
        lassoPointsRef.current.push(pos);
      }
      drawOverlay();
    };

    const onUp = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      if (orbitRef.current) orbitRef.current.enabled = true;

      const prepared = getPreparedRef.current();
      if (prepared.length === 0) return;

      const r3fCanvas = container.querySelector('canvas');
      if (!r3fCanvas) return;
      const cw = r3fCanvas.clientWidth;
      const ch = r3fCanvas.clientHeight;

      const mode: SelectionMode = xray ? 'centroid' : 'centroid-visible';

      let result: Map<string, Set<number>> | null = null;

      if (tool === 'boxSelect' && boxStartRef.current && lastOverlayPos.current) {
        const s = boxStartRef.current;
        const e = lastOverlayPos.current;
        if (Math.abs(s.x - e.x) > 3 && Math.abs(s.y - e.y) > 3) {
          const cam = (r3fCanvas as R3FCanvasWithState).__r3f?.store?.getState?.()?.camera;
          if (cam) {
            result = volumeBoxSelect(
              { x1: s.x, y1: s.y, x2: e.x, y2: e.y },
              prepared, cam, cw, ch, mode,
            ).selected;
          }
        }
      }

      if (tool === 'lassoSelect' && lassoPointsRef.current.length >= 3) {
        const cam = (r3fCanvas as R3FCanvasWithState).__r3f?.store?.getState?.()?.camera;
        if (cam) {
          result = volumeLassoSelect(
            lassoPointsRef.current, prepared, cam, cw, ch, mode,
          ).selected;
        }
      }

      if (result) handleVolumeSelect(result);

      boxStartRef.current = null;
      lastOverlayPos.current = null;
      lassoPointsRef.current = [];

      const ctx = overlay.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
    };

    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointerleave', onUp);
    return () => {
      overlay.removeEventListener('pointerdown', onDown);
      overlay.removeEventListener('pointermove', onMove);
      overlay.removeEventListener('pointerup', onUp);
      overlay.removeEventListener('pointerleave', onUp);
    };
  }, [tool, xray, handleVolumeSelect, drawOverlay]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); modelScene?.userData.undo?.(); return; }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); modelScene?.userData.redo?.(); return; }
      if (readOnly || e.ctrlKey || e.altKey || e.metaKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case '[': setBrushRadius(r => Math.max(0.02, r - 0.03)); break;
        case ']': setBrushRadius(r => Math.min(1, r + 0.03)); break;
        case 'h': case 'H': setTool('hand'); break;
        case 'b': case 'B': setTool('brush'); break;
        case 'e': case 'E': setTool('eraser'); break;
        case 'f': case 'F': setTool('fill'); break;
        case 'r': case 'R': setTool('boxSelect'); break;
        case 'l': case 'L': setTool('lassoSelect'); break;
        case 's': case 'S': setTool('slabSelect'); break;
        case 'x': case 'X': setXray(v => !v); break;
        case '1': case '2': case '3': case '4': case '5': {
          const idx = parseInt(e.key) - 1;
          if (idx < MAGNET_PRESETS.length) { setActivePresetIdx(idx); setTool(t => t === 'hand' ? 'brush' : t); }
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modelScene, readOnly]);

  const magnetPainted = Object.entries(paintStats)
    .filter(([k]) => k !== 'none')
    .reduce((a, [, b]) => a + b, 0);
  const noneFaces = paintStats['none'] || 0;

  const tools: { key: ToolType; label: string }[] = [
    { key: 'hand', label: '拖拽' },
    { key: 'brush', label: '笔刷' },
    { key: 'eraser', label: '橡皮擦' },
    { key: 'fill', label: '填充' },
    { key: 'boxSelect', label: '框选' },
    { key: 'lassoSelect', label: '套索' },
    { key: 'slabSelect', label: '截面选' },
  ];

  const btnStyle = (active: boolean, color?: string) => ({
    padding: '6px 14px', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.15s', border: 'none', minHeight: '34px',
    background: active ? (color || 'var(--text-primary)') : 'var(--bg-secondary)',
    color: active ? '#fff' : 'var(--text-secondary)',
  });

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      {!readOnly && (
        <div style={{
          padding: '10px 16px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', flexShrink: 0,
        }}>
          {/* Strength presets */}
          {MAGNET_PRESETS.map((p, i) => (
            <button key={p.id} onClick={() => { setActivePresetIdx(i); if (tool === 'eraser' || tool === 'hand') setTool('brush'); }}
              style={btnStyle(activePresetIdx === i && tool !== 'eraser', p.color)}>
              {p.label}
            </button>
          ))}

          <div style={{ width: 1, height: 24, background: 'var(--border-light)' }} />

          {/* Tools */}
          {tools.map(t => (
            <button key={t.key} onClick={() => setTool(t.key)} style={btnStyle(tool === t.key)}>
              {t.label}
            </button>
          ))}

          <div style={{ width: 1, height: 24, background: 'var(--border-light)' }} />

          {/* Brush size */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>大小</span>
            <input type="range" min="0.02" max="1" step="0.01" value={brushRadius}
              onChange={e => setBrushRadius(parseFloat(e.target.value))}
              style={{ width: '90px', accentColor: 'var(--primary)' }} />
          </div>

          <div style={{ width: 1, height: 24, background: 'var(--border-light)' }} />

          {/* Actions */}
          <button onClick={() => modelScene?.userData.selectAll?.()} style={btnStyle(false)}>全选</button>
          <button onClick={() => modelScene?.userData.invertSelection?.()} style={btnStyle(false)}>反选</button>
          <button onClick={() => modelScene?.userData.clearAllPaint?.()} style={{ ...btnStyle(false), color: 'var(--error)' }}>清除</button>

          <div style={{ width: 1, height: 24, background: 'var(--border-light)' }} />

          {/* Undo/Redo */}
          <button onClick={() => modelScene?.userData.undo?.()} style={btnStyle(false)} title="Ctrl+Z">撤销</button>
          <button onClick={() => modelScene?.userData.redo?.()} style={btnStyle(false)} title="Ctrl+Y">重做</button>

          <div style={{ width: 1, height: 24, background: 'var(--border-light)' }} />

          {/* Clip plane toggle */}
          <button onClick={() => setClipEnabled(!clipEnabled)} style={btnStyle(clipEnabled)}>
            剖面
          </button>
          {clipEnabled && (
            <input type="range"
              min={modelBounds.min} max={modelBounds.max} step={0.01} value={clipY}
              onChange={e => setClipY(parseFloat(e.target.value))}
              style={{ width: '90px', accentColor: 'var(--secondary)' }}
            />
          )}

          <div style={{ width: 1, height: 24, background: 'var(--border-light)' }} />

          <button onClick={() => setXray(v => !v)} style={btnStyle(xray, 'var(--secondary)')}>
            {xray ? 'X光' : '可见'}
          </button>

          {tool === 'slabSelect' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>截面</span>
              <input type="range" min={modelBounds.min} max={modelBounds.max} step={0.01} value={slabMin}
                onChange={e => setSlabMin(parseFloat(e.target.value))}
                style={{ width: '70px', accentColor: 'var(--secondary)' }} />
              <input type="range" min={modelBounds.min} max={modelBounds.max} step={0.01} value={slabMax}
                onChange={e => setSlabMax(parseFloat(e.target.value))}
                style={{ width: '70px', accentColor: 'var(--secondary)' }} />
              <button onClick={() => {
                const prepared = getPreparedRef.current();
                if (prepared.length > 0) {
                  const result = volumeSlabSelect(new THREE.Vector3(0, 1, 0), slabMin, slabMax, prepared);
                  handleVolumeSelect(result.selected);
                }
              }} style={btnStyle(false)}>应用</button>
            </div>
          )}

          <div style={{ width: 1, height: 24, background: 'var(--border-light)' }} />

          {/* Preview mode */}
          <button onClick={() => setPreviewMode(!previewMode)} style={btnStyle(previewMode, 'var(--primary)')}>
            {previewMode ? '编辑' : '预览'}
          </button>
        </div>
      )}

      {/* Canvas */}
      <div ref={canvasContainerRef} style={{
        flex: 1, position: 'relative', minHeight: '300px',
        cursor: (previewMode || tool === 'hand') ? 'grab'
          : (tool === 'boxSelect' || tool === 'lassoSelect') ? 'crosshair'
          : (tool === 'slabSelect') ? 'default'
          : 'crosshair',
      }}>
        <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, localClippingEnabled: true }}>
          <color attach="background" args={["#f5f7fb"]} />
          <PerspectiveCamera makeDefault position={[0, 1.5, 4]} fov={45} />
          <ambientLight intensity={0.5} />
          <hemisphereLight args={['#ffffff', '#d7deea', 0.55]} />
          <directionalLight position={[5, 8, 5]} intensity={0.8} castShadow />
          <pointLight position={[-5, 3, -5]} intensity={0.3} />
          <SceneEnvironment url={MODEL_VIEWER_HDR_URL} />

          {!loading && !error && modelScene ? (
            <BrushScene
              scene={modelScene}
              activeStrength={activeStrength}
              brushRadius={brushRadius}
              tool={tool}
              clipY={clipEnabled ? clipY : null}
              previewMode={previewMode}
              onPaintChange={handlePaintChange}
              onOverwriteSkip={handleOverwriteSkip}
              orbitRef={orbitRef}
              historyRef={historyRef}
              getPrepared={getPreparedRef}
            />
          ) : null}

          <OrbitControls
            ref={orbitRef}
            enablePan enableZoom enableRotate
            autoRotate={false}
            mouseButtons={{
              LEFT: (tool === 'hand' || previewMode) ? THREE.MOUSE.ROTATE : undefined,
              MIDDLE: THREE.MOUSE.DOLLY,
              RIGHT: THREE.MOUSE.ROTATE,
            }}
          />
        </Canvas>
        {loading && (
          <div style={canvasStateOverlayStyle}>
            <div style={{ width: 36, height: 36, border: '3px solid #eee', borderTop: '3px solid var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: '13px', color: '#666', margin: '8px 0 0' }}>加载模型中...</p>
          </div>
        )}
        {!loading && error && (
          <div style={canvasStateOverlayStyle}>
            <p style={{ color: 'var(--error)', fontWeight: 600, margin: '0 0 6px' }}>加载失败</p>
            <p style={{ fontSize: '12px', color: '#999', margin: 0 }}>{error}</p>
          </div>
        )}

        {(tool === 'boxSelect' || tool === 'lassoSelect') && (
          <canvas
            ref={overlayRef}
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              pointerEvents: 'auto', zIndex: 10,
            }}
          />
        )}

        {magnetPainted > 0 && (
          <div style={{
            position: 'absolute', bottom: 10, left: 10,
            background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(10px)',
            borderRadius: 'var(--radius-sm)', padding: '8px 12px',
            boxShadow: 'var(--shadow-md)', display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            {noneFaces > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#ccc' }} />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>无磁 {noneFaces}</span>
              </div>
            )}
            {MAGNET_PRESETS.map(p => {
              const c = paintStats[p.id] || 0;
              if (c === 0) return null;
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{p.label} {c}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Hint */}
        {!readOnly && magnetPainted === 0 && !loading && !error && modelScene && (
          <div style={{
            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
            borderRadius: 'var(--radius-sm)', padding: '7px 14px',
            color: '#fff', fontSize: '0.78rem', fontWeight: 500, pointerEvents: 'none',
          }}>
            左键涂选 | 右键旋转 | [/]大小 | B笔刷 E橡皮 F填充 R框选 L套索 S截面 X透视 | Ctrl+Z撤销
          </div>
        )}

        {showOverwriteHint && (
          <div style={{
            position: 'absolute', bottom: 50, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(239,68,68,0.85)', backdropFilter: 'blur(6px)',
            borderRadius: 'var(--radius-sm)', padding: '7px 14px',
            color: '#fff', fontSize: '0.78rem', fontWeight: 500, pointerEvents: 'none',
            zIndex: 10,
          }}>
            已有不同强度涂选，按住 Ctrl 强制覆盖
          </div>
        )}
      </div>
    </div>
  );
};

const canvasStateOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 5,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  pointerEvents: 'none',
  background: 'rgba(245, 247, 251, 0.76)',
};

/* ═══ Export ═══ */

export default function SelectableModelPreview({
  url, onRegionSelect, onPaintDataChange, readOnly = false,
}: {
  url?: string;
  onRegionSelect?: (regions: RegionData[]) => void;
  onPaintDataChange?: (data: FacePaintData) => void;
  readOnly?: boolean;
}) {
  if (!url) return <EmptyViewer message="请先生成或上传 3D 模型" />;
  return <SelectableModelViewer url={url} onRegionSelect={onRegionSelect} onPaintDataChange={onPaintDataChange} readOnly={readOnly} />;
}
