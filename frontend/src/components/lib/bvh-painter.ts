import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, NOT_INTERSECTED, INTERSECTED, CONTAINED } from 'three-mesh-bvh';
import { MAGNET_PRESETS } from '../../types';

THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const BASE_GRAY = new THREE.Color(0.82, 0.82, 0.82);

const _mat4 = new THREE.Matrix4();
const _localPoint = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _tempVec = new THREE.Vector3();

const PRESET_COLOR_CACHE = new Map<string, THREE.Color>(
  MAGNET_PRESETS.map((preset) => [preset.id, new THREE.Color(preset.color)]),
);

export type FaceMap = Map<number, string>;
type BVHGeometry = THREE.BufferGeometry & { boundsTree?: unknown };

const _closestTarget = { point: new THREE.Vector3(), faceIndex: -1, distance: 0 };

export function getSurfaceNormalAtPoint(
  prepared: PreparedMesh,
  worldPoint: THREE.Vector3,
): THREE.Vector3 | null {
  const { mesh, bvh } = prepared;
  mesh.updateWorldMatrix(true, false);
  const inv = _mat4.copy(mesh.matrixWorld).invert();
  const localPt = _tempVec.copy(worldPoint).applyMatrix4(inv);

  const closest = bvh.closestPointToPoint(localPt, _closestTarget);
  if (!closest || _closestTarget.faceIndex < 0) return null;

  const posAttr = mesh.geometry.getAttribute('position');
  const i0 = _closestTarget.faceIndex * 3;
  const a = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
  const b = new THREE.Vector3().fromBufferAttribute(posAttr, i0 + 1);
  const c = new THREE.Vector3().fromBufferAttribute(posAttr, i0 + 2);
  const normal = new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).normalize();
  normal.transformDirection(mesh.matrixWorld);
  return normal;
}

export function getClosestFaceIndex(
  prepared: PreparedMesh,
  worldPoint: THREE.Vector3,
): number {
  const { mesh, bvh } = prepared;
  mesh.updateWorldMatrix(true, false);
  const inv = _mat4.copy(mesh.matrixWorld).invert();
  const localPt = _tempVec.copy(worldPoint).applyMatrix4(inv);
  bvh.closestPointToPoint(localPt, _closestTarget);
  return _closestTarget.faceIndex;
}

export interface PreparedMesh {
  mesh: THREE.Mesh;
  name: string;
  bvh: MeshBVH;
  faceCount: number;
  paintMap: FaceMap;
  origMaterial: THREE.Material;
  paintMaterial: THREE.MeshStandardMaterial;
}

function resolveOriginalMaterial(material: THREE.Material | THREE.Material[]): THREE.Material {
  return Array.isArray(material) ? material[0] : material;
}

export function ensureColorAttribute(geometry: THREE.BufferGeometry): THREE.BufferAttribute {
  const position = geometry.getAttribute('position');
  const vertexCount = position.count;
  let colors = geometry.getAttribute('color') as THREE.BufferAttribute | null;

  if (!colors || colors.count !== vertexCount || colors.itemSize !== 3) {
    colors = new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 3), 3);
    geometry.setAttribute('color', colors);
  }

  return colors;
}

export function setFaceColor(colors: THREE.BufferAttribute, faceIndex: number, color: THREE.Color): void {
  const v0 = faceIndex * 3;
  const v1 = v0 + 1;
  const v2 = v0 + 2;

  colors.setXYZ(v0, color.r, color.g, color.b);
  colors.setXYZ(v1, color.r, color.g, color.b);
  colors.setXYZ(v2, color.r, color.g, color.b);
}

export function prepareMesh(mesh: THREE.Mesh, name: string): PreparedMesh {
  const oldGeo = mesh.geometry;
  if (oldGeo.index) {
    const nonIndexed = oldGeo.toNonIndexed();
    mesh.geometry = nonIndexed;
    oldGeo.dispose();
  }

  const geometry = mesh.geometry as BVHGeometry;
  const bvh = new MeshBVH(geometry);
  (geometry as { boundsTree?: unknown }).boundsTree = bvh;

  const paintMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  const colors = ensureColorAttribute(geometry);
  for (let vertexIndex = 0; vertexIndex < colors.count; vertexIndex += 1) {
    colors.setXYZ(vertexIndex, BASE_GRAY.r, BASE_GRAY.g, BASE_GRAY.b);
  }
  colors.needsUpdate = true;

  const origMaterial = resolveOriginalMaterial(mesh.material as THREE.Material | THREE.Material[]);
  mesh.material = paintMaterial;

  const faceCount = (geometry.getAttribute('position').count / 3) | 0;

  return {
    mesh,
    name,
    bvh,
    faceCount,
    paintMap: new Map<number, string>(),
    origMaterial,
    paintMaterial,
  };
}

