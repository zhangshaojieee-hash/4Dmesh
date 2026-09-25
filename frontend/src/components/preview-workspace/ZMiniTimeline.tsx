/**
 * ZMiniTimeline.tsx — 底部 Z 信息条
 */
import React from 'react';
import { useEditor, useEditorDispatch } from '../../stores/editor';

const Ico: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const HeightIcon = () => (<Ico><line x1="12" y1="2" x2="12" y2="22" /><polyline points="8 6 12 2 16 6" /><polyline points="8 18 12 22 16 18" /></Ico>);
const LayerIcon = () => (<Ico><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></Ico>);
const ScissorsIcon = () => (<Ico><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" /></Ico>);

export const ZMiniTimeline: React.FC = () => {
  const { mode, modelBounds, sectionEnabled, sectionHeight, selectedVolumeId, volumeRegions } = useEditor();
  const dispatch = useEditorDispatch();

  if (mode !== 'edit') return null;

  const totalH = modelBounds.max - modelBounds.min;
  const selVol = selectedVolumeId ? volumeRegions.find(v => v.region_id === selectedVolumeId) : null;
  const lh = 0.2;

  return (
    <div className="preview-z-mini-timeline" style={barStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: '0 0 auto' }}>
        <span style={tagStyle}>
          <HeightIcon />
          <strong>{totalH.toFixed(1)}</strong> mm
        </span>
        {selVol && (
          <span style={tagStyle}>
            <LayerIcon />
            Z {selVol.z_range.z_min.toFixed(1)}~{selVol.z_range.z_max.toFixed(1)}
            <span style={{ opacity: 0.6, marginLeft: 4 }}>
              L{Math.floor((selVol.z_range.z_min - modelBounds.min) / lh)}
              ~{Math.ceil((selVol.z_range.z_max - modelBounds.min) / lh)}
            </span>
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'center' }}>
        <label
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', padding: '3px 8px', borderRadius: 6, background: sectionEnabled ? 'rgba(0,201,167,0.1)' : 'transparent', transition: 'background 0.15s' }}
        >
          <input type="checkbox" checked={sectionEnabled}
            onChange={(e) => dispatch({ type: 'SET_SECTION', enabled: e.target.checked })}
            style={{ accentColor: 'var(--secondary, #00C9A7)', width: 14, height: 14 }} />
          <ScissorsIcon />
          <span style={{ fontSize: '0.76rem', color: sectionEnabled ? 'var(--secondary, #00C9A7)' : 'var(--text-tertiary, #9CA3AF)', fontWeight: 500 }}>剖切</span>
        </label>
        {sectionEnabled && (
          <input type="range"
            min={modelBounds.min} max={modelBounds.max} step={0.01}
            value={sectionHeight}
            onChange={(e) => dispatch({ type: 'SET_SECTION', enabled: true, height: parseFloat(e.target.value) })}
            style={sliderStyle} />
        )}
      </div>

      <div style={{ flex: '0 0 auto' }}>
        {sectionEnabled && (
          <span style={{ ...tagStyle, background: 'rgba(0,201,167,0.08)', color: 'var(--secondary, #00C9A7)' }}>
            <ScissorsIcon />
            <strong>{sectionHeight.toFixed(2)}</strong>
          </span>
        )}
      </div>
    </div>
  );
};

const barStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 0, left: 0, right: 0,
  height: 42,
  background: 'rgba(255,255,255,0.88)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  borderTop: '1px solid var(--border-light, #E8EBED)',
  display: 'flex', alignItems: 'center',
  padding: '0 14px', gap: 12,
  zIndex: 15, fontSize: '0.78rem',
  boxShadow: '0 -1px 3px rgba(0,0,0,0.03)',
};

const tagStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  color: 'var(--text-secondary, #5A6270)',
  whiteSpace: 'nowrap',
  padding: '3px 8px',
  borderRadius: 6,
  background: 'var(--bg-secondary, #F3F5F7)',
  fontSize: '0.76rem',
};

const sliderStyle: React.CSSProperties = {
  width: 180,
  accentColor: 'var(--secondary, #00C9A7)',
  cursor: 'pointer',
};
