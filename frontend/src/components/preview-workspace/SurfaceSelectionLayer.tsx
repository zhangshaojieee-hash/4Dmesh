import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditor, useEditorDispatch, getBrushWorldRadius } from '../../stores/editor';
import { MAGNET_PRESETS } from '../../types';
import type { RegionData, FacePaintData } from '../../types';
import {
  queryBrushFaces, applyFaceColors, interpolateBrushPoints, exportPaintData,
  getClosestFaceIndex,
  type PreparedMesh, type FaceMap,
} from '../lib/bvh-painter';
import { PaintHistory, captureStrokeDelta } from '../lib/paint-history';
import { buildAdjacency, floodFill } from '../lib/adjacency';
import {
  volumeBoxSelect, volumeLassoSelect, volumeSlabSelect,
  type ScreenPoint, type SelectionMode,
} from '../lib/volume-select';
import type { OrbitControlsLike } from '../preview-common/ThreeControls';

/* ── Helpers ── */

function paintDataToRegions(data: FacePaintData): RegionData[] {
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
  return regions;
}

/* ── Props ── */

export interface SurfaceSelectionLayerProps {
  scene: THREE.Group;
  orbitRef: React.MutableRefObject<OrbitControlsLike | null>;
  historyRef: React.MutableRefObject<PaintHistory>;
  getPrepared: React.MutableRefObject<() => PreparedMesh[]>;
  onPaintChange?: (regions: RegionData[], data: FacePaintData) => void;
}

/* ── Brush Indicator ── */

function createBrushIndicator(): { group: THREE.Group; dispose: () => void } {
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
  return {
    group,
    dispose: () => { geo.dispose(); matFront.dispose(); matBack.dispose(); },
  };
}

function updateBrushRing(
  group: THREE.Group,
  hit: THREE.Intersection | undefined,
  hitPoint: THREE.Vector3,
  radius: number,
  color: string,
): void {
  group.position.copy(hitPoint);
  group.scale.setScalar(radius);
  group.visible = true;
  if (hit?.face) {
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  }
  group.children.forEach((child: THREE.Object3D) => {
    (child as THREE.Mesh & { material: THREE.MeshBasicMaterial }).material.color.set(color);
  });
}

/* ── Selection Overlay ── */

function createOverlayDiv(tool: string): HTMLDivElement {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;';
  if (tool === 'boxSelect' || tool === 'slabSelect') {
    div.style.border = '2px dashed rgba(255,140,66,0.8)';
    div.style.background = 'rgba(255,140,66,0.1)';
  }
  document.body.appendChild(div);
  return div;
}

function syncBoxOverlay(div: HTMLDivElement, start: ScreenPoint, end: ScreenPoint, rect: DOMRect): void {
  const x1 = Math.min(start.x, end.x) + rect.left;
  const y1 = Math.min(start.y, end.y) + rect.top;
  div.style.left = `${x1}px`;
  div.style.top = `${y1}px`;
  div.style.width = `${Math.abs(end.x - start.x)}px`;
  div.style.height = `${Math.abs(end.y - start.y)}px`;
}

function syncLassoOverlay(div: HTMLDivElement, points: ScreenPoint[], rect: DOMRect): void {
  if (points.length < 2) return;
  const svgPts = points.map(p => `${p.x + rect.left},${p.y + rect.top}`).join(' ');
  div.style.left = '0';
  div.style.top = '0';
  div.style.width = '100vw';
  div.style.height = '100vh';
  div.innerHTML = `<svg style="width:100%;height:100%"><polyline points="${svgPts}" fill="rgba(255,140,66,0.1)" stroke="rgba(255,140,66,0.8)" stroke-width="2" stroke-dasharray="6,3"/></svg>`;
}

/* ── Component ── */

