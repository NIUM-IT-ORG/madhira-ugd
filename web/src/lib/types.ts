import type { FeatureCollection, LineString, Point, Polygon, MultiPolygon } from 'geojson'
import type { Approval, StretchStatus, Stage } from '../../../shared/status.ts'
import type { LineGeometry } from '../../../shared/geo.ts'

export interface WardProps {
  ward: number
  zone: number
  zone_name: string
  locality: string | null
  area_ha: number
}

export interface ZoneProps {
  zone: number
  name: string
  area_ha: number
  wards: number[]
}

export interface ManholeProps {
  id: string
  zone: number
  ward: number | null
  label: string | null
  gl: number | null
  il: number | null
  sheets: string[]
  outside_boundary: boolean
  added?: boolean
}

export interface PipeProps {
  id: string
  zone: number
  ward: number | null
  from: string
  to: string
  from_label: string | null
  to_label: string | null
  length_m: number
  len_label_m: number | null
  len_geom_m: number
  dia_mm: number | null
  dia_inferred?: boolean
  slope: string | null
  source: 'label' | 'band' | 'field'
  sheet: string
  added?: boolean
}

export interface ImageryFrame {
  frame: string
  title: string
  m_per_px: number
  bounds: [number, number, number, number]
  minzoom: number
  maxzoom: number
  file: string
}

export interface MapMeta {
  bounds: [number, number, number, number]
  center: [number, number]
}

export interface BaselineGroup {
  group: string
  zone: number
  wards: number[]
  locality: string | null
  sanctioned: { pipe_m: number; manholes: number; ics: number }
  executed: { pipe_m: number; manholes: number; ics: number }
}

export interface Baseline {
  as_of: string
  source: string
  groups: BaselineGroup[]
}

export interface GeoData {
  wards: FeatureCollection<Polygon | MultiPolygon, WardProps>
  zones: FeatureCollection<Polygon | MultiPolygon, ZoneProps>
  pipes: FeatureCollection<LineString, PipeProps>
  manholes: FeatureCollection<Point, ManholeProps>
  labels: FeatureCollection<Point>
  imagery: ImageryFrame[]
  meta: MapMeta
  baseline: Baseline
}

export type Selection =
  | { kind: 'pipe'; id: string }
  | { kind: 'manhole'; id: string }
  | { kind: 'ward'; id: number }
  | { kind: 'stretch'; id: string }
  | { kind: 'issue'; id: string }
  | { kind: 'request'; id: string }
  | null

// ---------------------------------------------------------------- field records (API)

export interface StretchProps {
  id: string
  code: string
  name: string | null
  ward: number
  zone: number
  length_m: number
  planned_mh: number
  pipe_ids: string[]
  status: StretchStatus
  approval: Approval
  stage: Stage
  open_issues: number
  version: number
  record_state: 'proposed' | 'active' | 'rejected'
  created_at: string
  updated_at: string
  updated_by_name: string | null
  flagged_far: boolean
  approved_at: string | null
  outside_ward?: boolean // lies outside the KML ward outlines; the nearest ward is used
}
export interface StretchFeature {
  type: 'Feature'
  id: string
  geometry: LineGeometry
  properties: StretchProps
}
export interface StretchCollection {
  type: 'FeatureCollection'
  features: StretchFeature[]
}

export interface FieldChange {
  path: string
  from: unknown
  to: unknown
}
export interface StretchVersion {
  version: number
  kind: string
  at: string
  changes: FieldChange[]
  note: string | null
  photos: string[]
  gps: { lat: number; lng: number; accuracy?: number | null } | null
  gps_distance_m: number | null
  flagged_far: boolean
  warnings: string[]
  approval: Approval
  batch_id: string | null
  user_name: string | null
  user_designation: string | null
}

export interface Issue {
  id: string
  code: string
  kind: string
  stretch_id: string | null
  stretch_code: string | null
  stretch_name: string | null
  ward: number | null
  zone: number | null
  location: [number, number] | null
  count: number
  severity: 'low' | 'medium' | 'high'
  status: 'open' | 'assigned' | 'resolved'
  description: string | null
  assigned_to: string | null
  due_date: string | null
  photos: string[]
  source: 'manual' | 'stretch'
  reported_by_name: string | null
  reported_at: string
  updated_at: string
  updated_by_name: string | null
  resolved_by_name: string | null
  resolved_at: string | null
  resolution_note: string | null
}
export interface IssueEvent {
  id: number
  action: string
  at: string
  changes: FieldChange[]
  note: string | null
  user_name: string | null
}

export interface ChangeRequest {
  id: string
  code: string
  entity: 'stretch' | 'pipe' | 'manhole'
  action: 'add' | 'delete'
  target_id: string
  payload: {
    geometry?: { type: string; coordinates: unknown }
    properties?: Record<string, unknown>
    label?: string
    name?: string | null
    length_m?: number
    cascade_pipes?: string[]
  } | null
  reason: string | null
  ward: number | null
  zone: number | null
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  requested_by: string
  requested_by_name: string | null
  requested_by_designation: string | null
  requested_at: string
  decided_by_name: string | null
  decided_at: string | null
  decision_note: string | null
}

export interface ActivityItem {
  entity: 'stretch' | 'issue' | 'change_request'
  action: string
  at: string
  changes: FieldChange[]
  note: string | null
  flagged_far: boolean
  gps_distance_m: number | null
  photos: string[]
  entity_id: string
  code: string
  name: string | null
  ward: number | null
  user_name: string | null
  user_designation: string | null
}

export interface LabourLog {
  id: number
  log_date: string
  ward: number
  zone: number
  labourers: number
  machines: number
  note: string | null
  user_name: string | null
}
