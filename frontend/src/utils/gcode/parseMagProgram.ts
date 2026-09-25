// Parses a sliced + magnetic-injected G-code program into structured data
// used by the magnetic timeline and pre-print validation views.
// Pure string parsing - no Three.js, safe to run in render/useMemo.

export interface MagSegment {
  /** MAG strength value as emitted by the backend (e.g. 100 / 50 / 25). */
  strength: number;
  /** Canonical direction token (e.g. "Z+") if the user supplied one, else null. */
  direction: string | null;
  /** Z height where the MAG_ON was emitted. */
  startZ: number;
  /** Z height where the MAG_OFF (or program end) closed the segment. */
  endZ: number;
  /** Layer index where the MAG_ON was emitted (0-based, best-effort). */
  startLayer: number;
  /** Layer index where the segment closed. */
  endLayer: number;
  /** 1-based source line of the MAG_ON command. */
  line: number;
}

export interface MagProgram {
  segments: MagSegment[];
  magOnCount: number;
  magOffCount: number;
  /** True when every MAG_ON was matched by a MAG_OFF (or program end). */
  balanced: boolean;
  layerCount: number;
  maxZ: number;
  /** Nozzle target temperature from M104/M109 S..., null if absent. */
  nozzleTemp: number | null;
  /** Bed target temperature from M140/M190 S..., null if absent. */
  bedTemp: number | null;
  /** Estimated print time in seconds parsed from slicer comments, null if absent. */
  estimatedSeconds: number | null;
  /** Distinct strength values present, ascending. */
  strengths: number[];
}

const STRENGTH_META: Record<number, { label: string; color: string }> = {
  100: { label: '强', color: '#EF4444' },
  50: { label: '中', color: '#F59E0B' },
  25: { label: '弱', color: '#3B82F6' },
};

export function strengthMeta(strength: number): { label: string; color: string } {
  if (STRENGTH_META[strength]) return STRENGTH_META[strength];
  // Fallback for non-preset values: bucket by magnitude.
  if (strength >= 75) return { label: '强', color: '#EF4444' };
  if (strength >= 40) return { label: '中', color: '#F59E0B' };
  return { label: '弱', color: '#3B82F6' };
}

function parseNumberAfter(token: string, key: string): number | null {
  // matches S=100, S100, DIR=Z+ handled separately
  const eq = token.indexOf('=');
  const raw = eq >= 0 ? token.slice(eq + 1) : token.slice(key.length);
  const value = parseFloat(raw);
  return Number.isNaN(value) ? null : value;
}

function parseEstimatedSeconds(line: string): number | null {
  // PrusaSlicer: "; estimated printing time (normal mode) = 1h 23m 45s"
  const lower = line.toLowerCase();
  if (!lower.includes('estimated printing time')) return null;
  const eq = line.indexOf('=');
  if (eq < 0) return null;
  const rest = line.slice(eq + 1);
  let total = 0;
  let matched = false;
  const dayMatch = rest.match(/(\d+)\s*d/i);
  const hourMatch = rest.match(/(\d+)\s*h/i);
  const minMatch = rest.match(/(\d+)\s*m/i);
  const secMatch = rest.match(/(\d+)\s*s/i);
  if (dayMatch) { total += parseInt(dayMatch[1], 10) * 86400; matched = true; }
  if (hourMatch) { total += parseInt(hourMatch[1], 10) * 3600; matched = true; }
  if (minMatch) { total += parseInt(minMatch[1], 10) * 60; matched = true; }
  if (secMatch) { total += parseInt(secMatch[1], 10); matched = true; }
  return matched ? total : null;
}

