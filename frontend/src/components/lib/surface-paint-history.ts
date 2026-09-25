/**
 * surface-paint-history.ts — Snapshot-based undo/redo for VoxelGrid
 * Uses RLE compression to keep memory bounded (~10-50KB per snapshot).
 */
import type { VoxelGrid } from './voxel-grid';

export class SurfacePaintHistory {
  private readonly _maxSteps: number;
  private _undoStack: Uint8Array[] = [];
  private _redoStack: Uint8Array[] = [];

  constructor(maxSteps = 30) {
    this._maxSteps = maxSteps;
  }

  push(grid: VoxelGrid): void {
    this._undoStack.push(_rleCompress(grid.snapshot()));
    if (this._undoStack.length > this._maxSteps) this._undoStack.shift();
    this._redoStack.length = 0;
  }

  undo(grid: VoxelGrid): boolean {
    if (this._undoStack.length === 0) return false;
    this._redoStack.push(_rleCompress(grid.snapshot()));
    const prev = this._undoStack.pop()!;
    grid.restore(_rleDecompress(prev, grid.data.length));
    return true;
  }

  redo(grid: VoxelGrid): boolean {
    if (this._redoStack.length === 0) return false;
    this._undoStack.push(_rleCompress(grid.snapshot()));
    const next = this._redoStack.pop()!;
    grid.restore(_rleDecompress(next, grid.data.length));
    return true;
  }

  clear(): void {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
  }

  canUndo(): boolean { return this._undoStack.length > 0; }
  canRedo(): boolean { return this._redoStack.length > 0; }
}

function _rleCompress(data: Uint8Array): Uint8Array {
  const runs: number[] = [];
  let i = 0;
  while (i < data.length) {
    const val = data[i];
    let count = 1;
    while (i + count < data.length && data[i + count] === val && count < 255) count++;
    runs.push(val, count);
    i += count;
  }
  return new Uint8Array(runs);
}

function _rleDecompress(rle: Uint8Array, expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength);
  let pos = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const val = rle[i];
    const count = rle[i + 1];
    for (let j = 0; j < count && pos < expectedLength; j++) out[pos++] = val;
  }
  return out;
}
