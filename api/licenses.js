const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Planes comerciales vigentes (los mismos ids que usa la aplicación).
const PLANES = ['aerolex_inicial_gratis', 'aerolex_litigante_mensual', 'aerolex_litigante_anual', 'aerolex_estudio_mensual', 'aerolex_bufete_mensual', 'aerolex_causas_3', 'aerolex_causas_10'];
function authorized(value, expected) {
  // La llave configurada en la app y usada en /api/admin tiene 15 caracteres;
  // exigir "más de 15" dejaba este panel inaccesible mientras /api/admin sí
  // aceptaba la misma llave. Se mantiene un piso mínimo de 12.
  return typeof value === 'string' && typeof expected === 'string' && expected.length >= 12 && timingSafeEqual(Buffer.from(hash(value)), Buffer.from(hash(expected)));
}
function view(row) {
  const now = Date.now();
  // Las apps validan con un esquema ISO estricto que solo acepta el sufijo Z;
  // Supabase devuelve "…+00:00" con microsegundos y la activación fallaba al
  // leer la respuesta. Se normaliza a UTC con toISOString().
  return { id: row.id, email: row.email, name: row.display_name, status: row.status, expiresAt: new Date(row.expires_at).toISOString(),
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
    if (response.status === 204) return [];
    return response.json();
  };
  // La columna "plan" es opcional: si aún no existe en la base, el panel sigue funcionando.
  const conPlan = 'id,email,display_name,status,plan,expires_at,activation_expires_at,revision,created_at';
  const sinPlan = 'id,email,display_name,status,expires_at,activation_expires_at,revision,created_at';
  const listar = async filtro => {
    try { return { rows: await db(`desktop_licenses?${filtro}&select=${conPlan}`), plan: true }; }
    catch { return { rows: await db(`desktop_licenses?${filtro}&select=${sinPlan}`), plan: false }; }
  };
  try {
    const url = new URL(req.url, 'https://aerolex.cl');
    const action = url.searchParams.get('action');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (action === 'admin') {
      if (!authorized(req.headers['x-admin-key'], process.env.ADMIN_KEY)) return fail(401, 'Acceso administrativo no autorizado.');
      if (req.method === 'GET') {
        const id = url.searchParams.get('id');
        if (id) {
          if (!uuid.test(id)) return fail(400, 'Identificador inválido.');
          const { rows, plan } = await listar(`id=eq.${encodeURIComponent(id)}`);
          const license = rows[0];
          if (!license) return fail(404, 'Licencia no encontrada.');
          const devices = await db(`desktop_license_devices?license_id=eq.${encodeURIComponent(id)}&select=created_at,last_seen_at,revoked&order=created_at.desc&limit=50`);
          const audit = await db(`desktop_license_audit?license_id=eq.${encodeURIComponent(id)}&select=operation,days,created_at&order=created_at.desc&limit=25`);
          return res.status(200).json({ license, devices, audit, planColumn: plan });
        }
        const { rows, plan } = await listar('order=created_at.desc&limit=1000');
        return res.status(200).json({ licenses: rows, planColumn: plan });
      }
      const operaciones = ['create', 'extend', 'suspend', 'resume', 'activation', 'revoke', 'delete', 'set-expiry', 'set-status'];
      if (!uuid.test(body.id || '') || !uuid.test(body.requestId || '') || !operaciones.includes(body.operation)) return fail(400, 'Operación inválida.');
      if (body.plan !== undefined && body.plan !== '' && !PLANES.includes(String(body.plan))) return fail(400, 'Plan no reconocido.');
      if (body.operation === 'set-status') {
        // Marca la licencia como activa (contratada) o la devuelve a período de prueba.
        if (!['active', 'trial'].includes(String(body.status))) return fail(400, 'Estado inválido (active o trial).');
        const [actual] = await db(`desktop_licenses?id=eq.${encodeURIComponent(body.id)}&select=id,email,status,revision`);
        if (!actual) return fail(404, 'Licencia no encontrada.');
        await db(`desktop_licenses?id=eq.${encodeURIComponent(body.id)}`, { status: String(body.status), revision: Number(actual.revision) + 1 }, 'PATCH');
        try { await db('desktop_license_audit', { request_id: body.requestId, license_id: body.id, operation: String(body.status) === 'active' ? 'activate-status' : 'trial-status', days: 0 }); } catch { /* auditoría informativa */ }
        return res.status(200).json({ ok: true, status: String(body.status) });
      }
      if (body.operation === 'set-expiry') {
        // Corrige el vencimiento a una fecha exacta (el RPC solo suma días).
        if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return fail(400, 'Fecha inválida (usa AAAA-MM-DD).');
        const objetivo = new Date(`${body.date}T23:59:59.000Z`);
        if (!Number.isFinite(objetivo.getTime())) return fail(400, 'Fecha inválida.');
        const [actual] = await db(`desktop_licenses?id=eq.${encodeURIComponent(body.id)}&select=id,email,expires_at,revision`);
        if (!actual) return fail(404, 'Licencia no encontrada.');
        const dias = Math.round((objetivo.getTime() - Date.now()) / 86400000);
        await db(`desktop_licenses?id=eq.${encodeURIComponent(body.id)}`, { expires_at: objetivo.toISOString(), revision: Number(actual.revision) + 1 }, 'PATCH');
        try { await db('desktop_license_audit', { request_id: body.requestId, license_id: body.id, operation: 'set-expiry', days: dias }); } catch { /* auditoría informativa */ }
        return res.status(200).json({ ok: true, expiresAt: objetivo.toISOString(), days: dias });
      }
      if (body.operation === 'delete') {
        const [actual] = await db(`desktop_licenses?id=eq.${encodeURIComponent(body.id)}&select=id,email`);
        if (!actual) return fail(404, 'Licencia no encontrada.');
        if (typeof body.confirmEmail !== 'string' || body.confirmEmail.trim().toLowerCase() !== String(actual.email).toLowerCase()) {
          return fail(400, 'La confirmación no coincide con el correo de la licencia.');
        }
        await db(`desktop_license_devices?license_id=eq.${encodeURIComponent(body.id)}`, null, 'DELETE');
        await db(`desktop_license_audit?license_id=eq.${encodeURIComponent(body.id)}`, null, 'DELETE');
        await db(`desktop_licenses?id=eq.${encodeURIComponent(body.id)}`, null, 'DELETE');
        return res.status(200).json({ deleted: true, id: body.id, email: actual.email });
      }
      if (['create', 'extend'].includes(body.operation) && (!Number.isInteger(body.days) || body.days < 1 || body.days > 3650)) return fail(400, 'Días fuera de rango (1 a 3650).');
      if (body.operation === 'create' && (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254 || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 160)) return fail(400, 'Nombre o correo inválido.');
      // Deterministic per request: a retry returns the same activation code.
      const code = ['create', 'activation'].includes(body.operation)
        ? require('node:crypto').createHmac('sha256', process.env.ADMIN_KEY).update(`activation:${body.id}:${body.requestId}`).digest('hex') : null;
      const row = await db('rpc/desktop_license_admin', { p_id: body.id, p_request_id: body.requestId, p_operation: body.operation,
        p_days: body.days || 0, p_email: (body.email || '').trim().toLowerCase(), p_name: (body.name || '').trim(), p_code_hash: code ? hash(code) : null });
      let planGuardado = null;
      if (body.plan && ['create', 'extend'].includes(body.operation)) {
        try { await db(`desktop_licenses?id=eq.${encodeURIComponent(body.id)}`, { plan: String(body.plan) }, 'PATCH'); planGuardado = String(body.plan); }
        catch { /* columna opcional: el cambio de licencia ya quedó aplicado */ }
      }
      return res.status(200).json({ license: row, ...(planGuardado ? { plan: planGuardado } : {}), ...(code ? { activationCode: code } : {}) });
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
