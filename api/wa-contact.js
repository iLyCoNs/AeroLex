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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ ok: false, error: 'not_configured' });

  // POST: Registro público (desde index.html, chatbot widget, o admin.html)
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const year = new Date().getFullYear();
      const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
      const code = `WA-${year}-${rand}`;
      const source = String(body.source || 'portal').slice(0, 50);
      const topic = String(body.topic || 'contacto_general').slice(0, 150);
      const caseCode = body.caseCode ? String(body.caseCode).toUpperCase().trim().slice(0, 50) : '';
      const message = String(body.message || '').slice(0, 2000);
      const phone = String(body.phone || '').slice(0, 30);

      const row = {
        code,
        pin: '0000',
        materia: `WA: ${topic}`,
        tribunal: source,
        rit: caseCode ? `Causa: ${caseCode}` : 'Sin expediente',
        detalle: message,
        estado_actual: 0,
        steps: [],
        client_phone: phone,
        status: 'nuevo'
      };

      const resp = await fetch(`${SUPA_URL}/rest/v1/cases`, {
        method: 'POST',
        headers: supaHeaders({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(row)
      });
      if (!resp.ok) return res.status(500).json({ ok: false, error: 'db_error' });
      return res.status(200).json({ ok: true, id: code });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // GET: Consulta para administradores y Bot Jurídico
  if (req.method === 'GET') {
    const key = req.headers['x-admin-key'] || '';
    if (!key || key !== process.env.ADMIN_KEY) return res.status(401).json({ ok: false, error: 'unauthorized' });

    try {
      const url = new URL(req.url, 'http://localhost');
      const caseCode = url.searchParams.get('caseCode') || '';
      let query = `${SUPA_URL}/rest/v1/cases?code=like.WA-*&order=created_at.desc&limit=200`;
      if (caseCode) {
        query += `&rit=like.*${encodeURIComponent(caseCode)}*`;
      }
      const resp = await fetch(query, { headers: supaHeaders() });
      if (!resp.ok) return res.status(500).json({ ok: false, error: 'db_error' });
      const rows = await resp.json();

      const contacts = (Array.isArray(rows) ? rows : []).map(r => ({
        id: r.code,
        timestamp: r.created_at,
        source: r.tribunal || 'portal',
        topic: (r.materia || '').replace(/^WA:\s*/, ''),
        caseCode: (r.rit || '').replace(/^Causa:\s*/, '').replace('Sin expediente', '') || null,
        message: r.detalle || '',
        phone: r.client_phone || null
      }));

      return res.status(200).json({ ok: true, contacts, total: contacts.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
};
