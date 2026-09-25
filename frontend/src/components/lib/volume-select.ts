/**
 * volume-select.ts
 * BVH-accelerated volumetric face selection: box, lasso, slab (cross-section).
 * Supports X-ray (select-through) and visible-only modes.
 */
import * as THREE from 'three';
import { CONTAINED, INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';
import type { PreparedMesh } from './bvh-painter';

/* ── Types ── */

export type SelectionMode = 'centroid' | 'centroid-visible' | 'intersection';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface VolumeSelectResult {
  selected: Map<string, Set<number>>;
}

/* ── Helpers ── */

const _v3 = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _ray = new THREE.Ray();
const _centroid = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _toScreenMat = new THREE.Matrix4();

/** Project a local-space point to screen pixel coords */
function projectToScreen(
  point: THREE.Vector3,
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  width: number,
  height: number,
): { x: number; y: number; ndcZ: number } {
  _v3.copy(point).applyMatrix4(mesh.matrixWorld);
  _ndc.copy(_v3).project(camera);
  return {
    x: ((_ndc.x + 1) * 0.5) * width,
    y: ((1 - _ndc.y) * 0.5) * height,
    ndcZ: _ndc.z,
  };
}

function pointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
    const cross = (py - ay) * (bx - ax) - (px - ax) * (by - ay);
    if (Math.abs(cross) > 1e-10) return false;
    const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
    const lenSq = (bx - ax) ** 2 + (by - ay) ** 2;
    return dot >= 0 && dot <= lenSq;
}

/** Check if a 2D point is inside a convex or concave polygon (ray-casting) */
function pointInPolygon2D(px: number, py: number, polygon: ScreenPoint[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (pointOnSegment(px, py, polygon[j].x, polygon[j].y, polygon[i].x, polygon[i].y)) return true;
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > py) !== (yj > py)) {
      const xInt = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (px <= xInt) inside = !inside;
    }
  }
  return inside;
}

