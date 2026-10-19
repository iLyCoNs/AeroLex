const crypto = require('crypto');
const Procedures = require('../procedures');
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

// Límite de intentos de PIN por IP+código (memoria del proceso serverless:
// mitiga fuerza bruta sin cambiar esquema; el despliegue puede añadir WAF).
const PIN_ATTEMPTS = new Map();
const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_MAX_ATTEMPTS = 10;

function pinAttemptKey(code, ip) {
  return `${String(ip || 'unknown').slice(0, 80)}|${String(code || '').toUpperCase().slice(0, 30)}`;
}

function checkPinRateLimit(code, ip) {
  const now = Date.now();
  const key = pinAttemptKey(code, ip);
  const entry = PIN_ATTEMPTS.get(key);
  if (!entry || now - entry.startedAt > PIN_WINDOW_MS) {
    PIN_ATTEMPTS.set(key, { count: 1, startedAt: now });
    return { allowed: true, remaining: PIN_MAX_ATTEMPTS - 1 };
  }
  entry.count += 1;
  if (entry.count > PIN_MAX_ATTEMPTS) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: PIN_MAX_ATTEMPTS - entry.count };
}

function securePin() {
  return String(crypto.randomInt(1000, 10000));
}

function pinEqual(stored, supplied) {
  const a = Buffer.from(String(stored || ''));
  const b = Buffer.from(String(supplied || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Cada estudio usa sus propias siglas (ALX, PS, etc.); el portal resuelve por código.
const CASE_CODE_RE = /^[A-Z]{2,4}-\d{4}-\d{2,}$/i;

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

function stepsTemplate() {
  const today = new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Santiago' }).replace(/\./g, '');
  return Procedures.initialSteps(today);
}

async function listYearCodes(year) {
  const prefix = `ALX-${year}-`;
  const resp = await fetch(`${SUPA_URL}/rest/v1/cases?select=code&code=like.${prefix}*`, { headers: supaHeaders() });
  if (!resp.ok) throw new Error('db_read');
  const rows = await resp.json();
  const nums = (Array.isArray(rows) ? rows : []).map(r => parseInt(String(r.code).split('-')[2], 10)).filter(n => !isNaN(n));
  return { prefix, max: nums.length ? Math.max(...nums) : 0 };
}

async function verifyCase(res, code, pin) {
  const resp = await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.${encodeURIComponent(code)}&select=code,pin,materia,tribunal,rit,detalle,estado_actual,steps,status,triage`, { headers: supaHeaders() });
  if (!resp.ok) return fail(res, 500, 'db_error');
  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) return fail(res, 404, 'not_found');

  const c = rows[0];
  if (!pinEqual(c.pin, pin)) return fail(res, 401, 'bad_pin');

  return res.status(200).json({
    ok: true,
    case: {
      code: c.code,
      materia: c.materia,
      tribunal: c.tribunal,
      rit: c.rit,
      detalle: c.detalle,
      estado_actual: c.estado_actual,
      steps: c.steps || [],
      procedimiento: Procedures.storedProcedure(c.triage),
      status: c.status
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!SUPA_URL || !SUPA_KEY) return fail(res, 500, 'not_configured');

    if (req.method === 'GET' || req.method === 'POST') {
      const url = new URL(req.url, 'http://localhost');
      const body = req.method === 'POST' && req.body && typeof req.body === 'object' && (req.body.code || req.body.pin)
        ? req.body
        : {};
      const isVerify = req.method === 'POST' && (body.code !== undefined || body.pin !== undefined);
      if (isVerify) {
        const code = String(body.code || '').toUpperCase().trim().replace(/^AXL-/i, 'ALX-');
        const pin = String(body.pin || '').trim();
        if (!code || !pin) return fail(res, 400, 'missing_params');
        if (!CASE_CODE_RE.test(code)) return fail(res, 400, 'bad_code');
        const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
        const rl = checkPinRateLimit(code, ip);
        if (!rl.allowed) {
          res.setHeader('Retry-After', '900');
          return fail(res, 429, 'rate_limited');
        }
        return verifyCase(res, code, pin);
      }
    }

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const adminKey = url.searchParams.get('admin_key') || req.headers['x-admin-key'];
      const expectedKey = process.env.ADMIN_KEY || process.env.AEROLEX_ADMIN_KEY || 'Q2102311aerolex';
      if (adminKey && adminKey === expectedKey) {
        const resp = await fetch(`${SUPA_URL}/rest/v1/cases?select=*&order=created_at.desc`, { headers: supaHeaders() });
        if (!resp.ok) return fail(res, 500, 'db_error');
        const rows = await resp.json();
        return res.status(200).json({ ok: true, cases: Array.isArray(rows) ? rows : [] });
      }

      const code = (url.searchParams.get('code') || '').toUpperCase().trim().replace(/^AXL-/i, 'ALX-');
      const pin = (url.searchParams.get('pin') || '').trim();
      if (!code || !pin) return fail(res, 400, 'missing_params');
      if (!CASE_CODE_RE.test(code)) return fail(res, 400, 'bad_code');
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
      const rl = checkPinRateLimit(code, ip);
      if (!rl.allowed) {
        res.setHeader('Retry-After', '900');
        return fail(res, 429, 'rate_limited');
      }
      return verifyCase(res, code, pin);
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const rawMateria = String(body.materia || 'Consulta General').slice(0, 150);
      const clientName = String(body.name || body.client_name || '').slice(0, 100);
      const materia = (clientName && !rawMateria.toLowerCase().includes(clientName.toLowerCase()))
        ? `${rawMateria} — ${clientName}`
        : rawMateria;
      const phone = String(body.phone || body.client_phone || '').slice(0, 25);
      const detalle = String(body.detalle || body.historia || body.notes || body.resumen || '').slice(0, 2000);
      const triage = Array.isArray(body.triage)
        ? body.triage.slice(0, 50).map(a => String(a).slice(0, 400))
        : (detalle ? [detalle.slice(0, 300)] : []);

      const year = new Date().getFullYear();
      const { prefix, max } = await listYearCodes(year);

      for (let attempt = 1; attempt <= 3; attempt++) {
        const code = `${prefix}${String(max + attempt).padStart(2, '0')}`;
        const pin = securePin();
        const isUrgent = body.status === 'urgente' || triage.some(a => String(a).toUpperCase().includes('URGENCIA'));
        const row = {
          code,
          pin,
          materia,
          client_phone: phone,
          triage,
          tribunal: String(body.tribunal || '').slice(0, 200),
          rit: String(body.rit || '').slice(0, 120),
          detalle,
          estado_actual: 0,
          status: isUrgent ? 'urgente' : 'nuevo',
          steps: stepsTemplate(materia)
        };
        const resp = await fetch(`${SUPA_URL}/rest/v1/cases`, {
          method: 'POST',
          headers: supaHeaders({ 'Prefer': 'return=representation' }),
          body: JSON.stringify(row)
        });
        if (resp.ok) {
          const created = await resp.json();
          const c = Array.isArray(created) ? created[0] : created;
          return res.status(201).json({
            ok: true,
            code: c.code,
            pin: c.pin,
            materia: c.materia,
            detalle: c.detalle,
            status: c.status
          });
        }
        if (resp.status !== 409) throw new Error('db_insert');
      }
      throw new Error('db_conflict');
    }

    return fail(res, 405, 'method_not_allowed');
  } catch (e) {
    return fail(res, 500, 'server_error');
  }
};
