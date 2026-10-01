'use strict';

/**
 * End-to-end smoke test against a running server.
 *
 *   node server.js           (in one terminal)
 *   node scripts/api-smoke.js (in another)
 *
 * Exits non-zero if any endpoint misbehaves.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const zlib = require('node:zlib');

require('dotenv').config({ quiet: true });

// Requiring the entry file is side-effect free (server.js only boots when it is
// executed directly) and keeps the "what must be configured" list in one place.
const { missingServiceEnv } = require('../server.js');

const PORT = Number(process.env.PORT || 5188);
const EXTERNAL = Boolean(process.env.BASE_URL);
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  [pass] ${label}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

/** Start the server as a child process when no external server was given. */
async function startServer() {
  if (EXTERNAL) return null;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return child;
    } catch (error) {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error('Server did not become ready in time.');
}

/** Build a minimal but valid-enough DOCX (deflate-compressed document.xml). */
function buildDocx(text) {
  const paragraphs = text.split('\n').map((line) =>
    `<w:p><w:r><w:t>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('');
  const xml = '<w:document><w:body>' + paragraphs + '</w:body></w:document>';
  const raw = Buffer.from(xml, 'utf8');
  const deflated = zlib.deflateRawSync(raw);
  const nameBuf = Buffer.from('word/document.xml', 'utf8');

  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(deflated.length, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  const local = Buffer.concat([header, nameBuf, deflated]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const centralFull = Buffer.concat([central, nameBuf]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralFull.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, centralFull, end]);
}

async function post(path, body) {
  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  return { status: response.status, payload };
}

async function main() {
  // The server refuses to listen without Firebase + Atlas, so say so clearly
  // instead of reporting a bogus "server did not become ready" failure.
  const missing = EXTERNAL ? [] : missingServiceEnv();
  if (missing.length) {
    console.log('Smoke run skipped - the server boots strictly and these variables are missing:\n');
    for (const key of missing) console.log(`    ${key}`);
    console.log('\n  Either copy .env.example to .env and fill it in, or point the smoke');
    console.log('  test at a server that is already running:');
    console.log('    BASE_URL=http://127.0.0.1:5173 npm run smoke');
    return;
  }

  const child = await startServer();
  console.log(`Smoke testing ${BASE}${EXTERNAL ? ' (external server)' : ' (spawned)'}\n`);

  try {
    const health = await fetch(BASE + '/api/health').then((r) => r.json());
  check('GET /api/health', health.ok === true && health.extractors, JSON.stringify(health).slice(0, 120));
  console.log(`         extractors: ${JSON.stringify(health.extractors)}`);
  if (health.services) console.log(`         services:   ${JSON.stringify(health.services)}`);

  const index = await fetch(BASE + '/');
  const html = await index.text();
  check('GET / serves the UI', index.status === 200 && html.includes('Resume Analyzer'), `status ${index.status}`);

  const samples = await fetch(BASE + '/api/samples').then((r) => r.json());
  check('GET /api/samples lists samples', Array.isArray(samples.samples) && samples.samples.length >= 2);

  const sample = await fetch(BASE + '/api/samples/frontend-junior').then((r) => r.json());
  check('GET /api/samples/:id returns text', Boolean(sample.resume) && Boolean(sample.jobDescription));

  const report = await post('/api/analyze', {
    resumeText: sample.resume,
    jobText: sample.jobDescription,
    fileName: 'resume-frontend.pdf'
  });
  check('POST /api/analyze (pasted text)', report.status === 200 && typeof report.payload.score === 'number');
  check('  -> has 6 weighted categories', report.payload.categories.length === 6);
  check('  -> reports missing keywords', report.payload.missingKeywords.length > 0);
  check('  -> produces suggestions + rewrites', report.payload.suggestions.length > 0 && report.payload.rewrites.length > 0);
  check('  -> ATS checks present', report.payload.ats.checks.length >= 9);
  console.log(`         score: ${report.payload.score}/100 (${report.payload.grade.label})`);
  console.log(`         job keyword match: ${report.payload.jobDescription.matchPercent}%`);
  console.log(`         missing: ${report.payload.missingKeywords.slice(0, 8).map((k) => k.label).join(', ')}`);
  console.log(`         top fix: ${report.payload.suggestions[0].title}`);

  const docx = buildDocx([
    'Jordan Lee',
    'jordan.lee@example.com | +1 415 555 0134 | linkedin.com/in/jordanlee',
    'SUMMARY',
    'Frontend Developer with 4 years of experience building React and TypeScript products for 3 SaaS teams.',
    'EXPERIENCE',
    'Frontend Developer - Northwind Cloud, 2022 - Present',
    '- Built 8 customer dashboards in React and TypeScript, cutting page load time 35% for 12,000 monthly users',
    '- Migrated 120 components from JavaScript to TypeScript, reducing runtime errors 62%',
    '- Introduced Docker and GitHub Actions pipelines, shortening releases from 2 days to 40 minutes',
    'SKILLS',
    'JavaScript, TypeScript, React, Node.js, Docker, SQL, Tailwind CSS, REST API, Git',
    'EDUCATION',
    'BSc in Computer Science, State University, 2016 - 2020'
  ].join('\n'));
  const extracted = await post('/api/extract', {
    fileBase64: docx.toString('base64'),
    fileName: 'jordan-lee-resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  check('POST /api/extract (docx upload)', extracted.status === 200 && /Jordan Lee/.test(extracted.payload.text || ''),
    `method ${extracted.payload && extracted.payload.method}`);
  console.log(`         extraction method: ${extracted.payload.method}`);

  const fileReport = await post('/api/analyze', {
    fileBase64: docx.toString('base64'),
    fileName: 'jordan-lee-resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jobText: sample.jobDescription
  });
  check('POST /api/analyze (docx file path)', fileReport.status === 200 && fileReport.payload.extraction.kind === 'docx');

  const short = await post('/api/analyze', { resumeText: 'too short' });
  check('POST /api/analyze rejects short input', short.status === 400 && short.payload.error.code === 'RESUME_TOO_SHORT');

  const badType = await post('/api/extract', { fileBase64: Buffer.from('hello').toString('base64'), fileName: 'photo.png' });
  check('POST /api/extract rejects unsupported types', badType.status === 415);

  const missing = await fetch(BASE + '/api/nope');
  check('unknown API route returns 404', missing.status === 404);
  } finally {
    if (child) child.kill();
  }

  console.log('');
  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log('All smoke checks passed.');
}

main().catch((error) => {
  console.error('Smoke test crashed:', error.message);
  process.exit(1);
});
