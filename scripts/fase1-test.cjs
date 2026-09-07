// Prueba Fase 1 (portal): verificación con PIN, rate limit, PIN seguro,
// PUT parcial con concurrencia. Sin Supabase real (fetch simulado).
// Uso: node scripts/fase1-test.cjs
const assert = require('assert');

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_KEY = 'service-key-test';
process.env.ADMIN_KEY = 'admin-test';

const realFetch = global.fetch;
let lastPatch = null;

function mockSupabase() {
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/cases?code=eq.ALX-2026-03') && (!opts.method || opts.method === 'GET')) {
      return { ok: true, json: async () => [{ code: 'ALX-2026-03', pin: '1234', materia: 'Civil', tribunal: 'PM', rit: '1-2026', detalle: 'd', estado_actual: 1, steps: [], status: 'activo' }] };
    }
    if (u.includes('/rest/v1/cases?code=eq.ALX-2026-04')) {
      return { ok: true, json: async () => [{ code: 'ALX-2026-04', pin: '9999', materia: 'X', tribunal: '', rit: '', detalle: '', estado_actual: 0, steps: [], status: 'nuevo' }] };
    }
    if (u.includes('/rest/v1/cases?code=eq.ALX-2026-100')) {
      return { ok: true, json: async () => [{ code: 'ALX-2026-100', pin: '1111', materia: 'Civil', tribunal: '', rit: '', detalle: '', estado_actual: 0, steps: [], status: 'activo' }] };
    }
    if (u.includes('code=like.ALX-')) {
      return { ok: true, json: async () => [{ code: 'ALX-2026-03' }] };
    }
    if (u.includes('/rest/v1/cases') && opts.method === 'POST') {
      const row = JSON.parse(opts.body);
      return { ok: true, json: async () => [row] };
    }
    if (u.includes('/rest/v1/cases?code=eq.') && opts.method === 'PATCH') {
      lastPatch = { url: u, body: JSON.parse(opts.body) };
      if (u.includes('updated_at=eq.otra-fecha')) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => [{ code: 'ALX-2026-03', ...JSON.parse(opts.body) }] };
    }
    return { ok: true, json: async () => [] };
  };
}

function req(url, { method = 'GET', body = null, headers = {}, ip = '1.2.3.4' } = {}) {
  return { url, method, body, headers: { 'x-forwarded-for': ip, ...headers } };
}
function res() {
  const r = { statusCode: 200, headers: {}, data: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (d) => { r.data = d; return r; };
  r.end = () => r;
  return r;
}

(async () => {
  mockSupabase();
  const casesApi = require('../api/cases.js');
  const adminApi = require('../api/admin.js');
  let n = 0;
  const ok = (name, cond) => { assert.ok(cond, name); n++; console.log(`ok - ${name}`); };

  // 1. GET verifica PIN correcto
  let r = res();
  await casesApi(req('/api/cases?code=ALX-2026-03&pin=1234'), r);
  ok('GET pin correcto', r.statusCode === 200 && r.data.ok && r.data.case.code === 'ALX-2026-03');
  ok('GET no devuelve pin', !JSON.stringify(r.data).includes('"pin"') || r.data.case.pin === undefined);

  // 2. PIN incorrecto -> 401 (comparación segura)
  r = res();
  await casesApi(req('/api/cases?code=ALX-2026-03&pin=0000', { ip: '9.9.9.9' }), r);
  ok('GET pin incorrecto 401', r.statusCode === 401 && r.data.error === 'bad_pin');

  // 3. Código de 3 dígitos aceptado
  r = res();
  await casesApi(req('/api/cases?code=ALX-2026-100&pin=1111', { ip: '9.9.9.8' }), r);
  ok('GET codigo 3 digitos', r.statusCode === 200 && r.data.case.code === 'ALX-2026-100');

  // 4. Código malformado rechazado
  r = res();
  await casesApi(req('/api/cases?code=ALX-2026-1&pin=1111', { ip: '9.9.9.7' }), r);
  ok('GET codigo corto 400', r.statusCode === 400);

  // 5. POST verify (PIN en cuerpo, no en URL)
  r = res();
  await casesApi(req('/api/cases', { method: 'POST', body: { code: 'alx-2026-03', pin: '1234' }, ip: '9.9.9.6' }), r);
  ok('POST verify sin pin en url', r.statusCode === 200 && r.data.ok);

  // 6. Rate limit tras 11 intentos
  for (let i = 0; i < 11; i++) {
    r = res();
    await casesApi(req('/api/cases?code=ALX-2026-04&pin=0000', { ip: '7.7.7.7' }), r);
  }
  ok('rate limit 429', r.statusCode === 429 && r.data.error === 'rate_limited');

  // 7. Alta genera PIN de 4 dígitos con cripto (formato)
  r = res();
  await casesApi(req('/api/cases', { method: 'POST', body: { materia: 'Civil', triage: [] }, ip: '9.9.9.5' }), r);
  ok('alta con pin 4 digitos', r.statusCode === 201 && /^\d{4}$/.test(r.data.pin));

  // 8. Admin PUT parcial: no vacía campos omitidos
  lastPatch = null;
  r = res();
  await adminApi(req('/api/admin', { method: 'PUT', body: { code: 'ALX-2026-03', detalle: 'nuevo detalle' }, headers: { 'x-admin-key': 'admin-test' } }), r);
  ok('PUT parcial 200', r.statusCode === 200);
  ok('PUT preserva omitidos', lastPatch && lastPatch.body.detalle === 'nuevo detalle' && !('materia' in lastPatch.body) && !('steps' in lastPatch.body));

  // 9. PUT vacío -> 400
  r = res();
  await adminApi(req('/api/admin', { method: 'PUT', body: { code: 'ALX-2026-03' }, headers: { 'x-admin-key': 'admin-test' } }), r);
  ok('PUT vacio 400', r.statusCode === 400);

  // 10. Conflicto de concurrencia -> 409
  r = res();
  await adminApi(req('/api/admin', { method: 'PUT', body: { code: 'ALX-2026-03', detalle: 'x', expected_updated_at: 'otra-fecha' }, headers: { 'x-admin-key': 'admin-test' } }), r);
  ok('PUT conflicto 409', r.statusCode === 409);

  // 11. index.html sin vía de respaldo sin PIN
  const fs = require('fs');
  const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  ok('sin fallback casesDB', !html.includes('mostrando datos de respaldo') && !/const localCase = casesDB\[code\]/.test(html));
  ok('escapeHtml en ficha', html.includes('function escapeHtml') && html.includes('escapeHtml(caseData.detalle') && html.includes('escapeHtml(step.title)'));
  ok('pin por POST', html.includes("method: 'POST'") && html.includes('JSON.stringify({ code, pin })'));
  ok('sin pin en onclick', !html.includes("verifyNow('${newCase.code}','${newCase.pin}')"));

  global.fetch = realFetch;
  console.log(`\n${n} pruebas Fase 1 (portal) en verde.`);
})().catch(e => { global.fetch = realFetch; console.error('FALLO:', e.message); process.exit(1); });
