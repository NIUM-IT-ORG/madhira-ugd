import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { THEMES, issueLabel, type Theme } from '../../../shared/status.ts'
import { lengthM, midpoint, wardAt as wardOfPoint, type LineGeometry, type LonLat, type WardLike } from '../../../shared/geo.ts'
import BulkForm from '../components/BulkForm'
import DetailPanel from '../components/DetailPanel'
import { IssueDetail, IssueForm } from '../components/IssueForms'
import LayerPanel, { NO_FILTER, type SearchItem, type StretchFilter } from '../components/LayerPanel'
import { DeleteNetworkFeature, ManholeForm, PipeForm, RequestDetail } from '../components/NetworkForms'
import StretchDetail from '../components/StretchDetail'
import StretchForm, { type NewStretch } from '../components/StretchForm'
import { boundsOf, polygonCoords } from '../lib'
import { ApiError, patch } from '../lib/api'
import { canEditWard, useAuth } from '../lib/auth'
import { useData } from '../lib/store'
import type { Selection, StretchFeature } from '../lib/types'
import MapView, { type FlyTarget, type MapClick, type MapMode } from '../map/MapView'
import { issueOverlay, proposalOverlay, stretchOverlay } from '../map/overlays'
import type { LayerGroup, PipeColourMode } from '../map/style'

const DEFAULT_LAYERS: Record<LayerGroup, boolean> = {
  imagery: true, surroundings: true, zones: true, wards: true, pipes: true, manholes: true, stretches: true, issues: true, proposals: true,
}

type Tool =
  | { t: 'stretch'; method: 'pick' | 'draw'; pipes: string[]; points: { c: LonLat; mh?: string }[]; redraw?: StretchFeature }
  | { t: 'manhole' }
  | { t: 'pipe'; from?: string }
  | { t: 'issue'; stretch?: { id: string; code: string } }
  | { t: 'bulk'; ids: string[] }

type Form =
  | { f: 'stretch-new'; draft: NewStretch }
  | { f: 'stretch-edit'; stretch: StretchFeature }
  | { f: 'bulk'; ids: string[] }
  | { f: 'manhole'; point: LonLat }
  | { f: 'pipe'; from: string; to: string }
  | { f: 'issue'; point: LonLat; stretch?: { id: string; code: string } }
  | { f: 'delete'; entity: 'pipe' | 'manhole'; id: string; title: string; extra?: string }

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const isPhone = () => window.matchMedia('(max-width: 760px)').matches

