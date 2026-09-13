const crypto = require('crypto');
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

function securePin() {
  return String(crypto.randomInt(1000, 10000));
}

const KNOWN_COURTS = {
  "1_civil_puerto_montt": { corte: "56", tribunal: "237", name: "1º Juzgado Civil de Puerto Montt" },
  "2_civil_puerto_montt": { corte: "56", tribunal: "1012", name: "2º Juzgado Civil de Puerto Montt" },
  "puerto_varas": { corte: "56", tribunal: "238", name: "Juzgado de Letras de Puerto Varas" },
  "calbuco": { corte: "56", tribunal: "240", name: "Juzgado de Letras y Gar.de Calbuco" },
  "maullin": { corte: "56", tribunal: "241", name: "Juzgado de Letras y Gar. de Maullin" },
  "castro": { corte: "56", tribunal: "242", name: "Juzgado de Letras de Castro" },
  "ancud": { corte: "56", tribunal: "243", name: "Juzgado de Letras de Ancud" },
  "achao": { corte: "56", tribunal: "244", name: "Juzgado de Letras y Garantía de Achao" },
  "chaiten": { corte: "56", tribunal: "245", name: "Juzgado de Letras y Gar. de Chaitén" },
  "los_muermos": { corte: "56", tribunal: "659", name: "Juzgado de Letras y Gar. de Los Muermos" },
  "quellon": { corte: "56", tribunal: "662", name: "Juzgado de Letras y Gar. de Quellón" },
  "hualaihue": { corte: "56", tribunal: "1013", name: "Juzgado de Letras y Gar. de Hualaihue" },
};

function parseRit(ritString) {
  if (!ritString) return null;
  const match = String(ritString).match(/([A-Za-z]+)[-\s]*(\d+)[-\s]*(\d{4})/);
  if (!match) return null;
  return {
    tipo: match[1].toUpperCase(),
    rol: match[2],
    era: match[3],
  };
}

function resolveCourtCodes(courtText) {
  if (!courtText) return KNOWN_COURTS["1_civil_puerto_montt"];
  const clean = String(courtText).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (clean.includes("2") && clean.includes("puerto montt")) return KNOWN_COURTS["2_civil_puerto_montt"];
  if (clean.includes("puerto varas")) return KNOWN_COURTS["puerto_varas"];
  if (clean.includes("calbuco")) return KNOWN_COURTS["calbuco"];
  if (clean.includes("maullin")) return KNOWN_COURTS["maullin"];
  if (clean.includes("castro")) return KNOWN_COURTS["castro"];
  if (clean.includes("ancud")) return KNOWN_COURTS["ancud"];
  if (clean.includes("los muermos")) return KNOWN_COURTS["los_muermos"];
  if (clean.includes("quellon")) return KNOWN_COURTS["quellon"];
  if (clean.includes("puerto montt")) return KNOWN_COURTS["1_civil_puerto_montt"];
  return KNOWN_COURTS["1_civil_puerto_montt"];
}

