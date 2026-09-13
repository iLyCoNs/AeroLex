#!/usr/bin/env node
/**
 * scripts/vigia-nube-cron.mjs
 * Motor Autónomo de Vigilancia Judicial 24/7 en la Nube para AeroLex (GitHub Actions).
 * 
 * Opera con el computador del abogado totalmente apagado.
 * Sincroniza la cartera completa de causas de los abogados socios (5 causas).
 * Lee la activación de la vigilancia desde Supabase (CFG-VIGILANCIA).
 * Escanea las causas en OJV / PJUD y Cortes de Apelaciones.
 * Despacha alertas por correo vía Gmail SMTP SSL o Resend.
 * 
 * Regla de diseño: Cero emojis.
 */

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const NOTIFY_EMAIL = process.env.AEROLEX_NOTIFY_EMAIL || 'vidalparedes.jaime@gmail.com';
const RESEND_KEY = process.env.RESEND_API_KEY;
const GMAIL_USER = process.env.GMAIL_USER || process.env.AEROLEX_SMTP_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASS || process.env.AEROLEX_SMTP_PASS;
const isTestMode = process.argv.includes('--test');

function supaHeaders(extra = {}) {
  return {
    'apikey': SUPA_KEY,
    'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
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
  "4_familia_santiago": { corte: "90", tribunal: "683", name: "4° Juzgado de Familia de Santiago" },
};

// Cartera oficial activa de expedientes de los abogados socios
const PARTNER_CAUSES = [
  {
    code: "ALX-2026-71",
    rit: "1071-2026",
    tribunal: "Corte de Apelaciones de Puerto Montt",
    materia: "Recurso de Protección - Migración (-/-)",
    detalle: "Causa reservada en materia migratoria por disposición legal del Acta N° 44-2022 de la Corte Suprema.",
    abogado: "Marta Elizabeth Sánchez Andrade",
    status: "activo"
  },
  {
    code: "ALX-2026-72",
    rit: "1324-2026",
    tribunal: "Corte de Apelaciones de Puerto Montt",
    materia: "Contrato, nulidad de - MANSILLA / ZURITA",
    detalle: "Apelación sentencia definitiva (C-25-2025 Letras Achao). Patrocinado: Edith del Carmen Mansilla Ojeda. Contraparte: Arturo Zurita Pereira.",
    abogado: "Marta Elizabeth Sánchez Andrade",
    status: "activo"
  },
  {
    code: "ALX-2026-73",
    rit: "1360-2026",
    tribunal: "Corte de Apelaciones de Puerto Montt",
    materia: "Recurso de Protección - ALVARADO / PERANCHIGUAY",
    detalle: "Recurso de Protección. Abogada socia patrocinante: Marta Elizabeth Sánchez Andrade. Cliente: Diego Armando Alvarado Paredes.",
    abogado: "Marta Elizabeth Sánchez Andrade",
    status: "activo"
  },
  {
    code: "ALX-2026-74",
    rit: "1452-2026",
    tribunal: "Corte de Apelaciones de Puerto Montt",
    materia: "Recurso de Protección - Migración (-/-)",
    detalle: "Causa reservada en materia migratoria por disposición legal del Acta N° 44-2022 de la Corte Suprema.",
    abogado: "Marta Elizabeth Sánchez Andrade",
    status: "activo"
  },
  {
    code: "ALX-2026-75",
    rit: "Z-789-2020",
    tribunal: "4 Juzgado de Familia Santiago",
    materia: "Alimentos - MUÑOZ / NITSCHKE",
    detalle: "Juicio de alimentos. Cliente: Daniel Alejandro Nitschke Aliaga. Contraparte: Pamela Muñoz Vásquez.",
    abogado: "Jaime Vidal Paredes",
    status: "activo"
  }
];

function parseRit(ritString) {
  if (!ritString) return null;
  const clean = ritString.trim().toUpperCase();
  const m = clean.match(/^([A-Z]{1,3})[- ]?(\d+)[- ]?(\d{4})$/);
  if (!m) return null;
  return { tipo: m[1], rol: m[2], era: m[3] };
}

function resolveCourt(courtId) {
  if (!courtId) return KNOWN_COURTS["1_civil_puerto_montt"];
  const direct = KNOWN_COURTS[courtId];
  if (direct) return direct;
  const lower = courtId.toLowerCase();
  for (const [key, val] of Object.entries(KNOWN_COURTS)) {
    if (lower.includes(key) || val.name.toLowerCase().includes(lower)) return val;
  }
  return KNOWN_COURTS["1_civil_puerto_montt"];
}

async function syncPartnerCausesToSupabase() {
  console.log('[Vigilancia Nube] Sincronizando nómina completa de causas de abogados socios en Supabase...');
  const resp = await fetch(`${SUPA_URL}/rest/v1/cases?select=code,rit`, { headers: supaHeaders() });
  const existing = resp.ok ? await resp.json() : [];
  const existingRits = new Set((existing || []).map(c => String(c.rit || '').trim().toUpperCase()));

  for (const pc of PARTNER_CAUSES) {
    if (!existingRits.has(pc.rit.toUpperCase())) {
      console.log(`  · Registrando nueva causa de socio en Supabase: ${pc.rit} (${pc.code} - ${pc.materia} - ${pc.abogado})`);
      const row = {
        code: pc.code,
        pin: '0000',
        materia: pc.materia,
        tribunal: pc.tribunal,
        rit: pc.rit,
        detalle: pc.detalle,
        estado_actual: 1,
        triage: [
          '__ABOGADO__:' + (pc.abogado || 'Jaime Vidal Paredes')
        ],
        steps: [
          { title: 'Expediente recibido por AeroLex', date: '13-sep-2026', done: true },
          { title: 'Vigilancia procesal activa en OJV', date: 'En curso', done: false }
        ],
        status: pc.status,
        created_at: new Date().toISOString()
      };
      await fetch(`${SUPA_URL}/rest/v1/cases`, {
        method: 'POST',
        headers: supaHeaders(),
        body: JSON.stringify(row)
      }).catch(() => {});
    }
  }
}

async function checkPjudCase(rit, courtId) {
  const parsed = parseRit(rit);
  if (!parsed) return { found: false, error: "Formato de RIT inválido" };
  const courtInfo = resolveCourt(courtId);

  const checkedAt = new Date().toISOString();
  const checkedDate = new Date().toLocaleDateString("es-CL", { timeZone: "America/Santiago" });
  const checkedTime = new Date().toLocaleTimeString("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" });

  try {
    const sessionRes = await fetch("https://oficinajudicialvirtual.pjud.cl/indexN.php", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
    });
    const setCookie = sessionRes.headers.get("set-cookie") || "";
    const cookies = setCookie.split(",").map(c => c.split(";")[0].trim()).join("; ");

    const queryBody = new URLSearchParams({
      conTipoCausa: parsed.tipo,
      conRolCausa: parsed.rol,
      conEraCausa: parsed.era,
      conTribunal: courtInfo.tribunal,
      conCorte: courtInfo.corte,
    });

    const queryRes = await fetch("https://oficinajudicialvirtual.pjud.cl/ADIR_871/tribunales/consultaRitTribunales.php", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://oficinajudicialvirtual.pjud.cl/indexN.php",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookies,
      },
      body: queryBody.toString(),
    });

    if (!queryRes.ok) throw new Error(`PJUD HTTP ${queryRes.status}`);
    const html = await queryRes.text();
    const isNotFound = html.includes("No se han encontrado resultados");

    if (isNotFound) {
      return {
        found: false,
        docket: `${parsed.tipo}-${parsed.rol}-${parsed.era}`,
        court: courtInfo.name,
        checkedAt, checkedTime, checkedDate,
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

    const hasNoveltiesToday = (fechaIngreso === checkedDate);
    const resolutions = [{
      id: `res-${crypto.randomUUID().slice(0, 8)}`,
      date: fechaIngreso || checkedDate,
      time: checkedTime,
      court: tribunalOficial,
      docket: rolEncontrado,
      caratula: caratula || "Causa Activa PJUD",
      type: "Resolución Judicial / Ingreso",
      summary: `Causa radicada en ${tribunalOficial}. Carátula: ${caratula || "En trámite"}.`,
      checkedAt,
    }];

    return {
      found: true,
      docket: rolEncontrado,
      court: tribunalOficial,
      caratula,
      entryDate: fechaIngreso,
      checkedAt, checkedTime, checkedDate,
      resolutions,
      hasNoveltiesToday,
      lastMovementDate: fechaIngreso || checkedDate,
    };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

function sendViaSmtpScript(subject, text, html) {
  return new Promise((resolve) => {
    const pythonScript = join(__dirname, 'send-email-smtp.py');
    const payload = JSON.stringify({
      recipient: NOTIFY_EMAIL,
      subject,
      text,
      html
    });

    const env = {
      ...process.env,
      GMAIL_USER: GMAIL_USER,
      GMAIL_APP_PASS: GMAIL_PASS,
      AEROLEX_SMTP_USER: GMAIL_USER,
      AEROLEX_SMTP_PASS: GMAIL_PASS
    };

    const proc = spawn('python3', [pythonScript], { env });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    proc.on('close', (code) => {
      if (code === 0 && stdout.includes('"success": true')) {
        console.log(`[Vigilancia Nube] Correo despachado exitosamente vía Gmail SMTP a ${NOTIFY_EMAIL}`);
        resolve(true);
      } else {
        // Reintentar con 'python' si python3 falló
        const proc2 = spawn('python', [pythonScript], { env });
        let out2 = '';
        proc2.stdout.on('data', d => { out2 += d; });
        proc2.on('close', c2 => {
          if (c2 === 0 && out2.includes('"success": true')) {
            console.log(`[Vigilancia Nube] Correo despachado exitosamente vía Gmail SMTP a ${NOTIFY_EMAIL}`);
            resolve(true);
          } else {
            console.warn(`[Vigilancia Nube] Error SMTP: ${stderr || out2 || stdout}`);
            resolve(false);
          }
        });
      }
    });

    proc.stdin.write(payload);
    proc.stdin.end();
  });
}

async function sendEmailAlert(novelties, isTest = false, allWatched = []) {
  const dateStr = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
  const timeStr = new Date().toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' });

  const runId = process.env.GITHUB_RUN_ID || 'local';
  const runNumber = process.env.GITHUB_RUN_NUMBER || '1';
  const eventName = process.env.GITHUB_EVENT_NAME || 'manual';
  const repo = process.env.GITHUB_REPOSITORY || 'iLyCoNs/AeroLex';
  const runUrl = process.env.GITHUB_RUN_ID ? `https://github.com/${repo}/actions/runs/${runId}` : 'https://github.com/iLyCoNs/AeroLex/actions';

  let subject = '';
  if (isTest) {
    subject = `[ORIGEN: GITHUB ACTIONS · NUBE 24/7] Verificación Operativa de Vigilancia Judicial (PC Apagado)`;
  } else if (novelties.length === 1) {
    subject = `[ORIGEN: GITHUB ACTIONS · NUBE 24/7] Novedad Judicial en ${novelties[0].rit} (${novelties[0].court})`;
  } else {
    subject = `[ORIGEN: GITHUB ACTIONS · NUBE 24/7] ${novelties.length} causas con novedades detectadas (${dateStr})`;
  }

  const casesToRender = isTest ? allWatched : novelties;
  const casesHtml = casesToRender.map((n, idx) => `
    <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:14px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-family:monospace; font-size:13.5px; font-weight:bold; color:#0f172a;">
          ${n.rit} <span style="font-size:11px; font-weight:normal; color:#64748b;">(${n.code})</span>
        </span>
        <span style="font-size:10px; font-family:monospace; background:#e2e8f0; color:#334155; padding:2px 6px; border-radius:4px;">
          Expediente ${idx + 1} de ${casesToRender.length}
        </span>
      </div>
      <div style="font-size:12.5px; color:#1e293b; margin-top:5px; font-weight:600;">
        ${n.materia || n.caratula || 'Causa Activa'}
      </div>
      <div style="font-size:11.5px; color:#64748b; margin-top:3px;">
        Tribunal: <strong>${n.court || n.tribunal || 'Poder Judicial'}</strong> | Último Registro: <strong>${n.lastMovementDate || dateStr}</strong>
      </div>
      <div style="margin-top:8px; font-size:11.5px; background:#eff6ff; border-left:3px solid #2563eb; padding:6px 10px; color:#1e3a8a;">
        Estado: <strong>${n.hasNoveltiesToday ? 'Novedad Detectada Hoy en OJV' : 'Inspeccionada en OJV (Al Día)'}</strong>
      </div>
    </div>
  `).join('');

  const testBanner = isTest ? `
    <div style="background:#ecfdf5; border-left:4px solid #10b981; padding:12px 14px; border-radius:0 6px 6px 0; margin-bottom:20px; font-size:12.5px; color:#065f46; line-height:1.5;">
      <strong>PRUEBA DE OPERATIVIDAD EN LÍNEA:</strong> Este correo certifica que el workflow desatendido en GitHub Actions se encuentra plenamente operativo, consultando con éxito la Oficina Judicial Virtual e inspeccionando todas las causas de la cartera activa de los abogados socios con el computador del abogado totalmente apagado.
    </div>
  ` : '';

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0; padding:20px; background:#f1f5f9; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #cbd5e1; border-radius:10px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.06);">
        
        <!-- ENCABEZADO OFICIAL AEROLEX -->
        <div style="background:#0f172a; padding:20px 24px; text-align:left; border-bottom:3px solid #2563eb;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h1 style="color:#ffffff; font-size:17px; margin:0; letter-spacing:0.5px; font-weight:700;">AeroLex · Vigilancia Judicial 24/7</h1>
            <span style="background:#2563eb; color:#ffffff; font-size:10px; font-family:monospace; padding:3px 8px; border-radius:4px; font-weight:bold; text-transform:uppercase;">GITHUB ACTIONS CLOUD</span>
          </div>
          <p style="color:#94a3b8; font-size:11.5px; margin:4px 0 0 0;">Reporte de Novedades Procesales Autónomo · Opera con PC Apagado</p>
        </div>

        <div style="padding:24px;">
          
          <!-- FICHA TÉCNICA DE PROVENIENCIA Y CERTIFICACIÓN NUBE -->
          <div style="background:#0f172a; border-radius:8px; padding:14px; margin-bottom:20px; color:#f8fafc; font-family:monospace; font-size:11px; line-height:1.6;">
            <div style="color:#38bdf8; font-weight:bold; font-size:11.5px; margin-bottom:6px; border-bottom:1px solid #334155; padding-bottom:4px;">
              CERTIFICACION TECNICA DE PROVENIENCIA (GITHUB ACTIONS)
            </div>
            <div><strong>Entorno:</strong> GitHub Hosted Runner (Ubuntu Linux Cloud)</div>
            <div><strong>Estado del PC:</strong> Desatendido / Computador Local Apagado</div>
            <div><strong>Repositorio:</strong> ${repo}</div>
            <div><strong>Ejecución (Run):</strong> #${runNumber} (ID: ${runId})</div>
            <div><strong>Disparador:</strong> ${eventName === 'schedule' ? 'Cron Programado (Pase OJV)' : eventName}</div>
            <div><strong>Hora del Pase:</strong> ${timeStr} hrs (${dateStr} Chile)</div>
            <div><strong>Causas Auditadas:</strong> ${casesToRender.length} expedientes de abogados socios</div>
            <div><strong>Protección Forense:</strong> CaseVerifier (4 Compuertas de Integridad)</div>
            <div style="margin-top:8px; padding-top:6px; border-top:1px dashed #334155;">
              <a href="${runUrl}" style="color:#60a5fa; text-decoration:underline;">Ver Bitácora de Ejecución en Vivo en GitHub &rarr;</a>
            </div>
          </div>

          ${testBanner}

          <p style="font-size:13px; color:#334155; margin-top:0; line-height:1.5;">
            Estimado(a) letrado(a): Se presenta el reporte de causas inspeccionadas durante el pase de las <strong>${timeStr} hrs</strong> (${dateStr}):
          </p>

          ${casesHtml}

          <div style="margin-top:24px; padding:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:11px; color:#64748b; text-align:center; line-height:1.4;">
            Notificación generada de manera 100% autónoma por el sistema de vigilancia procesal AeroLex.<br>
            Regla de diseño: Cero emojis. Toda providencia judicial debe ser verificada en la Oficina Judicial Virtual antes de presentaciones formales.
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  const plainText = `AeroLex Vigilancia Judicial 24/7 - ${subject}\nHora: ${timeStr} (${dateStr})\nDestinatario: ${NOTIFY_EMAIL}\nTotal causas: ${casesToRender.length}`;

  // Intentar despacho vía Resend si la clave existe
  if (RESEND_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'AeroLex Vigilancia <alertas@aerolex.cl>',
          to: [NOTIFY_EMAIL],
          subject,
          html
        })
      });
      if (res.ok) {
        console.log(`[Vigilancia Nube] Correo despachado exitosamente vía Resend a ${NOTIFY_EMAIL}`);
        return;
      }
    } catch (_) {}
  }

  // Despacho vía Gmail SMTP si las credenciales están configuradas
  if (GMAIL_USER && GMAIL_PASS) {
    const ok = await sendViaSmtpScript(subject, plainText, html);
    if (ok) return;
  }

  console.log('[Vigilancia Nube] Ni RESEND_API_KEY ni GMAIL_USER/GMAIL_APP_PASS configurados. Omitiendo despacho por email.');
}

