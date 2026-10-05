import { useMemo, useState } from 'react'
import { ApiError, patch, post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useData } from '../lib/store'
import type { LabourLog } from '../lib/types'
import { Field, Sheet, Stepper } from './ui'

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

/**
 * Labour and machines in a zone on a day: one entry per zone per day. New entry, or a correction of an existing one
 * (editable for 48 hours after saving; the AEE can correct field staff entries; the Commissioner always).
 */
export default function LabourForm({ entry, onClose, onDone, onOpen }: {
  entry?: LabourLog
  onClose: () => void
  onDone: (m: string) => void
  /** Called when the zone and day already have an entry: open that one instead. */
  onOpen?: (id: number) => void
}) {
  const { user } = useAuth()
  const { geo } = useData()
  // Zones with at least one of the user's wards (all four for the Commissioner and all-ward staff).
  const zones = useMemo(() => geo.zones.features.map((f) => f.properties)
    .filter((z) => user?.role === 'admin' || user?.all_wards || z.wards.some((w) => user?.wards.includes(w)))
    .sort((a, b) => a.zone - b.zone), [geo.zones, user])
  const [date, setDate] = useState(entry?.log_date ?? todayIST())
  const [zone, setZone] = useState<number>(entry?.zone ?? zones[0]?.zone ?? 1)
  const [labourers, setLabourers] = useState(entry?.labourers ?? 0)
  const [machines, setMachines] = useState(entry?.machines ?? 0)
  const [note, setNote] = useState(entry?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existing, setExisting] = useState<number | null>(null)
  const zoneName = (z: number) => geo.zones.features.find((f) => f.properties.zone === z)?.properties.name ?? `Zone ${z}`

  return (
    <Sheet title={entry ? `Correct labour · ${zoneName(entry.zone)} · ${entry.log_date}` : 'Log labour'} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !zones.length} onClick={async () => {
          setBusy(true)
          setError(null)
          setExisting(null)
          const body = { log_date: date, zone, labourers, machines, note: note.trim() || null }
          try {
            if (entry) await patch(`/api/labour/${entry.id}`, body)
            else await post('/api/labour', body)
            onDone(`Labour for ${zoneName(zone)} on ${date} ${entry ? 'corrected' : 'saved'}.`)
            onClose()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
            if (e instanceof ApiError && e.status === 409 && typeof e.data.id === 'number') setExisting(e.data.id)
          } finally {
            setBusy(false)
          }
        }}>{entry ? 'Save correction' : 'Save'}</button>
      </>
    }>
      {!zones.length && <div className="form-error">No wards are assigned to you yet.</div>}
      {entry && <p className="muted small">Entered by {entry.user_name ?? '—'}. {entry.editable ? `You can change it until ${new Date(entry.editable_until).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}.` : ''}</p>}
      <div className="row2">
        <Field label="Date"><input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Zone">
          <select value={zone} onChange={(e) => setZone(Number(e.target.value))}>
            {zones.map((z) => <option key={z.zone} value={z.zone}>{z.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="row2">
        <Field label="Labourers on site"><Stepper value={labourers} onChange={setLabourers} /></Field>
        <Field label="Machines (JCB, roller…)"><Stepper value={machines} onChange={setMachines} /></Field>
      </div>
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. contractor team B, wards 9 and 10" /></Field>
      {error && <div className="form-error">{error}</div>}
      {existing && onOpen && <button className="btn small" onClick={() => onOpen(existing)}>Open the existing entry</button>}
      {!entry && <p className="muted small">One entry per zone per day. You can correct your entry for 48 hours after saving.</p>}
    </Sheet>
  )
}
