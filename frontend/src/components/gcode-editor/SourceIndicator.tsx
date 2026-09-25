import React from 'react';
import { useProject, useProjectDispatch } from '../../stores/project';

export const SourceIndicator: React.FC = () => {
  const { inputType, sourceFile } = useProject();
  const projectDispatch = useProjectDispatch();

  if (inputType === 'none' || !sourceFile) return null;

  const getSourceIcon = () => {
    switch (inputType) {
      case 'ai_project': return '🤖';
      case 'standalone_model': return '📦';
      case 'gcode': return '📄';
      default: return '📁';
    }
  };

  const getSourceLabel = () => {
    switch (inputType) {
      case 'ai_project': return 'AI创作';
      case 'standalone_model': return '上传模型';
      case 'gcode': return '上传G-code';
      default: return '未知';
    }
  };

  const handleClear = () => {
    projectDispatch({ type: 'CLEAR_GCODE_DATA' });
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 16px',
      backgroundColor: '#f5f5f5',
      borderRadius: '8px',
      marginBottom: '16px',
      border: '1px solid #e0e0e0'
    }}>
      <span style={{ fontSize: '20px' }}>{getSourceIcon()}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#333' }}>
          {sourceFile.name}
        </div>
        <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
          来源: {getSourceLabel()}
          {sourceFile.size && ` • ${(sourceFile.size / 1024).toFixed(1)} KB`}
        </div>
      </div>
      <button
        onClick={handleClear}
        style={{
          padding: '6px 12px',
          fontSize: '12px',
          backgroundColor: '#fff',
          border: '1px solid #ddd',
          borderRadius: '4px',
          cursor: 'pointer',
          color: '#666'
        }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9f9f9'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#fff'}
      >
        清除
      </button>
    </div>
  );
};
