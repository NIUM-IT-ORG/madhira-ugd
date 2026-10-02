import { useRef, useState, type ReactNode } from 'react'

/*
 * Small hand-built SVG charts for the dashboard. Rules (dataviz method): one hue for magnitude, thin
 * marks with 4px rounded data-ends, hairline grids, values in text ink (never the series colour),
 * hover tooltips that only repeat what the table also shows.
 */

export const VIZ = {
  blue: ['#cde2fb', '#9ec5f4', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
  series: ['#2a78d6', '#eb6834'],
  track: '#e6effa',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
}

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 1 })
export const km = (m: number) => `${(m / 1000).toLocaleString('en-IN', { maximumFractionDigits: m < 10000 ? 2 : 1 })} km`

function useTip() {
  const box = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null)
  const show = (e: React.PointerEvent | React.FocusEvent, body: ReactNode) => {
    const r = box.current!.getBoundingClientRect()
    const p = 'clientX' in e ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: r.width / 2, y: 20 }
    setTip({ ...p, body })
  }
  const node = tip ? <div className="viz-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.body}</div> : null
  return { box, show, hide: () => setTip(null), node }
}

/** A ratio against its total: fill on a lighter track of the same hue. */
export function Meter({ value, total, label, sub }: { value: number; total: number; label: string; sub?: string }) {
  const p = total > 0 ? Math.min(1, value / total) : 0
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <b>{(p * 100).toFixed(p < 0.1 ? 1 : 0)}%</b>
      </div>
      <div className="meter-track" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value} aria-label={label}>
        <div style={{ width: `${p * 100}%` }} />
      </div>
      {sub && <div className="meter-sub">{sub}</div>}
    </div>
  )
}

export interface BarRow { key: string; label: string; value: number; display: string; colour?: string; note?: string }

/** Horizontal bars, one hue (or an ordinal ramp passed per row), value at the tip, tooltip per bar. */
export function HBars({ rows, height = 22, labelWidth = 150, empty }: { rows: BarRow[]; height?: number; labelWidth?: number; empty?: string }) {
  const t = useTip()
  const W = 560
  const max = Math.max(1, ...rows.map((r) => r.value))
  const gap = 10
  const H = rows.length * (height + gap)
  const plot = W - labelWidth - 70
  if (!rows.length) return <div className="muted small">{empty ?? 'No data yet.'}</div>
  return (
    <div className="viz" ref={t.box}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rows.map((r) => `${r.label} ${r.display}`).join(', ')}>
        <line x1={labelWidth} x2={labelWidth} y1={0} y2={H - gap} stroke={VIZ.axis} strokeWidth={1} />
        {rows.map((r, i) => {
          const y = i * (height + gap)
          const w = (r.value / max) * plot
          const bh = Math.min(height, 22)
          return (
            <g key={r.key} tabIndex={0} onPointerMove={(e) => t.show(e, <><b>{r.display}</b><span>{r.label}{r.note ? ` · ${r.note}` : ''}</span></>)}
              onPointerLeave={t.hide} onFocus={(e) => t.show(e, <><b>{r.display}</b><span>{r.label}</span></>)} onBlur={t.hide}>
              <rect x={0} y={y - 2} width={W} height={height + 4} fill="transparent" />
              <text x={labelWidth - 8} y={y + height / 2 + 4} textAnchor="end" fontSize={12.5} fill={VIZ.ink2}>{r.label}</text>
              {w > 0 && (
                <path
                  d={`M${labelWidth},${y + (height - bh) / 2} h${Math.max(0, w - 4)} a4,4 0 0 1 4,4 v${bh - 8} a4,4 0 0 1 -4,4 h${-Math.max(0, w - 4)} z`}
                  fill={r.colour ?? VIZ.blue[4]}
                />
              )}
              <text x={labelWidth + w + 6} y={y + height / 2 + 4} fontSize={12.5} fill={VIZ.ink} fontWeight={600}>{r.display}</text>
            </g>
          )
        })}
      </svg>
      {t.node}
    </div>
  )
}

export interface Series { key: string; label: string; colour: string; values: number[] }

/** Lines over weeks: 2px strokes, end-dots with surface ring, crosshair + one tooltip for all series. */
export function LineChart({ x, series, format, empty }: { x: string[]; series: Series[]; format: (n: number) => string; empty?: string }) {
  const t = useTip()
  const [hover, setHover] = useState<number | null>(null)
  if (!x.length) return <div className="muted small">{empty ?? 'No data yet.'}</div>
  const W = 640, H = 220, L = 52, R = 110, T = 12, B = 28
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const step = niceStep(max / 4)
  const top = Math.ceil(max / step) * step
  const px = (i: number) => (x.length === 1 ? L + (W - L - R) / 2 : L + (i / (x.length - 1)) * (W - L - R))
  const py = (v: number) => T + (1 - v / top) * (H - T - B)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const labelEvery = Math.ceil(x.length / 6)
  return (
    <div className="viz line" ref={t.box}>
      {x.length === 1 && <div className="muted small">First week of field records; a line appears as weeks accumulate.</div>}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={series.map((s) => `${s.label}: ${format(s.values.at(-1) ?? 0)} latest`).join('; ')}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const sx = ((e.clientX - r.left) / r.width) * W
          const i = x.length === 1 ? 0 : Math.max(0, Math.min(x.length - 1, Math.round(((sx - L) / (W - L - R)) * (x.length - 1))))
          setHover(i)
          t.show(e, <>{series.map((s) => <span key={s.key} className="tip-row"><i style={{ background: s.colour }} /><b>{format(s.values[i])}</b> {s.label}</span>)}<span className="muted">Week of {x[i]}</span></>)
        }}
        onPointerLeave={() => { setHover(null); t.hide() }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={py(v)} y2={py(v)} stroke={VIZ.grid} strokeWidth={1} />
            <text x={L - 8} y={py(v) + 4} textAnchor="end" fontSize={11} fill={VIZ.muted} className="tnum">{format(v)}</text>
          </g>
        ))}
        {x.map((d, i) => (i % labelEvery === 0 || i === x.length - 1 ? (
          <text key={d} x={px(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={VIZ.muted}>{d.slice(5)}</text>
        ) : null))}
        {hover != null && <line x1={px(hover)} x2={px(hover)} y1={T} y2={H - B} stroke={VIZ.axis} strokeWidth={1} />}
        {series.map((s) => (
          <g key={s.key}>
            {s.values.length > 1 && (
              <polyline points={s.values.map((v, i) => `${px(i)},${py(v)}`).join(' ')} fill="none" stroke={s.colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )}
            <circle cx={px(s.values.length - 1)} cy={py(s.values.at(-1) ?? 0)} r={4.5} fill={s.colour} stroke="#fcfcfb" strokeWidth={2} />
            <text x={px(s.values.length - 1) + 9} y={py(s.values.at(-1) ?? 0) + 4} fontSize={12} fill={VIZ.ink}>
              <tspan fontWeight={700}>{format(s.values.at(-1) ?? 0)}</tspan>
              <tspan fill={VIZ.ink2}> {s.label}</tspan>
            </text>
          </g>
        ))}
      </svg>
      {t.node}
    </div>
  )
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)))
  const n = raw / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}

export function Legend({ items }: { items: { label: string; colour: string; line?: boolean }[] }) {
  return (
    <div className="viz-legend">
      {items.map((i) => <span key={i.label}><i className={i.line ? 'line' : ''} style={{ background: i.colour }} />{i.label}</span>)}
    </div>
  )
}

export { fmt }
