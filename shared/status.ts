/**
 * Road-stretch status model, shared by the API server (Node runs this file directly) and the web app.
 *
 * A stretch records the Commissioner's 18 field items in six buckets:
 *   A sewer work · B excavation · C restoration · D motorability · E utilities damage · F public hazards
 * The overall stage (line colour), the tags shown on the map, validation and the issues raised from
 * utilities / hazards are all derived here, so server and app always agree.
 */

export type Pipeline = 'not_started' | 'partial' | 'laid'
export type Excavation = 'none' | 'road_cut' | 'trench_open' | 'backfilled'
export type Restoration = 'not_due' | 'pending' | 'restored_curing_pending' | 'restored_curing_done'
/**
 * Road type being restored (v1.25). The four restoration steps are the same for every type; only their wording
 * differs (CC: curing; gravel: compaction). Records made before v1.25 have no type and are CC roads.
 */
export type Surface = 'cc' | 'gravel'
export type Motorable = 'yes' | 'difficult' | 'no'
export type Approval = 'none' | 'pending' | 'approved' | 'rejected'

export interface StretchStatus {
  sewer: {
    pipeline: Pipeline // items 1-2
    pipe_laid_m: number | null // for partial
    manholes_built: number // item 3
    ics_built: number // item 4
  }
  excavation: {
    stage: Excavation // items 6-8
    cut_length_m: number | null
  }
  restoration: {
    stage: Restoration // items 9-12 (12 = approval)
    surface: Surface // road type (v1.25), default 'cc'
  }
  motorable: Motorable // item 13
  utilities: {
    taps_broken: number // item 14
    taps_restored: number
    water_leaks: number // item 15
    water_leaks_fixed: number
    drain_clogged: boolean // item 16
  }
  hazards: {
    water_stagnation: boolean // item 17
    potholes: number // item 18
    uneven_backfill: boolean
  }
}

export function defaultStatus(): StretchStatus {
  return {
    sewer: { pipeline: 'not_started', pipe_laid_m: null, manholes_built: 0, ics_built: 0 },
    excavation: { stage: 'none', cut_length_m: null },
    restoration: { stage: 'not_due', surface: 'cc' },
    motorable: 'yes',
    utilities: { taps_broken: 0, taps_restored: 0, water_leaks: 0, water_leaks_fixed: 0, drain_clogged: false },
    hazards: { water_stagnation: false, potholes: 0, uneven_backfill: false },
  }
}

/** Fill any missing fields from defaults (older records, partial bulk patches). */
export function normaliseStatus(s: Partial<StretchStatus> | null | undefined): StretchStatus {
  const d = defaultStatus()
  if (!s) return d
  return {
    sewer: { ...d.sewer, ...(s.sewer ?? {}) },
    excavation: { ...d.excavation, ...(s.excavation ?? {}) },
    restoration: { ...d.restoration, ...(s.restoration ?? {}) },
    motorable: s.motorable ?? d.motorable,
    utilities: { ...d.utilities, ...(s.utilities ?? {}) },
    hazards: { ...d.hazards, ...(s.hazards ?? {}) },
  }
}

// ---------------------------------------------------------------- labels (form + legend)

export const OPTIONS = {
  pipeline: [
    { v: 'not_started', label: 'Pipeline laying not started' },
    { v: 'partial', label: 'Pipeline partly laid' },
    { v: 'laid', label: 'Pipeline laid' },
  ],
  excavation: [
    { v: 'none', label: 'No road cutting yet' },
    { v: 'road_cut', label: 'Road cut' },
    { v: 'trench_open', label: 'Trench open' },
    { v: 'backfilled', label: 'Back-filled with gravel' },
  ],
  restoration: [
    { v: 'not_due', label: 'Not due yet' },
    { v: 'pending', label: 'CC road restoration pending' },
    { v: 'restored_curing_pending', label: 'CC restored, curing not done' },
    { v: 'restored_curing_done', label: 'CC restored, curing done' },
  ],
  surface: [
    { v: 'cc', label: 'CC road' },
    { v: 'gravel', label: 'Gravel road' },
  ],
  motorable: [
    { v: 'yes', label: 'Motorable' },
    { v: 'difficult', label: 'Motorable with difficulty' },
    { v: 'no', label: 'Not motorable' },
  ],
} as const

