import * as THREE from 'three';

/**
 * ThreeMFLoader returns nested Groups that can contain duplicate mesh instances
 * (e.g. multiple build items referencing the same geometry resource).
 * This flattens the hierarchy into a single Group with unique meshes,
 * baking world transforms into each geometry.
 */
export function flatten3MFGroup(root: THREE.Group): THREE.Group {
  root.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  const seen = new Set<string>();

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) return;

    const geo = child.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position;
    if (!pos || pos.count === 0) return;

    // Dedup key: geometry UUID + world matrix (catches same geometry at same position)
    const m = child.matrixWorld;
    const key = `${geo.uuid}_${m.elements.map(v => v.toFixed(4)).join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);

    const clonedGeo = geo.clone();
    clonedGeo.applyMatrix4(child.matrixWorld);

    const mat = Array.isArray(child.material)
      ? (child.material.length > 1 && clonedGeo.groups.length > 0
          ? child.material.map(m => m.clone())
          : (child.material[0]?.clone() ?? new THREE.MeshStandardMaterial()))
      : (child.material as THREE.Material).clone();

    const mesh = new THREE.Mesh(clonedGeo, mat);
    mesh.name = child.name || `mesh_${meshes.length}`;
    meshes.push(mesh);
  });

  const flat = new THREE.Group();
  meshes.forEach((m) => flat.add(m));
  return flat;
}
