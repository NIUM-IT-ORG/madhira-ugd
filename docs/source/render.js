// Renders a simple block model to .docx (docx-js) and to Markdown, so a guide is written once.
const fs = require('fs');
const path = require('path');
const {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, LevelFormat, Packer, PageBreak,
  PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, TabStopType, TableLayoutType,
} = require('docx');

const NAVY = '0F2A43';
const TEAL = '0D9488';
const INK = '1E293B';
const MUTED = '64748B';
const FONT = 'Calibri';
const MONO = 'Consolas';
const PAGE_W = 11906; // A4
const PAGE_H = 16838;
const MARGIN = 1134; // 2 cm
const CONTENT_W = PAGE_W - 2 * MARGIN;

/** Inline markup: **bold**, `code`. */
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(new TextRun({ text: tok.slice(2, -2), bold: true, ...base }));
    else out.push(new TextRun({ text: tok.slice(1, -1), font: MONO, size: 19, color: '0F172A', shading: { type: ShadingType.CLEAR, fill: 'EEF2F6', color: 'auto' }, ...base }));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function table(head, rows, widths) {
  const n = head.length;
  const fr = widths ?? Array(n).fill(1 / n);
  const sum = fr.reduce((a, b) => a + b, 0);
  const cols = fr.map((f) => Math.floor((f / sum) * CONTENT_W));
  cols[cols.length - 1] += CONTENT_W - cols.reduce((a, b) => a + b, 0);
  const cell = (text, i, isHead) => new TableCell({
    width: { size: cols[i], type: WidthType.DXA },
    borders,
    shading: isHead ? { type: ShadingType.CLEAR, fill: 'E2E8F0', color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: String(text).split('\n').map((line) => new Paragraph({ spacing: { after: 0 }, children: runs(line, isHead ? { bold: true, size: 19 } : { size: 19 }) })),
  });
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: cols,
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, i, true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
    ],
  });
}

function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b[0] === 0x89) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: 'png' };
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), type: 'jpg' };
    i += 2 + len;
  }
  throw new Error('image size: ' + file);
}

