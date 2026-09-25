import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import type { MagneticRegion, ParsedGcodePreview } from '../../types/gcode-preview';
import GcodeExtrusionLines from './GcodeExtrusionLines';
import PreviewViewportControls from '../preview-common/PreviewViewportControls';
import { Line, OrbitControls, TextLabel, type OrbitControlsLike } from '../preview-common/ThreeControls';

interface Props {
  preview: ParsedGcodePreview;
  showTravel: boolean;
  currentLayer: number | null;
  showGrid: boolean;
  showAxes: boolean;
  viewPreset?: GcodeViewPreset;
  viewResetSignal?: number;
}

export type GcodeViewPreset = 'perspective' | 'top' | 'front' | 'side';

const viewDirections: Record<GcodeViewPreset, [number, number, number]> = {
  perspective: [1, 1, 1],
  top: [0, 1, 0.001],
  front: [0, 0, 1],
  side: [1, 0, 0],
};

const GCODE_AXIS_COLORS = {
  x: '#EF4444',
  y: '#22C55E',
  z: '#3B82F6',
} as const;

const MAGNETIC_DIRECTION_COLORS: Record<string, string> = {
  'X+': '#F97316', 'X-': '#FB7185',
  'Y+': '#22C55E', 'Y-': '#84CC16',
  'Z+': '#A855F7', 'Z-': '#06B6D4',
};

const magneticColor = (region: MagneticRegion) => {
  const directionColor = region.direction ? MAGNETIC_DIRECTION_COLORS[region.direction] : undefined;
  if (directionColor) return directionColor;
  if (region.strength >= 75) return '#EF4444';
  if (region.strength >= 40) return '#F59E0B';
  return '#3B82F6';
};

const MAGNETIC_GRID_SIZE = 5;

const MagneticGridRegion: React.FC<{ region: MagneticRegion; color: string }> = ({ region, color }) => {
  const { geometry, material } = useMemo(() => {
    const cells = new Map<string, { x: number; y: number; z: number }>();
    const addPoint = (x: number, y: number, z: number) => {
      const cellX = Math.floor(x / MAGNETIC_GRID_SIZE);
      const cellY = Math.floor(y / MAGNETIC_GRID_SIZE);
      const layer = Math.round(z * 100) / 100;
      cells.set(`${cellX}:${cellY}:${layer}`, {
        x: (cellX + 0.5) * MAGNETIC_GRID_SIZE,
        y: (cellY + 0.5) * MAGNETIC_GRID_SIZE,
        z: layer + 0.22,
      });
    };
    for (const segment of region.segments) {
      const distance = Math.hypot(
        segment.to[0] - segment.from[0],
        segment.to[1] - segment.from[1],
        segment.to[2] - segment.from[2],
      );
      const steps = Math.max(1, Math.ceil(distance / (MAGNETIC_GRID_SIZE * 0.55)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        addPoint(
          segment.from[0] + (segment.to[0] - segment.from[0]) * t,
          segment.from[1] + (segment.to[1] - segment.from[1]) * t,
          segment.from[2] + (segment.to[2] - segment.from[2]) * t,
        );
      }
    }

    const positions: number[] = [];
    for (const cell of cells.values()) {
      const half = MAGNETIC_GRID_SIZE / 2;
      const x0 = cell.x - half;
      const x1 = cell.x + half;
      const y0 = cell.y - half;
      const y1 = cell.y + half;
      positions.push(
        x0, y0, cell.z, x1, y0, cell.z, x1, y1, cell.z,
        x0, y0, cell.z, x1, y1, cell.z, x0, y1, cell.z,
      );
    }
    const nextGeometry = new THREE.BufferGeometry();
    nextGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    nextGeometry.computeBoundingSphere();
    const nextMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    return { geometry: nextGeometry, material: nextMaterial };
  }, [region, color]);

  React.useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
};

const DEFAULT_PRINTER_BED = {
  width: 250,
  depth: 210,
} as const;

const BED_PADDING_MM = 12;
const BED_SURFACE_Y = -0.22;
const BED_GRID_STEP_MM = 10;

type BedFootprint = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  depth: number;
  center: [number, number, number];
};

const normalizeBound = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

const toBedPoint = (x: number, y: number, yOffset = 0) => new THREE.Vector3(x, BED_SURFACE_Y + yOffset, -y);

