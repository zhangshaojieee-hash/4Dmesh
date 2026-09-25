import React, { useMemo } from 'react';
import { parseMagProgram, strengthMeta, type MagProgram } from '../../utils/gcode/parseMagProgram';

interface Props {
  gcodeContent: string;
  /** Optional pre-parsed program to avoid double parsing. */
  program?: MagProgram;
}

const MAX_TIMELINE_SEGMENTS = 200;

const MagTimeline: React.FC<Props> = ({ gcodeContent, program }) => {
  const parsed = useMemo<MagProgram>(
    () => program ?? parseMagProgram(gcodeContent),
    [program, gcodeContent],
  );

  if (parsed.segments.length === 0) {
    return (
      <div style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        当前 G-code 未包含磁场指令（MAG_ON / MAG_OFF）。
      </div>
    );
  }

  const totalLayers = Math.max(parsed.layerCount, parsed.segments.reduce((m, s) => Math.max(m, s.endLayer + 1), 1));
  const visibleSegments = parsed.segments.slice(0, MAX_TIMELINE_SEGMENTS);
  const hiddenSegmentCount = parsed.segments.length - visibleSegments.length;

  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>磁场指令时间线</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {parsed.segments.length} 段 · {totalLayers} 层
        </span>
        <div style={{ display: 'flex', gap: '12px', marginLeft: 'auto', fontSize: '0.78rem' }}>
          {parsed.strengths.map((s) => {
            const meta = strengthMeta(s);
            return (
              <span key={s} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: meta.color, display: 'inline-block' }} />
                {meta.label} S={s}
              </span>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {visibleSegments.map((seg, i) => {
          const meta = strengthMeta(seg.strength);
          const spanLayers = Math.max(1, seg.endLayer - seg.startLayer + 1);
          const widthPct = totalLayers > 0 ? Math.max(4, (spanLayers / totalLayers) * 100) : 100;
          const offsetPct = totalLayers > 0 ? (seg.startLayer / totalLayers) * 100 : 0;
          const showLabel = widthPct >= 14;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '92px', flexShrink: 0, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                层 {seg.startLayer}–{seg.endLayer}
              </span>
              <div style={{ position: 'relative', flex: 1, height: '18px', background: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  title={`S=${seg.strength}${seg.direction ? ` DIR=${seg.direction}` : ''} · Z ${seg.startZ.toFixed(2)}–${seg.endZ.toFixed(2)} · 行 ${seg.line}`}
                  style={{
                    position: 'absolute',
                    left: `${offsetPct}%`,
                    width: `${widthPct}%`,
                    top: 0,
                    bottom: 0,
                    background: meta.color,
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                  }}
                >
                  {showLabel ? `S=${seg.strength}${seg.direction ? ` ${seg.direction}` : ''}` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {hiddenSegmentCount > 0 && (
        <div style={{ marginTop: '10px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          仅显示前 {visibleSegments.length} 段，已省略 {hiddenSegmentCount} 段；上方统计仍基于完整磁场程序。
        </div>
      )}

      {!parsed.balanced && (
        <div style={{ marginTop: '10px', fontSize: '0.78rem', color: '#F59E0B' }}>
          ⚠️ MAG_ON ({parsed.magOnCount}) 与 MAG_OFF ({parsed.magOffCount}) 数量不平衡，末段已按程序结束闭合。
        </div>
      )}
    </div>
  );
};

export default MagTimeline;
