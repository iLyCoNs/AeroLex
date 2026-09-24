#!/usr/bin/env node
/**
 * scripts/test-vigia-diario.mjs
 * Prueba del registro del Parte Diario (CFG-DIARIO) con un mock de PostgREST.
 *
 * Reproduce el fallo real: el PATCH sin filas responde 204 (ok) y el registro
 * nunca se creaba. Verifica que el upsert crea la fila, actualiza sin duplicar,
 * elige la fila más reciente y fusiona pases de otro disparo.
 *
 * Uso: node scripts/test-vigia-diario.mjs
 */

process.env.SUPABASE_URL = 'http://mock.local';
process.env.SUPABASE_SERVICE_KEY = 'test-key';

const rows = [];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = (init.method || 'GET').toUpperCase();
  if (url.pathname !== '/rest/v1/cases') throw new Error(`URL inesperada: ${url.pathname}`);
  const codeFilter = url.searchParams.get('code');
  let matches = rows;
  if (codeFilter && codeFilter.startsWith('eq.')) {
    const targetCode = decodeURIComponent(codeFilter.slice(3));
    matches = rows.filter(r => r.code === targetCode);
  } else if (codeFilter && codeFilter.startsWith('like.')) {
    const prefix = decodeURIComponent(codeFilter.slice(5)).replace(/\*$/, '');
    matches = rows.filter(r => String(r.code).startsWith(prefix));
  }

  if (method === 'GET') {
    const ordered = [...matches].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const limit = Number(url.searchParams.get('limit') || ordered.length);
    return json(ordered.slice(0, limit));
  }
  if (method === 'PATCH') {
    if (matches.length === 0) return new Response(null, { status: 204 });
    const body = JSON.parse(init.body);
    for (const row of matches) Object.assign(row, body);
    return json(matches);
  }
  if (method === 'POST') {
    const body = JSON.parse(init.body);
    rows.push({ ...body });
    return json(body, 201);
  }
  throw new Error(`Método no soportado: ${method}`);
};

const { loadDiario, saveDiario, saveDiarioMerged, upsertCaseRow, DIARIO_CODE, isTransientOjvError, loadDigestConfigs, filterStateForRecipient } =
  await import('./vigia-nube-cron.mjs');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK ' : 'FALLA'} · ${name}${detail ? ` · ${detail}` : ''}`);
};

// 1. Sin fila previa, loadDiario devuelve null.
check('loadDiario sin fila devuelve null', (await loadDiario()) === null);

// 2. saveDiario CREA la fila (el bug: antes nunca se creaba).
const stateA = { date: '2026-09-23', passes: [{ label: '07:45', at: '2026-09-23T10:45:03Z', total: 5, novelties: 0 }], digestSentAt: null, previous: null, lawyers: {} };
check('saveDiario crea CFG-DIARIO', (await saveDiario(stateA)) === true && rows.length === 1 && rows[0].code === DIARIO_CODE, `filas=${rows.length}`);

// 3. Round-trip.
const loaded = await loadDiario();
check('loadDiario recupera el estado guardado', loaded?.passes?.[0]?.label === '07:45' && loaded?.date === '2026-09-23');

// 4. Segundo guardado actualiza sin duplicar.
const stateB = { ...stateA, passes: [...stateA.passes, { label: '08:30', at: '2026-09-23T11:30:03Z', total: 5, novelties: 1 }] };
await saveDiario(stateB);
check('segundo guardado actualiza sin duplicar', rows.length === 1 && (await loadDiario()).passes.length === 2, `filas=${rows.length}`);

// 5. Con filas duplicadas heredadas, gana la más reciente.
rows.push({ code: DIARIO_CODE, detalle: JSON.stringify({ date: '2026-09-22', passes: [] }), updated_at: '2026-09-22T00:00:00.000Z' });
check('elige la fila más reciente', (await loadDiario()).date === '2026-09-23');

// 6. Fusión: un pase registrado por otro disparo no se pierde.
const merged = { date: '2026-09-23', passes: [{ label: '13:30', at: '2026-09-23T16:30:04Z', total: 5, novelties: 0 }], digestSentAt: null, previous: null, lawyers: {} };
await saveDiarioMerged(merged);
const afterMerge = await loadDiario();
const labels = (afterMerge.passes || []).map(p => p.label).sort();
check('saveDiarioMerged conserva pases de otro disparo', labels.includes('07:45') && labels.includes('08:30') && labels.includes('13:30'), `pases=${labels.join(',')}`);

