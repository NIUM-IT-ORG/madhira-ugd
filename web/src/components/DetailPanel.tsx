import type { Indexes } from '../lib'
import { fmtM, manholeName } from '../lib/data'
import type { Selection } from '../lib/types'
import { useFieldProgress } from '../lib/progress'

interface Props {
  selection: Selection
  idx: Indexes
  onSelect: (s: Selection) => void
  onClose: () => void
  /** Present when the user may change the network in this feature's ward. */
  onDelete?: (entity: 'pipe' | 'manhole', id: string, title: string, extra?: string) => void
  pendingDelete?: (entity: 'pipe' | 'manhole', id: string) => string | null
  canEdit?: (ward: number | null) => boolean
  isAdmin?: boolean
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{v ?? '—'}</span>
    </div>
  )
}

function Progress({ label, done, total, unit }: { label: string; done: number; total: number; unit?: string }) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0
  return (
    <div className="progress">
      <div className="progress-head">
        <span>{label}</span>
        <span className="num">
          {unit === 'm' ? fmtM(done) : done.toLocaleString('en-IN')} / {unit === 'm' ? fmtM(total) : total.toLocaleString('en-IN')}
          <b> {pct.toFixed(0)}%</b>
        </span>
      </div>
      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

export default function DetailPanel({ selection, idx, onSelect, onClose, onDelete, pendingDelete, canEdit, isAdmin }: Props) {
  const progress = useFieldProgress()
  if (!selection) return null
  let title = ''
  let body: React.ReactNode = null

  if (selection.kind === 'pipe') {
    const p = idx.pipeById.get(selection.id)
    if (!p) return null
    const a = idx.mhById.get(p.from)
    const b = idx.mhById.get(p.to)
    title = `Pipe reach ${p.id}`
    body = (
      <>
        <div className="reach">
          <button className="link" onClick={() => onSelect({ kind: 'manhole', id: p.from })}>{a ? manholeName(a.id, a.label) : p.from}</button>
          <span className="arrow" aria-label="flows to">→</span>
          <button className="link" onClick={() => onSelect({ kind: 'manhole', id: p.to })}>{b ? manholeName(b.id, b.label) : p.to}</button>
        </div>
        <Row k="Length (plan label)" v={p.len_label_m != null ? `${p.len_label_m} m` : null} />
        <Row k="Length (drawn)" v={`${p.len_geom_m} m`} />
        <Row k="Diameter" v={p.dia_mm ? `${p.dia_mm} mm${p.dia_inferred ? ' (from colour)' : ''}` : null} />
        <Row k="Slope" v={p.slope} />
        <Row k="Zone / Ward" v={`Zone ${p.zone} · Ward ${p.ward ?? '?'}`} />
        <Row k="Source" v={p.added ? 'Added in the field (approved)' : `Plan sheet ${p.sheet}`} />
        {pendingDelete?.('pipe', p.id) && <div className="note warn">Deletion requested ({pendingDelete('pipe', p.id)}), waiting for approval.</div>}
        {onDelete && canEdit?.(p.ward) && !pendingDelete?.('pipe', p.id) && (
          <div className="actions">
            <button className="btn danger-outline" onClick={() => onDelete('pipe', p.id, `pipe ${p.id}`)}>{isAdmin ? 'Delete pipe' : 'Request deletion'}</button>
          </div>
        )}
      </>
    )
  } else if (selection.kind === 'manhole') {
    const m = idx.mhById.get(selection.id)
    if (!m) return null
    title = manholeName(m.id, m.label)
    const depth = m.gl != null && m.il != null ? (m.gl - m.il).toFixed(2) : null
    const pipes = idx.pipesByMh.get(m.id) ?? []
    body = (
      <>
        <Row k="Ground level (GL)" v={m.gl != null ? `${m.gl} m` : null} />
        <Row k="Invert level (IL)" v={m.il != null ? `${m.il} m` : null} />
        <Row k="Depth (GL − IL)" v={depth ? `${depth} m` : null} />
        <Row k="Zone / Ward" v={`Zone ${m.zone} · Ward ${m.ward ?? '?'}`} />
        {m.outside_boundary && <div className="note warn">Just outside the KML ward outline; nearest ward shown.</div>}
        {m.added && <div className="note">Added in the field (approved).</div>}
        {pendingDelete?.('manhole', m.id) && <div className="note warn">Deletion requested ({pendingDelete('manhole', m.id)}), waiting for approval.</div>}
        <h4>Connected reaches ({pipes.length})</h4>
        <ul className="plain">
          {pipes.map((id) => {
            const p = idx.pipeById.get(id)!
            const other = p.from === m.id ? p.to : p.from
            const o = idx.mhById.get(other)
            return (
              <li key={id}>
                <button className="link" onClick={() => onSelect({ kind: 'pipe', id })}>
                  {p.from === m.id ? 'to' : 'from'} {o?.label ?? other} · {p.length_m} m · {p.dia_mm ?? '?'} mm
                </button>
              </li>
            )
          })}
        </ul>
        {onDelete && canEdit?.(m.ward) && !pendingDelete?.('manhole', m.id) && (
          <div className="actions">
            <button className="btn danger-outline" onClick={() => onDelete('manhole', m.id, manholeName(m.id, m.label), pipes.length ? `Its ${pipes.length} connected pipe(s) will be deleted too.` : undefined)}>
              {isAdmin ? 'Delete manhole' : 'Request deletion'}
            </button>
          </div>
        )}
      </>
    )
  } else if (selection.kind === 'ward') {
    const w = idx.wardStats.get(selection.id)
    if (!w) return null
    title = `Ward ${w.ward}`
    const r = progress.zones.flatMap((z) => z.rows).find((x) => x.wards[0] === w.ward)
    body = (
      <>
        <Row k="Zone" v={`Zone ${w.zone}`} />
        <Row k="Locality" v={w.locality} />
        {r && (
          <>
            <Row k="Plan network" v={`${r.plan.manholes} MH · ${fmtM(r.plan.pipe_m)}`} />
            <h4>Recorded by staff</h4>
            <Progress label="Network recorded" done={r.plan.recorded_m} total={r.plan.pipe_m} unit="m" />
            <Progress label="Pipe laid" done={r.field.pipe_laid_m} total={r.plan.pipe_m} unit="m" />
            <Progress label="Manholes built" done={r.field.manholes_built} total={r.plan.manholes} />
            <Row k="Not yet recorded" v={fmtM(r.plan.pipe_m - r.plan.recorded_m)} />
            <Row k="Inspection chambers built" v={String(r.field.ics_built)} />
            <Row k="Road restored (CC · gravel)" v={`${fmtM(r.field.restored_cc_m)} · ${fmtM(r.field.restored_gravel_m)}`} />
            <Row k="Open issues" v={String(r.issues_open)} />
          </>
        )}
      </>
    )
  } else {
    return null
  }

  return (
    <aside className="panel detail">
      <header>
        <h3>{title}</h3>
        <button className="icon" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="panel-body">{body}</div>
    </aside>
  )
}
