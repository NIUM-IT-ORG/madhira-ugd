const fs = require('fs');
const path = require('path');
const { write } = require('./render');
const ROOT = path.resolve(__dirname, '..', '..');
// One-time passwords printed in the user guides (kept out of Git: var/ is ignored).
const creds = JSON.parse(fs.readFileSync(process.env.CREDENTIALS_FILE ?? path.join(ROOT, 'var', 'release-credentials.json'), 'utf8'));
const info = {
  version: 'v1.1',
  date: '3 October 2026',
  zipMb: process.env.ZIP_MB ?? '≈130',
  processedMb: process.env.PROCESSED_MB ?? '35',
  rawMb: process.env.RAW_MB ?? '91',
};
(async () => {
  fs.mkdirSync(path.join(ROOT, 'docs', 'user-guides'), { recursive: true });
  const { commissioner, field } = require('./guides-users')(ROOT, creds);
  const it = require('./guide-it')(info);
  const aee = require('./guide-aee')(ROOT, creds);
  const only = process.argv[2]; // optional: build just the files whose path contains this text
  const out = [
    [commissioner, 'docs/user-guides/Commissioner-Guide.docx'],
    [field, 'docs/user-guides/AEE-and-Field-Inspector-Guide.docx'],
    [aee, 'docs/user-guides/AEE-Step-by-Step-Guide.docx'],
    [it, 'docs/DEPLOY-AWS.docx', 'docs/DEPLOY-AWS.md'],
  ].filter(([, f]) => !only || f.includes(only));
  for (const [doc, f, md] of out) {
    const n = await write(doc, path.join(ROOT, f), md && path.join(ROOT, md));
    console.log(f, Math.round(n / 1024), 'KB');
  }
})().catch((e) => { console.error(e); process.exit(1); });
