import ExcelJS from 'exceljs';
import { STAGES, ISSUE_KINDS, label, normaliseStatus, restorationLabel, surfaceOf } from '../../../shared/status.ts';
import { addStretch, emptyField, progressTable } from '../../../shared/stats.ts';
import { basePipesById, basePlan, network, reference, wardOfGeometry } from '../reference.js';
import { listLabour } from './labour.js';

const issueLabel = (k) => ISSUE_KINDS.find((i) => i.key === k)?.label ?? k;
// Report dates in local (India) time; TIME_ZONE can override.
const TZ = process.env.TIME_ZONE ?? 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
// Excel has no time zones: write the India wall-clock time, so 13:38 IST shows as 13:38.
const IST_MS = 330 * 60000;
const ist = (v) => (v ? new Date(new Date(v).getTime() + IST_MS) : null);
const istText = (v) => (v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) : '');
const dateCols = (ws, ...cols) => { for (const c of cols) ws.getColumn(c).numFmt = 'dd-mmm-yyyy hh:mm' };

async function loadAll(db) {
  const stretches = (await db.query(
    `select s.*, u.name as updated_by_name from stretches s left join users u on u.id = s.updated_by
     where s.deleted_at is null and s.record_state <> 'rejected' order by s.code`,
  )).rows.map((r) => ({ ...r, status: normaliseStatus(r.status) }));
  const issues = (await db.query(
    `select i.*, to_char(i.due_date, 'YYYY-MM-DD') as due_date, s.code as stretch_code, ru.name as reported_by_name, xu.name as resolved_by_name
     from issues i left join stretches s on s.id = i.stretch_id left join users ru on ru.id = i.reported_by
     left join users xu on xu.id = i.resolved_by order by i.reported_at`,
  )).rows;
  const labour = (await listLabour(db)).reverse(); // oldest first
  return { stretches, issues, labour };
}

/** Inputs of the progress table: wards, the current plan network, and what staff recorded. */
function planInput(stretches, issues, labour) {
  return {
    wards: reference.wards.map((w) => ({ ward: w.properties.ward, zone: w.properties.zone, locality: w.properties.locality ?? null })),
    pipes: [...network.pipes.values()].map((f) => ({ id: f.properties.id, ward: f.properties.ward ?? null, zone: f.properties.zone, length_m: f.properties.length_m ?? 0 })),
    manholes: [...network.manholes.values()].map((f) => ({ id: f.properties.id, ward: f.properties.ward ?? null, zone: f.properties.zone })),
    stretches, issues, labour,
  };
}

