import React, { useState } from 'react';
import type { VolumeRegion } from '../lib/editor-types';

interface FormatDownloadMenuProps {
  modelUrl: string;
  originalFormat?: string;
  regions?: Array<{ id: string; name: string; meshName: string; color: string; strength?: number; direction?: string }>;
  paintData?: Record<string, Record<string, number[]>>;
  volumeRegions?: VolumeRegion[];
  getSurfacePaintGrid?: () => unknown | null;
}

export const FormatDownloadMenu: React.FC<FormatDownloadMenuProps> = ({ modelUrl, originalFormat, regions, paintData, volumeRegions, getSurfacePaintGrid }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [splitLoading, setSplitLoading] = useState(false);

  const handleDownload = async (format: string) => {
    setLoading(true);
    try {
      const url = `/api/models/download-as?model_url=${encodeURIComponent(modelUrl)}&format=${format}`;
      window.open(url, '_blank');
    } catch {
      // Opening a generated download URL should not block the menu if the browser rejects it.
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  const handleSplitDownload = async () => {
    const hasRegions = regions && regions.length > 0;
    const hasPaint = paintData && Object.keys(paintData).length > 0;
    const hasVolume = volumeRegions && volumeRegions.length > 0;
    const surfaceGrid = getSurfacePaintGrid?.() ?? null;
    const hasSurfaceGrid = surfaceGrid !== null;
    if (!hasRegions && !hasPaint && !hasVolume && !hasSurfaceGrid) {
      alert('请先选择加磁区域');
      return;
    }
    if (splitLoading) return;
    setSplitLoading(true);
    try {
      const res = await fetch('/api/models/download-split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_url: modelUrl, regions: regions || [], paint_data: paintData || {}, volume_regions: volumeRegions, surface_paint_grid: surfaceGrid }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: '下载失败' }));
        throw new Error(err.detail || '下载失败');
      }
      const data = await res.json();
      if (data.download_url) {
        const a = document.createElement('a');
        a.href = data.download_url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        throw new Error('未获取到下载链接');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '下载失败，请重试');
    } finally {
      setSplitLoading(false);
      setOpen(false);
    }
  };

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        style={{
          width: '100%', padding: '9px', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontWeight: 600,
          background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
          border: '1px solid var(--border-light)', cursor: 'pointer', transition: 'all 0.2s',
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? '下载中...' : '下载模型'}
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 10,
            }}
          />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20,
            background: 'var(--bg-card)', border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-sm)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            overflow: 'hidden',
          }}>
            <button
              onClick={() => handleDownload('glb')}
              style={{
                width: '100%', padding: '10px 12px', background: 'transparent',
                border: 'none', textAlign: 'left', cursor: 'pointer',
                fontSize: '0.82rem', color: 'var(--text-primary)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              GLB (Web Preview)
            </button>
            <button
              onClick={() => handleDownload('3mf')}
              style={{
                width: '100%', padding: '10px 12px', background: 'transparent',
                border: 'none', textAlign: 'left', cursor: 'pointer',
                fontSize: '0.82rem', color: 'var(--text-primary)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              3MF (3D Printing)
            </button>
            {originalFormat && (
              <button
                onClick={() => handleDownload(originalFormat)}
                style={{
                  width: '100%', padding: '10px 12px', background: 'transparent',
                  border: 'none', textAlign: 'left', cursor: 'pointer',
                  fontSize: '0.82rem', color: 'var(--text-primary)',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Original Format ({originalFormat.toUpperCase()})
              </button>
            )}
            <div style={{ height: '1px', background: 'var(--border-light)', margin: '2px 0' }} />
            <button
              onClick={handleSplitDownload}
              disabled={splitLoading}
              style={{
                width: '100%', padding: '10px 12px', background: splitLoading ? 'var(--bg-secondary)' : 'transparent',
                border: 'none', textAlign: 'left', cursor: splitLoading ? 'not-allowed' : 'pointer',
                fontSize: '0.82rem', color: splitLoading ? 'var(--text-tertiary)' : (regions?.length || volumeRegions?.length || getSurfacePaintGrid ? 'var(--primary)' : 'var(--text-tertiary)'),
                transition: 'background 0.15s', fontWeight: 600,
                opacity: splitLoading ? 0.7 : 1,
              }}
              onMouseEnter={(e) => { if (!splitLoading) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
              onMouseLeave={(e) => { if (!splitLoading) e.currentTarget.style.background = 'transparent'; }}
            >
              {splitLoading ? '切分处理中，请稍候...' : '分磁切分下载 (ZIP)'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
