import { useState } from 'react';

/**
 * Daily columns, one series. Chronological right-to-left to match the RTL page; ticks and the
 * hovered value use text tokens, the bars carry the colour. A table view is one click away.
 */
export function ColumnChart({
  data,
  format,
  color = 'var(--green-700)',
  height = 180,
}: {
  data: { key: string; label: string; value: number }[];
  format: (v: number) => string;
  color?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 720;
  const H = height;
  const pad = { top: 16, bottom: 24, right: 64 };
  const raw = Math.max(...data.map((d) => d.value), 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const max = Math.ceil((raw * 1.05) / pow) * pow;
  const plotW = W - pad.right - 4;
  const plotH = H - pad.top - pad.bottom;
  const slot = plotW / Math.max(data.length, 1);
  const barW = Math.min(24, slot * 0.6);
  const x = (i: number) => 4 + plotW - (i + 0.5) * slot;
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const labelEvery = Math.ceil(data.length / 10);

  return (
    <div className="chart">
      <div className="row-between" style={{ marginBottom: 4 }}>
        <span className="hint">
          {hover !== null ? `${data[hover]!.label}: ${format(data[hover]!.value)}` : ' '}
        </span>
        <button
          type="button"
          className="pc-btn pc-btn--ghost pc-btn--s"
          onClick={() => setTable((t) => !t)}
        >
          {table ? 'نمودار' : 'جدول'}
        </button>
      </div>
      {table ? (
        <table className="data">
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="n">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" onMouseLeave={() => setHover(null)}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={4} x2={4 + plotW} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" />
              <text x={W - 2} y={y(max * f) + 4} textAnchor="end">
                {format(max * f)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const h = Math.max(y(0) - y(d.value), d.value > 0 ? 2 : 0);
            const r = Math.min(4, h / 2, barW / 2);
            const left = x(i) - barW / 2;
            const top = y(0) - h;
            const path = h
              ? `M${left},${y(0)} V${top + r} Q${left},${top} ${left + r},${top} H${left + barW - r} Q${left + barW},${top} ${left + barW},${top + r} V${y(0)} Z`
              : '';
            return (
              <g key={d.key} onMouseEnter={() => setHover(i)}>
                <rect
                  x={x(i) - slot / 2}
                  y={pad.top}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                />
                {path && (
                  <path d={path} fill={color} opacity={hover === null || hover === i ? 1 : 0.5} />
                )}
                {i % labelEvery === 0 && (
                  <text x={x(i)} y={H - 6} textAnchor="middle">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={4} x2={4 + plotW} y1={y(0)} y2={y(0)} stroke="var(--line-2)" />
        </svg>
      )}
    </div>
  );
}
