import { useEffect, useState } from 'react'
import {
  FIELD_LABELS, STAGES, describeValue, deriveTags, issueLabel, label, restorationLabel, sewerCombo, surfaceOf,
} from '../../../shared/status.ts'
import { del, get, post } from '../lib/api'
import { canEditWard, useAuth } from '../lib/auth'
import { useData } from '../lib/store'
import type { Issue, Selection, StretchFeature, StretchVersion } from '../lib/types'
import { Confirm, PhotoStrip, StageDot, Tags, fmtDateTime, timeAgo } from './ui'

const KIND_LABEL: Record<string, string> = {
  create: 'Added', update: 'Updated', bulk: 'Bulk update', approve: 'Restoration approved', reject: 'Restoration rejected',
  revert: 'Rolled back', geometry: 'Line redrawn', delete: 'Removed', issue_resolved: 'Issue resolved',
}

interface Props {
  id: string
  onSelect: (s: Selection) => void
  onEdit: (f: StretchFeature) => void
  onRedraw: (f: StretchFeature) => void
  onAddIssue: (f: StretchFeature) => void
  onClose: () => void
  toast: (m: string, tone?: 'ok' | 'warn' | 'bad') => void
}

export default function StretchDetail({ id, onSelect, onEdit, onRedraw, onAddIssue, onClose, toast }: Props) {
  const { user } = useAuth()
  const { stretches, requests, lastEvent } = useData()
  const [detail, setDetail] = useState<{ stretch: StretchFeature; versions: StretchVersion[]; issues: Issue[] } | null>(null)
  const [tab, setTab] = useState<'status' | 'history'>('status')
  const [confirm, setConfirm] = useState<null | 'approve' | 'reject' | 'delete' | { revert: number }>(null)

  const live = stretches.features.find((f) => f.id === id)
  useEffect(() => {
    let alive = true
    get<{ stretch: StretchFeature; versions: StretchVersion[]; issues: Issue[] }>(`/api/stretches/${id}`)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null))
    return () => {
      alive = false
    }
    // Refetch when anything about this stretch changes (live events update the list version).
  }, [id, live?.properties.version, live?.properties.open_issues, lastEvent?.entity === 'issue' ? lastEvent.at : null])

  if (!detail) return <aside className="panel detail"><div className="panel-body muted">Loading…</div></aside>
  const f = detail.stretch
  const p = f.properties
  const s = p.status
  const stage = STAGES.find((x) => x.key === p.stage)!
  const tags = deriveTags(s, p.approval, p.planned_mh)
  const editable = canEditWard(user, p.ward) && !!live
  const isAdmin = user?.role === 'admin'
  const pendingDelete = requests.find((r) => r.entity === 'stretch' && r.action === 'delete' && r.target_id === id && r.status === 'pending')
  const pendingAdd = requests.find((r) => r.entity === 'stretch' && r.action === 'add' && r.target_id === id && r.status === 'pending')
  const openIssues = detail.issues.filter((i) => i.status !== 'resolved')
  const taps = Math.max(0, s.utilities.taps_broken - s.utilities.taps_restored)

  return (
    <aside className="panel detail stretch-detail">
      <header>
        <div>
          <h3>{p.code}{p.name ? ` · ${p.name}` : ''}</h3>
          <div className="stage-line small">
            <StageDot colour={stage.colour} /> {stage.label}
            {p.record_state === 'proposed' && <span className="chip warn">Proposed · awaiting approval</span>}
            {!live && <span className="chip bad">Removed</span>}
          </div>
        </div>
        <button className="icon" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="tabs-inline">
        <button className={tab === 'status' ? 'on' : ''} onClick={() => setTab('status')}>Status</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History ({detail.versions.length})</button>
      </div>
      <div className="panel-body">
        {tab === 'status' ? (
          <>
            <Tags tags={tags} />
            {p.approval === 'pending' && s.restoration.stage === 'restored_curing_done' && (
              <div className="callout good">
                {surfaceOf(s) === 'gravel' ? 'Gravel road laid and compacted' : 'CC road restored and cured'}: waiting for the Commissioner's approval.
                {isAdmin && live && (
                  <div className="btn-row">
                    <button className="btn primary" onClick={() => setConfirm('approve')}>Approve (turn green)</button>
                    <button className="btn danger" onClick={() => setConfirm('reject')}>Reject</button>
                  </div>
                )}
              </div>
            )}
            {p.approval === 'rejected' && <div className="callout bad">Restoration was rejected; see History for the reason. When the work is corrected, Update status with a new photo to send it for approval again.</div>}
            {pendingAdd && (
              <div className="callout warn">
                Added by {pendingAdd.requested_by_name} · request {pendingAdd.code}.
                {isAdmin && <button className="btn link" onClick={() => onSelect({ kind: 'request', id: pendingAdd.id })}>Review request</button>}
              </div>
            )}
            {pendingDelete && <div className="callout bad">Deletion requested by {pendingDelete.requested_by_name}: “{pendingDelete.reason}” ({pendingDelete.code})</div>}

            <dl className="buckets">
              <dt>A · Sewer work</dt>
              <dd>{label('pipeline', s.sewer.pipeline)}{s.sewer.pipeline === 'partial' && s.sewer.pipe_laid_m ? ` (${s.sewer.pipe_laid_m} m)` : ''} · {sewerCombo(s, p.planned_mh)}</dd>
              <dt>B · Road cutting</dt>
              <dd>{label('excavation', s.excavation.stage)}{s.excavation.cut_length_m ? ` · ${s.excavation.cut_length_m} m cut` : ''}</dd>
              <dt>C · Road restoration</dt>
              <dd>{label('surface', surfaceOf(s))}: {restorationLabel(s.restoration.stage, surfaceOf(s))}{p.approval === 'approved' ? ' · approved' : ''}</dd>
              <dt>D · Motorability</dt>
              <dd>{label('motorable', s.motorable)}</dd>
              <dt>E · Utilities</dt>
              <dd>
                {s.utilities.taps_broken ? `Taps: ${s.utilities.taps_broken} broken, ${s.utilities.taps_restored} restored${taps ? `, ${taps} pending` : ''}` : 'No tap damage'}
                {s.utilities.water_leaks ? ` · Leaks: ${s.utilities.water_leaks} reported, ${s.utilities.water_leaks_fixed} fixed${s.utilities.water_leaks > s.utilities.water_leaks_fixed ? `, ${s.utilities.water_leaks - s.utilities.water_leaks_fixed} pending` : ''}` : ''}
                {s.utilities.drain_clogged ? ' · drain clogged' : ''}
              </dd>
              <dt>F · Hazards</dt>
              <dd>
                {[s.hazards.water_stagnation && 'water stagnation', s.hazards.potholes && `${s.hazards.potholes} pothole(s)`, s.hazards.uneven_backfill && 'uneven back-fill']
                  .filter(Boolean).join(' · ') || 'None reported'}
              </dd>
            </dl>
            <div className="kv"><span className="k">Length · ward</span><span className="v">{Math.round(p.length_m)} m · ward {p.ward} (zone {p.zone})</span></div>
            {p.outside_ward && <div className="note warn">Outside the KML ward outline; counted in the nearest ward.</div>}
            <div className="kv"><span className="k">Last update</span><span className="v">{p.updated_by_name ?? '—'} · {timeAgo(p.updated_at)}</span></div>
            {p.flagged_far && <div className="callout warn">The last update was made more than 200 m from this stretch.</div>}

            {openIssues.length > 0 && (
              <>
                <h4>Open issues ({openIssues.length})</h4>
                <ul className="plain">
                  {openIssues.map((i) => (
                    <li key={i.id}>
                      <button className="link" onClick={() => onSelect({ kind: 'issue', id: i.id })}>
                        {i.code} · {issueLabel(i.kind)}{i.count > 1 ? ` × ${i.count}` : ''} · {i.status}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {live && (
              <div className="actions">
                {editable && <button className="btn primary" onClick={() => onEdit(live)}>Update status</button>}
                {editable && <button className="btn" onClick={() => onAddIssue(live)}>Report issue</button>}
                {editable && <button className="btn" onClick={() => onRedraw(live)}>Redraw line</button>}
                {editable && !pendingDelete && <button className="btn danger-outline" onClick={() => setConfirm('delete')}>{isAdmin ? 'Delete' : 'Request deletion'}</button>}
              </div>
            )}
          </>
        ) : (
          <ol className="timeline">
            {detail.versions.map((v) => (
              <li key={v.version} className={v.flagged_far ? 'flag' : ''}>
                <div className="tl-head">
                  <b>{KIND_LABEL[v.kind] ?? v.kind}</b> · v{v.version}
                  <span className="muted"> · {v.user_name ?? 'unknown'}{v.user_designation ? ` (${v.user_designation})` : ''} · {fmtDateTime(v.at)}</span>
                </div>
                {v.changes.length > 0 && (
                  <ul className="changes">
                    {v.changes.slice(0, 12).map((c, i) => (
                      <li key={i}>
                        {FIELD_LABELS[c.path] ?? c.path}: {v.kind !== 'create' && <><s>{describeValue(c.path, c.from, v.status ?? null)}</s> → </>}<b>{describeValue(c.path, c.to, v.status ?? null)}</b>
                      </li>
                    ))}
                  </ul>
                )}
                {v.note && <div className="tl-note">“{v.note}”</div>}
                <PhotoStrip ids={v.photos} />
                <div className="tl-meta">
                  {v.gps_distance_m != null ? (
                    <span className={v.flagged_far ? 'bad' : ''}>GPS {Math.round(v.gps_distance_m)} m from the stretch</span>
                  ) : (
                    v.kind === 'create' || v.kind === 'update' || v.kind === 'bulk' ? <span>No GPS</span> : null
                  )}
                  {v.warnings?.length > 0 && <span className="warn">Saved with warnings: {v.warnings.join(' ')}</span>}
                </div>
                {isAdmin && live && v.version < p.version && v.kind !== 'delete' && (
                  <button className="btn link small" onClick={() => setConfirm({ revert: v.version })}>Roll back to this version</button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {confirm === 'approve' && (
        <Confirm title={`Approve ${p.code}`} message={surfaceOf(s) === 'gravel' ? 'Confirm that the gravel road is laid and compacted. The stretch turns green.' : 'Confirm that the CC road is restored and cured. The stretch turns green.'} confirmLabel="Approve" needReason={false}
          onClose={() => setConfirm(null)} onConfirm={async (note) => { await post(`/api/stretches/${id}/approve`, { note }); toast(`${p.code} approved.`) }} />
      )}
      {confirm === 'reject' && (
        <Confirm title={`Reject restoration of ${p.code}`} message="The AEE will see your reason in the stretch history." confirmLabel="Reject" needReason danger
          onClose={() => setConfirm(null)} onConfirm={async (note) => { await post(`/api/stretches/${id}/reject`, { note }); toast(`${p.code} rejected.`, 'warn') }} />
      )}
      {confirm === 'delete' && (
        <Confirm title={isAdmin ? `Delete ${p.code}` : `Request deletion of ${p.code}`}
          message={isAdmin ? 'The stretch is removed from the map. Its history is kept.' : 'The Commissioner must approve the deletion before the stretch is removed.'}
          confirmLabel={isAdmin ? 'Delete' : 'Send request'} needReason={!isAdmin} danger
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            const r = await del<{ pending?: boolean }>(`/api/stretches/${id}`, { reason: reason || null })
            toast(r.pending ? 'Deletion requested. The Commissioner will review it.' : `${p.code} deleted.`)
            if (!r.pending) onClose()
          }} />
      )}
      {confirm && typeof confirm === 'object' && (
        <Confirm title={`Roll back ${p.code} to version ${confirm.revert}`} message="The stretch's status returns to that version. This is recorded as a new version; nothing is lost."
          confirmLabel="Roll back" onClose={() => setConfirm(null)}
          onConfirm={async () => { await post(`/api/stretches/${id}/revert`, { version: confirm.revert }); toast(`${p.code} rolled back to v${confirm.revert}.`) }} />
      )}
    </aside>
  )
}