/** Check if a 2D point is inside an axis-aligned rect */
function pointInRect(px: number, py: number, x1: number, y1: number, x2: number, y2: number): boolean {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

/** Check if a face centroid is visible (not occluded) using BVH raycastFirst */
function isFaceVisible(
  centroidWorld: THREE.Vector3,
  camera: THREE.Camera,
  _prepared: PreparedMesh,
  allPrepared: PreparedMesh[],
): boolean {
  // Cast ray from camera to centroid
  _v3.set(0, 0, 0);
  camera.getWorldPosition(_v3);

  _ray.origin.copy(_v3);
  _ray.direction.copy(centroidWorld).sub(_v3).normalize();

  const distToCentroid = _v3.distanceTo(centroidWorld);

  for (const p of allPrepared) {
    const invMat = _mat4.copy(p.mesh.matrixWorld).invert();
    const localRay = _ray.clone().applyMatrix4(invMat);

    const hit = p.bvh.raycastFirst(localRay, THREE.DoubleSide);
    if (hit) {
      // Transform hit distance to world space
      _v3b.copy(hit.point).applyMatrix4(p.mesh.matrixWorld);
      const hitDist = _v3.distanceTo(_v3b);
      // Restore camPos for next iteration
      camera.getWorldPosition(_v3);
      // If something is closer than our centroid (with tolerance), it's occluded
      const tolerance = distToCentroid * 0.001;
      if (hitDist < distToCentroid - tolerance) {
        return false;
      }
    }
  }
  return true;
}

/* ── Box Select ── */

/**
 * Select faces whose centroids project inside a screen-space rectangle.
 * mode: 'centroid' = select-through, 'centroid-visible' = visible only
 */
export function volumeBoxSelect(
  rect: { x1: number; y1: number; x2: number; y2: number },
  prepared: PreparedMesh[],
  camera: THREE.Camera,
  canvasWidth: number,
  canvasHeight: number,
  mode: SelectionMode = 'centroid',
): VolumeSelectResult {
  const result = new Map<string, Set<number>>();

  camera.updateMatrixWorld();

  for (const p of prepared) {
    const selected = new Set<number>();
    const geo = p.mesh.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute('position');
    const src = posAttr.array as Float32Array;
    const itemSize = posAttr.itemSize;

    p.mesh.updateWorldMatrix(true, false);

    for (let fi = 0; fi < p.faceCount; fi++) {
      const base = fi * 3;
      const i0 = base * itemSize;
      const i1 = (base + 1) * itemSize;
      const i2 = (base + 2) * itemSize;

      _centroid.set(
        (src[i0] + src[i1] + src[i2]) / 3,
        (src[i0 + 1] + src[i1 + 1] + src[i2 + 1]) / 3,
        (src[i0 + 2] + src[i1 + 2] + src[i2 + 2]) / 3,
      );

      const screen = projectToScreen(_centroid, p.mesh, camera, canvasWidth, canvasHeight);

      // Skip faces behind camera
      if (screen.ndcZ < -1 || screen.ndcZ > 1) continue;

      if (pointInRect(screen.x, screen.y, rect.x1, rect.y1, rect.x2, rect.y2)) {
        if (mode === 'centroid-visible') {
          const worldCentroid = _centroid.clone().applyMatrix4(p.mesh.matrixWorld);
          if (!isFaceVisible(worldCentroid, camera, p, prepared)) continue;
        }
        selected.add(fi);
      }
    }

    result.set(p.name, selected);
  }

  return { selected: result };
}

/* ── Lasso Select ── */

/**
 * Select faces whose centroids project inside a screen-space polygon.
 */
export function volumeLassoSelect(
  polygon: ScreenPoint[],
  prepared: PreparedMesh[],
  camera: THREE.Camera,
  canvasWidth: number,
  canvasHeight: number,
  mode: SelectionMode = 'centroid',
): VolumeSelectResult {
  const result = new Map<string, Set<number>>();

  if (polygon.length < 3) return { selected: result };

  camera.updateMatrixWorld();

  for (const p of prepared) {
    const selected = new Set<number>();
    const geo = p.mesh.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute('position');
    const src = posAttr.array as Float32Array;
    const itemSize = posAttr.itemSize;

    p.mesh.updateWorldMatrix(true, false);

    for (let fi = 0; fi < p.faceCount; fi++) {
      const base = fi * 3;
      const i0 = base * itemSize;
      const i1 = (base + 1) * itemSize;
      const i2 = (base + 2) * itemSize;

      _centroid.set(
        (src[i0] + src[i1] + src[i2]) / 3,
        (src[i0 + 1] + src[i1 + 1] + src[i2 + 1]) / 3,
        (src[i0 + 2] + src[i1 + 2] + src[i2 + 2]) / 3,
      );

      const screen = projectToScreen(_centroid, p.mesh, camera, canvasWidth, canvasHeight);
      if (screen.ndcZ < -1 || screen.ndcZ > 1) continue;

      if (pointInPolygon2D(screen.x, screen.y, polygon)) {
        if (mode === 'centroid-visible') {
          const worldCentroid = _centroid.clone().applyMatrix4(p.mesh.matrixWorld);
          if (!isFaceVisible(worldCentroid, camera, p, prepared)) continue;
        }
        selected.add(fi);
      }
    }

    result.set(p.name, selected);
  }

  return { selected: result };
}

/* ── Slab (Cross-Section) Select ── */

/**
 * Select faces between two parallel planes (a slab).
 * Uses BVH shapecast for O(log n) performance.
 * planeNormal: direction of the slab (e.g. Y-axis for horizontal slice)
 * minD, maxD: signed distances along planeNormal defining the slab bounds
 */
export function volumeSlabSelect(
  planeNormal: THREE.Vector3,
  minD: number,
  maxD: number,
  prepared: PreparedMesh[],
): VolumeSelectResult {
  const result = new Map<string, Set<number>>();
  const normal = planeNormal.clone().normalize();

  for (const p of prepared) {
    const selected = new Set<number>();
    const invWorld = _mat4.copy(p.mesh.matrixWorld).invert();

    const localNormal = normal.clone().transformDirection(invWorld).normalize();
    const worldPointOnMinPlane = _v3.copy(normal).multiplyScalar(minD);
    const localPointOnMinPlane = worldPointOnMinPlane.applyMatrix4(invWorld);
    const localMinD = localPointOnMinPlane.dot(localNormal);
    const worldPointOnMaxPlane = _v3b.copy(normal).multiplyScalar(maxD);
    const localPointOnMaxPlane = worldPointOnMaxPlane.applyMatrix4(invWorld);
    const localMaxD = localPointOnMaxPlane.dot(localNormal);

    // Use BVH shapecast to quickly find faces within the slab
    p.bvh.shapecast({
      intersectsBounds: (box: THREE.Box3) => {
        // Project box corners onto slab normal to get box extent along that axis
        const corners = [
          new THREE.Vector3(box.min.x, box.min.y, box.min.z),
          new THREE.Vector3(box.max.x, box.min.y, box.min.z),
          new THREE.Vector3(box.min.x, box.max.y, box.min.z),
          new THREE.Vector3(box.max.x, box.max.y, box.min.z),
          new THREE.Vector3(box.min.x, box.min.y, box.max.z),
          new THREE.Vector3(box.max.x, box.min.y, box.max.z),
          new THREE.Vector3(box.min.x, box.max.y, box.max.z),
          new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        ];

        let boxMin = Infinity;
        let boxMax = -Infinity;
        for (const c of corners) {
          const d = c.dot(localNormal);
          if (d < boxMin) boxMin = d;
          if (d > boxMax) boxMax = d;
        }

        // If box is entirely within slab, all children are contained
        if (boxMin >= localMinD && boxMax <= localMaxD) return CONTAINED;
        // If box overlaps slab, need to check children
        if (boxMax >= localMinD && boxMin <= localMaxD) return INTERSECTED;
        // No overlap
        return NOT_INTERSECTED;
      },
      intersectsTriangle: (triangle: THREE.Triangle, triangleIndex: number, contained: boolean) => {
        if (contained) {
          selected.add(triangleIndex);
          return false;
        }

        // Check centroid against slab
        _centroid.set(0, 0, 0)
          .add(triangle.a).add(triangle.b).add(triangle.c)
          .multiplyScalar(1 / 3);

        const d = _centroid.dot(localNormal);
        if (d >= localMinD && d <= localMaxD) {
          selected.add(triangleIndex);
        }

        return false;
      },
    });

    result.set(p.name, selected);
  }

  return { selected: result };
}

/* ── BVH-Accelerated Box Select (Frustum-based) ── */

/**
 * High-performance box select using a frustum constructed from the selection rectangle.
 * Projects the 2D rect into a 3D frustum and uses BVH shapecast.
 * This is faster than per-face projection for large meshes.
 */
export function volumeFrustumBoxSelect(
  rect: { x1: number; y1: number; x2: number; y2: number },
  prepared: PreparedMesh[],
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  canvasWidth: number,
  canvasHeight: number,
  mode: SelectionMode = 'centroid',
): VolumeSelectResult {
  // For small selections or when visibility check needed, fall back to projection method
  if (mode === 'centroid-visible') {
    return volumeBoxSelect(rect, prepared, camera, canvasWidth, canvasHeight, mode);
  }

  camera.updateMatrixWorld();
  const projScreenMatrix = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

  const frustum = new THREE.Frustum();
  frustum.setFromProjectionMatrix(projScreenMatrix);

  const result = new Map<string, Set<number>>();

  for (const p of prepared) {
    const selected = new Set<number>();

    p.mesh.updateWorldMatrix(true, false);

    const meshBB = new THREE.Box3().setFromObject(p.mesh);
    if (!frustum.intersectsBox(meshBB)) {
      result.set(p.name, selected);
      continue;
    }

    const toScreenSpaceMatrix = _toScreenMat.copy(p.mesh.matrixWorld)
      .premultiply(camera.matrixWorldInverse)
      .premultiply(camera.projectionMatrix);

    const selMinX = Math.min(rect.x1, rect.x2);
    const selMaxX = Math.max(rect.x1, rect.x2);
    const selMinY = Math.min(rect.y1, rect.y2);
    const selMaxY = Math.max(rect.y1, rect.y2);

    p.bvh.shapecast({
      intersectsBounds: (box: THREE.Box3) => {
        const corners = [
          new THREE.Vector3(box.min.x, box.min.y, box.min.z),
          new THREE.Vector3(box.max.x, box.min.y, box.min.z),
          new THREE.Vector3(box.min.x, box.max.y, box.min.z),
          new THREE.Vector3(box.max.x, box.max.y, box.min.z),
          new THREE.Vector3(box.min.x, box.min.y, box.max.z),
          new THREE.Vector3(box.max.x, box.min.y, box.max.z),
          new THREE.Vector3(box.min.x, box.max.y, box.max.z),
          new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        ];

        let screenMinX = Infinity, screenMaxX = -Infinity;
        let screenMinY = Infinity, screenMaxY = -Infinity;
        for (const c of corners) {
          c.applyMatrix4(toScreenSpaceMatrix);
          const sx = ((c.x + 1) * 0.5) * canvasWidth;
          const sy = ((1 - c.y) * 0.5) * canvasHeight;
          if (sx < screenMinX) screenMinX = sx;
          if (sx > screenMaxX) screenMaxX = sx;
          if (sy < screenMinY) screenMinY = sy;
          if (sy > screenMaxY) screenMaxY = sy;
        }

        if (screenMaxX < selMinX || screenMinX > selMaxX ||
            screenMaxY < selMinY || screenMinY > selMaxY) {
          return NOT_INTERSECTED;
        }
        return INTERSECTED;
      },
      intersectsTriangle: (triangle: THREE.Triangle, triangleIndex: number) => {
        _centroid.set(0, 0, 0)
          .add(triangle.a).add(triangle.b).add(triangle.c)
          .multiplyScalar(1 / 3);

        const screen = projectToScreen(_centroid, p.mesh, camera, canvasWidth, canvasHeight);
        if (screen.ndcZ < -1 || screen.ndcZ > 1) return false;

        if (pointInRect(screen.x, screen.y, rect.x1, rect.y1, rect.x2, rect.y2)) {
          selected.add(triangleIndex);
        }
        return false;
      },
    });

    result.set(p.name, selected);
  }

  return { selected: result };
}
