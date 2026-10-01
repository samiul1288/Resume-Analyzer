'use strict';

/**
 * Starts the server as a detached background process, waits until /api/health
 * answers, prints the URL and exits - so the preview keeps running after the
 * shell (or the tool that launched it) is gone.
 *
 *   node scripts/preview.js            -> http://127.0.0.1:5173
 *   PORT=8080 node scripts/preview.js
 */

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

require('dotenv').config({ quiet: true });

// Side-effect free import: tells us whether this machine can boot the server.
const { missingServiceEnv } = require('../server.js');

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

function health() {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: '/api/health', timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.setEncoding('utf8');
      res.on('end', () => {
        try { resolve({ ok: res.statusCode === 200, body: JSON.parse(body) }); }
        catch (err) { resolve({ ok: false, body: null }); }
      });
    });
    req.on('error', () => resolve({ ok: false, body: null }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, body: null }); });
  });
}

async function main() {
  const existing = await health();
  if (existing.ok) {
    console.log(`Resume Analyzer already running: http://${HOST}:${PORT}`);
    console.log(`extractors: ${JSON.stringify(existing.body.extractors)}`);
    return;
  }

  const missing = missingServiceEnv();
  if (missing.length) {
    console.error(`Resume Analyzer boots strictly and cannot start: missing ${missing.join(', ')}.`);
    console.error('Copy .env.example to .env, fill in your Firebase + MongoDB Atlas credentials, then retry.');
    process.exitCode = 1;
    return;
  }

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), HOST },
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const check = await health();
    if (check.ok) {
      console.log(`Resume Analyzer is live (pid ${child.pid}): http://${HOST}:${PORT}`);
      console.log(`extractors: ${JSON.stringify(check.body.extractors)}`);
      return;
    }
  }
  console.error(`Server did not answer on http://${HOST}:${PORT} within 6s. Run "npm start" to see the error.`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`Preview failed: ${err.stack || err}`);
  process.exitCode = 1;
});
