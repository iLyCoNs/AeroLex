/**
 * AeroLex · Disparador puntual de la vigilancia judicial en la nube.
 *
 * GitHub Actions entrega los eventos `schedule` con retrasos de horas
 * (actions/runner#4468). Este Worker dispara `workflow_dispatch` a la hora
 * exacta de cada pase configurado.
 *
 * El horario es configurable desde AeroLex SaaS (Configuración de Correo y
 * Alertas → Horario de pases). Se guarda en Supabase (CFG-PASES) y se lee
 * aqui via el endpoint publico `action=pases_get` (solo horas, sin datos) con
 * respaldo en los 5 pases por defecto. Las horas se expresan en horario de
 * Chile continental y se convierten a UTC en cada armado (soporta DST).
 *
 * El temporizador es un Durable Object con alarmas autorreprogramadas
 * (Cloudflare recomienda DO + alarms porque los Cron Triggers pueden no
 * disparar en cuentas nuevas o detenerse en silencio). Cada peticion HTTP
 * vuelve a asegurar la alarma: el ciclo se repara solo.
 *
 * Secreto requerido: GITHUB_TOKEN (fine-grained, Actions: Read and write
 * sobre iLyCoNs/AeroLex). Secreto opcional: CRON_TEST_KEY (forzar por HTTP).
 *
 * Atajos de prueba por HTTP (con `x-cron-test`):
 *   /?dispatch=1             dispara el workflow ahora
 *   /?dispatch=1&digest=1    dispara el workflow en modo parte diario
 */

import { DurableObject } from "cloudflare:workers";

const OWNER = "iLyCoNs";
const REPO = "AeroLex";
const WORKFLOW = "vigilancia-judicial-aerolex.yml";
const REF = "main";
const DAY_MS = 86_400_000;
const PORTAL_URL = "https://aerolex.cl";
const PASSES_TTL_MS = 5 * 60 * 1000;

// Pases por defecto (hora de Chile continental), compatibles con el horario
// histórico de 5 pases. Se usan si CFG-PASES no responde.
export const DEFAULT_PASSES = [
  { time: "07:45", days: [1, 2, 3, 4, 5] },
  { time: "08:30", days: [1, 2, 3, 4, 5] },
  { time: "09:15", days: [1, 2, 3, 4, 5] },
  { time: "13:30", days: [1, 2, 3, 4, 5] },
  { time: "18:30", days: [5] },
];

let passesCache = { at: 0, passes: DEFAULT_PASSES };

// ── Conversión horario de Chile → UTC (con DST) ─────────────────────────────
function santiagoOffsetMinutes(date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function chileInstant(y, mo, d, hh, mm) {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  return guess - santiagoOffsetMinutes(new Date(guess)) * 60000;
}

function chileDateParts(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day };
}

function sanitizePasses(raw) {
  if (!Array.isArray(raw)) return null;
  const passes = raw
    .map((p) => ({
      time: String(p && p.time ? p.time : "").trim(),
      days: Array.isArray(p && p.days) ? [...new Set(p.days.map(Number).filter((d) => d >= 1 && d <= 5))].sort() : [1, 2, 3, 4, 5],
    }))
    .filter((p) => /^([01]\d|2[0-3]):[0-5]\d$/.test(p.time) && p.days.length > 0)
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 6);
  return passes.length ? passes : null;
}

export async function loadPasses(env, fetchImpl = fetch) {
  if (Date.now() - passesCache.at < PASSES_TTL_MS) return passesCache.passes;
  try {
    const portal = (env && env.PORTAL_URL) || PORTAL_URL;
    const res = await fetchImpl(`${portal}/api/admin?action=pases_get`, { headers: { "user-agent": "aerolex-github-cron" } });
    if (res.ok) {
      const data = await res.json();
      const passes = sanitizePasses(data.passes);
      if (passes) {
        passesCache = { at: Date.now(), passes };
        return passes;
      }
    }
  } catch (_) {}
  passesCache = { at: Date.now(), passes: DEFAULT_PASSES };
  return DEFAULT_PASSES;
}

// Instantes UTC del día Chile (y,m,d) para cada pase configurado.
export function passInstantsForChileDate(passes, y, mo, d) {
  const weekday = new Date(Date.UTC(y, mo - 1, d, 12)).getUTCDay();
  const out = [];
  for (const pass of passes) {
    if (!pass.days.includes(weekday)) continue;
    const [hh, mm] = pass.time.split(":").map(Number);
    out.push({ ms: chileInstant(y, mo, d, hh, mm), label: pass.time, time: pass.time });
  }
  return out;
}

export function passFor(date, passes) {
  const { y, m, d } = chileDateParts(date);
  for (const offset of [-1, 0, 1]) {
    const base = new Date(Date.UTC(y, m - 1, d, 12) + offset * DAY_MS);
    const parts = chileDateParts(base);
    for (const candidate of passInstantsForChileDate(passes, parts.y, parts.m, parts.d)) {
      if (Math.abs(date.getTime() - candidate.ms) <= 120_000) return candidate;
    }
  }
  return undefined;
}