export const label = (group: keyof typeof OPTIONS, v: string): string =>
  (OPTIONS[group] as readonly { v: string; label: string }[]).find((o) => o.v === v)?.label ?? v

/** The restoration steps worded for the road type (the stored values are the same for every type). */
export const RESTORATION_OPTIONS: Record<Surface, readonly { v: Restoration; label: string }[]> = {
  cc: OPTIONS.restoration,
  gravel: [
    { v: 'not_due', label: 'Not due yet' },
    { v: 'pending', label: 'Gravel road restoration pending' },
    { v: 'restored_curing_pending', label: 'Gravel laid, not compacted' },
    { v: 'restored_curing_done', label: 'Gravel laid and compacted' },
  ],
}
/** Wording when several road types are involved (bulk updates, legends). */
export const RESTORATION_GENERIC: readonly { v: Restoration; label: string }[] = [
  { v: 'not_due', label: 'Not due yet' },
  { v: 'pending', label: 'Restoration pending' },
  { v: 'restored_curing_pending', label: 'Restored, curing / compaction not done' },
  { v: 'restored_curing_done', label: 'Restored, curing / compaction done' },
]
export const surfaceOf = (s: { restoration?: { surface?: string } } | null | undefined): Surface =>
  s?.restoration?.surface === 'gravel' ? 'gravel' : 'cc'
export const restorationLabel = (stage: string, surface: string = 'cc'): string =>
  (RESTORATION_OPTIONS[surface === 'gravel' ? 'gravel' : 'cc'].find((o) => o.v === stage)?.label) ?? stage
/** Short road-type word for tags and tables: "CC" or "Gravel". */
export const surfaceWord = (surface: string) => (surface === 'gravel' ? 'Gravel' : 'CC')

// ---------------------------------------------------------------- overall stage (line colour)

export type Stage = 'not_started' | 'in_progress' | 'backfilled' | 'curing' | 'awaiting_approval' | 'approved'

export const STAGES: { key: Stage; label: string; colour: string; hint: string }[] = [
  { key: 'not_started', label: 'Not started', colour: '#94a3b8', hint: 'No pipe laid, no road cut' },
  { key: 'in_progress', label: 'Work in progress', colour: '#3b82f6', hint: 'Road cut, trench open or pipe being laid' },
  { key: 'backfilled', label: 'Back-filled, restoration pending', colour: '#f97316', hint: 'Trench filled; road not yet restored' },
  { key: 'curing', label: 'Restored, curing / compaction', colour: '#eab308', hint: 'CC laid and curing, or gravel laid and not compacted' },
  { key: 'awaiting_approval', label: 'Curing done, awaiting approval', colour: '#a3e635', hint: 'Ready for the Commissioner to approve' },
  { key: 'approved', label: 'Restored and approved', colour: '#16a34a', hint: 'Approved by the Commissioner' },
]
export const STAGE_COLOUR = Object.fromEntries(STAGES.map((s) => [s.key, s.colour])) as Record<Stage, string>
export const ISSUE_COLOUR = '#dc2626'

export function deriveStage(s: StretchStatus, approval: Approval): Stage {
  if (approval === 'approved' && s.restoration.stage === 'restored_curing_done') return 'approved'
  if (s.restoration.stage === 'restored_curing_done') return 'awaiting_approval'
  if (s.restoration.stage === 'restored_curing_pending') return 'curing'
  if (s.excavation.stage === 'backfilled' || s.restoration.stage === 'pending') return 'backfilled'
  if (s.excavation.stage !== 'none' || s.sewer.pipeline !== 'not_started' || s.sewer.manholes_built > 0) return 'in_progress'
  return 'not_started'
}

// ---------------------------------------------------------------- map themes (one bucket at a time)

export type Theme = 'overall' | 'sewer' | 'restoration' | 'motorable' | 'utilities' | 'hazards'

