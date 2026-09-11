// Servidor de pruebas local para simular Vercel Serverless + static files
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

process.env.ADMIN_KEY = process.env.ADMIN_KEY || 'aerolex2026';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'mock-key';

// Mock Supabase para pruebas locales sin conexión real
const mockDb = [
  {
    code: 'ALX-2026-01',
    pin: '1234',
    materia: 'Derecho Laboral - Autodespido',
    tribunal: 'Juzgado de Letras del Trabajo de Puerto Montt',
    rit: 'O-450-2026',
    detalle: 'Causa en tramitación preparatoria',
    estado_actual: 1,
    steps: [],
    status: 'activo',
    created_at: new Date().toISOString()
  }
];

const originalFetch = global.fetch;
global.fetch = async (reqUrl, opts = {}) => {
  const u = String(reqUrl);
  const method = opts.method || 'GET';

  if (u.includes('/rest/v1/cases')) {
    if (method === 'GET') {
      if (u.includes('code=like.EV-*')) {
        return {
          ok: true,
          json: async () => mockDb.filter(r => r.code.startsWith('EV-'))
        };
      }
      return {
        ok: true,
        json: async () => mockDb
      };
    }
    if (method === 'POST') {
      const row = JSON.parse(opts.body || '{}');
      mockDb.unshift({
        ...row,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      return { ok: true, json: async () => [row] };
    }
    if (method === 'DELETE') {
      const remaining = mockDb.filter(r => !r.code.startsWith('EV-'));
      mockDb.length = 0;
      mockDb.push(...remaining);
      return { ok: true, json: async () => [] };
    }
  }

  return originalFetch(reqUrl, opts);
};

const telemetryApi = require('../api/telemetry.js');
const adminApi = require('../api/admin.js');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = 8089;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
    return res;
  };

  if (pathname === '/api/telemetry') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try { req.body = body ? JSON.parse(body) : {}; } catch (_) { req.body = body; }
      await telemetryApi(req, res);
    });
    return;
  }

  if (pathname === '/api/admin') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try { req.body = body ? JSON.parse(body) : {}; } catch (_) { req.body = body; }
      await adminApi(req, res);
    });
    return;
  }

  let filePath = path.join(ROOT_DIR, pathname === '/' ? 'index.html' : pathname);
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  } catch (err) {
    res.writeHead(500);
    return res.end('Server error: ' + err.message);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Test server running at http://localhost:${PORT}`);
});