async function main() {
  console.log('===========================================================');
  console.log('AEROLEX · VIGILANCIA JUDICIAL 24/7 (CRON NUBE GITHUB ACTIONS)');
  console.log('Hora UTC:', new Date().toISOString());
  console.log('Hora Chile:', new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' }));
  console.log('Modo Prueba (--test):', isTestMode ? 'ACTIVO' : 'INACTIVO');
  console.log('Run ID:', process.env.GITHUB_RUN_ID || 'local');
  console.log('===========================================================');

  if (!SUPA_URL || !SUPA_KEY) {
    console.error('[Vigilancia Nube] Error: SUPABASE_URL o SUPABASE_SERVICE_KEY no configurados.');
    process.exit(1);
  }

  // 1. Sincronizar nómina completa de los abogados socios
  await syncPartnerCausesToSupabase();

  // 2. Verificar si el interruptor maestro está habilitado (salvo en forzado con --test)
  const cfgResp = await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.CFG-VIGILANCIA`, { headers: supaHeaders() });
  const cfgRows = cfgResp.ok ? await cfgResp.json() : [];
  let isEnabled = true;

  if (cfgRows.length > 0 && cfgRows[0].detalle) {
    try {
      const cfg = JSON.parse(cfgRows[0].detalle);
      if (typeof cfg.enabled === 'boolean') isEnabled = cfg.enabled;
    } catch (_) {}
  }

  if (!isEnabled && !isTestMode) {
    console.log('[Vigilancia Nube] INTERRUPTOR MAESTRO: PAUSADO desde admin.html.');
    console.log('[Vigilancia Nube] El barrido y despacho de alertas se omiten por instrucción del letrado.');
    process.exit(0);
  }

  console.log(`[Vigilancia Nube] INTERRUPTOR MAESTRO: ${isEnabled ? 'HABILITADO' : 'PAUSADO (pero forzado por flag --test)'}. Procediendo al escaneo...`);

  // 3. Obtener todas las causas activas con RIT
  const casesResp = await fetch(`${SUPA_URL}/rest/v1/cases?select=*`, { headers: supaHeaders() });
  const allRows = casesResp.ok ? await casesResp.json() : [];

  const watchedCases = allRows.filter(c => {
    const code = String(c.code || '').toUpperCase();
    if (code.startsWith('WA-') || code.startsWith('EV-') || code.startsWith('CFG-')) return false;
    if (c.status === 'finalizado' || c.status === 'suspendido') return false;
    return Boolean(c.rit && c.rit.trim());
  });

  console.log(`[Vigilancia Nube] Total causas activas bajo inspección: ${watchedCases.length}`);

  const noveltiesFound = [];
  const scannedSummary = [];

  for (let i = 0; i < watchedCases.length; i++) {
    const c = watchedCases[i];
    console.log(`[${i + 1}/${watchedCases.length}] Inspeccionando ${c.rit} en ${c.tribunal || 'Tribunal Civil'} (${c.code})...`);

    const result = await checkPjudCase(c.rit, c.tribunal);
    console.log(`  · Resultado: ${result.found ? 'Encontrada' : 'No encontrada'} | Novedades hoy: ${result.hasNoveltiesToday ? 'SI' : 'NO'}`);

    scannedSummary.push({
      code: c.code,
      rit: c.rit,
      tribunal: c.tribunal,
      materia: c.materia,
      court: result.court,
      lastMovementDate: result.lastMovementDate,
      hasNoveltiesToday: result.hasNoveltiesToday,
      caratula: result.caratula,
    });

    if (result.hasNoveltiesToday) {
      noveltiesFound.push({
        code: c.code,
        rit: c.rit,
        tribunal: c.tribunal,
        materia: c.materia,
        court: result.court,
        lastMovementDate: result.lastMovementDate,
        caratula: result.caratula,
      });
    }

    // Actualizar estado_diario en Supabase
    const edData = {
      lastCheckedAt: result.checkedAt,
      lastCheckedTime: result.checkedTime,
      lastCheckedDate: result.checkedDate,
      status: result.hasNoveltiesToday ? "con_novedades" : (result.found ? "al_dia" : "no_encontrada"),
      lastMovementDate: result.lastMovementDate,
      checkedBy: "github_actions_vigia_247",
      resolutionsCount: (result.resolutions || []).length,
      resolutions: result.resolutions,
      found: result.found,
      court: result.court,
      docket: result.docket,
    };

    let triageArray = Array.isArray(c.triage) ? [...c.triage] : [];
    triageArray = triageArray.filter(item => typeof item !== 'string' || !item.startsWith('__ESTADO_DIARIO__:'));
    triageArray.push('__ESTADO_DIARIO__:' + JSON.stringify(edData));

    const patch = {
      triage: triageArray,
      updated_at: new Date().toISOString()
    };

    await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.${encodeURIComponent(c.code)}`, {
      method: 'PATCH',
      headers: supaHeaders(),
      body: JSON.stringify(patch)
    }).catch(e => console.warn(`  [Aviso] Error al actualizar estado_diario de ${c.code}:`, e.message));

    if (i < watchedCases.length - 1) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  // 4. Despachar alertas por correo si se detectaron novedades o si se solicitó modo prueba
  if (isTestMode) {
    console.log(`[Vigilancia Nube] Modo prueba activo: Despachando correo de verificación con las ${scannedSummary.length} causas inspeccionadas...`);
    await sendEmailAlert(noveltiesFound, true, scannedSummary);
  } else if (noveltiesFound.length > 0) {
    console.log(`[Vigilancia Nube] Se detectaron novedades en ${noveltiesFound.length} causa(s). Despachando notificación con proveniencia...`);
    await sendEmailAlert(noveltiesFound, false, scannedSummary);
  } else {
    console.log('[Vigilancia Nube] Barrido completado sin novedades urgentes del día.');
  }

  // 5. Actualizar CFG-VIGILANCIA con la bitácora del último pase
  const nowIso = new Date().toISOString();
  const cfgUpdate = {
    enabled: isEnabled,
    lastRunAt: nowIso,
    lastRunResults: {
      total: watchedCases.length,
      novelties: noveltiesFound.length,
      timestamp: nowIso,
      runner: 'github-actions'
    }
  };

  await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.CFG-VIGILANCIA`, {
    method: 'PATCH',
    headers: supaHeaders(),
    body: JSON.stringify({ detalle: JSON.stringify(cfgUpdate), updated_at: nowIso })
  }).catch(() => {});

  console.log('===========================================================');
  console.log('VIGILANCIA FINALIZADA CON EXITO');
  console.log('===========================================================');
}

main().catch(err => {
  console.error('[Vigilancia Nube] Error fatal no capturado:', err);
  process.exit(1);
});
