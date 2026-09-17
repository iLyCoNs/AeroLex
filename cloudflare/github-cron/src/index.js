/**
 * AeroLex · Disparador puntual de la vigilancia judicial en la nube.
 *
 * GitHub Actions entrega los eventos `schedule` con retrasos de horas
 * (best-effort bajo carga; actions/runner#4468). Este Worker dispara
 * `workflow_dispatch` a la hora exacta de los 5 pases oficiales (UTC):
 *
 *   Lun-Vie 10:45 · 11:30 · 12:15 · 16:30  (07:45/08:30/09:15/13:30 Chile)
 *   Viernes 21:30                          (18:30 Chile, tablas de Corte)
 *
 * El temporizador es un Durable Object con alarmas que se reprograma solo
 * (Cloudflare recomienda DO + alarms porque los Cron Triggers pueden no
 * disparar en cuentas nuevas o detenerse en silencio). Cada peticion HTTP
 * vuelve a asegurar la alarma, de modo que el ciclo se repara solo.
 *
 * Secreto requerido: GITHUB_TOKEN (fine-grained, Actions: Read and write
 * sobre el repositorio iLyCoNs/AeroLex). Secreto opcional para pruebas:
 * CRON_TEST_KEY (permite forzar un disparo por HTTP en cualquier momento).
 *
 * Barrido puntual manual: activar la variable DISPATCH_ONCE ("1") y
 * desplegar; el proximo tick del scheduled o el siguiente HTTP la disparan.
 */

import { DurableObject } from "cloudflare:workers";

const OWNER = "iLyCoNs";const REPO = "AeroLex";
const WORKFLOW = "vigilancia-judicial-aerolex.yml";
const REF = "main";
const DAY_MS = 86_400_000;

// Días UTC: 0 = domingo … 6 = sábado. 1-5 = lunes a viernes.
export const PASSES = [
  { hour: 10, minute: 45, days: [1, 2, 3, 4, 5], label: "07:45 Chile" },
  { hour: 11, minute: 30, days: [1, 2, 3, 4, 5], label: "08:30 Chile" },
  { hour: 12, minute: 15, days: [1, 2, 3, 4, 5], label: "09:15 Chile" },
  { hour: 16, minute: 30, days: [1, 2, 3, 4, 5], label: "13:30 Chile" },
  { hour: 21, minute: 30, days: [5], label: "18:30 Chile (viernes)" },
];

export function passFor(date) {
  const day = date.getUTCDay();
  return PASSES.find(
    (pass) => pass.days.includes(day) && pass.hour === date.getUTCHours() && pass.minute === date.getUTCMinutes(),
  );
}

export function nextPassAt(fromMs) {
  for (let i = 0; i < 15; i++) {
    const day = new Date(fromMs + i * DAY_MS);
    for (const pass of PASSES) {
      const candidate = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), pass.hour, pass.minute);
      if (!pass.days.includes(new Date(candidate).getUTCDay())) continue;
      if (candidate > fromMs) return candidate;
    }
  }
  return fromMs + DAY_MS; // no debería ocurrir: siempre hay un pase en 14 días
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
 * que las alarmas disparan; se quita al terminar y el ciclo vuelve solo.
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
    const next = nextPassAt(Date.now());
    await this.ctx.storage.setAlarm(next);
    console.log(`[alarma] proximo pase: ${new Date(next).toISOString()}`);
  }

  async alarm() {
    const at = new Date();
    const pass = passFor(at);
    // ALARM_FORCE_DISPATCH (variable, solo pruebas) fuerza un disparo en el
    // siguiente tick; se quita al terminar.
    if (pass || this.env.ALARM_FORCE_DISPATCH) {
      const origin = pass ? `alarma ${pass.label}` : "alarma forzada";
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
    const pass = passFor(at);
    const forced = Boolean(env.DISPATCH_ONCE);
    console.log(`[tick] ${at.toISOString()} pass=${pass ? pass.label : "no"} forced=${forced}`);
    if (!pass && !forced) return; // minuto de relleno del cron
    const origin = pass ? `cron ${pass.label}` : "forzado por DISPATCH_ONCE";
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
    const pass = passFor(now);
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
      const res = await dispatch(env, pass ? `http ${pass.label}` : "prueba manual");
      return new Response(res.ok ? "disparo enviado\n" : `GitHub respondio ${res.status}\n`, {
        status: res.ok ? 200 : 502,
      });
    }
    return new Response("aerolex-github-cron: ok\n", { status: 200 });
  },
};
