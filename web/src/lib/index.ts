import type { MultiPolygon, Polygon } from 'geojson'
import type { GeoData, ManholeProps, PipeProps } from './types'

export interface WardStats {
  ward: number
  zone: number
  locality: string | null
  manholes: number
  pipe_m: number
}

export interface Indexes {
  pipeById: Map<string, PipeProps & { coords: [number, number][] }>
  mhById: Map<string, ManholeProps & { coord: [number, number] }>
  pipesByMh: Map<string, string[]>
  wardStats: Map<number, WardStats>
  searchList: { key: string; text: string; kind: 'manhole' | 'ward' | 'pipe'; id: string }[]
}

export function buildIndexes(d: GeoData): Indexes {
  const pipeById: Indexes['pipeById'] = new Map()
  const mhById: Indexes['mhById'] = new Map()
  const pipesByMh: Indexes['pipesByMh'] = new Map()
  const wardStats: Indexes['wardStats'] = new Map()
  for (const f of d.wards.features) {
    const p = f.properties
    wardStats.set(p.ward, { ward: p.ward, zone: p.zone, locality: p.locality, manholes: 0, pipe_m: 0 })
  }
  for (const f of d.manholes.features) {
    mhById.set(f.properties.id, { ...f.properties, coord: f.geometry.coordinates as [number, number] })
    const ws = f.properties.ward != null ? wardStats.get(f.properties.ward) : undefined
    if (ws) ws.manholes++
  }
  for (const f of d.pipes.features) {
    const p = f.properties
    pipeById.set(p.id, { ...p, coords: f.geometry.coordinates as [number, number][] })
    for (const m of [p.from, p.to]) {
      const list = pipesByMh.get(m) ?? []
      list.push(p.id)
      pipesByMh.set(m, list)
    }
    const ws = p.ward != null ? wardStats.get(p.ward) : undefined
    if (ws) ws.pipe_m += p.length_m
  }

  const searchList: Indexes['searchList'] = []
  for (const w of wardStats.values()) {
    searchList.push({ key: `w${w.ward}`, text: `Ward ${w.ward} ${w.locality ?? ''}`, kind: 'ward', id: String(w.ward) })
  }
  for (const m of mhById.values()) {
    if (m.label) searchList.push({ key: m.id, text: `${m.label} Z${m.zone}`, kind: 'manhole', id: m.id })
  }
  for (const p of pipeById.values()) searchList.push({ key: p.id, text: p.id, kind: 'pipe', id: p.id })
  return { pipeById, mhById, pipesByMh, wardStats, searchList }
}

export function boundsOf(coords: [number, number][]): [[number, number], [number, number]] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of coords) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return [[x0, y0], [x1, y1]]
}

/** All vertex positions of a Polygon / MultiPolygon. */
export function polygonCoords(g: Polygon | MultiPolygon): [number, number][] {
  const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat(1)
  return rings.flat(1) as [number, number][]
}
