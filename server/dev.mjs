import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import render from '../api/render.js';
import health from '../api/health.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8000);
const allowed = new Set(['/', '/index.html', '/styles.css', '/src/app.mjs', '/src/core.mjs', '/favicon.ico']);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };

// Simple local .env loader, without any dependencies. Production uses runtime env vars.
try {
  const raw = await readFile(resolve(root, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* Missing .env is valid. AI remains disabled. */ }

const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/api/render') return render(req, res);
    if (path === '/api/health') return health(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); return res.end('Method not allowed');
    }
    const p = path === '/' ? '/index.html' : path;
    if (!allowed.has(p)) { res.writeHead(404); return res.end('Not found'); }
    const file = resolve(root, '.' + p);
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://unpkg.com blob:; style-src 'self' https://unpkg.com 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://unpkg.com https://tiles.openfreemap.org https://*.openfreemap.org; worker-src blob:; font-src 'self' data: https:"
    });
    if (req.method === 'HEAD') return res.end();
    res.end(body);
  } catch (error) {
    console.error('dev server error', error.message);
    res.writeHead(500); res.end('Internal server error');
  }
});
server.listen(port, () => console.log('Virtual Location Camera on http://localhost:' + port));
