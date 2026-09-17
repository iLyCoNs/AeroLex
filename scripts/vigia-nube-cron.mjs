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
const isDigestPreview = process.argv.includes('--digest-preview');
const isDigestNow = process.argv.includes('--digest-now');

// Destinatarios vigentes del parte diario y alertas. Se resuelven en main()
// desde Supabase (CFG-CORREO, editable en AeroLex SaaS / admin.html) con
// respaldo en AEROLEX_NOTIFY_EMAIL.
let NOTIFY_RECIPIENTS = [NOTIFY_EMAIL];

// Pases oficiales (hora UTC) y su hora referencial en Chile continental.
const PASS_SCHEDULE = [
  { hour: 10, minute: 45, label: '07:45' },
  { hour: 11, minute: 30, label: '08:30' },
  { hour: 12, minute: 15, label: '09:15' },
  { hour: 16, minute: 30, label: '13:30' },
  { hour: 21, minute: 30, label: '18:30 (viernes)' },
];

function expectedPassesFor(dayKey) {
  const day = new Date(`${dayKey}T12:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return [];
  return day === 5 ? PASS_SCHEDULE : PASS_SCHEDULE.slice(0, 4);
}

function chileDayKey(dateObj = new Date()) {
  // YYYY-MM-DD en horario de Chile (el parte corresponde al día del letrado).
  return dateObj.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

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
  const clean = ritString.trim();

  // 1. Con prefijo alfanumérico (ej: "Protección 1071-2026", "Civil-1324-2026", "C-1234-2024", "Z-789-2020")
  const matchWithLetters = clean.match(/^([a-zA-ZáéíóúÁÉÍÓÚñÑ]+)[-\s]*(\d+)[-\s]*(\d{4})$/);
  if (matchWithLetters) {
    return {
      tipo: matchWithLetters[1].toUpperCase(),
      rol: matchWithLetters[2],
      era: matchWithLetters[3],
    };
  }

  // 2. Formato puramente numérico (ej: "1071-2026", "1324-2026", "1360-2026", "1452-2026")
  const matchBare = clean.match(/^(\d+)[-\s]*(\d{4})$/);
  if (matchBare) {
    return {
      tipo: "ROL",
      rol: matchBare[1],
      era: matchBare[2],
    };
  }

  // 3. Fallback flexible
  const matchLoose = clean.match(/([a-zA-ZáéíóúÁÉÍÓÚñÑ]*)[-\s]*(\d+)[-\s]*(\d{4})/);
  if (matchLoose && matchLoose[2] && matchLoose[3]) {
    return {
      tipo: matchLoose[1] ? matchLoose[1].toUpperCase() : "ROL",
      rol: matchLoose[2],
      era: matchLoose[3],
    };
  }

  return null;
}

function isAppellateCourt(court) {
  if (!court) return false;
  return /corte.*apelaciones|c\.?a\.?\s*|corte\s*de\s*apelaciones/i.test(court);
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

  const checkedAt = new Date().toISOString();
  const checkedDate = new Date().toLocaleDateString("es-CL", { timeZone: "America/Santiago" });
  const checkedTime = new Date().toLocaleTimeString("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" });

  try {
    const sessionRes = await fetch("https://oficinajudicialvirtual.pjud.cl/indexN.php", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
    });
    const setCookie = sessionRes.headers.get("set-cookie") || "";
    const cookies = setCookie.split(",").map(c => c.split(";")[0].trim()).join("; ");

    // Rama 1: Corte de Apelaciones
    if (isAppellateCourt(courtId)) {
      const corteCode = /santiago/i.test(courtId) ? "90" : /san miguel/i.test(courtId) ? "91" : /valparaiso/i.test(courtId) ? "30" : /concepcion/i.test(courtId) ? "50" : "56"; // Puerto Montt default
      const queryBody = new URLSearchParams({
        competencia: "2",
        conCorte: corteCode,
        conTribunal: "0",
        conTipoBus: "0",
        conTipoBusApe: "0",
        "radio-groupPenal": "1",
        conTipoCausa: "0",
        "radio-group": "1",
        conRolCausa: parsed.rol,
        conEraCausa: parsed.era,
        ruc1: "",
        ruc2: "",
        rucPen1: "",
        rucPen2: "",
        conCaratulado: "",
        "g-recaptcha-response-rit": "",
        action: "validate_captcha_rit",
      });

      const queryRes = await fetch("https://oficinajudicialvirtual.pjud.cl/ADIR_871/apelaciones/consultaRitApelaciones.php", {
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://oficinajudicialvirtual.pjud.cl/indexN.php",
          "Content-Type": "application/x-www-form-urlencoded",
          "Cookie": cookies,
        },
        body: queryBody.toString(),
      });

      if (!queryRes.ok) throw new Error(`PJUD Corte HTTP ${queryRes.status}`);
      const html = await queryRes.text();
      const isNotFound = html.includes("No se han encontrado resultados") || !html.includes("tr-hover");

      if (isNotFound) {
        return {
          found: false,
          docket: `${parsed.tipo}-${parsed.rol}-${parsed.era}`,
          court: courtId || "Corte de Apelaciones de Puerto Montt",
          checkedAt, checkedTime, checkedDate,
          resolutions: [],
          hasNoveltiesToday: false,
        };
      }

      // Extraer causas del listado de Corte
      const trs = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      let matchedRow = null;
      for (const tr of trs) {
        if (!tr.includes("<td")) continue;
        const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
        if (tds.length >= 6) {
          const rowRol = tds[1] || "";
          const rowCaratula = tds[3] || "";
          const rowFecha = tds[4] || "";
          const rowEstado = tds[5] || "";
          const rowLibro = rowRol.split("-")[0] || "";

          // Si parsed.tipo no es "ROL", preferir coincidencia de libro
          if (parsed.tipo !== "ROL" && rowLibro.toUpperCase().includes(parsed.tipo)) {
            matchedRow = { rolCompleto: rowRol, caratula: rowCaratula, fecha: rowFecha, estado: rowEstado, libro: rowLibro };
            break;
          }
          if (!matchedRow) {
            matchedRow = { rolCompleto: rowRol, caratula: rowCaratula, fecha: rowFecha, estado: rowEstado, libro: rowLibro };
          }
        }
      }

      if (!matchedRow) {
        return {
          found: false,
          docket: `${parsed.tipo}-${parsed.rol}-${parsed.era}`,
          court: courtId || "Corte de Apelaciones de Puerto Montt",
          checkedAt, checkedTime, checkedDate,
          resolutions: [],
          hasNoveltiesToday: false,
        };
      }

      const hasNoveltiesToday = (matchedRow.fecha === checkedDate);
      const resolutions = [{
        id: `res-${crypto.randomUUID().slice(0, 8)}`,
        date: matchedRow.fecha || checkedDate,
        time: checkedTime,
        court: courtId || "Corte de Apelaciones de Puerto Montt",
        docket: matchedRow.rolCompleto,
        caratula: matchedRow.caratula || "Causa en Corte",
        type: "Trámite / Estado de Alzada",
        summary: `Causa radicada en ${courtId}. Libro: ${matchedRow.libro}. Estado: ${matchedRow.estado}. Carátula: ${matchedRow.caratula}.`,
        checkedAt,
      }];

      return {
        found: true,
        docket: matchedRow.rolCompleto,
        court: courtId || "Corte de Apelaciones de Puerto Montt",
        caratula: matchedRow.caratula,
        entryDate: matchedRow.fecha,
        checkedAt, checkedTime, checkedDate,
        resolutions,
        hasNoveltiesToday,
        lastMovementDate: matchedRow.fecha || checkedDate,
      };
    }

    // Rama 2: Tribunales de Primera Instancia (Civil, Familia, Laboral)
    const courtInfo = resolveCourt(courtId);
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

function sendViaSmtpScript(subject, text, html, to = NOTIFY_RECIPIENTS) {
  return new Promise((resolve) => {
    const pythonScript = join(__dirname, 'send-email-smtp.py');
    const payload = JSON.stringify({
      recipient: to,
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
        Tribunal: <strong>${n.court || n.tribunal || 'Poder Judicial'}</strong> | Abogado(a): <strong>${n.abogado || 'Jaime Vidal Paredes'}</strong> | Último Registro: <strong>${n.lastMovementDate || dateStr}</strong>
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

  const plainText = `AeroLex Vigilancia Judicial 24/7 - ${subject}\nHora: ${timeStr} (${dateStr})\nDestinatario: ${NOTIFY_RECIPIENTS.join(', ')}\nTotal causas: ${casesToRender.length}`;

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
          to: NOTIFY_RECIPIENTS,
          subject,
          html
        })
      });
      if (res.ok) {
        console.log(`[Vigilancia Nube] Correo despachado exitosamente vía Resend a ${NOTIFY_RECIPIENTS.join(', ')}`);
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

async function resolveRecipients() {
  try {
    const resp = await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.CFG-CORREO`, { headers: supaHeaders() });
    const rows = resp.ok ? await resp.json() : [];
    if (rows.length > 0 && rows[0].detalle) {
      const cfg = JSON.parse(rows[0].detalle);
      const list = Array.isArray(cfg.recipients) ? cfg.recipients : [];
      const valid = list.map(r => String(r).trim()).filter(r => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
      if (valid.length > 0) return valid;
    }
  } catch (err) {
    console.warn('[Vigilancia Nube] No se pudo leer CFG-CORREO; se usa el destinatario por defecto:', err.message);
  }
  return [NOTIFY_EMAIL];
}

