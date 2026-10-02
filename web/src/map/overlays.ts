import type { Feature, FeatureCollection } from 'geojson'
import { badges, deriveTags, hazardCount, themeColour, utilityCount, type Theme } from '../../../shared/status.ts'
import { midpoint } from '../../../shared/geo.ts'
import type { ChangeRequest, GeoData, Issue, StretchCollection } from '../lib/types'

const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features })

/**
 * Stretches with the properties the map styles read: colour for the theme, issue outline, dashes, badges.
 * Each stretch also gets one marker point at its midpoint, which carries its code label and issue badges.
 */
export function stretchOverlay(s: StretchCollection, theme: Theme, filter?: (p: StretchCollection['features'][number]['properties']) => boolean) {
  return fc(
    s.features
      .filter((f) => !filter || filter(f.properties))
      .flatMap((f) => {
        const p = f.properties
        const props = {
            id: p.id,
            code: p.code,
            _c: themeColour(theme, p.status, p.approval, p.planned_mh),
            _issue: p.open_issues > 0 || utilityCount(p.status) + hazardCount(p.status) > 0,
            _nomotor: p.status.motorable === 'no',
            _proposed: p.record_state === 'proposed',
            _badge: badges(p.status).join(''),
            _tags: deriveTags(p.status, p.approval, p.planned_mh).slice(0, 4).map((t) => t.text).join(' · '),
        }
        return [
          { type: 'Feature', id: p.id, geometry: f.geometry, properties: props } as Feature,
          { type: 'Feature', geometry: { type: 'Point', coordinates: midpoint(f.geometry) }, properties: { ...props, _mark: true } } as Feature,
        ]
      }),
  )
}

/** Issues reported as map pins (those raised from a stretch show on the stretch instead). */
export function issueOverlay(issues: Issue[]) {
  return fc(
    issues
      .filter((i) => i.status !== 'resolved' && i.location && i.source === 'manual')
      .map((i) => ({ type: 'Feature', id: i.id, geometry: { type: 'Point', coordinates: i.location! }, properties: { id: i.id, kind: i.kind, severity: i.severity } }) as Feature),
  )
}

/** Pending additions (from the request) and deletions (the existing feature) awaiting the Commissioner. */
export function proposalOverlay(requests: ChangeRequest[], geo: GeoData, stretches: StretchCollection) {
  const out: Feature[] = []
  for (const r of requests) {
    if (r.status !== 'pending' || (r.entity === 'stretch' && r.action === 'add')) continue
    let geometry: Feature['geometry'] | undefined
    if (r.action === 'add') geometry = r.payload?.geometry as Feature['geometry']
    else if (r.entity === 'pipe') geometry = geo.pipes.features.find((f) => f.properties.id === r.target_id)?.geometry
    else if (r.entity === 'manhole') geometry = geo.manholes.features.find((f) => f.properties.id === r.target_id)?.geometry
    else geometry = stretches.features.find((f) => f.id === r.target_id)?.geometry as Feature['geometry'] | undefined
    if (!geometry) continue
    if (geometry.type === 'MultiLineString') {
      for (const [i, line] of geometry.coordinates.entries()) {
        out.push({ type: 'Feature', id: `${r.id}:${i}`, geometry: { type: 'LineString', coordinates: line }, properties: { id: r.id, action: r.action, entity: r.entity } })
      }
    } else {
      out.push({ type: 'Feature', id: r.id, geometry, properties: { id: r.id, action: r.action, entity: r.entity } })
    }
  }
  return fc(out)
}
