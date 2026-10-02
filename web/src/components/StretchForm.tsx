import { useMemo, useState } from 'react'
import {
  OPTIONS, STAGE_COLOUR, checkStatus, defaultStatus, deriveStage, deriveTags, diffStatus, nextApproval, normaliseStatus, sewerCombo,
  type StretchStatus,
} from '../../../shared/status.ts'
import type { LineGeometry } from '../../../shared/geo.ts'
import { ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { submit } from '../lib/outbox'
import type { StretchFeature } from '../lib/types'
import { Field, GpsBadge, NumberInput, PhotoPicker, Seg, Sheet, StageDot, Stepper, Tags, Toggle, useGps, type PendingPhoto } from './ui'

export interface NewStretch {
  geometry: LineGeometry
  pipe_ids: string[]
  length_m: number
  planned_mh: number
  ward: number
}

interface Props {
  existing?: StretchFeature
  draft?: NewStretch
  onClose: () => void
  onSaved: (msg: string, tone?: 'ok' | 'warn') => void
}

function Bucket({ letter, title, items, children, open: initial = true }: { letter: string; title: string; items: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <section className={`bucket ${open ? 'open' : ''}`}>
      <button type="button" className="bucket-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="bucket-letter">{letter}</span>
        <span className="bucket-title">{title}</span>
        <span className="bucket-items">{items}</span>
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="bucket-body">{children}</div>}
    </section>
  )
}

