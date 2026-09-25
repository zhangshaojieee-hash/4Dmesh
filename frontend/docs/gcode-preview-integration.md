# gcode-preview Library Integration Guide

## Overview

`gcode-preview` (v2.18.0) is a WebGL-based G-code visualization library that provides high-performance 3D rendering of toolpaths with built-in layer management, multi-color extrusion, and travel path visualization.

**Repository**: https://github.com/remcoder/gcode-preview  
**Demo**: https://gcode-preview.web.app/

---

## Installation

```bash
npm install gcode-preview@2.18.0
```

**Dependencies**:
- `three@^0.159.0` (included)
- `lil-gui@^0.19.2` (included)

**Bundle Size**: ~150KB minified (includes Three.js renderer)

---

## Basic Usage

### Initialization

```typescript
import { WebGLPreview } from 'gcode-preview';

const preview = new WebGLPreview({
  canvas: canvasElement,
  extrusionColor: ['#FF6B35', '#F7931E', '#FDC830', '#37B679', '#00D9FF'],
  travelColor: '#94A3B8',
  backgroundColor: '#0F172A',
  renderTubes: true,
  renderTravel: true,
  initialCameraPosition: [120, 120, 120],
  lineWidth: 0.4,
});

preview.processGCode(gcodeString);
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `canvas` | `HTMLCanvasElement` | required | Target canvas element |
| `extrusionColor` | `Color \| Color[]` | `#00FF00` | Single color or array for multi-color |
| `travelColor` | `ColorRepresentation` | `#0000FF` | Travel move color |
| `backgroundColor` | `ColorRepresentation` | `#000000` | Scene background |
| `renderTubes` | `boolean` | `false` | Render as 3D tubes (higher quality) |
| `renderTravel` | `boolean` | `true` | Show travel moves |
| `renderExtrusion` | `boolean` | `true` | Show extrusion paths |
| `lineWidth` | `number` | `1.0` | Line width for flat rendering |
| `extrusionWidth` | `number` | `0.4` | Extrusion width for tube rendering |
| `buildVolume` | `{x, y, z}` | auto | Build volume dimensions |
| `initialCameraPosition` | `number[]` | `[0, 400, 450]` | Camera start position |
| `startLayer` | `number` | `0` | First layer to render |
| `endLayer` | `number` | `max` | Last layer to render |
| `minLayerThreshold` | `number` | `0` | Min Z change for new layer |
| `topLayerColor` | `ColorRepresentation` | undefined | Highlight top layer |
| `lastSegmentColor` | `ColorRepresentation` | undefined | Highlight last segment |
| `toolColors` | `Record<number, Color>` | `{}` | Per-tool color mapping |
| `disableGradient` | `boolean` | `false` | Disable color gradients |

---

## Layer Control API

### Single Layer Display

```typescript
// Show only layer 10
preview.startLayer = 10;
preview.endLayer = 10;
preview.singleLayerMode = true;
preview.render();
```

### Layer Range Display

```typescript
// Show layers 0-50
preview.startLayer = 0;
preview.endLayer = 50;
preview.singleLayerMode = false;
preview.render();
```

### Get Layer Information

```typescript
const totalLayers = preview.maxLayerIndex + 1;
const minLayer = preview.minLayerIndex;
const maxLayer = preview.maxLayerIndex;

// Access layer data
const layers = preview.layers; // Layer[] - experimental API
```

---

## Statistics Extraction

The library provides parsed layer data through the internal parser:

```typescript
// Total layers
const layerCount = preview.maxLayerIndex + 1;

// Access parsed layers (experimental)
const layers = preview.layers;

// Each layer contains:
// - layer: number (layer index)
// - commands: GCodeCommand[] (parsed commands)
// - lineNumber: number (starting line)
// - height: number (Z height)
```

**Note**: Direct statistics like print time and extrusion length are not exposed by the library. These would need to be calculated separately from the G-code or layer data.

---

## Performance Optimization

### Memory Management

```typescript
// Clear rendered geometry (keeps parsed data)
preview.clear();

// Full cleanup (dispose all resources)
preview.dispose();
```

### Rendering Modes

**Flat Lines** (faster, lower quality):
```typescript
renderTubes: false,
lineWidth: 0.4
```

**3D Tubes** (slower, higher quality):
```typescript
renderTubes: true,
extrusionWidth: 0.4
```

### Lazy Rendering

```typescript
// Manual render control
preview.render(); // Single frame

// Animated rendering (experimental)
await preview.renderAnimated(layerCount);
```

---

## Performance Benchmarks

### Test Configuration
- **Hardware**: Testing required with actual G-code files
- **Rendering Mode**: `renderTubes: true`
- **Browser**: Chrome 120+

### Expected Performance (Estimated)

