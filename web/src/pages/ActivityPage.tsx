import { useEffect, useState } from 'react'
import { FIELD_LABELS, describeValue, issueLabel } from '../../../shared/status.ts'
import { PhotoStrip, fmtDateTime } from '../components/ui'
import { get } from '../lib/api'
import { useData } from '../lib/store'
import type { ActivityItem, Selection } from '../lib/types'

const VERB: Record<string, string> = {
  create: 'added', update: 'updated', bulk: 'bulk-updated', approve: 'approved restoration of', reject: 'rejected restoration of',
  revert: 'rolled back', geometry: 'redrew', delete: 'removed', issue_resolved: 'resolved an issue on',
  open: 'reported', count: 'updated count of', resolve: 'resolved', reopen: 're-opened',
  pending: 'requested', approved: 'approved request', rejected: 'rejected request', withdrawn: 'withdrew request',
}

export default function ActivityPage({ onShow }: { onShow: (s: Selection) => void }) {
  const { lastEvent } = useData()
  const [items, setItems] = useState<ActivityItem[]>([])
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  useEffect(() => {
    get<{ activity: ActivityItem[] }>('/api/activity?limit=200').then((r) => setItems(r.activity)).catch(() => undefined)
  }, [lastEvent?.at])
  const shown = onlyFlagged ? items.filter((i) => i.flagged_far) : items

  return (
    <div className="page">
      <div className="page-head">
        <h2>Activity</h2>
        <p className="muted">Every change, newest first; updates live. Field updates made more than 200 m from the stretch are flagged.</p>
        <label className="check"><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />Only flagged (made away from site)</label>
      </div>
      <ol className="feed">
        {shown.map((a, i) => (
          <li key={`${a.entity}-${a.entity_id}-${a.at}-${i}`} className={a.flagged_far ? 'flag' : ''}>
            <div className="feed-head">
              <b>{a.user_name ?? 'Someone'}</b>{a.user_designation ? <span className="muted"> ({a.user_designation})</span> : null}{' '}
              {VERB[a.action] ?? a.action}{' '}
              <button className="link" onClick={() => onShow(a.entity === 'issue' ? { kind: 'issue', id: a.entity_id } : a.entity === 'stretch' ? { kind: 'stretch', id: a.entity_id } : { kind: 'request', id: a.entity_id })}>
                {a.code}
              </button>
              {a.entity === 'issue' && a.name ? ` · ${issueLabel(a.name)}` : a.name ? ` · ${a.name}` : ''}
              {a.ward ? <span className="muted"> · ward {a.ward}</span> : null}
              <span className="muted feed-time">{fmtDateTime(a.at)}</span>
            </div>
            {a.entity === 'stretch' && a.changes?.length > 0 && (
              <div className="feed-changes">
                {a.changes.slice(0, 6).map((c, j) => (
                  <span key={j}>{FIELD_LABELS[c.path] ?? c.path}: <b>{describeValue(c.path, c.to)}</b></span>
                ))}
              </div>
            )}
            {a.note && <div className="tl-note">“{a.note}”</div>}
            {a.flagged_far && <div className="bad small">Recorded {Math.round(a.gps_distance_m ?? 0)} m away from the stretch</div>}
            <PhotoStrip ids={a.photos ?? []} />
          </li>
        ))}
        {!shown.length && <li className="muted">No activity yet.</li>}
      </ol>
    </div>
  )
}
