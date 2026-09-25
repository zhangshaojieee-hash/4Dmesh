/**
 * FloatingInspector.tsx — 右侧悬浮属性面板
 */
import React, { useState, useEffect } from 'react';
import { useEditor, useEditorDispatch } from '../../stores/editor';
import { MAGNET_PRESETS, DIRECTION_PRESETS, DEFAULT_DIRECTION } from '../../types';
import type { VolumeRegion, TagType, VolumeTransform } from '../lib/editor-types';

/* ═══ 通用面板容器 ═══ */

const Panel: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="preview-floating-panel" style={panelStyle}>
    <div style={headerStyle}>
      <span style={{ fontWeight: 600, fontSize: '0.84rem', color: 'var(--text-primary, #1A1F2E)' }}>{title}</span>
      <button onClick={onClose} style={closeBtnStyle} title="关闭">&times;</button>
    </div>
    <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {children}
    </div>
  </div>
);

/* ═══ 字段行 ═══ */

const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <label style={{ fontSize: '0.73rem', color: 'var(--text-tertiary, #9CA3AF)', fontWeight: 500 }}>{label}</label>
    {children}
  </div>
);

const ToggleSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void }> = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    style={{
      width: 38,
      height: 22,
      borderRadius: 999,
      border: 'none',
      padding: 2,
      cursor: 'pointer',
      background: checked ? 'var(--primary, #FF8C42)' : 'var(--border-light, #E8EBED)',
      transition: 'background 0.15s',
    }}
  >
    <span
      style={{
        display: 'block',
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: '#fff',
        transform: checked ? 'translateX(16px)' : 'translateX(0)',
        transition: 'transform 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
      }}
    />
  </button>
);

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 'var(--radius-sm, 8px)',
  border: '1px solid var(--border-light, #E8EBED)',
  fontSize: '0.82rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
  background: 'rgba(255,255,255,0.7)',
};

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

/* ═══ Vec3 数值输入 ═══ */

const vec3Labels = ['X', 'Y', 'Z'] as const;
const vec3Colors = ['#EF4444', '#22C55E', '#3B82F6'] as const;

const Vec3Input: React.FC<{
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  step?: number;
  min?: number;
  max?: number;
}> = ({ value, onChange, step = 0.01, min, max }) => {
  const update = (idx: number, raw: string) => {
    const n = parseFloat(raw);
    if (isNaN(n)) return;
    const next = [...value] as [number, number, number];
    next[idx] = n;
    onChange(next);
  };
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {vec3Labels.map((label, i) => (
        <div key={label} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: vec3Colors[i], width: 12, textAlign: 'center', flexShrink: 0 }}>{label}</span>
          <input
            type="number"
            step={step}
            min={min}
            max={max}
            value={value[i]}
            onChange={(e) => update(i, e.target.value)}
            style={{ ...inputStyle, padding: '4px 5px', fontSize: '0.75rem', textAlign: 'right' }}
          />
        </div>
      ))}
    </div>
  );
};

/* ═══ Module 面板 ═══ */

const ModulePanel: React.FC = () => {
  const { selectedModuleId, modules } = useEditor();
  const dispatch = useEditorDispatch();
  const mod = modules.find(m => m.module_id === selectedModuleId);
  const [name, setName] = useState('');

  useEffect(() => { if (mod) setName(mod.name); }, [mod]);

  if (!mod) return null;

  return (
    <Panel title="模块属性" onClose={() => dispatch({ type: 'SELECT_MODULE', id: null })}>
      <Field label="名称">
        <input
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => dispatch({ type: 'UPDATE_MODULE', id: mod.module_id, changes: { name } })}
        />
      </Field>
      <Field label="标签">
        <select
          style={selectStyle}
          value={mod.tag}
          onChange={(e) => dispatch({ type: 'UPDATE_MODULE', id: mod.module_id, changes: { tag: e.target.value as TagType } })}
        >
          <option value="normal">普通</option>
          <option value="magnetic">加磁</option>
          <option value="module">模块</option>
        </select>
      </Field>
      <Field label="可见">
        <ToggleSwitch
          checked={mod.visible}
          onChange={(v) => dispatch({ type: 'UPDATE_MODULE', id: mod.module_id, changes: { visible: v } })}
        />
      </Field>
      <Field label="锁定">
        <ToggleSwitch
          checked={mod.locked}
          onChange={(v) => dispatch({ type: 'UPDATE_MODULE', id: mod.module_id, changes: { locked: v } })}
        />
      </Field>
      <Field label="导出">
        <ToggleSwitch
          checked={mod.export_enabled}
          onChange={(v) => dispatch({ type: 'UPDATE_MODULE', id: mod.module_id, changes: { export_enabled: v } })}
        />
      </Field>
      <Field label="包含网格">
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #888)' }}>
          {mod.source_segments.join(', ') || '无'}
        </span>
      </Field>
      <button
        style={deleteBtnStyle}
        onClick={() => dispatch({ type: 'DELETE_MODULE', id: mod.module_id })}
      >
        删除模块
      </button>
    </Panel>
  );
};

