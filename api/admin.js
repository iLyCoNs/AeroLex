const crypto = require('crypto');
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

function securePin() {
  return String(crypto.randomInt(1000, 10000));
}

const UPDATABLE_FIELDS = ['materia', 'tribunal', 'rit', 'detalle', 'estado_actual', 'steps', 'status'];

function buildPartialPatch(body) {
  const patch = {};
  if (body.materia !== undefined) patch.materia = String(body.materia || '').slice(0, 150);
  if (body.tribunal !== undefined) patch.tribunal = String(body.tribunal || '').slice(0, 200);
  if (body.rit !== undefined) patch.rit = String(body.rit || '').slice(0, 120);
  if (body.detalle !== undefined) patch.detalle = String(body.detalle || '').slice(0, 2000);
  if (body.estado_actual !== undefined) {
    if (!Number.isInteger(body.estado_actual)) throw new Error('bad_estado');
    patch.estado_actual = body.estado_actual;
  }
  if (body.steps !== undefined) {
    if (!Array.isArray(body.steps)) throw new Error('bad_steps');
    patch.steps = body.steps.slice(0, 60).map(s => ({
      title: String(s.title || '').slice(0, 200),
      date: String(s.date || '').slice(0, 60),
      done: !!s.done
    }));
  }
  if (body.status !== undefined) {
    if (!['nuevo', 'activo', 'urgente', 'finalizado', 'suspendido'].includes(body.status)) throw new Error('bad_status');
    patch.status = body.status;
  }
  return patch;
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!SUPA_URL || !SUPA_KEY) return fail(res, 500, 'not_configured');

    const key = req.headers['x-admin-key'] || '';
    if (!key || key !== process.env.ADMIN_KEY) return fail(res, 401, 'unauthorized');

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET') {
      if (url.searchParams.get('action') === 'check_tables') {
        const resp = await fetch(`${SUPA_URL}/rest/v1/`, { headers: supaHeaders() });
        const data = await resp.json().catch(() => ({}));
        return res.status(200).json({ ok: true, tables: Object.keys(data.definitions || {}) });
      }
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

      const codeCandidate = body.code ? String(body.code).toUpperCase().trim() : '';
      const pinCandidate = body.pin ? String(body.pin).trim() : '';
      const finalCode = (codeCandidate && /^ALX-\d{4}-\d{2,}$/i.test(codeCandidate)) ? codeCandidate : `${prefix}${String(next).padStart(2, '0')}`;
      const finalPin = (/^\d{4}$/.test(pinCandidate)) ? pinCandidate : securePin();

      const today = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Santiago' }).replace(/\./g, '');
      const row = {
        code: finalCode,
        pin: finalPin,
        materia,
        tribunal: String(body.tribunal || '').slice(0, 200),
        rit: String(body.rit || '').slice(0, 120),
        detalle: String(body.detalle || '').slice(0, 2000),
        estado_actual: typeof body.estado_actual === 'number' ? body.estado_actual : 0,
        steps: Array.isArray(body.steps) && body.steps.length ? body.steps : [
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

    if (req.method === 'PUT' || req.method === 'PATCH') {
      const code = String(body.code || '').toUpperCase().trim();
      if (!code) return fail(res, 400, 'missing_code');

      let patch;
      try {
        patch = buildPartialPatch(body);
      } catch (e) {
        return fail(res, 400, String(e.message || 'bad_request'));
      }
      if (Object.keys(patch).length === 0) return fail(res, 400, 'empty_patch');
      patch.updated_at = new Date().toISOString();

      // Concurrencia optimista opcional: si el cliente envía
      // expected_updated_at, solo se escribe si coincide.
      const expected = String(body.expected_updated_at || '');
      let query = `${SUPA_URL}/rest/v1/cases?code=eq.${encodeURIComponent(code)}`;
      if (expected) query += `&updated_at=eq.${encodeURIComponent(expected)}`;

      const resp = await fetch(query, {
        method: 'PATCH',
        headers: supaHeaders({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(patch)
      });
      if (!resp.ok) return fail(res, 500, 'db_error');
      const updated = await resp.json();
      const c = Array.isArray(updated) ? updated[0] : updated;
      if (!c) {
        if (expected) return fail(res, 409, 'conflict');
        // Si no existe y no hay expected_updated_at, se crea el expediente (Upsert)
        const today = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Santiago' }).replace(/\./g, '');
        const newRow = {
          code,
          pin: String(body.pin || securePin()).slice(0, 10),
          materia: patch.materia || 'Consulta General',
          tribunal: patch.tribunal || '',
          rit: patch.rit || '',
          detalle: patch.detalle || '',
          estado_actual: patch.estado_actual ?? 0,
          steps: patch.steps || [
            { title: 'Expediente recibido por AeroLex', date: today, done: true },
            { title: 'Revisión de antecedentes', date: 'En curso', done: false }
          ],
          status: patch.status || 'nuevo',
          created_at: patch.updated_at,
          updated_at: patch.updated_at
        };
        const insResp = await fetch(`${SUPA_URL}/rest/v1/cases`, {
          method: 'POST',
          headers: supaHeaders({ 'Prefer': 'return=representation' }),
          body: JSON.stringify(newRow)
        });
        if (!insResp.ok) return fail(res, 500, 'db_error');
        const insRows = await insResp.json();
        const ins = Array.isArray(insRows) ? insRows[0] : insRows;
        return res.status(201).json({ ok: true, case: ins });
      }
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