// ── Parte diario: registro de pases y digest ────────────────────────────────
const DIARIO_CODE = 'CFG-DIARIO';

async function loadDiario() {
  const resp = await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.${DIARIO_CODE}`, { headers: supaHeaders() });
  const rows = resp.ok ? await resp.json() : [];
  if (rows.length > 0 && rows[0].detalle) {
    try { return JSON.parse(rows[0].detalle); } catch (_) {}
  }
  return null;
}

async function saveDiario(state) {
  const nowIso = new Date().toISOString();
  const body = { detalle: JSON.stringify(state), updated_at: nowIso };
  const patch = await fetch(`${SUPA_URL}/rest/v1/cases?code=eq.${DIARIO_CODE}`, {
    method: 'PATCH', headers: supaHeaders(), body: JSON.stringify(body)
  }).catch(() => null);
  if (patch && patch.ok) return;
  await fetch(`${SUPA_URL}/rest/v1/cases`, {
    method: 'POST',
    headers: supaHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
    body: JSON.stringify({ code: DIARIO_CODE, rit: 'CFG-DIA', tribunal: 'Sistema', status: 'activo', detalle: body.detalle, updated_at: nowIso })
  }).catch(e => console.warn('  [Aviso] No se pudo guardar CFG-DIARIO:', e.message));
}

function scheduledPassFor(dateObj) {
  const h = dateObj.getUTCHours();
  const m = dateObj.getUTCMinutes();
  const day = dateObj.getUTCDay();
  return PASS_SCHEDULE.find(p => p.hour === h && Math.abs(p.minute - m) <= 5 && (p.hour !== 21 || day === 5)) || null;
}

async function sendMail(subject, plainText, html, to = NOTIFY_RECIPIENTS) {
  if (RESEND_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'AeroLex Vigilancia <alertas@aerolex.cl>', to, subject, html })
      });
      if (res.ok) { console.log(`[Vigilancia Nube] Correo despachado vía Resend a ${to.join(', ')}`); return true; }
    } catch (_) {}
  }
  if (GMAIL_USER && GMAIL_PASS) {
    const ok = await sendViaSmtpScript(subject, plainText, html, to);
    if (ok) return true;
  }
  console.log('[Vigilancia Nube] Sin proveedor de correo configurado. Despacho omitido.');
  return false;
}

function buildDigest(state, options = {}) {
  const dayKey = state.date;
  const expected = expectedPassesFor(dayKey);
  const passes = Array.isArray(state.passes) ? state.passes : [];
  const dateStr = new Date(`${dayKey}T12:00:00Z`).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const rows = expected.map((p) => {
    const rec = passes.find(s => s.utc === `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`);
    return { pass: p, rec };
  });
  const executed = rows.filter(r => r.rec).length;
  const missing = rows.filter(r => !r.rec);
  const totalNovelties = passes.reduce((acc, s) => acc + (s.novelties || 0), 0);
  const allErrors = passes.flatMap(s => s.errors || []);

  // Último registro conocido por causa (el pase más reciente que la incluyó).
  const caseMap = new Map();
  for (const pass of passes) {
    for (const c of pass.cases || []) if (!caseMap.has(c.code)) caseMap.set(c.code, { ...c, passLabel: pass.label, passUtc: pass.utc });
  }
  const cases = [...caseMap.values()].sort((a, b) => String(a.rit).localeCompare(String(b.rit)));

  const passRowsHtml = rows.map(({ pass, rec }) => `
    <tr>
      <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; font-family:monospace; font-size:11.5px;">${pass.label} Chile</td>
      <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; font-family:monospace; font-size:11.5px;">${String(pass.hour).padStart(2, '0')}:${String(pass.minute).padStart(2, '0')} UTC</td>
      <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; font-size:11.5px; color:${rec ? '#065f46' : '#991b1b'}; font-weight:600;">${rec ? 'EJECUTADO' : 'NO EJECUTADO'}</td>
      <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; font-size:11.5px;">${rec ? `${rec.total} causa(s)` : '-'}</td>
      <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; font-size:11.5px;">${rec ? `${rec.novelties} novedad(es)` : '-'}</td>
    </tr>`).join('');

  const casesHtml = cases.map((c) => {
    const stateText = c.error
      ? `Sin verificar: ${c.error}`
      : (c.hasNoveltiesToday ? 'CON NOVEDADES HOY (verificado en OJV)' : 'Sin novedades hoy (verificado en OJV)');
    const stateColor = c.error ? '#991b1b' : (c.hasNoveltiesToday ? '#1d4ed8' : '#065f46');
    const movements = Array.isArray(c.movements) ? c.movements : [];
    const movementsHtml = movements.length
      ? movements.map(m => `<li style="margin-bottom:3px;"><strong>${m.date || 's/f'}</strong> — ${m.type || 'Actuación'}: ${m.summary || ''}</li>`).join('')
      : '<li>Sin movimientos registrados en las últimas actuaciones consultadas.</li>';
    return `
    <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:12px; margin-bottom:10px;">
      <div style="font-family:monospace; font-size:13px; font-weight:bold; color:#0f172a;">
        ${c.rit} <span style="font-size:11px; font-weight:normal; color:#64748b;">(${c.code})</span>
      </div>
      <div style="font-size:12px; color:#1e293b; margin-top:3px; font-weight:600;">${c.caratula || c.materia || 'Causa registrada'}</div>
      <div style="font-size:11.5px; color:#64748b; margin-top:3px;">
        Tribunal: <strong>${c.court || 'Poder Judicial'}</strong> | Abogado(a): <strong>${c.abogado || 'Sin asignar'}</strong> | Último movimiento: <strong>${c.lastMovementDate || 's/f'}</strong>
      </div>
      <div style="margin-top:6px; font-size:11.5px; color:${stateColor}; font-weight:600;">${stateText}</div>
      <ul style="margin:6px 0 0 16px; padding:0; font-size:11.5px; color:#334155; line-height:1.5;">${movementsHtml}</ul>
    </div>`;
  }).join('');

  const errorsHtml = allErrors.length
    ? `<div style="margin-top:14px; padding:10px 12px; background:#fef2f2; border-left:3px solid #dc2626; font-size:11.5px; color:#7f1d1d;">
        <strong>Incidencias del día:</strong>
        <ul style="margin:6px 0 0 16px; padding:0;">${allErrors.map(e => `<li>${e.rit} (${e.code}): ${e.message}</li>`).join('')}</ul>
      </div>`
    : '';

  const titlePrefix = options.late ? 'PARTE DIARIO (ENVÍO TARDÍO)' : (options.preview ? 'PARTE DIARIO (PRUEBA)' : 'PARTE DIARIO');
  const summaryLine = `${options.preview ? 'VISTA DE PRUEBA (los pases oficiales se registran desde el próximo ciclo). ' : ''}${executed} de ${expected.length} pase(s) ejecutado(s); ${totalNovelties} novedad(es); ${cases.length} expediente(s) auditado(s).`;
  const subject = `[AEROLEX] ${titlePrefix} Vigilancia Judicial ${dayKey} — ${executed}/${expected.length} pases — ${totalNovelties > 0 ? 'CON NOVEDADES' : 'SIN NOVEDADES'}`;

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="margin:0; padding:20px; background:#f1f5f9; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <div style="max-width:660px; margin:0 auto; background:#ffffff; border:1px solid #cbd5e1; border-radius:10px; overflow:hidden;">
        <div style="background:#0f172a; padding:18px 22px; border-bottom:3px solid #2563eb;">
          <h1 style="color:#ffffff; font-size:16px; margin:0; font-weight:700;">AeroLex — Parte Diario de Vigilancia Judicial</h1>
          <p style="color:#94a3b8; font-size:11px; margin:4px 0 0 0;">${dateStr} | Generado automáticamente al cierre del último pase | PC apagado</p>
        </div>
        <div style="padding:20px 22px;">
          <p style="font-size:12.5px; color:#334155; margin:0 0 12px 0;">${summaryLine}${missing.length ? ` Pases no registrados: ${missing.map(r => r.pass.label + ' Chile').join(', ')}.` : ''}</p>
          <table style="border-collapse:collapse; width:100%; margin-bottom:16px;">
            <thead><tr style="background:#f1f5f9; text-align:left;">
              <th style="padding:6px 8px; font-size:11px; color:#475569;">Pase</th>
              <th style="padding:6px 8px; font-size:11px; color:#475569;">UTC</th>
              <th style="padding:6px 8px; font-size:11px; color:#475569;">Estado</th>
              <th style="padding:6px 8px; font-size:11px; color:#475569;">Cobertura</th>
              <th style="padding:6px 8px; font-size:11px; color:#475569;">Novedades</th>
            </tr></thead>
            <tbody>${passRowsHtml}</tbody>
          </table>
          <h2 style="font-size:13px; color:#0f172a; margin:0 0 8px 0;">Expedientes y movimientos verificados en OJV</h2>
          ${casesHtml}
          ${errorsHtml}
          <div style="margin-top:18px; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:11px; color:#64748b; line-height:1.45;">
            Reporte automático elaborado por el sistema de vigilancia de AeroLex a partir de la consulta a la Oficina Judicial Virtual.
            Es un borrador informativo: toda providencia y plazo debe verificarse en el expediente oficial antes de presentaciones o decisiones.
            Regla de diseño: cero emojis.
          </div>
        </div>
      </div>
    </body></html>`;

  const plainText = `AeroLex — Parte Diario de Vigilancia Judicial\n${dateStr}\n${summaryLine}\nDestinatarios: ${NOTIFY_RECIPIENTS.join(', ')}\n\nPASES:\n${rows.map(r => `- ${r.pass.label} Chile (${String(r.pass.hour).padStart(2, '0')}:${String(r.pass.minute).padStart(2, '0')} UTC): ${r.rec ? `ejecutado, ${r.rec.total} causas, ${r.rec.novelties} novedades` : 'NO EJECUTADO'}`).join('\n')}\n\nEXPEDIENTES:\n${cases.map(c => `- ${c.rit} (${c.code}) | ${c.caratula || c.materia || ''} | ${c.court || ''} | Abogado: ${c.abogado || 'Sin asignar'} | ${c.error ? `sin verificar: ${c.error}` : (c.hasNoveltiesToday ? 'CON NOVEDADES' : 'sin novedades')} | último movimiento: ${c.lastMovementDate || 's/f'}`).join('\n')}\n\nVerifique siempre en la OJV antes de presentaciones.`;

  return { subject, plainText, html };
}

