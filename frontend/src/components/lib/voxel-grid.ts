/**
 * voxel-grid.ts — 3D voxel grid for spatial surface painting
 *
 * Rasterizes brush spheres, capsules, projected boxes/lassos, and slabs
 * into a 3D texture (Data3DTexture) for GPU-based rendering.
 * R channel encodes strengthId index: 0=unpainted, 1=strong, 2=medium, 3=weak.
 */
import * as THREE from 'three';

export class VoxelGrid {
  readonly resolution: number;
  readonly bbox: THREE.Box3;
  readonly voxelSize: number;
  readonly data: Uint8Array;
  private _texture: THREE.Data3DTexture | null = null;
  private readonly _bboxMin: THREE.Vector3;
  private readonly _bboxSize: THREE.Vector3;

  constructor(bbox: THREE.Box3, resolution = 128) {
    this.resolution = resolution;
    this.bbox = bbox.clone();
    this._bboxMin = bbox.min.clone();
    this._bboxSize = new THREE.Vector3();
    bbox.getSize(this._bboxSize);
    // Use max dimension for uniform voxel size
    const maxDim = Math.max(this._bboxSize.x, this._bboxSize.y, this._bboxSize.z);
    this.voxelSize = maxDim / resolution;
    this.data = new Uint8Array(resolution * resolution * resolution);
  }

  /* ── Coordinate conversion ── */

  private _worldToVoxel(world: THREE.Vector3, out: { x: number; y: number; z: number }): boolean {
    const x = Math.floor((world.x - this._bboxMin.x) / this.voxelSize);
    const y = Math.floor((world.y - this._bboxMin.y) / this.voxelSize);
    const z = Math.floor((world.z - this._bboxMin.z) / this.voxelSize);
    out.x = x; out.y = y; out.z = z;
    return x >= 0 && x < this.resolution && y >= 0 && y < this.resolution && z >= 0 && z < this.resolution;
  }

  private _voxelToWorld(ix: number, iy: number, iz: number, out: THREE.Vector3): void {
    out.set(
      this._bboxMin.x + (ix + 0.5) * this.voxelSize,
      this._bboxMin.y + (iy + 0.5) * this.voxelSize,
      this._bboxMin.z + (iz + 0.5) * this.voxelSize,
    );
  }

  private _idx(x: number, y: number, z: number): number {
    return x + y * this.resolution + z * this.resolution * this.resolution;
  }

  /* ── Rasterize operations ── */

  rasterizeSphere(center: THREE.Vector3, radius: number, value: number): void {
    const res = this.resolution;
    const vs = this.voxelSize;
    const minX = Math.max(0, Math.floor((center.x - radius - this._bboxMin.x) / vs));
    const maxX = Math.min(res - 1, Math.floor((center.x + radius - this._bboxMin.x) / vs));
    const minY = Math.max(0, Math.floor((center.y - radius - this._bboxMin.y) / vs));
    const maxY = Math.min(res - 1, Math.floor((center.y + radius - this._bboxMin.y) / vs));
    const minZ = Math.max(0, Math.floor((center.z - radius - this._bboxMin.z) / vs));
    const maxZ = Math.min(res - 1, Math.floor((center.z + radius - this._bboxMin.z) / vs));
    const r2 = radius * radius;

    for (let iz = minZ; iz <= maxZ; iz++) {
      const wz = this._bboxMin.z + (iz + 0.5) * vs;
      const dz = wz - center.z;
      for (let iy = minY; iy <= maxY; iy++) {
        const wy = this._bboxMin.y + (iy + 0.5) * vs;
        const dy = wy - center.y;
        const dyz2 = dy * dy + dz * dz;
        if (dyz2 > r2) continue;
        for (let ix = minX; ix <= maxX; ix++) {
          const wx = this._bboxMin.x + (ix + 0.5) * vs;
          const dx = wx - center.x;
          if (dx * dx + dyz2 <= r2) {
            this.data[this._idx(ix, iy, iz)] = value;
          }
        }
      }
    }
  }

