import React, { useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { GridMagnetCell, GridMagnetDirection, GridMagnetization, GridSelectionMode } from '../../stores/project';

const DIRECTIONS: GridMagnetDirection[] = ['X+', 'X-', 'Y+', 'Y-', 'Z+', 'Z-'];
const MAX_CELLS = 4000;

export interface GridSpec {
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  dimensions: [number, number, number];
  cellSize: number;
}

export function createGridSpec(box: THREE.Box3, cellSize: number): GridSpec {
  const size = box.getSize(new THREE.Vector3());
  const safeCellSize = Math.max(0.1, cellSize);
  const dimensions: [number, number, number] = [
    Math.max(1, Math.ceil(size.x / safeCellSize)),
    Math.max(1, Math.ceil(size.y / safeCellSize)),
    Math.max(1, Math.ceil(size.z / safeCellSize)),
  ];
  const bboxMin: [number, number, number] = [box.min.x, box.min.y, box.min.z];
  const bboxMax: [number, number, number] = [
    box.min.x + dimensions[0] * safeCellSize,
    box.min.y + dimensions[1] * safeCellSize,
    box.min.z + dimensions[2] * safeCellSize,
  ];
  return { bboxMin, bboxMax, dimensions, cellSize: safeCellSize };
}

export function gridCellCount(dimensions: [number, number, number]): number {
  return dimensions[0] * dimensions[1] * dimensions[2];
}

export function gridCellKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

interface Props {
  modelCenter: THREE.Vector3;
  grid: GridMagnetization | null;
  selectedCells: Set<string>;
  onToggleCell: (key: string, additive: boolean) => void;
  selectionMode?: GridSelectionMode;
  onSelectCells?: (keys: string[], additive: boolean) => void;
  onGroupReady?: (group: THREE.Group | null) => void;
  validCellKeys?: Set<string> | null;
}

const directionColor = (direction: GridMagnetDirection, strength: number) => {
  const colorByDirection: Record<GridMagnetDirection, string> = {
    'X+': '#E85D3F',
    'X-': '#E6A23C',
    'Y+': '#36A269',
    'Y-': '#2CA6A4',
    'Z+': '#3D78D8',
    'Z-': '#A653C7',
  };
  const normalizedStrength = Math.max(0, Math.min(1, Math.abs(strength)));
  const color = new THREE.Color(colorByDirection[direction]);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return color.setHSL(hsl.h, hsl.s, 0.35 + normalizedStrength * 0.22);
};

export const GridMagnetizationOverlay: React.FC<Props> = ({ modelCenter, grid, selectedCells, onToggleCell, selectionMode = 'click', onSelectCells, onGroupReady, validCellKeys }) => {
  const { camera, gl } = useThree();
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragKeys = useRef<Set<string>>(new Set());
  const lassoPoints = useRef<Array<{ x: number; y: number }>>([]);
  const cellCenters = useRef<Map<string, THREE.Vector3>>(new Map());
  const { group, centers } = useMemo(() => {
    // 实体检测完成前隐藏包围盒内的全部单元，避免把空腔误认为实体。
    if (!grid || validCellKeys === null) return { group: null, centers: new Map<string, THREE.Vector3>() };
    const group = new THREE.Group();
    const centers = new Map<string, THREE.Vector3>();
    group.name = 'grid-magnetization-overlay';
    group.renderOrder = 1000;
    const [nx, ny, nz] = grid.dimensions;
    const total = gridCellCount(grid.dimensions);
    if (total > MAX_CELLS) return { group: null, centers };
    const geometry = new THREE.BoxGeometry(grid.cellSize * 0.96, grid.cellSize * 0.96, grid.cellSize * 0.96);
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const key = gridCellKey(x, y, z);
          const value = grid.activeCells[key];
          const selected = selectedCells.has(key);
          const material = new THREE.MeshBasicMaterial({
            color: value ? directionColor(value.direction, value.strength) : '#000000',
            transparent: true,
            opacity: selected ? 0.9 : value ? 0.58 : 0.18,
            wireframe: true,
            depthTest: false,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.renderOrder = 1001;
          mesh.position.set(
            grid.bboxMin[0] + (x + 0.5) * grid.cellSize - modelCenter.x,
            grid.bboxMin[1] + (y + 0.5) * grid.cellSize - modelCenter.y,
            grid.bboxMin[2] + (z + 0.5) * grid.cellSize - modelCenter.z,
          );
          mesh.userData.gridCellKey = key;
          mesh.userData.gridCell = value as GridMagnetCell | undefined;
          mesh.onBeforeRender = () => undefined;
          centers.set(key, mesh.position.clone());
          group.add(mesh);
        }
      }
    }
    return { group, centers };
  }, [grid, modelCenter, selectedCells, validCellKeys]);

  React.useEffect(() => {
    cellCenters.current = centers;
    onGroupReady?.(group);
    return () => {
      cellCenters.current = new Map();
      onGroupReady?.(null);
    };
  }, [centers, group, onGroupReady]);

  if (!group) return null;
  const screenPoint = (point: THREE.Vector3) => {
    const projected = point.clone().project(camera);
    return { x: (projected.x + 1) * gl.domElement.clientWidth / 2, y: (-projected.y + 1) * gl.domElement.clientHeight / 2 };
  };
  const keysInRect = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    const minX = Math.min(start.x, end.x); const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y); const maxY = Math.max(start.y, end.y);
    return [...cellCenters.current].filter(([, center]) => { const p = screenPoint(center); return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY; }).map(([key]) => key);
  };
  const keysInLasso = (points: Array<{ x: number; y: number }>) => {
    if (points.length < 3) return [];
    const contains = (point: { x: number; y: number }) => {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i]; const b = points[j];
        if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    return [...cellCenters.current].filter(([, center]) => contains(screenPoint(center))).map(([key]) => key);
  };
  const handleDown = (event: ThreeEvent<PointerEvent>) => {
    const key = event.object.userData.gridCellKey as string | undefined;
    const shiftKey = event.nativeEvent.shiftKey;
    if (!key || !shiftKey) return;
    event.stopPropagation();
    const point = { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY };
    if (selectionMode === 'click') { onToggleCell(key, true); return; }
    dragStart.current = point;
    dragKeys.current = new Set([key]);
    lassoPoints.current = [point];
    gl.domElement.setPointerCapture?.(event.pointerId);
  };
  const handleMove = (event: ThreeEvent<PointerEvent>) => {
    if (!dragStart.current || !event.nativeEvent.shiftKey) return;
    event.stopPropagation();
    const point = { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY };
    if (selectionMode === 'lasso') {
      const previous = lassoPoints.current[lassoPoints.current.length - 1];
      if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 4) lassoPoints.current.push(point);
    }
    const keys = selectionMode === 'brush' ? keysInRect({ x: point.x - 24, y: point.y - 24 }, { x: point.x + 24, y: point.y + 24 }) : keysInRect(dragStart.current, point);
    keys.forEach((key) => dragKeys.current.add(key));
  };
  const handleUp = (event: ThreeEvent<PointerEvent>) => {
    if (!dragStart.current) return;
    event.stopPropagation();
    const point = { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY };
    const keys = selectionMode === 'lasso' ? keysInLasso(lassoPoints.current) : selectionMode === 'box' ? keysInRect(dragStart.current, point) : [...dragKeys.current];
    onSelectCells?.(keys, event.nativeEvent.shiftKey);
    dragStart.current = null;
    dragKeys.current.clear();
    lassoPoints.current = [];
    gl.domElement.releasePointerCapture?.(event.pointerId);
  };
  return <primitive object={group} onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={handleUp} />;
};

export { DIRECTIONS, MAX_CELLS };
