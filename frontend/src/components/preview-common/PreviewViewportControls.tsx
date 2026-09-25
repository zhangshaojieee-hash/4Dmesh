import React from 'react';

interface Props {
  onTop: () => void;
  onFront: () => void;
  onSide: () => void;
  onPerspective: () => void;
  onReset: () => void;
  showAxes?: boolean;
}

const btnStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--border-light, #E8EBED)',
  background: 'rgba(255,255,255,0.92)',
  color: 'var(--text-primary, #1F2937)',
  borderRadius: '8px',
  fontSize: '0.75rem',
  fontWeight: 600,
  cursor: 'pointer',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
};

const PreviewViewportControls: React.FC<Props> = ({ onTop, onFront, onSide, onPerspective, onReset, showAxes = true }) => {
  return (
    <>
      <div style={{
        position: 'absolute',
        top: 12,
        right: 12,
        display: 'flex',
        gap: 8,
        zIndex: 30,
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
      }}>
        <button type="button" style={btnStyle} onClick={onTop}>顶视</button>
        <button type="button" style={btnStyle} onClick={onFront}>前视</button>
        <button type="button" style={btnStyle} onClick={onSide}>侧视</button>
        <button type="button" style={btnStyle} onClick={onPerspective}>透视</button>
        <button type="button" style={btnStyle} onClick={onReset}>重置</button>
      </div>

      {showAxes && (
        <div style={{
          position: 'absolute',
          right: 16,
          bottom: 56,
          width: 52,
          height: 52,
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.9)',
          border: '1px solid var(--border-light, #E8EBED)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.72rem',
          fontWeight: 700,
        }}>
          <div style={{ position: 'relative', width: 32, height: 32 }}>
            <span style={{ position: 'absolute', right: -2, top: 12, color: '#EF4444' }}>X</span>
            <span style={{ position: 'absolute', left: 10, top: -2, color: '#22C55E' }}>Y</span>
            <span style={{ position: 'absolute', left: -2, bottom: -2, color: '#3B82F6' }}>Z</span>
            <div style={{ position: 'absolute', left: 14, top: 14, width: 4, height: 4, borderRadius: '50%', background: '#64748B' }} />
          </div>
        </div>
      )}
    </>
  );
};

export default PreviewViewportControls;
