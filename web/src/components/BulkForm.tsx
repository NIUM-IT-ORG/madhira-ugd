import { useState } from 'react'
import { OPTIONS, RESTORATION_GENERIC } from '../../../shared/status.ts'
import { post } from '../lib/api'
import { Field, GpsBadge, Seg, Sheet, useGps } from './ui'

type Choice = { path: string; to: string | number | boolean }

const KEEP = { v: '__keep', label: 'Leave unchanged' } as const
const withKeep = <T extends string>(o: readonly { v: T; label: string }[]) => [KEEP, ...o] as { v: string; label: string }[]

interface Result { id: string; ok: boolean; code?: string; error?: string }

export default function BulkForm({ ids, codes, onClose, onSaved }: { ids: string[]; codes: string[]; onClose: () => void; onSaved: (m: string, tone?: 'ok' | 'warn') => void }) {
  const [pipeline, setPipeline] = useState<string>('__keep')
  const [excavation, setExcavation] = useState<string>('__keep')
  const [restoration, setRestoration] = useState<string>('__keep')
  const [surface, setSurface] = useState<string>('__keep')
  const [motorable, setMotorable] = useState<string>('__keep')
  const [drain, setDrain] = useState<string>('__keep')
  const [stagnation, setStagnation] = useState<string>('__keep')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Result[] | null>(null)
  const { gps, error: gpsError } = useGps(true)

  const changes: Choice[] = [
    pipeline !== '__keep' && { path: 'sewer.pipeline', to: pipeline },
    excavation !== '__keep' && { path: 'excavation.stage', to: excavation },
    surface !== '__keep' && { path: 'restoration.surface', to: surface },
    restoration !== '__keep' && { path: 'restoration.stage', to: restoration },
    motorable !== '__keep' && { path: 'motorable', to: motorable },
    drain !== '__keep' && { path: 'utilities.drain_clogged', to: drain === 'yes' },
    stagnation !== '__keep' && { path: 'hazards.water_stagnation', to: stagnation === 'yes' },
  ].filter(Boolean) as Choice[]
  const needsPhotoNote = restoration.startsWith('restored')
  const yesNo = [KEEP, { v: 'yes', label: 'Yes' }, { v: 'no', label: 'No' }]

  return (
    <Sheet
      title={`Bulk update · ${ids.length} stretch${ids.length > 1 ? 'es' : ''}`}
      onClose={onClose}
      wide
      footer={
        results ? (
          <button className="btn primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <GpsBadge gps={gps} error={gpsError} />
            <span className="spacer" />
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy || !changes.length} onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                const r = await post<{ results: Result[] }>('/api/stretches/bulk', { ids, changes, note: note.trim() || null, gps: gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null })
                setResults(r.results)
                const okN = r.results.filter((x) => x.ok).length
                onSaved(`${okN} of ${ids.length} stretches updated.`, okN === ids.length ? 'ok' : 'warn')
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setBusy(false)
              }
            }}>
              {busy ? 'Saving…' : `Apply to ${ids.length}`}
            </button>
          </>
        )
      }
    >
      {results ? (
        <ul className="plain results-list">
          {results.map((r, i) => (
            <li key={r.id} className={r.ok ? 'ok' : 'bad'}>{r.code ?? codes[i]}: {r.ok ? 'updated' : r.error}</li>
          ))}
        </ul>
      ) : (
        <>
          <p className="muted">Stretches: {codes.join(', ')}. Only the fields you set are changed; each stretch gets its own history entry.</p>
          <Field label="A · Pipeline"><Seg small value={pipeline} options={withKeep(OPTIONS.pipeline)} onChange={setPipeline} /></Field>
          <Field label="B · Road cutting"><Seg small value={excavation} options={withKeep(OPTIONS.excavation)} onChange={setExcavation} /></Field>
          <Field label="C · Road type"><Seg small value={surface} options={withKeep(OPTIONS.surface)} onChange={setSurface} /></Field>
          <Field label="C · Road restoration"><Seg small value={restoration} options={withKeep(RESTORATION_GENERIC)} onChange={setRestoration} /></Field>
          <Field label="D · Motorability"><Seg small value={motorable} options={withKeep(OPTIONS.motorable)} onChange={setMotorable} /></Field>
          <Field label="E · Drain clogged with gravel"><Seg small value={drain} options={yesNo} onChange={setDrain} /></Field>
          <Field label="F · Water stagnation"><Seg small value={stagnation} options={yesNo} onChange={setStagnation} /></Field>
          <Field label="Note (optional)"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {needsPhotoNote && <div className="form-warn">Marking a road restored needs a photo of each road, so record restoration one stretch at a time. In a bulk update it will be refused.</div>}
          {error && <div className="form-error">{error}</div>}
        </>
      )}
    </Sheet>
  )
}
