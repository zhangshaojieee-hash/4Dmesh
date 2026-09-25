import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditor, getBrushWorldRadius } from '../../stores/editor';
import { MAGNET_PRESETS } from '../../types';
import { VoxelGrid } from '../lib/voxel-grid';
import { updateSurfaceShaderUniforms } from '../lib/volume-shader';
import { SurfacePaintHistory } from '../lib/surface-paint-history';
import { interpolateBrushPoints } from '../lib/bvh-painter';
import type { OrbitControlsLike } from '../preview-common/ThreeControls';

function getModelMeshes(scene: THREE.Group): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry && child.visible) {
      if (child.geometry.type === 'RingGeometry' || child.geometry.type === 'WireframeGeometry' || child.geometry.type === 'SphereGeometry' || child.geometry.type === 'EdgesGeometry') return;
      meshes.push(child);
    }
  });
  return meshes;
}

function createBrushIndicator(): { group: THREE.Group; sphere: THREE.Mesh; dispose: () => void } {
  const sphereGeo = new THREE.SphereGeometry(1, 32, 24);
  const sphereMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.15,
    depthTest: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const wireGeo = new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 16, 12));
  const wireMat = new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.4,
    depthTest: true, depthWrite: false,
  });
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  const wire = new THREE.LineSegments(wireGeo, wireMat);
  const group = new THREE.Group();
  group.add(sphere);
  group.add(wire);
  group.visible = false;
  group.renderOrder = 999;
  return {
    group,
    sphere,
    dispose: () => { sphereGeo.dispose(); sphereMat.dispose(); wireGeo.dispose(); wireMat.dispose(); },
  };
}

export interface SurfaceEditLayerProps {
  scene: THREE.Group;
  orbitRef: React.MutableRefObject<OrbitControlsLike | null>;
  grid: VoxelGrid;
  history: SurfacePaintHistory;
  shaderMat: THREE.ShaderMaterial;
  savedMats: Map<THREE.Mesh, THREE.Material>;
}