export function nextPassAt(fromMs, passes) {
  const start = chileDateParts(new Date(fromMs));
  for (let i = 0; i < 15; i++) {
    const base = new Date(Date.UTC(start.y, start.m - 1, start.d, 12) + i * DAY_MS);
    const parts = chileDateParts(base);
    for (const candidate of passInstantsForChileDate(passes, parts.y, parts.m, parts.d)) {
      if (candidate.ms > fromMs) return candidate.ms;
    }
  }
  return fromMs + DAY_MS;
}

async function dispatch(env, origin, inputs) {
  if (!env.GITHUB_TOKEN) {
    console.error(`[cron] falta el secreto GITHUB_TOKEN; no se puede disparar (${origin})`);
    return new Response("missing GITHUB_TOKEN", { status: 500 });
  }
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "aerolex-github-cron",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: REF, ...(inputs ? { inputs } : {}) }),
    },
  );
  console.log(`[cron] disparo (${origin}) -> HTTP ${res.status}`);
  if (!res.ok) console.error(`[cron] GitHub respondio ${res.status}: ${await res.text()}`);
  return res;
}

/**
 * Temporizador persistente: una alarma por pase, reprogramada al terminar.
 * ALARM_DEBUG_SECONDS (variable, solo pruebas) acorta el ciclo para verificar
 * que las alarmas disparan; al quitarla el ciclo vuelve solo al horario real.
 */
export class PassScheduler extends DurableObject {
  debugSeconds() {
    const raw = Number(this.env?.ALARM_DEBUG_SECONDS);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }

  async ensure() {
    if (this.debugSeconds()) {
      await this.ctx.storage.setAlarm(Date.now() + this.debugSeconds() * 1000);
      return;
    }
    const current = await this.ctx.storage.getAlarm();
    if (current === null) await this.armNext();
  }

  async armNext() {
    if (this.debugSeconds()) {
      const at = Date.now() + this.debugSeconds() * 1000;
      await this.ctx.storage.setAlarm(at);
      console.log(`[alarma] modo debug: proxima en ${this.debugSeconds()}s (${new Date(at).toISOString()})`);
      return;
    }
    const passes = await loadPasses(this.env);
    const next = nextPassAt(Date.now(), passes);
    await this.ctx.storage.setAlarm(next);
    console.log(`[alarma] proximo pase: ${new Date(next).toISOString()} (${passes.length} pases configurados)`);
  }

  async alarm() {
    const at = new Date();
    const passes = await loadPasses(this.env);
    const pass = passFor(at, passes);
    const forced = Boolean(this.env.ALARM_FORCE_DISPATCH);
    if (pass || forced) {
      const origin = pass ? `alarma ${pass.label} Chile` : "alarma forzada";
      console.log(`[alarma] ${origin} a las ${at.toISOString()} - disparando workflow`);
      await dispatch(this.env, origin);
    } else {
      console.log(`[alarma] tick sin pase a las ${at.toISOString()}`);
    }
    await this.armNext();
  }
}

export default {
  async scheduled(controller, env, ctx) {
    const at = new Date(controller.scheduledTime);
    const passes = await loadPasses(env);
    const pass = passFor(at, passes);
    const forced = Boolean(env.DISPATCH_ONCE);
    console.log(`[tick] ${at.toISOString()} pass=${pass ? pass.label : "no"} forced=${forced}`);
    if (!pass && !forced) return; // minuto de relleno del cron
    const origin = pass ? `cron ${pass.label} Chile` : "forzado por DISPATCH_ONCE";
    console.log(`[cron] ${origin} a las ${at.toISOString()} - disparando workflow`);
    ctx.waitUntil(dispatch(env, origin));
  },

  async fetch(req, env, ctx) {
    // Toda petición repara la alarma si hiciera falta (autocuración).
    if (env.PASS_SCHEDULER) {
      const id = env.PASS_SCHEDULER.idFromName("vigilancia");
      ctx.waitUntil(env.PASS_SCHEDULER.get(id).ensure().catch((error) => console.error("[alarma] bootstrap:", error)));
    }
    const url = new URL(req.url);
    const now = new Date();
    const passes = await loadPasses(env);
    const pass = passFor(now, passes);
    const authorized =
      Boolean(env.CRON_TEST_KEY) &&
      url.searchParams.get("dispatch") === "1" &&
      req.headers.get("x-cron-test") === env.CRON_TEST_KEY;
    console.log(`[http] ${url.pathname}${url.search} pass=${pass ? pass.label : "no"} key=${authorized}`);
    if (authorized && url.searchParams.get("digest") === "1") {
      const res = await dispatch(env, "prueba manual (parte diario)", { digest_now: "true" });
      return new Response(res.ok ? "disparo del parte diario enviado\n" : `GitHub respondio ${res.status}\n`, {
        status: res.ok ? 200 : 502,
      });
    }
    if (pass || authorized) {
      const res = await dispatch(env, pass ? `http ${pass.label} Chile` : "prueba manual");
      return new Response(res.ok ? "disparo enviado\n" : `GitHub respondio ${res.status}\n`, {
        status: res.ok ? 200 : 502,
      });
    }
    return new Response("aerolex-github-cron: ok\n", { status: 200 });
  },
};
