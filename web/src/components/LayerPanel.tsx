import { useMemo, useState } from 'react'
import { BADGE_INFO, STAGES, THEMES, type Stage, type Theme } from '../../../shared/status.ts'
import type { Indexes } from '../lib'
import type { GeoData, Selection } from '../lib/types'
import { DIA_STOPS, ZONE_COLOURS, type LayerGroup, type PipeColourMode } from '../map/style'
import { useFieldProgress } from '../lib/progress'

export interface StretchFilter {
  stages: Stage[]
  issuesOnly: boolean
  notMotorableOnly: boolean
  proposedOnly: boolean
  zone: number | null
}
export const NO_FILTER: StretchFilter = { stages: [], issuesOnly: false, notMotorableOnly: false, proposedOnly: false, zone: null }

export interface SearchItem { key: string; text: string; kind: 'manhole' | 'ward' | 'pipe' | 'stretch' | 'issue'; id: string }

interface Props {
  data: GeoData
  idx: Indexes
  extraSearch: SearchItem[]
  visible: Record<LayerGroup, boolean>
  setVisible: (v: Record<LayerGroup, boolean>) => void
  colourMode: PipeColourMode
  setColourMode: (m: PipeColourMode) => void
  theme: Theme
  filter: StretchFilter
  setFilter: (f: StretchFilter) => void
  counts: { shown: number; total: number }
  onSelect: (s: Selection) => void
  onZone: (zone: number) => void
}

const LAYER_LABELS: [LayerGroup, string][] = [
  ['stretches', 'Road stretches (field status)'],
  ['issues', 'Issue pins'],
  ['proposals', 'Changes awaiting approval'],
  ['unrecorded', 'Not yet recorded (pipes with no road stretch)'],
  ['coverage', 'Wards shaded by share recorded'],
  ['pipes', 'Sewer pipes'],
  ['manholes', 'Manholes'],
  ['wards', 'Ward boundaries'],
  ['zones', 'Zone boundaries'],
  ['imagery', 'Google Earth imagery'],
  ['surroundings', 'Satellite outside frames'],
]

