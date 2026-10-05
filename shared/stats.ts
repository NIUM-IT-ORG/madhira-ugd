/**
 * Progress figures, shared by the dashboard (web) and the Excel export (server) so both always agree.
 * "Reported" = the progress Excel (contractor / MB figures); "field" = what was recorded on the map.
 */
import { normaliseStatus, type Approval, type StretchStatus } from './status.ts'

export interface StretchLike {
  ward: number
  zone: number
  length_m: number
  planned_mh: number
  status: StretchStatus
  approval: Approval
  open_issues: number
  record_state?: string
}
/** Today's date in India time, as YYYY-MM-DD. */
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
/** An issue is overdue from the day after its due date (India time). */
export const isOverdue = (due: string | null | undefined) => !!due && String(due).slice(0, 10) < todayIST()

export interface IssueLike { ward: number | null; zone: number | null; status: string; severity: string; count: number; kind: string; reported_at: string; due_date?: string | null }
export interface BaselineGroupLike {
  zone: number
  wards: number[]
  locality: string | null
  sanctioned: { pipe_m: number; manholes: number; ics: number }
  executed: { pipe_m: number; manholes: number; ics: number }
}
export interface LabourLike { log_date: string; ward: number; zone: number; labourers: number; machines: number }

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
}

export const emptyField = (): FieldFigures => ({
  stretches: 0, surveyed_m: 0, pipe_laid_m: 0, manholes_built: 0, ics_built: 0, road_cut_m: 0, trench_open_m: 0, backfilled_m: 0,
  restoration_pending_m: 0, restored_m: 0, curing_pending_m: 0, approved_m: 0, not_motorable_m: 0, difficult_m: 0,
  taps_pending: 0, water_leaks: 0, drains_clogged: 0, stagnation: 0, potholes: 0, proposed: 0,
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
  if (r.startsWith('restored')) f.restored_m += L
  if (r === 'restored_curing_done' && st.approval === 'approved') f.approved_m += L
  if (s.motorable === 'no') f.not_motorable_m += L
  if (s.motorable === 'difficult') f.difficult_m += L
  f.taps_pending += Math.max(0, s.utilities.taps_broken - s.utilities.taps_restored)
  f.water_leaks += Math.max(0, s.utilities.water_leaks - s.utilities.water_leaks_fixed)
  f.drains_clogged += s.utilities.drain_clogged ? 1 : 0
  f.stagnation += s.hazards.water_stagnation ? 1 : 0
  f.potholes += s.hazards.potholes
}

export interface AreaRow {
  key: string
  label: string
  zone: number
  wards: number[]
  locality: string | null
  sanctioned: { pipe_m: number; manholes: number; ics: number }
  reported: { pipe_m: number; manholes: number; ics: number }
  field: FieldFigures
  issues_open: number
  issues_high: number
  issues_overdue: number
  labour_avg_7d: number | null
  labour_avg_30d: number | null
}

const sum3 = (a: { pipe_m: number; manholes: number; ics: number }, b: { pipe_m: number; manholes: number; ics: number }) => ({
  pipe_m: a.pipe_m + b.pipe_m, manholes: a.manholes + b.manholes, ics: a.ics + b.ics,
})
const zero3 = () => ({ pipe_m: 0, manholes: 0, ics: 0 })

function labourAvg(logs: LabourLike[], wards: number[], days: number, today: Date) {
  const from = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10)
  const rows = logs.filter((l) => wards.includes(l.ward) && l.log_date >= from)
  if (!rows.length) return null
  const byDay = new Map<string, number>()
  for (const r of rows) byDay.set(r.log_date, (byDay.get(r.log_date) ?? 0) + r.labourers)
  return Math.round([...byDay.values()].reduce((a, b) => a + b, 0) / byDay.size)
}

/**
 * Rows at the progress-sheet's grain (one per sheet row: Zone 2's three wards are one row), grouped into
 * zones, plus the grand total.
 */
export function progressTable(
  baseline: BaselineGroupLike[],
  stretches: StretchLike[],
  issues: IssueLike[],
  labour: LabourLike[] = [],
  today = new Date(),
) {
  const groupOfWard = new Map<number, number>()
  baseline.forEach((g, i) => g.wards.forEach((w) => groupOfWard.set(w, i)))
  const rows: AreaRow[] = baseline.map((g) => ({
    key: `w${g.wards.join('-')}`,
    label: g.wards.length > 1 ? `Wards ${g.wards.join(', ')}` : `Ward ${g.wards[0]}`,
    zone: g.zone, wards: g.wards, locality: g.locality,
    sanctioned: { ...g.sanctioned }, reported: { ...g.executed }, field: emptyField(),
    issues_open: 0, issues_high: 0, issues_overdue: 0,
    labour_avg_7d: labourAvg(labour, g.wards, 7, today), labour_avg_30d: labourAvg(labour, g.wards, 30, today),
  }))
  for (const s of stretches) {
    const i = groupOfWard.get(s.ward)
    if (i !== undefined) addStretch(rows[i].field, s)
  }
  for (const it of issues) {
    if (it.status === 'resolved' || it.ward == null) continue
    const i = groupOfWard.get(it.ward)
    if (i === undefined) continue
    rows[i].issues_open++
    if (it.severity === 'high') rows[i].issues_high++
    if (isOverdue(it.due_date)) rows[i].issues_overdue++
  }
  const combine = (key: string, label: string, zone: number, list: AreaRow[]): AreaRow => {
    const f = emptyField()
    for (const r of list) for (const k of Object.keys(f) as (keyof FieldFigures)[]) f[k] += r.field[k]
    const wards = list.flatMap((r) => r.wards)
    return {
      key, label, zone, wards, locality: null,
      sanctioned: list.reduce((a, r) => sum3(a, r.sanctioned), zero3()),
      reported: list.reduce((a, r) => sum3(a, r.reported), zero3()),
      field: f,
      issues_open: list.reduce((a, r) => a + r.issues_open, 0),
      issues_high: list.reduce((a, r) => a + r.issues_high, 0),
      issues_overdue: list.reduce((a, r) => a + r.issues_overdue, 0),
      labour_avg_7d: labourAvg(labour, wards, 7, today),
      labour_avg_30d: labourAvg(labour, wards, 30, today),
    }
  }
  const zones = [1, 2, 3, 4].map((z) => ({ zone: combine(`z${z}`, `Zone ${z}`, z, rows.filter((r) => r.zone === z)), rows: rows.filter((r) => r.zone === z) }))
  const total = combine('total', 'All zones', 0, rows)
  return { zones, total }
}

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)
