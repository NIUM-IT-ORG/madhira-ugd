import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Tag } from '../../../shared/status.ts'
import { compressPhoto, photoUrl } from '../lib/api'

export function Sheet({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <header>
          <h3>{title}</h3>
          <button className="icon" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  )
}

export function Seg<T extends string>({ value, options, onChange, small }: { value: T | null; options: readonly { v: T; label: string }[]; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className={`seg-wrap ${small ? 'small' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button type="button" key={o.v} role="radio" aria-checked={value === o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Stepper({ value, onChange, min = 0, max = 9999, suffix }: { value: number; onChange: (n: number) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Decrease">−</button>
      <input
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Math.max(min, Math.min(max, Math.round(Number(e.target.value)))))}
      />
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label="Increase">+</button>
      {suffix && <span className="suffix">{suffix}</span>}
    </div>
  )
}

export function NumberInput({ value, onChange, placeholder, suffix }: { value: number | null; onChange: (n: number | null) => void; placeholder?: string; suffix?: string }) {
  return (
    <div className="num-input">
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className={`toggle ${checked ? 'on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="knob" /></span>
      <span>{label}</span>
    </label>
  )
}

export function Tags({ tags, max }: { tags: Tag[]; max?: number }) {
  const shown = max ? tags.slice(0, max) : tags
  return (
    <div className="tags">
      {shown.map((t, i) => <span key={`${t.key}${i}`} className={`chip ${t.tone}`}>{t.text}</span>)}
      {max && tags.length > max && <span className="chip neutral">+{tags.length - max}</span>}
      {!tags.length && <span className="chip neutral">No work recorded yet</span>}
    </div>
  )
}

export function StageDot({ colour }: { colour: string }) {
  return <span className="stage-dot" style={{ background: colour }} />
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export interface Gps {
  lat: number
  lng: number
  accuracy: number | null
}

/** Device position while a form is open (field updates are checked against the stretch location). */
export function useGps(enabled = true) {
  const [gps, setGps] = useState<Gps | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled || !('geolocation' in navigator)) {
      if (enabled) setError('This device cannot share its location.')
      return
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGps({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) })
        setError(null)
      },
      (e) => setError(e.code === 1 ? 'Location permission denied. Allow it for this site.' : 'Location unavailable.'),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [enabled])
  return { gps, error }
}

export function GpsBadge({ gps, error }: { gps: Gps | null; error: string | null }) {
  if (gps) return <span className={`gps ${gps.accuracy && gps.accuracy > 50 ? 'weak' : 'ok'}`}>GPS ±{gps.accuracy ?? '?'} m</span>
  return <span className="gps none" title={error ?? ''}>{error ? 'No GPS' : 'Finding GPS…'}</span>
}

export interface PendingPhoto {
  key: string
  blob: Blob
  url: string
  taken_at: string
  gps: Gps | null
}

/** Camera / gallery picker. Photos are compressed on the phone and stamped with GPS and time. */
export function PhotoPicker({ photos, setPhotos, gps, required }: { photos: PendingPhoto[]; setPhotos: (p: PendingPhoto[]) => void; gps: Gps | null; required?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="photos">
      <div className="thumbs">
        {photos.map((p) => (
          <div key={p.key} className="thumb">
            <img src={p.url} alt="Site photo" />
            <button type="button" aria-label="Remove photo" onClick={() => setPhotos(photos.filter((x) => x.key !== p.key))}>×</button>
          </div>
        ))}
        <button type="button" className={`thumb add ${required && !photos.length ? 'need' : ''}`} onClick={() => input.current?.click()} disabled={busy || photos.length >= 6}>
          {busy ? '…' : '+ Photo'}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])].slice(0, 6 - photos.length)
          e.target.value = ''
          if (!files.length) return
          setBusy(true)
          const added: PendingPhoto[] = []
          for (const f of files) {
            const blob = await compressPhoto(f)
            added.push({ key: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), taken_at: new Date().toISOString(), gps })
          }
          setPhotos([...photos, ...added])
          setBusy(false)
        }}
      />
    </div>
  )
}

export function PhotoStrip({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!ids.length) return null
  return (
    <>
      <div className="thumbs small">
        {ids.map((id) => (
          <button key={id} type="button" className="thumb" onClick={() => setOpen(id)}>
            <img src={photoUrl(id)} alt="Site photo" loading="lazy" />
          </button>
        ))}
      </div>
      {open && (
        <div className="lightbox" onClick={() => setOpen(null)}>
          <img src={photoUrl(open)} alt="Site photo" />
        </div>
      )}
    </>
  )
}

export function Confirm({ title, message, confirmLabel, onConfirm, onClose, needReason, danger }: {
  title: string; message: ReactNode; confirmLabel: string; onConfirm: (reason: string) => Promise<void> | void; onClose: () => void; needReason?: boolean; danger?: boolean
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${danger ? 'danger' : 'primary'}`}
            disabled={busy || (needReason && !reason.trim())}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onConfirm(reason.trim())
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-msg">{message}</div>
      {needReason !== undefined && (
        <Field label={needReason ? 'Reason (required)' : 'Note (optional)'}>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      {error && <div className="form-error">{error}</div>}
    </Sheet>
  )
}

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'warn' | 'bad'; key: number } | null>(null)
  useEffect(() => {
    if (!msg) return
    const t = window.setTimeout(() => setMsg(null), msg.tone === 'ok' ? 3500 : 7000)
    return () => window.clearTimeout(t)
  }, [msg])
  const node = msg ? <div className={`toast ${msg.tone}`} key={msg.key} onClick={() => setMsg(null)}>{msg.text}</div> : null
  return { show: (text: string, tone: 'ok' | 'warn' | 'bad' = 'ok') => setMsg({ text, tone, key: Date.now() }), node }
}
