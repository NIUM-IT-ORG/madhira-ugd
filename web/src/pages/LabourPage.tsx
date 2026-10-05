import { useCallback, useEffect, useMemo, useState } from 'react'
import LabourForm from '../components/LabourForm'
import { Confirm, Sheet, fmtDateTime } from '../components/ui'
import { del, get } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useSort } from '../lib/sort'
import { useData } from '../lib/store'
import type { LabourEvent, LabourLog } from '../lib/types'

const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const daysAgo = (n: number) => day(new Date(Date.now() - n * 86400000))
const FIELD_LABEL: Record<string, string> = { log_date: 'Date', zone: 'Zone', labourers: 'Labourers', machines: 'Machines', note: 'Note' }
/** 6 Oct (or 6 Oct 2025 for another year). */
const shortDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(d.slice(0, 4) !== day(new Date()).slice(0, 4) ? { year: 'numeric' } : {}) })
const until = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** Labour and machines per zone per day: table, totals, Excel, and corrections within 48 hours. */
export default function LabourPage({ toast }: { toast: (m: string, t?: 'ok' | 'warn' | 'bad') => void }) {
  const { user } = useAuth()
  const { geo, lastEvent } = useData()
  const [zone, setZone] = useState('')
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(day(new Date()))
  const [entries, setEntries] = useState<LabourLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<{ entry?: LabourLog } | null>(null)
  const [history, setHistory] = useState<{ entry: LabourLog; events: LabourEvent[] } | null>(null)
  const [deleting, setDeleting] = useState<LabourLog | null>(null)
  const canAdd = user?.role === 'admin' || user?.role === 'editor'
  const zoneName = (z: number) => geo.zones.features.find((f) => f.properties.zone === z)?.properties.name ?? `Zone ${z}`
  const query = new URLSearchParams(Object.entries({ zone, from, to }).filter(([, v]) => v)).toString()

  const load = useCallback(() => {
    setLoading(true)
    get<{ entries: LabourLog[] }>(`/api/labour?${query}`)
      .then((r) => { setEntries(r.entries); setError(null) })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [query])
  useEffect(() => { load() }, [load, lastEvent?.entity === 'labour' ? lastEvent.at : null])

  const openEntry = async (id: number) => {
    const r = await get<{ entry: LabourLog }>(`/api/labour/${id}`)
    setForm({ entry: r.entry })
  }
  const { sorted, Th } = useSort(entries, {
    date: (e) => e.log_date, zone: (e) => e.zone, labourers: (e) => e.labourers, machines: (e) => e.machines,
    note: (e) => e.note, by: (e) => e.user_name, changed: (e) => e.updated_at,
  }, { key: 'date', dir: 'desc' }, 'labour')

  const totals = useMemo(() => {
    const days = new Set(entries.map((e) => e.log_date)).size
    const lab = entries.reduce((a, e) => a + e.labourers, 0)
    const mac = entries.reduce((a, e) => a + e.machines, 0)
    return { days, lab, mac, avg: days ? Math.round(lab / days) : 0 }
  }, [entries])

  return (
    <div className="page">
      <div className="page-head">
        <h2>Labour</h2>
        <div className="kpis small">
          <div><b>{totals.avg.toLocaleString('en-IN')}</b><span>labourers / day</span></div>
          <div><b>{totals.lab.toLocaleString('en-IN')}</b><span>labour-days</span></div>
          <div><b>{totals.mac.toLocaleString('en-IN')}</b><span>machine-days</span></div>
          <div><b>{entries.length}</b><span>entries</span></div>
        </div>
        <p className="muted">Labour and machines on site, one entry per zone per day. Entries can be corrected for 48 hours after saving (the AEE can correct field staff entries); after that only the Commissioner can change them.</p>
      </div>
      <div className="filters">
        <select value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zone">
          <option value="">All zones</option>
          {[1, 2, 3, 4].map((z) => <option key={z} value={z}>{zoneName(z)}</option>)}
        </select>
        <label className="muted small" htmlFor="lfrom">From</label>
        <input id="lfrom" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} />
        <label className="muted small" htmlFor="lto">to</label>
        <input id="lto" type="date" value={to} min={from} max={day(new Date())} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} />
        <button className="fchip" onClick={() => { setFrom(daysAgo(6)); setTo(day(new Date())) }}>Last 7 days</button>
        <button className="fchip" onClick={() => { setFrom(daysAgo(29)); setTo(day(new Date())) }}>Last 30 days</button>
        <a className="btn small" href={`/api/export/labour.xlsx?${query}`} download>Download Excel</a>
        {canAdd && <button className="btn small primary" onClick={() => setForm({})}>+ Log labour</button>}
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <Th k="date">Date</Th><Th k="zone">Zone</Th><Th k="labourers" num>Labourers</Th><Th k="machines" num>Machines</Th>
              <Th k="note">Note</Th><Th k="by">Entered by</Th><Th k="changed">Last change</Th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{shortDay(e.log_date)}</td>
                <td>{zoneName(e.zone)}</td>
                <td className="num">{e.labourers}</td>
                <td className="num">{e.machines}</td>
                <td>{e.note ?? '—'}{e.legacy_wards?.length ? <div className="muted small">Recorded by ward before v1.2 (wards {e.legacy_wards.join(', ')})</div> : null}</td>
                <td>{e.user_name ?? '—'}{e.user_designation ? <div className="muted small">{e.user_designation}</div> : null}</td>
                <td>{e.updated_at ? <>{fmtDateTime(e.updated_at)}<div className="muted small">{e.updated_by_name}</div></> : '—'}</td>
                <td>{e.editable
                  ? (user?.role === 'admin' ? <span className="chip neutral">Editable</span> : <span className="chip good">Editable until {until(e.editable_until)}</span>)
                  : new Date(e.editable_until) < new Date()
                    ? <span className="chip neutral" title={e.locked_reason ?? ''}>🔒 Frozen</span>
                    : <span className="chip neutral" title={e.locked_reason ?? ''}>View only</span>}</td>
                <td className="row-actions">
                  {e.editable && <button className="btn small" onClick={() => setForm({ entry: e })}>Edit</button>}
                  <button className="btn small" onClick={async () => setHistory({ entry: e, events: (await get<{ events: LabourEvent[] }>(`/api/labour/${e.id}`)).events })}>History</button>
                  {e.editable && <button className="btn small danger-outline" onClick={() => setDeleting(e)}>Delete</button>}
                </td>
              </tr>
            ))}
            {!sorted.length && <tr><td colSpan={9} className="muted">{loading ? 'Loading…' : 'No labour entries in this period.'}</td></tr>}
          </tbody>
          {sorted.length > 0 && (
            <tfoot><tr className="total-row"><td colSpan={2}><b>Total</b></td><td className="num"><b>{totals.lab}</b></td><td className="num"><b>{totals.mac}</b></td><td colSpan={5} /></tr></tfoot>
          )}
        </table>
      </div>

      {form && (
        <LabourForm entry={form.entry} onClose={() => setForm(null)} onDone={(m) => { toast(m); load() }}
          onOpen={(id) => { setForm(null); openEntry(id).catch((e) => toast(String(e), 'bad')) }} />
      )}
      {history && (
        <Sheet title={`History · ${zoneName(history.entry.zone)} · ${history.entry.log_date}`} onClose={() => setHistory(null)} footer={<button className="btn" onClick={() => setHistory(null)}>Close</button>}>
          <ul className="timeline">
            {history.events.map((ev, i) => (
              <li key={i}>
                <b>{ev.action === 'create' ? 'Entered' : 'Corrected'}</b> · {ev.user_name ?? '—'} · {fmtDateTime(ev.at)}
                {ev.action !== 'create' && <ul>{ev.changes.map((c) => <li key={c.path}>{FIELD_LABEL[c.path] ?? c.path}: <s>{String(c.from ?? '—')}</s> → <b>{String(c.to ?? '—')}</b></li>)}</ul>}
              </li>
            ))}
            {!history.events.length && <li className="muted">Recorded before v1.2; no change history.</li>}
          </ul>
        </Sheet>
      )}
      {deleting && (
        <Confirm title="Delete this labour entry?" danger confirmLabel="Delete"
          message={`${zoneName(deleting.zone)} · ${deleting.log_date} · ${deleting.labourers} labourers, ${deleting.machines} machines`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await del(`/api/labour/${deleting.id}`); toast('Labour entry deleted.'); load() }} />
      )}
    </div>
  )
}
