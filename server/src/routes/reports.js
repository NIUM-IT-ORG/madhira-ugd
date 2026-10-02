import ExcelJS from 'exceljs';
import { STAGES, ISSUE_KINDS, label, normaliseStatus } from '../../../shared/status.ts';
import { addStretch, emptyField, progressTable } from '../../../shared/stats.ts';
import { reference } from '../reference.js';

const issueLabel = (k) => ISSUE_KINDS.find((i) => i.key === k)?.label ?? k;
// Report dates in local (India) time; TIME_ZONE can override.
const TZ = process.env.TIME_ZONE ?? 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

async function loadAll(db) {
  const stretches = (await db.query(
    `select s.*, u.name as updated_by_name from stretches s left join users u on u.id = s.updated_by
     where s.deleted_at is null and s.record_state <> 'rejected' order by s.code`,
  )).rows.map((r) => ({ ...r, status: normaliseStatus(r.status) }));
  const issues = (await db.query(
    `select i.*, s.code as stretch_code, ru.name as reported_by_name, xu.name as resolved_by_name
     from issues i left join stretches s on s.id = i.stretch_id left join users ru on ru.id = i.reported_by
     left join users xu on xu.id = i.resolved_by order by i.reported_at`,
  )).rows;
  const labour = (await db.query(
    `select to_char(l.log_date, 'YYYY-MM-DD') as log_date, l.ward, l.zone, l.labourers, l.machines, l.note, u.name as user_name
     from labour_logs l left join users u on u.id = l.user_id order by l.log_date`,
  )).rows;
  return { stretches, issues, labour };
}

