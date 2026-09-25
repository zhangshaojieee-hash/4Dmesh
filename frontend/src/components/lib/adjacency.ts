import * as THREE from 'three';

export function faceCount(geo: THREE.BufferGeometry): number {
  const position = geo.getAttribute('position');
  return position ? Math.floor(position.count / 3) : 0;
}

function positionKey(x: number, y: number, z: number): string {
  return `${Math.round(x * 1e6)}_${Math.round(y * 1e6)}_${Math.round(z * 1e6)}`;
}

function edgeKey(hashA: string, hashB: string): string {
  return hashA < hashB ? `${hashA}|${hashB}` : `${hashB}|${hashA}`;
}

export function buildAdjacency(geo: THREE.BufferGeometry): Map<number, number[]> {
  const position = geo.getAttribute('position');
  if (!position) return new Map();

  const totalFaces = faceCount(geo);
  const source = position.array as Float32Array;
  const itemSize = position.itemSize;

  // Build edge -> face list map
  const edgeFaces = new Map<string, number[]>();

  for (let face = 0; face < totalFaces; face++) {
    const base = face * 3;
    const hashes: string[] = [];

    for (let v = 0; v < 3; v++) {
      const idx = (base + v) * itemSize;
      hashes.push(positionKey(source[idx], source[idx + 1], source[idx + 2]));
    }

    // 3 edges per face: (0,1), (1,2), (2,0)
    const edges = [
      edgeKey(hashes[0], hashes[1]),
      edgeKey(hashes[1], hashes[2]),
      edgeKey(hashes[2], hashes[0]),
    ];

    for (const ek of edges) {
      const list = edgeFaces.get(ek);
      if (list) {
        list.push(face);
      } else {
        edgeFaces.set(ek, [face]);
      }
    }
  }

  // Build adjacency from shared edges
  const adjacency = new Map<number, number[]>();

  for (let face = 0; face < totalFaces; face++) {
    adjacency.set(face, []);
  }

  for (const faces of edgeFaces.values()) {
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const a = faces[i];
        const b = faces[j];
        adjacency.get(a)!.push(b);
        adjacency.get(b)!.push(a);
      }
    }
  }

  return adjacency;
}

export function floodFill(
  startFace: number,
  paintMap: Map<number, string>,
  adj: Map<number, number[]>,
  fillId: string,
  forceOverwrite: boolean,
): Set<number> {
  const changed = new Set<number>();
  const startState = paintMap.get(startFace);

  // If not forcing and start face already has the target paint, nothing to do
  if (!forceOverwrite && startState === fillId) return changed;

  const visited = new Set<number>();
  const queue: number[] = [startFace];
  visited.add(startFace);

  while (queue.length > 0) {
    const face = queue.shift()!;
    const currentState = paintMap.get(face);

    // Only flood through faces with the same original state as startFace
    if (face !== startFace && currentState !== startState) continue;

    // Apply paint
    if (currentState !== fillId) {
      if (fillId) {
        paintMap.set(face, fillId);
      } else {
        paintMap.delete(face);
      }
      changed.add(face);
    }

    // Expand to neighbors
    const neighbors = adj.get(face);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return changed;
}