export const THEMES: { key: Theme; label: string; legend: { label: string; colour: string }[] }[] = [
  { key: 'overall', label: 'Overall', legend: STAGES.map((s) => ({ label: s.label, colour: s.colour })) },
  {
    key: 'sewer', label: 'Sewer work',
    legend: [
      { label: 'Not started', colour: '#94a3b8' },
      { label: 'Pipe partly laid', colour: '#93c5fd' },
      { label: 'Pipe laid, manholes pending', colour: '#3b82f6' },
      { label: 'Pipe and all manholes done', colour: '#1d4ed8' },
    ],
  },
  {
    key: 'restoration', label: 'Road restoration',
    legend: [
      { label: 'Not due', colour: '#94a3b8' },
      { label: 'Restoration pending', colour: '#f97316' },
      { label: 'Restored, curing / compaction not done', colour: '#eab308' },
      { label: 'Curing / compaction done, awaiting approval', colour: '#a3e635' },
      { label: 'Approved', colour: '#16a34a' },
    ],
  },
  {
    key: 'motorable', label: 'Motorability',
    legend: [
      { label: 'Motorable', colour: '#16a34a' },
      { label: 'With difficulty', colour: '#f59e0b' },
      { label: 'Not motorable', colour: '#dc2626' },
    ],
  },
  {
    key: 'utilities', label: 'Utilities damage',
    legend: [
      { label: 'No damage reported', colour: '#94a3b8' },
      { label: '1-2 items', colour: '#fb923c' },
      { label: '3 or more items', colour: '#dc2626' },
    ],
  },
  {
    key: 'hazards', label: 'Public hazards',
    legend: [
      { label: 'None reported', colour: '#94a3b8' },
      { label: 'One hazard', colour: '#c084fc' },
      { label: 'Two or more', colour: '#7e22ce' },
    ],
  },
]

/** Colour of a stretch under a theme. planned_mh = manholes on the plan within the stretch. */
export function themeColour(theme: Theme, s: StretchStatus, approval: Approval, planned_mh: number): string {
  switch (theme) {
    case 'overall':
      return STAGE_COLOUR[deriveStage(s, approval)]
    case 'sewer':
      if (s.sewer.pipeline === 'not_started') return '#94a3b8'
      if (s.sewer.pipeline === 'partial') return '#93c5fd'
      return planned_mh > 0 && s.sewer.manholes_built >= planned_mh ? '#1d4ed8' : '#3b82f6'
    case 'restoration':
      if (approval === 'approved' && s.restoration.stage === 'restored_curing_done') return '#16a34a'
      return { not_due: '#94a3b8', pending: '#f97316', restored_curing_pending: '#eab308', restored_curing_done: '#a3e635' }[s.restoration.stage]
    case 'motorable':
      return { yes: '#16a34a', difficult: '#f59e0b', no: '#dc2626' }[s.motorable]
    case 'utilities': {
      const n = utilityCount(s)
      return n === 0 ? '#94a3b8' : n < 3 ? '#fb923c' : '#dc2626'
    }
    case 'hazards': {
      const n = hazardCount(s)
      return n === 0 ? '#94a3b8' : n === 1 ? '#c084fc' : '#7e22ce'
    }
  }
}

export const tapsPending = (s: StretchStatus) => Math.max(0, s.utilities.taps_broken - s.utilities.taps_restored)
export const leaksPending = (s: StretchStatus) => Math.max(0, s.utilities.water_leaks - s.utilities.water_leaks_fixed)
export const utilityCount = (s: StretchStatus) =>
  tapsPending(s) + leaksPending(s) + (s.utilities.drain_clogged ? 1 : 0)
export const hazardCount = (s: StretchStatus) =>
  (s.hazards.water_stagnation ? 1 : 0) + (s.hazards.potholes > 0 ? 1 : 0) + (s.hazards.uneven_backfill ? 1 : 0)

// ---------------------------------------------------------------- tags (multi-status chips)

export type TagTone = 'neutral' | 'progress' | 'good' | 'warn' | 'bad'
export interface Tag { key: string; text: string; tone: TagTone }

/** Item 5: sewer combination in one short code, e.g. "Pipe ✓ · MH 8/12 · IC 3". */
export function sewerCombo(s: StretchStatus, planned_mh: number): string {
  const pipe = s.sewer.pipeline === 'laid' ? 'Pipe ✓' : s.sewer.pipeline === 'partial' ? `Pipe ${s.sewer.pipe_laid_m ?? '?'} m` : 'Pipe ✗'
  const mh = planned_mh > 0 ? `MH ${s.sewer.manholes_built}/${planned_mh}` : `MH ${s.sewer.manholes_built}`
  return `${pipe} · ${mh} · IC ${s.sewer.ics_built}`
}