function toDocx(doc) {
  let listInstance = 0;
  const children = [];
  // Title block
  children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: doc.kicker, color: TEAL, bold: true, size: 22, font: FONT })] }));
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 120 }, children: [new TextRun({ text: doc.title, bold: true, size: 48, color: NAVY, font: FONT })] }));
  children.push(new Paragraph({
    spacing: { after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: TEAL, space: 6 } },
    children: [new TextRun({ text: doc.subtitle, color: MUTED, size: 21, font: FONT })],
  }));

  for (const b of doc.blocks) {
    switch (b.t) {
      case 'h1':
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: !!b.newPage, keepNext: true, children: [new TextRun({ text: b.text })] }));
        break;
      case 'h2':
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, children: [new TextRun({ text: b.text })] }));
        break;
      case 'h3':
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, children: [new TextRun({ text: b.text })] }));
        break;
      case 'p':
        children.push(new Paragraph({ spacing: { after: 120 }, children: runs(b.text) }));
        break;
      case 'bullets':
        for (const it of b.items) children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: runs(it) }));
        break;
      case 'steps': {
        const inst = b.continue ? listInstance : ++listInstance; // continue: keep counting from the previous list
        for (const it of b.items) {
          const step = typeof it === 'string' ? { text: it } : it;
          children.push(new Paragraph({ numbering: { reference: 'steps', level: 0, instance: inst }, spacing: { after: step.code ? 40 : 80 }, children: runs(step.text) }));
          if (step.code) children.push(...codeBlock(step.code, 360));
        }
        break;
      }
      case 'code':
        children.push(...codeBlock(b.text, 0));
        break;
      case 'table':
        children.push(table(b.head, b.rows, b.widths));
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      case 'note': {
        const colour = b.tone === 'warn' ? 'B45309' : b.tone === 'key' ? TEAL : '2563EB';
        const fill = b.tone === 'warn' ? 'FFFBEB' : b.tone === 'key' ? 'ECFDF5' : 'EFF6FF';
        children.push(new Paragraph({
          spacing: { before: 60, after: 160 },
          shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
          border: { left: { style: BorderStyle.SINGLE, size: 24, color: colour, space: 8 } },
          indent: { left: 120, right: 120 },
          children: [...(b.label ? [new TextRun({ text: `${b.label}  `, bold: true, color: colour })] : []), ...runs(b.text)],
        }));
        break;
      }
      case 'image': {
        const { w, h, type } = imageSize(b.path);
        const maxW = (b.width ?? 6.2) * 96;
        const width = Math.min(maxW, w);
        const height = Math.round((h / w) * width);
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 80, after: 40 }, keepNext: !!b.caption,
          children: [new ImageRun({ type, data: fs.readFileSync(b.path), transformation: { width, height }, altText: { title: b.caption ?? 'Screenshot', description: b.caption ?? 'Screenshot', name: path.basename(b.path) } })],
        }));
        if (b.caption) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: b.caption, italics: true, color: MUTED, size: 18 })] }));
        break;
      }
      case 'shots': {
        // Phone screenshots side by side, each with a short caption; the row never splits across pages.
        const n = b.items.length;
        const colW = Math.floor(CONTENT_W / n);
        const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
        const cells = b.items.map((it) => {
          const { w, h, type } = imageSize(it.path);
          const width = Math.min((b.width ?? 1.75) * 96, w);
          const height = Math.round((h / w) * width);
          return new TableCell({
            width: { size: colW, type: WidthType.DXA },
            borders: { top: none, bottom: none, left: none, right: none },
            margins: { top: 40, bottom: 40, left: 60, right: 60 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new ImageRun({ type, data: fs.readFileSync(it.path), transformation: { width, height }, altText: { title: it.caption, description: it.caption, name: path.basename(it.path) } })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: runs(it.caption, { italics: true, color: MUTED, size: 17 }) }),
            ],
          });
        });
        children.push(new Table({ width: { size: colW * n, type: WidthType.DXA }, columnWidths: Array(n).fill(colW), layout: TableLayoutType.FIXED, alignment: AlignmentType.CENTER, rows: [new TableRow({ cantSplit: true, children: cells })] }));
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      }
      case 'pagebreak':
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      default:
        throw new Error('unknown block ' + b.t);
    }
  }

  function codeBlock(text, indent) {
    const lines = text.split('\n');
    return lines.map((line, i) => new Paragraph({
      spacing: { before: i === 0 ? 40 : 0, after: i === lines.length - 1 ? 140 : 0, line: 260 },
      indent: { left: indent + 120, right: 120 },
      shading: { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' },
      children: [new TextRun({ text: line || ' ', font: MONO, size: 18, color: '0F172A' })],
    }));
  }

  return new Document({
    creator: 'Madhira UGD Tracker',
    title: doc.title,
    description: doc.subtitle,
    styles: {
      default: { document: { run: { font: FONT, size: 21, color: INK } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 32, bold: true, color: NAVY, font: FONT }, paragraph: { spacing: { before: 360, after: 140 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, color: NAVY, font: FONT }, paragraph: { spacing: { before: 260, after: 100 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 22, bold: true, color: TEAL, font: FONT }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 260 } } } }] },
        { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } }, run: { bold: true, color: NAVY } } }] },
      ],
    },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 560, footer: 560 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: doc.header, color: MUTED, size: 16 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
        children: [new TextRun({ text: doc.footer, color: MUTED, size: 16 }), new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], color: MUTED, size: 16 })],
      })] }) },
      children,
    }],
  });
}

function toMarkdown(doc) {
  const out = [`# ${doc.title}`, '', `_${doc.subtitle}_`, ''];
  let n = 0;
  for (const b of doc.blocks) {
    if (b.t === 'h1') out.push(`## ${b.text}`, '');
    else if (b.t === 'h2') out.push(`### ${b.text}`, '');
    else if (b.t === 'h3') out.push(`#### ${b.text}`, '');
    else if (b.t === 'p') out.push(b.text, '');
    else if (b.t === 'bullets') out.push(...b.items.map((i) => `- ${i}`), '');
    else if (b.t === 'steps') {
      if (!b.continue) n = 0;
      for (const it of b.items) {
        const s = typeof it === 'string' ? { text: it } : it;
        out.push(`${++n}. ${s.text}`);
        if (s.code) out.push('', '   ```bash', ...s.code.split('\n').map((l) => `   ${l}`), '   ```');
      }
      out.push('');
    } else if (b.t === 'code') out.push('```bash', b.text, '```', '');
    else if (b.t === 'table') {
      const esc = (c) => String(c).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
      out.push(`| ${b.head.map(esc).join(' | ')} |`, `| ${b.head.map(() => '---').join(' | ')} |`, ...b.rows.map((r) => `| ${r.map(esc).join(' | ')} |`), '');
    } else if (b.t === 'note') out.push(`> ${b.label ? `**${b.label}** ` : ''}${b.text}`, '');
    else if (b.t === 'image') out.push(`_[Screenshot: ${b.caption ?? ''}]_`, '');
    else if (b.t === 'shots') out.push(...b.items.map((i) => `_[Screenshot: ${i.caption}]_`), '');
  }
  return out.join('\n');
}

async function write(doc, docxPath, mdPath) {
  const buf = await Packer.toBuffer(toDocx(doc));
  fs.writeFileSync(docxPath, buf);
  if (mdPath) fs.writeFileSync(mdPath, toMarkdown(doc));
  return buf.length;
}

module.exports = { write };
