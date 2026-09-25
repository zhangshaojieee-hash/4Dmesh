import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useEditor } from '../../stores/editor';
import { createVolumeGeometry, volumeTransformToMatrix } from '../lib/volume-intersection';
import { MAGNET_PRESETS } from '../../types';
import type { VolumeRegion } from '../lib/editor-types';

const VolumeOverlayGizmo: React.FC<{ region: VolumeRegion }> = ({ region }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => createVolumeGeometry(region.method), [region.method]);
  const wireGeo = useMemo(() => new THREE.WireframeGeometry(geo), [geo]);
  const color = MAGNET_PRESETS.find(p => p.id === region.strengthId)?.color ?? '#4FC3F7';

  useEffect(() => {
    if (!meshRef.current) return;
    const mat = volumeTransformToMatrix(region.transform);
    meshRef.current.position.setFromMatrixPosition(mat);
    meshRef.current.rotation.setFromRotationMatrix(mat);
    meshRef.current.scale.setFromMatrixScale(mat);
  }, [region.transform]);

  return (
    <mesh ref={meshRef} geometry={geo}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.12}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
      <lineSegments geometry={wireGeo} raycast={() => null}>
        <lineBasicMaterial color={color} transparent opacity={0.3} depthTest />
      </lineSegments>
    </mesh>
  );
};

export const VolumeWireframeOverlay: React.FC = () => {
  const { volumeRegions } = useEditor();
  const regions = volumeRegions ?? [];
  if (regions.length === 0) return null;
  return (
    <>
      {regions.map(r => (
        <VolumeOverlayGizmo key={r.region_id} region={r} />
      ))}
    </>
  );
};