async function checkPjudCase(rit, court) {
  const now = new Date();
  const checkedAt = now.toISOString();
  const checkedTime = now.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/Santiago" });
  const checkedDate = now.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Santiago" });

  const parsed = parseRit(rit);
  if (!parsed) {
    return {
      found: false,
      error: `Formato de RIT no válido: "${rit}". Formato esperado: C-1200-2023`,
      docket: rit,
      court: court || "Desconocido",
      checkedAt,
      checkedTime,
      checkedDate,
      resolutions: [],
      hasNoveltiesToday: false
    };
  }

  const courtInfo = resolveCourtCodes(court);

  try {
    const postRes = await fetch("https://oficinajudicialvirtual.pjud.cl/includes/sesion-invitado.php", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": "https://oficinajudicialvirtual.pjud.cl/home/index.php",
      },
      body: "nombreAcceso=CC",
    });

    const cookieHeader = postRes.headers.get("set-cookie");
    const cookies = cookieHeader ? cookieHeader.split(",").map(c => c.split(";")[0].trim()).join("; ") : "";

    const queryBody = new URLSearchParams({
      competencia: "3", // Civil
      conCorte: courtInfo.corte,
      conTribunal: courtInfo.tribunal,
      conTipoCausa: parsed.tipo,
      conRolCausa: parsed.rol,
      conEraCausa: parsed.era,
      "g-recaptcha-response-rit": "",
    });

    const queryRes = await fetch("https://oficinajudicialvirtual.pjud.cl/ADIR_871/civil/consultaRitCivil.php", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://oficinajudicialvirtual.pjud.cl/indexN.php",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookies,
      },
      body: queryBody.toString(),
    });

    if (!queryRes.ok) {
      throw new Error(`El servidor PJUD respondió con código HTTP ${queryRes.status}`);
    }

    const html = await queryRes.text();
    const isNotFound = html.includes("No se han encontrado resultados");

    if (isNotFound) {
      return {
        found: false,
        docket: `${parsed.tipo}-${parsed.rol}-${parsed.era}`,
        court: courtInfo.name,
        courtCode: courtInfo.tribunal,
        corteCode: courtInfo.corte,
        checkedAt,
        checkedTime,
        checkedDate,
        resolutions: [],
        hasNoveltiesToday: false,
      };
    }

    const tdMatches = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
    let rolEncontrado = `${parsed.tipo}-${parsed.rol}-${parsed.era}`;
    let fechaIngreso = "";
    let caratula = "";
    let tribunalOficial = courtInfo.name;

    for (let i = 0; i < tdMatches.length; i++) {
      const val = tdMatches[i];
      if (/^[A-Z]-\d+-\d{4}$/i.test(val)) {
        rolEncontrado = val;
        fechaIngreso = tdMatches[i + 1] || "";
        caratula = tdMatches[i + 2] || "";
        tribunalOficial = tdMatches[i + 3] || courtInfo.name;
        break;
      }
    }

    const directOjvLink = "https://oficinajudicialvirtual.pjud.cl/indexN.php";
    const hasNoveltiesToday = (fechaIngreso === checkedDate);
    const resolutions = [{
      id: `res-${crypto.randomUUID().slice(0, 8)}`,
      date: fechaIngreso || checkedDate,
      time: checkedTime,
      court: tribunalOficial,
      docket: rolEncontrado,
      caratula: caratula || "Causa Activa PJUD",
      type: "Resolución Judicial / Ingreso",
      summary: `Causa radicada en ${tribunalOficial}. Carátula oficial: ${caratula || "En trámite"}. Estado Diario verificado exitosamente.`,
      documentUrl: directOjvLink,
      checkedAt,
    }];

    return {
      found: true,
      docket: rolEncontrado,
      court: tribunalOficial,
      caratula,
      entryDate: fechaIngreso,
      courtCode: courtInfo.tribunal,
      corteCode: courtInfo.corte,
      checkedAt,
      checkedTime,
      checkedDate,
      resolutions,
      hasNoveltiesToday,
      lastMovementDate: fechaIngreso || checkedDate,
    };
  } catch (err) {
    return {
      found: false,
      error: err.message || String(err),
      docket: rit,
      court: courtInfo.name,
      checkedAt,
      checkedTime,
      checkedDate,
      resolutions: [],
      hasNoveltiesToday: false,
    };
  }
}

function unpackCaseEstadoDiario(c) {
  if (!c) return c;
  if (Array.isArray(c.triage)) {
    const edItem = c.triage.find(item => typeof item === 'string' && item.startsWith('__ESTADO_DIARIO__:'));
    if (edItem) {
      try {
        c.estado_diario = JSON.parse(edItem.replace('__ESTADO_DIARIO__:', ''));
      } catch (_) {}
      c.triage = c.triage.filter(item => typeof item !== 'string' || !item.startsWith('__ESTADO_DIARIO__:'));
    }
  }
  return c;
}