export const SurfaceSelectionLayer: React.FC<SurfaceSelectionLayerProps> = ({
  scene, orbitRef, historyRef, getPrepared, onPaintChange,
}) => {
  const { camera, raycaster, gl } = useThree();
  const {
    mode, subMode, surfaceTool, brushNorm, activeStrengthIdx,
    xray, slabMin, slabMax, modelExtent,
    brushMaxFaces, surfaceWireframe, debugOverlay,
  } = useEditor();
  const dispatch = useEditorDispatch();

  const activeStrength = MAGNET_PRESETS[activeStrengthIdx] ?? MAGNET_PRESETS[0];
  const isActive = mode === 'edit' && subMode === 'surface';
  const brushRadius = useMemo(() => getBrushWorldRadius(brushNorm, modelExtent), [brushNorm, modelExtent]);
  const isBrushTool = surfaceTool === 'brush' || surfaceTool === 'eraser';
  const isSelectionTool = surfaceTool === 'boxSelect' || surfaceTool === 'lassoSelect' || surfaceTool === 'slabSelect';

  const preparedRef = useRef<PreparedMesh[]>([]);
  const adjMapsRef = useRef<Map<string, Map<number, number[]>>>(new Map());
  const brushRef = useRef<THREE.Group | null>(null);
  const [preparedVersion, setPreparedVersion] = useState(0);

  const pointerDown = useRef(false);
  const strokeStarted = useRef(false);
  const strokeSnapshotRef = useRef<Map<string, FaceMap>>(new Map());
  const lastPaintPoint = useRef<THREE.Vector3 | null>(null);

  const selStartRef = useRef<ScreenPoint | null>(null);
  const selPointsRef = useRef<ScreenPoint[]>([]);
  const selectingRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const spaceHeld = useRef(false);

  /* ── Sync with shared prepared meshes ── */
  useEffect(() => {
    const prepared = getPrepared.current();
    preparedRef.current = prepared;
    for (const p of prepared) {
      if (!adjMapsRef.current.has(p.name)) {
        adjMapsRef.current.set(p.name, buildAdjacency(p.mesh.geometry as THREE.BufferGeometry));
      }
      applyFaceColors(p);
    }
    setPreparedVersion(v => v + 1);
  }, [scene, getPrepared]);

  /* ── Brush indicator lifecycle ── */
  useEffect(() => {
    const { group, dispose } = createBrushIndicator();
    scene.add(group);
    brushRef.current = group;
    return () => { scene.remove(group); dispose(); };
  }, [scene]);

  /* ── X-ray mode ── */
  useEffect(() => {
    if (brushRef.current && !isActive) brushRef.current.visible = false;
    if (!isActive) return;
    preparedRef.current.forEach(p => {
      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = xray;
      mat.opacity = xray ? 0.85 : 1.0;
      mat.side = xray ? THREE.DoubleSide : THREE.FrontSide;
      mat.needsUpdate = true;
    });
  }, [xray, isActive]);

  /* ── Emit paint change ── */
  const emitChange = useCallback(() => {
    const data = exportPaintData(preparedRef.current);
    onPaintChange?.(paintDataToRegions(data), data);
    let total = 0;
    preparedRef.current.forEach(p => { total += p.paintMap.size; });
    dispatch({ type: 'SET_PAINTED_FACE_COUNT', count: total });
  }, [onPaintChange, dispatch]);

  /* ── Raycast helper ── */
  const raycastMeshes = useCallback((event: PointerEvent) => {
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);
    return raycaster.intersectObjects(preparedRef.current.map(p => p.mesh), false);
  }, [gl, raycaster, camera]);

  /* ── Paint at pointer ── */
  const paintAt = useCallback((event: PointerEvent) => {
    if (!isActive) return;

    const hits = raycastMeshes(event);
    const hitPoint = hits.length > 0 ? hits[0].point : null;

    if (!hitPoint) {
      if (brushRef.current) brushRef.current.visible = false;
      return;
    }

    if (brushRef.current && isBrushTool) {
      updateBrushRing(brushRef.current, hits[0], hitPoint, brushRadius, surfaceTool === 'eraser' ? '#ffffff' : activeStrength.color);
    } else if (brushRef.current) {
      brushRef.current.visible = false;
    }

    if (!pointerDown.current) return;

    if (!strokeStarted.current) {
      const snap = new Map<string, FaceMap>();
      preparedRef.current.forEach(p => snap.set(p.name, new Map(p.paintMap)));
      strokeSnapshotRef.current = snap;
      strokeStarted.current = true;
    }

    let changed = false;
    const hit = hits[0];

    if (surfaceTool === 'fill' && hit) {
      const p = preparedRef.current.find(x => x.mesh === hit.object);
      if (p && hit.faceIndex != null) {
        const adj = adjMapsRef.current.get(p.name);
        if (adj) {
          const changedFaces = floodFill(hit.faceIndex, p.paintMap, adj, activeStrength.id, event.ctrlKey);
          if (changedFaces.size > 0) { changed = true; applyFaceColors(p, changedFaces); }
        }
      }
    } else if (isBrushTool) {
      const hitPrepared = hit ? preparedRef.current.find(x => x.mesh === hit.object) : undefined;
      if (!hitPrepared) { lastPaintPoint.current = hitPoint.clone(); return; }

      const paintPoints = lastPaintPoint.current
        ? interpolateBrushPoints(lastPaintPoint.current, hitPoint, brushRadius)
        : [hitPoint.clone()];

      for (const pt of paintPoints) {
        const rawFaces = queryBrushFaces(hitPrepared, pt, brushRadius, {
          cameraPosition: camera.position,
          maxFaces: brushMaxFaces,
        });
        if (rawFaces.size === 0) continue;

        const seedFace = getClosestFaceIndex(hitPrepared, pt);
        const adj = adjMapsRef.current.get(hitPrepared.name);
        let faces = rawFaces;
        if (adj && seedFace >= 0 && rawFaces.has(seedFace)) {
          const connected = new Set<number>();
          const queue = [seedFace];
          connected.add(seedFace);
          while (queue.length > 0) {
            const cur = queue.pop()!;
            const neighbors = adj.get(cur);
            if (!neighbors) continue;
            for (const nb of neighbors) {
              if (!connected.has(nb) && rawFaces.has(nb)) {
                connected.add(nb);
                queue.push(nb);
              }
            }
          }
          faces = connected;
        }
        if (faces.size === 0) continue;
        const dirtyFaces = new Set<number>();
        for (const fi of faces) {
          if (surfaceTool === 'eraser') {
            if (hitPrepared.paintMap.has(fi)) { hitPrepared.paintMap.delete(fi); dirtyFaces.add(fi); changed = true; }
          } else {
            if (hitPrepared.paintMap.get(fi) !== activeStrength.id) { hitPrepared.paintMap.set(fi, activeStrength.id); dirtyFaces.add(fi); changed = true; }
          }
        }
        if (dirtyFaces.size > 0) applyFaceColors(hitPrepared, dirtyFaces);
      }
    }

    // Always update lastPaintPoint when brush is active to prevent
    // stale interpolation from an old position on the next move
    if (isBrushTool) {
      lastPaintPoint.current = hitPoint.clone();
    }

    if (changed) {
      emitChange();
    }

    if (debugOverlay) {
      scene.userData._debugStats = {
        brushRadius: brushRadius.toFixed(4),
        maxFaces: brushMaxFaces,
        totalPainted: preparedRef.current.reduce((s, p) => s + p.paintMap.size, 0),
        totalFaces: preparedRef.current.reduce((s, p) => s + p.faceCount, 0),
        meshCount: preparedRef.current.length,
      };
    }
  }, [isActive, isBrushTool, raycastMeshes, brushRadius, surfaceTool, activeStrength, emitChange, brushMaxFaces, debugOverlay, scene, camera]);

  /* ── Commit stroke to history ── */
  const commitStroke = useCallback(() => {
    if (!strokeStarted.current) return;
    const after = new Map<string, FaceMap>();
    preparedRef.current.forEach(p => after.set(p.name, new Map(p.paintMap)));
    const delta = captureStrokeDelta(strokeSnapshotRef.current, after);
    if (delta.meshChanges.size > 0) historyRef.current.push(delta);
    strokeStarted.current = false;
    lastPaintPoint.current = null;
  }, [historyRef]);

  /* ── Finish selection tool ── */
  const finishSelection = useCallback((endPt: ScreenPoint) => {
    const startPt = selStartRef.current;
    if (!startPt) return;
    const rect = gl.domElement.getBoundingClientRect();
    const prepared = preparedRef.current;
    const selMode: SelectionMode = xray ? 'centroid' : 'centroid-visible';
    let result: { selected: Map<string, Set<number>> } | null = null;

    if (surfaceTool === 'boxSelect') {
      result = volumeBoxSelect(
        { x1: startPt.x, y1: startPt.y, x2: endPt.x, y2: endPt.y },
        prepared, camera, rect.width, rect.height, selMode,
      );
    } else if (surfaceTool === 'lassoSelect') {
      if (selPointsRef.current.length >= 3) {
        result = volumeLassoSelect(selPointsRef.current, prepared, camera, rect.width, rect.height, selMode);
      }
    } else if (surfaceTool === 'slabSelect') {
      result = volumeSlabSelect(new THREE.Vector3(0, 1, 0), slabMin, slabMax, prepared);
    }

    if (result) {
      scene.userData.applyVolumeFaces?.(result.selected, activeStrength.id, false);
    }
  }, [gl, camera, xray, surfaceTool, slabMin, slabMax, activeStrength, scene]);

  /* ── Space key for hand mode ── */
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

  /* ── Pointer events on canvas ── */
  useEffect(() => {
    if (!isActive) return;
    const canvas = gl.domElement;

    const getScreenPoint = (e: PointerEvent): ScreenPoint => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const removeOverlay = () => {
      overlayRef.current?.remove();
      overlayRef.current = null;
    };

    const resetSelection = () => {
      selStartRef.current = null;
      selPointsRef.current = [];
      selectingRef.current = false;
      removeOverlay();
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || surfaceTool === 'hand') return;
      if (e.altKey) { if (orbitRef.current) orbitRef.current.enabled = true; return; }

      if (isSelectionTool) {
        const pt = getScreenPoint(e);
        selStartRef.current = pt;
        selPointsRef.current = [pt];
        selectingRef.current = true;
        if (orbitRef.current) orbitRef.current.enabled = false;
        overlayRef.current = createOverlayDiv(surfaceTool);
        e.stopPropagation();
        return;
      }

      pointerDown.current = true;
      strokeStarted.current = false;
      lastPaintPoint.current = null;
      if (orbitRef.current) orbitRef.current.enabled = false;
      e.stopPropagation();
      paintAt(e);
    };

    let lastHoverTime = 0;
    const onMove = (e: PointerEvent) => {
      if (spaceHeld.current) return;

      if (selectingRef.current && isSelectionTool) {
        const pt = getScreenPoint(e);
        const rect = canvas.getBoundingClientRect();
        if (overlayRef.current) {
          if (surfaceTool === 'boxSelect' || surfaceTool === 'slabSelect') {
            syncBoxOverlay(overlayRef.current, selStartRef.current!, pt, rect);
          } else if (surfaceTool === 'lassoSelect') {
            selPointsRef.current.push(pt);
            syncLassoOverlay(overlayRef.current, selPointsRef.current, rect);
          }
        }
        return;
      }

      if (pointerDown.current) {
        paintAt(e);
      } else {
        const now = performance.now();
        if (now - lastHoverTime < 32) return;
        lastHoverTime = now;
        paintAt(e);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (selectingRef.current && isSelectionTool) {
        finishSelection(getScreenPoint(e));
        resetSelection();
        if (orbitRef.current) orbitRef.current.enabled = true;
        return;
      }
      commitStroke();
      pointerDown.current = false;
      if (orbitRef.current) orbitRef.current.enabled = true;
    };

    const onLeave = () => {
      if (selectingRef.current) resetSelection();
      commitStroke();
      pointerDown.current = false;
      if (orbitRef.current) orbitRef.current.enabled = true;
      if (brushRef.current) brushRef.current.visible = false;
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
  }, [gl, isActive, isSelectionTool, paintAt, orbitRef, surfaceTool, commitStroke, finishSelection]);

  /* ── Expose actions via scene.userData ── */
  useEffect(() => {
    const snapshotAll = (): Map<string, FaceMap> => {
      const s = new Map<string, FaceMap>();
      preparedRef.current.forEach(p => s.set(p.name, new Map(p.paintMap)));
      return s;
    };

    const withHistory = (fn: () => void) => {
      const before = snapshotAll();
      fn();
      const after = snapshotAll();
      const delta = captureStrokeDelta(before, after);
      if (delta.meshChanges.size > 0) historyRef.current.push(delta);
      preparedRef.current.forEach(p => applyFaceColors(p));
      emitChange();
    };

    const applyDelta = (delta: ReturnType<PaintHistory['undo']>, dir: 'undo' | 'redo') => {
      if (!delta) return;
      for (const [meshName, faceChanges] of delta.meshChanges) {
        const p = preparedRef.current.find(x => x.name === meshName);
        if (!p) continue;
        for (const [fi, change] of faceChanges) {
          const val = dir === 'undo' ? change.from : change.to;
          if (val === undefined) p.paintMap.delete(fi);
          else p.paintMap.set(fi, val);
        }
      }
      preparedRef.current.forEach(p => applyFaceColors(p));
      emitChange();
    };

    scene.userData.clearAllPaint = () => withHistory(() => {
      preparedRef.current.forEach(p => p.paintMap.clear());
    });

    scene.userData.invertSelection = () => withHistory(() => {
      preparedRef.current.forEach(p => {
        for (let fi = 0; fi < p.faceCount; fi++) {
          if (p.paintMap.has(fi)) p.paintMap.delete(fi);
          else p.paintMap.set(fi, activeStrength.id);
        }
      });
    });

    scene.userData.selectAll = () => withHistory(() => {
      preparedRef.current.forEach(p => {
        for (let fi = 0; fi < p.faceCount; fi++) p.paintMap.set(fi, activeStrength.id);
      });
    });

    scene.userData.undo = () => applyDelta(historyRef.current.undo(), 'undo');
    scene.userData.redo = () => applyDelta(historyRef.current.redo(), 'redo');

    scene.userData.applyVolumeFaces = (faces: Map<string, Set<number>>, strengthId: string, erase: boolean) => {
      withHistory(() => {
        for (const [meshName, faceSet] of faces) {
          const p = preparedRef.current.find(x => x.name === meshName);
          if (!p) continue;
          for (const fi of faceSet) {
            if (erase) p.paintMap.delete(fi);
            else p.paintMap.set(fi, strengthId);
          }
        }
      });
    };
  }, [scene, activeStrength, emitChange, historyRef]);

  /* ── Wireframe overlay ── */
  const wireframeGeos = useMemo(() => {
    if (!surfaceWireframe) return [];
    return preparedRef.current.map(p => ({
      uuid: p.mesh.uuid,
      geo: new THREE.WireframeGeometry(p.mesh.geometry),
      position: p.mesh.position.clone(),
      rotation: p.mesh.rotation.clone(),
      scale: p.mesh.scale.clone(),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceWireframe, preparedVersion]);

  if (!surfaceWireframe || wireframeGeos.length === 0) return null;

  return (
    <group>
      {wireframeGeos.map((w) => (
        <lineSegments key={w.uuid} geometry={w.geo} position={w.position} rotation={w.rotation} scale={w.scale}>
          <lineBasicMaterial color="#888" transparent opacity={0.15} depthTest />
        </lineSegments>
      ))}
    </group>
  );
};