  rasterizeCapsule(a: THREE.Vector3, b: THREE.Vector3, radius: number, value: number): void {
    const dist = a.distanceTo(b);
    const spacing = this.voxelSize * 0.7;
    if (dist <= spacing) {
      this.rasterizeSphere(b, radius, value);
      return;
    }
    const steps = Math.ceil(dist / spacing);
    const pt = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      pt.lerpVectors(a, b, i / steps);
      this.rasterizeSphere(pt, radius, value);
    }
  }

  eraseSphere(center: THREE.Vector3, radius: number): void {
    this.rasterizeSphere(center, radius, 0);
  }

  rasterizeBox(boxMin: THREE.Vector3, boxMax: THREE.Vector3, value: number): void {
    const res = this.resolution;
    const vs = this.voxelSize;
    const x0 = Math.max(0, Math.floor((boxMin.x - this._bboxMin.x) / vs));
    const x1 = Math.min(res - 1, Math.floor((boxMax.x - this._bboxMin.x) / vs));
    const y0 = Math.max(0, Math.floor((boxMin.y - this._bboxMin.y) / vs));
    const y1 = Math.min(res - 1, Math.floor((boxMax.y - this._bboxMin.y) / vs));
    const z0 = Math.max(0, Math.floor((boxMin.z - this._bboxMin.z) / vs));
    const z1 = Math.min(res - 1, Math.floor((boxMax.z - this._bboxMin.z) / vs));
    for (let iz = z0; iz <= z1; iz++)
      for (let iy = y0; iy <= y1; iy++)
        for (let ix = x0; ix <= x1; ix++)
          this.data[this._idx(ix, iy, iz)] = value;
  }

  rasterizeProjectedBox(
    camera: THREE.Camera, rect: { x1: number; y1: number; x2: number; y2: number },
    canvasW: number, canvasH: number, depth: number, value: number,
  ): void {
    const res = this.resolution;
    const worldPt = new THREE.Vector3();
    const ndc = new THREE.Vector3();

    for (let iz = 0; iz < res; iz++) {
      for (let iy = 0; iy < res; iy++) {
        for (let ix = 0; ix < res; ix++) {
          this._voxelToWorld(ix, iy, iz, worldPt);
          ndc.copy(worldPt).project(camera);
          const sx = (ndc.x * 0.5 + 0.5) * canvasW;
          const sy = (1 - (ndc.y * 0.5 + 0.5)) * canvasH;
          if (sx >= rect.x1 && sx <= rect.x2 && sy >= rect.y1 && sy <= rect.y2 && ndc.z >= 0 && ndc.z <= depth) {
            this.data[this._idx(ix, iy, iz)] = value;
          }
        }
      }
    }
  }

  rasterizeProjectedLasso(
    camera: THREE.Camera, polygon: THREE.Vector2[],
    canvasW: number, canvasH: number, depth: number, value: number,
  ): void {
    const res = this.resolution;
    const worldPt = new THREE.Vector3();
    const ndc = new THREE.Vector3();

    for (let iz = 0; iz < res; iz++) {
      for (let iy = 0; iy < res; iy++) {
        for (let ix = 0; ix < res; ix++) {
          this._voxelToWorld(ix, iy, iz, worldPt);
          ndc.copy(worldPt).project(camera);
          const sx = (ndc.x * 0.5 + 0.5) * canvasW;
          const sy = (1 - (ndc.y * 0.5 + 0.5)) * canvasH;
          if (ndc.z >= 0 && ndc.z <= depth && _pointInPolygon(sx, sy, polygon)) {
            this.data[this._idx(ix, iy, iz)] = value;
          }
        }
      }
    }
  }

  rasterizeSlab(axisIndex: number, min: number, max: number, value: number): void {
    const res = this.resolution;
    const vs = this.voxelSize;
    for (let iz = 0; iz < res; iz++) {
      for (let iy = 0; iy < res; iy++) {
        for (let ix = 0; ix < res; ix++) {
          const coords = [
            this._bboxMin.x + (ix + 0.5) * vs,
            this._bboxMin.y + (iy + 0.5) * vs,
            this._bboxMin.z + (iz + 0.5) * vs,
          ];
          if (coords[axisIndex] >= min && coords[axisIndex] <= max) {
            this.data[this._idx(ix, iy, iz)] = value;
          }
        }
      }
    }
  }

  floodFill(startWorld: THREE.Vector3, value: number): void {
    const vox = { x: 0, y: 0, z: 0 };
    if (!this._worldToVoxel(startWorld, vox)) return;
    const startVal = this.data[this._idx(vox.x, vox.y, vox.z)];
    if (startVal === value) return;

    const res = this.resolution;
    const queue: number[] = [vox.x, vox.y, vox.z];
    const visited = new Uint8Array(res * res * res);
    visited[this._idx(vox.x, vox.y, vox.z)] = 1;

    const dirs = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
    while (queue.length > 0) {
      const z = queue.pop()!;
      const y = queue.pop()!;
      const x = queue.pop()!;
      const idx = this._idx(x, y, z);
      this.data[idx] = value;
      for (const [dx, dy, dz] of dirs) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || nx >= res || ny < 0 || ny >= res || nz < 0 || nz >= res) continue;
        const ni = this._idx(nx, ny, nz);
        if (visited[ni]) continue;
        if (this.data[ni] !== startVal) continue;
        visited[ni] = 1;
        queue.push(nx, ny, nz);
      }
    }
  }

  /* ── State management ── */

  clear(): void {
    this.data.fill(0);
  }

  invertWith(value: number): void {
    for (let i = 0; i < this.data.length; i++) {
      this.data[i] = this.data[i] === 0 ? value : (this.data[i] === value ? 0 : this.data[i]);
    }
  }

  fillAll(value: number): void {
    this.data.fill(value);
  }

  snapshot(): Uint8Array {
    return new Uint8Array(this.data);
  }

  restore(snap: Uint8Array): void {
    this.data.set(snap);
  }

  hasAnyPaint(): boolean {
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] !== 0) return true;
    }
    return false;
  }

  /* ── Texture ── */

  getTexture(): THREE.Data3DTexture {
    if (!this._texture) {
      const res = this.resolution;
      this._texture = new THREE.Data3DTexture(this.data, res, res, res);
      this._texture.format = THREE.RedFormat;
      this._texture.type = THREE.UnsignedByteType;
      this._texture.minFilter = THREE.NearestFilter;
      this._texture.magFilter = THREE.NearestFilter;
      this._texture.wrapS = THREE.ClampToEdgeWrapping;
      this._texture.wrapT = THREE.ClampToEdgeWrapping;
      this._texture.wrapR = THREE.ClampToEdgeWrapping;
      this._texture.unpackAlignment = 1;
      this._texture.needsUpdate = true;
    }
    return this._texture;
  }

  uploadToTexture(): void {
    const tex = this.getTexture();
    tex.needsUpdate = true;
  }

  dispose(): void {
    if (this._texture) {
      this._texture.dispose();
      this._texture = null;
    }
  }

  /* ── Export (RLE + base64) ── */

  exportRLE(): { bbox_min: number[]; bbox_max: number[]; resolution: number; data_b64: string } {
    const runs: number[] = [];
    let i = 0;
    const len = this.data.length;
    while (i < len) {
      const val = this.data[i];
      let count = 1;
      while (i + count < len && this.data[i + count] === val && count < 255) count++;
      runs.push(val, count);
      i += count;
    }
    const bytes = new Uint8Array(runs);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    const b64 = btoa(binary);
    return {
      bbox_min: [this.bbox.min.x, this.bbox.min.y, this.bbox.min.z],
      bbox_max: [this.bbox.max.x, this.bbox.max.y, this.bbox.max.z],
      resolution: this.resolution,
      data_b64: b64,
    };
  }

  getBBox(): THREE.Box3 {
    return this.bbox;
  }

  importRLE(payload: { resolution: number; data_b64: string }): boolean {
    if (!payload || payload.resolution !== this.resolution || typeof payload.data_b64 !== 'string') {
      return false;
    }
    let binary: string;
    try {
      binary = atob(payload.data_b64);
    } catch {
      return false;
    }
    const decoded = new Uint8Array(this.data.length);
    let writeIdx = 0;
    for (let i = 0; i + 1 < binary.length; i += 2) {
      const val = binary.charCodeAt(i);
      const count = binary.charCodeAt(i + 1);
      for (let c = 0; c < count && writeIdx < decoded.length; c++) {
        decoded[writeIdx++] = val;
      }
    }
    if (writeIdx !== decoded.length) return false;
    this.data.set(decoded);
    return true;
  }

  getResolution(): number {
    return this.resolution;
  }
}

/* ── Helpers ── */

function _pointInPolygon(px: number, py: number, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
