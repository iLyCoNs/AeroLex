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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: Ingesta pública de eventos de telemetría desde index.html
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const now = new Date();
      const year = now.getFullYear();
      const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
      const code = `EV-${year}-${rand}`;

      const source = String(body.source || 'direct_other').slice(0, 50); // 'google_ads', 'google_organic', 'direct_other'
      const eventType = String(body.event || 'visita').slice(0, 80);
      const gclid = String(body.gclid || '').slice(0, 150);
      const utmCampaign = String(body.utm_campaign || '').slice(0, 100);
      const device = String(body.device || 'desktop').slice(0, 30);
      const pathUrl = String(body.path || '/').slice(0, 150);
      const detail = String(body.detail || '').slice(0, 1000);
      const referrer = String(body.referrer || '').slice(0, 250);
      const sessionId = String(body.session_id || '').slice(0, 80);

      const eventPayload = {
        code,
        timestamp: now.toISOString(),
        source,
        eventType,
        gclid,
        utmCampaign,
        device,
        path: pathUrl,
        detail,
        referrer,
        sessionId
      };

      if (SUPA_URL && SUPA_KEY) {
        const row = {
          code,
          pin: '0000',
          materia: `EV: ${source} | ${eventType}`,
          tribunal: `${device} | ${source}`,
          rit: gclid ? `GCLID: ${gclid}` : (utmCampaign ? `UTM: ${utmCampaign}` : (referrer ? `Ref: ${referrer.slice(0, 100)}` : 'Sin ref')),
          detalle: JSON.stringify(eventPayload),
          estado_actual: 0,
          steps: [],
          status: 'evento'
        };

        await fetch(`${SUPA_URL}/rest/v1/cases`, {
          method: 'POST',
          headers: supaHeaders({ 'Prefer': 'return=representation' }),
          body: JSON.stringify(row)
        }).catch(err => {
          console.warn('[Telemetry] Supabase error:', err.message);
        });
      }

      return res.status(200).json({ ok: true, id: code, event: eventPayload });
    } catch (e) {
      return res.status(200).json({ ok: false, error: e.message });
    }
  }

  // GET: Consulta autenticada para admin.html
  if (req.method === 'GET') {
    const key = req.headers['x-admin-key'] || '';
    if (!key || key !== process.env.ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    try {
      let events = [];
      if (SUPA_URL && SUPA_KEY) {
        const query = `${SUPA_URL}/rest/v1/cases?code=like.EV-*&order=created_at.desc&limit=300`;
        const resp = await fetch(query, { headers: supaHeaders() });
        if (resp.ok) {
          const rows = await resp.json();
          events = (Array.isArray(rows) ? rows : []).map(r => {
            try {
              return JSON.parse(r.detalle);
            } catch (_) {
              return {
                code: r.code,
                timestamp: r.created_at,
                source: (r.materia || '').replace(/^EV:\s*/, '').split('|')[0]?.trim() || 'unknown',
                eventType: (r.materia || '').split('|')[1]?.trim() || 'evento',
                detail: r.detalle || '',
                rit: r.rit || '',
                tribunal: r.tribunal || ''
              };
            }
          });
        }
      }

      const googleAdsVisits = events.filter(e => e.source === 'google_ads' && (e.eventType === 'visita' || e.eventType === 'page_view')).length;
      const googleOrganicVisits = events.filter(e => e.source === 'google_organic' && (e.eventType === 'visita' || e.eventType === 'page_view')).length;
      const otherVisits = events.filter(e => e.source === 'direct_other' && (e.eventType === 'visita' || e.eventType === 'page_view')).length;
      const totalVisits = googleAdsVisits + googleOrganicVisits + otherVisits;

      const whatsappClicks = events.filter(e => e.eventType === 'whatsapp_click').length;
      const searchesCount = events.filter(e => ['triage_start', 'calculator_use', 'faq_open', 'service_view', 'case_check'].includes(e.eventType)).length;

      const totalGoogleVisits = googleAdsVisits + googleOrganicVisits;
      const googleConversionRate = totalGoogleVisits > 0 
        ? ((whatsappClicks / totalGoogleVisits) * 100).toFixed(1)
        : '0.0';

      return res.status(200).json({
        ok: true,
        metrics: {
          googleAdsVisits,
          googleOrganicVisits,
          otherVisits,
          totalVisits,
          whatsappClicks,
          searchesCount,
          googleConversionRate: `${googleConversionRate}%`
        },
        events,
        totalEvents: events.length
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // DELETE: Purgar eventos antiguos si el admin lo solicita
  if (req.method === 'DELETE') {
    const key = req.headers['x-admin-key'] || '';
    if (!key || key !== process.env.ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    try {
      if (SUPA_URL && SUPA_KEY) {
        const resp = await fetch(`${SUPA_URL}/rest/v1/cases?code=like.EV-*`, {
          method: 'DELETE',
          headers: supaHeaders()
        });
        if (!resp.ok) return res.status(500).json({ ok: false, error: 'db_error' });
      }
      return res.status(200).json({ ok: true, message: 'telemetry_purged' });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
};