export function queryBrushFaces(
  prepared: PreparedMesh,
  worldPoint: THREE.Vector3,
  worldRadius: number,
  options?: {
    cameraPosition?: THREE.Vector3;
    maxFaces?: number;
  },
): Set<number> {
  const { mesh, bvh } = prepared;

  mesh.updateWorldMatrix(true, false);

  const inverseWorld = _mat4.copy(mesh.matrixWorld).invert();
  const localPoint = _localPoint.copy(worldPoint).applyMatrix4(inverseWorld);

  const _scaleVec = new THREE.Vector3();
  mesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), _scaleVec);
  const minScale = Math.min(Math.abs(_scaleVec.x), Math.abs(_scaleVec.y), Math.abs(_scaleVec.z));
  const localRadius = minScale > 0 ? worldRadius / minScale : worldRadius;

  _sphere.set(localPoint, localRadius);

  const maxFaces = options?.maxFaces ?? 0;
  let localCamDir: THREE.Vector3 | null = null;
  if (options?.cameraPosition) {
    localCamDir = options.cameraPosition.clone().applyMatrix4(inverseWorld).sub(localPoint).normalize();
  }

  const posAttr = mesh.geometry.getAttribute('position');
  const _triNormal = new THREE.Vector3();
  const _v0 = new THREE.Vector3();
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  const hits = new Set<number>();

  bvh.shapecast({
    intersectsBounds: (box) => {
      const intersects = _sphere.intersectsBox(box);
      if (intersects) {
        const { min, max } = box;
        for (let x = 0; x <= 1; x++)
          for (let y = 0; y <= 1; y++)
            for (let z = 0; z <= 1; z++) {
              _tempVec.set(
                x === 0 ? min.x : max.x,
                y === 0 ? min.y : max.y,
                z === 0 ? min.z : max.z,
              );
              if (!_sphere.containsPoint(_tempVec)) return INTERSECTED;
            }
        return CONTAINED;
      }
      return NOT_INTERSECTED;
    },
    intersectsTriangle: (tri, faceIndex, contained) => {
      if (maxFaces > 0 && hits.size >= maxFaces) return false;
      if (contained || tri.intersectsSphere(_sphere)) {
        const i0 = faceIndex * 3;
        _v0.fromBufferAttribute(posAttr, i0);
        _v1.fromBufferAttribute(posAttr, i0 + 1);
        _v2.fromBufferAttribute(posAttr, i0 + 2);

        if (localCamDir) {
          _triNormal.crossVectors(
            _v1.clone().sub(_v0),
            _v2.clone().sub(_v0),
          ).normalize();
          if (_triNormal.dot(localCamDir) < 0) return false;
        }

        hits.add(faceIndex);
      }
      return false;
    },
  });

  return hits;
}

export function applyFaceColors(prepared: PreparedMesh, dirtyFaces?: Set<number>): void {
  const geometry = prepared.mesh.geometry as THREE.BufferGeometry;
  const colors = ensureColorAttribute(geometry);

  const applyFace = (faceIndex: number): void => {
    if (faceIndex < 0 || faceIndex >= prepared.faceCount) return;
    const strengthId = prepared.paintMap.get(faceIndex);
    const color = strengthId ? PRESET_COLOR_CACHE.get(strengthId) ?? BASE_GRAY : BASE_GRAY;
    setFaceColor(colors, faceIndex, color);
  };

  if (dirtyFaces && dirtyFaces.size > 0) {
    dirtyFaces.forEach((faceIndex) => {
      applyFace(faceIndex);
    });
  } else {
    for (let faceIndex = 0; faceIndex < prepared.faceCount; faceIndex += 1) {
      applyFace(faceIndex);
    }
  }

  colors.needsUpdate = true;
}

export function interpolateBrushPoints(
  prev: THREE.Vector3,
  curr: THREE.Vector3,
  brushRadius: number,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];

  const distance = prev.distanceTo(curr);
  const spacing = brushRadius * 0.4;

  if (spacing <= 0 || distance <= spacing) {
    points.push(curr.clone());
    return points;
  }

  const steps = Math.ceil(distance / spacing);
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    points.push(new THREE.Vector3().lerpVectors(prev, curr, t));
  }

  return points;
}

export function exportPaintData(prepared: PreparedMesh[]): Record<string, Record<string, number[]>> {
  const result: Record<string, Record<string, number[]>> = {};
  for (const p of prepared) {
    const groups: Record<string, number[]> = {};
    p.paintMap.forEach((sid, fi) => {
      (groups[sid] ??= []).push(fi);
    });
    if (Object.keys(groups).length > 0) result[p.name] = groups;
  }
  return result;
}
