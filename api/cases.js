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

function stepsTemplate(materia) {
  const m = ' ' + (materia || '').toLowerCase() + ' ';
  const has = (...words) => words.some(w => m.includes(w));
  const today = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Santiago' }).replace(/\./g, '');
  const mk = (title, date, done) => ({ title, date: date || 'Pendiente', done: !!done });

  const extra = [];
  if (has('inmobiliario', 'compraventa', 'título', 'títulos', 'escritura', 'loteo', 'subdivisión', 'prescripción', 'posesorio', 'posesoria')) {
    extra.push(mk('Estudio y análisis de títulos', 'Pendiente'));
    extra.push(mk('Firma de escritura / gestión notarial', 'Pendiente'));
    extra.push(mk('Inscripción en Conservador (CBR)', 'Pendiente'));
  } else if (has('laboral', 'despido', 'tutela', 'finiquito', 'trabajo')) {
    extra.push(mk('Análisis de plazos legales', 'En curso'));
    extra.push(mk('Presentación de demanda / descargos', 'Pendiente'));
    extra.push(mk('Audiencia preparatoria', 'Pendiente'));
  } else if (has('divorcio', 'alimento', 'familia', 'cuidado', 'visita', 'vif', 'compensación')) {
    extra.push(mk('Reunión de estrategia con abogado', 'Pendiente'));
    extra.push(mk('Redacción y presentación de demanda', 'Pendiente'));
    extra.push(mk('Audiencia ante tribunal de familia', 'Pendiente'));
  } else if (has('posesión efectiva', 'herencia', 'sucesor', 'testamento', 'partición')) {
    extra.push(mk('Inventario de bienes y deudas', 'Pendiente'));
    extra.push(mk('Tramitación de posesión efectiva', 'Pendiente'));
    extra.push(mk('Inscripción y partición de bienes', 'Pendiente'));
  } else if (has('dron', 'drone', 'aéreo', 'aerea', 'predio', 'deslinde', 'ortomosaico', 'ortofoto', 'fotogrametr', 'modelo 3d', 'inspección', 'inspeccion', 'vuelo')) {
    extra.push(mk('Planificación de vuelo y logística', 'Pendiente'));
    extra.push(mk('Levantamiento aéreo y procesamiento', 'Pendiente'));
    extra.push(mk('Informe técnico-legal entregable', 'Pendiente'));
  } else if (has('sociedad', 'comercial', 'compliance', 'empresa', 'societ', 'contrato')) {
    extra.push(mk('Revisión documental y estructura', 'Pendiente'));
    extra.push(mk('Elaboración de instrumentos', 'Pendiente'));
    extra.push(mk('Firma e inscripción', 'Pendiente'));
  } else {
    extra.push(mk('Evaluación por el abogado asignado', 'Pendiente'));
  }

  return [
    mk('Expediente recibido por AeroLex', today, true),
    mk('Revisión de antecedentes', 'En curso'),
    ...extra,
    mk('Cierre y entrega de resultados', 'Pendiente')
  ];
}

async function listYearCodes(year) {
  const prefix = `ALX-${year}-`;
  const resp = await fetch(`${SUPA_URL}/rest/v1/cases?select=code&code=like.${prefix}*`, { headers: supaHeaders() });
  if (!resp.ok) throw new Error('db_read');
  const rows = await resp.json();
  const nums = (Array.isArray(rows) ? rows : []).map(r => parseInt(String(r.code).split('-')[2], 10)).filter(n => !isNaN(n));
  return { prefix, max: nums.length ? Math.max(...nums) : 0 };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!SUPA_URL || !SUPA_KEY) return fail(res, 500, 'not_configured');

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const code = (url.searchParams.get('code') || '').toUpperCase().trim();
      const pin = (url.searchParams.get('pin') || '').trim();
      if (!code || !pin) return fail(res, 400, 'missing_params');

      const resp = await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.${encodeURIComponent(code)}&select=code,pin,materia,tribunal,rit,detalle,estado_actual,steps,status`, { headers: supaHeaders() });
      if (!resp.ok) return fail(res, 500, 'db_error');
      const rows = await resp.json();
      if (!Array.isArray(rows) || rows.length === 0) return fail(res, 404, 'not_found');

      const c = rows[0];
      if (String(c.pin || '') !== pin) return fail(res, 401, 'bad_pin');

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
          status: c.status
        }
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const materia = String(body.materia || 'Consulta General').slice(0, 150);
      const phone = String(body.phone || '').slice(0, 25);
      const triage = Array.isArray(body.triage)
        ? body.triage.slice(0, 50).map(a => String(a).slice(0, 400))
        : [];

      const year = new Date().getFullYear();
      const { prefix, max } = await listYearCodes(year);

      for (let attempt = 1; attempt <= 3; attempt++) {
        const code = `${prefix}${String(max + attempt).padStart(2, '0')}`;
        const pin = String(Math.floor(1000 + Math.random() * 9000));
        const isUrgent = triage.some(a => String(a).toUpperCase().includes('URGENCIA'));
        const row = {
          code,
          pin,
          materia,
          client_phone: phone,
          triage,
          tribunal: '',
          rit: '',
          detalle: '',
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
          return res.status(201).json({ ok: true, code: c.code, pin: c.pin, materia: c.materia });
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