/* ═══ Volume 面板 ═══ */

const VolumePanel: React.FC<{ onConfirmVolume?: () => void; onCancelVolume?: () => void }> = ({ onConfirmVolume, onCancelVolume }) => {
  const { selectedVolumeId, volumeRegions, pendingVolume } = useEditor();
  const dispatch = useEditorDispatch();

  // pending volume 面板
  if (pendingVolume) {
    const updatePendingTransform = (key: keyof VolumeTransform, value: [number, number, number]) => {
      dispatch({ type: 'UPDATE_PENDING_VOLUME', transform: { ...pendingVolume.transform, [key]: value } });
    };
    return (
      <Panel title="新建体积区域" onClose={() => dispatch({ type: 'CANCEL_PENDING_VOLUME' })}>
        <Field label="类型">
          <span style={{ fontSize: '0.82rem' }}>
            {{ box: '立方体', cylinder: '圆柱', sphere: '球体' }[pendingVolume.method]}
          </span>
        </Field>
        <Field label="位置">
          <Vec3Input value={pendingVolume.transform.position} onChange={(v) => updatePendingTransform('position', v)} step={0.05} />
        </Field>
        <Field label="旋转 (°)">
          <Vec3Input value={pendingVolume.transform.rotation} onChange={(v) => updatePendingTransform('rotation', v)} step={1} min={-360} max={360} />
        </Field>
        <Field label="缩放">
          <Vec3Input value={pendingVolume.transform.scale} onChange={(v) => updatePendingTransform('scale', v)} step={0.05} min={0.01} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={{ ...confirmBtnStyle, flex: 1 }}
            onClick={() => {
              if (onConfirmVolume) onConfirmVolume();
              else dispatch({ type: 'CONFIRM_PENDING_VOLUME' });
            }}
          >
            确认
          </button>
          <button
            style={{ ...deleteBtnStyle, flex: 1 }}
            onClick={() => {
              if (onCancelVolume) onCancelVolume();
              else dispatch({ type: 'CANCEL_PENDING_VOLUME' });
            }}
          >
            取消
          </button>
        </div>
      </Panel>
    );
  }

  const vol = volumeRegions.find(v => v.region_id === selectedVolumeId);
  if (!vol) return null;

  return (
    <VolumeDetailPanel vol={vol} />
  );
};

