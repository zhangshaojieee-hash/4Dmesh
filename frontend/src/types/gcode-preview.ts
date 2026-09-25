export interface ToolpathLayerRange {
  index: number;
  z: number;
  start: number;
  end: number;
}

export interface ToolpathSegment {
  from: [number, number, number];
  to: [number, number, number];
  layerIndex: number;
  z: number;
  length: number;
  estimatedWidth: number;
  estimatedHeight: number;
}

export interface MagneticToolpathSegment extends ToolpathSegment {
  regionId: number;
  strength: number;
  direction: string | null;
}

export interface MagneticRegion {
  id: number;
  strength: number;
  direction: string | null;
  segments: MagneticToolpathSegment[];
}

export interface ToolpathBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface ToolpathStats {
  segmentCount: number;
  travelSegmentCount: number;
  layerCount: number;
}

export interface ParsedGcodePreview {
  extrusionPositions: Float32Array;
  travelPositions: Float32Array;
  extrusionSegments: ToolpathSegment[];
  travelSegments: ToolpathSegment[];
  magneticSegments: MagneticToolpathSegment[];
  magneticRegions: MagneticRegion[];
  layers: ToolpathLayerRange[];
  bounds: ToolpathBounds;
  stats: ToolpathStats;
}

export interface PreviewSettings {
  showTravel: boolean;
  currentLayer: number | null;
}