export default function StretchForm({ existing, draft, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const original = useMemo(() => normaliseStatus(existing?.properties.status ?? defaultStatus()), [existing])
  const [s, setS] = useState<StretchStatus>(original)
  const [name, setName] = useState(existing?.properties.name ?? '')
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<PendingPhoto[]>([])
  const { gps, error: gpsError } = useGps(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  const length = existing?.properties.length_m ?? draft?.length_m ?? 0
  const planned = existing?.properties.planned_mh ?? draft?.planned_mh ?? 0
  const approvalBefore = existing?.properties.approval ?? 'none'
  const approval = nextApproval(approvalBefore, s)
  const stage = deriveStage(s, approval)
  const tags = deriveTags(s, approval, planned)
  const check = checkStatus(s, { length_m: length, planned_mh: planned, has_photo: photos.length > 0, previous: existing ? original : undefined })
  const diff = diffStatus(original, s)
  const nameChanged = (existing?.properties.name ?? '') !== name
  const nothing = existing && !diff.length && !nameChanged && !note.trim() && !photos.length

  const set = <K extends keyof StretchStatus>(k: K, v: Partial<StretchStatus[K]> | StretchStatus[K]) =>
    setS((x) => ({ ...x, [k]: typeof v === 'object' && v !== null ? { ...(x[k] as object), ...v } : v }))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const photoItems = photos.map((p) => ({ blob: p.blob, meta: { lat: p.gps?.lat, lng: p.gps?.lng, accuracy: p.gps?.accuracy, taken_at: p.taken_at } }))
      const gpsBody = gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null
      const label = existing ? `Update ${existing.properties.code}` : `New stretch in ward ${draft?.ward}`
      const r = existing
        ? await submit<{ version: number; far: boolean; distance: number | null; warnings: string[] }>({
            label, method: 'PATCH', url: `/api/stretches/${existing.id}`, photos: photoItems,
            body: { base_version: existing.properties.version, changes: diff.map((c) => ({ path: c.path, to: c.to })), name: nameChanged ? name : undefined, note: note.trim() || null, gps: gpsBody },
          })
        : await submit<{ code: string; record_state: string; far: boolean; distance: number | null }>({
            label, method: 'POST', url: '/api/stretches', photos: photoItems,
            body: { name: name.trim() || null, geometry: draft!.geometry, pipe_ids: draft!.pipe_ids, status: s, note: note.trim() || null, gps: gpsBody },
          })
      if (r.queued) {
        onSaved('No connection: saved on this phone. It will be sent automatically when the signal returns.', 'warn')
      } else {
        const res = r.result as { code?: string; record_state?: string; far?: boolean; distance?: number | null }
        const far = res.far ? ` Note: you were ${res.distance} m from the stretch, so this update is flagged.` : ''
        if (!existing && res.record_state === 'proposed') onSaved(`Stretch ${res.code} added. It shows as proposed until the Commissioner approves it.${far}`, res.far ? 'warn' : 'ok')
        else onSaved(existing ? `${existing.properties.code} updated.${far}` : `Stretch ${res.code} added.${far}`, res.far ? 'warn' : 'ok')
      }
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const tapsOpen = Math.max(0, s.utilities.taps_broken - s.utilities.taps_restored)
  const title = existing ? <>Update {existing.properties.code}{existing.properties.name ? ` · ${existing.properties.name}` : ''}</> : 'New road stretch'

  return (
    <Sheet
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <GpsBadge gps={gps} error={gpsError} />
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${check.warnings.length ? 'warn' : 'primary'}`} disabled={busy || check.errors.length > 0 || !!nothing || conflict} onClick={save}>
            {busy ? 'Saving…' : check.warnings.length ? 'Save anyway' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-summary">
        <div className="stage-line">
          <StageDot colour={STAGE_COLOUR[stage]} />
          <b>{Math.round(length)} m</b>
          <span className="muted">· ward {existing?.properties.ward ?? draft?.ward} · {planned} manholes on plan</span>
        </div>
        <Tags tags={tags} />
      </div>

      <Field label="Road name (optional)">
        <input type="text" value={name} maxLength={160} placeholder="e.g. Station Road, near bus stand" onChange={(e) => setName(e.target.value)} />
      </Field>

      <Bucket letter="A" title="Sewer work" items="items 1–5">
        <Field label="Pipeline">
          <Seg value={s.sewer.pipeline} options={OPTIONS.pipeline} onChange={(v) => set('sewer', { pipeline: v, pipe_laid_m: v === 'partial' ? s.sewer.pipe_laid_m : null })} />
        </Field>
        {s.sewer.pipeline === 'partial' && (
          <Field label="Pipe laid so far">
            <NumberInput value={s.sewer.pipe_laid_m} onChange={(v) => set('sewer', { pipe_laid_m: v })} suffix={`m of ${Math.round(length)} m`} />
          </Field>
        )}
        <div className="row2">
          <Field label="Manholes built" hint={planned ? `${planned} on the plan for this stretch` : undefined}>
            <Stepper value={s.sewer.manholes_built} onChange={(v) => set('sewer', { manholes_built: v })} />
          </Field>
          <Field label="Inspection chambers built">
            <Stepper value={s.sewer.ics_built} onChange={(v) => set('sewer', { ics_built: v })} />
          </Field>
        </div>
        <div className="combo">Combination: <b>{sewerCombo(s, planned)}</b></div>
      </Bucket>

      <Bucket letter="B" title="Road cutting and trench" items="items 6–8">
        <Field label="Stage">
          <Seg value={s.excavation.stage} options={OPTIONS.excavation} onChange={(v) => set('excavation', { stage: v })} />
        </Field>
        {s.excavation.stage !== 'none' && (
          <Field label="Length of road cut (optional)">
            <NumberInput value={s.excavation.cut_length_m} onChange={(v) => set('excavation', { cut_length_m: v })} suffix="m" />
          </Field>
        )}
      </Bucket>

      <Bucket letter="C" title="CC road restoration" items="items 9–12">
        <Field label="Restoration" hint={s.restoration.stage === 'restored_curing_done' ? (approval === 'approved' ? 'Approved by the Commissioner (green).' : 'Goes to the Commissioner for approval; turns green when approved.') : undefined}>
          <Seg value={s.restoration.stage} options={OPTIONS.restoration} onChange={(v) => set('restoration', { stage: v })} />
        </Field>
      </Bucket>

      <Bucket letter="D" title="Motorability" items="item 13">
        <Seg value={s.motorable} options={OPTIONS.motorable} onChange={(v) => set('motorable', v)} />
      </Bucket>

      <Bucket letter="E" title="Utilities damage" items="items 14–16">
        <div className="row2">
          <Field label="Tap connections broken">
            <Stepper value={s.utilities.taps_broken} onChange={(v) => set('utilities', { taps_broken: v, taps_restored: Math.min(s.utilities.taps_restored, v) })} />
          </Field>
          <Field label="Tap connections restored" hint={tapsOpen ? `${tapsOpen} still pending` : undefined}>
            <Stepper value={s.utilities.taps_restored} max={s.utilities.taps_broken} onChange={(v) => set('utilities', { taps_restored: v })} />
          </Field>
        </div>
        <Field label="Water pipe leakages">
          <Stepper value={s.utilities.water_leaks} onChange={(v) => set('utilities', { water_leaks: v })} />
        </Field>
        <Toggle checked={s.utilities.drain_clogged} onChange={(v) => set('utilities', { drain_clogged: v })} label="Drain clogged with gravel" />
      </Bucket>

      <Bucket letter="F" title="Public hazards" items="items 17–18">
        <Toggle checked={s.hazards.water_stagnation} onChange={(v) => set('hazards', { water_stagnation: v })} label="Water stagnation" />
        <Field label="Potholes in the trench">
          <Stepper value={s.hazards.potholes} onChange={(v) => set('hazards', { potholes: v })} />
        </Field>
        <Toggle checked={s.hazards.uneven_backfill} onChange={(v) => set('hazards', { uneven_backfill: v })} label="Uneven back-fill" />
      </Bucket>

      <Field label="Photos" hint="Needed for restoration claims and newly reported damage. Each photo keeps its GPS position and time.">
        <PhotoPicker photos={photos} setPhotos={setPhotos} gps={gps} required={check.errors.some((e) => e.startsWith('Attach a photo'))} />
      </Field>
      <Field label="Note (optional)">
        <textarea rows={2} value={note} maxLength={2000} placeholder="What you saw on site" onChange={(e) => setNote(e.target.value)} />
      </Field>

      {check.errors.map((e) => <div key={e} className="form-error">{e}</div>)}
      {check.warnings.map((w) => <div key={w} className="form-warn">{w}</div>)}
      {error && <div className="form-error">{error}{conflict && ' Close this form and open the stretch again to see the latest values.'}</div>}
      {!existing && user?.role !== 'admin' && <div className="note">New stretches show as proposed until the Commissioner approves them. You can record status straight away.</div>}
      {nothing && <div className="note">Change something, add a photo or write a note to save.</div>}
    </Sheet>
  )
}
