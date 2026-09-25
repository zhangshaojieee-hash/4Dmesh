import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

const loadParser = async () => {
  const source = read('src/utils/gcode/parseGcodeToolpath.ts');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  return import(url);
};

describe('GcodeEditor module and control adaptation', () => {
  const editor = read('src/pages/GcodeEditor.tsx');
  const gcodePanel = read('src/components/gcode-preview/GcodePreviewPanel.tsx');
  const gcodeCanvas = read('src/components/gcode-preview/GcodePreviewCanvas.tsx');
  const magTimeline = read('src/components/gcode-editor/MagTimeline.tsx');
  const viewportControls = read('src/components/preview-common/PreviewViewportControls.tsx');
  const parser = read('src/utils/gcode/parseGcodeToolpath.ts');
  const modelPanel = read('src/components/gcode-preview/ModelPreviewPanel.tsx');
  const css = read('src/index.css');

  it('wires the top preview toolbar instead of leaving disabled visual shells', () => {
    assert.doesNotMatch(editor, /<button type="button" disabled>2D<\/button>/, '2D toolbar control must be clickable');
    assert.doesNotMatch(editor, /<button type="button" disabled>网<\/button>/, 'grid toolbar control must be clickable');
    assert.doesNotMatch(editor, /<button type="button" disabled>轴<\/button>/, 'axis toolbar control must be clickable');
    assert.doesNotMatch(editor, /<button type="button" disabled>居<\/button>/, 'reset toolbar control must be clickable');
    assert.doesNotMatch(editor, /<select[^>]+disabled>/, 'toolbar selects must not be disabled shells');
    assert.match(editor, /aria-pressed=/, 'toggle toolbar buttons should expose pressed state');
  });

  it('connects the layer shell to real selected-layer state', () => {
    assert.match(editor, /const \[selectedLayer, setSelectedLayer\] = useState<number \| null>\(null\);/, 'editor should default selected layer to all-layer mode');
    assert.match(editor, /type="range"/, 'layer shell should render a range input');
    assert.match(editor, /setSelectedLayer/, 'layer range should update selected layer state');
    assert.match(editor, /currentLayer=\{selectedLayer\}/, 'selected layer should drive the G-code preview');
  });

  it('exposes explicit all-layer and single-layer controls', () => {
    assert.match(editor, /aria-label="层预览"/, 'layer control should have an accessible group label');
    assert.match(editor, /aria-label="显示全部层"[\s\S]*aria-pressed=\{selectedLayer === null\}/, 'all-layer control should expose pressed state');
    assert.match(editor, /aria-label="显示单层"[\s\S]*aria-pressed=\{selectedLayer !== null\}/, 'single-layer control should expose pressed state');
    assert.match(editor, />全部<\/button>/, 'layer control should include a compact all-layer affordance');
    assert.match(editor, />单层<\/button>/, 'layer control should include a compact single-layer affordance');
    assert.match(editor, /aria-label="选择预览层"/, 'single-layer slider should remain accessible');
  });

  it('keeps the layer preview control compact and away from the right-side mini-axis', () => {
    assert.match(editor, /aria-label="层预览"[\s\S]*left: '50%'[\s\S]*bottom: '58px'/, 'layer control should float near the lower center of the preview');
    assert.match(editor, /aria-label="层预览"[\s\S]*display: 'flex'[\s\S]*alignItems: 'center'/, 'layer control should use a compact horizontal layout');
    assert.doesNotMatch(editor, /aria-label="层预览"[\s\S]*right: '20px'[\s\S]*top: '20px'[\s\S]*bottom: '20px'/, 'layer control should not occupy a full-height right rail');
    assert.doesNotMatch(editor, /aria-label="选择预览层"[\s\S]*WebkitAppearance: 'slider-vertical'/, 'layer slider should not render as a vertical rail');
  });

  it('shows new G-code results in full print-path preview by default', () => {
    assert.match(editor, /const \[selectedLayer, setSelectedLayer\] = useState<number \| null>\(null\);/, 'initial preview should not filter to layer 0');
    assert.match(editor, /const \[activePreview, setActivePreview\] = useState<PreviewTab>\('model'\);/, 'preview state should remain explicit');
    assert.match(editor, /const handleUploadGcode[\s\S]*setActivePreview\('gcode'\);[\s\S]*setSelectedLayer\(null\);/, 'uploaded G-code should switch to full G-code preview');
    assert.match(editor, /const applyProcess4DResult[\s\S]*setActivePreview\('gcode'\);[\s\S]*setSelectedLayer\(null\);/, 'processed G-code should switch to full G-code preview');
    assert.match(editor, /const handleSliceOnly[\s\S]*setActivePreview\('gcode'\);[\s\S]*setSelectedLayer\(null\);/, 'sliced G-code should switch to full G-code preview');
    assert.match(editor, /setSelectedLayer\(\(layer\) => layer === null \? null : Math\.min\(layer, maxLayerIndex\)\)/, 'layer clamping should preserve all-layer mode');
  });

  it('lets the parent toolbar control G-code preview rendering options', () => {
    assert.match(gcodePanel, /showTravel\?: boolean/, 'GcodePreviewPanel should accept parent-controlled travel visibility');
    assert.match(gcodePanel, /currentLayer\?: number \| null/, 'GcodePreviewPanel should accept parent-controlled layer');
    assert.match(gcodeCanvas, /showGrid: boolean/, 'GcodePreviewCanvas should accept grid visibility');
    assert.match(gcodeCanvas, /showAxes: boolean/, 'GcodePreviewCanvas should accept axis visibility');
  });

  it('maps the layer slider position to the parsed G-code layer index', () => {
    assert.match(gcodePanel, /const selectedLayerPosition = currentLayer === null[\s\S]*?Math\.min\(Math\.max\(currentLayer, 0\), preview\.layers\.length - 1\)/, 'slider value should be treated as a clamped layer position');
    assert.match(gcodePanel, /const layerForPreview = preview\.layers\.length > 0[\s\S]*preview\.layers\[selectedLayerPosition\]\.index[\s\S]*: null;/, 'parsed layer index should drive canvas filtering and empty layer metadata should show all segments');
    assert.doesNotMatch(gcodePanel, /: currentLayer;/, 'GcodePreviewPanel should not filter to raw slider value when no parsed layer metadata exists');
  });

  it('warns when a selected layer has no extrusion while the file has toolpaths', () => {
    assert.match(gcodePanel, /activeLayerHasNoExtrusion/, 'panel should detect empty selected layers');
    assert.match(gcodePanel, /当前层没有挤出路径/, 'panel should explain empty filtered-layer renders');
    assert.match(gcodePanel, /role="status"/, 'empty-layer notice should be announced without blocking the canvas');
  });

  it('parses common G2 and G3 XY arcs instead of leaving arc-only files empty', () => {
    assert.match(parser, /cmd !== 'G0' && cmd !== 'G1' && cmd !== 'G2' && cmd !== 'G3'/, 'parser should accept G2 and G3 motion commands');
    assert.match(parser, /centerFromRadius/, 'parser should support R-radius arc centers');
    assert.match(parser, /params\.has\('I'\) \|\| params\.has\('J'\)/, 'parser should support I/J offset arc centers');
    assert.match(parser, /const clockwise = cmd === 'G2'/, 'parser should distinguish clockwise and counter-clockwise arcs');
    assert.match(parser, /appendSegment\(previous, nextPoint, deltaE > 0\)/, 'parser should convert arcs into preview segments');
  });

  it('renders extrusion segments for arc-only G-code at parser runtime', async () => {
    const { parseGcodeToolpath } = await loadParser();
    const preview = parseGcodeToolpath([
      ';LAYER:0',
      'G90',
      'M83',
      'G1 X10 Y0 Z0.2 F1200',
      'G2 X0 Y10 I-10 J0 E1.0',
      'G3 X10 Y20 R10 E1.0',
    ].join('\n'));
    assert.ok(preview.stats.segmentCount > 0, 'arc-only extrusion should produce visible toolpath segments');
    assert.ok(preview.extrusionSegments.every((segment) => segment.layerIndex === 0), 'arc segments should keep the active layer index');
    assert.ok(preview.bounds.max[0] > preview.bounds.min[0], 'arc interpolation should update X bounds');
    assert.ok(preview.bounds.max[1] > preview.bounds.min[1], 'arc interpolation should update Y bounds');
  });

  it('fits G-code preview camera presets around parsed toolpath bounds', () => {
    assert.match(gcodeCanvas, /const toolpathCenter = useMemo\(\(\): \[number, number, number\] => \{/, 'canvas should derive an orbit target from parsed bounds');
    assert.match(gcodeCanvas, /preview\.bounds\.min\[0\] \+ preview\.bounds\.max\[0\]/, 'bounds center should use X extents');
    assert.match(gcodeCanvas, /const fitDistance = useMemo\(\(\) => \{/, 'canvas should derive camera distance from parsed bounds');
    assert.match(gcodeCanvas, /Math\.max\(spanX, spanY, spanZ, 1\)/, 'fit distance should account for every axis span');
    assert.match(gcodeCanvas, /cameraRef\.current\.lookAt\(\.\.\.toolpathCenter\)/, 'camera should look at the parsed bounds center');
    assert.match(gcodeCanvas, /orbitRef\.current\?\.target\.set\(\.\.\.toolpathCenter\)/, 'orbit controls should rotate around the parsed bounds center');
    assert.doesNotMatch(gcodeCanvas, /lookAt\(0, 0, 0\)/, 'view presets should not keep looking at the world origin');
    assert.doesNotMatch(gcodeCanvas, /target\.set\(0, 0, 0\)/, 'orbit target should not remain fixed at the world origin');
  });


  it('uses a print-coordinate bed and custom G-code axes instead of raw Three helpers', () => {
    const threeControls = read('src/components/preview-common/ThreeControls.tsx');
    const modelViewer = read('src/components/ModelViewer.tsx');
    const selectableViewer = read('src/components/SelectableModelViewer.tsx');
    assert.match(gcodeCanvas, /const GCODE_AXIS_COLORS = \{[\s\S]*x: '#EF4444',[\s\S]*y: '#22C55E',[\s\S]*z: '#3B82F6'/, 'G-code axes should use X red, Y green, Z blue');
    assert.match(gcodeCanvas, /const DEFAULT_PRINTER_BED = \{[\s\S]*width: 250,[\s\S]*depth: 210/, 'bed footprint should start from the printer bed size');
    assert.match(gcodeCanvas, /const computeBedFootprint = \(preview: ParsedGcodePreview\): BedFootprint => \{/, 'bed footprint should be derived from preview bounds');
    assert.match(gcodeCanvas, /Math\.max\(DEFAULT_PRINTER_BED\.width, Math\.max\(boundsMinX, boundsMaxX\) \+ BED_PADDING_MM\)/, 'bed width should expand to include X bounds with padding');
    assert.match(gcodeCanvas, /Math\.max\(DEFAULT_PRINTER_BED\.depth, Math\.max\(boundsMinY, boundsMaxY\) \+ BED_PADDING_MM\)/, 'bed depth should expand to include Y bounds with padding');
    assert.match(gcodeCanvas, /const toBedPoint = \(x: number, y: number, yOffset = 0\) => new THREE\.Vector3\(x, BED_SURFACE_Y \+ yOffset, -y\)/, 'G-code Y should map to scene depth as -Z');
    assert.match(gcodeCanvas, /<GcodeBedPlate footprint=\{bedFootprint\} showGrid=\{showGrid\} \/>/, 'canvas should render the bed-aware footprint');
    assert.match(gcodeCanvas, /\{showAxes && <GcodeAxisHelper footprint=\{bedFootprint\} \/>\}/, 'canvas should render custom G-code axes behind the axis toggle');
    assert.match(threeControls, /export const TextLabel/, 'ThreeControls should provide R3F-safe sprite text labels');
    assert.match(gcodeCanvas, /<TextLabel text="0,0"/, 'bed origin label should render as a Three sprite instead of DOM');
    assert.match(gcodeCanvas, /<TextLabel text=\{label\}/, 'axis labels should render as Three sprites instead of DOM');
    assert.doesNotMatch(gcodeCanvas + modelViewer + selectableViewer, /<Html|Html,|import \{[^}]*Html/, 'R3F canvases should not render DOM Html children');
    assert.doesNotMatch(gcodeCanvas, /<axesHelper args=\{\[40\]\}/, 'raw Three.js axes should not be used for G-code preview');
    assert.doesNotMatch(gcodeCanvas, /<Grid args=\{\[400, 40\]\}/, 'G-code preview should not use the old oversized fixed grid');
    assert.doesNotMatch(gcodeCanvas, /<planeGeometry args=\{\[400, 400\]\}/, 'G-code preview should not use the old oversized fixed bed plane');
  });

  it('keeps viewport mini-axis labels aligned to X red, Y green, Z blue', () => {
    assert.match(viewportControls, /color: '#EF4444' \}}>X<\/span>/, 'mini-axis X label should be red');
    assert.match(viewportControls, /color: '#22C55E' \}}>Y<\/span>/, 'mini-axis Y label should be green');
    assert.match(viewportControls, /color: '#3B82F6' \}}>Z<\/span>/, 'mini-axis Z label should be blue');
    assert.doesNotMatch(viewportControls, /color: '#EF4444' \}}>Y<\/span>/, 'mini-axis should not show Y as red');
    assert.doesNotMatch(viewportControls, /color: '#22C55E' \}}>X<\/span>/, 'mini-axis should not show X as green');
  });

  it('lets the parent toolbar control model preview rendering options', () => {
    assert.match(modelPanel, /showGrid\?: boolean/, 'ModelPreviewPanel should accept grid visibility');
    assert.match(modelPanel, /showAxes\?: boolean/, 'ModelPreviewPanel should accept axis visibility');
    assert.match(modelPanel, /viewPreset\?:/, 'ModelPreviewPanel should accept view preset control');
  });

  it('keeps only the 3D, sliced path, and code analysis previews in the G-code workbench', () => {
    assert.doesNotMatch(editor, /打印文件已就绪/, 'ready banner should be removed from the G-code workbench');
    assert.doesNotMatch(editor, /className="gcode-preview-tabs"[\s\S]*?>路径<\/button>/, 'path tab should be removed from the preview header');
    assert.doesNotMatch(editor, /className="gcode-preview-tabs"[\s\S]*?>分层<\/button>/, 'layer tab should be removed from the preview header');
    assert.doesNotMatch(editor, /className="gcode-preview-tabs"[\s\S]*?>分析<\/button>/, 'legacy analysis tab should remain removed from the preview header');
    assert.doesNotMatch(editor, /2D\/俯视/, '2D top-view toggle should be removed');
    assert.match(editor, /<GcodePreviewPanel[\s\S]*currentLayer=\{selectedLayer\}/, 'sliced G-code path preview should remain layer-driven');
    assert.match(editor, /层预览/, 'sliced path layer preview should remain visible');
  });

  it('uses explicit preview switching while keeping model and gcode surfaces reachable', () => {
    assert.doesNotMatch(editor, /const activePreview: PreviewTab = gcodeContent \? 'gcode' : 'model';/, 'preview state must no longer derive directly from content');
    assert.match(editor, /const \[activePreview, setActivePreview\] = useState<PreviewTab>\('model'\);/, 'preview state should default to the model surface');
    assert.match(editor, /aria-label="预览模式"/, 'preview header should expose preview-mode switch controls');
    assert.match(editor, />\s*3D 模型\s*<\//, 'preview switch should expose the 3D model option');
    assert.match(editor, />\s*打印路径\s*<\//, 'preview switch should expose the print-path option');
    assert.match(editor, />\s*代码分析\s*<\//, 'preview switch should expose the code-analysis option');
    assert.match(editor, /aria-pressed=\{activePreview === 'model'\}/, 'model switch button should expose pressed state');
    assert.match(editor, /aria-pressed=\{activePreview === 'gcode'\}/, 'G-code switch button should expose pressed state');
    assert.match(editor, /aria-pressed=\{activePreview === 'analysis'\}/, 'analysis switch button should expose pressed state');
    assert.match(editor, /onClick=\{\(\) => setActivePreview\('model'\)\}/, 'model switch should set explicit preview state');
    assert.match(editor, /onClick=\{\(\) => setActivePreview\('gcode'\)\}/, 'G-code switch should set explicit preview state');
    assert.match(editor, /onClick=\{\(\) => setActivePreview\('analysis'\)\}/, 'analysis switch should set explicit preview state');
    assert.match(editor, /const canPreviewModel = Boolean\(project\.modelUrl && inputType !== 'gcode'\);/, 'model availability should be tracked explicitly and exclude plain G-code inputs');
    assert.match(editor, /const canPreviewGcode = Boolean\(gcodeContent\);/, 'G-code availability should be tracked explicitly');
    assert.match(editor, /if \(!canPreviewModel && canPreviewGcode\) \{\s*setActivePreview\('gcode'\);\s*\}/, 'direct G-code uploads should fall back to the path preview when no model exists');
    assert.match(editor, /activePreview === 'model'[\s\S]*<ModelPreviewPanel/, 'model preview should remain reachable');
    assert.match(editor, /activePreview === 'gcode'[\s\S]*<GcodePreviewPanel/, 'G-code preview should remain reachable');
    assert.match(editor, /activePreview === 'analysis'[\s\S]*G-code 代码分析/, 'code analysis preview should remain reachable');
    assert.doesNotMatch(editor, /预览信息/, 'preview info side card should be removed');
    assert.match(editor, /层预览/, 'layer preview should remain visible');
    assert.match(editor, /currentLayer=\{selectedLayer\}/, 'selected layer should keep driving the G-code preview');
  });

  it('reuses magnetic parsing for the code-analysis tab', () => {
    assert.match(editor, /import \{ parseMagProgram \} from '\.\.\/utils\/gcode\/parseMagProgram';/, 'GcodeEditor should import the shared magnetic parser');
    assert.match(editor, /const analysisContent = editMode \? editContent : gcodeContent;/, 'analysis should follow edit drafts before save');
    assert.match(editor, /const magProgram = useMemo\(\(\) => parseMagProgram\(analysisContent\), \[analysisContent\]\);/, 'analysis should parse the active content once');
    assert.match(editor, /const MAX_ANALYSIS_PREVIEW_CHARS\s*=\s*[\d_]+;/, 'analysis preview should be capped');
    assert.match(editor, /const analysisPreviewContent = useMemo\([\s\S]*analysisContent/, 'analysis preview should derive from the full analysis content');
    assert.match(editor, /<MagTimeline gcodeContent=\{analysisContent\} program=\{magProgram\} \/>/, 'timeline should receive the pre-parsed magnetic program');
    assert.match(editor, /<PrePrintCheck gcodeContent=\{analysisContent\} program=\{magProgram\}/, 'pre-print check should receive the pre-parsed magnetic program');
    assert.match(editor, /MAG_ON[\s\S]*analysisMetrics\.magOnCount/, 'analysis summary should show MAG_ON counts');
    assert.match(editor, /MAG_OFF[\s\S]*analysisMetrics\.magOffCount/, 'analysis summary should show MAG_OFF counts');
    assert.match(editor, /指令配对[\s\S]*analysisMetrics\.balanced/, 'analysis summary should show MAG_ON/MAG_OFF balance');
    assert.match(editor, /喷嘴温度[\s\S]*analysisMetrics\.nozzleTemp/, 'analysis summary should show nozzle temperature');
    assert.match(editor, /热床温度[\s\S]*analysisMetrics\.bedTemp/, 'analysis summary should show bed temperature');
  });

  it('provides code editor controls without stealing print-path controls', () => {
    assert.match(editor, /activePreview === 'analysis' && canPreviewGcode[\s\S]*aria-label="G-code 代码面板"/, 'analysis tab should render a code panel inside the preview area');
    assert.match(editor, /aria-label="编辑 G-code 内容"[\s\S]*value=\{editContent\}[\s\S]*onChange=\{\(event\) => setEditContent\(event\.target\.value\)\}/, 'editable textarea should use existing edit content state');
    assert.match(editor, /aria-label="当前 G-code 内容"[\s\S]*\{analysisPreviewContent\}<\/pre>/, 'read-only mode should show the bounded preview content in a pre block');
    assert.doesNotMatch(editor, /<pre aria-label="当前 G-code 内容"[\s\S]*\{analysisContent\}<\/pre>/, 'read-only mode should not mount the full analysis content directly');
    assert.match(editor, /onClick=\{handleSaveOrEdit\}[\s\S]*\{editMode \? '保存代码' : '编辑代码'\}/, 'save/edit button should use the existing save handler');
    assert.match(editor, /const handleCancelEdit = \(\) => \{\s*setEditContent\(gcodeContent\);\s*setEditMode\(false\);\s*\};/, 'cancel should leave edit mode and restore store content');
    assert.match(editor, /try \{[\s\S]*await saveGcode\(targetFilename, editContent\);[\s\S]*\} catch \(err: unknown\) \{\s*setError\(normalizeError\(err\)\);\s*\}/, 'save errors should surface through normalized editor errors');
    assert.match(editor, /activePreview === 'gcode' && canPreviewGcode && \([\s\S]*<select value=\{showTravel \? 'all' : 'extrusion'\}/, 'travel control should remain path-preview-only');
    assert.match(editor, /activePreview === 'gcode' && canPreviewGcode && gcodeMetrics\.totalLayers > 0 && \([\s\S]*aria-label="层预览"/, 'layer overlay should remain path-preview-only');
    assert.doesNotMatch(editor, /activePreview === 'analysis' && canPreviewGcode && gcodeMetrics\.totalLayers/, 'analysis tab should not own layer-preview gating');
  });

  it('bounds the magnetic timeline rows without changing counts and warnings', () => {
    assert.match(magTimeline, /const MAX_TIMELINE_SEGMENTS\s*=\s*\d+;/, 'timeline rows should be capped');
    assert.match(magTimeline, /const visibleSegments = parsed\.segments\.slice\(0, MAX_TIMELINE_SEGMENTS\);/, 'timeline should slice the visible segments');
    assert.match(magTimeline, /\{visibleSegments\.map\(/, 'timeline should render only the bounded segment window');
    assert.doesNotMatch(magTimeline, /\{parsed\.segments\.map\(/, 'timeline should not render every parsed segment directly');
    assert.match(magTimeline, /hiddenSegmentCount/, 'timeline should expose the omitted segment count');
  });

  it('uses responsive G-code workbench sizing and aligned lower cards', () => {
    assert.match(css, /--gcode-rail-width:\s*clamp\(/, 'left config rail should adapt to viewport width');
    assert.match(css, /--gcode-rail-card-gap:\s*clamp\(20px,\s*1\.9vw,\s*28px\);/, 'left config rail should use a noticeably taller desktop card gap token');
    assert.match(css, /--gcode-rail-card-padding-y:\s*clamp\(20px,\s*1\.7vw,\s*26px\);/, 'left config rail should use taller desktop vertical padding tokens');
    assert.match(css, /--gcode-rail-field-gap:\s*clamp\(10px,\s*1\.1vw,\s*16px\);/, 'left config rail should use a stronger desktop field gap token');
    assert.match(css, /\.editor-layout\.gcode-workbench-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(250px, var\(--gcode-rail-width\)\) minmax\(0, 1fr\);/, 'workbench layout should use responsive rail sizing');
    assert.match(css, /\.editor-sidebar\.gcode-config-rail\s*\{[^}]*gap:\s*var\(--gcode-rail-card-gap\);/, 'left config rail should use the responsive card gap token');
    assert.doesNotMatch(css, /\.editor-sidebar\.gcode-config-rail\s*\{[^}]*gap:\s*7px;/, 'left config rail should not keep the old fixed 7px gap');
    assert.match(css, /\.editor-sidebar\.gcode-config-rail \.gcode-side-card\s*\{[^}]*padding:\s*var\(--gcode-rail-card-padding-y\) 10px;/, 'left rail side cards should stretch vertically without widening');
    assert.match(css, /\.editor-sidebar\.gcode-config-rail \.gcode-form-grid\s*\{[^}]*gap:\s*var\(--gcode-rail-field-gap\);/, 'left rail form grids should use the scoped field rhythm');
    assert.match(css, /\.editor-sidebar\.gcode-config-rail \.gcode-actions-card\s*\{[^}]*gap:\s*var\(--gcode-rail-field-gap\);[^}]*padding:\s*var\(--gcode-rail-card-padding-y\) 10px;/, 'left rail action cards should use the scoped vertical rhythm');
    assert.match(css, /@media \(max-width: 1280px\)\s*\{[\s\S]*\.gcode-workbench-page\s*\{[\s\S]*--gcode-rail-card-gap:\s*18px;[\s\S]*--gcode-rail-card-padding-y:\s*20px;[\s\S]*--gcode-rail-field-gap:\s*12px;/, 'large-tablet rail spacing should stay generous before the stacked layout');
    assert.match(css, /@media \(max-width: 1100px\)\s*\{[\s\S]*\.gcode-workbench-page\s*\{[\s\S]*--gcode-rail-card-gap:\s*12px;[\s\S]*--gcode-rail-card-padding-y:\s*14px;[\s\S]*--gcode-rail-field-gap:\s*9px;/, 'stacked rail spacing should tighten before the two-column mobile-friendly layout');
    assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*\.gcode-workbench-page\s*\{[\s\S]*--gcode-rail-card-gap:\s*10px;[\s\S]*--gcode-rail-card-padding-y:\s*12px;[\s\S]*--gcode-rail-field-gap:\s*8px;/, 'tablet rail spacing should reduce to avoid overflow');
    assert.match(css, /@media \(max-width: 520px\)\s*\{[\s\S]*\.gcode-workbench-page\s*\{[\s\S]*--gcode-rail-card-gap:\s*8px;[\s\S]*--gcode-rail-card-padding-y:\s*12px;[\s\S]*--gcode-rail-field-gap:\s*7px;/, 'mobile rail spacing should stay compact');
    assert.doesNotMatch(css, /grid-template-columns:\s*300px minmax\(0, 1fr\);/, 'left config rail should not use fixed 300px width');
    assert.doesNotMatch(css, /grid-template-columns:\s*286px minmax\(0, 1fr\);/, 'medium layout should not use fixed 286px width');
    assert.match(css, /\.gcode-preview-stage\s*\{[\s\S]*--gcode-preview-height:\s*clamp\(/, 'main preview should use dynamic clamped height');
    assert.match(css, /\.gcode-bottom-grid\s*\{[\s\S]*align-items:\s*stretch;/, 'lower cards should stretch to align their bottoms');
    assert.match(css, /\.gcode-bottom-card\s*\{[\s\S]*height:\s*100%;/, 'lower card surfaces should fill the stretched row height');
  });
});
