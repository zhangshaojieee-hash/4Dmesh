import type { MagneticRegion, MagneticToolpathSegment, ParsedGcodePreview, ToolpathLayerRange, ToolpathSegment } from '../../types/gcode-preview';

interface State {
  x: number;
  y: number;
  z: number;
  e: number;
  relative: boolean;
  extrusionRelative: boolean;
  extrusionOverride: boolean;
}

interface Point {
  x: number;
  y: number;
  z: number;
}

function absolute(current: number, next: number, relative: boolean): number {
  return relative ? current + next : next;
}

function absoluteExtrusion(current: number, next: number, state: State): number {
  const relative = state.extrusionOverride ? state.extrusionRelative : state.relative;
  return relative ? current + next : next;
}

function parseParams(instruction: string): Map<string, number> {
  const params = new Map<string, number>();
  const matches = instruction.matchAll(/([A-Z])\s*(-?(?:\d+\.?\d*|\.\d+))/gi);
  for (const match of matches) {
    const axis = match[1].toUpperCase();
    if (axis === 'G' || axis === 'M') continue;
    const value = parseFloat(match[2]);
    if (!Number.isNaN(value)) params.set(axis, value);
  }
  return params;
}

function normalizePositive(angle: number): number {
  const fullCircle = Math.PI * 2;
  let result = angle % fullCircle;
  if (result < 0) result += fullCircle;
  return result;
}

function sweepBetween(startAngle: number, endAngle: number, clockwise: boolean): number {
  if (clockwise) {
    const sweep = normalizePositive(startAngle - endAngle);
    return sweep === 0 ? Math.PI * 2 : sweep;
  }
  const sweep = normalizePositive(endAngle - startAngle);
  return sweep === 0 ? Math.PI * 2 : sweep;
}

function centerFromRadius(start: Point, end: Point, radiusValue: number, clockwise: boolean): Point | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.sqrt(dx * dx + dy * dy);
  const radius = Math.abs(radiusValue);
  if (chord === 0 || radius < chord / 2) return null;

  const midpointX = (start.x + end.x) / 2;
  const midpointY = (start.y + end.y) / 2;
  const height = Math.sqrt(Math.max(0, radius * radius - (chord / 2) * (chord / 2)));
  const normalX = -dy / chord;
  const normalY = dx / chord;
  const candidates: Point[] = [
    { x: midpointX + normalX * height, y: midpointY + normalY * height, z: start.z },
    { x: midpointX - normalX * height, y: midpointY - normalY * height, z: start.z },
  ];
  const wantsLargeArc = radiusValue < 0;
  return candidates.find((candidate) => {
    const startAngle = Math.atan2(start.y - candidate.y, start.x - candidate.x);
    const endAngle = Math.atan2(end.y - candidate.y, end.x - candidate.x);
    const sweep = sweepBetween(startAngle, endAngle, clockwise);
    return wantsLargeArc ? sweep > Math.PI : sweep <= Math.PI;
  }) ?? candidates[0];
}