// 7. Upsert de otras filas CFG.
check('upsertCaseRow crea CFG-VIGILANCIA', (await upsertCaseRow('CFG-VIGILANCIA', '{"enabled":true}', { rit: 'CFG-VIG' })) === true && rows.some(r => r.code === 'CFG-VIGILANCIA'));

// 8. Clasificación de errores transitorios.
check('isTransientOjvError reconoce fallos de red', isTransientOjvError('fetch failed') && isTransientOjvError('PJUD HTTP 503') && isTransientOjvError('The operation was aborted due to timeout'));
check('isTransientOjvError no reintenta errores permanentes', !isTransientOjvError('Formato de RIT inválido') && !isTransientOjvError(''));

// 9. Preferencias del correo diario por usuario (CFG-DIGEST-*).
rows.push({ code: 'CFG-DIGEST-marta', detalle: JSON.stringify({ enabled: true, email: 'marta@estudio.cl', name: 'Marta Sánchez' }), updated_at: '2026-09-23T12:00:00.000Z' });
rows.push({ code: 'CFG-DIGEST-jaime', detalle: JSON.stringify({ enabled: false, email: 'jaime@estudio.cl', name: 'Jaime Vidal' }), updated_at: '2026-09-23T12:00:01.000Z' });
rows.push({ code: 'CFG-DIGEST-sin-correo', detalle: JSON.stringify({ enabled: true, email: '' }), updated_at: '2026-09-23T12:00:02.000Z' });
const configs = await loadDigestConfigs();
check(
  'loadDigestConfigs lee solo configuraciones con correo',
  configs.length === 2
    && configs.find(c => c.slug === 'marta')?.enabled === true
    && configs.find(c => c.slug === 'jaime')?.enabled === false,
  `configs=${configs.map(c => `${c.slug}:${c.enabled ? 'on' : 'off'}`).join(',')}`,
);

// 10. Filtro del correo diario por cartera del abogado.
const dayState = {
  date: '2026-09-23',
  passes: [{
    label: '07:45', at: '2026-09-23T10:45:03Z', total: 2, novelties: 1,
    cases: [
      { code: 'ALX-2026-72', rit: '1324-2026', abogado: 'Marta Sánchez', hasNoveltiesToday: false },
      { code: 'ALX-2026-75', rit: 'Z-789-2020', abogado: 'Jaime Vidal', hasNoveltiesToday: true },
    ],
  }],
};
const mine = filterStateForRecipient(dayState, 'Marta Sánchez');
check(
  'filterStateForRecipient recorta a la cartera del abogado',
  mine.passes[0].cases.length === 1 && mine.passes[0].total === 1 && mine.passes[0].novelties === 0 && mine.passes[0].cases[0].rit === '1324-2026',
  `causas=${mine.passes[0].cases.length}`,
);
const all = filterStateForRecipient(dayState, '');
check('filterStateForRecipient sin nombre devuelve toda la cartera', all.passes[0].cases.length === 2);

// 11. Filtro por siglas del estudio (cada estudio con sus propias causas).
const onlyPs = filterStateForRecipient(dayState, null, 'PS');
check('filtro por siglas deja fuera causas de otro estudio', onlyPs.passes[0].cases.length === 0);
const onlyAlx = filterStateForRecipient(dayState, null, 'ALX');
check('filtro por siglas conserva las causas del estudio', onlyAlx.passes[0].cases.length === 2);

const failed = results.filter(r => !r.ok);
// --- Vigilancia por causa: la marca __VIGILANCIA__:off saca la causa del barrido ---
const { isCaseWatchPaused } = await import('./vigia-nube-cron.mjs');
check('vigilancia pausada omite la causa del barrido', isCaseWatchPaused({ code: 'ALX-2026-99', rit: 'C-99-2026', triage: ['__ABOGADO__:Marta', '__VIGILANCIA__:off'] }) === true);
check('causa sin marca sigue vigilada', isCaseWatchPaused({ code: 'ALX-2026-98', rit: 'C-98-2026', triage: ['__ABOGADO__:Marta'] }) === false);
console.log(`\n${results.length - failed.length}/${results.length} pruebas del parte diario en verde.`);
process.exit(failed.length ? 1 : 0);