/** Tags in priority order; the map shows the first four. */
export function deriveTags(s: StretchStatus, approval: Approval, planned_mh: number): Tag[] {
  const t: Tag[] = []
  const taps = tapsPending(s)
  const leaks = leaksPending(s)
  if (s.motorable === 'no') t.push({ key: 'not_motorable', text: 'Not motorable', tone: 'bad' })
  if (s.utilities.drain_clogged) t.push({ key: 'drain', text: 'Drain clogged', tone: 'bad' })
  if (taps > 0) t.push({ key: 'taps', text: `${taps} tap${taps > 1 ? 's' : ''} broken`, tone: 'bad' })
  if (leaks > 0) t.push({ key: 'leak', text: `${leaks} water leak${leaks > 1 ? 's' : ''}`, tone: 'bad' })
  if (s.hazards.water_stagnation) t.push({ key: 'stagnation', text: 'Water stagnation', tone: 'warn' })
  if (s.hazards.potholes > 0) t.push({ key: 'potholes', text: `${s.hazards.potholes} pothole${s.hazards.potholes > 1 ? 's' : ''}`, tone: 'warn' })
  if (s.hazards.uneven_backfill) t.push({ key: 'uneven', text: 'Uneven back-fill', tone: 'warn' })
  if (s.motorable === 'difficult') t.push({ key: 'difficult', text: 'Motorable with difficulty', tone: 'warn' })
  if (s.excavation.stage === 'trench_open') t.push({ key: 'trench', text: 'Trench open', tone: 'warn' })
  else if (s.excavation.stage === 'road_cut') t.push({ key: 'cut', text: 'Road cut', tone: 'progress' })
  else if (s.excavation.stage === 'backfilled') t.push({ key: 'backfilled', text: 'Back-filled', tone: 'progress' })
  if (s.sewer.pipeline !== 'not_started' || s.sewer.manholes_built > 0) t.push({ key: 'sewer', text: sewerCombo(s, planned_mh), tone: 'progress' })
  const r = s.restoration.stage
  const gravel = surfaceOf(s) === 'gravel'
  const word = gravel ? 'Gravel' : 'CC'
  if (r === 'pending') t.push({ key: 'restoration', text: `${word} restoration pending`, tone: 'warn' })
  if (r === 'restored_curing_pending') t.push({ key: 'restoration', text: gravel ? 'Gravel laid, not compacted' : 'CC restored, curing pending', tone: 'progress' })
  if (r === 'restored_curing_done') {
    t.push(approval === 'approved'
      ? { key: 'restoration', text: `${word} restored · approved`, tone: 'good' }
      : approval === 'rejected'
        ? { key: 'restoration', text: 'Restoration rejected · redo', tone: 'bad' }
        : { key: 'restoration', text: `${gravel ? 'Compacted' : 'Curing done'} · awaiting approval`, tone: 'good' })
  }
  return t
}

/** Small map badges (letters) for issues on a stretch, in display order. */
export function badges(s: StretchStatus): string[] {
  const b: string[] = []
  if (tapsPending(s) > 0) b.push('T')
  if (leaksPending(s) > 0) b.push('L')
  if (s.utilities.drain_clogged) b.push('D')
  if (s.hazards.water_stagnation) b.push('W')
  if (s.hazards.potholes > 0) b.push('P')
  return b.slice(0, 4)
}
export const BADGE_INFO: Record<string, { label: string; colour: string }> = {
  T: { label: 'Tap connections broken', colour: '#dc2626' },
  L: { label: 'Water pipe leak', colour: '#0ea5e9' },
  D: { label: 'Drain clogged with gravel', colour: '#92400e' },
  W: { label: 'Water stagnation', colour: '#2563eb' },
  P: { label: 'Potholes in trench', colour: '#7c3aed' },
}

// ---------------------------------------------------------------- issues raised from a stretch

export type IssueKind = 'taps_broken' | 'water_leak' | 'drain_clogged' | 'water_stagnation' | 'potholes' | 'uneven_backfill' | 'not_motorable'
  | 'drain_damage' | 'culvert_damage' | 'other'
