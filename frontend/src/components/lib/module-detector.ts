/**
 * module-detector.ts — GLTF 层级模块检测 + 单 Mesh 连通分量分析
 *
 * 多子节点场景：每个 Group/Mesh 为一个模块候选（原有逻辑）。
 * 单 Mesh 场景：通过 Union-Find 连通分量分析拆分为虚拟模块。
 */
import * as THREE from 'three';
import type { ModuleCandidate } from './editor-types';

const MAX_FACES_FOR_ANALYSIS = 100_000;

// ─── Union-Find ───

class UnionFind {
  private parent: Uint32Array;
  private rank: Uint32Array;

  constructor(size: number) {
    this.parent = new Uint32Array(size);
    this.rank = new Uint32Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }
}

// ─── Spatial hash for non-indexed geometry (avoids O(n²) vertex comparison) ───

function spatialHashKey(x: number, y: number, z: number, cellSize: number): string {
  return `${Math.round(x / cellSize)},${Math.round(y / cellSize)},${Math.round(z / cellSize)}`;
}

function buildVertexMap(positions: Float32Array, vertexCount: number, epsilon: number): Map<number, number> {
  const cellSize = epsilon * 2;
  const buckets = new Map<string, number[]>();
  const canonical = new Map<number, number>();

  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const ix = Math.round(x / cellSize);
    const iy = Math.round(y / cellSize);
    const iz = Math.round(z / cellSize);

    let found = false;
    outer:
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = buckets.get(`${ix + dx},${iy + dy},${iz + dz}`);
          if (!bucket) continue;
          for (const j of bucket) {
            if (
              Math.abs(x - positions[j * 3]) +
              Math.abs(y - positions[j * 3 + 1]) +
              Math.abs(z - positions[j * 3 + 2]) < epsilon
            ) {
              canonical.set(i, canonical.get(j) ?? j);
              found = true;
              break outer;
            }
          }
        }
      }
    }

    if (!found) canonical.set(i, i);

    const key = spatialHashKey(x, y, z, cellSize);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = []; buckets.set(key, bucket); }
    bucket.push(i);
  }

  return canonical;
}

// ─── Connected component extraction ───

function extractComponents(faceCount: number, uf: UnionFind): Map<number, number[]> {
  const components = new Map<number, number[]>();
  for (let f = 0; f < faceCount; f++) {
    const root = uf.find(f);
    let arr = components.get(root);
    if (!arr) { arr = []; components.set(root, arr); }
    arr.push(f);
  }
  return components;
}

const ANGLE_THRESHOLD = Math.PI / 4; // 45 degrees — sharp creases become segment boundaries

function computeFaceNormals(
  positions: Float32Array,
  faceCount: number,
  getVertexIndex: (face: number, vert: number) => number,
): Float32Array {
  const normals = new Float32Array(faceCount * 3);
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();

  for (let f = 0; f < faceCount; f++) {
    const a = getVertexIndex(f, 0);
    const b = getVertexIndex(f, 1);
    const c = getVertexIndex(f, 2);
    vA.set(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]);
    vB.set(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]);
    vC.set(positions[c * 3], positions[c * 3 + 1], positions[c * 3 + 2]);
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    n.crossVectors(e1, e2).normalize();
    normals[f * 3] = n.x;
    normals[f * 3 + 1] = n.y;
    normals[f * 3 + 2] = n.z;
  }
  return normals;
}

function shouldUnion(normals: Float32Array, faceA: number, faceB: number): boolean {
  const ax = normals[faceA * 3], ay = normals[faceA * 3 + 1], az = normals[faceA * 3 + 2];
  const bx = normals[faceB * 3], by = normals[faceB * 3 + 1], bz = normals[faceB * 3 + 2];
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  return Math.acos(dot) < ANGLE_THRESHOLD;
}

function analyzeIndexedGeometry(geometry: THREE.BufferGeometry): Map<number, number[]> | null {
  const index = geometry.index;
  if (!index) return null;

  const posAttr = geometry.attributes.position;
  if (!posAttr) return null;
  const positions = posAttr.array as Float32Array;

  const indexArray = index.array;
  const faceCount = Math.floor(indexArray.length / 3);
  if (faceCount > MAX_FACES_FOR_ANALYSIS) {
    console.warn('Model too complex for automatic module detection');
    return null;
  }

  const normals = computeFaceNormals(positions, faceCount, (f, v) => indexArray[f * 3 + v]);

  const edgeToFace = new Map<string, number>();
  const uf = new UnionFind(faceCount);

  for (let f = 0; f < faceCount; f++) {
    const a = indexArray[f * 3];
    const b = indexArray[f * 3 + 1];
    const c = indexArray[f * 3 + 2];
    for (const ek of [
      a < b ? `${a}-${b}` : `${b}-${a}`,
      b < c ? `${b}-${c}` : `${c}-${b}`,
      a < c ? `${a}-${c}` : `${c}-${a}`,
    ]) {
      const existing = edgeToFace.get(ek);
      if (existing !== undefined) {
        if (shouldUnion(normals, f, existing)) uf.union(f, existing);
      } else {
        edgeToFace.set(ek, f);
      }
    }
  }

  return extractComponents(faceCount, uf);
}