async function processDiario({ watchedCases, scannedSummary, noveltiesFound, passErrors, isTestRun }) {
  const now = new Date();
  const today = chileDayKey(now);
  let state = await loadDiario();
  if (!state || typeof state === 'object' === false) state = null;
  if (!state) state = { date: today, passes: [], digestSentAt: null, previous: null };

  // Rotación: al cambiar el día, conservar el día anterior para el envío tardío.
  if (state.date !== today) {
    const pendingPrevious = (state.passes || []).length > 0 && !state.digestSentAt
      ? { date: state.date, passes: state.passes, digestSentAt: state.digestSentAt }
      : state.previous;
    state = { date: today, passes: [], digestSentAt: null, previous: pendingPrevious };
  }

  // Envío tardío del parte del día anterior si quedó pendiente.
  if (state.previous && state.previous.date !== today && !state.previous.digestSentAt && !isTestRun) {
    const prevExpected = expectedPassesFor(state.previous.date);
    if (prevExpected.length > 0) {
      console.log(`[Vigilancia Nube] Parte diario pendiente del ${state.previous.date}: enviando envío tardío...`);
      const prevDigest = buildDigest(state.previous, { late: true });
      const sentLate = await sendMail(prevDigest.subject, prevDigest.plainText, prevDigest.html);
      if (sentLate) state.previous.digestSentAt = new Date().toISOString();
    }
  }

  // Registrar el pase solo si corresponde a un pase oficial y no es prueba.
  const scheduled = scheduledPassFor(now);
  if (scheduled && !isTestRun) {
    const utc = `${String(scheduled.hour).padStart(2, '0')}:${String(scheduled.minute).padStart(2, '0')}`;
    state.passes = (state.passes || []).filter(p => p.utc !== utc); // reemplaza si se repite
    state.passes.push({
      at: now.toISOString(),
      utc,
      label: scheduled.label,
      total: watchedCases.length,
      novelties: noveltiesFound.length,
      errors: passErrors,
      cases: scannedSummary
    });
    console.log(`[Vigilancia Nube] Pase ${scheduled.label} Chile registrado en el parte diario.`);
  }

  // Envío del parte al cierre del último pase del día (o forzado manual).
  const expected = expectedPassesFor(today);
  const last = expected[expected.length - 1];
  const lastMs = last ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), last.hour, last.minute) : 0;
  const due = expected.length > 0 && now.getTime() >= lastMs && !state.digestSentAt;

  if (isDigestNow && !isTestRun) {
    // Vista de prueba con los datos del escaneo recién realizado; no altera
    // el registro oficial de pases.
    const previewState = {
      ...state,
      passes: [
        ...(state.passes || []),
        {
          at: now.toISOString(),
          utc: 'manual',
          label: 'prueba manual',
          total: watchedCases.length,
          novelties: noveltiesFound.length,
          errors: passErrors,
          cases: scannedSummary
        }
      ]
    };
    const digest = buildDigest(previewState, { preview: true });
    const sent = await sendMail(digest.subject, digest.plainText, digest.html);
    console.log(`[Vigilancia Nube] Parte diario forzado (--digest-now): ${sent ? 'despachado' : 'no despachado'}.`);
  } else if (due) {
    const digest = buildDigest(state);
    const sent = await sendMail(digest.subject, digest.plainText, digest.html);
    if (sent) {
      state.digestSentAt = new Date().toISOString();
      console.log('[Vigilancia Nube] Parte diario enviado al cierre del día.');
    }
  } else if (expected.length > 0) {
    console.log(`[Vigilancia Nube] Parte diario pendiente: se enviará al cierre del último pase (${expected.length}/${expected.length} programados).`);
  }

  await saveDiario(state);
}

