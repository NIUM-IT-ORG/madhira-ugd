import { Fragment, useEffect, useMemo, useState } from 'react'
import { ISSUE_KINDS, STAGES, deriveTags, label, sewerCombo } from '../../../shared/status.ts'
import { pct, progressTable, type AreaRow, type FieldFigures, type LabourLike } from '../../../shared/stats.ts'
import { HBars, Legend, LineChart, Meter, VIZ, km } from '../components/charts'
import { Sheet, StageDot, Tags, fmtDateTime } from '../components/ui'
import { get } from '../lib/api'
import { useData } from '../lib/store'
import type { Selection } from '../lib/types'

type Week = FieldFigures & { week: string; open_issues: number }

const n = (v: number) => v.toLocaleString('en-IN')

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function WardReport({ row, onClose }: { row: AreaRow; onClose: () => void }) {
  const { stretches, issues } = useData()
  const list = stretches.features.filter((f) => row.wards.includes(f.properties.ward))
  const open = issues.filter((i) => i.ward != null && row.wards.includes(i.ward) && i.status !== 'resolved')
  const f = row.field
  return (
    <Sheet title={`${row.label} report`} onClose={onClose} wide footer={
      <>
        <span className="muted small">Generated {fmtDateTime(new Date().toISOString())}</span>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn primary" onClick={() => window.print()}>Print / save as PDF</button>
      </>
    }>
      <div className="print-area">
        <h2 className="print-only">Madhira UGD · {row.label}</h2>
        <p className="muted">{row.locality} · Zone {row.zone}</p>
        <table className="data compact">
          <thead><tr><th></th><th>Pipeline</th><th>Manholes</th><th>ICs</th></tr></thead>
          <tbody>
            <tr><td>Sanctioned</td><td>{n(row.sanctioned.pipe_m)} m</td><td>{n(row.sanctioned.manholes)}</td><td>{n(row.sanctioned.ics)}</td></tr>
            <tr><td>Executed (reported, 30 Sep)</td><td>{n(row.reported.pipe_m)} m ({pct(row.reported.pipe_m, row.sanctioned.pipe_m)}%)</td><td>{n(row.reported.manholes)}</td><td>{n(row.reported.ics)}</td></tr>
            <tr><td>Field-verified on map</td><td>{n(Math.round(f.pipe_laid_m))} m</td><td>{n(f.manholes_built)}</td><td>{n(f.ics_built)}</td></tr>
          </tbody>
        </table>
        <div className="report-grid">
          <div><span className="muted">Road cut</span><b>{km(f.road_cut_m)}</b></div>
          <div><span className="muted">Restoration pending</span><b>{km(f.restoration_pending_m)}</b></div>
          <div><span className="muted">CC restored</span><b>{km(f.restored_m)}</b></div>
          <div><span className="muted">Approved</span><b>{km(f.approved_m)}</b></div>
          <div><span className="muted">Not motorable</span><b>{km(f.not_motorable_m)}</b></div>
          <div><span className="muted">Open issues</span><b>{row.issues_open}</b></div>
          <div><span className="muted">Taps pending</span><b>{f.taps_pending}</b></div>
          <div><span className="muted">Avg labour / day (7 d)</span><b>{row.labour_avg_7d ?? '—'}</b></div>
        </div>
        <h4>Road stretches ({list.length})</h4>
        <table className="data compact">
          <thead><tr><th>Code</th><th>Road</th><th>Length</th><th>Stage</th><th>Sewer</th><th>Restoration</th><th>Tags</th></tr></thead>
          <tbody>
            {list.map((s) => {
              const p = s.properties
              const st = STAGES.find((x) => x.key === p.stage)!
              return (
                <tr key={s.id}>
                  <td>{p.code}</td><td>{p.name ?? '—'}</td><td className="num">{Math.round(p.length_m)} m</td>
                  <td><StageDot colour={st.colour} /> {st.label}</td><td>{sewerCombo(p.status, p.planned_mh)}</td>
                  <td>{label('restoration', p.status.restoration.stage)}</td>
                  <td><Tags tags={deriveTags(p.status, p.approval, p.planned_mh).filter((t) => t.tone === 'bad' || t.tone === 'warn')} max={3} /></td>
                </tr>
              )
            })}
            {!list.length && <tr><td colSpan={7} className="muted">No stretches recorded yet.</td></tr>}
          </tbody>
        </table>
        <h4>Open issues ({open.length})</h4>
        <ul className="plain">
          {open.map((i) => <li key={i.id}>{i.code} · {ISSUE_KINDS.find((k) => k.key === i.kind)?.label}{i.count > 1 ? ` × ${i.count}` : ''} · {i.severity} · {i.status}{i.assigned_to ? ` · ${i.assigned_to}` : ''}</li>)}
          {!open.length && <li className="muted">None.</li>}
        </ul>
      </div>
    </Sheet>
  )
}

