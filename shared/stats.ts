/**
 * Progress figures, shared by the dashboard (web) and the Excel export (server) so both always agree.
 * Everything comes from what staff record on the map ("field"), measured against the plan network: the
 * drawings plus the network changes the Commissioner approved (v1.25: the progress Excel is no longer used).
 */
import { normaliseStatus, surfaceOf, type Approval, type StretchStatus } from './status.ts'

export interface StretchLike {
  ward: number
  zone: number
  length_m: number
  planned_mh: number
  status: StretchStatus
  approval: Approval
  open_issues: number
  record_state?: string
  pipe_ids?: string[]
}
/** Today's date in India time, as YYYY-MM-DD. */
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
/** An issue is overdue from the day after its due date (India time). */
export const isOverdue = (due: string | null | undefined) => !!due && String(due).slice(0, 10) < todayIST()

export interface IssueLike { ward: number | null; zone: number | null; status: string; severity: string; count: number; kind: string; reported_at: string; due_date?: string | null }
/** Labour is recorded per zone per day (v1.2); ward rows show no labour figure. */
export interface LabourLike { log_date: string; zone: number; labourers: number; machines: number }

export interface FieldFigures {
  stretches: number
  surveyed_m: number
  pipe_laid_m: number
  manholes_built: number
  ics_built: number
  road_cut_m: number
  trench_open_m: number
  backfilled_m: number
  restoration_pending_m: number
  restored_m: number
  restored_cc_m: number
  restored_gravel_m: number
  curing_pending_m: number
  approved_m: number
  not_motorable_m: number
  difficult_m: number
  taps_pending: number
  water_leaks: number
  drains_clogged: number
  stagnation: number
  potholes: number
  proposed: number
  /** Roads drawn by hand that follow no plan pipe (not part of plan coverage). */
  offplan_m: number
}

export const emptyField = (): FieldFigures => ({
  stretches: 0, surveyed_m: 0, pipe_laid_m: 0, manholes_built: 0, ics_built: 0, road_cut_m: 0, trench_open_m: 0, backfilled_m: 0,
  restoration_pending_m: 0, restored_m: 0, restored_cc_m: 0, restored_gravel_m: 0, curing_pending_m: 0, approved_m: 0,
  not_motorable_m: 0, difficult_m: 0, taps_pending: 0, water_leaks: 0, drains_clogged: 0, stagnation: 0, potholes: 0, proposed: 0, offplan_m: 0,
})

export function addStretch(f: FieldFigures, st: StretchLike) {
  const s = normaliseStatus(st.status)
  const L = st.length_m
  f.stretches++
  if (st.record_state === 'proposed') f.proposed++
  f.surveyed_m += L
  f.pipe_laid_m += s.sewer.pipeline === 'laid' ? L : s.sewer.pipeline === 'partial' ? Math.min(L, s.sewer.pipe_laid_m ?? 0) : 0
  f.manholes_built += s.sewer.manholes_built
  f.ics_built += s.sewer.ics_built
  if (s.excavation.stage !== 'none') f.road_cut_m += Math.min(L, s.excavation.cut_length_m ?? L)
  if (s.excavation.stage === 'trench_open') f.trench_open_m += L
  if (s.excavation.stage === 'backfilled') f.backfilled_m += L
  const r = s.restoration.stage
  if (r === 'pending' || (s.excavation.stage === 'backfilled' && r === 'not_due')) f.restoration_pending_m += L
  if (r === 'restored_curing_pending') f.curing_pending_m += L
  if (r.startsWith('restored')) {
    f.restored_m += L
    if (surfaceOf(s) === 'gravel') f.restored_gravel_m += L
    else f.restored_cc_m += L
  }
  if (r === 'restored_curing_done' && st.approval === 'approved') f.approved_m += L
  if (s.motorable === 'no') f.not_motorable_m += L
  if (s.motorable === 'difficult') f.difficult_m += L
  f.taps_pending += Math.max(0, s.utilities.taps_broken - s.utilities.taps_restored)
  f.water_leaks += Math.max(0, s.utilities.water_leaks - s.utilities.water_leaks_fixed)
  f.drains_clogged += s.utilities.drain_clogged ? 1 : 0
  f.stagnation += s.hazards.water_stagnation ? 1 : 0
  f.potholes += s.hazards.potholes
  if (!st.pipe_ids?.length) f.offplan_m += L
}

/** The plan network: pipes and manholes from the drawings plus approved changes (each with its ward). */
export interface PlanPipeLike { id: string; ward: number | null; zone: number; length_m: number }
export interface PlanManholeLike { id: string; ward: number | null; zone: number }
export interface WardInfo { ward: number; zone: number; locality: string | null }

/** Plan figures of an area and how much of it staff have recorded (pipes covered by a road stretch). */
export interface PlanFigures {
  pipe_m: number
  pipes: number
  manholes: number
  recorded_m: number
  recorded_pipes: number
}
const emptyPlan = (): PlanFigures => ({ pipe_m: 0, pipes: 0, manholes: 0, recorded_m: 0, recorded_pipes: 0 })

