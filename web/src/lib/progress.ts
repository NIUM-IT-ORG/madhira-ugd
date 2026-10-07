import { useMemo } from 'react'
import type { FeatureCollection } from 'geojson'
import { progressTable, recordedPipeIds, type LabourLike } from '../../../shared/stats.ts'
import { useData } from './store'

/**
 * Field progress for the dashboard, map and panels: what staff recorded, against the current plan network
 * (drawings plus approved changes). One calculation for every screen, so they always agree.
 */
export function useFieldProgress(labour: LabourLike[] = []) {
  const { geo, stretches, issues } = useData()
  return useMemo(() => progressTable({
    wards: geo.wards.features.map((f) => ({ ward: f.properties.ward, zone: f.properties.zone, locality: f.properties.locality })),
    pipes: geo.pipes.features.map((f) => ({ id: f.properties.id, ward: f.properties.ward ?? null, zone: f.properties.zone, length_m: f.properties.length_m })),
    manholes: geo.manholes.features.map((f) => ({ id: f.properties.id, ward: f.properties.ward ?? null, zone: f.properties.zone })),
    stretches: stretches.features.map((f) => f.properties),
    issues,
    labour,
  }), [geo.wards, geo.pipes, geo.manholes, stretches, issues, labour])
}

/** Map overlays: plan pipes not yet covered by any road stretch, and wards shaded by the share recorded. */
export function useCoverageOverlays() {
  const { geo, stretches } = useData()
  const table = useFieldProgress()
  return useMemo(() => {
    const recorded = recordedPipeIds(stretches.features.map((f) => f.properties))
    const unrecorded: FeatureCollection = { type: 'FeatureCollection', features: geo.pipes.features.filter((f) => !recorded.has(f.properties.id)) }
    const pctOf = new Map(table.zones.flatMap((z) => z.rows).map((r) => [r.wards[0], r.plan.pipe_m ? (r.plan.recorded_m / r.plan.pipe_m) * 100 : 0]))
    const coverage: FeatureCollection = {
      type: 'FeatureCollection',
      features: geo.wards.features.map((f) => ({ ...f, properties: { ...f.properties, pct: pctOf.get(f.properties.ward) ?? 0 } })),
    }
    return { unrecorded, coverage }
  }, [geo.pipes, geo.wards, stretches, table])
}

/** Ask the map to switch a layer on (e.g. from the dashboard's "Show on map"). */
export const showLayerEvent = 'ugd:show-layer'
export const requestLayer = (layer: 'unrecorded' | 'coverage') => window.dispatchEvent(new CustomEvent(showLayerEvent, { detail: layer }))