export function parseMagProgram(content: string): MagProgram {
  const lines = content.split(/\r?\n/);

  let currentZ = 0;
  let relative = false;
  let layerCount = 0;
  let currentLayer = -1;
  let maxZ = 0;
  let lastLayerZ = Number.NEGATIVE_INFINITY;
  let hasLayerComments = false;

  let nozzleTemp: number | null = null;
  let bedTemp: number | null = null;
  let estimatedSeconds: number | null = null;

  const segments: MagSegment[] = [];
  let open: MagSegment | null = null;
  let magOnCount = 0;
  let magOffCount = 0;

  const closeOpen = () => {
    if (open) {
      open.endZ = currentZ;
      open.endLayer = currentLayer < 0 ? 0 : currentLayer;
      segments.push(open);
      open = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith(';')) {
      if (estimatedSeconds === null) {
        const est = parseEstimatedSeconds(line);
        if (est !== null) estimatedSeconds = est;
      }
      if (/^;LAYER:?\s*\d+/i.test(line)) {
        hasLayerComments = true;
        const m = line.match(/(\d+)/);
        currentLayer = m ? parseInt(m[1], 10) : currentLayer + 1;
        layerCount = Math.max(layerCount, currentLayer + 1);
      } else if (/^;LAYER_CHANGE\s*$/i.test(line)) {
        // PrusaSlicer normally emits ;LAYER_CHANGE followed by ;Z:<height>,
        // rather than the Cura-style ;LAYER:<index> format.
        hasLayerComments = true;
        currentLayer += 1;
        layerCount = Math.max(layerCount, currentLayer + 1);
      } else if (/^;Z\s*:/i.test(line)) {
        const m = line.match(/^;Z\s*:\s*([-+]?\d*\.?\d+)/i);
        if (m) {
          currentZ = parseFloat(m[1]);
          maxZ = Math.max(maxZ, currentZ);
        }
      }
      continue;
    }

    const upper = line.toUpperCase();
    const cmd = upper.split(/[ ;]/)[0];

    if (cmd === 'MAG_ON') {
      closeOpen();
      let strength = 0;
      let direction: string | null = null;
      const tokens = line.split(/\s+/).slice(1);
      for (const t of tokens) {
        const tu = t.toUpperCase();
        if (tu.startsWith('S')) {
          const v = parseNumberAfter(t, 'S');
          if (v !== null) strength = v;
        } else if (tu.startsWith('DIR')) {
          const eq = t.indexOf('=');
          direction = (eq >= 0 ? t.slice(eq + 1) : t.slice(3)).toUpperCase() || null;
        }
      }
      magOnCount += 1;
      open = {
        strength,
        direction,
        startZ: currentZ,
        endZ: currentZ,
        startLayer: currentLayer < 0 ? 0 : currentLayer,
        endLayer: currentLayer < 0 ? 0 : currentLayer,
        line: i + 1,
      };
      continue;
    }

    if (cmd === 'MAG_OFF') {
      magOffCount += 1;
      closeOpen();
      continue;
    }

    if (cmd === 'M104' || cmd === 'M109') {
      const tokens = line.split(/\s+/).slice(1);
      for (const t of tokens) {
        if (t.toUpperCase().startsWith('S')) {
          const v = parseNumberAfter(t, 'S');
          if (v !== null && v > 0) nozzleTemp = v;
        }
      }
      continue;
    }

    if (cmd === 'M140' || cmd === 'M190') {
      const tokens = line.split(/\s+/).slice(1);
      for (const t of tokens) {
        if (t.toUpperCase().startsWith('S')) {
          const v = parseNumberAfter(t, 'S');
          if (v !== null && v > 0) bedTemp = v;
        }
      }
      continue;
    }

    if (cmd === 'G90') { relative = false; continue; }
    if (cmd === 'G91') { relative = true; continue; }
    if (cmd === 'G92') {
      const tokens = line.split(/\s+/).slice(1);
      for (const t of tokens) {
        if (t[0]?.toUpperCase() === 'Z') {
          const v = parseFloat(t.slice(1));
          if (!Number.isNaN(v)) currentZ = v;
        }
      }
      continue;
    }

    if (cmd === 'G0' || cmd === 'G1') {
      const tokens = line.split(/\s+/).slice(1);
      for (const t of tokens) {
        if (t[0]?.toUpperCase() === 'Z') {
          const v = parseFloat(t.slice(1));
          if (Number.isNaN(v)) continue;
          currentZ = relative ? currentZ + v : v;
          if (currentZ > maxZ) maxZ = currentZ;
          // Heuristic layer counting only when slicer emits no ;LAYER comments.
          if (!hasLayerComments && currentZ > lastLayerZ) {
            if (lastLayerZ === Number.NEGATIVE_INFINITY) {
              currentLayer = currentLayer < 0 ? 0 : currentLayer;
            } else {
              currentLayer = currentLayer < 0 ? 0 : currentLayer + 1;
              layerCount = Math.max(layerCount, currentLayer + 1);
            }
            lastLayerZ = currentZ;
          }
        }
      }
      continue;
    }
  }

  // Close any segment left open at program end.
  const balanced = open === null && magOnCount === magOffCount;
  closeOpen();

  if (layerCount === 0 && currentLayer >= 0) layerCount = currentLayer + 1;

  const strengths = Array.from(new Set(segments.map((s) => s.strength))).sort((a, b) => a - b);

  return {
    segments,
    magOnCount,
    magOffCount,
    balanced,
    layerCount,
    maxZ,
    nozzleTemp,
    bedTemp,
    estimatedSeconds,
    strengths,
  };
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  if (m > 0 || parts.length === 0) parts.push(`${m}分钟`);
  return parts.join(' ');
}