/** Kinds reported by hand only (not one of the 18 status items of a stretch). */
export type ManualIssueKind = 'drain_damage' | 'culvert_damage' | 'other'

export const ISSUE_KINDS: { key: IssueKind; label: string; severity: 'low' | 'medium' | 'high' }[] = [
  { key: 'drain_clogged', label: 'Drain clogged with gravel', severity: 'high' },
  { key: 'taps_broken', label: 'Tap connections broken', severity: 'high' },
  { key: 'water_leak', label: 'Water pipe leakage', severity: 'high' },
  { key: 'not_motorable', label: 'Road not motorable', severity: 'medium' },
  { key: 'water_stagnation', label: 'Water stagnation', severity: 'medium' },
  { key: 'potholes', label: 'Potholes in trench', severity: 'medium' },
  { key: 'uneven_backfill', label: 'Uneven back-fill', severity: 'low' },
  { key: 'drain_damage', label: 'Drain damaged', severity: 'medium' },
  { key: 'culvert_damage', label: 'Culvert broken / damaged', severity: 'high' },
  { key: 'other', label: 'Other', severity: 'medium' },
]
export const issueLabel = (k: string) => ISSUE_KINDS.find((i) => i.key === k)?.label ?? k

/** Issues a stretch's status implies, with their counts (0 = none). */
export function impliedIssues(s: StretchStatus): Record<Exclude<IssueKind, ManualIssueKind>, number> {
  return {
    taps_broken: tapsPending(s),
    water_leak: leaksPending(s),
    drain_clogged: s.utilities.drain_clogged ? 1 : 0,
    water_stagnation: s.hazards.water_stagnation ? 1 : 0,
    potholes: s.hazards.potholes,
    uneven_backfill: s.hazards.uneven_backfill ? 1 : 0,
    not_motorable: s.motorable === 'no' ? 1 : 0,
  }
}

// ---------------------------------------------------------------- validation

export interface CheckContext {
  length_m: number // stretch length on the map
  planned_mh: number // manholes on the plan within the stretch
  has_photo: boolean // at least one photo attached to this update (needed only for restoration claims)
  previous?: StretchStatus
}
export interface CheckResult { errors: string[]; warnings: string[] }

const isCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 10000

export function checkStatus(s: StretchStatus, ctx: CheckContext): CheckResult {
  const errors: string[] = []
  const warnings: string[] = []
  const counts: [string, number][] = [
    ['Manholes built', s.sewer.manholes_built], ['ICs built', s.sewer.ics_built],
    ['Taps broken', s.utilities.taps_broken], ['Taps restored', s.utilities.taps_restored],
    ['Water leaks', s.utilities.water_leaks], ['Leaks fixed', s.utilities.water_leaks_fixed], ['Potholes', s.hazards.potholes],
  ]
  for (const [k, v] of counts) if (!isCount(v)) errors.push(`${k} must be a whole number of 0 or more.`)

  if (s.sewer.pipeline === 'partial') {
    if (s.sewer.pipe_laid_m == null || !(s.sewer.pipe_laid_m > 0)) errors.push('Enter how many metres of pipe are laid.')
    else if (s.sewer.pipe_laid_m > ctx.length_m * 1.5 + 10) errors.push(`Pipe laid (${s.sewer.pipe_laid_m} m) is far longer than the stretch (${Math.round(ctx.length_m)} m).`)
  }
  if (s.excavation.cut_length_m != null && s.excavation.cut_length_m > ctx.length_m * 1.5 + 10) {
    warnings.push(`Road cut length (${s.excavation.cut_length_m} m) is longer than the stretch (${Math.round(ctx.length_m)} m).`)
  }
  if (ctx.planned_mh > 0 && s.sewer.manholes_built > ctx.planned_mh) {
    warnings.push(`${s.sewer.manholes_built} manholes built, but the plan shows ${ctx.planned_mh} on this stretch.`)
  }
  if (s.utilities.taps_restored > s.utilities.taps_broken) errors.push('Taps restored cannot exceed taps broken.')
  if (s.utilities.water_leaks_fixed > s.utilities.water_leaks) errors.push('Leaks fixed cannot exceed water pipe leakages.')
  if (s.sewer.manholes_built > 0 && s.sewer.pipeline === 'not_started') warnings.push('Manholes built but pipeline marked not started.')
  if (s.restoration.stage !== 'not_due' && s.restoration.stage !== 'pending' && s.excavation.stage !== 'backfilled' && s.sewer.pipeline === 'not_started') {
    warnings.push('Road marked restored, but no pipe laying or back-filling recorded.')
  }
  if (s.excavation.stage === 'backfilled' && s.sewer.pipeline === 'not_started') warnings.push('Trench back-filled but pipeline marked not started.')

  // Evidence: a restoration claim needs a photo (the Commissioner approves on it). Photos of damage are optional.
  // Changing the road type of a road already marked restored is a new restoration claim too.
  const restorationChanged = !ctx.previous || ctx.previous.restoration.stage !== s.restoration.stage
    || surfaceOf(ctx.previous) !== surfaceOf(s)
  if (!ctx.has_photo && restorationChanged && s.restoration.stage.startsWith('restored')) errors.push('Attach a photo of the restored road.')
  return { errors, warnings }
}