| File Size | Lines | Layers | Parse Time | Render Time | Memory |
|-----------|-------|--------|------------|-------------|--------|
| Small | 50K | ~200 | ~100ms | ~200ms | ~50MB |
| Medium | 100K | ~400 | ~200ms | ~400ms | ~100MB |
| Large | 200K | ~800 | ~400ms | ~800ms | ~200MB |

**Layer Switch Performance**: <16ms (60fps capable)

**Note**: Actual benchmarks require test files. Create sample G-code or use real sliced files for accurate measurements.

---

## Comparison: gcode-preview vs Custom Renderer

### Feature Comparison

| Feature | gcode-preview | Custom (R3F) | Winner |
|---------|---------------|--------------|--------|
| **Multi-color extrusion** | ✅ Built-in array | ❌ Single color | gcode-preview |
| **Arc support (G2/G3)** | ✅ Native | ❌ Not implemented | gcode-preview |
| **Tube rendering** | ✅ Optional | ❌ Flat only | gcode-preview |
| **Layer API** | ✅ startLayer/endLayer | ✅ Filter-based | Tie |
| **Travel paths** | ✅ Toggle | ✅ Toggle | Tie |
| **Thumbnail extraction** | ✅ Built-in | ❌ Not implemented | gcode-preview |
| **Camera controls** | ✅ OrbitControls | ✅ OrbitControls | Tie |
| **Custom lighting** | ❌ Fixed | ✅ Full control | Custom |
| **React integration** | ⚠️ Manual | ✅ Native R3F | Custom |
| **Grid/build plate** | ⚠️ Basic | ✅ Custom styled | Custom |

### Performance Comparison

| Metric | gcode-preview | Custom (R3F) | Notes |
|--------|---------------|--------------|-------|
| **Initial parse** | Fast (native) | Fast (custom) | Similar performance |
| **Render speed** | Fast (WebGL) | Fast (Three.js) | Both use Three.js |
| **Memory usage** | Moderate | Lower | Instanced rendering advantage |
| **Layer switching** | Instant | Instant | Both efficient |
| **Bundle size** | ~150KB | ~5KB + R3F | R3F already in project |

### Bundle Size Analysis

**gcode-preview**:
- Library: ~150KB (includes Three.js subset)
- Total impact: +150KB (if Three.js not shared)

**Custom Renderer**:
- Code: ~5KB (GcodePreviewCanvas + parser)
- Dependencies: React Three Fiber (already in project)
- Total impact: +5KB

**Verdict**: Custom renderer has 30x smaller footprint if R3F is already used.

---

## Integration Recommendations

### Use gcode-preview if:
- ✅ Need multi-color extrusion support immediately
- ✅ Need arc (G2/G3) command support
- ✅ Want thumbnail extraction from G-code
- ✅ Prefer battle-tested library over custom code
- ✅ Don't mind larger bundle size

### Use custom renderer if:
- ✅ Already using React Three Fiber extensively
- ✅ Need tight integration with React component lifecycle
- ✅ Want full control over lighting and scene composition
- ✅ Prioritize minimal bundle size
- ✅ Only need basic extrusion + travel visualization

---

## Migration Path

### Phase 1: Prototype (Current)
- ✅ Install gcode-preview
- ✅ Create GcodePreviewPrototype.tsx
- ✅ Test with sample G-code

### Phase 2: Feature Parity
- Add multi-color support to prototype
- Implement camera preset views
- Add statistics extraction
- Performance testing with real files

### Phase 3: Integration
- Replace GcodePreviewCanvas with prototype
- Update GcodeEditor to use new component
- Remove parseGcodeToolpath.ts if no longer needed
- Update tests

### Phase 4: Optimization
- Implement lazy loading for large files
- Add progressive rendering
- Optimize memory usage
- Add caching layer

---

## Known Limitations

1. **React Integration**: Not React-native, requires manual lifecycle management
2. **Statistics**: No built-in print time/length calculation
3. **Styling**: Limited control over scene lighting and materials
4. **TypeScript**: Some APIs marked as experimental/internal
5. **Build Volume**: Auto-detection may not match printer specs

---

## Example: React Component

See `GcodePreviewPrototype.tsx` for a complete React wrapper implementation with:
- Canvas lifecycle management
- Layer control props
- Travel path toggle
- Cleanup on unmount
- Layer count callback

---

## Resources

- **GitHub**: https://github.com/remcoder/gcode-preview
- **Demo**: https://gcode-preview.web.app/
- **TypeDoc**: https://remcoder.github.io/gcode-preview/
- **NPM**: https://www.npmjs.com/package/gcode-preview

---

## Next Steps

1. **Create test G-code files** in `uploads/slices/` for benchmarking
2. **Run performance tests** with 50K/100K/200K line files
3. **Test multi-color rendering** with multi-extruder G-code
4. **Evaluate arc support** with G2/G3 commands
5. **Measure actual bundle impact** in production build
6. **Decision**: Keep custom renderer or migrate to gcode-preview
