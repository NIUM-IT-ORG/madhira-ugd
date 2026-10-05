import { useState } from 'react'
import { isMine, removeItem, retryItem, type OutboxItem } from '../lib/outbox'
import { Sheet, fmtDateTime } from './ui'

/** Saves kept on this phone: waiting for signal, or refused by the server with the reason. */
export default function OutboxSheet({ items, onFlush, onClose }: { items: OutboxItem[]; onFlush: () => Promise<number>; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const waiting = items.filter((i) => !i.error && isMine(i))
  const refused = items.filter((i) => i.error && isMine(i))
  const others = items.filter((i) => !isMine(i))
  return (
    <Sheet title="Saved on this phone" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Close</button>
        {waiting.length > 0 && <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onFlush().catch(() => 0).finally(() => setBusy(false)) }}>{busy ? 'Sending…' : 'Send now'}</button>}
      </>
    }>
      {waiting.length > 0 && (
        <>
          <h4>Waiting for signal ({waiting.length})</h4>
          <p className="muted small">These are sent automatically when the phone is back online. Do not clear the browser's data or sign out until they are sent.</p>
          <ul className="outbox-list">{waiting.map((i) => <li key={i.id}><b>{i.label}</b><span className="muted small">{fmtDateTime(i.created)}{i.photos.length ? ` · ${i.photos.length} photo${i.photos.length > 1 ? 's' : ''}` : ''}</span></li>)}</ul>
        </>
      )}
      {refused.length > 0 && (
        <>
          <h4>Not accepted by the server ({refused.length})</h4>
          <p className="muted small">Read the reason. If someone else changed the road meanwhile, open it on the map, check the latest values and record your change again, then discard this copy.</p>
          <ul className="outbox-list">
            {refused.map((i) => (
              <li key={i.id}>
                <b>{i.label}</b>
                <span className="muted small">{fmtDateTime(i.created)}</span>
                <div className="form-error">{i.error}</div>
                <div className="row-actions">
                  <button className="btn small" disabled={busy} onClick={async () => { setBusy(true); await retryItem(i).then(onFlush).catch(() => 0).finally(() => setBusy(false)) }}>Try again</button>
                  <button className="btn small danger-outline" disabled={busy} onClick={() => { if (confirm(`Discard "${i.label}" from this phone?`)) removeItem(i.id) }}>Discard</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <h4>Saved by someone else on this phone ({others.length})</h4>
          <p className="muted small">These are sent when {[...new Set(others.map((i) => i.user_name ?? 'that person'))].join(', ')} signs in on this phone again.</p>
        </>
      )}
      {!items.length && <p className="muted">Nothing waiting. Everything has been sent.</p>}
    </Sheet>
  )
}