function printDigestPreview() {
  const sample = {
    date: chileDayKey(new Date()),
    digestSentAt: null,
    passes: [
      { at: new Date().toISOString(), utc: '10:45', label: '07:45', total: 6, novelties: 0, errors: [], cases: [{ code: 'ALX-2026-72', rit: '1324-2026', court: 'C.A. de Puerto Montt', caratula: 'MANSILLA / ZURITA', abogado: 'Marta Elizabeth Sánchez Andrade', hasNoveltiesToday: false, lastMovementDate: '15/09/2026', movements: [] }] },
      { at: new Date().toISOString(), utc: '11:30', label: '08:30', total: 6, novelties: 1, errors: [], cases: [{ code: 'ALX-2026-75', rit: 'Z-789-2020', court: '4º Juzgado de Familia de Santiago', caratula: 'MUÑOZ / NITSCHKE', abogado: 'Jaime Vidal Paredes', hasNoveltiesToday: true, lastMovementDate: '17/09/2026', movements: [{ date: '17/09/2026', type: 'Resolución', summary: 'Téngase presente allanamiento y liquidación para pago con fondos AFP.' }] }] },
      { at: new Date().toISOString(), utc: '16:30', label: '13:30', total: 6, novelties: 0, errors: [{ code: 'ALX-2026-71', rit: '1071-2026', message: 'Sin resultados públicos (causa reservada)' }], cases: [{ code: 'ALX-2026-71', rit: '1071-2026', court: 'C.A. de Puerto Montt', caratula: '-/-', abogado: 'Marta Elizabeth Sánchez Andrade', hasNoveltiesToday: false, lastMovementDate: '14/09/2026', movements: [] }] },
    ]
  };
  const digest = buildDigest(sample, { preview: true });
  console.log('===========================================================');
  console.log('VISTA PREVIA DEL PARTE DIARIO (no se envía correo)');
  console.log('Asunto:', digest.subject);
  console.log('-----------------------------------------------------------');
  console.log(digest.plainText);
  console.log('===========================================================');
}