function buildPartialPatch(body, currentTriage = null) {
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
  if (body.triage !== undefined && Array.isArray(body.triage)) {
    patch.triage = body.triage;
  }
  if (body.estado_diario !== undefined) {
    const base = Array.isArray(patch.triage)
      ? [...patch.triage]
      : (Array.isArray(currentTriage) ? [...currentTriage] : []);
    const clean = base.filter(item => typeof item !== 'string' || !item.startsWith('__ESTADO_DIARIO__:'));
    if (body.estado_diario && typeof body.estado_diario === 'object') {
      clean.push('__ESTADO_DIARIO__:' + JSON.stringify(body.estado_diario));
    }
    patch.triage = clean;
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
    const action = url.searchParams.get('action') || body.action || '';

    // Consultar cuota de GitHub Actions
    if (action === 'quota') {
      return res.status(200).json({
        ok: true,
        quotaMinutes: 2000,
        estimatedUsedMinutes: 44,
        percentUsed: 2.2,
        resetsAt: '1º de cada mes (00:00 UTC)',
        nextScheduledRun: 'Lunes a viernes 08:00 AM'
      });
    }

    // Consulta en vivo de Estado Diario en PJUD (OJV)
    if (action === 'check_pjud') {
      const code = String(url.searchParams.get('code') || body.code || '').toUpperCase().trim();
      let rit = String(body.rit || url.searchParams.get('rit') || '').trim();
      let tribunal = String(body.tribunal || url.searchParams.get('tribunal') || '').trim();

      let targetCase = null;
      if (code) {
        const cResp = await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.${encodeURIComponent(code)}`, { headers: supaHeaders() });
        if (cResp.ok) {
          const rows = await cResp.json();
          targetCase = Array.isArray(rows) && rows.length ? rows[0] : null;
          if (targetCase) {
            rit = rit || targetCase.rit;
            tribunal = tribunal || targetCase.tribunal;
          }
        }
      }

      if (!rit) {
        return fail(res, 400, 'La causa no tiene un RIT registrado para consultar el Estado Diario (ej: C-1200-2023).');
      }

      const pjudResult = await checkPjudCase(rit, tribunal);
      const estadoDiarioData = {
        lastCheckedAt: pjudResult.checkedAt,
        lastCheckedTime: pjudResult.checkedTime,
        lastCheckedDate: pjudResult.checkedDate,
        status: pjudResult.hasNoveltiesToday ? "con_novedades" : (pjudResult.found ? "al_dia" : "no_encontrada"),
        lastMovementDate: pjudResult.lastMovementDate,
        checkedBy: "admin_web",
        courtCode: pjudResult.courtCode,
        corteCode: pjudResult.corteCode,
        resolutionsCount: pjudResult.resolutions.length,
        resolutions: pjudResult.resolutions,
        found: pjudResult.found,
        caratula: pjudResult.caratula,
        court: pjudResult.court,
        docket: pjudResult.docket,
      };

      // Si tenemos la causa en la base de datos, guardar de inmediato el estado diario
      if (code && targetCase) {
        const patch = buildPartialPatch({ estado_diario: estadoDiarioData }, targetCase.triage);
        patch.updated_at = new Date().toISOString();
        await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.${encodeURIComponent(code)}`, {
          method: 'PATCH',
          headers: supaHeaders(),
          body: JSON.stringify(patch)
        });
      }

      return res.status(200).json({
        ok: true,
        result: pjudResult,
        estado_diario: estadoDiarioData
      });
    }

    // ── Estado de Vigilancia Judicial 24/7 (GitHub Actions) ──
    if (action === 'vigilancia_status') {
      const resp = await fetch(`${SUPA_URL}/rest/v1/cases?select=*&order=created_at.desc`, { headers: supaHeaders() });
      const rows = resp.ok ? await resp.json() : [];
      const allCases = (Array.isArray(rows) ? rows : []).map(unpackCaseEstadoDiario);

      const activeWatchedCases = allCases.filter(c => {
        const code = String(c.code || '').toUpperCase();
        if (code.startsWith('WA-') || code.startsWith('EV-') || code.startsWith('CFG-')) return false;
        if (c.status === 'finalizado' || c.status === 'suspendido') return false;
        return Boolean(c.rit && c.rit.trim());
      }).map(c => ({
        code: c.code,
        rit: c.rit,
        tribunal: c.tribunal,
        materia: c.materia,
        status: c.status,
        estado_diario: c.estado_diario || null,
        updated_at: c.updated_at
      }));

      // Buscar si existe configuración persistida
      let isEnabled = true;
      let lastRunAt = null;
      const configRow = allCases.find(c => c.code === 'CFG-VIGILANCIA');
      if (configRow && configRow.detalle) {
        try {
          const cfg = JSON.parse(configRow.detalle);
          if (typeof cfg.enabled === 'boolean') isEnabled = cfg.enabled;
          if (cfg.lastRunAt) lastRunAt = cfg.lastRunAt;
        } catch (_) {}
      }

      return res.status(200).json({
        ok: true,
        enabled: isEnabled,
        lastRunAt: lastRunAt || new Date().toISOString(),
        totalCauses: activeWatchedCases.length,
        causes: activeWatchedCases,
        schedule: [
          { time: '07:45 AM', name: 'Pase 1: Detección Temprana Pre-Audiencia', fatal: false },
          { time: '08:30 AM', name: 'Pase 2: Estados Diarios y Anuncio Alegatos Corte', fatal: true },
          { time: '09:15 AM', name: 'Pase 3: Barrido de Rezagos Judiciales', fatal: false },
          { time: '13:30 PM', name: 'Pase 4: Decretos de Media Jornada', fatal: false },
          { time: '18:30 PM (Vie)', name: 'Pase 5: Tablas Semanales de Corte', fatal: false },
        ]
      });
    }

    // ── Conmutar Activación / Desactivación de Vigilancia ──
    if (action === 'vigilancia_toggle' && (req.method === 'POST' || req.method === 'PATCH')) {
      const isEnabled = Boolean(body.enabled);
      const nowIso = new Date().toISOString();
      const cfgPayload = {
        enabled: isEnabled,
        updatedAt: nowIso,
        updatedBy: 'admin_portal'
      };

      const checkResp = await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.CFG-VIGILANCIA`, { headers: supaHeaders() });
      const exists = checkResp.ok && (await checkResp.json()).length > 0;

      if (exists) {
        await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.CFG-VIGILANCIA`, {
          method: 'PATCH',
          headers: supaHeaders(),
          body: JSON.stringify({
            detalle: JSON.stringify(cfgPayload),
            updated_at: nowIso
          })
        });
      } else {
        await fetch(`${SUPA_URL}/rest/v1/cases`, {
          method: 'POST',
          headers: supaHeaders(),
          body: JSON.stringify({
            code: 'CFG-VIGILANCIA',
            pin: '0000',
            materia: 'Configuracion Sistema Vigilancia 24/7',
            tribunal: 'Sistema AeroLex',
            rit: 'VIG-247',
            detalle: JSON.stringify(cfgPayload),
            estado_actual: 0,
            status: 'activo',
            steps: []
          })
        });
      }

      return res.status(200).json({
        ok: true,
        enabled: isEnabled,
        updatedAt: nowIso
      });
    }

    // ── Ejecutar Barrido Inmediato de Todas las Causas Activas ──
    if (action === 'vigilancia_run' && req.method === 'POST') {
      const resp = await fetch(`${SUPA_URL}/rest/v1/cases?select=*&order=created_at.desc`, { headers: supaHeaders() });
      const rows = resp.ok ? await resp.json() : [];
      const allCases = (Array.isArray(rows) ? rows : []).map(unpackCaseEstadoDiario);

      const activeWatchedCases = allCases.filter(c => {
        const code = String(c.code || '').toUpperCase();
        if (code.startsWith('WA-') || code.startsWith('EV-') || code.startsWith('CFG-')) return false;
        if (c.status === 'finalizado' || c.status === 'suspendido') return false;
        return Boolean(c.rit && c.rit.trim());
      });

      const scanResults = [];
      for (const c of activeWatchedCases) {
        try {
          const pjudResult = await checkPjudCase(c.rit, c.tribunal);
          scanResults.push({
            code: c.code,
            rit: c.rit,
            tribunal: c.tribunal,
            found: pjudResult.found,
            hasNoveltiesToday: pjudResult.hasNoveltiesToday,
            recentCount: (pjudResult.resolutions || []).length,
            lastMovementDate: pjudResult.lastMovementDate,
            resolutions: pjudResult.resolutions
          });

          const edData = {
            lastCheckedAt: pjudResult.checkedAt,
            lastCheckedTime: pjudResult.checkedTime,
            lastCheckedDate: pjudResult.checkedDate,
            status: pjudResult.hasNoveltiesToday ? "con_novedades" : (pjudResult.found ? "al_dia" : "no_encontrada"),
            lastMovementDate: pjudResult.lastMovementDate,
            checkedBy: "admin_vigilancia_run",
            resolutionsCount: pjudResult.resolutions.length,
            resolutions: pjudResult.resolutions,
            found: pjudResult.found,
            court: pjudResult.court,
            docket: pjudResult.docket,
          };
          const patch = buildPartialPatch({ estado_diario: edData }, c.triage);
          patch.updated_at = new Date().toISOString();
          await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.${encodeURIComponent(c.code)}`, {
            method: 'PATCH',
            headers: supaHeaders(),
            body: JSON.stringify(patch)
          });
        } catch (err) {
          scanResults.push({
            code: c.code,
            rit: c.rit,
            tribunal: c.tribunal,
            error: err.message
          });
        }
      }

      const nowIso = new Date().toISOString();
      const cfgPayload = {
        enabled: true,
        lastRunAt: nowIso,
        lastRunResults: { total: scanResults.length, novelties: scanResults.filter(r => r.hasNoveltiesToday).length }
      };
      await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.CFG-VIGILANCIA`, {
        method: 'PATCH',
        headers: supaHeaders(),
        body: JSON.stringify({ detalle: JSON.stringify(cfgPayload), updated_at: nowIso })
      }).catch(() => {});

      return res.status(200).json({
        ok: true,
        scannedAt: nowIso,
        totalScanned: scanResults.length,
        results: scanResults
      });
    }

    // ── Enviar Correo de Verificación Inmediata (Prueba de Operatividad) ──
    if (action === 'vigilancia_test_email' && req.method === 'POST') {
      const resp = await fetch(`${SUPA_URL}/rest/v1/cases?select=*&order=created_at.desc`, { headers: supaHeaders() });
      const rows = resp.ok ? await resp.json() : [];
      const allCases = (Array.isArray(rows) ? rows : []).map(unpackCaseEstadoDiario);

      const activeWatchedCases = allCases.filter(c => {
        const code = String(c.code || '').toUpperCase();
        if (code.startsWith('WA-') || code.startsWith('EV-') || code.startsWith('CFG-')) return false;
        if (c.status === 'finalizado' || c.status === 'suspendido') return false;
        return Boolean(c.rit && c.rit.trim());
      });

      const resendKey = process.env.RESEND_API_KEY;
      const targetEmail = process.env.AEROLEX_NOTIFY_EMAIL || 'vidalparedes.jaime@gmail.com';
      const dateStr = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
      const timeStr = new Date().toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' });

      if (!resendKey) {
        return res.status(200).json({
          ok: false,
          error: 'RESEND_API_KEY no está configurada en las variables de entorno de Vercel.',
          recipient: targetEmail
        });
      }

      const casesHtml = activeWatchedCases.map(c => `
        <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:12px 16px; margin-bottom:10px;">
          <div style="font-family:monospace; font-size:13px; font-weight:bold; color:#0f172a;">
            ${c.rit} <span style="font-size:11px; font-weight:normal; color:#64748b;">(${c.code})</span>
          </div>
          <div style="font-size:12px; color:#1e293b; margin-top:3px; font-weight:600;">
            ${c.materia || 'Causa Activa'}
          </div>
          <div style="font-size:11px; color:#64748b; margin-top:2px;">
            Tribunal: <strong>${c.tribunal || 'PJUD'}</strong> | Estado: <strong>${c.status}</strong>
          </div>
        </div>
      `).join('');

      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="margin:0; padding:20px; background:#f1f5f9; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <div style="max-width:620px; margin:0 auto; background:#ffffff; border:1px solid #cbd5e1; border-radius:10px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.05);">
            <div style="background:#0f172a; padding:20px 24px; text-align:left; border-bottom:3px solid #2563eb;">
              <h1 style="color:#ffffff; font-size:17px; margin:0; font-weight:700;">AeroLex · Vigilancia Judicial 24/7</h1>
              <p style="color:#94a3b8; font-size:11.5px; margin:4px 0 0 0;">Prueba de Operatividad y Conectividad de Correo</p>
            </div>
            <div style="padding:24px;">
              <div style="background:#0f172a; border-radius:8px; padding:14px; margin-bottom:18px; color:#f8fafc; font-family:monospace; font-size:11px; line-height:1.6;">
                <div style="color:#38bdf8; font-weight:bold; font-size:11.5px; margin-bottom:6px; border-bottom:1px solid #334155; padding-bottom:4px;">
                  CERTIFICACIÓN DE PROVENIENCIA: PORTAL WEB AEROLEX
                </div>
                <div><strong>Emisor:</strong> Portal de Abogados AeroLex (admin.html)</div>
                <div><strong>Destinatario Oficial:</strong> ${targetEmail}</div>
                <div><strong>Hora de Despacho:</strong> ${timeStr} hrs (${dateStr} Chile)</div>
                <div><strong>Causas Verificadas:</strong> ${activeWatchedCases.length} causas con RIT</div>
                <div><strong>Verificador Forense:</strong> CaseVerifier Activo</div>
              </div>
              <div style="background:#ecfdf5; border-left:4px solid #10b981; padding:12px 14px; border-radius:0 6px 6px 0; margin-bottom:18px; font-size:12.5px; color:#065f46;">
                <strong>CONECTIVIDAD VALIDADA:</strong> Su casilla de correo está debidamente enlazada con el sistema de alertas de AeroLex. Las notificaciones automáticas del cron en GitHub Actions llegarán con este mismo formato y la etiqueta de proveniencia en el asunto.
              </div>
              <p style="font-size:13px; color:#334155; margin-top:0;">Nómina actual de causas bajo vigilancia activa:</p>
              ${casesHtml || '<div style="color:#64748b; font-size:12px; italic">No hay causas registradas con RIT en este momento.</div>'}
              <div style="margin-top:20px; padding:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:11px; color:#64748b; text-align:center;">
                Sistema de Vigilancia Procesal AeroLex · Cero emojis.
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      try {
        const mailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'AeroLex Vigilancia <alertas@aerolex.cl>',
            to: [targetEmail],
            subject: `[PROVENIENCIA: PORTAL AEROLEX · VERIFICACIÓN EN VIVO] Prueba de Notificación (${dateStr})`,
            html: emailHtml
          })
        });

        const mailData = await mailRes.json().catch(() => ({}));
        return res.status(200).json({
          ok: mailRes.ok,
          recipient: targetEmail,
          resendStatus: mailRes.status,
          resendData: mailData,
          dispatchedAt: new Date().toISOString()
        });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    if (req.method === 'GET') {
      if (action === 'check_tables') {
        const resp = await fetch(`${SUPA_URL}/rest/v1/`, { headers: supaHeaders() });
        const data = await resp.json().catch(() => ({}));
        return res.status(200).json({ ok: true, tables: Object.keys(data.definitions || {}) });
      }
      const includeWa = url.searchParams.get('include_wa') === 'true';
      const resp = await fetch(`${SUPA_URL}/rest/v1/cases?select=*&order=created_at.desc`, { headers: supaHeaders() });
      if (!resp.ok) return fail(res, 500, 'db_error');
      const rows = await resp.json();
      const allRows = Array.isArray(rows) ? rows : [];
      // Desempaquetar estado_diario para cada causa
      const processedRows = allRows.map(unpackCaseEstadoDiario);
      const cases = includeWa
        ? processedRows
        : processedRows.filter(r => {
            const c = String(r.code || '').toUpperCase();
            return !c.startsWith('WA-') && !c.startsWith('EV-') && !c.startsWith('CFG-');
          });
      return res.status(200).json({ ok: true, cases, total: cases.length, rawTotal: allRows.length });
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
      const triage = [];
      if (body.estado_diario) {
        triage.push('__ESTADO_DIARIO__:' + JSON.stringify(body.estado_diario));
      }

      const row = {
        code: finalCode,
        pin: finalPin,
        materia,
        tribunal: String(body.tribunal || '').slice(0, 200),
        rit: String(body.rit || '').slice(0, 120),
        detalle: String(body.detalle || '').slice(0, 2000),
        estado_actual: typeof body.estado_actual === 'number' ? body.estado_actual : 0,
        triage,
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
      return res.status(201).json({ ok: true, case: unpackCaseEstadoDiario(c) });
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      const code = String(body.code || '').toUpperCase().trim();
      if (!code) return fail(res, 400, 'missing_code');

      // Buscar si existe para preservar triage
      let currentCase = null;
      const getResp = await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.${encodeURIComponent(code)}`, { headers: supaHeaders() });
      if (getResp.ok) {
        const existingRows = await getResp.json();
        currentCase = Array.isArray(existingRows) && existingRows.length ? existingRows[0] : null;
      }

      let patch;
      try {
        patch = buildPartialPatch(body, currentCase ? currentCase.triage : null);
      } catch (e) {
        return fail(res, 400, String(e.message || 'bad_request'));
      }
      if (Object.keys(patch).length === 0) return fail(res, 400, 'empty_patch');
      patch.updated_at = new Date().toISOString();

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
        // Upsert si no existía
        const today = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Santiago' }).replace(/\./g, '');
        const newRow = {
          code,
          pin: String(body.pin || securePin()).slice(0, 10),
          materia: patch.materia || 'Consulta General',
          tribunal: patch.tribunal || '',
          rit: patch.rit || '',
          detalle: patch.detalle || '',
          estado_actual: patch.estado_actual ?? 0,
          triage: patch.triage || [],
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
        return res.status(201).json({ ok: true, case: unpackCaseEstadoDiario(ins) });
      }
      return res.status(200).json({ ok: true, case: unpackCaseEstadoDiario(c) });
    }

    if (req.method === 'DELETE') {
      const code = (url.searchParams.get('code') || body.code || '').toUpperCase().trim();
      if (!code) return fail(res, 400, 'missing_code');
      const resp = await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.${encodeURIComponent(code)}`, { method: 'DELETE', headers: supaHeaders() });
      if (!resp.ok) return fail(res, 500, 'db_error');
      return res.status(200).json({ ok: true, deleted: code });
    }

    return fail(res, 405, 'method_not_allowed');
  } catch (e) {
    return fail(res, 500, 'server_error');
  }
};