const computeBedFootprint = (preview: ParsedGcodePreview): BedFootprint => {
  const boundsMinX = normalizeBound(preview.bounds.min[0], 0);
  const boundsMaxX = normalizeBound(preview.bounds.max[0], 0);
  const boundsMinY = normalizeBound(preview.bounds.min[1], 0);
  const boundsMaxY = normalizeBound(preview.bounds.max[1], 0);

  const minX = Math.min(0, Math.min(boundsMinX, boundsMaxX) - BED_PADDING_MM);
  const maxX = Math.max(DEFAULT_PRINTER_BED.width, Math.max(boundsMinX, boundsMaxX) + BED_PADDING_MM);
  const minY = Math.min(0, Math.min(boundsMinY, boundsMaxY) - BED_PADDING_MM);
  const maxY = Math.max(DEFAULT_PRINTER_BED.depth, Math.max(boundsMinY, boundsMaxY) + BED_PADDING_MM);
  const width = Math.max(maxX - minX, DEFAULT_PRINTER_BED.width);
  const depth = Math.max(maxY - minY, DEFAULT_PRINTER_BED.depth);

  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    depth,
    center: [(minX + maxX) / 2, BED_SURFACE_Y - 0.03, -(minY + maxY) / 2],
  };
};

const SegmentLines: React.FC<{
  positions: Float32Array;
  color: string;
}> = ({ positions, color }) => {
  const points = useMemo(() => {
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i < positions.length; i += 6) {
      arr.push(new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]));
      arr.push(new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]));
    }
    return arr;
  }, [positions]);

  if (points.length === 0) return null;
  return <Line points={points} color={color} lineWidth={0.8} />;
};

const LayerFilteredPreview: React.FC<{
  preview: ParsedGcodePreview;
  showTravel: boolean;
  currentLayer: number | null;
}> = ({ preview, showTravel, currentLayer }) => {
  const extrusionSegments = useMemo(() => {
    if (currentLayer == null) return preview.extrusionSegments;
    return preview.extrusionSegments.filter(s => s.layerIndex === currentLayer);
  }, [preview.extrusionSegments, currentLayer]);

  const travelPositions = useMemo(() => {
    if (!showTravel) return new Float32Array();
    if (currentLayer == null) return preview.travelPositions;
    const segs = preview.travelSegments.filter(s => s.layerIndex === currentLayer);
    const arr: number[] = [];
    for (const s of segs) {
      arr.push(...s.from, ...s.to);
    }
    return new Float32Array(arr);
  }, [preview.travelPositions, preview.travelSegments, currentLayer, showTravel]);

  const totalLayers = preview.layers.length || 1;

  console.log('[GcodePreview] Rendering', extrusionSegments.length, 'extrusion segments,', totalLayers, 'layers, bounds:', preview.bounds);

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <GcodeExtrusionLines segments={extrusionSegments} totalLayers={totalLayers} />
      {showTravel && <SegmentLines positions={travelPositions} color="#94A3B8" />}
    </group>
  );
};