/** Monday 00:00 UTC of the week containing d. */
function weekStart(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

// KML colours are aabbggrr.
const kmlColour = (hex, alpha = 'ff') => `${alpha}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

export function registerReportRoutes(app, db) {
  const auth = { preHandler: app.authenticate };

  // Progress over time: the history replayed week by week (field figures) + open issues at each week end.
  app.get('/api/stats/timeline', auth, async () => {
    const versions = (await db.query(
      `select v.stretch_id, v.version, v.kind, v.at, v.status, v.approval, s.length_m, s.ward, s.zone, s.planned_mh
       from stretch_versions v join stretches s on s.id = v.stretch_id order by v.at, v.version`,
    )).rows;
    const issues = (await db.query('select reported_at, resolved_at from issues')).rows;
    if (!versions.length) return { weeks: [] };
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
      weeks.push({ week: w.toISOString().slice(0, 10), ...f, open_issues: open });
    }
    return { weeks };
  });

  // Excel workbook: the progress sheet in its usual layout with field-verified columns, plus detail sheets.
  app.get('/api/export/progress.xlsx', auth, async (req, reply) => {
    const { stretches, issues, labour } = await loadAll(db);
    const table = progressTable(reference.baseline.groups, stretches, issues, labour);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Madhira UGD Tracker';
    wb.created = new Date();

    const ws = wb.addWorksheet('Progress', { views: [{ state: 'frozen', xSplit: 4, ySplit: 5 }] });
    ws.addRow([`UGD progress — Madhira Municipality — generated ${today()} by ${req.user.name}`]);
    ws.addRow(['Sanctioned and "Executed (reported)" are from the progress sheet dated 30-09-2026; "Field-verified" is what AEEs recorded on the map.']);
    ws.addRow([]);
    const groups = [
      ['S.No', 1], ['Zone', 1], ['Ward', 1], ['Area of working', 1], ['Sanctioned', 3], ['Executed (reported, 30-09-26)', 3],
      ['Field-verified on map', 3], ['Balance to execute (reported)', 3], ['Road condition (field, m)', 4], ['Open issues', 1], ['Avg labour/day (7 d)', 1],
    ];
    const h1 = ws.addRow(groups.flatMap(([t, n]) => [t, ...Array(n - 1).fill(null)]));
    const h2 = ws.addRow([null, null, null, null,
      'Pipeline (Rmt)', 'Manholes', 'ICs', 'Pipeline (Rmt)', 'Manholes', 'ICs', 'Pipe laid (m)', 'Manholes built', 'ICs built',
      'Pipeline (Rmt)', 'Manholes', 'ICs', 'Road cut', 'CC restored', 'Approved', 'Not motorable', null, null]);
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
    const line = (sno, r, isTotal) => {
      const f = r.field;
      const row = ws.addRow([
        sno, isTotal ? null : r.zone, isTotal ? null : r.wards.join(', '), isTotal ? r.label : r.locality ?? r.label,
        r.sanctioned.pipe_m, r.sanctioned.manholes, r.sanctioned.ics,
        r.reported.pipe_m, r.reported.manholes, r.reported.ics,
        Math.round(f.pipe_laid_m), f.manholes_built, f.ics_built,
        r.sanctioned.pipe_m - r.reported.pipe_m, r.sanctioned.manholes - r.reported.manholes, r.sanctioned.ics - r.reported.ics,
        Math.round(f.road_cut_m), Math.round(f.restored_m), Math.round(f.approved_m), Math.round(f.not_motorable_m),
        r.issues_open, r.labour_avg_7d,
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
    line(null, { ...table.total, label: 'Total of Zones 1, 2, 3 & 4' }, true);
    ws.columns.forEach((c, i) => (c.width = i === 3 ? 40 : i < 3 ? 7 : 12));
    for (let c = 5; c <= 22; c++) ws.getColumn(c).numFmt = '#,##0';

    const ss = wb.addWorksheet('Stretches', { views: [{ state: 'frozen', ySplit: 1 }] });
    ss.columns = [
      ['Code', 10], ['Road', 28], ['Zone', 6], ['Ward', 6], ['Length (m)', 10], ['Plan MH', 8], ['Overall stage', 26], ['Pipeline', 22],
      ['Pipe laid (m)', 10], ['MH built', 8], ['IC built', 8], ['Excavation', 22], ['Cut length (m)', 10], ['CC restoration', 26], ['Approval', 10],
      ['Motorability', 22], ['Taps broken', 9], ['Taps restored', 9], ['Water leaks', 9], ['Drain clogged', 9], ['Water stagnation', 9],
      ['Potholes', 8], ['Uneven back-fill', 9], ['Open issues', 8], ['Record', 10], ['Last update', 18], ['By', 18],
    ].map(([header, width]) => ({ header, width }));
    ss.getRow(1).font = { bold: true };
    for (const s of stretches) {
      const st = s.status;
      ss.addRow([
        s.code, s.name, s.zone, s.ward, Math.round(s.length_m), s.planned_mh, STAGES.find((x) => x.key === s.stage)?.label,
        label('pipeline', st.sewer.pipeline), st.sewer.pipe_laid_m, st.sewer.manholes_built, st.sewer.ics_built,
        label('excavation', st.excavation.stage), st.excavation.cut_length_m, label('restoration', st.restoration.stage), s.approval,
        label('motorable', st.motorable), st.utilities.taps_broken, st.utilities.taps_restored, st.utilities.water_leaks,
        st.utilities.drain_clogged ? 'Yes' : 'No', st.hazards.water_stagnation ? 'Yes' : 'No', st.hazards.potholes,
        st.hazards.uneven_backfill ? 'Yes' : 'No', s.open_issues, s.record_state, s.updated_at, s.updated_by_name,
      ]);
    }

    const is = wb.addWorksheet('Issues', { views: [{ state: 'frozen', ySplit: 1 }] });
    is.columns = [
      ['Code', 9], ['Issue', 26], ['Count', 7], ['Zone', 6], ['Ward', 6], ['Stretch', 10], ['Severity', 9], ['Status', 10], ['Assigned to', 20],
      ['Due', 11], ['Reported by', 18], ['Reported', 18], ['Resolved by', 18], ['Resolved', 18], ['Resolution', 40], ['Description', 40],
    ].map(([header, width]) => ({ header, width }));
    is.getRow(1).font = { bold: true };
    for (const i of issues) {
      is.addRow([i.code, issueLabel(i.kind), i.count, i.zone, i.ward, i.stretch_code, i.severity, i.status, i.assigned_to, i.due_date,
        i.reported_by_name, i.reported_at, i.resolved_by_name, i.resolved_at, i.resolution_note, i.description]);
    }

    const ls = wb.addWorksheet('Labour');
    ls.columns = [['Date', 12], ['Zone', 6], ['Ward', 6], ['Labourers', 10], ['Machines', 10], ['Note', 30], ['Entered by', 18]].map(([header, width]) => ({ header, width }));
    ls.getRow(1).font = { bold: true };
    for (const l of labour) ls.addRow([l.log_date, l.zone, l.ward, l.labourers, l.machines, l.note, l.user_name]);

    const cr = (await db.query(
      `select c.*, ru.name as rn, du.name as dn from change_requests c left join users ru on ru.id = c.requested_by
       left join users du on du.id = c.decided_by order by c.requested_at`,
    )).rows;
    const cs = wb.addWorksheet('Change requests');
    cs.columns = [['Code', 9], ['What', 10], ['Action', 8], ['Target', 22], ['Ward', 6], ['Reason', 36], ['Requested by', 18], ['Requested', 18],
      ['Status', 10], ['Decided by', 18], ['Decided', 18], ['Decision note', 36]].map(([header, width]) => ({ header, width }));
    cs.getRow(1).font = { bold: true };
    for (const c of cr) cs.addRow([c.code, c.entity, c.action, c.payload?.label ?? c.target_id, c.ward, c.reason, c.rn, c.requested_at, c.status, c.dn, c.decided_at, c.decision_note]);

    const buf = await wb.xlsx.writeBuffer();
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="UGD-progress-${today()}.xlsx"`);
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
        `Excavation: ${label('excavation', st.excavation.stage)}`, `CC restoration: ${label('restoration', st.restoration.stage)} (${s.approval})`,
        `Motorability: ${label('motorable', st.motorable)}`, `Open issues: ${s.open_issues}`, `Last update: ${s.updated_by_name ?? ''} ${new Date(s.updated_at).toISOString().slice(0, 16)}`,
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
