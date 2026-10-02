import { useState } from 'react'
import { distanceM } from '../../../shared/geo.ts'
import { post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { manholeName } from '../lib/data'
import { useData } from '../lib/store'
import type { ChangeRequest, Selection } from '../lib/types'
import { Confirm, Field, NumberInput, Seg, Sheet, fmtDateTime } from './ui'

const DIAS = [150, 200, 250, 300, 350, 400, 600, 700]

function useSubmit(onDone: (msg: string) => void, onClose: () => void) {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (body: Record<string, unknown>, what: string) => {
    setBusy(true)
    setError(null)
    try {
      const r = await post<{ request: ChangeRequest }>('/api/change-requests', body)
      onDone(user?.role === 'admin' ? `${what} done.` : `${what} sent to the Commissioner for approval (${r.request.code}).`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, isAdmin: user?.role === 'admin' }
}

export function ManholeForm({ point, onClose, onDone }: { point: [number, number]; onClose: () => void; onDone: (m: string) => void }) {
  const [label, setLabel] = useState('')
  const [gl, setGl] = useState<number | null>(null)
  const [il, setIl] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const { busy, error, run, isAdmin } = useSubmit(onDone, onClose)
  const depth = gl != null && il != null ? gl - il : null
  return (
    <Sheet title="Add manhole" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !label.trim()} onClick={() => run({
          entity: 'manhole', action: 'add', reason: reason.trim() || null,
          payload: { lon: point[0], lat: point[1], label: label.trim(), gl, il },
        }, 'New manhole')}>{isAdmin ? 'Add manhole' : 'Send for approval'}</button>
      </>
    }>
      <p className="muted">Location {point[1].toFixed(6)}, {point[0].toFixed(6)}. The zone and ward are set from the location.</p>
      <Field label="Manhole number" hint="As used by the engineers, e.g. MH-2301 or 2301/1. Must be new in its zone.">
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="MH-2301" autoFocus />
      </Field>
      <div className="row2">
        <Field label="Ground level (GL)"><NumberInput value={gl} onChange={setGl} suffix="m" /></Field>
        <Field label="Invert level (IL)"><NumberInput value={il} onChange={setIl} suffix="m" /></Field>
      </div>
      {depth != null && <div className={depth <= 0 ? 'form-error' : 'muted'}>Depth {depth.toFixed(2)} m{depth <= 0 ? ': invert level must be below ground level.' : ''}</div>}
      <Field label={isAdmin ? 'Note (optional)' : 'Why is it needed? (optional)'}><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error && <div className="form-error">{error}</div>}
    </Sheet>
  )
}

export function PipeForm({ from, to, onClose, onDone }: { from: string; to: string; onClose: () => void; onDone: (m: string) => void }) {
  const { idx, requests } = useData()
  const coord = (id: string): [number, number] | null => {
    const m = idx.mhById.get(id)
    if (m) return m.coord
    const r = requests.find((x) => x.status === 'pending' && x.entity === 'manhole' && x.action === 'add' && x.target_id === id)
    return (r?.payload?.geometry?.coordinates as [number, number]) ?? null
  }
  const name = (id: string) => {
    const m = idx.mhById.get(id)
    return m ? manholeName(m.id, m.label) : `${id.split('/')[1]} (proposed)`
  }
  const a = coord(from)
  const b = coord(to)
  const geomLen = a && b ? Math.round(distanceM(a, b) * 10) / 10 : null
  const [dia, setDia] = useState('150')
  const [slope, setSlope] = useState('')
  const [length, setLength] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const { busy, error, run, isAdmin } = useSubmit(onDone, onClose)
  const slopeOk = !slope || /^1\/\d{2,5}$/.test(slope)
  return (
    <Sheet title="Add pipe" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !slopeOk} onClick={() => run({
          entity: 'pipe', action: 'add', reason: reason.trim() || null,
          payload: { from, to, dia_mm: Number(dia), slope: slope || null, length_m: length },
        }, 'New pipe')}>{isAdmin ? 'Add pipe' : 'Send for approval'}</button>
      </>
    }>
      <div className="reach"><b>{name(from)}</b><span className="arrow">—</span><b>{name(to)}</b></div>
      <p className="muted">Straight line {geomLen ?? '?'} m. Flow direction is set from the manholes' invert levels.</p>
      <Field label="Diameter">
        <Seg small value={dia} options={DIAS.map((d) => ({ v: String(d), label: `${d} mm` }))} onChange={setDia} />
      </Field>
      <div className="row2">
        <Field label="Slope (optional)" hint="Like 1/150">
          <input type="text" value={slope} onChange={(e) => setSlope(e.target.value.replace(/\s/g, ''))} placeholder="1/150" />
        </Field>
        <Field label="Length on drawing (optional)" hint="If different from the straight line"><NumberInput value={length} onChange={setLength} suffix="m" /></Field>
      </div>
      {!slopeOk && <div className="form-error">Write the slope as 1/150.</div>}
      <Field label={isAdmin ? 'Note (optional)' : 'Why is it needed? (optional)'}><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error && <div className="form-error">{error}</div>}
    </Sheet>
  )
}