export default function LayerPanel(p: Props) {
  const progress = useFieldProgress()
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (s.length < 2) return []
    const digits = s.replace(/[^0-9/]/g, '')
    return [...p.extraSearch, ...p.idx.searchList]
      .filter((r) => {
        const t = r.text.toLowerCase()
        if (r.kind === 'manhole' && digits && /^(mh)?[-\s]?\d/.test(s)) return t.startsWith(`mh-${digits} `)
        if (r.kind === 'ward' && /^w(ard)?\s*\d+$/.test(s)) return t.startsWith(`ward ${digits} `)
        return t.includes(s)
      })
      .slice(0, 14)
  }, [q, p.idx, p.extraSearch])

  const theme = THEMES.find((t) => t.key === p.theme)!
  const f = p.filter
  const toggleStage = (k: Stage) => p.setFilter({ ...f, stages: f.stages.includes(k) ? f.stages.filter((x) => x !== k) : [...f.stages, k] })
  const filtered = f.stages.length || f.issuesOnly || f.notMotorableOnly || f.proposedOnly || f.zone

  return (
    <aside className="panel side">
      <div className="search">
        <input type="search" placeholder="Search W9-012, MH-245, Ward 9, road…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        {results.length > 0 && (
          <ul className="results">
            {results.map((r) => (
              <li key={r.key}>
                <button onClick={() => {
                  setQ('')
                  p.onSelect(r.kind === 'ward' ? { kind: 'ward', id: Number(r.id) } : { kind: r.kind, id: r.id } as Selection)
                }}>
                  <span className={`tag ${r.kind}`}>{r.kind === 'manhole' ? 'MH' : r.kind}</span> {r.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <section>
        <h4>{theme.label} · legend</h4>
        <ul className="legend">
          {theme.legend.map((l) => (
            <li key={l.label}><span className="line thick" style={{ background: l.colour }} />{l.label}</li>
          ))}
          <li><span className="line thick outline-red" />Open issue on the stretch</li>
          <li><span className="line thick dashed-dark" />Not motorable</li>
          <li><span className="line thick dashed-amber" />Proposed, awaiting approval</li>
        </ul>
        <div className="badge-key">
          {Object.entries(BADGE_INFO).map(([k, v]) => (
            <span key={k}><b style={{ background: v.colour }}>{k}</b>{v.label}</span>
          ))}
        </div>
      </section>

      <section>
        <h4>Filter stretches <span className="count">{p.counts.shown} of {p.counts.total}</span></h4>
        <div className="filter-stages">
          {STAGES.map((s) => (
            <button key={s.key} className={`fchip ${f.stages.includes(s.key) ? 'on' : ''}`} onClick={() => toggleStage(s.key)}>
              <span className="swatch" style={{ background: s.colour }} />{s.label}
            </button>
          ))}
        </div>
        <label className="check"><input type="checkbox" checked={f.issuesOnly} onChange={(e) => p.setFilter({ ...f, issuesOnly: e.target.checked })} />Only with open issues</label>
        <label className="check"><input type="checkbox" checked={f.notMotorableOnly} onChange={(e) => p.setFilter({ ...f, notMotorableOnly: e.target.checked })} />Only not motorable</label>
        <label className="check"><input type="checkbox" checked={f.proposedOnly} onChange={(e) => p.setFilter({ ...f, proposedOnly: e.target.checked })} />Only proposed (awaiting approval)</label>
        <select value={f.zone ?? ''} onChange={(e) => p.setFilter({ ...f, zone: e.target.value ? Number(e.target.value) : null })} aria-label="Zone filter">
          <option value="">All zones</option>
          {p.data.zones.features.map((z) => <option key={z.properties.zone} value={z.properties.zone}>{z.properties.name}</option>)}
        </select>
        {filtered ? <button className="btn link small" onClick={() => p.setFilter(NO_FILTER)}>Clear filters</button> : null}
      </section>

      <section>
        <h4>Zones</h4>
        <div className="zone-list">
          {p.data.zones.features.map((z) => {
            const row = progress.zones.find((x) => x.zone.zone === z.properties.zone)?.zone
            const pct = row && row.plan.pipe_m ? (row.plan.recorded_m / row.plan.pipe_m) * 100 : 0
            return (
              <button key={z.properties.zone} className="zone-chip" onClick={() => p.onZone(z.properties.zone)}>
                <span className="swatch" style={{ background: ZONE_COLOURS[z.properties.zone] }} />
                <span className="zname">{z.properties.name}</span>
                <span className="zpct" title="Share of the zone's plan network recorded by staff">{pct.toFixed(0)}%</span>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <h4>Layers</h4>
        {LAYER_LABELS.map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={p.visible[k]} onChange={(e) => p.setVisible({ ...p.visible, [k]: e.target.checked })} />
            {label}
          </label>
        ))}
      </section>

      <section>
        <h4>Colour pipes by</h4>
        <div className="seg">
          {(['diameter', 'zone'] as PipeColourMode[]).map((m) => (
            <button key={m} className={p.colourMode === m ? 'on' : ''} onClick={() => p.setColourMode(m)}>{m === 'diameter' ? 'Diameter' : 'Zone'}</button>
          ))}
        </div>
        <ul className="legend">
          {p.colourMode === 'diameter'
            ? DIA_STOPS.map(([d, c], i) => (
                <li key={d}><span className="line" style={{ background: c }} />{i === DIA_STOPS.length - 1 ? `${d} mm and above` : `${d}${DIA_STOPS[i + 1][0] - d > 50 ? `–${DIA_STOPS[i + 1][0] - 50}` : ''} mm`}</li>
              ))
            : p.data.zones.features.map((z) => (
                <li key={z.properties.zone}><span className="line" style={{ background: ZONE_COLOURS[z.properties.zone] }} />{z.properties.name}</li>
              ))}
        </ul>
      </section>
    </aside>
  )
}
