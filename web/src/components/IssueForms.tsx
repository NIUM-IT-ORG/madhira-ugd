import { useEffect, useState } from 'react'
import { ISSUE_KINDS, issueLabel } from '../../../shared/status.ts'
import { get } from '../lib/api'
import { canEditWard, useAuth } from '../lib/auth'
import { submit } from '../lib/outbox'
import { useData } from '../lib/store'
import type { Issue, IssueEvent, Selection } from '../lib/types'
import { Field, GpsBadge, PhotoPicker, PhotoStrip, Seg, Sheet, Stepper, fmtDateTime, timeAgo, useGps, type PendingPhoto } from './ui'

const SEVERITY = [{ v: 'low', label: 'Low' }, { v: 'medium', label: 'Medium' }, { v: 'high', label: 'High' }] as const
const photoItems = (photos: PendingPhoto[]) =>
  photos.map((p) => ({ blob: p.blob, meta: { lat: p.gps?.lat, lng: p.gps?.lng, accuracy: p.gps?.accuracy, taken_at: p.taken_at } }))

export function IssueForm({ point, stretch, onClose, onDone }: { point: [number, number]; stretch?: { id: string; code: string }; onClose: () => void; onDone: (m: string, t?: 'ok' | 'warn') => void }) {
  const [kind, setKind] = useState<string>('drain_clogged')
  const [count, setCount] = useState(1)
  const [severity, setSeverity] = useState<string>(ISSUE_KINDS.find((k) => k.key === 'drain_clogged')!.severity)
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<PendingPhoto[]>([])
  const { gps, error: gpsError } = useGps(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet title={`Report issue${stretch ? ` on ${stretch.code}` : ''}`} onClose={onClose} footer={
      <>
        <GpsBadge gps={gps} error={gpsError} />
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !photos.length} onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            const r = await submit<{ code: string }>({
              label: `Issue: ${issueLabel(kind)}`, method: 'POST', url: '/api/issues', photos: photoItems(photos),
              body: { kind, location: point, stretch_id: stretch?.id ?? null, count, severity, description: description.trim() || null },
            })
            onDone(r.queued ? 'No connection: issue saved on this phone and will be sent later.' : `Issue ${(r.result as { code: string }).code} reported.`, r.queued ? 'warn' : 'ok')
            onClose()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          } finally {
            setBusy(false)
          }
        }}>{busy ? 'Sending…' : 'Report'}</button>
      </>
    }>
      <Field label="What is the problem?">
        <select value={kind} onChange={(e) => { setKind(e.target.value); setSeverity(ISSUE_KINDS.find((k) => k.key === e.target.value)?.severity ?? 'medium') }}>
          {ISSUE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
      </Field>
      <div className="row2">
        <Field label="How many?"><Stepper value={count} min={1} onChange={setCount} /></Field>
        <Field label="Severity"><Seg small value={severity} options={SEVERITY} onChange={setSeverity} /></Field>
      </div>
      <Field label="Description (optional)"><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. gravel dumped in the side drain opposite the school" /></Field>
      <Field label="Photo (required)"><PhotoPicker photos={photos} setPhotos={setPhotos} gps={gps} required /></Field>
      {error && <div className="form-error">{error}</div>}
    </Sheet>
  )
}