/** Monday 00:00 UTC of the week containing d. */
function weekStart(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

// KML colours are aabbggrr.
const kmlColour = (hex, alpha = 'ff') => `${alpha}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;
function addIssuesSheet(wb, issues) {
  const is = wb.addWorksheet('Issues', { views: [{ state: 'frozen', ySplit: 1 }] });
  is.columns = [
    ['Code', 9], ['Issue', 26], ['Count', 7], ['Zone', 6], ['Ward', 6], ['Stretch', 10], ['Severity', 9], ['Status', 10], ['Assigned to', 20],
    ['Due', 11], ['Reported by', 18], ['Reported', 18], ['Resolved by', 18], ['Resolved', 18], ['Resolution', 40], ['Description', 40],
  ].map(([header, width]) => ({ header, width }));
  is.getRow(1).font = { bold: true };
  for (const i of issues) {
    is.addRow([i.code, issueLabel(i.kind), i.count, i.zone, i.ward, i.stretch_code, i.severity, i.status, i.assigned_to, i.due_date,
      i.reported_by_name, ist(i.reported_at), i.resolved_by_name, ist(i.resolved_at), i.resolution_note, i.description]);
  }
  dateCols(is, 12, 14);
}

function addLabourSheet(wb, labour) {
  const ls = wb.addWorksheet('Labour', { views: [{ state: 'frozen', ySplit: 1 }] });
  ls.columns = [['Date', 12], ['Zone', 6], ['Labourers', 10], ['Machines', 10], ['Note', 36], ['Entered by', 20], ['Entered', 18],
    ['Last changed by', 20], ['Last changed', 18]].map(([header, width]) => ({ header, width }));
  ls.getRow(1).font = { bold: true };
  for (const l of labour) ls.addRow([l.log_date, l.zone, l.labourers, l.machines, l.note, l.user_name, ist(l.created_at), l.updated_by_name, ist(l.updated_at)]);
  dateCols(ls, 7, 9);
  const n = labour.length + 1;
  if (labour.length) ls.addRow(['Total', '', { formula: `SUM(C2:C${n})` }, { formula: `SUM(D2:D${n})` }]).font = { bold: true };
}

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

export function registerReportRoutes(app, db) {
  const auth = { preHandler: app.authenticate };

  // The plan network today: the drawings plus approved changes, how it changed, and what is proposed.
  async function planSummary() {
    const edits = (await db.query('select kind, op, feature_id, properties, at from network_edits order by id')).rows;
    const len = new Map([...network.pipes.values()].map((f) => [f.properties.id, f.properties.length_m ?? 0]));
    for (const f of basePipesById.values()) if (!len.has(f.properties.id)) len.set(f.properties.id, f.properties.length_m ?? 0);
    const ch = { added_pipes: 0, added_pipe_m: 0, removed_pipes: 0, removed_pipe_m: 0, added_manholes: 0, removed_manholes: 0, last_change_at: null };
    for (const e of edits) {
      const m = e.kind === 'pipe' ? (e.op === 'add' ? e.properties?.length_m ?? 0 : len.get(e.feature_id) ?? 0) : 0;
      if (e.properties?.length_m != null) len.set(e.feature_id, e.properties.length_m);
      if (e.kind === 'pipe' && e.op === 'add') { ch.added_pipes++; ch.added_pipe_m += m }
      if (e.kind === 'pipe' && e.op === 'delete') { ch.removed_pipes++; ch.removed_pipe_m += m }
      if (e.kind === 'manhole') e.op === 'add' ? ch.added_manholes++ : ch.removed_manholes++;
      ch.last_change_at = e.at;
    }
    const current = {
      pipe_m: [...network.pipes.values()].reduce((a, f) => a + (f.properties.length_m ?? 0), 0),
      pipes: network.pipes.size, manholes: network.manholes.size,
    };
    const pend = (await db.query("select entity, action, target_id, payload from change_requests where status = 'pending' and entity in ('pipe', 'manhole')")).rows;
    const pending = {
      pipe_add: pend.filter((r) => r.entity === 'pipe' && r.action === 'add').length,
      pipe_add_m: pend.filter((r) => r.entity === 'pipe' && r.action === 'add').reduce((a, r) => a + (r.payload?.properties?.length_m ?? 0), 0),
      pipe_delete: pend.filter((r) => r.entity === 'pipe' && r.action === 'delete').length,
      pipe_delete_m: pend.filter((r) => r.entity === 'pipe' && r.action === 'delete').reduce((a, r) => a + (len.get(r.target_id) ?? 0), 0),
      manhole_add: pend.filter((r) => r.entity === 'manhole' && r.action === 'add').length,
      manhole_delete: pend.filter((r) => r.entity === 'manhole' && r.action === 'delete').length,
    };
    return { base: basePlan, current, changes: ch, pending, edits };
  }

  app.get('/api/stats/plan', auth, async () => {
    const { edits, ...rest } = await planSummary();
    return rest;
  });

  // Progress over time: the history replayed week by week (field figures), the plan network length at each week
  // end (it steps up or down on the day a network change is approved), and issues opened / resolved per week.
  app.get('/api/stats/timeline', auth, async () => {
    const versions = (await db.query(
      `select v.stretch_id, v.version, v.kind, v.at, v.status, v.approval, s.length_m, s.ward, s.zone, s.planned_mh, s.pipe_ids
       from stretch_versions v join stretches s on s.id = v.stretch_id order by v.at, v.version`,
    )).rows;
    const issues = (await db.query('select reported_at, resolved_at from issues')).rows;
    if (!versions.length) return { weeks: [] };
    const { edits } = await planSummary();
    const pipeLen = new Map();
    for (const f of basePipesById.values()) pipeLen.set(f.properties.id, f.properties.length_m ?? 0);
    const editDeltas = edits.filter((e) => e.kind === 'pipe').map((e) => {
      const m = e.op === 'add' ? (e.properties?.length_m ?? 0) : -(pipeLen.get(e.feature_id) ?? 0);
      if (e.op === 'add') pipeLen.set(e.feature_id, e.properties?.length_m ?? 0);
      return { at: new Date(e.at), m };
    });
    const state = new Map();
    const weeks = [];
    let i = 0;
    const end = new Date();
    for (let w = weekStart(new Date(versions[0].at)); w <= end; w = new Date(w.getTime() + 7 * 86400000)) {
      const weekEnd = new Date(Math.min(w.getTime() + 7 * 86400000, end.getTime() + 1));
      while (i < versions.length && new Date(versions[i].at) < weekEnd) {
        const v = versions[i++];
        if (v.kind === 'delete') state.delete(v.stretch_id);
        else state.set(v.stretch_id, { ...v, status: normaliseStatus(v.status), open_issues: 0 });
      }
      const f = emptyField();
      for (const s of state.values()) addStretch(f, s);
      const open = issues.filter((x) => new Date(x.reported_at) < weekEnd && (!x.resolved_at || new Date(x.resolved_at) >= weekEnd)).length;
      const opened = issues.filter((x) => new Date(x.reported_at) >= w && new Date(x.reported_at) < weekEnd).length;
      const resolved = issues.filter((x) => x.resolved_at && new Date(x.resolved_at) >= w && new Date(x.resolved_at) < weekEnd).length;
      const plan_m = basePlan.pipe_m + editDeltas.filter((d) => d.at < weekEnd).reduce((a, d) => a + d.m, 0);
      weeks.push({ week: w.toISOString().slice(0, 10), ...f, open_issues: open, issues_opened: opened, issues_resolved: resolved, plan_m });
    }
    return { weeks };
  });

  // The last 7 days in the field: updates, new roads, restorations, issues, labour and who was active.
  app.get('/api/stats/week', auth, async () => {
    const since = new Date(Date.now() - 7 * 86400000);
    const v = (await db.query(
      `select v.kind, v.changes, v.user_id, v.stretch_id, u.name from stretch_versions v left join users u on u.id = v.user_id where v.at >= $1`, [since],
    )).rows;
    const edits = v.filter((x) => ['create', 'update', 'bulk', 'geometry'].includes(x.kind));
    const restored = new Set(edits.filter((x) => x.changes.some((c) => c.path === 'restoration.stage' && String(c.to).startsWith('restored'))).map((x) => x.stretch_id));
    const iss = (await db.query(
      `select count(*) filter (where reported_at >= $1)::int as opened, count(*) filter (where resolved_at >= $1)::int as resolved from issues`, [since],
    )).rows[0];
    const lab = (await db.query(
      `select count(distinct log_date)::int as days, coalesce(sum(labourers), 0)::int as labourers from labour_entries where log_date >= $1::date`,
      [since.toLocaleDateString('en-CA', { timeZone: TZ })],
    )).rows[0];
    const people = new Map();
    for (const x of edits) if (x.name) people.set(x.name, (people.get(x.name) ?? 0) + 1);
    return {
      updates: edits.length,
      new_stretches: edits.filter((x) => x.kind === 'create').length,
      stretches_touched: new Set(edits.map((x) => x.stretch_id)).size,
      restored: restored.size,
      issues_opened: iss.opened, issues_resolved: iss.resolved,
      labour_avg: lab.days ? Math.round(lab.labourers / lab.days) : null,
      active: [...people.entries()].map(([name, n]) => ({ name, updates: n })).sort((a, b) => b.updates - a.updates),
    };
  });

  // Excel workbook: a field progress sheet (ward and zone rows, plan network and what staff recorded), plus detail sheets.
  app.get('/api/export/progress.xlsx', auth, async (req, reply) => {
    const { stretches, issues, labour } = await loadAll(db);
    const table = progressTable(planInput(stretches, issues, labour));
    const plan = await planSummary();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'UGD Tracker';
    wb.created = new Date();

    const ws = wb.addWorksheet('Progress', { views: [{ state: 'frozen', xSplit: 4, ySplit: 5 }] });
    ws.addRow([`UGD field progress — generated ${today()} by ${req.user.name}`]);
    ws.addRow([`All figures are what staff recorded on the map. Plan network = the drawings (${Math.round(basePlan.pipe_m)} m) plus approved changes `
      + `(+${Math.round(plan.changes.added_pipe_m)} m, -${Math.round(plan.changes.removed_pipe_m)} m) = ${Math.round(plan.current.pipe_m)} m.`]);
    ws.addRow([]);
    const groups = [
      ['S.No', 1], ['Zone', 1], ['Ward', 1], ['Area', 1], ['Plan network', 3], ['Recorded by staff', 3],
      ['Field progress', 4], ['Road (field, m)', 6], ['Open issues', 1], ['Labour/day (7 d, zone)', 1],
    ];
    const h1 = ws.addRow(groups.flatMap(([t, n]) => [t, ...Array(n - 1).fill(null)]));
    const h2 = ws.addRow([null, null, null, null,
      'Pipeline (m)', 'Manholes', 'Pipe reaches', 'Recorded (m)', 'Not yet recorded (m)', 'Recorded %',
      'Pipe laid (m)', '% of plan', 'Manholes built', 'ICs built',
      'Road cut', 'Back-filled', 'Restored CC', 'Restored gravel', 'Approved', 'Not motorable', null, null]);
    let col = 1;
    for (const [, n] of groups) {
      if (n > 1) ws.mergeCells(4, col, 4, col + n - 1);
      else ws.mergeCells(4, col, 5, col);
      col += n;
    }
    for (const r of [h1, h2]) {
      r.font = { bold: true };
      r.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      r.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });
    }
    ws.getRow(5).height = 30;
    const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
    const line = (sno, r, isTotal) => {
      const f = r.field;
      const p = r.plan;
      const row = ws.addRow([
        sno, isTotal ? null : r.zone, isTotal ? null : r.wards.join(', '), isTotal ? r.label : r.locality ?? r.label,
        Math.round(p.pipe_m), p.manholes, p.pipes,
        Math.round(p.recorded_m), Math.round(p.pipe_m - p.recorded_m), pctOf(p.recorded_m, p.pipe_m),
        Math.round(f.pipe_laid_m), pctOf(f.pipe_laid_m, p.pipe_m), f.manholes_built, f.ics_built,
        Math.round(f.road_cut_m), Math.round(f.backfilled_m), Math.round(f.restored_cc_m), Math.round(f.restored_gravel_m),
        Math.round(f.approved_m), Math.round(f.not_motorable_m),
        r.issues_open, isTotal ? r.labour_avg_7d : null,
      ]);
      if (isTotal) {
        row.font = { bold: true };
        row.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }));
      }
      return row;
    };
    let sno = 1;
    for (const z of table.zones) {
      for (const r of z.rows) line(sno++, r, false);
      line(null, { ...z.zone, label: `Sub total for Zone ${z.zone.zone}` }, true);
    }
    line(null, { ...table.total, label: 'Total of all zones' }, true);
    ws.columns.forEach((c, i) => (c.width = i === 3 ? 30 : i < 3 ? 7 : 12));
    for (let c = 5; c <= 22; c++) ws.getColumn(c).numFmt = '#,##0';
    for (const c of [10, 12]) ws.getColumn(c).numFmt = '0.0';

    const ss = wb.addWorksheet('Stretches', { views: [{ state: 'frozen', ySplit: 1 }] });
    ss.columns = [
      ['Code', 10], ['Road', 28], ['Zone', 6], ['Ward', 6], ['Length (m)', 10], ['Plan MH', 8], ['Overall stage', 26], ['Pipeline', 22],
      ['Pipe laid (m)', 10], ['MH built', 8], ['IC built', 8], ['Excavation', 22], ['Cut length (m)', 10], ['Road type', 10], ['Road restoration', 30], ['Approval', 10],
      ['Motorability', 22], ['Taps broken', 9], ['Taps restored', 9], ['Water leaks', 9], ['Leaks fixed', 9], ['Drain clogged', 9], ['Water stagnation', 9],
      ['Potholes', 8], ['Uneven back-fill', 9], ['Open issues', 8], ['Record', 10], ['Last update', 18], ['By', 18], ['Outside ward boundary', 10],
    ].map(([header, width]) => ({ header, width }));
    ss.getRow(1).font = { bold: true };
    for (const s of stretches) {
      const st = s.status;
      ss.addRow([
        s.code, s.name, s.zone, s.ward, Math.round(s.length_m), s.planned_mh, STAGES.find((x) => x.key === s.stage)?.label,
        label('pipeline', st.sewer.pipeline), st.sewer.pipe_laid_m, st.sewer.manholes_built, st.sewer.ics_built,
        label('excavation', st.excavation.stage), st.excavation.cut_length_m, label('surface', surfaceOf(st)), restorationLabel(st.restoration.stage, surfaceOf(st)), s.approval,
        label('motorable', st.motorable), st.utilities.taps_broken, st.utilities.taps_restored, st.utilities.water_leaks, st.utilities.water_leaks_fixed,
        st.utilities.drain_clogged ? 'Yes' : 'No', st.hazards.water_stagnation ? 'Yes' : 'No', st.hazards.potholes,
        st.hazards.uneven_backfill ? 'Yes' : 'No', s.open_issues, s.record_state, ist(s.updated_at), s.updated_by_name,
        wardOfGeometry(s.geometry).inside ? '' : 'Yes',
      ]);
    }
    dateCols(ss, 28);

    addIssuesSheet(wb, issues);

    addLabourSheet(wb, labour);

    const cr = (await db.query(
      `select c.*, ru.name as rn, du.name as dn from change_requests c left join users ru on ru.id = c.requested_by
       left join users du on du.id = c.decided_by order by c.requested_at`,
    )).rows;
    const cs = wb.addWorksheet('Change requests');
    cs.columns = [['Code', 9], ['What', 10], ['Action', 8], ['Target', 22], ['Ward', 6], ['Reason', 36], ['Requested by', 18], ['Requested', 18],
      ['Status', 10], ['Decided by', 18], ['Decided', 18], ['Decision note', 36]].map(([header, width]) => ({ header, width }));
    cs.getRow(1).font = { bold: true };
    for (const c of cr) cs.addRow([c.code, c.entity, c.action, c.payload?.label ?? c.target_id, c.ward, c.reason, c.rn, ist(c.requested_at), c.status, c.dn, ist(c.decided_at), c.decision_note]);
    dateCols(cs, 8, 11);

    const buf = await wb.xlsx.writeBuffer();
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="UGD-progress-${today()}.xlsx"`);
    return reply.send(Buffer.from(buf));
  });

  // Labour only, with the filters of the Labour page (zone, from, to).
  app.get('/api/export/labour.xlsx', auth, async (req, reply) => {
    const f = req.query ?? {};
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Madhira UGD Tracker';
    addLabourSheet(wb, (await listLabour(db, f)).reverse());
    const buf = await wb.xlsx.writeBuffer();
    const tag = f.zone ? `-zone${Number(f.zone)}` : '';
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="UGD-labour${tag}-${today()}.xlsx"`);
    return reply.send(Buffer.from(buf));
  });

  // Issues only, with the filters of the Issues page (kind, zone, ward, severity, status).
  app.get('/api/export/issues.xlsx', auth, async (req, reply) => {
    const f = req.query ?? {};
    const { issues } = await loadAll(db);
    const list = issues.filter((i) => (!f.kind || i.kind === f.kind) && (!f.zone || String(i.zone) === String(f.zone)) &&
      (!f.ward || String(i.ward) === String(f.ward)) && (!f.severity || i.severity === f.severity) && (!f.status || i.status === f.status));
    // Same order as the Issues table (sort, dir); default newest first.
    const rank = { high: 3, medium: 2, low: 1, open: 1, assigned: 2, resolved: 3 };
    const KEYS = {
      code: (i) => i.code, kind: (i) => issueLabel(i.kind), ward: (i) => i.ward, stretch: (i) => i.stretch_code, severity: (i) => rank[i.severity],
      status: (i) => rank[i.status], assigned: (i) => i.assigned_to, by: (i) => i.reported_by_name,
      days: (i) => (i.status === 'resolved' ? null : -new Date(i.reported_at).getTime()), reported: (i) => new Date(i.reported_at).getTime(),
    };
    const key = KEYS[f.sort] ?? KEYS.reported;
    const sign = f.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const x = key(a), y = key(b);
      if (x == null || x === '') return y == null || y === '' ? 0 : 1;
      if (y == null || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-IN', { numeric: true })) * sign;
    });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Madhira UGD Tracker';
    addIssuesSheet(wb, list);
    const buf = await wb.xlsx.writeBuffer();
    const tag = f.ward ? `-ward${Number(f.ward)}` : f.zone ? `-zone${Number(f.zone)}` : '';
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="UGD-issues${tag}-${today()}.xlsx"`);
    return reply.send(Buffer.from(buf));
  });

  // KML for Google Earth: stretches coloured by stage (one folder per zone) and open issues as pins.
  app.get('/api/export/stretches.kml', auth, async (req, reply) => {
    const { stretches, issues } = await loadAll(db);
    const styles = STAGES.map((s) => `<Style id="${s.key}"><LineStyle><color>${kmlColour(s.colour)}</color><width>6</width></LineStyle></Style>`).join('');
    const coords = (line) => line.map(([x, y]) => `${x},${y},0`).join(' ');
    const placemark = (s) => {
      const st = s.status;
      const lines = s.geometry.type === 'LineString' ? [s.geometry.coordinates] : s.geometry.coordinates;
      const desc = [
        `Stage: ${STAGES.find((x) => x.key === s.stage)?.label}`, `Length: ${Math.round(s.length_m)} m`,
        `Pipeline: ${label('pipeline', st.sewer.pipeline)}; MH built ${st.sewer.manholes_built}/${s.planned_mh}; IC built ${st.sewer.ics_built}`,
        `Excavation: ${label('excavation', st.excavation.stage)}`, `Road restoration (${label('surface', surfaceOf(st))}): ${restorationLabel(st.restoration.stage, surfaceOf(st))} (${s.approval})`,
        `Motorability: ${label('motorable', st.motorable)}`, `Open issues: ${s.open_issues}`, `Last update: ${s.updated_by_name ?? ''} ${istText(s.updated_at)}`,
      ].map(esc).join('<br/>');
      return `<Placemark><name>${esc(s.code)}${s.name ? ` · ${esc(s.name)}` : ''}</name><styleUrl>#${s.stage}</styleUrl>
        <description><![CDATA[${desc}]]></description>
        <MultiGeometry>${lines.map((l) => `<LineString><tessellate>1</tessellate><coordinates>${coords(l)}</coordinates></LineString>`).join('')}</MultiGeometry></Placemark>`;
    };
    const folders = [1, 2, 3, 4].map((z) => `<Folder><name>Zone ${z}</name>${stretches.filter((s) => s.zone === z).map(placemark).join('')}</Folder>`).join('');
    const pins = issues.filter((i) => i.status !== 'resolved' && i.location).map((i) =>
      `<Placemark><name>${esc(i.code)} ${esc(issueLabel(i.kind))}</name><styleUrl>#issue</styleUrl><description>${esc(`${i.severity} · ward ${i.ward} · ${i.status}`)}</description><Point><coordinates>${i.location[0]},${i.location[1]},0</coordinates></Point></Placemark>`).join('');
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Madhira UGD status ${today()}</name>${styles}
<Style id="issue"><IconStyle><color>ff2626dc</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/caution.png</href></Icon></IconStyle></Style>
<Folder><name>Road stretches</name>${folders}</Folder><Folder><name>Open issues</name>${pins}</Folder></Document></kml>`;
    reply.header('content-type', 'application/vnd.google-earth.kml+xml').header('content-disposition', `attachment; filename="UGD-status-${today()}.kml"`);
    return kml;
  });

  app.get('/api/export/stretches.geojson', auth, async (req, reply) => {
    const { stretches } = await loadAll(db);
    reply.header('content-disposition', `attachment; filename="UGD-stretches-${today()}.geojson"`);
    return {
      type: 'FeatureCollection',
      features: stretches.map((s) => ({
        type: 'Feature', geometry: s.geometry,
        properties: { code: s.code, name: s.name, zone: s.zone, ward: s.ward, length_m: Math.round(s.length_m), stage: s.stage, approval: s.approval, open_issues: s.open_issues, ...s.status },
      })),
    };
  });
}