export default function MapPage({ toast, focus }: { toast: (m: string, t?: 'ok' | 'warn' | 'bad') => void; focus: Selection }) {
  const { user } = useAuth()
  const { geo, idx, stretches, issues, requests } = useData()
  const [visible, setVisible] = useState(DEFAULT_LAYERS)
  const [colourMode, setColourMode] = useState<PipeColourMode>('diameter')
  const [theme, setTheme] = useState<Theme>('overall')
  const [filter, setFilter] = useState<StretchFilter>(NO_FILTER)
  const [selection, setSelection] = useState<Selection>(null)
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null)
  const [cursor, setCursor] = useState<{ lng: number; lat: number; zoom: number } | null>(null)
  const [panelOpen, setPanelOpen] = useState(() => !isPhone())
  const [tool, setTool] = useState<Tool | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const editor = user?.role === 'admin' || user?.role === 'editor'
  const isAdmin = user?.role === 'admin'

  // Outside every ward boundary, the nearest ward (part of the network lies outside the KML outlines).
  const wardInfo = useCallback((p: LonLat) => wardOfPoint(p, geo.wards.features as unknown as WardLike[]), [geo.wards])
  const wardAt = useCallback((p: LonLat): number => wardInfo(p).ward, [wardInfo])

  // ---- overlays
  const filterFn = useCallback((p: StretchFeature['properties']) => {
    if (filter.stages.length && !filter.stages.includes(p.stage)) return false
    if (filter.issuesOnly && p.open_issues === 0) return false
    if (filter.notMotorableOnly && p.status.motorable !== 'no') return false
    if (filter.proposedOnly && p.record_state !== 'proposed') return false
    if (filter.zone && p.zone !== filter.zone) return false
    return true
  }, [filter])
  const stretchFc = useMemo(() => stretchOverlay(stretches, theme, filterFn), [stretches, theme, filterFn])
  const draftFc = useMemo<FeatureCollection>(() => {
    if (tool?.t !== 'stretch' || tool.method !== 'draw' || !tool.points.length) return EMPTY
    const pts = tool.points.map((p) => p.c)
    return {
      type: 'FeatureCollection',
      features: [
        ...(pts.length > 1 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: pts } }] : []),
        ...pts.map((c) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: c } })),
      ],
    }
  }, [tool])
  const overlays = useMemo(() => ({
    stretches: stretchFc,
    issues: issueOverlay(issues),
    proposals: proposalOverlay(requests, geo, stretches),
    draft: draftFc,
  }), [stretchFc, issues, requests, geo, stretches, draftFc])
  const highlight = useMemo(() => ({
    pipes: tool?.t === 'stretch' && tool.method === 'pick' ? tool.pipes : [],
    manholes: tool?.t === 'pipe' && tool.from ? [tool.from] : [],
    stretches: tool?.t === 'bulk' ? tool.ids : [],
  }), [tool])

  const mode: MapMode = !tool ? 'browse'
    : tool.t === 'stretch' ? (tool.method === 'pick' ? 'pick-pipes' : 'draw-line')
    : tool.t === 'pipe' ? 'pick-manholes'
    : tool.t === 'bulk' ? 'pick-stretches'
    : 'place-point'

  // ---- selection + camera
  const select = useCallback((s: Selection, fly = true) => {
    setSelection(s)
    if (isPhone()) setPanelOpen(false)
    if (!s || !fly) return
    const key = Date.now()
    if (s.kind === 'pipe') {
      const p = idx.pipeById.get(s.id)
      if (p) setFlyTo({ bounds: boundsOf(p.coords), key })
    } else if (s.kind === 'manhole') {
      const m = idx.mhById.get(s.id)
      if (m) setFlyTo({ center: m.coord, zoom: 19, key })
    } else if (s.kind === 'ward') {
      const w = geo.wards.features.find((f) => f.properties.ward === s.id)
      if (w) setFlyTo({ bounds: boundsOf(polygonCoords(w.geometry)), key })
    } else if (s.kind === 'stretch') {
      const f = stretches.features.find((x) => x.id === s.id)
      if (f) setFlyTo({ bounds: boundsOf(f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat()), key })
    } else if (s.kind === 'issue') {
      const i = issues.find((x) => x.id === s.id)
      const st = i?.stretch_id ? stretches.features.find((x) => x.id === i.stretch_id) : null
      if (i?.location) setFlyTo({ center: i.location, zoom: 18.5, key })
      else if (st) setFlyTo({ center: midpoint(st.geometry), zoom: 18, key })
    } else if (s.kind === 'request') {
      const r = requests.find((x) => x.id === s.id)
      const g = r?.payload?.geometry
      if (g?.type === 'Point') setFlyTo({ center: g.coordinates as LonLat, zoom: 19, key })
      else if (g?.type === 'LineString') setFlyTo({ bounds: boundsOf(g.coordinates as LonLat[]), key })
      else if (r?.entity === 'stretch') {
        const f = stretches.features.find((x) => x.id === r.target_id)
        if (f) setFlyTo({ center: midpoint(f.geometry), zoom: 18, key })
      } else if (r?.entity === 'pipe') {
        const p = idx.pipeById.get(r.target_id)
        if (p) setFlyTo({ bounds: boundsOf(p.coords), key })
      } else if (r?.entity === 'manhole') {
        const m = idx.mhById.get(r.target_id)
        if (m) setFlyTo({ center: m.coord, zoom: 19, key })
      }
    }
  }, [idx, geo, stretches, issues, requests])

  // Other pages open the map on a record ("Show on map").
  useEffect(() => {
    if (focus) select(focus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const flyToZone = useCallback((zone: number) => {
    const z = geo.zones.features.find((f) => f.properties.zone === zone)
    if (isPhone()) setPanelOpen(false)
    if (z) setFlyTo({ bounds: boundsOf(polygonCoords(z.geometry)), key: Date.now() })
  }, [geo])

  // ---- the stretch being built by the tool
  const built = useMemo<NewStretch | null>(() => {
    if (tool?.t !== 'stretch') return null
    let geometry: LineGeometry | null = null
    let pipeIds: string[] = []
    if (tool.method === 'pick') {
      if (!tool.pipes.length) return null
      pipeIds = tool.pipes
      geometry = { type: 'MultiLineString', coordinates: tool.pipes.map((id) => idx.pipeById.get(id)!.coords) }
    } else {
      if (tool.points.length < 2) return null
      geometry = { type: 'LineString', coordinates: tool.points.map((p) => p.c) }
      // Pipes between consecutive snapped manholes belong to the stretch.
      for (let i = 1; i < tool.points.length; i++) {
        const a = tool.points[i - 1].mh, b = tool.points[i].mh
        if (!a || !b) continue
        const shared = (idx.pipesByMh.get(a) ?? []).find((pid) => {
          const p = idx.pipeById.get(pid)!
          return (p.from === a && p.to === b) || (p.from === b && p.to === a)
        })
        if (shared) pipeIds.push(shared)
      }
    }
    const mh = new Set<string>()
    for (const id of pipeIds) {
      const p = idx.pipeById.get(id)
      if (p) { mh.add(p.from); mh.add(p.to) }
    }
    const w = wardInfo(midpoint(geometry))
    return { geometry, pipe_ids: pipeIds, length_m: lengthM(geometry), planned_mh: mh.size, ward: w.ward, outside_ward: !w.inside }
  }, [tool, idx, wardInfo])

  // ---- map taps
  const onClick = useCallback((c: MapClick) => {
    if (!tool) {
      const h = c.hit
      if (!h) return select(null, false)
      if (h.kind === 'proposal') return select({ kind: 'request', id: String(h.props.id) }, false)
      if (h.kind === 'ward') return select({ kind: 'ward', id: Number(h.id) }, false)
      return select({ kind: h.kind, id: h.id } as Selection, false)
    }
    if (tool.t === 'stretch' && tool.method === 'pick' && c.hit?.kind === 'pipe') {
      const id = c.hit.id
      const already = stretches.features.find((f) => f.properties.pipe_ids.includes(id) && f.id !== tool.redraw?.id)
      // A pipe belongs to one stretch (the server refuses it too): lengths would otherwise count twice.
      if (already && !tool.pipes.includes(id)) return toast(`That pipe is already in stretch ${already.properties.code}. Open ${already.properties.code} to change it.`, 'warn')
      setTool({ ...tool, pipes: tool.pipes.includes(id) ? tool.pipes.filter((x) => x !== id) : [...tool.pipes, id] })
    } else if (tool.t === 'stretch' && tool.method === 'draw') {
      setTool({ ...tool, points: [...tool.points, c.snap ? { c: c.snap.coord, mh: c.snap.id } : { c: c.lngLat }] })
    } else if (tool.t === 'manhole') {
      const w = wardAt(c.lngLat)
      if (!canEditWard(user, w) && !isAdmin) return toast(`Ward ${w} is not assigned to you.`, 'bad')
      setForm({ f: 'manhole', point: c.lngLat })
      setTool(null)
    } else if (tool.t === 'issue') {
      const w = wardAt(c.lngLat)
      if (!canEditWard(user, w) && !isAdmin) return toast(`Ward ${w} is not assigned to you.`, 'bad')
      setForm({ f: 'issue', point: c.lngLat, stretch: tool.stretch })
      setTool(null)
    } else if (tool.t === 'pipe' && (c.hit?.kind === 'manhole' || c.hit?.kind === 'proposal')) {
      const id = c.hit.kind === 'manhole' ? c.hit.id : requests.find((r) => r.id === c.hit!.props.id)?.target_id
      if (!id) return
      if (!tool.from) setTool({ t: 'pipe', from: id })
      else if (id !== tool.from) {
        setForm({ f: 'pipe', from: tool.from, to: id })
        setTool(null)
      }
    } else if (tool.t === 'bulk' && c.hit?.kind === 'stretch') {
      const id = c.hit.id
      const f = stretches.features.find((x) => x.id === id)
      if (f && !canEditWard(user, f.properties.ward)) return toast(`Ward ${f.properties.ward} is not assigned to you.`, 'bad')
      setTool({ ...tool, ids: tool.ids.includes(id) ? tool.ids.filter((x) => x !== id) : [...tool.ids, id] })
    }
  }, [tool, select, stretches, requests, toast, user, isAdmin, wardAt])

  async function finishStretch() {
    if (tool?.t !== 'stretch' || !built) return
    if (!canEditWard(user, built.ward)) return toast(`Ward ${built.ward} is not assigned to you.`, 'bad')
    if (tool.redraw) {
      try {
        await patch(`/api/stretches/${tool.redraw.id}`, { base_version: tool.redraw.properties.version, geometry: built.geometry, pipe_ids: built.pipe_ids, note: 'Line redrawn.' })
        toast(`${tool.redraw.properties.code} line updated.`)
        setTool(null)
      } catch (e) {
        toast(e instanceof ApiError ? e.message : String(e), 'bad')
      }
      return
    }
    setForm({ f: 'stretch-new', draft: built })
    setTool(null)
  }

  const pendingDelete = useCallback((entity: 'pipe' | 'manhole', id: string) =>
    requests.find((r) => r.status === 'pending' && r.action === 'delete' && r.entity === entity && r.target_id === id)?.code ?? null, [requests])

  const extraSearch = useMemo<SearchItem[]>(() => [
    ...stretches.features.map((f) => ({ key: f.id, text: `${f.properties.code} ${f.properties.name ?? ''} ward ${f.properties.ward}`, kind: 'stretch' as const, id: f.id })),
    ...issues.filter((i) => i.status !== 'resolved').map((i) => ({ key: i.id, text: `${i.code} ${issueLabel(i.kind)} ward ${i.ward ?? ''}`, kind: 'issue' as const, id: i.id })),
  ], [stretches, issues])

  const sel = selection
  return (
    <div className="body">
      {panelOpen && (
        <LayerPanel
          data={geo} idx={idx} extraSearch={extraSearch} visible={visible} setVisible={setVisible}
          colourMode={colourMode} setColourMode={setColourMode} theme={theme} filter={filter} setFilter={setFilter}
          counts={{ shown: stretches.features.filter((f) => filterFn(f.properties)).length, total: stretches.features.length }}
          onSelect={(s) => select(s)} onZone={flyToZone}
        />
      )}
      <div className="map-wrap">
        <MapView data={geo} overlays={overlays} highlight={highlight} visible={visible} colourMode={colourMode}
          selection={sel} mode={mode} onClick={onClick} flyTo={flyTo} onCursor={setCursor} />

        <div className="map-top">
          <button className="btn small panel-toggle" onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? '◀ Panel' : '▶ Layers & search'}</button>
          <div className="theme-switch" role="tablist" aria-label="Colour stretches by">
            {THEMES.map((t) => (
              <button key={t.key} role="tab" aria-selected={theme === t.key} className={theme === t.key ? 'on' : ''} onClick={() => setTheme(t.key)}>{t.label}</button>
            ))}
          </div>
        </div>

        {editor && !tool && !form && (
          <div className="fab-row">
            <button className="btn primary" onClick={() => { setSelection(null); setTool({ t: 'stretch', method: 'pick', pipes: [], points: [] }) }}>+ Road stretch</button>
            <button className="btn" onClick={() => { setSelection(null); setTool({ t: 'issue' }) }}>Report issue</button>
            <button className="btn" onClick={() => { setSelection(null); setTool({ t: 'manhole' }) }}>+ Manhole</button>
            <button className="btn" onClick={() => { setSelection(null); setTool({ t: 'pipe' }) }}>+ Pipe</button>
            <button className="btn" onClick={() => { setSelection(null); setTool({ t: 'bulk', ids: [] }) }}>Select several</button>
          </div>
        )}

        {tool && (
          <div className="toolbar">
            {tool.t === 'stretch' && (
              <>
                <div className="tool-title">{tool.redraw ? `Redraw ${tool.redraw.properties.code}` : 'New road stretch'}</div>
                <div className="seg small">
                  <button className={tool.method === 'pick' ? 'on' : ''} onClick={() => setTool({ ...tool, method: 'pick' })}>Pick pipes</button>
                  <button className={tool.method === 'draw' ? 'on' : ''} onClick={() => setTool({ ...tool, method: 'draw' })}>Draw line</button>
                </div>
                <div className="tool-hint">
                  {tool.method === 'pick' ? 'Tap the pipe reaches along the road. Tap again to remove.' : 'Tap along the road; taps near a manhole snap to it.'}
                </div>
                <div className="tool-stats">{built ? `${Math.round(built.length_m)} m · ${built.pipe_ids.length} reaches · ${built.planned_mh} manholes · ward ${built.ward}${built.outside_ward ? ' (outside ward boundary)' : ''}` : 'Nothing selected yet'}</div>
                <div className="btn-row">
                  {tool.method === 'draw' && tool.points.length > 0 && <button className="btn" onClick={() => setTool({ ...tool, points: tool.points.slice(0, -1) })}>Undo</button>}
                  <button className="btn" onClick={() => setTool(null)}>Cancel</button>
                  <button className="btn primary" disabled={!built} onClick={finishStretch}>{tool.redraw ? 'Save line' : 'Next: record status'}</button>
                </div>
              </>
            )}
            {tool.t === 'manhole' && <><div className="tool-title">Add manhole</div><div className="tool-hint">Zoom in and tap the manhole's exact position.</div><div className="btn-row"><button className="btn" onClick={() => setTool(null)}>Cancel</button></div></>}
            {tool.t === 'issue' && <><div className="tool-title">Report issue{tool.stretch ? ` on ${tool.stretch.code}` : ''}</div><div className="tool-hint">Tap where the problem is.</div><div className="btn-row"><button className="btn" onClick={() => setTool(null)}>Cancel</button></div></>}
            {tool.t === 'pipe' && (
              <>
                <div className="tool-title">Add pipe</div>
                <div className="tool-hint">{tool.from ? `From ${idx.mhById.get(tool.from)?.label ?? tool.from.split('/')[1]}: now tap the other manhole.` : 'Tap the first manhole (existing or proposed).'}</div>
                <div className="btn-row"><button className="btn" onClick={() => setTool(null)}>Cancel</button></div>
              </>
            )}
            {tool.t === 'bulk' && (
              <>
                <div className="tool-title">Select stretches for a bulk update</div>
                <div className="tool-hint">Tap stretches to select or unselect them.</div>
                <div className="tool-stats">{tool.ids.length} selected</div>
                <div className="btn-row">
                  <button className="btn" onClick={() => setTool(null)}>Cancel</button>
                  <button className="btn primary" disabled={!tool.ids.length} onClick={() => { setForm({ f: 'bulk', ids: tool.ids }); setTool(null) }}>Next: choose changes</button>
                </div>
              </>
            )}
          </div>
        )}

        {!tool && sel?.kind === 'stretch' && (
          <StretchDetail key={sel.id} id={sel.id} toast={toast} onSelect={(s) => select(s)} onClose={() => setSelection(null)}
            onEdit={(f) => setForm({ f: 'stretch-edit', stretch: f })}
            onRedraw={(f) => { setSelection(null); setTool({ t: 'stretch', method: f.properties.pipe_ids.length ? 'pick' : 'draw', pipes: f.properties.pipe_ids, points: f.geometry.type === 'LineString' ? f.geometry.coordinates.map((c) => ({ c })) : [], redraw: f }) }}
            onAddIssue={(f) => { setSelection(null); setTool({ t: 'issue', stretch: { id: f.id, code: f.properties.code } }) }} />
        )}
        {!tool && sel?.kind === 'issue' && <IssueDetail key={sel.id} id={sel.id} toast={toast} onClose={() => setSelection(null)} onSelect={(s) => select(s)} />}
        {!tool && sel?.kind === 'request' && <RequestDetail key={sel.id} id={sel.id} toast={toast} onClose={() => setSelection(null)} onSelect={(s) => select(s)} />}
        {!tool && (sel?.kind === 'pipe' || sel?.kind === 'manhole' || sel?.kind === 'ward') && (
          <DetailPanel selection={sel} idx={idx} onSelect={(s) => select(s)} onClose={() => setSelection(null)}
            isAdmin={isAdmin} canEdit={(w) => canEditWard(user, w)} pendingDelete={pendingDelete}
            onDelete={editor ? (entity, id, title, extra) => setForm({ f: 'delete', entity, id, title, extra }) : undefined} />
        )}
        {cursor && <div className="coords">{cursor.lat.toFixed(6)}, {cursor.lng.toFixed(6)} · z{cursor.zoom.toFixed(1)}</div>}
      </div>

      {form?.f === 'stretch-new' && <StretchForm draft={form.draft} onClose={() => setForm(null)} onSaved={(m, t) => toast(m, t)} />}
      {form?.f === 'stretch-edit' && <StretchForm existing={form.stretch} onClose={() => setForm(null)} onSaved={(m, t) => toast(m, t)} />}
      {form?.f === 'bulk' && (
        <BulkForm ids={form.ids} codes={form.ids.map((id) => stretches.features.find((f) => f.id === id)?.properties.code ?? id)} onClose={() => setForm(null)} onSaved={(m, t) => toast(m, t)} />
      )}
      {form?.f === 'manhole' && <ManholeForm point={form.point} onClose={() => setForm(null)} onDone={(m) => toast(m)} />}
      {form?.f === 'pipe' && <PipeForm from={form.from} to={form.to} onClose={() => setForm(null)} onDone={(m) => toast(m)} />}
      {form?.f === 'issue' && <IssueForm point={form.point} stretch={form.stretch} onClose={() => setForm(null)} onDone={(m, t) => toast(m, t)} />}
      {form?.f === 'delete' && (
        <DeleteNetworkFeature entity={form.entity} id={form.id} title={form.title} extra={form.extra} onClose={() => setForm(null)}
          onDone={(m) => { toast(m); setSelection(null) }} />
      )}
    </div>
  )
}