export default function DashboardPage({ onShow }: { onShow: (s: Selection) => void }) {
  const { geo, stretches, issues, requests, lastEvent } = useData()
  const [labour, setLabour] = useState<LabourLike[]>([])
  const [weeks, setWeeks] = useState<Week[]>([])
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [report, setReport] = useState<AreaRow | null>(null)

  useEffect(() => {
    get<{ labour: LabourLike[] }>('/api/labour').then((r) => setLabour(r.labour)).catch(() => undefined)
    get<{ weeks: Week[] }>('/api/stats/timeline').then((r) => setWeeks(r.weeks)).catch(() => undefined)
  }, [lastEvent?.at])

  const table = useMemo(() => progressTable(
    geo.baseline.groups,
    stretches.features.map((f) => f.properties),
    issues.map((i) => ({ ...i })),
    labour,
  ), [geo.baseline, stretches, issues, labour])
  const T = table.total
  const F = T.field
  const waiting = requests.filter((r) => r.status === 'pending').length
    + stretches.features.filter((f) => f.properties.stage === 'awaiting_approval' && f.properties.approval === 'pending').length
  const openIssues = issues.filter((i) => i.status !== 'resolved')
  const flagged = stretches.features.filter((f) => f.properties.flagged_far).length

  const issueRows = ISSUE_KINDS.map((k) => {
    const v = openIssues.filter((i) => i.kind === k.key).reduce((a, i) => a + i.count, 0)
    return { key: k.key, label: k.label, value: v, display: n(v) }
  }).filter((r) => r.value > 0).sort((a, b) => b.value - a.value)

  const restoration = [
    { key: 'cut', label: 'Road cut', value: F.road_cut_m, display: km(F.road_cut_m), colour: VIZ.blue[2] },
    { key: 'bf', label: 'Back-filled', value: F.backfilled_m + F.restored_m, display: km(F.backfilled_m + F.restored_m), colour: VIZ.blue[3], note: 'includes stretches restored since' },
    { key: 'rs', label: 'CC restored', value: F.restored_m, display: km(F.restored_m), colour: VIZ.blue[4] },
    { key: 'ap', label: 'Approved (green)', value: F.approved_m, display: km(F.approved_m), colour: VIZ.blue[5] },
  ]

  return (
    <div className="page dashboard">
      <div className="page-head">
        <h2>Dashboard</h2>
        <div className="export-row">
          <a className="btn small" href="/api/export/progress.xlsx">Download Excel</a>
          <a className="btn small" href="/api/export/stretches.kml">Open in Google Earth (KML)</a>
          <a className="btn small" href="/api/export/stretches.geojson">GeoJSON</a>
        </div>
        <p className="muted">
          Sanctioned and "reported" figures are from the progress sheet of {new Date(geo.baseline.as_of).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.
          "Field" figures are what AEEs have recorded on the map, and update live.
        </p>
      </div>

      <section className="hero-row">
        <div className="hero">
          <div className="stat-label">Pipeline executed (reported)</div>
          <div className="hero-value">{pct(T.reported.pipe_m, T.sanctioned.pipe_m)}%</div>
          <div className="stat-sub">{km(T.reported.pipe_m)} of {km(T.sanctioned.pipe_m)} sanctioned</div>
          <Meter value={T.reported.pipe_m} total={T.sanctioned.pipe_m} label="Pipeline" />
        </div>
        <div className="stats">
          <StatTile label="Manholes (reported)" value={`${pct(T.reported.manholes, T.sanctioned.manholes)}%`} sub={`${n(T.reported.manholes)} of ${n(T.sanctioned.manholes)}`} />
          <StatTile label="Inspection chambers (reported)" value={`${pct(T.reported.ics, T.sanctioned.ics)}%`} sub={`${n(T.reported.ics)} of ${n(T.sanctioned.ics)}`} />
          <StatTile label="Pipe laid (field-verified)" value={km(F.pipe_laid_m)} sub={`${F.stretches} stretches · ${km(F.surveyed_m)} surveyed`} />
          <StatTile label="CC restored and approved" value={km(F.approved_m)} sub={`${km(F.restored_m)} restored in total`} />
          <StatTile label="Open issues" value={n(openIssues.length)} sub={`${openIssues.filter((i) => i.severity === 'high').length} high severity · ${T.issues_overdue} overdue`} tone={openIssues.length ? 'bad' : undefined} />
          <StatTile label="Waiting for your approval" value={n(waiting)} sub={flagged ? `${flagged} stretch updates made away from site` : 'restorations and change requests'} tone={waiting ? 'warn' : undefined} />
        </div>
      </section>

      <section className="grid2">
        <div className="card-box">
          <h3>Progress by zone</h3>
          <p className="muted small">Reported execution against sanctioned quantities.</p>
          <div className="zone-meters">
            {table.zones.map(({ zone: z }) => (
              <div key={z.key} className="zone-meter">
                <div className="zone-meter-title">{geo.zones.features.find((f) => f.properties.zone === z.zone)?.properties.name}</div>
                <Meter label="Pipeline" value={z.reported.pipe_m} total={z.sanctioned.pipe_m} sub={`${km(z.reported.pipe_m)} of ${km(z.sanctioned.pipe_m)} · field ${km(z.field.pipe_laid_m)}`} />
                <Meter label="Manholes" value={z.reported.manholes} total={z.sanctioned.manholes} sub={`${n(z.reported.manholes)} of ${n(z.sanctioned.manholes)} · field ${n(z.field.manholes_built)}`} />
                <Meter label="Inspection chambers" value={z.reported.ics} total={z.sanctioned.ics} sub={`${n(z.reported.ics)} of ${n(z.sanctioned.ics)} · field ${n(z.field.ics_built)}`} />
              </div>
            ))}
          </div>
        </div>
        <div className="col">
          <div className="card-box">
            <h3>Road restoration (field)</h3>
            <p className="muted small">How far the cut roads have moved towards a restored, approved CC road.</p>
            <HBars rows={restoration} labelWidth={130} />
            {F.not_motorable_m > 0 && <p className="small"><b>{km(F.not_motorable_m)}</b> <span className="muted">of road is not motorable; {km(F.difficult_m)} motorable with difficulty.</span></p>}
          </div>
          <div className="card-box">
            <h3>Open issues by kind</h3>
            <HBars rows={issueRows} labelWidth={170} empty="No open issues." />
          </div>
        </div>
      </section>

      <section className="card-box">
        <h3>Field progress over time</h3>
        <Legend items={[{ label: 'Pipe laid', colour: VIZ.series[0], line: true }, { label: 'CC restored', colour: VIZ.series[1], line: true }]} />
        <LineChart
          x={weeks.map((w) => w.week)}
          series={[
            { key: 'pipe', label: 'pipe laid', colour: VIZ.series[0], values: weeks.map((w) => w.pipe_laid_m / 1000) },
            { key: 'cc', label: 'CC restored', colour: VIZ.series[1], values: weeks.map((w) => w.restored_m / 1000) },
          ]}
          format={(v) => `${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })} km`}
          empty="The chart fills in as field updates are recorded, one point per week."
        />
      </section>

      <section className="card-box">
        <h3>Zones and wards</h3>
        <p className="muted small">Click a zone to see its wards. Zone 2's wards 5, 6 and 7 share one row on the progress sheet.</p>
        <div className="table-wrap">
          <table className="data tree">
            <thead>
              <tr>
                <th>Area</th><th>Sanctioned pipe</th><th>Reported</th><th>Field pipe laid</th><th>MH (rep. / field)</th><th>IC (rep. / field)</th>
                <th>Road cut</th><th>CC restored</th><th>Approved</th><th>Open issues</th><th>Labour / day</th><th></th>
              </tr>
            </thead>
            <tbody>
              {table.zones.map(({ zone: z, rows }) => (
                <Fragment key={z.key}>
                  <tr className="zone-row clickable" onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(z.zone)) x.delete(z.zone); else x.add(z.zone); return x })}>
                    <td><b>{open.has(z.zone) ? '▾' : '▸'} {geo.zones.features.find((f) => f.properties.zone === z.zone)?.properties.name}</b></td>
                    <AreaCells r={z} />
                    <td />
                  </tr>
                  {open.has(z.zone) && rows.map((r) => (
                    <tr key={r.key} className="ward-row">
                      <td>
                        <button className="link" onClick={() => onShow({ kind: 'ward', id: r.wards[0] })}>{r.label}</button>
                        <div className="muted small">{r.locality}</div>
                      </td>
                      <AreaCells r={r} />
                      <td><button className="btn small" onClick={() => setReport(r)}>Report</button></td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="total-row"><td><b>All zones</b></td><AreaCells r={T} /><td /></tr>
            </tbody>
          </table>
        </div>
      </section>
      {report && <WardReport row={report} onClose={() => setReport(null)} />}
    </div>
  )
}

function AreaCells({ r }: { r: AreaRow }) {
  const f = r.field
  return (
    <>
      <td className="num">{km(r.sanctioned.pipe_m)}</td>
      <td className="num">{km(r.reported.pipe_m)} <span className="muted">({pct(r.reported.pipe_m, r.sanctioned.pipe_m)}%)</span></td>
      <td className="num">{km(f.pipe_laid_m)}</td>
      <td className="num">{n(r.reported.manholes)} / {n(f.manholes_built)}</td>
      <td className="num">{n(r.reported.ics)} / {n(f.ics_built)}</td>
      <td className="num">{km(f.road_cut_m)}</td>
      <td className="num">{km(f.restored_m)}</td>
      <td className="num">{km(f.approved_m)}</td>
      <td className="num">{r.issues_open ? <b className="bad">{r.issues_open}</b> : 0}</td>
      <td className="num">{r.labour_avg_7d ?? '—'}</td>
    </>
  )
}
