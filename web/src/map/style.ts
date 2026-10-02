import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'
import type { GeoData } from '../lib/types'

export const ZONE_COLOURS: Record<number, string> = { 1: '#38bdf8', 2: '#2dd4bf', 3: '#c084fc', 4: '#f472b6' }

// Diameter scheme: one purple hue, darker = larger, so it never competes with the status colours.
export const DIA_STOPS: [number, string][] = [
  [150, '#c4b5fd'],
  [200, '#a78bfa'],
  [250, '#8b5cf6'],
  [300, '#7c3aed'],
  [400, '#6d28d9'],
  [600, '#4c1d95'],
]

export type PipeColourMode = 'diameter' | 'zone'

export function pipeColour(mode: PipeColourMode): ExpressionSpecification {
  if (mode === 'zone') {
    return ['match', ['get', 'zone'], 1, ZONE_COLOURS[1], 2, ZONE_COLOURS[2], 3, ZONE_COLOURS[3], ZONE_COLOURS[4]]
  }
  return ['step', ['coalesce', ['get', 'dia_mm'], 150], DIA_STOPS[0][1], ...DIA_STOPS.slice(1).flat()] as ExpressionSpecification
}

const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false]
const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false]

/** Pipe width by zoom (trunk sewers >= 300 mm drawn wider), plus an optional extra for casings. */
function pipeWidth(extra: ExpressionSpecification | number = 0): ExpressionSpecification {
  const at = (trunk: number, branch: number): ExpressionSpecification =>
    ['+', ['case', ['>=', ['coalesce', ['get', 'dia_mm'], 150], 300], trunk, branch], extra]
  return ['interpolate', ['linear'], ['zoom'], 13, at(2, 1), 16, at(4.5, 3), 19, at(9, 6)]
}

export function buildStyle(data: GeoData, origin: string): StyleSpecification {
  // Draw order bottom -> top: overview frame A, then B, C, D (each sharper than the one below).
  const frames = [...data.imagery].sort((a, b) => b.m_per_px - a.m_per_px)
  return {
    version: 8,
    glyphs: `${origin}/glyphs/{fontstack}/{range}.pbf`,
    sources: {
      esri: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Surroundings: Esri, Maxar',
      },
      ...Object.fromEntries(
        frames.map((f) => [
          `frame-${f.frame}`,
          {
            type: 'raster' as const,
            url: `pmtiles://${origin}/data/${f.file}`,
            tileSize: 256,
            bounds: f.bounds,
            attribution: 'Imagery © Google Earth',
          },
        ]),
      ),
      zones: { type: 'geojson', data: data.zones },
      wards: { type: 'geojson', data: data.wards },
      labels: { type: 'geojson', data: data.labels },
      pipes: { type: 'geojson', data: data.pipes, promoteId: 'id' },
      manholes: { type: 'geojson', data: data.manholes, promoteId: 'id' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#1b2430' } },
      { id: 'esri', type: 'raster', source: 'esri', paint: { 'raster-opacity': 0.85 } },
      ...frames.map((f) => ({
        id: `frame-${f.frame}`,
        type: 'raster' as const,
        source: `frame-${f.frame}`,
        paint: { 'raster-fade-duration': 150 },
      })),
      {
        id: 'zones-fill', type: 'fill', source: 'zones',
        paint: { 'fill-color': ['match', ['get', 'zone'], 1, ZONE_COLOURS[1], 2, ZONE_COLOURS[2], 3, ZONE_COLOURS[3], ZONE_COLOURS[4]], 'fill-opacity': 0.07 },
      },
      {
        id: 'zones-line', type: 'line', source: 'zones',
        paint: {
          'line-color': ['match', ['get', 'zone'], 1, ZONE_COLOURS[1], 2, ZONE_COLOURS[2], 3, ZONE_COLOURS[3], ZONE_COLOURS[4]],
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 17, 4],
          'line-opacity': 0.9,
        },
      },
      {
        id: 'wards-fill-hit', type: 'fill', source: 'wards',
        paint: { 'fill-color': '#ffffff', 'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.12, 0] },
      },
      {
        id: 'wards-line', type: 'line', source: 'wards',
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 17, 2.2],
          'line-dasharray': [3, 2],
          'line-opacity': 0.85,
        },
      },
      {
        id: 'pipes-casing', type: 'line', source: 'pipes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', selected, '#facc15', hovered, '#ffffff', '#0b1020'],
          'line-width': pipeWidth(['case', selected, 6, hovered, 4, 2]),
          'line-opacity': ['case', selected, 1, hovered, 0.9, 0.55],
        },
      },
      {
        id: 'pipes', type: 'line', source: 'pipes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': pipeColour('diameter'), 'line-width': pipeWidth() },
      },
      {
        id: 'manholes', type: 'circle', source: 'manholes', minzoom: 15,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2, 18, 5, 20, 8],
          'circle-color': '#ffffff',
          'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#facc15', '#0b1020'],
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 1.2],
        },
      },
      {
        id: 'manhole-labels', type: 'symbol', source: 'manholes', minzoom: 18,
        layout: {
          'text-field': ['coalesce', ['get', 'label'], ''],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, -1.1],
          'text-anchor': 'bottom',
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#0b1020', 'text-halo-width': 1.4 },
      },
      {
        id: 'ward-labels', type: 'symbol', source: 'labels', filter: ['==', ['get', 'kind'], 'ward'], minzoom: 13,
        layout: {
          'text-field': ['concat', 'Ward ', ['to-string', ['get', 'ward']]],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 11, 17, 16],
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(11,16,32,0.85)', 'text-halo-width': 1.6 },
      },
      {
        id: 'zone-labels', type: 'symbol', source: 'labels', filter: ['==', ['get', 'kind'], 'zone'], maxzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 13,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(11,16,32,0.9)', 'text-halo-width': 1.8 },
      },
    ],
  }
}

/** Layer groups the user can switch on and off. */
export const LAYER_GROUPS = {
  imagery: ['frame-A', 'frame-B', 'frame-C', 'frame-D'],
  surroundings: ['esri'],
  zones: ['zones-fill', 'zones-line', 'zone-labels'],
  wards: ['wards-line', 'ward-labels', 'wards-fill-hit'],
  pipes: ['pipes-casing', 'pipes'],
  manholes: ['manholes', 'manhole-labels'],
  stretches: ['stretches-issue', 'stretches-casing', 'stretches', 'stretches-nomotor', 'stretches-proposed', 'stretches-hit', 'stretches-badges', 'stretches-label'],
  issues: ['issues', 'issues-label'],
  proposals: ['proposals-line', 'proposals-point'],
} as const

export type LayerGroup = keyof typeof LAYER_GROUPS
