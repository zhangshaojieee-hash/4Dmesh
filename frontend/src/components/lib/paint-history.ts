export type FaceMap = Map<number, string>;

export interface FaceChange {
  from: string | undefined;
  to: string | undefined;
}

export interface PaintDelta {
  meshChanges: Map<string, Map<number, FaceChange>>;
}

const cloneDelta = (delta: PaintDelta): PaintDelta => {
  const meshChanges = new Map<string, Map<number, FaceChange>>();

  for (const [meshName, faceChanges] of delta.meshChanges) {
    const clonedFaceChanges = new Map<number, FaceChange>();
    for (const [faceIndex, change] of faceChanges) {
      clonedFaceChanges.set(faceIndex, { from: change.from, to: change.to });
    }
    if (clonedFaceChanges.size > 0) {
      meshChanges.set(meshName, clonedFaceChanges);
    }
  }

  return { meshChanges };
};

const isDeltaEmpty = (delta: PaintDelta): boolean => {
  for (const faceChanges of delta.meshChanges.values()) {
    if (faceChanges.size > 0) {
      return false;
    }
  }
  return true;
};

export class PaintHistory {
  private undoStack: PaintDelta[] = [];
  private redoStack: PaintDelta[] = [];
  private maxSteps = 100;

  push(delta: PaintDelta): void {
    if (isDeltaEmpty(delta)) {
      return;
    }

    this.undoStack.push(cloneDelta(delta));
    this.redoStack = [];

    if (this.undoStack.length > this.maxSteps) {
      this.undoStack.shift();
    }
  }

  undo(): PaintDelta | null {
    const delta = this.undoStack.pop();
    if (!delta) {
      return null;
    }

    this.redoStack.push(delta);
    return cloneDelta(delta);
  }

  redo(): PaintDelta | null {
    const delta = this.redoStack.pop();
    if (!delta) {
      return null;
    }

    this.undoStack.push(delta);
    return cloneDelta(delta);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

export function captureStrokeDelta(
  before: Map<string, FaceMap>,
  after: Map<string, FaceMap>,
): PaintDelta {
  const meshChanges = new Map<string, Map<number, FaceChange>>();
  const allMeshNames = new Set([...before.keys(), ...after.keys()]);

  for (const meshName of allMeshNames) {
    const beforeMap = before.get(meshName) ?? new Map<number, string>();
    const afterMap = after.get(meshName) ?? new Map<number, string>();
    const faceChanges = new Map<number, FaceChange>();
    const faceIndices = new Set([...beforeMap.keys(), ...afterMap.keys()]);

    for (const faceIndex of faceIndices) {
      const from = beforeMap.get(faceIndex);
      const to = afterMap.get(faceIndex);
      if (from !== to) {
        faceChanges.set(faceIndex, { from, to });
      }
    }

    if (faceChanges.size > 0) {
      meshChanges.set(meshName, faceChanges);
    }
  }

  return { meshChanges };
}

export function mergeDeltas(a: PaintDelta, b: PaintDelta): PaintDelta {
  const merged = cloneDelta(a);

  for (const [meshName, bFaceChanges] of b.meshChanges) {
    const targetFaceChanges = merged.meshChanges.get(meshName) ?? new Map<number, FaceChange>();

    for (const [faceIndex, bChange] of bFaceChanges) {
      const existing = targetFaceChanges.get(faceIndex);

      if (!existing) {
        if (bChange.from !== bChange.to) {
          targetFaceChanges.set(faceIndex, { from: bChange.from, to: bChange.to });
        }
        continue;
      }

      const composed: FaceChange = {
        from: existing.from,
        to: bChange.to,
      };

      if (composed.from === composed.to) {
        targetFaceChanges.delete(faceIndex);
      } else {
        targetFaceChanges.set(faceIndex, composed);
      }
    }

    if (targetFaceChanges.size > 0) {
      merged.meshChanges.set(meshName, targetFaceChanges);
    } else {
      merged.meshChanges.delete(meshName);
    }
  }

  return merged;
}

export function applyDelta(
  paintMaps: Map<string, FaceMap>,
  delta: PaintDelta,
  reverse: boolean,
): Set<string> {
  const modifiedMeshes = new Set<string>();

  for (const [meshName, faceChanges] of delta.meshChanges) {
    let meshMap = paintMaps.get(meshName);
    let meshWasModified = false;

    for (const [faceIndex, change] of faceChanges) {
      const targetValue = reverse ? change.from : change.to;

      if (targetValue === undefined) {
        if (meshMap?.has(faceIndex)) {
          meshMap.delete(faceIndex);
          meshWasModified = true;
        }
      } else {
        if (!meshMap) {
          meshMap = new Map<number, string>();
          paintMaps.set(meshName, meshMap);
        }

        if (meshMap.get(faceIndex) !== targetValue) {
          meshMap.set(faceIndex, targetValue);
          meshWasModified = true;
        }
      }
    }

    if (meshWasModified) {
      modifiedMeshes.add(meshName);
    }
  }

  return modifiedMeshes;
}

export function snapshotMap(fm: FaceMap): FaceMap {
  return new Map<number, string>(fm);
}
