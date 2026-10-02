import { useState } from 'react'
import { post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Field, Sheet, Stepper } from './ui'

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

/** Labour deployed in a ward on a day (a second entry for the same ward and day replaces the first). */
export default function LabourForm({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const { user } = useAuth()
  const wards = user?.role === 'admin' || user?.all_wards ? Array.from({ length: 22 }, (_, i) => i + 1) : user?.wards ?? []
  const [date, setDate] = useState(todayIST())
  const [ward, setWard] = useState<number>(wards[0] ?? 1)
  const [labourers, setLabourers] = useState(0)
  const [machines, setMachines] = useState(0)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet title="Log labour" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !wards.length} onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await post('/api/labour', { log_date: date, ward, labourers, machines, note: note.trim() || null })
            onDone(`Labour for ward ${ward} on ${date} saved.`)
            onClose()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          } finally {
            setBusy(false)
          }
        }}>Save</button>
      </>
    }>
      {!wards.length && <div className="form-error">No wards are assigned to you yet.</div>}
      <div className="row2">
        <Field label="Date"><input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Ward">
          <select value={ward} onChange={(e) => setWard(Number(e.target.value))}>
            {wards.map((w) => <option key={w} value={w}>Ward {w}</option>)}
          </select>
        </Field>
      </div>
      <div className="row2">
        <Field label="Labourers on site"><Stepper value={labourers} onChange={setLabourers} /></Field>
        <Field label="Machines (JCB, roller…)"><Stepper value={machines} onChange={setMachines} /></Field>
      </div>
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. contractor team B" /></Field>
      {error && <div className="form-error">{error}</div>}
    </Sheet>
  )
}
