import React from 'react';

export const SkeletonCard: React.FC = () => (
  <div className="model-card" style={{ pointerEvents: 'none' }}>
    <div className="model-thumbnail skeleton-shimmer" />
    <div className="model-info" style={{ padding: '12px' }}>
      <div className="skeleton-shimmer" style={{ height: '16px', width: '70%', borderRadius: '4px', marginBottom: '8px' }} />
      <div className="skeleton-shimmer" style={{ height: '12px', width: '50%', borderRadius: '4px' }} />
    </div>
  </div>
);

export const SkeletonGrid: React.FC<{ count?: number }> = ({ count = 8 }) => (
  <div className="model-grid">
    {Array.from({ length: count }, (_, i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
);

export const SkeletonLine: React.FC<{ width?: string; height?: string }> = ({
  width = '100%',
  height = '16px',
}) => (
  <div className="skeleton-shimmer" style={{ height, width, borderRadius: '4px' }} />
);