export const SurfaceEditLayer: React.FC<SurfaceEditLayerProps> = ({ scene, orbitRef, grid, history, shaderMat, savedMats }) => {
  const { camera, raycaster, gl } = useThree();
  const state = useEditor();
  const { surfaceTool, brushNorm, paintThickness, activeStrengthIdx, modelExtent, volumeRegions, slabMin, slabMax } = state;

  const brushRef = useRef<{ group: THREE.Group; sphere: THREE.Mesh; dispose: () => void } | null>(null);
  const paintingRef = useRef(false);
  const prevPointRef = useRef<THREE.Vector3 | null>(null);
  const selStartRef = useRef<{ x: number; y: number } | null>(null);
  const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [, setHistoryRev] = useState(0);

  const strengthIdx = activeStrengthIdx + 1;
  const brushRadius = getBrushWorldRadius(brushNorm, modelExtent);

  const removeOverlay = useCallback(() => {
    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }
  }, []);

  useEffect(() => {
    for (const [mesh] of savedMats) {
      mesh.material = shaderMat;
    }
    updateSurfaceShaderUniforms(shaderMat, grid.getBBox(), grid.getTexture(), volumeRegions);

    const brush = createBrushIndicator();
    scene.add(brush.group);
    brushRef.current = brush;

    scene.userData.clearAllPaint = () => {
      history.push(grid);
      grid.clear();
      grid.uploadToTexture();
      updateSurfaceShaderUniforms(shaderMat, grid.getBBox(), grid.getTexture(), volumeRegions);
      setHistoryRev(r => r + 1);
    };
    scene.userData.selectAll = () => {
      history.push(grid);
      grid.fillAll(strengthIdx);
      grid.uploadToTexture();
      updateSurfaceShaderUniforms(shaderMat, grid.getBBox(), grid.getTexture(), volumeRegions);
      setHistoryRev(r => r + 1);
    };
    scene.userData.invertSelection = () => {
      history.push(grid);
      grid.invertWith(strengthIdx);
      grid.uploadToTexture();
      updateSurfaceShaderUniforms(shaderMat, grid.getBBox(), grid.getTexture(), volumeRegions);
      setHistoryRev(r => r + 1);
    };
    scene.userData.undo = () => {
      if (history.undo(grid)) {
        grid.uploadToTexture();
        updateSurfaceShaderUniforms(shaderMat, grid.getBBox(), grid.getTexture(), volumeRegions);
        setHistoryRev(r => r + 1);
      }
    };
    scene.userData.redo = () => {
      if (history.redo(grid)) {
        grid.uploadToTexture();
        updateSurfaceShaderUniforms(shaderMat, grid.getBBox(), grid.getTexture(), volumeRegions);
        setHistoryRev(r => r + 1);
      }
    };
    scene.userData.getSurfacePaintGrid = () => {
      if (!grid.hasAnyPaint()) return null;
      return grid.exportRLE();
    };
    scene.userData.getSurfaceDirection = () => state.activeDirection;

    return () => {
      for (const [mesh, mat] of savedMats) {
        if (mesh.material === shaderMat) mesh.material = mat;
      }
      brush.group.removeFromParent();
      brush.dispose();
      brushRef.current = null;
      removeOverlay();
      delete scene.userData.clearAllPaint;
      delete scene.userData.selectAll;
      delete scene.userData.invertSelection;
      delete scene.userData.undo;
      delete scene.userData.redo;
      delete scene.userData.getSurfacePaintGrid;
      delete scene.userData.getSurfaceDirection;
    };
  }, [scene, grid, history, shaderMat, savedMats, removeOverlay, state.activeDirection, strengthIdx, volumeRegions]);

  useEffect(() => {
    if (!shaderMat || !grid) return;
    updateSurfaceShaderUniforms(shaderMat, grid.getBBox(), grid.getTexture(), volumeRegions);
  }, [volumeRegions, shaderMat, grid]);

  const doRaycast = useCallback((e: PointerEvent): THREE.Intersection | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);
    const meshes = getModelMeshes(scene);
    const hits = raycaster.intersectObjects(meshes, false);
    return hits.length > 0 ? hits[0] : null;
  }, [gl, raycaster, camera, scene]);

  const paintSphere = useCallback((center: THREE.Vector3, isErase: boolean) => {
    if (!grid) return;
    const r = brushRadius * paintThickness;
    if (isErase) {
      grid.eraseSphere(center, r);
    } else {
      grid.rasterizeSphere(center, r, strengthIdx);
    }
  }, [brushRadius, paintThickness, strengthIdx, grid]);

  const refreshShader = useCallback(() => {
    if (!shaderMat || !grid) return;
    grid.uploadToTexture();
    updateSurfaceShaderUniforms(shaderMat, grid.getBBox(), grid.getTexture(), volumeRegions);
  }, [volumeRegions, shaderMat, grid]);

  const updateBrush = useCallback((hit: THREE.Intersection | null) => {
    const brush = brushRef.current;
    if (!brush) return;
    if (!hit) { brush.group.visible = false; return; }
    brush.group.position.copy(hit.point);
    const actualRadius = brushRadius * paintThickness;
    brush.group.scale.setScalar(actualRadius);
    brush.group.visible = true;
    const preset = MAGNET_PRESETS[activeStrengthIdx];
    const color = surfaceTool === 'eraser' ? '#ffffff' : (preset?.color ?? '#FF8C42');
    brush.group.children.forEach(c => {
      if (c instanceof THREE.Mesh) (c.material as THREE.MeshBasicMaterial).color.set(color);
      if (c instanceof THREE.LineSegments) (c.material as THREE.LineBasicMaterial).color.set(color);
    });
  }, [brushRadius, paintThickness, activeStrengthIdx, surfaceTool]);

  const ensureOverlay = useCallback(() => {
    if (overlayRef.current) return overlayRef.current;
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;pointer-events:none;border:2px dashed #FF8C42;background:rgba(255,140,66,0.08);z-index:9999;';
    document.body.appendChild(div);
    overlayRef.current = div;
    return div;
  }, []);

  const onPointerDown = useCallback((e: PointerEvent) => {
    if (e.button !== 0) return;
    if (surfaceTool === 'hand') return;
    if (e.altKey || e.ctrlKey) return;

    if (surfaceTool === 'brush' || surfaceTool === 'eraser') {
      const hit = doRaycast(e);
      if (!hit) return;
      paintingRef.current = true;
      prevPointRef.current = hit.point.clone();
      history.push(grid);
      paintSphere(hit.point, surfaceTool === 'eraser');
      refreshShader();
      if (orbitRef.current) orbitRef.current.enabled = false;
    } else if (surfaceTool === 'fill') {
      const hit = doRaycast(e);
      if (!hit) return;
      history.push(grid);
      grid.floodFill(hit.point, strengthIdx);
      refreshShader();
      setHistoryRev(r => r + 1);
    } else if (surfaceTool === 'boxSelect') {
      paintingRef.current = true;
      selStartRef.current = { x: e.clientX, y: e.clientY };
      if (orbitRef.current) orbitRef.current.enabled = false;
      const ov = ensureOverlay();
      ov.style.left = `${e.clientX}px`;
      ov.style.top = `${e.clientY}px`;
      ov.style.width = '0px';
      ov.style.height = '0px';
    } else if (surfaceTool === 'lassoSelect') {
      paintingRef.current = true;
      lassoPointsRef.current = [{ x: e.clientX, y: e.clientY }];
      if (orbitRef.current) orbitRef.current.enabled = false;
    } else if (surfaceTool === 'slabSelect') {
      history.push(grid);
      grid.rasterizeSlab(1, slabMin, slabMax, strengthIdx);
      refreshShader();
      setHistoryRev(r => r + 1);
    }
  }, [surfaceTool, doRaycast, paintSphere, refreshShader, orbitRef, strengthIdx, slabMin, slabMax, ensureOverlay, grid, history]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const hit = doRaycast(e);
    if (surfaceTool === 'brush' || surfaceTool === 'eraser') {
      updateBrush(hit);
    }
    if (!paintingRef.current) return;
    if ((surfaceTool === 'brush' || surfaceTool === 'eraser') && hit) {
      const prev = prevPointRef.current;
      if (prev) {
        const points = interpolateBrushPoints(prev, hit.point, brushRadius);
        for (const pt of points) paintSphere(pt, surfaceTool === 'eraser');
      }
      paintSphere(hit.point, surfaceTool === 'eraser');
      prevPointRef.current = hit.point.clone();
      refreshShader();
    } else if (surfaceTool === 'boxSelect' && selStartRef.current) {
      const ov = overlayRef.current;
      if (!ov) return;
      const s = selStartRef.current;
      const x = Math.min(s.x, e.clientX);
      const y = Math.min(s.y, e.clientY);
      const w = Math.abs(e.clientX - s.x);
      const h = Math.abs(e.clientY - s.y);
      ov.style.left = `${x}px`;
      ov.style.top = `${y}px`;
      ov.style.width = `${w}px`;
      ov.style.height = `${h}px`;
    } else if (surfaceTool === 'lassoSelect') {
      lassoPointsRef.current.push({ x: e.clientX, y: e.clientY });
    }
  }, [surfaceTool, doRaycast, updateBrush, paintSphere, refreshShader, brushRadius]);

  const onPointerUp = useCallback((e: PointerEvent) => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    prevPointRef.current = null;
    if (orbitRef.current) orbitRef.current.enabled = true;

    if (surfaceTool === 'boxSelect' && selStartRef.current) {
      const s = selStartRef.current;
      const rect = gl.domElement.getBoundingClientRect();
      const x1 = ((Math.min(s.x, e.clientX) - rect.left) / rect.width) * 2 - 1;
      const y1 = -(((Math.min(s.y, e.clientY) - rect.top) / rect.height) * 2 - 1);
      const x2 = ((Math.max(s.x, e.clientX) - rect.left) / rect.width) * 2 - 1;
      const y2 = -(((Math.max(s.y, e.clientY) - rect.top) / rect.height) * 2 - 1);
      if (Math.abs(x2 - x1) > 0.01 && Math.abs(y2 - y1) > 0.01) {
        history.push(grid);
        const canvasRect = { x1, y1: y2, x2, y2: y1 };
        grid.rasterizeProjectedBox(camera, canvasRect, rect.width, rect.height, paintThickness * brushRadius * 2, strengthIdx);
        refreshShader();
      }
      selStartRef.current = null;
      removeOverlay();
    } else if (surfaceTool === 'lassoSelect' && lassoPointsRef.current.length > 2) {
      const rect = gl.domElement.getBoundingClientRect();
      const polygon = lassoPointsRef.current.map(p => new THREE.Vector2(
        ((p.x - rect.left) / rect.width) * 2 - 1,
        -(((p.y - rect.top) / rect.height) * 2 - 1),
      ));
      history.push(grid);
      grid.rasterizeProjectedLasso(camera, polygon, rect.width, rect.height, paintThickness * brushRadius * 2, strengthIdx);
      refreshShader();
      lassoPointsRef.current = [];
    }

    setHistoryRev(r => r + 1);
  }, [orbitRef, surfaceTool, gl, camera, grid, history, refreshShader, strengthIdx, paintThickness, brushRadius, removeOverlay]);

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointerleave', onPointerUp);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointerleave', onPointerUp);
    };
  }, [gl, onPointerDown, onPointerMove, onPointerUp]);

  return null;
};
