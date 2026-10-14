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

function attrSourceLabel(src) {
  if (src === 'google_ads') return 'Google Ads';
  if (src === 'google_organic') return 'Búsqueda de Google';
  if (src === 'direct_other') return 'Directo/Otro';
  return src || 'Sin dato';
}

function fmtDay(iso) {
  try {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', year: 'numeric' });
  } catch (_) { return ''; }
}

function buildAttribution(attr) {
  if (!attr || typeof attr !== 'object') return { note: '', step: null };
  const gclid = String(attr.gclid || '').slice(0, 150);
  const firstSeen = fmtDay(attr.first_seen);
  const adsAt = attr.ads_at ? fmtDay(attr.ads_at) : '';
  let adsDaysAgo = null;
  if (attr.ads_at) {
    const diff = Date.now() - new Date(attr.ads_at).getTime();
    if (!isNaN(diff)) adsDaysAgo = Math.max(0, Math.floor(diff / 86400000));
  }
  const parts = [];
  if (attr.first_source) parts.push(`1ª visita: ${attrSourceLabel(String(attr.first_source))}${firstSeen ? ' (' + firstSeen + ')' : ''}`);
  parts.push(gclid ? `clic Google Ads: sí${adsAt ? ' el ' + adsAt : ''}${adsDaysAgo !== null ? ' (hace ' + adsDaysAgo + ' día' + (adsDaysAgo === 1 ? '' : 's') + ')' : ''}` : 'clic Google Ads: no registrado');
  if (gclid) parts.push(`gclid: ${gclid.slice(0, 24)}${gclid.length > 24 ? '…' : ''}`);
  if (attr.utm_campaign) parts.push(`campaña: ${String(attr.utm_campaign).slice(0, 60)}`);
  const note = parts.join(' · ');
  const step = {
    type: 'attribution',
    firstSource: String(attr.first_source || '').slice(0, 50),
    firstSeen: String(attr.first_seen || '').slice(0, 40),
    firstReferrer: String(attr.first_referrer || '').slice(0, 250),
    firstLanding: String(attr.first_landing || '').slice(0, 200),
    lastSource: String(attr.last_source || '').slice(0, 50),
    lastSeen: String(attr.last_seen || '').slice(0, 40),
    gclid,
    adsAt: String(attr.ads_at || '').slice(0, 40),
    adsFirst: String(attr.ads_first || '').slice(0, 40),
    utmCampaign: String(attr.utm_campaign || '').slice(0, 100),
    adsDaysAgo
  };
  return { note, step };
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
      const clientName = body.clientName ? String(body.clientName).trim().slice(0, 100) : '';
      let message = String(body.message || '').slice(0, 2000);
      if (clientName && !message.includes(clientName)) {
        message = `[Nombre: ${clientName}] ${message}`.slice(0, 2000);
      }
      const phone = String(body.phone || '').slice(0, 30);
      const { note: attrNote, step: attrStep } = buildAttribution(body.attribution);

      const row = {
        code,
        pin: '0000',
        materia: `WA: ${topic}`,
        tribunal: source,
        rit: caseCode ? `Causa: ${caseCode}` : 'Sin expediente',
        detalle: (message + (attrNote ? `\n— Atribución: ${attrNote}` : '')).slice(0, 2000),
        estado_actual: 0,
        steps: attrStep ? [attrStep] : [],
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
        phone: r.client_phone || null,
        attribution: (function() {
          let steps = r.steps;
          if (typeof steps === 'string') { try { steps = JSON.parse(steps); } catch (_) { steps = []; } }
          if (!Array.isArray(steps)) return null;
          return steps.find(s => s && s.type === 'attribution') || null;
        })()
      }));

      return res.status(200).json({ ok: true, contacts, total: contacts.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
};