/** Request (or, for the Commissioner, carry out) the deletion of a pipe or manhole. */
export function DeleteNetworkFeature({ entity, id, title, extra, onClose, onDone }: {
  entity: 'pipe' | 'manhole'; id: string; title: string; extra?: string; onClose: () => void; onDone: (m: string) => void
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  return (
    <Confirm
      title={isAdmin ? `Delete ${title}` : `Request deletion of ${title}`}
      message={<>{isAdmin ? 'It is removed from the network map at once; the change is recorded.' : 'The Commissioner must approve before it is removed.'}{extra && <p>{extra}</p>}</>}
      confirmLabel={isAdmin ? 'Delete' : 'Send request'}
      needReason={!isAdmin}
      danger
      onClose={onClose}
      onConfirm={async (reason) => {
        const r = await post<{ request: ChangeRequest }>('/api/change-requests', { entity, action: 'delete', target_id: id, reason: reason || null })
        onDone(isAdmin ? `${title} deleted.` : `Deletion of ${title} sent for approval (${r.request.code}).`)
      }}
    />
  )
}

const ENTITY = { stretch: 'road stretch', pipe: 'pipe', manhole: 'manhole' }

export function requestTitle(r: ChangeRequest) {
  const what = r.payload?.label ?? r.payload?.properties?.label ?? r.target_id.split('/').pop()
  return `${r.action === 'add' ? 'Add' : 'Delete'} ${ENTITY[r.entity]} ${what ?? ''}`.trim()
}

export function RequestDetail({ id, onClose, onSelect, toast }: { id: string; onClose: () => void; onSelect: (s: Selection) => void; toast: (m: string, t?: 'ok' | 'warn' | 'bad') => void }) {
  const { requests } = useData()
  const { user } = useAuth()
  const [confirm, setConfirm] = useState<null | 'approve' | 'reject' | 'withdraw'>(null)
  const r = requests.find((x) => x.id === id)
  if (!r) return null
  const props = r.payload?.properties ?? {}
  const isAdmin = user?.role === 'admin'
  const mine = r.requested_by === user?.id
  return (
    <aside className="panel detail">
      <header>
        <div>
          <h3>{r.code} · {requestTitle(r)}</h3>
          <div className="small muted">Ward {r.ward ?? '?'} · zone {r.zone ?? '?'} · <span className={`chip ${r.status === 'pending' ? 'warn' : r.status === 'approved' ? 'good' : 'neutral'}`}>{r.status}</span></div>
        </div>
        <button className="icon" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="panel-body">
        <div className="kv"><span className="k">Requested by</span><span className="v">{r.requested_by_name}{r.requested_by_designation ? ` (${r.requested_by_designation})` : ''}</span></div>
        <div className="kv"><span className="k">When</span><span className="v">{fmtDateTime(r.requested_at)}</span></div>
        {r.reason && <div className="tl-note">“{r.reason}”</div>}
        {r.entity === 'manhole' && r.action === 'add' && (
          <>
            <div className="kv"><span className="k">Ground level</span><span className="v">{String(props.gl ?? '—')}</span></div>
            <div className="kv"><span className="k">Invert level</span><span className="v">{String(props.il ?? '—')}</span></div>
          </>
        )}
        {r.entity === 'pipe' && r.action === 'add' && (
          <>
            <div className="kv"><span className="k">From → to</span><span className="v">{String(props.from_label)} → {String(props.to_label)}</span></div>
            <div className="kv"><span className="k">Diameter · slope</span><span className="v">{String(props.dia_mm)} mm · {String(props.slope ?? '—')}</span></div>
            <div className="kv"><span className="k">Length</span><span className="v">{String(props.length_m)} m</span></div>
          </>
        )}
        {r.entity === 'manhole' && r.action === 'delete' && (r.payload?.cascade_pipes?.length ?? 0) > 0 && (
          <div className="callout warn">Its {r.payload!.cascade_pipes!.length} connected pipe(s) are deleted too.</div>
        )}
        {r.entity === 'stretch' && <button className="btn link" onClick={() => onSelect({ kind: 'stretch', id: r.target_id })}>Open the stretch</button>}
        {r.decided_at && (
          <div className="callout">{r.status} by {r.decided_by_name} · {fmtDateTime(r.decided_at)}{r.decision_note ? ` · “${r.decision_note}”` : ''}</div>
        )}
        {r.status === 'pending' && (
          <div className="actions">
            {isAdmin && <button className="btn primary" onClick={() => setConfirm('approve')}>Approve</button>}
            {isAdmin && <button className="btn danger" onClick={() => setConfirm('reject')}>Reject</button>}
            {mine && <button className="btn" onClick={() => setConfirm('withdraw')}>Withdraw</button>}
          </div>
        )}
      </div>
      {confirm && (
        <Confirm
          title={`${confirm === 'approve' ? 'Approve' : confirm === 'reject' ? 'Reject' : 'Withdraw'} ${r.code}`}
          message={confirm === 'approve' ? `${requestTitle(r)}: this changes the official map.` : confirm === 'reject' ? 'The requester will see your reason.' : 'The request is cancelled.'}
          confirmLabel={confirm === 'approve' ? 'Approve' : confirm === 'reject' ? 'Reject' : 'Withdraw'}
          needReason={confirm === 'reject'}
          danger={confirm !== 'approve'}
          onClose={() => setConfirm(null)}
          onConfirm={async (note) => {
            await post(`/api/change-requests/${r.id}/${confirm}`, { note: note || null })
            toast(`${r.code} ${confirm === 'approve' ? 'approved' : confirm === 'reject' ? 'rejected' : 'withdrawn'}.`)
          }}
        />
      )}
    </aside>
  )
}
