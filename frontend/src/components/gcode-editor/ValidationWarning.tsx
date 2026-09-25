import React from 'react';
import type { ValidationDiscrepancy } from '../../utils/gcodeValidator';

interface ValidationWarningProps {
  discrepancies: ValidationDiscrepancy[];
  onClose: () => void;
}

const ValidationWarning: React.FC<ValidationWarningProps> = ({ discrepancies, onClose }) => {
  if (discrepancies.length === 0) return null;

  return (
    <div className="alert alert-error" style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <strong>⚠️ G-code 统计验证警告</strong>
          <div style={{ marginTop: '8px', fontSize: '0.9rem' }}>
            {discrepancies.map((d, i) => (
              <div key={i} style={{ marginTop: '4px' }}>
                • {d.metric}: 前端 {d.frontend} vs 后端 {d.backend}
              </div>
            ))}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '0 8px' }}>×</button>
      </div>
    </div>
  );
};

export default ValidationWarning;
