import { useState } from 'react';
import { formatNumber, tehranParts } from '@prochia/shared';

/** Single-letter Persian weekday names, indexed like Date.getDay() (0 = Sunday). */
const WEEKDAY_SHORT = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'] as const;

export interface DayValue {
  date: string;
  value: number;
}

const niceMax = (v: number) => {
  const pow = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  return Math.ceil(v / pow) * pow;
};

/**
 * Seven daily columns against a target line. Single series, so no legend: the title names it.
 * Oldest day on the right to follow the RTL reading direction. Values are also in a table view.
 */
export function DayBars({
  data,
  target,
  unit,
  color,
  title,
}: {
  data: DayValue[];
  target: number | null;
  unit: string;
  color: string;
  title: string;
}) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 150;
  const pad = { top: 14, bottom: 26, side: 34 };
  const max = niceMax(Math.max(target ?? 0, ...data.map((d) => d.value)) * 1.1);
  const plotW = W - pad.side - 6;
  const plotH = H - pad.top - pad.bottom;
  const slot = plotW / data.length;
  const barW = Math.min(22, slot * 0.55);
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  // Right-to-left: index 0 (oldest) sits at the right edge.
  const x = (i: number) => 6 + plotW - (i + 0.5) * slot;
  const label = (iso: string) =>
    WEEKDAY_SHORT[tehranParts(new Date(`${iso}T12:00:00+03:30`)).weekday]!;

  return (
    <figure className="chart" style={{ margin: 0 }}>
      <figcaption className="row-between">
        <b>{title}</b>
        <button
          type="button"
          className="pc-btn pc-btn--ghost pc-btn--s"
          onClick={() => setTable((t) => !t)}
        >
          {table ? 'نمودار' : 'جدول'}
        </button>
      </figcaption>
      {table ? (
        <table style={{ width: '100%', fontSize: 'var(--text-s)', borderCollapse: 'collapse' }}>
          <tbody>
            {data.map((d) => (
              <tr key={d.date} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: '6px 0' }}>
                  {new Date(`${d.date}T12:00:00+03:30`).toLocaleDateString('fa-IR', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </td>
                <td className="num" style={{ textAlign: 'left' }}>
                  {formatNumber(d.value)} {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        // Laid out in LTR coordinates (RTL would flip text-anchor); the day order itself runs right-to-left.
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ direction: 'ltr' }}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={6}
                x2={6 + plotW}
                y1={y(max * f)}
                y2={y(max * f)}
                stroke="var(--line)"
                strokeWidth={1}
              />
              <text x={W - 2} y={y(max * f) + 4} textAnchor="end" className="num">
                {formatNumber(Math.round(max * f))}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const h = Math.max(y(0) - y(d.value), d.value > 0 ? 2 : 0);
            const r = Math.min(4, h / 2, barW / 2);
            const left = x(i) - barW / 2;
            const top = y(0) - h;
            // Rounded data end, square at the baseline.
            const path = h
              ? `M${left},${y(0)} V${top + r} Q${left},${top} ${left + r},${top} H${left + barW - r} Q${left + barW},${top} ${left + barW},${top + r} V${y(0)} Z`
              : '';
            return (
              <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect
                  x={x(i) - slot / 2}
                  y={pad.top}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                />
                {path && (
                  <path d={path} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
                )}
                <text x={x(i)} y={H - 8} textAnchor="middle">
                  {label(d.date)}
                </text>
                {hover === i && (
                  <text
                    x={x(i)}
                    y={Math.max(top - 6, 10)}
                    textAnchor="middle"
                    className="num"
                    style={{ fill: 'var(--ink)', fontWeight: 700 }}
                  >
                    {formatNumber(d.value)}
                  </text>
                )}
                <title>{`${label(d.date)}: ${formatNumber(d.value)} ${unit}`}</title>
              </g>
            );
          })}
          {target !== null && target > 0 && (
            <g>
              <line
                x1={6}
                x2={6 + plotW}
                y1={y(target)}
                y2={y(target)}
                stroke="var(--ink)"
                strokeWidth={1.5}
              />
              <text
                x={8}
                y={y(target) - 5}
                textAnchor="start"
                style={{ fill: 'var(--ink)', fontWeight: 700 }}
              >
                هدف {formatNumber(target)}
              </text>
            </g>
          )}
          <line x1={6} x2={6 + plotW} y1={y(0)} y2={y(0)} stroke="var(--line-2)" strokeWidth={1} />
        </svg>
      )}
    </figure>
  );
}