export function IssueDetail({ id, onClose, onSelect, toast }: { id: string; onClose: () => void; onSelect: (s: Selection) => void; toast: (m: string, t?: 'ok' | 'warn' | 'bad') => void }) {
  const { user } = useAuth()
  const { issues } = useData()
  const issue = issues.find((i) => i.id === id)
  const [events, setEvents] = useState<IssueEvent[]>([])
  const [mode, setMode] = useState<null | 'assign' | 'resolve' | 'reopen'>(null)
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<PendingPhoto[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { gps } = useGps(mode === 'resolve')

  useEffect(() => {
    get<{ issue: Issue; events: IssueEvent[] }>(`/api/issues/${id}`).then((r) => setEvents(r.events)).catch(() => setEvents([]))
  }, [id, issue?.updated_at])
  useEffect(() => {
    setAssignee(issue?.assigned_to ?? '')
    setDue(issue?.due_date ? String(issue.due_date).slice(0, 10) : '')
  }, [issue?.assigned_to, issue?.due_date])
  if (!issue) return null
  const editable = canEditWard(user, issue.ward)
  const overdue = issue.due_date && issue.status !== 'resolved' && new Date(issue.due_date) < new Date()

  async function save(body: Record<string, unknown>, msg: string) {
    setBusy(true)
    setError(null)
    try {
      const r = await submit({ label: `Issue ${issue!.code}`, method: 'PATCH', url: `/api/issues/${id}`, body, photos: photoItems(photos) })
      toast(r.queued ? 'No connection: saved on this phone.' : msg, r.queued ? 'warn' : 'ok')
      setMode(null)
      setNote('')
      setPhotos([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="panel detail">
      <header>
        <div>
          <h3>{issue.code} · {issueLabel(issue.kind)}{issue.count > 1 ? ` × ${issue.count}` : ''}</h3>
          <div className="small">
            <span className={`chip ${issue.status === 'resolved' ? 'good' : issue.severity === 'high' ? 'bad' : 'warn'}`}>{issue.status}</span>{' '}
            <span className="muted">{issue.severity} severity · ward {issue.ward ?? '?'}</span>
            {overdue && <span className="chip bad">Overdue</span>}
          </div>
        </div>
        <button className="icon" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="panel-body">
        {issue.stretch_code && (
          <div className="kv"><span className="k">Stretch</span><span className="v"><button className="link" onClick={() => onSelect({ kind: 'stretch', id: issue.stretch_id! })}>{issue.stretch_code}{issue.stretch_name ? ` · ${issue.stretch_name}` : ''}</button></span></div>
        )}
        <div className="kv"><span className="k">Reported</span><span className="v">{issue.reported_by_name ?? '—'} · {timeAgo(issue.reported_at)}</span></div>
        {issue.assigned_to && <div className="kv"><span className="k">Assigned to</span><span className="v">{issue.assigned_to}{issue.due_date ? ` · due ${String(issue.due_date).slice(0, 10)}` : ''}</span></div>}
        {issue.description && <div className="tl-note">{issue.description}</div>}
        <PhotoStrip ids={issue.photos} />
        {issue.status === 'resolved' && <div className="callout good">Resolved by {issue.resolved_by_name} · {issue.resolved_at && fmtDateTime(issue.resolved_at)}: {issue.resolution_note}</div>}

        {editable && !mode && (
          <div className="actions">
            {issue.status !== 'resolved' && <button className="btn" onClick={() => setMode('assign')}>Assign</button>}
            {issue.status !== 'resolved' && <button className="btn primary" onClick={() => setMode('resolve')}>Mark resolved</button>}
            {issue.status === 'resolved' && <button className="btn" onClick={() => setMode('reopen')}>Re-open</button>}
          </div>
        )}
        {mode === 'assign' && (
          <div className="inline-form">
            <Field label="Assign to (person or contractor)"><input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="e.g. Contractor site engineer" /></Field>
            <Field label="Due date"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label="Note (optional)"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="btn-row">
              <button className="btn" onClick={() => setMode(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || !assignee.trim()} onClick={() => save({ status: 'assigned', assigned_to: assignee.trim(), due_date: due || null, note: note.trim() || null }, `${issue.code} assigned.`)}>Assign</button>
            </div>
          </div>
        )}
        {(mode === 'resolve' || mode === 'reopen') && (
          <div className="inline-form">
            <Field label={mode === 'resolve' ? 'How was it fixed? (required)' : 'Why re-open? (required)'}><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {mode === 'resolve' && <Field label="Photo of the fix (recommended)"><PhotoPicker photos={photos} setPhotos={setPhotos} gps={gps} /></Field>}
            {mode === 'resolve' && issue.source === 'stretch' && <div className="note">This also clears the item on stretch {issue.stretch_code}.</div>}
            <div className="btn-row">
              <button className="btn" onClick={() => setMode(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || !note.trim()} onClick={() => save({ status: mode === 'resolve' ? 'resolved' : 'open', note: note.trim() }, mode === 'resolve' ? `${issue.code} resolved.` : `${issue.code} re-opened.`)}>{mode === 'resolve' ? 'Resolve' : 'Re-open'}</button>
            </div>
          </div>
        )}
        {error && <div className="form-error">{error}</div>}

        <h4>History</h4>
        <ol className="timeline compact">
          {events.map((e) => (
            <li key={e.id}><b>{e.action}</b> · {e.user_name ?? '—'} · {fmtDateTime(e.at)}{e.note ? ` · “${e.note}”` : ''}</li>
          ))}
        </ol>
      </div>
    </aside>
  )
}
