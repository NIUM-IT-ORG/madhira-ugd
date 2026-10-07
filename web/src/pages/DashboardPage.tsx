import { Fragment, useEffect, useMemo, useState } from 'react'
import { ISSUE_KINDS, STAGES, deriveTags, restorationLabel, sewerCombo, surfaceOf, surfaceWord } from '../../../shared/status.ts'
import { pct, type AreaRow, type FieldFigures, type LabourLike } from '../../../shared/stats.ts'
import { HBars, Legend, LineChart, Meter, VIZ, km } from '../components/charts'
import { Sheet, StageDot, Tags, fmtDateTime } from '../components/ui'
import { get } from '../lib/api'
import { requestLayer, useFieldProgress } from '../lib/progress'
import { useData } from '../lib/store'
import type { Selection } from '../lib/types'

/*
 * Field dashboard (v1.25): every figure comes from what staff record on the map, measured against the plan
 * network (the drawings plus the network changes the Commissioner approved). No progress-sheet figures.
 */

type Week = FieldFigures & { week: string; open_issues: number; issues_opened: number; issues_resolved: number; plan_m: number }
interface PlanSummary {
  base: { pipe_m: number; pipes: number; manholes: number }
  current: { pipe_m: number; pipes: number; manholes: number }
  changes: { added_pipes: number; added_pipe_m: number; removed_pipes: number; removed_pipe_m: number; added_manholes: number; removed_manholes: number; last_change_at: string | null }
  pending: { pipe_add: number; pipe_add_m: number; pipe_delete: number; pipe_delete_m: number; manhole_add: number; manhole_delete: number }
}
interface WeekSummary {
  updates: number; new_stretches: number; stretches_touched: number; restored: number
  issues_opened: number; issues_resolved: number; labour_avg: number | null
  active: { name: string; updates: number }[]
}

