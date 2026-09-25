import React, { useState } from 'react';
import { useEditor } from '../../stores/editor';

export const HelpPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const { mode, subMode } = useEditor();

  const shortcuts: { key: string; desc: string }[] = [
    { key: 'Ctrl + 拖拽', desc: '旋转/平移视角' },
    { key: '滚轮', desc: '缩放' },
  ];

  if (mode === 'edit' && subMode === 'volume') {
    shortcuts.push(
      { key: '点击空白', desc: '放置体积区域' },
      { key: '点击已有区域', desc: '选中编辑' },
      { key: 'G / R / S', desc: '移动 / 旋转 / 缩放' },
      { key: 'Delete', desc: '删除选中区域' },
    );
  }

  if (mode === 'edit' && subMode === 'surface') {
    shortcuts.push(
      { key: '点击/拖拽', desc: '涂刷磁场区域' },
      { key: '[ / ]', desc: '缩小/放大笔刷' },
      { key: 'Ctrl+Z / Ctrl+Y', desc: '撤销/重做' },
    );
  }

  if (mode === 'edit' && subMode === 'module') {
    shortcuts.push(
      { key: '悬停', desc: '高亮模块' },
      { key: '点击', desc: '选择模块' },
    );
  }

  return (
    <div style={containerStyle}>
      <button onClick={() => setOpen(!open)} style={toggleStyle} title="快捷键帮助">
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
      {open && (
        <div style={panelStyle}>
          <div style={headerStyle}>快捷键</div>
          {shortcuts.map((s, i) => (
            <div key={i} style={rowStyle}>
              <kbd style={kbdStyle}>{s.key}</kbd>
              <span style={descStyle}>{s.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  position: 'absolute', bottom: 12, right: 12, zIndex: 30,
};

const toggleStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(255,255,255,0.9)', border: '1px solid #E8EBED',
  cursor: 'pointer', color: '#6B7280', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};

const panelStyle: React.CSSProperties = {
  position: 'absolute', bottom: 40, right: 0, width: 240,
  background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)',
  borderRadius: 10, border: '1px solid #E8EBED', padding: '10px 12px',
  boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
};

const headerStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8,
  borderBottom: '1px solid #F3F4F6', paddingBottom: 6,
};

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
};

const kbdStyle: React.CSSProperties = {
  fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace',
  background: '#F3F4F6', borderRadius: 4, padding: '1px 5px',
  border: '1px solid #E5E7EB', color: '#4B5563', whiteSpace: 'nowrap',
};

const descStyle: React.CSSProperties = {
  fontSize: 12, color: '#6B7280',
};
