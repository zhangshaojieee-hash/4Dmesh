import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { ToolpathSegment } from '../../types/gcode-preview';

interface Props {
  segments: ToolpathSegment[];
  totalLayers: number;
}

/**
 * Lightweight line-based G-code extrusion renderer.
 * Uses THREE.LineSegments which can handle millions of segments
 * without crashing WebGL context (unlike InstancedMesh with boxes).
 * 
 * Uses imperative geometry setup for maximum compatibility with R3F.
 */
const GcodeExtrusionLines: React.FC<Props> = ({ segments, totalLayers }) => {
  const ref = useRef<THREE.LineSegments>(null);

  const { geometry, material } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const mat = new THREE.LineBasicMaterial({ vertexColors: true });

    if (segments.length === 0) return { geometry: geo, material: mat };

    const pos = new Float32Array(segments.length * 6);
    const col = new Float32Array(segments.length * 6);

    const coolColor = new THREE.Color('#3B82F6');
    const hotColor  = new THREE.Color('#EF4444');
    const baseColor = new THREE.Color('#F97316');

    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const off = i * 6;
      pos[off]     = s.from[0];
      pos[off + 1] = s.from[1];
      pos[off + 2] = s.from[2];
      pos[off + 3] = s.to[0];
      pos[off + 4] = s.to[1];
      pos[off + 5] = s.to[2];

      // Color by layer height for visual depth
      const t = totalLayers > 1 ? s.layerIndex / (totalLayers - 1) : 0.5;
      const c = new THREE.Color().copy(coolColor).lerp(hotColor, t);
      c.lerp(baseColor, 0.35);

      col[off]     = c.r;
      col[off + 1] = c.g;
      col[off + 2] = c.b;
      col[off + 3] = c.r;
      col[off + 4] = c.g;
      col[off + 5] = c.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();

    return { geometry: geo, material: mat };
  }, [segments, totalLayers]);

  // Cleanup
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  if (segments.length === 0) return null;

  return (
    <lineSegments
      ref={ref}
      args={[geometry, material]}
      frustumCulled={false}
    />
  );
};

export default GcodeExtrusionLines;
