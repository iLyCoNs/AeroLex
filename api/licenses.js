const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function authorized(value, expected) {
  return typeof value === 'string' && typeof expected === 'string' && expected.length > 15 && timingSafeEqual(Buffer.from(hash(value)), Buffer.from(hash(expected)));
}
function view(row) {
  const now = Date.now();
  return { id: row.id, email: row.email, name: row.display_name, status: row.status, expiresAt: row.expires_at,
    revision: Number(row.revision), serverTime: new Date(now).toISOString(),
    offlineUntil: new Date(Math.min(now + 86400000, Date.parse(row.expires_at))).toISOString() };
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const fail = (status, error) => res.status(status).json({ error });
  const origin = req.headers.origin;
  if (origin && !['https://aerolex.cl', 'https://www.aerolex.cl'].includes(origin)) return fail(403, 'Origen no autorizado.');
  if (!['GET', 'POST'].includes(req.method)) return fail(405, 'Método no permitido.');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return fail(503, 'Licencias no configuradas.');
  const db = async (path, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { method,
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('storage');
    return response.json();
  };
  try {
    const url = new URL(req.url, 'https://aerolex.cl');
    const action = url.searchParams.get('action');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (action === 'admin') {
      if (!authorized(req.headers['x-admin-key'], process.env.ADMIN_KEY)) return fail(401, 'Acceso administrativo no autorizado.');
      if (req.method === 'GET') {
        const licenses = await db('desktop_licenses?select=id,email,display_name,status,expires_at,revision,created_at&order=created_at.desc&limit=1000');
        return res.status(200).json({ licenses });
      }
      if (!uuid.test(body.id || '') || !uuid.test(body.requestId || '') || !['create', 'extend', 'suspend', 'resume', 'activation', 'revoke'].includes(body.operation)) return fail(400, 'Operación inválida.');
      if (['create', 'extend'].includes(body.operation) && (!Number.isInteger(body.days) || body.days < 1 || body.days > 3650)) return fail(400, 'Días fuera de rango (1 a 3650).');
      if (body.operation === 'create' && (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254 || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 160)) return fail(400, 'Nombre o correo inválido.');
      // Deterministic per request: a retry returns the same activation code.
      const code = ['create', 'activation'].includes(body.operation)
        ? require('node:crypto').createHmac('sha256', process.env.ADMIN_KEY).update(`activation:${body.id}:${body.requestId}`).digest('hex') : null;
      const row = await db('rpc/desktop_license_admin', { p_id: body.id, p_request_id: body.requestId, p_operation: body.operation,
        p_days: body.days || 0, p_email: (body.email || '').trim().toLowerCase(), p_name: (body.name || '').trim(), p_code_hash: code ? hash(code) : null });
      return res.status(200).json({ license: row, ...(code ? { activationCode: code } : {}) });
    }
    if (req.method !== 'POST') return fail(405, 'Usa POST.');
    if (action === 'activate') {
      if (typeof body.code !== 'string' || !/^[a-f0-9]{64}$/.test(body.code) || typeof body.email !== 'string' || body.email.length > 254) return fail(400, 'Código o correo inválido.');
      const token = randomBytes(32).toString('hex');
      const row = await db('rpc/desktop_license_activate', { p_code_hash: hash(body.code), p_email: body.email.trim().toLowerCase(), p_token_hash: hash(token) });
      if (!row) return fail(401, 'Código no válido, vencido o ya utilizado. Solicita otro al administrador.');
      return res.status(200).json({ token, license: view(row) });
    }
    if (action === 'sync') {
      const bearer = req.headers.authorization || '';
      if (!/^Bearer [a-f0-9]{64}$/.test(bearer)) return fail(401, 'Dispositivo no autorizado.');
      const row = await db('rpc/desktop_license_sync', { p_token_hash: hash(bearer.slice(7)) });
      if (!row) return fail(401, 'Dispositivo revocado. Solicita un nuevo código.');
      return res.status(200).json({ license: view(row) });
    }
    return fail(404, 'Operación no encontrada.');
  } catch { return fail(503, 'No se pudo completar la operación de licencia. Verifica la configuración o reintenta la misma operación.'); }
};
