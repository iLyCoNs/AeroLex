# Disparador puntual de la vigilancia judicial (Cloudflare Worker)

GitHub Actions entrega los eventos `schedule` con retrasos de horas
(`actions/runner#4468`) y los 5 pases de vigilancia estaban ingresando a media
tarde. Este Worker dispara el workflow por API **a la hora exacta**:

| Pase | UTC | Chile continental |
|---|---|---|
| 1 | 10:45 | 07:45 |
| 2 | 11:30 | 08:30 |
| 3 | 12:15 | 09:15 |
| 4 | 16:30 | 13:30 |
| 5 (viernes) | 21:30 | 18:30 |

## Cómo funciona

- **Temporizador propio**: un Durable Object (`PassScheduler`) mantiene una
  alarma que se reprograma sola para el próximo pase. Los Cron Triggers de
  Cloudflare pueden no disparar en cuentas nuevas o detenerse en silencio
  (Cloudflare recomienda DO + alarms), por eso no se usan.
- **Autocuración**: cualquier petición HTTP al Worker vuelve a asegurar la
  alarma; si el ciclo se rompiera, el siguiente acceso lo repara.
- **Causas nuevas**: el workflow lee todas las causas activas de Supabase en
  cada pase (`/rest/v1/cases?select=*`), de modo que las causas registradas en
  el portal, admin.html o el chatbot entran automáticamente al barrido.
- El `schedule` de GitHub se mantiene como respaldo; el caché anti-duplicados
  del script evita correos repetidos.

## Operación

- Forzar un barrido ahora: activar la variable `DISPATCH_ONCE` ("1") y
  desplegar; el siguiente tick o acceso HTTP la dispara. Luego quitarla.
- Prueba por HTTP: `GET /?dispatch=1` con el encabezado `x-cron-test` y el
  secreto `CRON_TEST_KEY`.
- Logs: `wrangler tail --config <ruta>`.
- Secretos del Worker: `GITHUB_TOKEN` (fine-grained, Actions: Read and write
  sobre `iLyCoNs/AeroLex`), `CRON_TEST_KEY` (opcional).
- Diagnóstico (variables, solo pruebas): `ALARM_DEBUG_SECONDS` acorta el ciclo
  de la alarma; `ALARM_FORCE_DISPATCH` dispara en cada tick. Quitarlas al
  terminar; el ciclo se reprograma solo al próximo pase real.

## Despliegue

Desde `C:\Users\LyCoNs\Desktop\SaaS` (allí está wrangler instalado):

```powershell
pnpm exec wrangler deploy --config "C:\Users\LyCoNs\Documents\GitHub\AeroLex\cloudflare\github-cron\wrangler.jsonc"
```