export interface AreaRow {
  key: string
  label: string
  zone: number
  wards: number[]
  locality: string | null
  plan: PlanFigures
  field: FieldFigures
  issues_open: number
  issues_high: number
  issues_overdue: number
  labour_avg_7d: number | null
  labour_avg_30d: number | null
}

function labourAvg(logs: LabourLike[], zones: number[], days: number, today: Date) {
  // Days counted in India time: "last 7 days" = the 7 calendar days up to today.
  const from = new Date(today.getTime() - (days - 1) * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const rows = logs.filter((l) => zones.includes(l.zone) && l.log_date >= from)
  if (!rows.length) return null
  const byDay = new Map<string, number>()
  for (const r of rows) byDay.set(r.log_date, (byDay.get(r.log_date) ?? 0) + r.labourers)
  return Math.round([...byDay.values()].reduce((a, b) => a + b, 0) / byDay.size)
}

/** Pipes covered by a live road stretch (proposed ones included: staff recorded them). */
export function recordedPipeIds(stretches: StretchLike[]): Set<string> {
  const out = new Set<string>()
  for (const s of stretches) if (s.record_state !== 'rejected') for (const id of s.pipe_ids ?? []) out.add(id)
  return out
}

/**
 * One row per ward, grouped into zones, plus the grand total. Plan = the current plan network of the area;
 * field = what staff recorded (by the stretch's ward); recorded = plan pipes covered by a stretch.
 */
export function progressTable(input: {
  wards: WardInfo[]
  pipes: PlanPipeLike[]
  manholes: PlanManholeLike[]
  stretches: StretchLike[]
  issues: IssueLike[]
  labour?: LabourLike[]
  today?: Date
}) {
  const { wards, pipes, manholes, stretches, issues, labour = [], today = new Date() } = input
  const rows: AreaRow[] = [...wards].sort((a, b) => a.zone - b.zone || a.ward - b.ward).map((w) => ({
    key: `w${w.ward}`, label: `Ward ${w.ward}`, zone: w.zone, wards: [w.ward], locality: w.locality,
    plan: emptyPlan(), field: emptyField(), issues_open: 0, issues_high: 0, issues_overdue: 0, labour_avg_7d: null, labour_avg_30d: null,
  }))
  const rowOf = new Map(rows.map((r) => [r.wards[0], r]))
  const recorded = recordedPipeIds(stretches)
  for (const p of pipes) {
    const r = p.ward != null ? rowOf.get(p.ward) : undefined
    if (!r) continue
    r.plan.pipe_m += p.length_m
    r.plan.pipes++
    if (recorded.has(p.id)) { r.plan.recorded_m += p.length_m; r.plan.recorded_pipes++ }
  }
  for (const m of manholes) {
    const r = m.ward != null ? rowOf.get(m.ward) : undefined
    if (r) r.plan.manholes++
  }
  for (const s of stretches) {
    if (s.record_state === 'rejected') continue
    const r = rowOf.get(s.ward)
    if (r) addStretch(r.field, s)
  }
  for (const it of issues) {
    if (it.status === 'resolved' || it.ward == null) continue
    const r = rowOf.get(it.ward)
    if (!r) continue
    r.issues_open++
    if (it.severity === 'high') r.issues_high++
    if (isOverdue(it.due_date)) r.issues_overdue++
  }
  const combine = (key: string, label: string, zone: number, list: AreaRow[]): AreaRow => {
    const f = emptyField()
    const p = emptyPlan()
    for (const r of list) {
      for (const k of Object.keys(f) as (keyof FieldFigures)[]) f[k] += r.field[k]
      for (const k of Object.keys(p) as (keyof PlanFigures)[]) p[k] += r.plan[k]
    }
    return {
      key, label, zone, wards: list.flatMap((r) => r.wards), locality: null, plan: p, field: f,
      issues_open: list.reduce((a, r) => a + r.issues_open, 0),
      issues_high: list.reduce((a, r) => a + r.issues_high, 0),
      issues_overdue: list.reduce((a, r) => a + r.issues_overdue, 0),
      labour_avg_7d: labourAvg(labour, zone ? [zone] : [1, 2, 3, 4], 7, today),
      labour_avg_30d: labourAvg(labour, zone ? [zone] : [1, 2, 3, 4], 30, today),
    }
  }
  const zoneNumbers = [...new Set(wards.map((w) => w.zone))].sort((a, b) => a - b)
  const zones = zoneNumbers.map((z) => ({ zone: combine(`z${z}`, `Zone ${z}`, z, rows.filter((r) => r.zone === z)), rows: rows.filter((r) => r.zone === z) }))
  const total = combine('total', 'All zones', 0, rows)
  return { zones, total }
}

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)
