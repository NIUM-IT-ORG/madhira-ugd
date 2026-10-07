import { useEffect, useRef } from 'react'
import {
  AttributionControl,
  GeolocateControl,
  Map as MlMap,
  NavigationControl,
  ScaleControl,
  addProtocol,
  setWorkerUrl,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapGeoJSONFeature,
  type MapMouseEvent,
} from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BADGE_INFO } from '../../../shared/status.ts'
import type { GeoData, Selection } from '../lib/types'
import { LAYER_GROUPS, buildStyle, pipeColour, type LayerGroup, type PipeColourMode } from './style'

// MapLibre v6 module worker, copied to public/vendor by vite.config.ts.
setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs')
let protocolAdded = false
// Read once at page load: tearing a map down (React StrictMode in dev) clears the hash it wrote.
const openedWithView = (() => {
  const m = /map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/.exec(window.location.hash)
  return m ? { zoom: Number(m[1]), center: [Number(m[3]), Number(m[2])] as [number, number] } : null
})()

export interface FlyTarget {
  bounds?: LngLatBoundsLike
  center?: [number, number]
  zoom?: number
  key: number
}

/** What the map is doing with taps. */
export type MapMode = 'browse' | 'pick-pipes' | 'draw-line' | 'place-point' | 'pick-manholes' | 'pick-stretches'

export interface MapClick {
  lngLat: [number, number]
  /** Feature under the tap, by priority for the current mode. */
  hit?: { kind: 'pipe' | 'manhole' | 'stretch' | 'issue' | 'ward' | 'proposal'; id: string; props: Record<string, unknown> }
  /** Manhole within snapping distance (draw mode). */
  snap?: { id: string; coord: [number, number] }
}

export interface Overlays {
  stretches: FeatureCollection
  issues: FeatureCollection
  proposals: FeatureCollection
  draft: FeatureCollection
  /** Plan pipes no road stretch covers yet (v1.25). */
  unrecorded: FeatureCollection
  /** Wards with the share of their plan network recorded (`pct`, 0-100). */
  coverage: FeatureCollection
}

export interface Highlight {
  pipes: string[]
  manholes: string[]
  stretches: string[]
}

interface Props {
  data: GeoData
  overlays: Overlays
  highlight: Highlight
  visible: Record<LayerGroup, boolean>
  colourMode: PipeColourMode
  selection: Selection
  mode: MapMode
  onClick: (c: MapClick) => void
  flyTo: FlyTarget | null
  onCursor?: (c: { lng: number; lat: number; zoom: number }) => void
}

const HIT_LAYERS: Record<MapMode, string[]> = {
  browse: ['issues', 'proposals-point', 'proposals-line', 'manholes', 'stretches-hit', 'pipes', 'pipes-casing'],
  'pick-pipes': ['pipes', 'pipes-casing'],
  'draw-line': ['manholes'],
  'place-point': [],
  'pick-manholes': ['manholes', 'proposals-point'],
  'pick-stretches': ['stretches-hit'],
}
const KIND_OF_LAYER: Record<string, NonNullable<MapClick['hit']>['kind']> = {
  issues: 'issue', 'proposals-point': 'proposal', 'proposals-line': 'proposal', manholes: 'manhole',
  'stretches-hit': 'stretch', pipes: 'pipe', 'pipes-casing': 'pipe',
}

/** Composite badge images ("badge:TLD"), drawn on demand: one coloured disc per issue letter. */
function badgeImage(letters: string[]) {
  const r = 9, gap = 2, ratio = 2
  const w = letters.length * (2 * r) + (letters.length - 1) * gap + 4
  const h = 2 * r + 4
  const c = document.createElement('canvas')
  c.width = w * ratio
  c.height = h * ratio
  const g = c.getContext('2d')!
  g.scale(ratio, ratio)
  letters.forEach((l, i) => {
    const cx = 2 + r + i * (2 * r + gap)
    g.beginPath()
    g.arc(cx, h / 2, r, 0, Math.PI * 2)
    g.fillStyle = BADGE_INFO[l]?.colour ?? '#dc2626'
    g.fill()
    g.lineWidth = 2
    g.strokeStyle = '#ffffff'
    g.stroke()
    g.fillStyle = '#ffffff'
    g.font = 'bold 11px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(l, cx, h / 2 + 0.5)
  })
  return { width: c.width, height: c.height, data: new Uint8Array(g.getImageData(0, 0, c.width, c.height).data.buffer) }
}

