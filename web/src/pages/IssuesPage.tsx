import { useMemo, useState } from 'react'
import { ISSUE_KINDS, issueLabel } from '../../../shared/status.ts'
import { isOverdue } from '../../../shared/stats.ts'
import { timeAgo } from '../components/ui'
import { useData } from '../lib/store'
import type { Issue, Selection } from '../lib/types'

const COLUMNS: { key: Issue['status']; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'resolved', label: 'Resolved' },
]

const ageDays = (i: Issue) => Math.floor((Date.now() - new Date(i.reported_at).getTime()) / 86400000)

export default function IssuesPage({ onShow }: { onShow: (s: Selection) => void }) {
  const { issues, geo } = useData()
  const [kind, setKind] = useState('')
  const [zone, setZone] = useState('')
  const [ward, setWard] = useState('')
  const [status, setStatus] = useState('')
  const [severity, setSeverity] = useState('')
  const [view, setView] = useState<'board' | 'table'>('board')
  const [showResolved, setShowResolved] = useState(false)

  // Wards of the chosen zone (all 22 when no zone is chosen).
  const wardOptions = useMemo(() => geo.wards.features.map((w) => w.properties).filter((w) => !zone || String(w.zone) === zone)
    .map((w) => w.ward).sort((a, b) => a - b), [geo.wards, zone])
  const list = useMemo(() => issues.filter((i) =>
    (!kind || i.kind === kind) && (!zone || String(i.zone) === zone) && (!ward || String(i.ward) === ward) &&
    (!severity || i.severity === severity) && (!status || i.status === status)), [issues, kind, zone, ward, severity, status])
  const exportUrl = '/api/export/issues.xlsx?' + new URLSearchParams(Object.entries({ kind, zone, ward, severity, status }).filter(([, v]) => v)).toString()
  const open = list.filter((i) => i.status !== 'resolved')
  const overdue = open.filter((i) => isOverdue(i.due_date))
  const byKind = ISSUE_KINDS.map((k) => ({ ...k, n: open.filter((i) => i.kind === k.key).reduce((a, i) => a + i.count, 0) })).filter((k) => k.n)

  return (
    <div className="page">
      <div className="page-head">
        <h2>Issues</h2>
        <div className="kpis small">
          <div><b>{open.length}</b><span>open</span></div>
          <div><b>{open.filter((i) => i.severity === 'high').length}</b><span>high severity</span></div>
          <div className={overdue.length ? 'bad' : ''}><b>{overdue.length}</b><span>overdue</span></div>
          <div><b>{open.length ? Math.round(open.reduce((a, i) => a + ageDays(i), 0) / open.length) : 0}</b><span>avg days open</span></div>
        </div>
      </div>
      <div className="filters">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option>{ISSUE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
        <select value={zone} onChange={(e) => { setZone(e.target.value); setWard('') }} aria-label="Zone"><option value="">All zones</option>{[1, 2, 3, 4].map((z) => <option key={z} value={z}>Zone {z}</option>)}</select>
        <select value={ward} onChange={(e) => setWard(e.target.value)} aria-label="Ward"><option value="">All wards</option>{wardOptions.map((w) => <option key={w} value={w}>Ward {w}</option>)}</select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity"><option value="">All severities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        <div className="seg small">
          <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Board</button>
          <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Table</button>
        </div>
        <a className="btn small" href={exportUrl} download>Download Excel</a>
        {view === 'table' && <label className="check"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />Include resolved</label>}
      </div>
      {byKind.length > 0 && (
        <div className="kind-strip">{byKind.map((k) => <span key={k.key} className="chip neutral">{k.label}: <b>{k.n}</b></span>)}</div>
      )}
      {view === 'board' ? (
        <div className="board">
          {COLUMNS.map((c) => {
            const items = list.filter((i) => i.status === c.key).slice(0, c.key === 'resolved' ? 30 : 500)
            return (
              <div key={c.key} className="board-col">
                <h4>{c.label} <span className="count">{list.filter((i) => i.status === c.key).length}</span></h4>
                {items.map((i) => (
                  <button key={i.id} className={`card issue-card sev-${i.severity}`} onClick={() => onShow({ kind: 'issue', id: i.id })}>
                    <div className="card-top"><b>{i.code}</b><span className="muted">{timeAgo(i.reported_at)}</span></div>
                    <div>{issueLabel(i.kind)}{i.count > 1 ? ` × ${i.count}` : ''}</div>
                    <div className="muted small">Ward {i.ward ?? '?'}{i.stretch_code ? ` · ${i.stretch_code}` : ''}{i.assigned_to ? ` · ${i.assigned_to}` : ''}</div>
                    {i.status !== 'resolved' && isOverdue(i.due_date) && <span className="chip bad">Overdue</span>}
                  </button>
                ))}
                {!items.length && <div className="muted small">None</div>}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Code</th><th>Issue</th><th>Ward</th><th>Stretch</th><th>Severity</th><th>Status</th><th>Assigned</th><th>Days open</th><th>Reported by</th></tr></thead>
            <tbody>
              {list.filter((i) => showResolved || status === 'resolved' || i.status !== 'resolved').map((i) => (
                <tr key={i.id} onClick={() => onShow({ kind: 'issue', id: i.id })} className="clickable">
                  <td>{i.code}</td><td>{issueLabel(i.kind)}{i.count > 1 ? ` × ${i.count}` : ''}</td><td>{i.ward ?? '—'}</td><td>{i.stretch_code ?? '—'}</td>
                  <td><span className={`chip ${i.severity === 'high' ? 'bad' : i.severity === 'medium' ? 'warn' : 'neutral'}`}>{i.severity}</span></td>
                  <td>{i.status}</td><td>{i.assigned_to ?? '—'}</td><td className="num">{i.status === 'resolved' ? '—' : ageDays(i)}</td><td>{i.reported_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