export function parseGcodeToolpath(content: string): ParsedGcodePreview {
  const lines = content.split(/\r?\n/);
  const extrusionVerts: number[] = [];
  const travelVerts: number[] = [];
  const extrusionSegments: ToolpathSegment[] = [];
  const travelSegments: ToolpathSegment[] = [];
  const magneticSegments: MagneticToolpathSegment[] = [];
  const magneticRegions: MagneticRegion[] = [];
  const layers: ToolpathLayerRange[] = [];

  const bounds = {
    min: [Infinity, Infinity, Infinity] as [number, number, number],
    max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  };

  const state: State = {
    x: 0, y: 0, z: 0, e: 0,
    relative: false,
    extrusionRelative: false,
    extrusionOverride: false,
  };

  let currentLayer = -1;
  let currentLayerStart = 0;
  let currentLayerZ = 0;
  let activeMagnetic: { id: number; strength: number; direction: string | null } | null = null;

  const updateBounds = (x: number, y: number, z: number) => {
    if (x < bounds.min[0]) bounds.min[0] = x;
    if (y < bounds.min[1]) bounds.min[1] = y;
    if (z < bounds.min[2]) bounds.min[2] = z;
    if (x > bounds.max[0]) bounds.max[0] = x;
    if (y > bounds.max[1]) bounds.max[1] = y;
    if (z > bounds.max[2]) bounds.max[2] = z;
  };

  const finishLayer = (end: number) => {
    if (currentLayer >= 0) {
      layers.push({ index: currentLayer, z: currentLayerZ, start: currentLayerStart, end });
    }
  };

  const appendSegment = (from: Point, to: Point, extruding: boolean) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const layerIndex = currentLayer < 0 ? 0 : currentLayer;
    const estimatedHeight = 0.2;
    const estimatedWidth = 0.45;

    if (extruding) {
      extrusionVerts.push(from.x, from.y, from.z, to.x, to.y, to.z);
      extrusionSegments.push({
        from: [from.x, from.y, from.z],
        to: [to.x, to.y, to.z],
        layerIndex,
        z: to.z,
        length,
        estimatedWidth,
        estimatedHeight,
      });
      if (activeMagnetic) {
        const magneticSegment: MagneticToolpathSegment = {
          from: [from.x, from.y, from.z],
          to: [to.x, to.y, to.z],
          layerIndex,
          z: to.z,
          length,
          estimatedWidth,
          estimatedHeight,
          regionId: activeMagnetic.id,
          strength: activeMagnetic.strength,
          direction: activeMagnetic.direction,
        };
        magneticSegments.push(magneticSegment);
        magneticRegions[activeMagnetic.id - 1]?.segments.push(magneticSegment);
      }
      if (currentLayer < 0) {
        currentLayer = 0;
        currentLayerStart = 0;
        currentLayerZ = to.z;
      } else if (to.z !== currentLayerZ && to.z > currentLayerZ) {
        finishLayer(extrusionVerts.length / 6 - 1);
        currentLayer += 1;
        currentLayerStart = extrusionVerts.length / 6 - 1;
        currentLayerZ = to.z;
      }
    } else {
      travelVerts.push(from.x, from.y, from.z, to.x, to.y, to.z);
      travelSegments.push({
        from: [from.x, from.y, from.z],
        to: [to.x, to.y, to.z],
        layerIndex,
        z: to.z,
        length,
        estimatedWidth,
        estimatedHeight,
      });
      if (currentLayer >= 0 && to.z !== currentLayerZ && to.z > currentLayerZ && extrusionVerts.length / 6 === currentLayerStart) {
        currentLayerZ = to.z;
      }
    }
    updateBounds(from.x, from.y, from.z);
    updateBounds(to.x, to.y, to.z);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^;LAYER:?\s*\d+/i.test(line) || /^;LAYER_CHANGE\s*$/i.test(line)) {
      finishLayer(extrusionVerts.length / 6);
      const match = line.match(/^;LAYER:?\s*(\d+)/i);
      currentLayer = match ? parseInt(match[1], 10) : currentLayer + 1;
      currentLayerStart = extrusionVerts.length / 6;
      currentLayerZ = state.z;
      continue;
    }

    const instruction = line.split(';')[0].trim();
    if (!instruction) continue;

    const magneticMatch = instruction.match(/^MAG_ON\s+S\s*=\s*([-+]?\d*\.?\d+)(?:\s+DIR\s*=\s*([A-Z][+-]?))?/i);
    if (magneticMatch) {
      const id = magneticRegions.length + 1;
      const strength = parseFloat(magneticMatch[1]);
      const direction = magneticMatch[2]?.toUpperCase() ?? null;
      activeMagnetic = { id, strength, direction };
      magneticRegions.push({ id, strength, direction, segments: [] });
      continue;
    }
    if (/^MAG_OFF\b/i.test(instruction)) {
      activeMagnetic = null;
      continue;
    }

    const cmdMatch = instruction.match(/^([GMT])\s*0*(\d+)/i);
    const cmd = cmdMatch ? `${cmdMatch[1].toUpperCase()}${Number(cmdMatch[2])}` : null;
    if (!cmd) continue;

    if (cmd === 'G90') {
      state.relative = false;
      state.extrusionOverride = false;
      continue;
    }
    if (cmd === 'G91') {
      state.relative = true;
      state.extrusionOverride = false;
      continue;
    }
    if (cmd === 'M82') {
      state.extrusionOverride = true;
      state.extrusionRelative = false;
      continue;
    }
    if (cmd === 'M83') {
      state.extrusionOverride = true;
      state.extrusionRelative = true;
      continue;
    }
    if (cmd === 'G92') {
      const params = parseParams(instruction);
      for (const [axis, value] of params) {
        if (axis === 'X') state.x = value;
        else if (axis === 'Y') state.y = value;
        else if (axis === 'Z') state.z = value;
        else if (axis === 'E') state.e = value;
      }
      continue;
    }

    if (cmd !== 'G0' && cmd !== 'G1' && cmd !== 'G2' && cmd !== 'G3') continue;

    let nextX = state.x;
    let nextY = state.y;
    let nextZ = state.z;
    let nextE = state.e;

    const params = parseParams(instruction);
    for (const [axis, value] of params) {
      if (axis === 'X') nextX = absolute(state.x, value, state.relative);
      else if (axis === 'Y') nextY = absolute(state.y, value, state.relative);
      else if (axis === 'Z') nextZ = absolute(state.z, value, state.relative);
      else if (axis === 'E') nextE = absoluteExtrusion(state.e, value, state);
    }

    const moved = nextX !== state.x || nextY !== state.y || nextZ !== state.z;
    const deltaE = nextE - state.e;
    const startPoint: Point = { x: state.x, y: state.y, z: state.z };
    const endPoint: Point = { x: nextX, y: nextY, z: nextZ };

    if (cmd === 'G2' || cmd === 'G3') {
      const clockwise = cmd === 'G2';
      const hasIJ = params.has('I') || params.has('J');
      const center = hasIJ
        ? { x: state.x + (params.get('I') ?? 0), y: state.y + (params.get('J') ?? 0), z: state.z }
        : params.has('R')
          ? centerFromRadius(startPoint, endPoint, params.get('R') ?? 0, clockwise)
          : null;

      if (center) {
        const radius = Math.sqrt((state.x - center.x) ** 2 + (state.y - center.y) ** 2);
        const startAngle = Math.atan2(state.y - center.y, state.x - center.x);
        const endAngle = Math.atan2(nextY - center.y, nextX - center.x);
        const unsignedSweep = sweepBetween(startAngle, endAngle, clockwise);
        const signedSweep = clockwise ? -unsignedSweep : unsignedSweep;
        const steps = Math.min(720, Math.max(8, Math.ceil((Math.abs(signedSweep) * radius) / 1.5)));
        let previous = startPoint;
        for (let step = 1; step <= steps; step += 1) {
          const progress = step / steps;
          const angle = startAngle + signedSweep * progress;
          const nextPoint: Point = {
            x: center.x + Math.cos(angle) * radius,
            y: center.y + Math.sin(angle) * radius,
            z: state.z + (nextZ - state.z) * progress,
          };
          appendSegment(previous, nextPoint, deltaE > 0);
          previous = nextPoint;
        }
        state.x = nextX;
        state.y = nextY;
        state.z = nextZ;
        state.e = nextE;
        continue;
      }
    }

    const extruding = moved && deltaE > 0;

    if (moved) {
      appendSegment(startPoint, endPoint, extruding);
    }

    state.x = nextX;
    state.y = nextY;
    state.z = nextZ;
    state.e = nextE;
  }

  finishLayer(extrusionVerts.length / 6);

  if (bounds.min[0] === Infinity) {
    bounds.min = [0, 0, 0];
    bounds.max = [0, 0, 0];
  }

  return {
    extrusionPositions: new Float32Array(extrusionVerts),
    travelPositions: new Float32Array(travelVerts),
    extrusionSegments,
    travelSegments,
    magneticSegments,
    magneticRegions,
    layers,
    bounds,
    stats: {
      segmentCount: extrusionVerts.length / 6,
      travelSegmentCount: travelVerts.length / 6,
      layerCount: layers.length,
    },
  };
}