/** Which approval state a status change leads to. */
export function nextApproval(prev: Approval, s: StretchStatus): Approval {
  if (s.restoration.stage !== 'restored_curing_done') return 'none'
  return prev === 'approved' ? 'approved' : prev === 'rejected' ? 'rejected' : 'pending'
}

// ---------------------------------------------------------------- diffs (audit trail)

export interface FieldChange { path: string; from: unknown; to: unknown }

export function diffStatus(a: StretchStatus, b: StretchStatus): FieldChange[] {
  const out: FieldChange[] = []
  const walk = (x: Record<string, unknown>, y: Record<string, unknown>, p: string) => {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const xv = x[k], yv = y[k], path = p ? `${p}.${k}` : k
      if (xv && yv && typeof xv === 'object' && typeof yv === 'object') walk(xv as Record<string, unknown>, yv as Record<string, unknown>, path)
      else if (xv !== yv) out.push({ path, from: xv, to: yv })
    }
  }
  walk(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>, '')
  return out
}

/** Apply only the given field changes onto a status (used for bulk updates and conflict-free merges). */
export function applyChanges(s: StretchStatus, changes: { path: string; to: unknown }[]): StretchStatus {
  const out = JSON.parse(JSON.stringify(s)) as Record<string, Record<string, unknown> | unknown>
  for (const c of changes) {
    const parts = c.path.split('.')
    let o = out as Record<string, unknown>
    for (const p of parts.slice(0, -1)) o = (o[p] ??= {}) as Record<string, unknown>
    o[parts.at(-1)!] = c.to
  }
  return normaliseStatus(out as Partial<StretchStatus>)
}

export const FIELD_LABELS: Record<string, string> = {
  'sewer.pipeline': 'Pipeline',
  'sewer.pipe_laid_m': 'Pipe laid (m)',
  'sewer.manholes_built': 'Manholes built',
  'sewer.ics_built': 'ICs built',
  'excavation.stage': 'Excavation',
  'excavation.cut_length_m': 'Road cut length (m)',
  'restoration.stage': 'Road restoration',
  'restoration.surface': 'Road type',
  motorable: 'Motorability',
  'utilities.taps_broken': 'Taps broken',
  'utilities.taps_restored': 'Taps restored',
  'utilities.water_leaks': 'Water leaks',
  'utilities.water_leaks_fixed': 'Leaks fixed',
  'utilities.drain_clogged': 'Drain clogged',
  'hazards.water_stagnation': 'Water stagnation',
  'hazards.potholes': 'Potholes',
  'hazards.uneven_backfill': 'Uneven back-fill',
}

/** A field value in words. The status snapshot (if given) words restoration steps for its road type. */
export function describeValue(path: string, v: unknown, status?: { restoration?: { surface?: string } } | null): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (path === 'sewer.pipeline') return label('pipeline', String(v))
  if (path === 'excavation.stage') return label('excavation', String(v))
  if (path === 'restoration.stage') {
    // Without the road's status (e.g. the activity feed) use wording that fits every road type.
    return status === undefined ? (RESTORATION_GENERIC.find((o) => o.v === v)?.label ?? String(v)) : restorationLabel(String(v), surfaceOf(status))
  }
  if (path === 'restoration.surface') return label('surface', String(v))
  if (path === 'motorable') return label('motorable', String(v))
  return String(v)
}
