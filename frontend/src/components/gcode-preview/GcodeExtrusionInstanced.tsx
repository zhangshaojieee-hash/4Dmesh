import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ToolpathSegment } from '../../types/gcode-preview';

interface Props {
  segments: ToolpathSegment[];
}

const GcodeExtrusionInstanced: React.FC<Props> = ({ segments }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1, 1, 2, 1), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#F97316',
        roughness: 0.68,
        metalness: 0.02,
      }),
    [],
  );

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useLayoutEffect(() => {
    if (!meshRef.current) return;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const base = new THREE.Color('#F97316');

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const from = new THREE.Vector3(...seg.from);
      const to = new THREE.Vector3(...seg.to);
      const dir = to.clone().sub(from);
      const length = Math.max(seg.length, 0.001);
      const center = from.clone().add(to).multiplyScalar(0.5);
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(1, 0, 0),
        dir.clone().normalize(),
      );

      const width = Math.max(seg.estimatedWidth * 0.9, 0.06);
      const height = Math.max(seg.estimatedHeight * 0.65, 0.03);

      dummy.position.copy(center);
      dummy.quaternion.copy(quat);
      dummy.scale.set(length, width, height);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      const tint = 0.94 + (seg.layerIndex % 6) * 0.012;
      color.copy(base).multiplyScalar(tint);
      meshRef.current.setColorAt(i, color);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  }, [segments]);

  if (segments.length === 0) return null;

  return <instancedMesh ref={meshRef} args={[geometry, material, segments.length]} castShadow receiveShadow />;
};

export default GcodeExtrusionInstanced;
