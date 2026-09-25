/**
 * volume-intersection.ts — BVH 加速体积-网格相交计算
 */
import * as THREE from 'three';
import type { VolumeRegion, VolumeMethod, VolumeTransform } from './editor-types';
import type { PreparedMesh } from './bvh-painter';

const _mat4 = new THREE.Matrix4();
const _invMat4 = new THREE.Matrix4();
const _tempVec = new THREE.Vector3();
const _sphere = new THREE.Sphere();

/* ═══ Transform helpers ═══ */

export function volumeTransformToMatrix(transform: VolumeTransform): THREE.Matrix4 {
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3(...transform.position);
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(transform.rotation[0]),
    THREE.MathUtils.degToRad(transform.rotation[1]),
    THREE.MathUtils.degToRad(transform.rotation[2]),
  );
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const scale = new THREE.Vector3(...transform.scale);
  mat.compose(pos, quat, scale);
  return mat;
}

export function createVolumeGeometry(method: VolumeMethod): THREE.BufferGeometry {
  switch (method) {
    case 'box': return new THREE.BoxGeometry(1, 1, 1);
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    case 'sphere': return new THREE.SphereGeometry(0.5, 32, 16);
  }
}

/* ═══ Unit shape tests ═══ */

function boundsIntersectsUnitShape(method: VolumeMethod, box: THREE.Box3): boolean {
  switch (method) {
    case 'box':
      return box.max.x >= -0.5 && box.min.x <= 0.5
          && box.max.y >= -0.5 && box.min.y <= 0.5
          && box.max.z >= -0.5 && box.min.z <= 0.5;
    case 'sphere':
      _sphere.set(_tempVec.set(0, 0, 0), 0.5);
      return _sphere.intersectsBox(box);
    case 'cylinder': {
      if (box.max.y < -0.5 || box.min.y > 0.5) return false;
      const closestX = Math.max(box.min.x, Math.min(0, box.max.x));
      const closestZ = Math.max(box.min.z, Math.min(0, box.max.z));
      return (closestX * closestX + closestZ * closestZ) <= 0.25;
    }
  }
}

function pointInsideUnitShape(method: VolumeMethod, point: THREE.Vector3): boolean {
  switch (method) {
    case 'box':
      return Math.abs(point.x) <= 0.5
          && Math.abs(point.y) <= 0.5
          && Math.abs(point.z) <= 0.5;
    case 'sphere':
      return point.lengthSq() <= 0.25;
    case 'cylinder':
      if (Math.abs(point.y) > 0.5) return false;
      return (point.x * point.x + point.z * point.z) <= 0.25;
  }
}

/* ═══ Main intersection ═══ */

/**
 * 计算 VolumeRegion 与 PreparedMesh 列表的面级相交。
 * 返回 Map<meshName, Set<faceIndex>>。
 */
export function computeVolumeIntersection(
  region: VolumeRegion,
  prepared: PreparedMesh[],
): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  const volumeMatrix = volumeTransformToMatrix(region.transform);
  const volumeInverse = _invMat4.copy(volumeMatrix).invert();

  for (const p of prepared) {
    const hits = new Set<number>();
    p.mesh.updateWorldMatrix(true, false);

    // meshToVolume = volumeInverse * meshWorld
    const meshToVolume = _mat4.copy(volumeInverse).multiply(p.mesh.matrixWorld);

    p.bvh.shapecast({
      intersectsBounds: (box) => {
        const transformedBox = box.clone().applyMatrix4(meshToVolume);
        return boundsIntersectsUnitShape(region.method, transformedBox) ? 2 : 0;
      },
      intersectsTriangle: (tri, faceIndex) => {
        const a = tri.a.clone().applyMatrix4(meshToVolume);
        const b = tri.b.clone().applyMatrix4(meshToVolume);
        const c = tri.c.clone().applyMatrix4(meshToVolume);
        if (pointInsideUnitShape(region.method, a)
         && pointInsideUnitShape(region.method, b)
         && pointInsideUnitShape(region.method, c)) {
          hits.add(faceIndex);
        }
        return false;
      },
    });

    if (hits.size > 0) {
      result.set(p.name, hits);
    }
  }
  return result;
}

/**
 * 从 pending volume transform 直接计算相交（不需要完整 VolumeRegion）。
 */
export function computePendingIntersection(
  method: VolumeMethod,
  transform: VolumeTransform,
  prepared: PreparedMesh[],
): Map<string, Set<number>> {
  const fakeRegion: VolumeRegion = {
    region_id: '__pending__',
    name: '',
    type: 'magnetic_volume',
    method,
    transform,
    tag: 'magnetic',
    z_range: { z_min: -Infinity, z_max: Infinity },
  };
  return computeVolumeIntersection(fakeRegion, prepared);
}

/**
 * 计算相交面的 Z 范围（世界坐标）。
 */
export function computeZRange(
  intersected: Map<string, Set<number>>,
  prepared: PreparedMesh[],
): { z_min: number; z_max: number } {
  let zMin = Infinity;
  let zMax = -Infinity;

  for (const [meshName, faces] of intersected) {
    const p = prepared.find(x => x.name === meshName);
    if (!p) continue;

    const geo = p.mesh.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute('position');
    const src = posAttr.array as Float32Array;
    const itemSize = posAttr.itemSize;

    p.mesh.updateWorldMatrix(true, false);

    for (const fi of faces) {
      const base = fi * 3;
      for (let v = 0; v < 3; v++) {
        const idx = (base + v) * itemSize;
        _tempVec.set(src[idx], src[idx + 1], src[idx + 2]);
        _tempVec.applyMatrix4(p.mesh.matrixWorld);
        if (_tempVec.y < zMin) zMin = _tempVec.y;
        if (_tempVec.y > zMax) zMax = _tempVec.y;
      }
    }
  }

  return { z_min: zMin === Infinity ? 0 : zMin, z_max: zMax === -Infinity ? 0 : zMax };
}