function analyzeNonIndexedGeometry(geometry: THREE.BufferGeometry): Map<number, number[]> | null {
  const posAttr = geometry.attributes.position;
  if (!posAttr) return null;

  const positions = posAttr.array as Float32Array;
  const vertexCount = posAttr.count;
  const faceCount = Math.floor(vertexCount / 3);
  if (faceCount > MAX_FACES_FOR_ANALYSIS) {
    console.warn('Model too complex for automatic module detection');
    return null;
  }

  const normals = computeFaceNormals(positions, faceCount, (f, v) => f * 3 + v);

  const canonical = buildVertexMap(positions, vertexCount, 1e-4);
  const edgeToFace = new Map<string, number>();
  const uf = new UnionFind(faceCount);

  for (let f = 0; f < faceCount; f++) {
    const v0 = canonical.get(f * 3) ?? (f * 3);
    const v1 = canonical.get(f * 3 + 1) ?? (f * 3 + 1);
    const v2 = canonical.get(f * 3 + 2) ?? (f * 3 + 2);
    for (const ek of [
      v0 < v1 ? `${v0}-${v1}` : `${v1}-${v0}`,
      v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`,
      v0 < v2 ? `${v0}-${v2}` : `${v2}-${v0}`,
    ]) {
      const existing = edgeToFace.get(ek);
      if (existing !== undefined) {
        if (shouldUnion(normals, f, existing)) uf.union(f, existing);
      } else {
        edgeToFace.set(ek, f);
      }
    }
  }

  return extractComponents(faceCount, uf);
}

function splitSingleMesh(mesh: THREE.Mesh): ModuleCandidate[] {
  const geometry = mesh.geometry;
  if (!geometry) return [];

  const components = geometry.index
    ? analyzeIndexedGeometry(geometry)
    : analyzeNonIndexedGeometry(geometry);

  const meshName = mesh.name || 'mesh_0';
  mesh.name = meshName;

  if (!components || components.size <= 1) {
    return [{ id: `mod_cand_${meshName}`, name: meshName, meshNames: [meshName] }];
  }

  const candidates: ModuleCandidate[] = [];
  let partIdx = 0;
  for (const [, faces] of components) {
    candidates.push({
      id: `mod_cand_${meshName}_part${partIdx}`,
      name: `Part ${partIdx + 1}`,
      meshNames: [meshName],
      faceIndices: faces,
    });
    partIdx++;
  }
  return candidates;
}

// ─── Public API ───

export function detectModules(scene: THREE.Group): ModuleCandidate[] {
  const candidates: ModuleCandidate[] = [];

  let root: THREE.Object3D = scene;
  while (root.children.length === 1 && !(root.children[0] instanceof THREE.Mesh)) {
    root = root.children[0];
  }

  // Single-mesh: connected component analysis
  const meshChildren = root.children.filter(
    (c): c is THREE.Mesh => c instanceof THREE.Mesh && !!c.geometry,
  );
  if (root.children.length === 1 && meshChildren.length === 1) {
    return splitSingleMesh(meshChildren[0]);
  }
  // Unwrapped single Group containing exactly one Mesh
  if (root.children.length === 1 && !(root.children[0] instanceof THREE.Mesh)) {
    const allMeshes: THREE.Mesh[] = [];
    root.children[0].traverse((d) => { if (d instanceof THREE.Mesh && d.geometry) allMeshes.push(d); });
    if (allMeshes.length === 1) return splitSingleMesh(allMeshes[0]);
  }

  // Multi-mesh / multi-child: original logic
  root.children.forEach((child, idx) => {
    const meshNames: string[] = [];

    if (child instanceof THREE.Mesh && child.geometry) {
      const name = child.name || `mesh_${idx}`;
      child.name = name;
      meshNames.push(name);
    } else if (child instanceof THREE.Group || child instanceof THREE.Object3D) {
      child.traverse((desc) => {
        if (desc instanceof THREE.Mesh && desc.geometry) {
          if (!desc.name) desc.name = `mesh_${idx}_${meshNames.length}`;
          meshNames.push(desc.name);
        }
      });
    }

    if (meshNames.length > 0) {
      candidates.push({
        id: `mod_cand_${meshNames.slice().sort().join('|')}`,
        name: child.name || `模块 ${idx + 1}`,
        meshNames,
      });
    }
  });

  return candidates;
}

const _faceSetCache = new WeakMap<ModuleCandidate, Set<number>>();

function getFaceSet(c: ModuleCandidate): Set<number> | undefined {
  if (!c.faceIndices) return undefined;
  let s = _faceSetCache.get(c);
  if (!s) {
    s = new Set(c.faceIndices);
    _faceSetCache.set(c, s);
  }
  return s;
}

export function findCandidateByHit(
  hitMeshName: string,
  candidates: ModuleCandidate[],
  faceIndex?: number,
): ModuleCandidate | null {
  if (faceIndex !== undefined) {
    const byFace = candidates.find(c => {
      if (!c.meshNames.includes(hitMeshName)) return false;
      const faceSet = getFaceSet(c);
      return faceSet ? faceSet.has(faceIndex) : false;
    });
    if (byFace) return byFace;
  }
  return candidates.find(c => c.meshNames.includes(hitMeshName)) ?? null;
}

export function collectMeshes(
  scene: THREE.Group,
  meshNames: string[],
): THREE.Mesh[] {
  const nameSet = new Set(meshNames);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && nameSet.has(child.name)) {
      meshes.push(child);
    }
  });
  return meshes;
}