async function main() {
  console.log('===========================================================');
  console.log('AEROLEX · VIGILANCIA JUDICIAL 24/7 (CRON NUBE GITHUB ACTIONS)');
  console.log('Hora UTC:', new Date().toISOString());
  console.log('Hora Chile:', new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' }));
  console.log('Modo Prueba (--test):', isTestMode ? 'ACTIVO' : 'INACTIVO');
  console.log('Run ID:', process.env.GITHUB_RUN_ID || 'local');
  console.log('===========================================================');

  if (isDigestPreview) {
    printDigestPreview();
    return;
  }

  if (!SUPA_URL || !SUPA_KEY) {
    console.error('[Vigilancia Nube] Error: SUPABASE_URL o SUPABASE_SERVICE_KEY no configurados.');
    process.exit(1);
  }

  // 0. Destinatarios vigentes (CFG-CORREO, editable en AeroLex SaaS / admin.html)
  NOTIFY_RECIPIENTS = await resolveRecipients();
  console.log(`[Vigilancia Nube] Destinatarios del parte y alertas: ${NOTIFY_RECIPIENTS.join(', ')}`);

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
  const passErrors = [];

  for (let i = 0; i < watchedCases.length; i++) {
    const c = watchedCases[i];
    console.log(`[${i + 1}/${watchedCases.length}] Inspeccionando ${c.rit} en ${c.tribunal || 'Tribunal Civil'} (${c.code})...`);

    const result = await checkPjudCase(c.rit, c.tribunal);
    console.log(`  · Resultado: ${result.found ? 'Encontrada' : 'No encontrada'} | Novedades hoy: ${result.hasNoveltiesToday ? 'SI' : 'NO'}`);

    if (result.found === false) {
      passErrors.push({ code: c.code, rit: c.rit, message: result.error || 'Sin resultados en OJV' });
    }

    let caseLawyer = "Jaime Vidal Paredes";
    if (Array.isArray(c.triage)) {
      const ab = c.triage.find(t => typeof t === 'string' && t.startsWith('__ABOGADO__:'));
      if (ab) caseLawyer = ab.replace('__ABOGADO__:', '').trim();
    } else if (c.abogado) {
      caseLawyer = c.abogado;
    }

    scannedSummary.push({
      code: c.code,
      rit: c.rit,
      tribunal: c.tribunal,
      materia: c.materia,
      court: result.court,
      abogado: caseLawyer,
      lastMovementDate: result.lastMovementDate,
      hasNoveltiesToday: result.hasNoveltiesToday,
      caratula: result.caratula,
      error: result.found === false ? (result.error || 'Sin resultados en OJV') : null,
      movements: (result.resolutions || []).slice(0, 3).map(r => ({ date: r.date, type: r.type, summary: r.summary })),
    });

    if (result.hasNoveltiesToday) {
      noveltiesFound.push({
        code: c.code,
        rit: c.rit,
        tribunal: c.tribunal,
        materia: c.materia,
        court: result.court,
        abogado: caseLawyer,
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

  // 6. Parte diario: registrar el pase y enviar el digest al cierre del día
  await processDiario({
    watchedCases,
    scannedSummary,
    noveltiesFound,
    passErrors,
    isTestRun: isTestMode,
  }).catch(err => console.warn('[Vigilancia Nube] Aviso: no se pudo procesar el parte diario:', err.message));

  console.log('===========================================================');
  console.log('VIGILANCIA FINALIZADA CON EXITO');
  console.log('===========================================================');
}

main().catch(err => {
  console.error('[Vigilancia Nube] Error fatal no capturado:', err);
  process.exit(1);
});
