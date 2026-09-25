// Verifica la API de licencias con Supabase simulado (sin red real).
// Comprueba: listado con/sin columna plan, detalle con equipos e historial,
// creación con plan, operaciones RPC y eliminación segura (hijos antes que la licencia).
const assert = require('node:assert');
const handler = require('../api/licenses.js');

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_KEY = 'service-key-test';
process.env.ADMIN_KEY = 'Q2102311aerolex';

const ID = '11111111-2222-3333-4444-555555555555';
const REQ = '99999999-8888-7777-6666-555555555555';
const llamadas = [];
let planColumn = true;

function fakeResponse(status, body) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}
global.fetch = (url, options = {}) => {
  const method = options.method || 'GET';
  llamadas.push(`${method} ${decodeURIComponent(url.replace('https://supabase.test/rest/v1/', ''))} ${options.body || ''}`);
  if (url.includes('rpc/desktop_license_admin')) {
    return fakeResponse(200, { id: ID, email: 'abogada@estudio.cl', display_name: 'Abogada Prueba', status: 'trial', expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), revision: 2 });
  }
  if (method === 'DELETE') return fakeResponse(200, []);
  if (method === 'PATCH') return fakeResponse(200, [{ id: ID }]);
  if (url.includes('desktop_license_devices')) return fakeResponse(200, [{ created_at: new Date().toISOString(), last_seen_at: null, revoked: false }]);
  if (url.includes('desktop_license_audit')) return fakeResponse(200, [{ operation: 'create', days: 30, created_at: new Date().toISOString() }]);
  if (/desktop_licenses\?.*select=id,email$/.test(decodeURIComponent(url))) return fakeResponse(200, [{ id: ID, email: 'abogada@estudio.cl' }]);
  if (url.includes('plan')) {
    if (!planColumn) return fakeResponse(400, { message: 'column desktop_licenses.plan does not exist' });
    return fakeResponse(200, [{ id: ID, email: 'abogada@estudio.cl', display_name: 'Abogada Prueba', status: 'trial', plan: 'aerolex_litigante_mensual', expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), activation_expires_at: null, revision: 2, created_at: new Date().toISOString() }]);
  }
  return fakeResponse(200, [{ id: ID, email: 'abogada@estudio.cl', display_name: 'Abogada Prueba', status: 'trial', expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), revision: 2, created_at: new Date().toISOString() }]);
};

function llamar(method, query, body) {
  const req = { method, url: `/api/licenses?action=admin${query}`, headers: { 'x-admin-key': process.env.ADMIN_KEY }, body };
  return new Promise((resolve) => {
    const res = { statusCode: 0, payload: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(data) { this.payload = data; resolve({ status: this.statusCode, body: data }); } };
    handler(req, res);
  });
}

(async () => {
  let ok = 0, fail = 0;
  const check = (nombre, condicion, detalle = '') => { if (condicion) { ok += 1; console.log(`OK  | ${nombre}${detalle ? ` - ${detalle}` : ''}`); } else { fail += 1; console.log(`FAIL| ${nombre}${detalle ? ` - ${detalle}` : ''}`); } };

  const listado = await llamar('GET', '');
  check('GET lista con plan', listado.status === 200 && listado.body.licenses[0].plan === 'aerolex_litigante_mensual' && listado.body.planColumn === true);

  planColumn = false;
  const listadoSinPlan = await llamar('GET', '');
  check('GET lista sin columna plan (degradado)', listadoSinPlan.status === 200 && listadoSinPlan.body.planColumn === false && !('plan' in listadoSinPlan.body.licenses[0]));
  planColumn = true;

  const detalle = await llamar('GET', `&id=${ID}`);
  check('GET detalle con equipos e historial', detalle.status === 200 && detalle.body.devices.length === 1 && detalle.body.audit[0].operation === 'create');

  llamadas.length = 0;
  const creada = await llamar('POST', '', { operation: 'create', id: ID, requestId: REQ, name: 'Abogada Prueba', email: 'abogada@estudio.cl', days: 30, plan: 'aerolex_litigante_mensual' });
  check('POST crear devuelve código de activación', creada.status === 200 && /^[a-f0-9]{64}$/.test(creada.body.activationCode || ''));
  check('POST crear guarda el plan (PATCH)', llamadas.some((l) => l.includes('PATCH') && l.includes('plan')));

  const planMalo = await llamar('POST', '', { operation: 'create', id: ID, requestId: REQ, name: 'X', email: 'x@y.cl', days: 30, plan: 'plan_inventado' });
  check('POST rechaza plan desconocido (400)', planMalo.status === 400);

  const fechaMala = await llamar('POST', '', { operation: 'set-expiry', id: ID, requestId: REQ, date: '2030-13-40' });
  check('POST fijar vencimiento rechaza fecha inválida (400)', fechaMala.status === 400 || /Fecha inválida/.test(String(fechaMala.body?.error)));

  llamadas.length = 0;
  const fijada = await llamar('POST', '', { operation: 'set-expiry', id: ID, requestId: REQ, date: '2026-12-31' });
  const patchFecha = llamadas.find((l) => l.startsWith('PATCH') && l.includes('expires_at'));
  const auditoria = llamadas.find((l) => l.startsWith('POST desktop_license_audit') && l.includes('set-expiry'));
  check('POST fijar vencimiento actualiza fecha y revisión', fijada.status === 200 && Boolean(patchFecha) && patchFecha.includes('revision'), String(patchFecha || '').slice(0, 120));
  check('POST fijar vencimiento deja auditoría', Boolean(auditoria));

  const extendida = await llamar('POST', '', { operation: 'extend', id: ID, requestId: REQ, days: 365, plan: 'aerolex_litigante_anual' });
  check('POST extender con cambio de plan', extendida.status === 200 && llamadas.some((l) => l.includes('PATCH')));

  for (const operacion of ['suspend', 'resume', 'activation', 'revoke']) {
    const r = await llamar('POST', '', { operation: operacion, id: ID, requestId: REQ });
    check(`POST ${operacion}`, r.status === 200);
  }

  const estadoInvalido = await llamar('POST', '', { operation: 'set-status', id: ID, requestId: REQ, status: 'raro' });
  check('POST marcar estado rechaza valor inválido (400)', estadoInvalido.status === 400);

  llamadas.length = 0;
  const activada = await llamar('POST', '', { operation: 'set-status', id: ID, requestId: REQ, status: 'active' });
  const patchEstado = llamadas.find((l) => l.startsWith('PATCH') && l.includes('active'));
  check('POST marcar activa actualiza estado y revisión', activada.status === 200 && Boolean(patchEstado), String(patchEstado || '').slice(0, 110));
  check('POST marcar activa deja auditoría', llamadas.some((l) => l.startsWith('POST desktop_license_audit') && l.includes('activate-status')));

  const borradoMalo = await llamar('POST', '', { operation: 'delete', id: ID, requestId: REQ, confirmEmail: 'otro@correo.cl' });
  check('POST eliminar exige correo correcto (400)', borradoMalo.status === 400);

  llamadas.length = 0;
  const borrado = await llamar('POST', '', { operation: 'delete', id: ID, requestId: REQ, confirmEmail: 'ABOGADA@ESTUDIO.CL' });
  const orden = llamadas.filter((l) => l.startsWith('DELETE')).join(' -> ');
  check('POST eliminar borra hijos antes de la licencia', borrado.status === 200 && orden.includes('desktop_license_devices') && orden.includes('desktop_license_audit') && orden.split(' -> ').pop().startsWith('DELETE desktop_licenses'), orden);

  console.log(`\nResultado: ${ok}/${ok + fail} pruebas OK`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