const VolumeDetailPanel: React.FC<{ vol: VolumeRegion }> = ({ vol }) => {
  const dispatch = useEditorDispatch();
  const [name, setName] = useState(vol.name);

  useEffect(() => { setName(vol.name); }, [vol.name]);

  const updateTransform = (key: keyof VolumeTransform, value: [number, number, number]) => {
    dispatch({ type: 'UPDATE_VOLUME', id: vol.region_id, changes: { transform: { ...vol.transform, [key]: value } } });
  };

  return (
    <Panel title="体积区域属性" onClose={() => dispatch({ type: 'SELECT_VOLUME', id: null })}>
      <Field label="名称">
        <input
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => dispatch({ type: 'UPDATE_VOLUME', id: vol.region_id, changes: { name } })}
        />
      </Field>
      <Field label="类型">
        <span style={{ fontSize: '0.82rem' }}>
          {{ box: '立方体', cylinder: '圆柱', sphere: '球体' }[vol.method]}
        </span>
      </Field>
      <Field label="位置">
        <Vec3Input value={vol.transform.position} onChange={(v) => updateTransform('position', v)} step={0.05} />
      </Field>
      <Field label="旋转 (°)">
        <Vec3Input value={vol.transform.rotation} onChange={(v) => updateTransform('rotation', v)} step={1} min={-360} max={360} />
      </Field>
      <Field label="缩放">
        <Vec3Input value={vol.transform.scale} onChange={(v) => updateTransform('scale', v)} step={0.05} min={0.01} />
      </Field>
      <Field label="标签">
        <select
          style={selectStyle}
          value={vol.tag}
          onChange={(e) => dispatch({ type: 'UPDATE_VOLUME', id: vol.region_id, changes: { tag: e.target.value as 'magnetic' | 'normal' } })}
        >
          <option value="magnetic">加磁</option>
          <option value="normal">普通</option>
        </select>
      </Field>
      {vol.tag === 'magnetic' && (
        <>
        <Field label="磁场强度">
          <div style={{ display: 'flex', gap: 4 }}>
            {MAGNET_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => dispatch({ type: 'UPDATE_VOLUME', id: vol.region_id, changes: { strengthId: p.id } })}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  borderRadius: 6,
                  border: vol.strengthId === p.id ? `2px solid ${p.color}` : '1px solid var(--border-light, #E8EBED)',
                  background: vol.strengthId === p.id ? `${p.color}18` : 'transparent',
                  cursor: 'pointer',
                  fontSize: '0.72rem',
                  fontWeight: vol.strengthId === p.id ? 600 : 400,
                  color: vol.strengthId === p.id ? p.color : 'var(--text-secondary, #888)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                {p.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="磁场方向" className="preview-field preview-field--direction">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DIRECTION_PRESETS.map((d) => {
              const volDir = vol.direction ?? DEFAULT_DIRECTION;
              const isActive = volDir[0] === d.direction[0] && volDir[1] === d.direction[1] && volDir[2] === d.direction[2];
              return (
                <button
                  key={d.id}
                  onClick={() => dispatch({ type: 'UPDATE_VOLUME', id: vol.region_id, changes: { direction: d.direction } })}
                  style={{
                    flex: '1 0 28%',
                    padding: '4px 0',
                    borderRadius: 6,
                    border: isActive ? '2px solid var(--primary, #FF8C42)' : '1px solid var(--border-light, #E8EBED)',
                    background: isActive ? 'rgba(255,140,66,0.1)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: '0.68rem',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--primary, #FF8C42)' : 'var(--text-secondary, #888)',
                    transition: 'all 0.15s',
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <Vec3Input
            value={vol.direction ?? DEFAULT_DIRECTION}
            onChange={(v) => dispatch({ type: 'UPDATE_VOLUME', id: vol.region_id, changes: { direction: v } })}
            step={0.1} min={-1} max={1}
          />
        </Field>
        </>
      )}
      <Field label="体积尺寸">
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #888)' }}>
          {vol.transform.scale[0].toFixed(1)} × {vol.transform.scale[1].toFixed(1)} × {vol.transform.scale[2].toFixed(1)}
        </span>
      </Field>
      <Field label="Z 范围">
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #888)' }}>
          {vol.z_range.z_min.toFixed(2)} ~ {vol.z_range.z_max.toFixed(2)}
        </span>
      </Field>
      <button
        style={deleteBtnStyle}
        onClick={() => dispatch({ type: 'DELETE_VOLUME', id: vol.region_id })}
      >
        删除区域
      </button>
    </Panel>
  );
};

/* ═══ 模块引导面板 ═══ */

const ModuleGuidePanel: React.FC = () => {
  const { modules } = useEditor();
  const dispatch = useEditorDispatch();
  return (
    <div className="preview-floating-panel" style={panelStyle}>
      <div style={{ ...headerStyle, borderBottom: modules.length ? headerStyle.borderBottom : 'none' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary, #1A1F2E)' }}>模块选择</span>
      </div>
      <div style={{ padding: '10px 14px' }}>
        <p style={guideTextStyle}>
          点击模型部件选择模块，可标记为<b>加磁</b>或<b>普通</b>区域
        </p>
        {modules.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary, #9CA3AF)', marginBottom: 2 }}>已创建模块</span>
            {modules.map(m => (
              <div
                key={m.module_id}
                onClick={() => dispatch({ type: 'SELECT_MODULE', id: m.module_id })}
                style={listItemStyle}
              >
                <span style={{ fontSize: '0.78rem' }}>{m.name}</span>
                <span style={{
                  fontSize: '0.65rem', padding: '1px 6px', borderRadius: 4,
                  background: m.tag === 'magnetic' ? 'rgba(255,140,66,0.15)' : 'rgba(0,0,0,0.05)',
                  color: m.tag === 'magnetic' ? 'var(--primary, #FF8C42)' : 'var(--text-tertiary, #9CA3AF)',
                }}>{m.tag === 'magnetic' ? '加磁' : '普通'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══ 体积引导面板 ═══ */

const VolumeGuidePanel: React.FC = () => {
  const { volumeRegions, volumeSizeNorm, activeStrengthIdx, activeDirection } = useEditor();
  const dispatch = useEditorDispatch();
  const regions = volumeRegions ?? [];
  return (
    <div className="preview-floating-panel" style={panelStyle}>
      <div style={{ ...headerStyle, borderBottom: 'none' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary, #1A1F2E)' }}>体积区域</span>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={guideTextStyle}>
          在工具栏选择形状后，点击模型表面放置体积区域
        </p>
        <Field label="大小">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="range" min={0.05} max={0.8} step={0.01}
              value={volumeSizeNorm}
              onChange={(e) => dispatch({ type: 'SET_VOLUME_SIZE_NORM', norm: parseFloat(e.target.value) })}
              style={{ flex: 1, height: 4, accentColor: 'var(--primary, #FF8C42)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #888)', minWidth: 28, textAlign: 'right' }}>
              {Math.round(volumeSizeNorm * 100)}%
            </span>
          </div>
        </Field>
        <Field label="磁场强度">
          <div style={{ display: 'flex', gap: 4 }}>
            {MAGNET_PRESETS.map((p, i) => (
              <button
                key={p.id}
                onClick={() => dispatch({ type: 'SET_STRENGTH_IDX', idx: i })}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  borderRadius: 6,
                  border: i === activeStrengthIdx ? `2px solid ${p.color}` : '1px solid var(--border-light, #E8EBED)',
                  background: i === activeStrengthIdx ? `${p.color}18` : 'transparent',
                  cursor: 'pointer',
                  fontSize: '0.72rem',
                  fontWeight: i === activeStrengthIdx ? 600 : 400,
                  color: i === activeStrengthIdx ? p.color : 'var(--text-secondary, #888)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                {p.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="磁场方向" className="preview-field preview-field--direction">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DIRECTION_PRESETS.map((d) => {
              const isActive = activeDirection[0] === d.direction[0] && activeDirection[1] === d.direction[1] && activeDirection[2] === d.direction[2];
              return (
                <button
                  key={d.id}
                  onClick={() => dispatch({ type: 'SET_DIRECTION', direction: d.direction })}
                  style={{
                    flex: '1 0 28%',
                    padding: '4px 0',
                    borderRadius: 6,
                    border: isActive ? '2px solid var(--primary, #FF8C42)' : '1px solid var(--border-light, #E8EBED)',
                    background: isActive ? 'rgba(255,140,66,0.1)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: '0.68rem',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--primary, #FF8C42)' : 'var(--text-secondary, #888)',
                    transition: 'all 0.15s',
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <Vec3Input
            value={activeDirection}
            onChange={(v) => dispatch({ type: 'SET_DIRECTION', direction: v })}
            step={0.1} min={-1} max={1}
          />
        </Field>
        {regions.length > 0 && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary, #9CA3AF)', marginBottom: 2 }}>已创建区域</span>
            {regions.map(v => (
              <div
                key={v.region_id}
                onClick={() => dispatch({ type: 'SELECT_VOLUME', id: v.region_id })}
                style={listItemStyle}
              >
                <span style={{ fontSize: '0.78rem' }}>{v.name}</span>
                <span style={{
                  fontSize: '0.65rem', padding: '1px 6px', borderRadius: 4,
                  background: 'rgba(0,0,0,0.05)',
                  color: 'var(--text-tertiary, #9CA3AF)',
                }}>{{ box: '立方体', cylinder: '圆柱', sphere: '球体' }[v.method]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══ 表面属性面板 ═══ */

const SurfacePanel: React.FC = () => {
  const { surfaceTool, brushNorm, paintThickness, activeStrengthIdx, activeDirection } = useEditor();
  const dispatch = useEditorDispatch();
  const toolNames: Record<string, string> = {
    brush: '笔刷', eraser: '橡皮', fill: '填充', lasso: '套索', box_select: '框选', slab: '切片', hand: '平移',
  };
  const showSlider = surfaceTool === 'brush' || surfaceTool === 'eraser';
  const preset = MAGNET_PRESETS[activeStrengthIdx];

  return (
    <div className="preview-floating-panel preview-surface-panel" style={panelStyle}>
      <div style={headerStyle}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary, #1A1F2E)' }}>表面涂选</span>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="当前工具" className="preview-field preview-field--current-tool">
          <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{toolNames[surfaceTool] || surfaceTool}</span>
        </Field>
        {showSlider && (
           <Field label="笔刷大小" className="preview-field preview-field--brush-size">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
               <input
                 type="range" min={0.01} max={0.3} step={0.005}
                 value={brushNorm}
                 onChange={(e) => dispatch({ type: 'SET_BRUSH_NORM', norm: parseFloat(e.target.value) })}
                 style={{ flex: 1, height: 4, accentColor: 'var(--primary, #FF8C42)', cursor: 'pointer' }}
               />
               <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #888)', minWidth: 28, textAlign: 'right' }}>
                 {Math.round(brushNorm * 100)}%
              </span>
            </div>
          </Field>
        )}
        {showSlider && (
          <Field label="涂抹厚度" className="preview-field preview-field--paint-thickness">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="range" min={0.1} max={1.0} step={0.05}
                value={paintThickness}
                onChange={(e) => dispatch({ type: 'SET_PAINT_THICKNESS', thickness: parseFloat(e.target.value) })}
                style={{ flex: 1, height: 4, accentColor: 'var(--primary, #FF8C42)', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #888)', minWidth: 28, textAlign: 'right' }}>
                {Math.round(paintThickness * 100)}%
              </span>
            </div>
          </Field>
        )}
        <Field label="磁场强度" className="preview-field preview-field--strength">
          <span style={{ fontSize: '0.78rem', color: 'var(--primary, #FF8C42)', fontWeight: 500 }}>
            {preset?.label ?? '—'}
          </span>
        </Field>
        <Field label="磁场方向" className="preview-field preview-field--direction">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DIRECTION_PRESETS.map((d) => {
              const isActive = activeDirection[0] === d.direction[0] && activeDirection[1] === d.direction[1] && activeDirection[2] === d.direction[2];
              return (
                <button
                  key={d.id}
                  onClick={() => dispatch({ type: 'SET_DIRECTION', direction: d.direction })}
                  style={{
                    flex: '1 0 28%',
                    padding: '4px 0',
                    borderRadius: 6,
                    border: isActive ? '2px solid var(--primary, #FF8C42)' : '1px solid var(--border-light, #E8EBED)',
                    background: isActive ? 'rgba(255,140,66,0.1)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: '0.68rem',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--primary, #FF8C42)' : 'var(--text-secondary, #888)',
                    transition: 'all 0.15s',
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <Vec3Input
            value={activeDirection}
            onChange={(v) => dispatch({ type: 'SET_DIRECTION', direction: v })}
            step={0.1} min={-1} max={1}
          />
        </Field>
      </div>
    </div>
  );
};

/* ═══ 主组件 ═══ */

interface FloatingInspectorProps {
  onConfirmVolume?: () => void;
  onCancelVolume?: () => void;
}

export const FloatingInspector: React.FC<FloatingInspectorProps> = ({ onConfirmVolume, onCancelVolume }) => {
  const { mode, subMode, selectedModuleId, selectedVolumeId, pendingVolume } = useEditor();
  const hasPendingVolume = Boolean(pendingVolume);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    setIsDrawerOpen(false);
  }, [mode, subMode, selectedModuleId, selectedVolumeId, hasPendingVolume]);

  if (mode !== 'edit') return null;

  const showModuleDetail = subMode === 'module' && selectedModuleId;
  const showModuleGuide = subMode === 'module' && !selectedModuleId;
  const showVolumeDetail = subMode === 'volume' && (selectedVolumeId || pendingVolume);
  const showVolumeGuide = subMode === 'volume' && !selectedVolumeId && !pendingVolume;
  const showSurface = subMode === 'surface';

  if (!showModuleDetail && !showModuleGuide && !showVolumeDetail && !showVolumeGuide && !showSurface) return null;

  const inspectorModeClass = showSurface
    ? 'preview-floating-inspector--surface'
    : (showVolumeDetail || showVolumeGuide)
      ? 'preview-floating-inspector--volume'
      : 'preview-floating-inspector--module';
  const drawerStateClass = isDrawerOpen
    ? 'preview-floating-inspector--drawer-open'
    : 'preview-floating-inspector--collapsed';
  const drawerLabel = showSurface ? '磁场方向' : '编辑参数';

  return (
    <div className={`preview-floating-inspector ${inspectorModeClass} ${drawerStateClass}`} style={inspectorContainerStyle}>
      <button
        type="button"
        className="preview-inspector-drawer-toggle"
        onClick={() => setIsDrawerOpen((open) => !open)}
        aria-expanded={isDrawerOpen}
        aria-controls="preview-floating-inspector-content"
        title={isDrawerOpen ? '收起参数面板' : '展开参数面板'}
      >
        <span className="preview-inspector-drawer-grip" aria-hidden="true" />
        <span>{drawerLabel}</span>
      </button>
      <div id="preview-floating-inspector-content" className="preview-floating-inspector__content">
        {showModuleDetail && <ModulePanel />}
        {showModuleGuide && <ModuleGuidePanel />}
        {showVolumeDetail && <VolumePanel onConfirmVolume={onConfirmVolume} onCancelVolume={onCancelVolume} />}
        {showVolumeGuide && <VolumeGuidePanel />}
        {showSurface && <SurfacePanel />}
      </div>
    </div>
  );
};

/* ═══ Styles ═══ */

const inspectorContainerStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  top: 56,
  width: 252,
  zIndex: 18,
  pointerEvents: 'auto',
};

const panelStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.88)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  borderRadius: 'var(--radius-md, 12px)',
  border: '1px solid rgba(255,255,255,0.6)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 14px',
  borderBottom: '1px solid var(--border-light, #E8EBED)',
  background: 'rgba(0,0,0,0.015)',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: '1.1rem',
  cursor: 'pointer',
  color: 'var(--text-tertiary, #9CA3AF)',
  padding: '2px 4px',
  lineHeight: 1,
  borderRadius: 4,
  transition: 'color 0.15s, background 0.15s',
};

const deleteBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px',
  borderRadius: 'var(--radius-sm, 8px)',
  border: '1px solid var(--error, #FF6B6B)',
  background: 'transparent',
  color: 'var(--error, #FF6B6B)',
  fontSize: '0.8rem',
  cursor: 'pointer',
  marginTop: 6,
  transition: 'background 0.15s, color 0.15s',
};

const confirmBtnStyle: React.CSSProperties = {
  padding: '7px',
  borderRadius: 'var(--radius-sm, 8px)',
  border: 'none',
  background: 'var(--primary, #FF8C42)',
  color: '#fff',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'opacity 0.15s',
};

const guideTextStyle: React.CSSProperties = {
  fontSize: '0.76rem',
  color: 'var(--text-secondary, #6B7280)',
  lineHeight: 1.5,
  margin: 0,
};

const listItemStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 8px',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'background 0.12s',
  background: 'rgba(0,0,0,0.02)',
};