const MagneticPathOverlay: React.FC<{
  preview: ParsedGcodePreview;
  currentLayer: number | null;
}> = ({ preview, currentLayer }) => {
  const regions = useMemo(() => {
    // Slicers often emit MAG_OFF/MAG_ON between adjacent toolpath pieces and
    // layers. Endpoint distance is therefore not reliable: group by the actual
    // magnetic parameters so one preview contains one label per parameter set.
    const grouped = new Map<string, MagneticRegion>();
    for (const region of preview.magneticRegions) {
      const segments = currentLayer == null
        ? region.segments
        : region.segments.filter((s) => s.layerIndex === currentLayer);
      for (const segment of segments) {
        const key = `${segment.direction ?? 'none'}|${segment.strength}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.segments.push(segment);
        } else {
          grouped.set(key, {
            id: grouped.size + 1,
            strength: segment.strength,
            direction: segment.direction,
            segments: [segment],
          });
        }
      }
    }
    return Array.from(grouped.values());
  }, [preview.magneticRegions, currentLayer]);

  return <group rotation={[-Math.PI / 2, 0, 0]}>
    {regions.map((region) => {
      const points = region.segments.flatMap((segment) => [
        new THREE.Vector3(segment.from[0], segment.from[1] + 0.45, segment.from[2]),
        new THREE.Vector3(segment.to[0], segment.to[1] + 0.45, segment.to[2]),
      ]);
      const middle = region.segments[Math.floor(region.segments.length / 2)];
      const label = `充磁${region.id}：${region.direction ?? '未指定'}，S=${region.strength}`;
      return <group key={region.id}>
        <MagneticGridRegion region={region} color={magneticColor(region)} />
        <Line points={points} color={magneticColor(region)} lineWidth={3.2} />
        <TextLabel
          text={label}
          position={[middle.to[0], middle.to[1] + 3, middle.to[2]]}
          color={magneticColor(region)}
          scale={5.5}
        />
      </group>;
    })}
  </group>;
};

const GcodeBedGrid: React.FC<{ footprint: BedFootprint }> = ({ footprint }) => {
  const { geometry, material } = useMemo(() => {
    const positions: number[] = [];
    const pushLine = (from: THREE.Vector3, to: THREE.Vector3) => {
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    };

    for (let x = Math.ceil(footprint.minX / BED_GRID_STEP_MM) * BED_GRID_STEP_MM; x <= footprint.maxX; x += BED_GRID_STEP_MM) {
      pushLine(toBedPoint(x, footprint.minY, 0.02), toBedPoint(x, footprint.maxY, 0.02));
    }

    for (let y = Math.ceil(footprint.minY / BED_GRID_STEP_MM) * BED_GRID_STEP_MM; y <= footprint.maxY; y += BED_GRID_STEP_MM) {
      pushLine(toBedPoint(footprint.minX, y, 0.02), toBedPoint(footprint.maxX, y, 0.02));
    }

    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const gridMaterial = new THREE.LineBasicMaterial({
      color: '#475569',
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    });
    return { geometry: gridGeometry, material: gridMaterial };
  }, [footprint]);

  React.useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <lineSegments args={[geometry, material]} frustumCulled={false} />;
};

const GcodeBedPlate: React.FC<{
  footprint: BedFootprint;
  showGrid: boolean;
}> = ({ footprint, showGrid }) => {
  const framePoints = useMemo(() => [
    toBedPoint(footprint.minX, footprint.minY, 0.05),
    toBedPoint(footprint.maxX, footprint.minY, 0.05),
    toBedPoint(footprint.maxX, footprint.maxY, 0.05),
    toBedPoint(footprint.minX, footprint.maxY, 0.05),
    toBedPoint(footprint.minX, footprint.minY, 0.05),
  ], [footprint]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={footprint.center} receiveShadow>
        <planeGeometry args={[footprint.width, footprint.depth]} />
        <meshStandardMaterial color="#111827" roughness={0.98} metalness={0} transparent opacity={0.62} />
      </mesh>
      {showGrid && <GcodeBedGrid footprint={footprint} />}
      <Line points={framePoints} color="#CBD5E1" lineWidth={1.6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, BED_SURFACE_Y + 0.08, 0]}>
        <circleGeometry args={[2.4, 32]} />
        <meshBasicMaterial color="#F8FAFC" transparent opacity={0.9} />
      </mesh>
      <TextLabel text="0,0" position={[4, BED_SURFACE_Y + 1.5, -4]} scale={8} />
    </group>
  );
};

const GcodeAxisLine: React.FC<{
  label: string;
  color: string;
  end: [number, number, number];
  coneRotation: [number, number, number];
}> = ({ label, color, end, coneRotation }) => {
  const start: [number, number, number] = [0, BED_SURFACE_Y + 0.35, 0];

  return (
    <group>
      <Line points={[start, end]} color={color} lineWidth={2.4} />
      <mesh position={end} rotation={coneRotation}>
        <coneGeometry args={[1.6, 5, 18]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <TextLabel text={label} position={end} color={color} scale={8} />
    </group>
  );
};

const GcodeAxisHelper: React.FC<{ footprint: BedFootprint }> = ({ footprint }) => {
  const axisLength = Math.min(62, Math.max(34, Math.max(footprint.width, footprint.depth) * 0.22));
  const baseY = BED_SURFACE_Y + 0.35;

  return (
    <group>
      <GcodeAxisLine
        label="+X"
        color={GCODE_AXIS_COLORS.x}
        end={[axisLength, baseY, 0]}
        coneRotation={[0, 0, -Math.PI / 2]}
      />
      <GcodeAxisLine
        label="+Y"
        color={GCODE_AXIS_COLORS.y}
        end={[0, baseY, -axisLength]}
        coneRotation={[-Math.PI / 2, 0, 0]}
      />
      <GcodeAxisLine
        label="+Z"
        color={GCODE_AXIS_COLORS.z}
        end={[0, BED_SURFACE_Y + axisLength, 0]}
        coneRotation={[0, 0, 0]}
      />
    </group>
  );
};

const GcodePreviewCanvas: React.FC<Props> = ({ preview, showTravel, currentLayer, showGrid, showAxes, viewPreset = 'perspective', viewResetSignal = 0 }) => {
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = React.useRef<OrbitControlsLike | null>(null);

  const bedFootprint = useMemo(() => computeBedFootprint(preview), [preview]);

  const toolpathCenter = useMemo((): [number, number, number] => {
    const rawX = (preview.bounds.min[0] + preview.bounds.max[0]) / 2;
    const rawY = (preview.bounds.min[1] + preview.bounds.max[1]) / 2;
    const rawZ = (preview.bounds.min[2] + preview.bounds.max[2]) / 2;
    // After rotation [-PI/2, 0, 0]: Y_scene = Z_gcode, Z_scene = -Y_gcode
    return [rawX, rawZ, -rawY];
  }, [preview.bounds]);

  const fitDistance = useMemo(() => {
    const spanX = Math.max(bedFootprint.width, preview.bounds.max[0] - preview.bounds.min[0]);
    const spanY = Math.max(bedFootprint.depth, preview.bounds.max[1] - preview.bounds.min[1]);
    const spanZ = preview.bounds.max[2] - preview.bounds.min[2];
    const maxSpan = Math.max(spanX, spanY, spanZ, 1);
    return Math.max(120, maxSpan * 1.55);
  }, [bedFootprint, preview.bounds]);

  const setView = React.useCallback((preset: GcodeViewPreset) => {
    if (!cameraRef.current) return;
    const direction = new THREE.Vector3(...viewDirections[preset]).normalize();
    const position = new THREE.Vector3(...toolpathCenter).add(direction.multiplyScalar(fitDistance));
    cameraRef.current.position.set(position.x, position.y, position.z);
    cameraRef.current.near = Math.max(0.1, fitDistance / 1000);
    cameraRef.current.far = Math.max(2000, fitDistance * 4);
    cameraRef.current.updateProjectionMatrix();
    cameraRef.current.lookAt(...toolpathCenter);
    orbitRef.current?.target.set(...toolpathCenter);
    orbitRef.current?.update();
  }, [fitDistance, toolpathCenter]);

  React.useEffect(() => {
    setView(viewPreset);
  }, [setView, viewPreset, viewResetSignal]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <PreviewViewportControls
        onTop={() => setView('top')}
        onFront={() => setView('front')}
        onSide={() => setView('side')}
        onPerspective={() => setView('perspective')}
        onReset={() => setView('perspective')}
        showAxes={showAxes}
      />
      <Canvas
        camera={{ position: [120, 120, 120], fov: 50 }}
        style={{ width: '100%', height: '100%' }}
        onCreated={({ camera }) => {
          cameraRef.current = camera as THREE.PerspectiveCamera;
          setView(viewPreset);
        }}
      >
        <color attach="background" args={["#0F172A"]} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[100, 120, 100]} intensity={1.0} />
        <directionalLight position={[-80, 80, -60]} intensity={0.35} color="#FFD7B0" />
        <directionalLight position={[0, 40, -120]} intensity={0.5} color="#FFE8D6" />
        <GcodeBedPlate footprint={bedFootprint} showGrid={showGrid} />
        {showAxes && <GcodeAxisHelper footprint={bedFootprint} />}
        <LayerFilteredPreview preview={preview} showTravel={showTravel} currentLayer={currentLayer} />
        <MagneticPathOverlay preview={preview} currentLayer={currentLayer} />
        <OrbitControls ref={orbitRef} makeDefault />
      </Canvas>
    </div>
  );
};

export default GcodePreviewCanvas;
