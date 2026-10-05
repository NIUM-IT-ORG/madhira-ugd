import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sheet, fmtDateTime } from '../components/ui'
import { ApiError, get, post } from '../lib/api'

interface Category { key: string; label: string; hint: string }
interface Part { rows: number; bytes: number; detail?: string }
interface Usage {
  categories: Category[]
  db_bytes: number | null
  photos: { count: number; bytes: number; by_month: { month: string; count: number; bytes: number }[] }
  rows: Record<string, number>
  disk: { free: number; total: number } | null
  purges: { id: number; at: string; before_date: string; categories: string[]; summary: Record<string, Part>; bytes_freed: number; user_name: string | null }[]
}

export const fmtBytes = (b: number | null | undefined) => {
  if (b == null) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`
  return `${(b / 1073741824).toFixed(2)} GB`
}
const isoDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const monthsAgo = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return isoDay(d) }
const tomorrow = () => isoDay(new Date(Date.now() + 86400000))
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })

const PRESETS = [
  { label: 'Older than 1 year', date: () => monthsAgo(12) },
  { label: 'Older than 6 months', date: () => monthsAgo(6) },
  { label: 'Older than 3 months', date: () => monthsAgo(3) },
  { label: 'Everything up to today', date: tomorrow },
]
const EXTRA_LABELS: Record<string, string> = { unused_photos: 'Photos no longer used' }

export default function StoragePage({ toast }: { toast: (m: string, t?: 'ok' | 'warn' | 'bad') => void }) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [before, setBefore] = useState(() => monthsAgo(12))
  const [cats, setCats] = useState<string[]>(['photos'])
  // The preview remembers what it was computed for; Delete sends exactly that.
  const [preview, setPreview] = useState<{ summary: Record<string, Part>; bytes: number; cats: string[]; before: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => get<Usage>('/api/admin/storage').then(setUsage).catch((e) => setError(String(e))), [])
  useEffect(() => { load() }, [load])

  // Preview (a dry run on the server) whenever the choice changes.
  useEffect(() => {
    setPreview(null)
    if (!cats.length || !before) return
    let alive = true // a slower, older preview must not replace a newer one
    const t = window.setTimeout(() => {
      setChecking(true)
      post<{ summary: Record<string, Part>; bytes: number }>('/api/admin/storage/preview', { categories: cats, before })
        .then((r) => { if (alive) setPreview({ ...r, cats, before }) })
        .catch((e) => { if (alive) setError(e instanceof ApiError ? e.message : String(e)) })
        .finally(() => { if (alive) setChecking(false) })
    }, 350)
    return () => { alive = false; window.clearTimeout(t) }
  }, [cats, before])

  const total = preview ? Object.values(preview.summary).reduce((a, p) => a + p.rows, 0) : 0
  const archiveUrl = `/api/admin/storage/archive?categories=${cats.join(',')}&before=${before}`
  const maxMonth = useMemo(() => Math.max(1, ...(usage?.photos.by_month ?? []).map((m) => m.bytes)), [usage])
  const labelOf = (k: string) => usage?.categories.find((c) => c.key === k)?.label ?? EXTRA_LABELS[k] ?? k
  if (!usage) return <div className="page"><h2>Storage</h2>{error ? <div className="form-error">{error}</div> : <p className="muted">Loading…</p>}</div>

  return (
    <div className="page">
      <div className="page-head">
        <h2>Storage</h2>
        <div className="kpis small">
          <div><b>{fmtBytes(usage.photos.bytes)}</b><span>{usage.photos.count.toLocaleString('en-IN')} photos</span></div>
          <div><b>{fmtBytes(usage.db_bytes)}</b><span>database</span></div>
          {usage.disk && <div className={usage.disk.free < usage.disk.total * 0.1 ? 'bad' : ''}><b>{fmtBytes(usage.disk.free)}</b><span>free of {fmtBytes(usage.disk.total)} on the server</span></div>}
        </div>
        <p className="muted">Photos take almost all the space. Delete old data here to stay within your cloud plan. Download an archive first if you may need it again.</p>
      </div>

      <section className="card-section">
        <h3>Delete old data</h3>
        <div className="storage-form">
          <div className="filters">
            <label className="muted small" htmlFor="before">Delete everything before</label>
            <input id="before" type="date" value={before} max={tomorrow()} onChange={(e) => setBefore(e.target.value)} style={{ width: 'auto' }} />
            {PRESETS.map((p) => <button key={p.label} className={`fchip ${before === p.date() ? 'on' : ''}`} onClick={() => setBefore(p.date())}>{p.label}</button>)}
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th style={{ width: 32 }}></th><th>What</th><th className="num">Will delete</th></tr></thead>
              <tbody>
                {usage.categories.map((c) => {
                  const p = preview?.summary[c.key]
                  return (
                    <tr key={c.key} className="clickable" onClick={() => setCats((x) => (x.includes(c.key) ? x.filter((k) => k !== c.key) : [...x, c.key]))}>
                      <td><input type="checkbox" checked={cats.includes(c.key)} readOnly aria-label={c.label} /></td>
                      <td><b>{c.label}</b><div className="muted small">{c.hint}</div></td>
                      <td className="num">{!cats.includes(c.key) ? '' : checking || !preview ? '…' : `${(p?.rows ?? 0).toLocaleString('en-IN')}${p?.bytes ? ` · ${fmtBytes(p.bytes)}` : ''}`}{p?.detail ? <div className="muted small">{p.detail}</div> : null}</td>
                    </tr>
                  )
                })}
                {preview?.summary.unused_photos && (
                  <tr><td></td><td><b>{EXTRA_LABELS.unused_photos}</b><div className="muted small">Photos of the records above, deleted with them.</div></td>
                    <td className="num">{preview.summary.unused_photos.rows} · {fmtBytes(preview.summary.unused_photos.bytes)}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <span className="muted small">{preview ? `${total.toLocaleString('en-IN')} records${preview.bytes ? ` · frees ${fmtBytes(preview.bytes)} of photos` : ''}` : cats.length ? 'Checking…' : 'Choose what to delete.'}</span>
            <span className="spacer" />
            <a className={`btn ${!cats.length || !total ? 'disabled' : ''}`} href={archiveUrl} download aria-disabled={!cats.length || !total}>Download archive first</a>
            <button className="btn danger" disabled={!preview || !total} onClick={() => setConfirming(true)}>Delete…</button>
          </div>
          {error && <div className="form-error">{error}</div>}
          <p className="muted small">Deleted data stays in the server's nightly backups for 30 days, then it is gone for good. The map's network (approved manholes and pipes) and the current status of every stretch are never deleted here. Freed database space is reused for new records, so the database figure may not drop at once.</p>
        </div>
      </section>

      <section className="card-section">
        <h3>Photos by month of upload</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Month</th><th className="num">Photos</th><th className="num">Size</th><th style={{ width: '40%' }}></th></tr></thead>
            <tbody>
              {usage.photos.by_month.map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month)}</td><td className="num">{m.count.toLocaleString('en-IN')}</td><td className="num">{fmtBytes(m.bytes)}</td>
                  <td><div className="size-bar" style={{ width: `${Math.max(1, (m.bytes / maxMonth) * 100)}%` }} /></td>
                </tr>
              ))}
              {!usage.photos.by_month.length && <tr><td colSpan={4} className="muted">No photos yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card-section">
        <h3>Clean-up log</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>When</th><th>By</th><th>Before</th><th>Deleted</th><th className="num">Photos freed</th></tr></thead>
            <tbody>
              {usage.purges.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDateTime(p.at)}</td><td>{p.user_name ?? '—'}</td><td>{p.before_date}</td>
                  <td>{Object.entries(p.summary).filter(([, s]) => s.rows).map(([k, s]) => `${labelOf(k)}: ${s.rows}`).join(' · ') || 'Nothing'}</td>
                  <td className="num">{fmtBytes(p.bytes_freed)}</td>
                </tr>
              ))}
              {!usage.purges.length && <tr><td colSpan={5} className="muted">No clean-ups yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {confirming && preview && (
        <ConfirmDelete
          lines={Object.entries(preview.summary).filter(([, s]) => s.rows).map(([k, s]) => `${labelOf(k)}: ${s.rows.toLocaleString('en-IN')}${s.bytes ? ` (${fmtBytes(s.bytes)})` : ''}`)}
          before={preview.before}
          onClose={() => setConfirming(false)}
          onDelete={async () => {
            const r = await post<{ bytes_freed: number }>('/api/admin/storage/purge', { categories: preview.cats, before: preview.before, confirm: 'DELETE' })
            toast(`Deleted. ${r.bytes_freed ? `${fmtBytes(r.bytes_freed)} of photos freed.` : ''}`)
            setPreview(null)
            setCats((x) => [...x])
            await load()
          }}
        />
      )}
    </div>
  )
}

function ConfirmDelete({ lines, before, onClose, onDelete }: { lines: string[]; before: string; onClose: () => void; onDelete: () => Promise<void> }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet title="Delete for good?" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={busy || typed.trim() !== 'DELETE'} onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await onDelete()
            onClose()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          } finally {
            setBusy(false)
          }
        }}>{busy ? 'Deleting…' : 'Delete'}</button>
      </>
    }>
      <p>Everything before <b>{before}</b>:</p>
      <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
      <p className="muted small">This cannot be undone in the app. Download the archive first if you may need it.</p>
      <label className="muted small" htmlFor="typed">Type DELETE to confirm</label>
      <input id="typed" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      {error && <div className="form-error">{error}</div>}
    </Sheet>
  )
}
