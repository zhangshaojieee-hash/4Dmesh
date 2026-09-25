import React, { useMemo } from 'react';
import { parseGcodeToolpath } from '../../utils/gcode/parseGcodeToolpath';
import GcodePreviewCanvas, { type GcodeViewPreset } from './GcodePreviewCanvas';

interface Props {
  gcodeContent: string;
  showTravel?: boolean;
  currentLayer?: number | null;
  showGrid?: boolean;
  showAxes?: boolean;
  viewPreset?: GcodeViewPreset;
  viewResetSignal?: number;
}

const GcodePreviewPanel: React.FC<Props> = ({
  gcodeContent,
  showTravel = false,
  currentLayer = null,
  showGrid = true,
  showAxes = true,
  viewPreset = 'perspective',
  viewResetSignal = 0,
}) => {
  const preview = useMemo(() => {
    if (!gcodeContent.trim()) return null;
    return parseGcodeToolpath(gcodeContent);
  }, [gcodeContent]);

  if (!preview) {
    return (
      <div className="empty-state" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>暂无可预览的 G-code 内容</p>
      </div>
    );
  }

  const selectedLayerPosition = currentLayer === null
    ? null
    : Math.min(Math.max(currentLayer, 0), preview.layers.length - 1);
  const layerForPreview = preview.layers.length > 0 && selectedLayerPosition !== null
    ? preview.layers[selectedLayerPosition].index
    : null;
  const activeLayerHasNoExtrusion = layerForPreview !== null
    && preview.stats.segmentCount > 0
    && !preview.extrusionSegments.some((segment) => segment.layerIndex === layerForPreview);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: '16px', alignItems: 'center', background: 'var(--bg-card)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>3D 打印结果预览</span>
        {preview.magneticRegions.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.75rem' }} aria-label="充磁区域图例">
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>充磁区域：</span>
            {Array.from(new Map(preview.magneticRegions.map((region) => [`${region.direction ?? '未指定'}|${region.strength}`, region])).values()).map((region) => (
              <span key={`${region.direction}-${region.strength}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
                <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: region.direction === 'Z+' ? '#A855F7' : region.direction === 'Z-' ? '#06B6D4' : region.direction?.startsWith('X') ? '#F97316' : '#22C55E', display: 'inline-block' }} />
                {region.direction ?? '未指定'} / S={region.strength}
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>路径: {showTravel ? '挤出+空走' : '仅挤出'}</span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>层: {layerForPreview === null ? '全部' : layerForPreview}</span>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative' }}>
        {activeLayerHasNoExtrusion && (
          <div role="status" style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, maxWidth: 300, padding: '8px 10px', borderRadius: '6px', background: 'var(--bg-card)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-sm)', color: 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: 1.4 }}>
            当前层没有挤出路径，可切换到全部层查看完整打印路径。
          </div>
        )}
        <GcodePreviewCanvas
          preview={preview}
          showTravel={showTravel}
          currentLayer={layerForPreview}
          showGrid={showGrid}
          showAxes={showAxes}
          viewPreset={viewPreset}
          viewResetSignal={viewResetSignal}
        />
      </div>

      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: '20px', fontSize: '0.82rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>
        <span>挤出段: {preview.stats.segmentCount}</span>
        <span>空走段: {preview.stats.travelSegmentCount}</span>
        <span>层数: {preview.stats.layerCount}</span>
        <span>范围: X {preview.bounds.min[0].toFixed(1)} ~ {preview.bounds.max[0].toFixed(1)} / Y {preview.bounds.min[1].toFixed(1)} ~ {preview.bounds.max[1].toFixed(1)} / Z {preview.bounds.min[2].toFixed(1)} ~ {preview.bounds.max[2].toFixed(1)}</span>
      </div>
    </div>
  );
};

export default GcodePreviewPanel;