function setData(map: MlMap, source: string, data: FeatureCollection) {
  const s = map.getSource(source) as GeoJSONSource | undefined
  s?.setData(data)
}

function addFieldLayers(map: MlMap) {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
  for (const id of ['stretches', 'issues', 'proposals', 'draft', 'unrecorded', 'coverage']) {
    map.addSource(id, { type: 'geojson', data: empty, promoteId: 'id' })
  }
  // Coverage: wards shaded by how much of their plan network staff have recorded (light = little, dark = most).
  map.addLayer({ id: 'coverage-fill', type: 'fill', source: 'coverage', layout: { visibility: 'none' },
    paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'pct'], 0, '#fee2e2', 25, '#fca5a5', 50, '#5eead4', 100, '#0f766e'], 'fill-opacity': 0.45 } }, 'pipes-casing')
  map.addLayer({ id: 'coverage-label', type: 'symbol', source: 'coverage', layout: { visibility: 'none', 'text-field': ['concat', ['to-string', ['round', ['get', 'pct']]], '% recorded'],
    'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.4] }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#0b1020', 'text-halo-width': 1.6 } })
  // Not yet recorded: plan pipes with no road stretch, drawn bright so staff can be sent there.
  map.addLayer({ id: 'unrecorded-casing', type: 'line', source: 'unrecorded', layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': '#0b1020', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 17, 8] } }, 'manholes')
  map.addLayer({ id: 'unrecorded', type: 'line', source: 'unrecorded', layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': '#e879f9', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.6, 17, 5], 'line-dasharray': [2, 1.2] } }, 'manholes')
  const width = (base: number) => ['interpolate', ['linear'], ['zoom'], 13, base * 0.5, 16, base, 19, base * 2.2] as never
  // Stretches sit above the pipes: they are the field picture.
  map.addLayer({ id: 'stretches-issue', type: 'line', source: 'stretches', filter: ['all', ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']], ['==', ['get', '_issue'], true]],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#dc2626', 'line-width': width(13), 'line-opacity': 0.9 } }, 'manholes')
  map.addLayer({ id: 'stretches-casing', type: 'line', source: 'stretches', filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#facc15', '#0b1020'], 'line-width': width(9.5) } }, 'manholes')
  map.addLayer({ id: 'stretches', type: 'line', source: 'stretches', filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', '_c'], 'line-width': width(7), 'line-opacity': ['case', ['get', '_proposed'], 0.55, 1] } }, 'manholes')
  map.addLayer({ id: 'stretches-nomotor', type: 'line', source: 'stretches', filter: ['all', ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']], ['==', ['get', '_nomotor'], true]],
    paint: { 'line-color': '#0b1020', 'line-width': width(2.5), 'line-dasharray': [1.2, 1.4] } }, 'manholes')
  map.addLayer({ id: 'stretches-proposed', type: 'line', source: 'stretches', filter: ['all', ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']], ['==', ['get', '_proposed'], true]],
    paint: { 'line-color': '#fbbf24', 'line-width': width(2), 'line-dasharray': [2, 2] } }, 'manholes')
  map.addLayer({ id: 'stretches-hit', type: 'line', source: 'stretches', filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']], paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 } }, 'manholes')
  map.addLayer({ id: 'stretches-badges', type: 'symbol', source: 'stretches', minzoom: 14.5, filter: ['all', ['has', '_mark'], ['!=', ['get', '_badge'], '']],
    layout: { 'icon-image': ['concat', 'badge:', ['get', '_badge']], 'icon-allow-overlap': true, 'icon-offset': [0, -16] } })
  map.addLayer({ id: 'stretches-label', type: 'symbol', source: 'stretches', minzoom: 16, filter: ['has', '_mark'],
    layout: { 'text-field': ['get', 'code'], 'text-font': ['Noto Sans Bold'], 'text-size': 11.5, 'text-offset': [0, 1.2], 'text-allow-overlap': false },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#0b1020', 'text-halo-width': 1.5 } })

  // Proposed network changes (awaiting the Commissioner): additions amber, deletions red.
  map.addLayer({ id: 'proposals-line', type: 'line', source: 'proposals', filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': ['case', ['==', ['get', 'action'], 'delete'], '#ef4444', '#fbbf24'], 'line-width': width(4), 'line-dasharray': [1.5, 1.2] } })
  map.addLayer({ id: 'proposals-point', type: 'circle', source: 'proposals', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 4, 19, 9], 'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 3, 'circle-stroke-color': ['case', ['==', ['get', 'action'], 'delete'], '#ef4444', '#fbbf24'] } })

  // Issues pinned on the map (manual reports).
  map.addLayer({ id: 'issues', type: 'circle', source: 'issues',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 4, 18, 8], 'circle-color': ['match', ['get', 'severity'], 'high', '#dc2626', 'medium', '#f97316', '#eab308'],
      'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#facc15', '#ffffff'], 'circle-stroke-width': 2 } })
  map.addLayer({ id: 'issues-label', type: 'symbol', source: 'issues', minzoom: 15,
    layout: { 'text-field': '!', 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' } })

  // Drawing: the line being drawn and its vertices.
  map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#facc15', 'line-width': 4, 'line-dasharray': [2, 1] } })
  map.addLayer({ id: 'draft-point', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 6, 'circle-color': '#facc15', 'circle-stroke-color': '#0b1020', 'circle-stroke-width': 2 } })

  // Pipes picked in the tools.
  map.addLayer({ id: 'pipes-picked', type: 'line', source: 'pipes',
    paint: { 'line-color': '#facc15', 'line-width': width(8), 'line-opacity': ['case', ['boolean', ['feature-state', 'picked'], false], 0.95, 0] } }, 'manholes')
}

export default function MapView(p: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const ready = useRef(false)
  const props = useRef(p)
  props.current = p
  const prevHighlight = useRef<Highlight>({ pipes: [], manholes: [], stretches: [] })

  const whenReady = (fn: (m: MlMap) => void) => {
    const m = mapRef.current
    if (!m) return
    if (ready.current) fn(m)
    else m.once('idle', () => ready.current && fn(m))
  }

  useEffect(() => {
    if (!container.current) return
    if (!protocolAdded) {
      addProtocol('pmtiles', new Protocol().tile)
      protocolAdded = true
    }
    const map = new MlMap({
      container: container.current,
      style: buildStyle(p.data, window.location.origin),
      // A shared link (#map=zoom/lat/lng) opens where it was saved; otherwise fit the municipality.
      ...(openedWithView ?? { bounds: p.data.meta.bounds, fitBoundsOptions: { padding: 40 } }),
      maxZoom: 21,
      minZoom: 10,
      hash: 'map',
      attributionControl: false,
      doubleClickZoom: false,
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right')
    map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right')
    map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 140 }), 'bottom-right')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    map.on('styleimagemissing', (e) => {
      if (!e.id.startsWith('badge:') || map.hasImage(e.id)) return
      map.addImage(e.id, badgeImage(e.id.slice(6).split('')), { pixelRatio: 2 })
    })

    const pick = (pt: { x: number; y: number }): MapGeoJSONFeature | undefined => {
      const layers = HIT_LAYERS[props.current.mode].filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none')
      if (!layers.length) return undefined
      const pad = 8
      const feats = map.queryRenderedFeatures([[pt.x - pad, pt.y - pad], [pt.x + pad, pt.y + pad]], { layers })
      for (const l of layers) {
        const f = feats.find((x) => x.layer.id === l)
        if (f) return f
      }
      return undefined
    }

    let hover: { source: string; id: string | number } | null = null
    map.on('load', () => {
      addFieldLayers(map)
      ready.current = true
      const c = props.current
      setData(map, 'stretches', c.overlays.stretches)
      setData(map, 'issues', c.overlays.issues)
      setData(map, 'proposals', c.overlays.proposals)
      setData(map, 'draft', c.overlays.draft)
      setData(map, 'unrecorded', c.overlays.unrecorded)
      setData(map, 'coverage', c.overlays.coverage)
    })
    map.on('mousemove', (e) => {
      const mode = props.current.mode
      props.current.onCursor?.({ lng: e.lngLat.lng, lat: e.lngLat.lat, zoom: map.getZoom() })
      const f = mode === 'place-point' ? undefined : pick(e.point)
      map.getCanvas().style.cursor = mode === 'browse' ? (f ? 'pointer' : '') : 'crosshair'
      const key = f && f.id !== undefined ? { source: f.source, id: f.id } : null
      if (hover && (!key || key.id !== hover.id || key.source !== hover.source)) {
        if (map.getSource(hover.source)) map.setFeatureState(hover, { hover: false })
        hover = null
      }
      if (key && (key.source === 'pipes' || key.source === 'manholes')) {
        map.setFeatureState(key, { hover: true })
        hover = key
      }
    })
    map.on('click', (e: MapMouseEvent) => {
      const mode = props.current.mode
      const out: MapClick = { lngLat: [e.lngLat.lng, e.lngLat.lat] }
      if (mode === 'draw-line') {
        const m = pick(e.point)
        if (m) out.snap = { id: String(m.id), coord: (m.geometry as GeoJSON.Point).coordinates as [number, number] }
        props.current.onClick(out)
        return
      }
      const f = pick(e.point)
      if (f) {
        out.hit = { kind: KIND_OF_LAYER[f.layer.id], id: String(f.id ?? f.properties.id), props: f.properties }
      } else if (mode === 'browse') {
        const w = map.queryRenderedFeatures(e.point, { layers: ['wards-fill-hit'] })[0]
        if (w) out.hit = { kind: 'ward', id: String(w.properties.ward), props: w.properties }
      }
      props.current.onClick(out)
    })
    return () => {
      map.remove()
      mapRef.current = null
      ready.current = false
    }
    // The map is created once per reference data set; everything else updates in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.data.wards])

  // Network edits (approved additions / deletions) arrive without rebuilding the map.
  useEffect(() => whenReady((m) => {
    setData(m, 'pipes', p.data.pipes)
    setData(m, 'manholes', p.data.manholes)
  }), [p.data.pipes, p.data.manholes])

  useEffect(() => whenReady((m) => {
    setData(m, 'stretches', p.overlays.stretches)
    setData(m, 'issues', p.overlays.issues)
    setData(m, 'proposals', p.overlays.proposals)
    setData(m, 'draft', p.overlays.draft)
    setData(m, 'unrecorded', p.overlays.unrecorded)
    setData(m, 'coverage', p.overlays.coverage)
  }), [p.overlays])

  useEffect(() => whenReady((m) => {
    for (const [group, ids] of Object.entries(LAYER_GROUPS) as [LayerGroup, readonly string[]][]) {
      for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', p.visible[group] ? 'visible' : 'none')
    }
  }), [p.visible])

  useEffect(() => whenReady((m) => m.setPaintProperty('pipes', 'line-color', pipeColour(p.colourMode))), [p.colourMode])

  // Highlights for the tools (picked pipes / manholes, selected stretches).
  useEffect(() => whenReady((m) => {
    const prev = prevHighlight.current
    for (const id of prev.pipes) m.setFeatureState({ source: 'pipes', id }, { picked: false })
    for (const id of prev.manholes) m.setFeatureState({ source: 'manholes', id }, { selected: false })
    for (const id of prev.stretches) m.setFeatureState({ source: 'stretches', id }, { selected: false })
    for (const id of p.highlight.pipes) m.setFeatureState({ source: 'pipes', id }, { picked: true })
    for (const id of p.highlight.manholes) m.setFeatureState({ source: 'manholes', id }, { selected: true })
    for (const id of p.highlight.stretches) m.setFeatureState({ source: 'stretches', id }, { selected: true })
    prevHighlight.current = p.highlight
  }), [p.highlight, p.overlays.stretches])

  // Selection highlight.
  useEffect(() => {
    const s = p.selection
    if (!s || s.kind === 'request') return
    const source = { pipe: 'pipes', manhole: 'manholes', ward: 'wards', stretch: 'stretches', issue: 'issues' }[s.kind]
    whenReady((m) => m.getSource(source) && m.setFeatureState({ source, id: s.id }, { selected: true }))
    return () => {
      const m = mapRef.current
      if (m?.getSource(source)) m.setFeatureState({ source, id: s.id }, { selected: false })
    }
  }, [p.selection, p.overlays.stretches, p.overlays.issues])

  useEffect(() => {
    const m = mapRef.current
    if (!m || !p.flyTo) return
    if (p.flyTo.bounds) m.fitBounds(p.flyTo.bounds, { padding: 70, maxZoom: 18.5, duration: 900 })
    else if (p.flyTo.center) m.flyTo({ center: p.flyTo.center, zoom: p.flyTo.zoom ?? 18, duration: 900 })
  }, [p.flyTo])

  return <div ref={container} className={`map mode-${p.mode}`} />
}
