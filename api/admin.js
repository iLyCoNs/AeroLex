const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

function supaHeaders(extra = {}) {
  return {
    'apikey': SUPA_KEY,
    'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!SUPA_URL || !SUPA_KEY) return fail(res, 500, 'not_configured');

    const key = req.headers['x-admin-key'] || '';
    if (!key || key !== process.env.ADMIN_KEY) return fail(res, 401, 'unauthorized');

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET') {
      const resp = await fetch(`${SUPA_URL}/rest/v1/cases?select=*&order=created_at.desc`, { headers: supaHeaders() });
      if (!resp.ok) return fail(res, 500, 'db_error');
      const rows = await resp.json();
      return res.status(200).json({ ok: true, cases: Array.isArray(rows) ? rows : [] });
    }

    if (req.method === 'POST') {
      const materia = String(body.materia || 'Consulta General').slice(0, 150);
      const year = new Date().getFullYear();
      const prefix = `ALX-${year}-`;
      const listResp = await fetch(`${SUPA_URL}/rest/v1/cases?select=code&code=like.${prefix}*`, { headers: supaHeaders() });
      if (!listResp.ok) return fail(res, 500, 'db_error');
      const rows = await listResp.json();
      const nums = (Array.isArray(rows) ? rows : []).map(r => parseInt(String(r.code).split('-')[2], 10)).filter(n => !isNaN(n));
      const next = (nums.length ? Math.max(...nums) : 0) + 1;

      const today = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Santiago' }).replace(/\./g, '');
      const row = {
        code: `${prefix}${String(next).padStart(2, '0')}`,
        pin: String(Math.floor(1000 + Math.random() * 9000)),
        materia,
        tribunal: String(body.tribunal || '').slice(0, 200),
        rit: String(body.rit || '').slice(0, 120),
        detalle: String(body.detalle || '').slice(0, 2000),
        estado_actual: 0,
        steps: [
          { title: 'Expediente recibido por AeroLex', date: today, done: true },
          { title: 'Revisión de antecedentes', date: 'En curso', done: false }
        ]
      };

      const resp = await fetch(`${SUPA_URL}/rest/v1/cases`, {
        method: 'POST',
        headers: supaHeaders({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(row)
      });
      if (!resp.ok) return fail(res, 500, 'db_error');
      const created = await resp.json();
      const c = Array.isArray(created) ? created[0] : created;
      return res.status(201).json({ ok: true, case: c });
    }

    if (req.method === 'PUT') {
      const code = String(body.code || '').toUpperCase().trim();
      if (!code) return fail(res, 400, 'missing_code');

      const patch = {
        materia: String(body.materia || '').slice(0, 150),
        tribunal: String(body.tribunal || '').slice(0, 200),
        rit: String(body.rit || '').slice(0, 120),
        detalle: String(body.detalle || '').slice(0, 2000),
        estado_actual: Number.isInteger(body.estado_actual) ? body.estado_actual : -1,
        steps: Array.isArray(body.steps)
          ? body.steps.slice(0, 60).map(s => ({
              title: String(s.title || '').slice(0, 200),
              date: String(s.date || '').slice(0, 60),
              done: !!s.done
            }))
          : [],
        updated_at: new Date().toISOString()
      };

      const resp = await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.${encodeURIComponent(code)}`, {
        method: 'PATCH',
        headers: supaHeaders({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(patch)
      });
      if (!resp.ok) return fail(res, 500, 'db_error');
      const updated = await resp.json();
      const c = Array.isArray(updated) ? updated[0] : updated;
      return res.status(200).json({ ok: true, case: c });
    }

    if (req.method === 'DELETE') {
      const code = (url.searchParams.get('code') || '').toUpperCase().trim();
      if (!code) return fail(res, 400, 'missing_code');
      const resp = await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.${encodeURIComponent(code)}`, { method: 'DELETE', headers: supaHeaders() });
      if (!resp.ok) return fail(res, 500, 'db_error');
      return res.status(200).json({ ok: true });
    }

    return fail(res, 405, 'method_not_allowed');
  } catch (e) {
    return fail(res, 500, 'server_error');
  }
};
