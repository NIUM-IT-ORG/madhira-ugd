import type { GeoData } from './types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

/** Sewer network: as extracted from the plans plus the Commissioner-approved additions and deletions. */
export const loadNetwork = () => get<{ pipes: GeoData['pipes']; manholes: GeoData['manholes'] }>('/api/network')

/** Reference data produced by the pipeline (immutable; field status comes from the API in later phases). */
export async function loadGeoData(): Promise<GeoData> {
  const [wards, zones, network, labels, imagery, meta] = await Promise.all([
    get<GeoData['wards']>('/data/wards.geojson'),
    get<GeoData['zones']>('/data/zones.geojson'),
    loadNetwork(),
    get<GeoData['labels']>('/data/labels.geojson'),
    get<GeoData['imagery']>('/data/imagery.json'),
    get<GeoData['meta']>('/data/map_meta.json'),
  ])
  // v1.25: the progress sheet (baseline.json) is no longer used; all progress comes from what staff record.
  return { wards, zones, pipes: network.pipes, manholes: network.manholes, labels, imagery, meta }
}

/** Manhole id "Z1/MH-245#Z1P2" -> display label "MH-245 (Z1, P2)". */
export function manholeName(id: string, label: string | null): string {
  const [zonePart, rest = ''] = id.split('/')
  const dup = rest.includes('#') ? `, ${rest.split('#')[1].replace('Z1', '')}` : ''
  return `${label ?? 'Unlabelled MH'} (${zonePart}${dup})`
}

export const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`)
