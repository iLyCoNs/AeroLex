// Test unitario para api/telemetry.js y aislamiento en api/admin.js
const assert = require('assert');

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_KEY = 'service-key-test';
process.env.ADMIN_KEY = 'admin-secret-test';

const mockDb = [];

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';

  // Cases query in admin.js
  if (u.includes('/rest/v1/cases') && method === 'GET') {
    if (u.includes('code=like.EV-*')) {
      return {
        ok: true,
        json: async () => mockDb.filter(r => r.code.startsWith('EV-'))
      };
    }
    // Admin cases list: return mixed cases (legal cases + EV events + WA contacts)
    return {
      ok: true,
      json: async () => mockDb
    };
  }

  // POST new case / event
  if (u.includes('/rest/v1/cases') && method === 'POST') {
    const row = JSON.parse(opts.body);
    mockDb.unshift({
      ...row,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    return { ok: true, json: async () => [row] };
  }

  // DELETE EV-* events
  if (u.includes('/rest/v1/cases?code=like.EV-*') && method === 'DELETE') {
    const remaining = mockDb.filter(r => !r.code.startsWith('EV-'));
    mockDb.length = 0;
    mockDb.push(...remaining);
    return { ok: true, json: async () => [] };
  }

  return { ok: true, json: async () => [] };
};

function req(url, { method = 'GET', body = null, headers = {} } = {}) {
  return { url, method, body, headers };
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
  const telemetryApi = require('../api/telemetry.js');
  const adminApi = require('../api/admin.js');
  let passed = 0;
  const ok = (msg, cond) => { assert.ok(cond, msg); passed++; console.log(`✓ ${msg}`); };

  console.log('\n--- INICIANDO TESTS DE TELEMETRÍA Y AISLAMIENTO ---');

  // 1. Ingesta de visita desde Google Ads
  {
    const r = res();
    await telemetryApi(req('/api/telemetry', {
      method: 'POST',
      body: {
        source: 'google_ads',
        event: 'visita',
        gclid: 'Cj0KCQjwmOm3BhDhARIsABCD1234',
        utm_campaign: 'campana_pm_abogados',
        device: 'mobile',
        path: '/#servicios',
        detail: 'Visita Google Ads landing'
      }
    }), r);
    ok('POST visita Google Ads responde ok: true con ID EV-*', r.statusCode === 200 && r.data.ok === true && r.data.id.startsWith('EV-'));
  }

  // 2. Ingesta de click en WhatsApp desde Google Ads
  {
    const r = res();
    await telemetryApi(req('/api/telemetry', {
      method: 'POST',
      body: {
        source: 'google_ads',
        event: 'whatsapp_click',
        gclid: 'Cj0KCQjwmOm3BhDhARIsABCD1234',
        device: 'mobile',
        detail: 'Click: Contactar Abogado de Turno'
      }
    }), r);
    ok('POST click WhatsApp responde ok: true', r.statusCode === 200 && r.data.ok === true);
  }

  // 3. Ingesta de búsqueda/interacción (cálculo de plazo judicial)
  {
    const r = res();
    await telemetryApi(req('/api/telemetry', {
      method: 'POST',
      body: {
        source: 'google_organic',
        event: 'calculator_use',
        device: 'desktop',
        detail: 'Calculadora: Plazo Civil 15 dias'
      }
    }), r);
    ok('POST calculadora responde ok: true', r.statusCode === 200 && r.data.ok === true);
  }

  // 4. Ingesta de visita orgánica
  {
    const r = res();
    await telemetryApi(req('/api/telemetry', {
      method: 'POST',
      body: {
        source: 'google_organic',
        event: 'visita',
        device: 'desktop',
        referrer: 'https://www.google.cl/'
      }
    }), r);
    ok('POST visita Google Orgánico responde ok: true', r.statusCode === 200 && r.data.ok === true);
  }

  // 5. GET sin autenticación admin debe rechazar con 401
  {
    const r = res();
    await telemetryApi(req('/api/telemetry', { method: 'GET' }), r);
    ok('GET telemetría sin credencial retorna 401 Unauthorized', r.statusCode === 401);
  }

  // 6. GET con x-admin-key válida debe computar métricas correctamente
  {
    const r = res();
    await telemetryApi(req('/api/telemetry', {
      method: 'GET',
      headers: { 'x-admin-key': 'admin-secret-test' }
    }), r);
    ok('GET telemetría con x-admin-key retorna 200 y métricas', r.statusCode === 200 && r.data.ok === true);
    ok('Métricas detecta 1 visita Google Ads', r.data.metrics.googleAdsVisits === 1);
    ok('Métricas detecta 1 visita Google Orgánico', r.data.metrics.googleOrganicVisits === 1);
    ok('Métricas detecta 1 click en WhatsApp', r.data.metrics.whatsappClicks === 1);
    ok('Métricas detecta 1 uso de calculadora / búsqueda', r.data.metrics.searchesCount === 1);
    ok('Métricas calcula % de conversión sobre tráfico Google', parseFloat(r.data.metrics.googleConversionRate) > 0);
    ok('Lista de eventos contiene los 4 eventos ingresados', r.data.events.length === 4);
  }

  // 7. Aislamiento de casos legales en api/admin.js:
  mockDb.push({
    code: 'ALX-2026-99',
    pin: '1234',
    materia: 'Derecho Laboral - Despido Injustificado',
    tribunal: 'Juzgado de Letras del Trabajo de Puerto Montt',
    rit: 'O-123-2026',
    detalle: 'Audiencia preparatoria programada',
    estado_actual: 1,
    steps: [],
    status: 'activo',
    created_at: new Date().toISOString()
  });

  {
    const r = res();
    await adminApi(req('/api/admin', {
      method: 'GET',
      headers: { 'x-admin-key': 'admin-secret-test' }
    }), r);
    ok('GET /api/admin retorna 200', r.statusCode === 200 && r.data.ok === true);
    const cases = r.data.cases;
    const hasEv = cases.some(c => c.code.startsWith('EV-'));
    ok('GET /api/admin NO filtra eventos EV-* hacia la lista de causas legales', !hasEv);
    ok('GET /api/admin contiene la causa legal ALX-2026-99', cases.some(c => c.code === 'ALX-2026-99'));
  }

  // 8. DELETE telemetría: purgar eventos
  {
    const r = res();
    await telemetryApi(req('/api/telemetry', {
      method: 'DELETE',
      headers: { 'x-admin-key': 'admin-secret-test' }
    }), r);
    ok('DELETE telemetría con x-admin-key retorna 200 y mensaje purga', r.statusCode === 200 && r.data.ok === true);

    const r2 = res();
    await telemetryApi(req('/api/telemetry', {
      method: 'GET',
      headers: { 'x-admin-key': 'admin-secret-test' }
    }), r2);
    ok('GET telemetría post-purga muestra 0 eventos', r2.data.events.length === 0 && r2.data.metrics.totalVisits === 0);
  }

  console.log(`\n========================================`);
  console.log(`TODOS LOS TESTS PASARON EXITOSAMENTE: ${passed} verificaciones OK.`);
  console.log(`========================================\n`);
})();
