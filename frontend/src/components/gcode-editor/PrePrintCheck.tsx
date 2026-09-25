import React, { useMemo } from 'react';
import { parseMagProgram, formatDuration, type MagProgram } from '../../utils/gcode/parseMagProgram';

interface Props {
  gcodeContent: string;
  /** Optional pre-parsed program to avoid double parsing. */
  program?: MagProgram;
  /** Whether the project carries magnetic annotations (ai_project). */
  expectsMagnetic?: boolean;
  printerProfile?: string;
}

type CheckLevel = 'pass' | 'warn' | 'info';

interface CheckItem {
  label: string;
  detail: string;
  level: CheckLevel;
}

const LEVEL_META: Record<CheckLevel, { icon: string; color: string }> = {
  pass: { icon: '✓', color: '#22C55E' },
  warn: { icon: '!', color: '#F59E0B' },
  info: { icon: 'i', color: '#3B82F6' },
};

// Conservative nozzle/bed ranges shared by the supported FDM profiles.
const NOZZLE_RANGE: [number, number] = [170, 300];
const BED_RANGE: [number, number] = [0, 120];

const PrePrintCheck: React.FC<Props> = ({ gcodeContent, program, expectsMagnetic, printerProfile }) => {
  const parsed = useMemo<MagProgram>(
    () => program ?? parseMagProgram(gcodeContent),
    [program, gcodeContent],
  );

  const checks = useMemo<CheckItem[]>(() => {
    const items: CheckItem[] = [];

    // 1. Magnetic command presence
    if (expectsMagnetic) {
      if (parsed.magOnCount > 0) {
        items.push({
          label: '磁场指令',
          detail: `MAG_ON ×${parsed.magOnCount} · MAG_OFF ×${parsed.magOffCount}`,
          level: 'pass',
        });
      } else {
        items.push({
          label: '磁场指令',
          detail: '项目包含磁性标注，但 G-code 中未检测到 MAG_ON，请重新生成',
          level: 'warn',
        });
      }
    } else {
      items.push({
        label: '磁场指令',
        detail: parsed.magOnCount > 0 ? `MAG_ON ×${parsed.magOnCount}` : '无磁场指令（普通打印）',
        level: 'info',
      });
    }

    // 2. MAG_ON / MAG_OFF balance
    if (parsed.magOnCount > 0) {
      items.push({
        label: '指令配对',
        detail: parsed.balanced
          ? '所有 MAG_ON 均已正确闭合'
          : `MAG_ON (${parsed.magOnCount}) 与 MAG_OFF (${parsed.magOffCount}) 不平衡`,
        level: parsed.balanced ? 'pass' : 'warn',
      });
    }

    // 3. Layers
    items.push({
      label: '层数',
      detail: parsed.layerCount > 0 ? `${parsed.layerCount} 层` : '未能解析层数',
      level: parsed.layerCount > 0 ? 'pass' : 'warn',
    });

    // 4. Estimated print time
    items.push({
      label: '预计时间',
      detail: parsed.estimatedSeconds !== null ? formatDuration(parsed.estimatedSeconds) : '切片器未提供预计时间',
      level: parsed.estimatedSeconds !== null ? 'pass' : 'info',
    });

    // 5. Nozzle temperature
    if (parsed.nozzleTemp !== null) {
      const ok = parsed.nozzleTemp >= NOZZLE_RANGE[0] && parsed.nozzleTemp <= NOZZLE_RANGE[1];
      items.push({
        label: '喷嘴温度',
        detail: `${parsed.nozzleTemp}°C${ok ? '' : '（超出常规范围）'}`,
        level: ok ? 'pass' : 'warn',
      });
    } else {
      items.push({ label: '喷嘴温度', detail: 'G-code 中未设置喷嘴温度', level: 'warn' });
    }

    // 6. Bed temperature
    if (parsed.bedTemp !== null) {
      const ok = parsed.bedTemp >= BED_RANGE[0] && parsed.bedTemp <= BED_RANGE[1];
      items.push({
        label: '热床温度',
        detail: `${parsed.bedTemp}°C${ok ? '' : '（超出常规范围）'}`,
        level: ok ? 'pass' : 'warn',
      });
    } else {
      items.push({ label: '热床温度', detail: 'G-code 中未设置热床温度', level: 'info' });
    }

    // 7. Target printer
    items.push({
      label: '目标设备',
      detail: printerProfile ? `切片配置：${printerProfile}` : '未指定打印机配置',
      level: printerProfile ? 'info' : 'warn',
    });

    return items;
  }, [parsed, expectsMagnetic, printerProfile]);

  const warnCount = checks.filter((c) => c.level === 'warn').length;

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>打印前校验</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: warnCount > 0 ? '#F59E0B' : '#22C55E' }}>
          {warnCount > 0 ? `${warnCount} 项需注意` : '全部通过'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {checks.map((c, i) => {
          const meta = LEVEL_META[c.level];
          return (
            <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <span
                style={{
                  flexShrink: 0,
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: meta.color,
                  color: 'white',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: '1px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
              >
                {meta.icon}
              </span>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{c.label}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{c.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PrePrintCheck;
