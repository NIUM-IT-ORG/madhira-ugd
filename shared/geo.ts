/** Small geometry helpers on lon/lat (town scale: a local equirectangular approximation is accurate to <0.1 %). */

export type LonLat = [number, number]
export type LineGeometry = { type: 'LineString'; coordinates: LonLat[] } | { type: 'MultiLineString'; coordinates: LonLat[][] }

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180

export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1])
  const dLon = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export const lines = (g: LineGeometry): LonLat[][] => (g.type === 'LineString' ? [g.coordinates] : g.coordinates)

export function lengthM(g: LineGeometry): number {
  let t = 0
  for (const l of lines(g)) for (let i = 1; i < l.length; i++) t += distanceM(l[i - 1], l[i])
  return t
}

/** Shortest distance (m) from a point to a line geometry. */
export function distanceToLineM(p: LonLat, g: LineGeometry): number {
  const kx = Math.cos(rad(p[1])) * rad(1) * R
  const ky = rad(1) * R
  let best = Infinity
  for (const l of lines(g)) {
    for (let i = 0; i < l.length; i++) {
      const a = l[i]
      const b = l[Math.min(i + 1, l.length - 1)]
      const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky
      const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky
      const dx = bx - ax, dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
    }
  }
  return best
}

/** A point halfway along the geometry's length (for labels and ward lookup). */
export function midpoint(g: LineGeometry): LonLat {
  const total = lengthM(g)
  let run = 0
  for (const l of lines(g)) {
    for (let i = 1; i < l.length; i++) {
      const d = distanceM(l[i - 1], l[i])
      if (run + d >= total / 2) {
        const t = d ? (total / 2 - run) / d : 0
        return [l[i - 1][0] + t * (l[i][0] - l[i - 1][0]), l[i - 1][1] + t * (l[i][1] - l[i - 1][1])]
      }
      run += d
    }
  }
  return lines(g)[0][0]
}

type Ring = LonLat[]
type PolygonGeom = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }

function inRing(p: LonLat, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function inPolygon(p: LonLat, g: PolygonGeom): boolean {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return polys.some((rings) => inRing(p, rings[0]) && !rings.slice(1).some((h) => inRing(p, h)))
}

export function bbox(g: LineGeometry): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const l of lines(g)) for (const [x, y] of l) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}
