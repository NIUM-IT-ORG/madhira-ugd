import { useState } from 'react'
import { requestTitle } from '../components/NetworkForms'
import { Confirm, fmtDateTime, timeAgo } from '../components/ui'
import { post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useData } from '../lib/store'
import type { ChangeRequest, Selection, StretchFeature } from '../lib/types'

type Pending =
  | { kind: 'restoration'; stretch: StretchFeature; to: 'approve' | 'reject' }
  | { kind: 'request'; request: ChangeRequest; to: 'approve' | 'reject' | 'withdraw' }

/** The Commissioner's inbox: restorations to approve and network / stretch changes to decide. */
export default function ApprovalsPage({ onShow, toast }: { onShow: (s: Selection) => void; toast: (m: string, t?: 'ok' | 'warn' | 'bad') => void }) {
  const { user } = useAuth()
  const { stretches, requests } = useData()
  const [confirm, setConfirm] = useState<Pending | null>(null)
  const isAdmin = user?.role === 'admin'

  const restorations = stretches.features.filter((f) => f.properties.stage === 'awaiting_approval' && f.properties.approval === 'pending')
  const pending = requests.filter((r) => r.status === 'pending' && (isAdmin || r.requested_by === user?.id))
  const decided = requests.filter((r) => r.status !== 'pending' && (isAdmin || r.requested_by === user?.id)).slice(0, 40)

  return (
    <div className="page">
      <div className="page-head">
        <h2>{isAdmin ? 'Approvals' : 'My requests'}</h2>
        <p className="muted">
          {isAdmin
            ? 'CC road restorations turn green only after you approve them. Additions and deletions of stretches, pipes and manholes by AEEs wait here too.'
            : 'Additions and deletions you proposed, and the Commissioner’s decisions.'}
        </p>
      </div>

      {isAdmin && (
        <section className="card-section">
          <h3>CC restoration awaiting approval <span className="count">{restorations.length}</span></h3>
          {!restorations.length && <div className="muted">Nothing waiting.</div>}
          <div className="cards">
            {restorations.map((f) => (
              <div key={f.id} className="card">
                <div className="card-top"><b>{f.properties.code}</b><span className="muted">{timeAgo(f.properties.updated_at)}</span></div>
                <div>{f.properties.name ?? 'Unnamed road'} · ward {f.properties.ward} · {Math.round(f.properties.length_m)} m</div>
                <div className="muted small">Recorded by {f.properties.updated_by_name ?? '—'}{f.properties.flagged_far ? ' · ⚠ recorded away from site' : ''}</div>
                <div className="btn-row">
                  <button className="btn small" onClick={() => onShow({ kind: 'stretch', id: f.id })}>Show on map</button>
                  <button className="btn small primary" onClick={() => setConfirm({ kind: 'restoration', stretch: f, to: 'approve' })}>Approve</button>
                  <button className="btn small danger" onClick={() => setConfirm({ kind: 'restoration', stretch: f, to: 'reject' })}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card-section">
        <h3>{isAdmin ? 'Changes awaiting approval' : 'Waiting for the Commissioner'} <span className="count">{pending.length}</span></h3>
        {!pending.length && <div className="muted">Nothing waiting.</div>}
        <div className="cards">
          {pending.map((r) => (
            <div key={r.id} className={`card req-${r.action}`}>
              <div className="card-top"><b>{r.code}</b><span className="muted">{timeAgo(r.requested_at)}</span></div>
              <div>{requestTitle(r)} · ward {r.ward ?? '?'}</div>
              <div className="muted small">By {r.requested_by_name}{r.requested_by_designation ? ` (${r.requested_by_designation})` : ''}</div>
              {r.reason && <div className="tl-note">“{r.reason}”</div>}
              <div className="btn-row">
                <button className="btn small" onClick={() => onShow({ kind: r.entity === 'stretch' ? 'stretch' : 'request', id: r.entity === 'stretch' ? r.target_id : r.id })}>Show on map</button>
                {isAdmin && <button className="btn small primary" onClick={() => setConfirm({ kind: 'request', request: r, to: 'approve' })}>Approve</button>}
                {isAdmin && <button className="btn small danger" onClick={() => setConfirm({ kind: 'request', request: r, to: 'reject' })}>Reject</button>}
                {r.requested_by === user?.id && <button className="btn small" onClick={() => setConfirm({ kind: 'request', request: r, to: 'withdraw' })}>Withdraw</button>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card-section">
        <h3>Decided</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Request</th><th>What</th><th>Ward</th><th>By</th><th>Decision</th><th>When</th><th>Note</th></tr></thead>
            <tbody>
              {decided.map((r) => (
                <tr key={r.id}>
                  <td>{r.code}</td><td>{requestTitle(r)}</td><td>{r.ward ?? '—'}</td><td>{r.requested_by_name}</td>
                  <td><span className={`chip ${r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'bad' : 'neutral'}`}>{r.status}</span></td>
                  <td>{r.decided_at ? fmtDateTime(r.decided_at) : '—'}</td><td>{r.decision_note ?? ''}</td>
                </tr>
              ))}
              {!decided.length && <tr><td colSpan={7} className="muted">None yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {confirm?.kind === 'restoration' && (
        <Confirm
          title={`${confirm.to === 'approve' ? 'Approve' : 'Reject'} restoration of ${confirm.stretch.properties.code}`}
          message={confirm.to === 'approve' ? 'The stretch turns green on the map.' : 'The AEE sees your reason in the stretch history.'}
          confirmLabel={confirm.to === 'approve' ? 'Approve' : 'Reject'} needReason={confirm.to === 'reject'} danger={confirm.to === 'reject'}
          onClose={() => setConfirm(null)}
          onConfirm={async (note) => {
            await post(`/api/stretches/${confirm.stretch.id}/${confirm.to}`, { note: note || null })
            toast(`${confirm.stretch.properties.code} ${confirm.to === 'approve' ? 'approved' : 'rejected'}.`)
          }}
        />
      )}
      {confirm?.kind === 'request' && (
        <Confirm
          title={`${{ approve: 'Approve', reject: 'Reject', withdraw: 'Withdraw' }[confirm.to]} ${confirm.request.code}`}
          message={`${requestTitle(confirm.request)}${confirm.to === 'approve' ? ': this changes the official map.' : '.'}`}
          confirmLabel={{ approve: 'Approve', reject: 'Reject', withdraw: 'Withdraw' }[confirm.to]}
          needReason={confirm.to === 'reject'} danger={confirm.to !== 'approve'}
          onClose={() => setConfirm(null)}
          onConfirm={async (note) => {
            await post(`/api/change-requests/${confirm.request.id}/${confirm.to}`, { note: note || null })
            toast(`${confirm.request.code} ${confirm.to === 'approve' ? 'approved' : confirm.to === 'reject' ? 'rejected' : 'withdrawn'}.`)
          }}
        />
      )}
    </div>
  )
}
