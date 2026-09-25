/**
 * PreviewToolbar.tsx — 预览区顶部工具栏（重构版）
 *
 * 图标化按钮 + Tooltip + 分组容器 + 平滑过渡
 */
import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useEditor, useEditorDispatch } from '../../stores/editor';
import { MAGNET_PRESETS, DIRECTION_PRESETS } from '../../types';
import type { SurfaceTool } from '../lib/editor-types';

/* ═══ SVG 图标（内联零依赖） ═══ */

const P: React.FC<{ d: string; s?: number }> = ({ d, s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const S: React.FC<{ children: React.ReactNode; s?: number }> = ({ children, s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

const EyeIcon = () => (<S><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></S>);
const EditIcon = () => (<S><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></S>);
const ModuleIcon = () => (<S><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></S>);
const VolumeIcon = () => (<S><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></S>);
const SurfaceIcon = () => (<S><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></S>);
const BoxIcon = () => (<S s={14}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></S>);
const CylinderIcon = () => (<S s={14}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 5v14c0 1.66-4.03 3-9 3s-9-1.34-9-3V5" /></S>);
const SphereIcon = () => (<S s={14}><circle cx="12" cy="12" r="10" /><ellipse cx="12" cy="12" rx="10" ry="4" /><line x1="12" y1="2" x2="12" y2="22" /></S>);
const HandIcon = () => <P s={14} d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 9.5V6a2 2 0 0 0-4 0v8" />;
const BrushIcon = () => (<S s={14}><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" /><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" /></S>);
const EraserIcon = () => (<S s={14}><path d="M20 20H7L3 16a1 1 0 0 1 0-1.41l9.59-9.59a2 2 0 0 1 2.83 0L20 9.59a2 2 0 0 1 0 2.83L11 21" /></S>);
const FillIcon = () => (<S s={14}><path d="M12 2a10 10 0 0 1 0 20 10 10 0 0 1 0-20" /><path d="M2.5 2.5l19 19" /></S>);
const BoxSelectIcon = () => (<S s={14}><rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 2" /></S>);
const LassoIcon = () => (<S s={14}><path d="M7 22a5 5 0 0 1-2-4" /><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-3.7-.6" /></S>);
const SlabIcon = () => (<S s={14}><rect x="2" y="7" width="20" height="10" rx="1" /><line x1="6" y1="7" x2="6" y2="17" strokeDasharray="2 2" /><line x1="18" y1="7" x2="18" y2="17" strokeDasharray="2 2" /></S>);
const SelectAllIcon = () => (<S s={14}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 12l2 2 4-4" /></S>);
const InvertIcon = () => (<S s={14}><circle cx="12" cy="12" r="10" /><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" /></S>);
const ClearIcon = () => (<S s={14}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></S>);
const UndoIcon = () => (<S s={14}><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></S>);
const RedoIcon = () => (<S s={14}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" /></S>);
const SolidIcon = () => (<S s={14}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></S>);
const WireframeIcon = () => (<S s={14}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></S>);
const TransparentIcon = () => (<S s={14}><circle cx="12" cy="12" r="10" opacity="0.5" /><circle cx="12" cy="12" r="5" /></S>);
const XrayIcon = () => (<S s={14}><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></S>);
const MoveIcon = () => (<S s={14}><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></S>);
const RotateIcon = () => (<S s={14}><path d="M21.5 2v6h-6" /><path d="M21.34 15.57a10 10 0 1 1-.57-8.38L21.5 8" /></S>);
const ScaleIcon = () => (<S s={14}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></S>);

/* ═══ Tooltip ═══ */

const Tip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enter = () => {
    t.current = setTimeout(() => {
      if (ref.current) {
        const r = ref.current.getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
      }
      setShow(true);
    }, 200);
  };
  const leave = () => {
    if (t.current !== null) {
      clearTimeout(t.current);
    }
    setShow(false);
  };
  return (
    <div ref={ref} onMouseEnter={enter} onMouseLeave={leave} style={{ position: 'relative', display: 'inline-flex' }}>
      {children}
      {show && ReactDOM.createPortal(
        <div style={{
          position: 'fixed', left: pos.x, top: pos.y,
          transform: 'translateX(-50%)',
          padding: '4px 10px', borderRadius: 6,
          fontSize: '0.7rem', fontWeight: 500,
          background: '#1A1F2E', color: '#fff',
          whiteSpace: 'nowrap', pointerEvents: 'none',
          zIndex: 99999,
          boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
          animation: 'tipFadeIn 0.12s ease-out',
        }}>{text}</div>,
        document.body,
      )}
    </div>
  );
};

/* ═══ 按钮 / 分组 / 分隔 ═══ */

const TBtn: React.FC<{
  icon: React.ReactNode; label?: string; tip: string;
  active?: boolean; disabled?: boolean; compact?: boolean;
  onClick: () => void;
}> = ({ icon, label, tip, active, disabled, compact, onClick }) => (
  <Tip text={tip}>
    <button disabled={disabled} onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: label ? 5 : 0,
        padding: compact ? '5px 6px' : label ? '5px 10px' : '5px 8px',
        borderRadius: 'var(--radius-sm, 8px)', border: 'none',
        background: active ? 'var(--primary, #FF8C42)' : 'transparent',
        color: disabled ? 'var(--text-tertiary, #9CA3AF)' : active ? '#fff' : 'var(--text-secondary, #5A6270)',
        fontSize: '0.78rem', fontWeight: active ? 600 : 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap', lineHeight: 1,
        transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
        opacity: disabled ? 0.45 : 1, minWidth: compact ? 28 : undefined, minHeight: 28,
      }}
      onMouseEnter={(e) => { if (!active && !disabled) { e.currentTarget.style.background = 'var(--bg-tertiary, #E8EBED)'; e.currentTarget.style.color = 'var(--text-primary, #1A1F2E)'; } }}
      onMouseLeave={(e) => { if (!active && !disabled) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary, #5A6270)'; } }}
    >
      {icon}{label && <span>{label}</span>}
    </button>
  </Tip>
);

const Grp: React.FC<{ children: React.ReactNode; label?: string }> = ({ children, label }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 1, background: 'var(--bg-secondary, #F3F5F7)', borderRadius: 'var(--radius-sm, 8px)', padding: '2px 3px' }}>
    {label && <span style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-tertiary, #9CA3AF)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 5px 0 3px', userSelect: 'none' }}>{label}</span>}
    {children}
  </div>
);

const Dv: React.FC = () => (
  <div style={{ width: 1, height: 22, background: 'var(--border-light, #E8EBED)', margin: '0 6px', flexShrink: 0 }} />
);

export const PreviewToolbar: React.FC<{
  onUndo?: () => void;
  onRedo?: () => void;
  onClear?: () => void;
  onSelectAll?: () => void;
  onInvert?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}> = ({ onUndo, onRedo, onClear, onSelectAll, onInvert, canUndo, canRedo }) => {
  const state = useEditor();
  const dispatch = useEditorDispatch();
  const { mode, subMode, surfaceTool, viewMode, xray, activeStrengthIdx, activeDirection, activeVolumeMethod, brushNorm, paintThickness, volumeGizmoMode, volumeHandMode } = state;
  const isEdit = mode === 'edit';

  const sTools: { tool: SurfaceTool; icon: React.ReactNode; tip: string }[] = [
    { tool: 'hand',        icon: <HandIcon />,      tip: '移动视角' },
    { tool: 'brush',       icon: <BrushIcon />,     tip: '笔刷涂选' },
    { tool: 'eraser',      icon: <EraserIcon />,    tip: '橡皮擦除' },
    { tool: 'fill',        icon: <FillIcon />,      tip: '填充区域' },
    { tool: 'boxSelect',   icon: <BoxSelectIcon />, tip: '框选' },
    { tool: 'lassoSelect', icon: <LassoIcon />,     tip: '套索选择' },
    { tool: 'slabSelect',  icon: <SlabIcon />,      tip: 'Slab 层选' },
  ];

  return (
    <div style={barStyle}>
      <Grp>
        <TBtn icon={<EyeIcon />} label="预览" tip="预览模式" active={mode === 'preview'} onClick={() => dispatch({ type: 'SET_MODE', mode: 'preview' })} />
        <TBtn icon={<EditIcon />} label="编辑" tip="编辑模式" active={isEdit} onClick={() => dispatch({ type: 'SET_MODE', mode: 'edit' })} />
      </Grp>

      {isEdit && (
        <>
          <Dv />
          <Grp>
            <TBtn icon={<ModuleIcon />} label="模块" tip="模块选择" active={subMode === 'module'} onClick={() => dispatch({ type: 'SET_SUB_MODE', subMode: 'module' })} />
            <TBtn icon={<VolumeIcon />} label="体积" tip="体积区域编辑" active={subMode === 'volume'} onClick={() => dispatch({ type: 'SET_SUB_MODE', subMode: 'volume' })} />
            <TBtn icon={<SurfaceIcon />} label="表面" tip="表面涂选" active={subMode === 'surface'} onClick={() => dispatch({ type: 'SET_SUB_MODE', subMode: 'surface' })} />
          </Grp>
          <Dv />

          {subMode === 'volume' && (
            <>
              <TBtn icon={<HandIcon />} tip="移动视角" compact active={volumeHandMode} onClick={() => dispatch({ type: 'SET_VOLUME_HAND_MODE', enabled: !volumeHandMode })} />
              <Grp label="形状">
                <TBtn icon={<BoxIcon />} tip="立方体" compact active={!volumeHandMode && activeVolumeMethod === 'box'} onClick={() => dispatch({ type: 'SET_VOLUME_METHOD', method: 'box' })} />
                <TBtn icon={<CylinderIcon />} tip="圆柱" compact active={!volumeHandMode && activeVolumeMethod === 'cylinder'} onClick={() => dispatch({ type: 'SET_VOLUME_METHOD', method: 'cylinder' })} />
                <TBtn icon={<SphereIcon />} tip="球体" compact active={!volumeHandMode && activeVolumeMethod === 'sphere'} onClick={() => dispatch({ type: 'SET_VOLUME_METHOD', method: 'sphere' })} />
              </Grp>
              <Dv />
              <Grp label="变换">
                <TBtn icon={<MoveIcon />} tip="移动 (G)" compact active={volumeGizmoMode === 'translate'} onClick={() => dispatch({ type: 'SET_VOLUME_GIZMO_MODE', gizmoMode: 'translate' })} />
                <TBtn icon={<RotateIcon />} tip="旋转 (R)" compact active={volumeGizmoMode === 'rotate'} onClick={() => dispatch({ type: 'SET_VOLUME_GIZMO_MODE', gizmoMode: 'rotate' })} />
                <TBtn icon={<ScaleIcon />} tip="缩放 (S)" compact active={volumeGizmoMode === 'scale'} onClick={() => dispatch({ type: 'SET_VOLUME_GIZMO_MODE', gizmoMode: 'scale' })} />
              </Grp>
              <Dv />
              <Grp label="强度">
                {MAGNET_PRESETS.map((p, i) => (
                  <TBtn key={p.id} icon={null} label={p.label} tip={'磁场: ' + p.label} active={activeStrengthIdx === i} compact onClick={() => dispatch({ type: 'SET_STRENGTH_IDX', idx: i })} />
                ))}
              </Grp>
              <Dv />
              <Grp label="方向">
                {DIRECTION_PRESETS.map((d) => (
                  <TBtn key={d.id} icon={null} label={d.label} tip={'磁场方向: ' + d.label} compact
                    active={activeDirection[0] === d.direction[0] && activeDirection[1] === d.direction[1] && activeDirection[2] === d.direction[2]}
                    onClick={() => dispatch({ type: 'SET_DIRECTION', direction: d.direction })}
                  />
                ))}
              </Grp>
            </>
          )}

          {subMode === 'surface' && (
            <>
              <Grp>
                {sTools.map(({ tool, icon, tip }) => (
                  <TBtn key={tool} icon={icon} tip={tip} compact active={surfaceTool === tool} onClick={() => dispatch({ type: 'SET_SURFACE_TOOL', tool })} />
                ))}
              </Grp>
              {(surfaceTool === 'brush' || surfaceTool === 'eraser') && (
                <Tip text={`笔刷大小: ${Math.round(brushNorm * 100)}%`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px' }}>
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary, #9CA3AF)" strokeWidth="2"><circle cx="12" cy="12" r="4" /></svg>
                    <input
                      type="range" min={0.01} max={0.3} step={0.005}
                      value={brushNorm}
                      onChange={(e) => dispatch({ type: 'SET_BRUSH_NORM', norm: parseFloat(e.target.value) })}
                      style={{ width: 64, height: 4, accentColor: 'var(--primary, #FF8C42)', cursor: 'pointer' }}
                    />
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary, #9CA3AF)" strokeWidth="2"><circle cx="12" cy="12" r="8" /></svg>
                  </div>
                </Tip>
              )}
              {(surfaceTool === 'brush' || surfaceTool === 'eraser') && (
                <Tip text={`涂抹厚度: ${Math.round(paintThickness * 100)}%`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px' }}>
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary, #9CA3AF)" strokeWidth="2"><rect x="4" y="8" width="16" height="8" rx="1" /></svg>
                    <input
                      type="range" min={0.1} max={1.0} step={0.05}
                      value={paintThickness}
                      onChange={(e) => dispatch({ type: 'SET_PAINT_THICKNESS', thickness: parseFloat(e.target.value) })}
                      style={{ width: 64, height: 4, accentColor: 'var(--primary, #FF8C42)', cursor: 'pointer' }}
                    />
                  </div>
                </Tip>
              )}
              <Dv />
              <Grp label="强度">
                {MAGNET_PRESETS.map((p, i) => (
                  <TBtn key={p.id} icon={null} label={p.label} tip={'磁场: ' + p.label} active={activeStrengthIdx === i} compact onClick={() => dispatch({ type: 'SET_STRENGTH_IDX', idx: i })} />
                ))}
              </Grp>
              <Dv />
              <Grp label="方向">
                {DIRECTION_PRESETS.map((d) => (
                  <TBtn key={d.id} icon={null} label={d.label} tip={'磁场方向: ' + d.label} compact
                    active={activeDirection[0] === d.direction[0] && activeDirection[1] === d.direction[1] && activeDirection[2] === d.direction[2]}
                    onClick={() => dispatch({ type: 'SET_DIRECTION', direction: d.direction })}
                  />
                ))}
              </Grp>
              <Dv />
              <Grp>
                <TBtn icon={<SelectAllIcon />} tip="全选" compact onClick={() => onSelectAll?.()} />
                <TBtn icon={<InvertIcon />} tip="反选" compact onClick={() => onInvert?.()} />
                <TBtn icon={<ClearIcon />} tip="清除" compact onClick={() => onClear?.()} />
                <TBtn icon={<UndoIcon />} tip="撤销" compact disabled={!canUndo} onClick={() => onUndo?.()} />
                <TBtn icon={<RedoIcon />} tip="重做" compact disabled={!canRedo} onClick={() => onRedo?.()} />
              </Grp>
            </>
          )}
        </>
      )}

      <div style={{ marginLeft: 'auto' }}>
        <Grp>
          <TBtn icon={<SolidIcon />} tip="实体视图" compact active={viewMode === 'solid'} onClick={() => dispatch({ type: 'SET_VIEW_MODE', viewMode: 'solid' })} />
          <TBtn icon={<WireframeIcon />} tip="线框视图" compact active={viewMode === 'wireframe'} onClick={() => dispatch({ type: 'SET_VIEW_MODE', viewMode: 'wireframe' })} />
          <TBtn icon={<TransparentIcon />} tip="透明视图" compact active={viewMode === 'transparent'} onClick={() => dispatch({ type: 'SET_VIEW_MODE', viewMode: 'transparent' })} />
          <TBtn icon={<XrayIcon />} tip={xray ? 'X光 (开)' : 'X光 (关)'} compact active={xray} onClick={() => dispatch({ type: 'TOGGLE_XRAY' })} />
        </Grp>
      </div>
    </div>
  );
};

const barStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 10px',
  background: 'rgba(255,255,255,0.92)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  borderBottom: '1px solid var(--border-light, #E8EBED)',
  flexShrink: 0, minHeight: 46,
  overflowX: 'auto', overflowY: 'hidden',
  zIndex: 20,
  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
};