const n = (v: number) => v.toLocaleString('en-IN')
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '—')

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function WardReport({ row, zoneLabour, onClose }: { row: AreaRow; zoneLabour: number | null; onClose: () => void }) {
  const { stretches, issues } = useData()
  const list = stretches.features.filter((f) => row.wards.includes(f.properties.ward))
  const open = issues.filter((i) => i.ward != null && row.wards.includes(i.ward) && i.status !== 'resolved')
  const f = row.field
  const p = row.plan
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
        <h2 className="print-only">UGD field report · {row.label}</h2>
        <p className="muted">{row.locality} · Zone {row.zone} · all figures recorded by staff on the map</p>
        <table className="data compact">
          <thead><tr><th></th><th>Pipeline</th><th>Manholes</th><th>Inspection chambers</th></tr></thead>
          <tbody>
            <tr><td>Plan network</td><td>{km(p.pipe_m)}</td><td>{n(p.manholes)}</td><td>—</td></tr>
            <tr><td>Recorded by staff</td><td>{km(p.recorded_m)} ({pct(p.recorded_m, p.pipe_m)}%)</td><td>—</td><td>—</td></tr>
            <tr><td>Built (field)</td><td>{km(f.pipe_laid_m)} laid ({pct(f.pipe_laid_m, p.pipe_m)}%)</td><td>{n(f.manholes_built)} ({pct(f.manholes_built, p.manholes)}%)</td><td>{n(f.ics_built)}</td></tr>
          </tbody>
        </table>
        <div className="report-grid">
          <div><span className="muted">Not yet recorded</span><b>{km(p.pipe_m - p.recorded_m)}</b></div>
          <div><span className="muted">Road cut</span><b>{km(f.road_cut_m)}</b></div>
          <div><span className="muted">Restoration pending</span><b>{km(f.restoration_pending_m)}</b></div>
          <div><span className="muted">Restored (CC · gravel)</span><b>{km(f.restored_cc_m)} · {km(f.restored_gravel_m)}</b></div>
          <div><span className="muted">Approved</span><b>{km(f.approved_m)}</b></div>
          <div><span className="muted">Not motorable</span><b>{km(f.not_motorable_m)}</b></div>
          <div><span className="muted">Open issues</span><b>{row.issues_open}</b></div>
          <div><span className="muted">Zone {row.zone} labour / day (7 d)</span><b>{zoneLabour ?? '—'}</b></div>
        </div>
        <h4>Road stretches ({list.length})</h4>
        <table className="data compact">
          <thead><tr><th>Code</th><th>Road</th><th>Length</th><th>Stage</th><th>Sewer</th><th>Restoration</th><th>Tags</th></tr></thead>
          <tbody>
            {list.map((s) => {
              const sp = s.properties
              const st = STAGES.find((x) => x.key === sp.stage)!
              return (
                <tr key={s.id}>
                  <td>{sp.code}</td><td>{sp.name ?? '—'}</td><td className="num">{Math.round(sp.length_m)} m</td>
                  <td><StageDot colour={st.colour} /> {st.label}</td><td>{sewerCombo(sp.status, sp.planned_mh)}</td>
                  <td>{surfaceWord(surfaceOf(sp.status))}: {restorationLabel(sp.status.restoration.stage, surfaceOf(sp.status))}</td>
                  <td><Tags tags={deriveTags(sp.status, sp.approval, sp.planned_mh).filter((t) => t.tone === 'bad' || t.tone === 'warn')} max={3} /></td>
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
  const [plan, setPlan] = useState<PlanSummary | null>(null)
  const [week, setWeek] = useState<WeekSummary | null>(null)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [report, setReport] = useState<AreaRow | null>(null)

  useEffect(() => {
    get<{ entries: LabourLike[] }>('/api/labour').then((r) => setLabour(r.entries)).catch(() => undefined)
    get<{ weeks: Week[] }>('/api/stats/timeline').then((r) => setWeeks(r.weeks)).catch(() => undefined)
    get<PlanSummary>('/api/stats/plan').then(setPlan).catch(() => undefined)
    get<WeekSummary>('/api/stats/week').then(setWeek).catch(() => undefined)
  }, [lastEvent?.at])

  const table = useFieldProgress(labour)
  const T = table.total
  const F = T.field
  const P = T.plan
  const notRecorded = P.pipe_m - P.recorded_m
  const waiting = requests.filter((r) => r.status === 'pending').length
    + stretches.features.filter((f) => f.properties.stage === 'awaiting_approval' && f.properties.approval === 'pending').length
  const openIssues = issues.filter((i) => i.status !== 'resolved')
  const flagged = stretches.features.filter((f) => f.properties.flagged_far).length
  const wardRows = table.zones.flatMap((z) => z.rows)
  const leastRecorded = useMemo(() => [...wardRows].filter((r) => r.plan.pipe_m > 0)
    .sort((a, b) => a.plan.recorded_m / a.plan.pipe_m - b.plan.recorded_m / b.plan.pipe_m || b.plan.pipe_m - a.plan.pipe_m).slice(0, 8), [wardRows])
  const zoneName = (z: number) => geo.zones.features.find((f) => f.properties.zone === z)?.properties.name ?? `Zone ${z}`
  const showOnMap = (layer: 'unrecorded' | 'coverage') => { requestLayer(layer); onShow(null) }

  const issueRows = ISSUE_KINDS.map((k) => {
    const v = openIssues.filter((i) => i.kind === k.key).reduce((a, i) => a + i.count, 0)
    return { key: k.key, label: k.label, value: v, display: n(v) }
  }).filter((r) => r.value > 0).sort((a, b) => b.value - a.value)

  const restoration = [
    { key: 'cut', label: 'Road cut', value: F.road_cut_m, display: km(F.road_cut_m), colour: VIZ.blue[2] },
    { key: 'bf', label: 'Back-filled', value: F.backfilled_m + F.restored_m, display: km(F.backfilled_m + F.restored_m), colour: VIZ.blue[3], note: 'includes stretches restored since' },
    { key: 'cc', label: 'Restored · CC', value: F.restored_cc_m, display: km(F.restored_cc_m), colour: VIZ.blue[4] },
    { key: 'gr', label: 'Restored · gravel', value: F.restored_gravel_m, display: km(F.restored_gravel_m), colour: VIZ.blue[4] },
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
          Every figure is what your staff recorded on the map, measured against the plan network (the drawings plus approved
          changes: {km(P.pipe_m)} of pipeline, {n(P.manholes)} manholes). It updates live.
        </p>
      </div>

      <section className="hero-row">
        <div className="hero">
          <div className="stat-label">Network recorded by staff</div>
          <div className="hero-value">{pct(P.recorded_m, P.pipe_m)}%</div>
          <div className="stat-sub">{km(P.recorded_m)} of {km(P.pipe_m)} · {n(P.recorded_pipes)} of {n(P.pipes)} pipe reaches</div>
          <Meter value={P.recorded_m} total={P.pipe_m} label="Recorded" sub={`${km(notRecorded)} not yet recorded`} />
          <button className="btn small" onClick={() => showOnMap('unrecorded')}>Show what is not recorded on the map</button>
        </div>
        <div className="stats">
          <StatTile label="Pipe laid (field)" value={km(F.pipe_laid_m)} sub={`${pct(F.pipe_laid_m, P.pipe_m)}% of the plan network`} />
          <StatTile label="Manholes built (field)" value={n(F.manholes_built)} sub={`${pct(F.manholes_built, P.manholes)}% of ${n(P.manholes)} on the plan`} />
          <StatTile label="Inspection chambers built" value={n(F.ics_built)} sub={`on ${n(F.stretches)} recorded stretches`} />
          <StatTile label="Road restored" value={km(F.restored_m)} sub={`CC ${km(F.restored_cc_m)} · gravel ${km(F.restored_gravel_m)} · approved ${km(F.approved_m)}`} />
          <StatTile label="Open issues" value={n(openIssues.length)} sub={`${openIssues.filter((i) => i.severity === 'high').length} high severity · ${T.issues_overdue} overdue`} tone={openIssues.length ? 'bad' : undefined} />
          <StatTile label="Waiting for approval" value={n(waiting)} sub={flagged ? `${flagged} stretch updates made away from site` : 'restorations and change requests'} tone={waiting ? 'warn' : undefined} />
        </div>
      </section>

      <section className="grid2">
        <div className="card-box">
          <h3>Not yet recorded</h3>
          <p className="muted small">Plan network with no road stretch recorded on it, by zone, and the wards with the least recorded.</p>
          <div className="zone-meters">
            {table.zones.map(({ zone: z }) => (
              <div key={z.key} className="zone-meter">
                <div className="zone-meter-title">{zoneName(z.zone)}</div>
                <Meter label="Recorded" value={z.plan.recorded_m} total={z.plan.pipe_m} sub={`${km(z.plan.pipe_m - z.plan.recorded_m)} of ${km(z.plan.pipe_m)} not yet recorded`} />
                <Meter label="Pipe laid" value={z.field.pipe_laid_m} total={z.plan.pipe_m} sub={`${km(z.field.pipe_laid_m)} · MH ${n(z.field.manholes_built)} of ${n(z.plan.manholes)}`} />
              </div>
            ))}
          </div>
          <h4>Least recorded wards</h4>
          <table className="data compact">
            <thead><tr><th>Ward</th><th>Locality</th><th className="num">Not yet recorded</th><th className="num">Recorded</th></tr></thead>
            <tbody>
              {leastRecorded.map((r) => (
                <tr key={r.key} className="clickable" onClick={() => onShow({ kind: 'ward', id: r.wards[0] })}>
                  <td>{r.label}</td><td>{r.locality ?? '—'}</td>
                  <td className="num">{km(r.plan.pipe_m - r.plan.recorded_m)}</td><td className="num">{pct(r.plan.recorded_m, r.plan.pipe_m)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="btn-row">
            <button className="btn small" onClick={() => showOnMap('unrecorded')}>Show unrecorded pipes on the map</button>
            <button className="btn small" onClick={() => showOnMap('coverage')}>Shade wards on the map</button>
          </div>
        </div>
        <div className="col">
          <div className="card-box">
            <h3>Last 7 days</h3>
            {week ? (
              <>
                <div className="report-grid">
                  <div><span className="muted">Updates saved</span><b>{n(week.updates)}</b></div>
                  <div><span className="muted">New stretches</span><b>{n(week.new_stretches)}</b></div>
                  <div><span className="muted">Roads restored</span><b>{n(week.restored)}</b></div>
                  <div><span className="muted">Labour / day</span><b>{week.labour_avg ?? '—'}</b></div>
                  <div><span className="muted">Issues reported</span><b>{n(week.issues_opened)}</b></div>
                  <div><span className="muted">Issues resolved</span><b>{n(week.issues_resolved)}</b></div>
                  <div><span className="muted">Stretches updated</span><b>{n(week.stretches_touched)}</b></div>
                  <div><span className="muted">People active</span><b>{week.active.length}</b></div>
                </div>
                <p className="muted small">{week.active.length ? week.active.map((a) => `${a.name} (${a.updates})`).join(' · ') : 'No field updates this week.'}</p>
              </>
            ) : <p className="muted small">Loading…</p>}
          </div>
          <div className="card-box">
            <h3>Road restoration (field)</h3>
            <p className="muted small">How far the cut roads have moved towards a restored, approved road.</p>
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
        <Legend items={[{ label: 'Pipe laid', colour: VIZ.series[0], line: true }, { label: 'Road restored', colour: VIZ.series[1], line: true }, { label: 'Plan network', colour: VIZ.muted, line: true }]} />
        <LineChart
          x={weeks.map((w) => w.week)}
          series={[
            { key: 'pipe', label: 'pipe laid', colour: VIZ.series[0], values: weeks.map((w) => w.pipe_laid_m / 1000) },
            { key: 'rs', label: 'road restored', colour: VIZ.series[1], values: weeks.map((w) => w.restored_m / 1000) },
            { key: 'plan', label: 'plan network', colour: VIZ.muted, values: weeks.map((w) => w.plan_m / 1000) },
          ]}
          format={(v) => `${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })} km`}
          empty="The chart fills in as field updates are recorded, one point per week."
        />
      </section>

      <section className="card-box">
        <h3>Issues per week</h3>
        <Legend items={[{ label: 'Reported', colour: VIZ.series[1], line: true }, { label: 'Resolved', colour: VIZ.series[0], line: true }]} />
        <LineChart
          x={weeks.map((w) => w.week)}
          series={[
            { key: 'opened', label: 'reported', colour: VIZ.series[1], values: weeks.map((w) => w.issues_opened) },
            { key: 'resolved', label: 'resolved', colour: VIZ.series[0], values: weeks.map((w) => w.issues_resolved) },
          ]}
          format={(v) => `${Math.round(v)} issues`}
          empty="The chart fills in as issues are reported."
        />
      </section>

      <section className="card-box">
        <h3>Zones and wards</h3>
        <p className="muted small">Click a zone to see its wards. Plan = the drawings plus approved changes; everything else is recorded by staff.</p>
        <div className="table-wrap">
          <table className="data tree">
            <thead>
              <tr>
                <th>Area</th><th>Plan pipe</th><th>Recorded</th><th>Not yet recorded</th><th>Pipe laid</th><th>MH built / plan</th><th>ICs</th>
                <th>Road cut</th><th>Restored</th><th>Approved</th><th>Open issues</th><th title="Average labourers per day over the last 7 days, recorded per zone">Labour / day (zone)</th><th></th>
              </tr>
            </thead>
            <tbody>
              {table.zones.map(({ zone: z, rows }) => (
                <Fragment key={z.key}>
                  <tr className="zone-row clickable" onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(z.zone)) x.delete(z.zone); else x.add(z.zone); return x })}>
                    <td><b>{open.has(z.zone) ? '▾' : '▸'} {zoneName(z.zone)}</b></td>
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

      <section className="card-box">
        <details>
          <summary><b>How these figures are counted</b></summary>
          <ul className="plain small">
            <li><b>Plan network</b>: the sewer network on the drawings ({km(plan?.base.pipe_m ?? 0)}, {n(plan?.base.manholes ?? 0)} manholes)
              {plan && (plan.changes.added_pipes + plan.changes.removed_pipes + plan.changes.added_manholes + plan.changes.removed_manholes) > 0
                ? <> plus approved changes: +{km(plan.changes.added_pipe_m)} ({plan.changes.added_pipes} pipes), −{km(plan.changes.removed_pipe_m)} ({plan.changes.removed_pipes} pipes), +{plan.changes.added_manholes} / −{plan.changes.removed_manholes} manholes (latest {day(plan.changes.last_change_at)})</>
                : ' (no approved changes yet)'} = <b>{km(P.pipe_m)}</b>, {n(P.manholes)} manholes. It changes only when the Commissioner approves a pipe or manhole.</li>
            {plan && (plan.pending.pipe_add + plan.pending.pipe_delete + plan.pending.manhole_add + plan.pending.manhole_delete) > 0 && (
              <li><b>Waiting for approval</b> (not counted yet): +{km(plan.pending.pipe_add_m)} in {plan.pending.pipe_add} pipes, −{km(plan.pending.pipe_delete_m)} in {plan.pending.pipe_delete} pipes, +{plan.pending.manhole_add} / −{plan.pending.manhole_delete} manholes.</li>
            )}
            <li><b>Recorded</b>: plan pipes covered by a road stretch (proposed stretches included). Adding stretches never changes the plan; it raises what is recorded.</li>
            <li><b>Off-plan roads</b> (drawn by hand, on no plan pipe): {km(F.offplan_m)}, counted in field progress but not in "recorded".</li>
            <li><b>Pipe laid, manholes, restoration</b>: from the status staff recorded on each stretch. Labour is recorded per zone.</li>
          </ul>
        </details>
      </section>
      {report && <WardReport row={report} zoneLabour={table.zones.find((z) => z.zone.zone === report.zone)?.zone.labour_avg_7d ?? null} onClose={() => setReport(null)} />}
    </div>
  )
}

function AreaCells({ r }: { r: AreaRow }) {
  const f = r.field
  const p = r.plan
  return (
    <>
      <td className="num">{km(p.pipe_m)}</td>
      <td className="num">{km(p.recorded_m)} <span className="muted">({pct(p.recorded_m, p.pipe_m)}%)</span></td>
      <td className="num">{km(p.pipe_m - p.recorded_m)}</td>
      <td className="num">{km(f.pipe_laid_m)} <span className="muted">({pct(f.pipe_laid_m, p.pipe_m)}%)</span></td>
      <td className="num">{n(f.manholes_built)} / {n(p.manholes)}</td>
      <td className="num">{n(f.ics_built)}</td>
      <td className="num">{km(f.road_cut_m)}</td>
      <td className="num">{km(f.restored_m)}</td>
      <td className="num">{km(f.approved_m)}</td>
      <td className="num">{r.issues_open ? <b className="bad">{r.issues_open}</b> : 0}</td>
      <td className="num">{r.labour_avg_7d ?? '—'}</td>
    </>
  )
}
