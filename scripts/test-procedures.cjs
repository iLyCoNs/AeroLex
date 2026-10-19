const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('../procedures');

const next = (procedimiento, titles) => P.nextSuggestion({ procedimiento, steps: titles.map(title => ({ title })) });
assert.equal(next('laboral_general', ['Redacción de Demanda']).id, 'file');
assert.equal(next('manual', ['Redacción de Demanda']).id, 'file');
assert.equal(next('laboral_general', ['Presentación de demanda']).id, 'admit');
assert.equal(next('laboral_general', ['Demanda notificada']).id, 'answer');
assert.equal(next('familia_ordinario', ['Redacción y presentación de demanda']).id, 'admit');
assert.equal(next('laboral_monitorio', ['Presentación de demanda']).id, 'decision');
assert.ok(!P.catalog.laboral_monitorio.steps.some(s => s.id === 'preparatory' || s.id === 'trial'));
assert.equal(next('familia_mediacion', []).id, 'mediation');
assert.equal(next('familia_ordinario', []).id, 'draft');
assert.equal(next('familia_mediacion', ['Acta de mediación frustrada o acuerdo para aprobación']), null);
assert.ok(!P.catalog.familia_vif.steps.some(s => s.id === 'mediation'));
assert.equal(next('civil_mayor', ['Contestación de demanda o rebeldía']).id, 'reply');
assert.equal(next('civil_menor', ['Contestación de demanda o rebeldía']).id, 'conciliation');
assert.ok(next('civil_menor', ['Contestación de demanda o rebeldía']).conditional);
assert.equal(next('civil_ejecutivo', ['Presentación de demanda']).id, 'writ');
assert.equal(next('arriendo_monitorio', ['Presentación de demanda']).id, 'writ');
assert.equal(P.infer('Cobro de prestaciones laborales'), 'manual');
assert.equal(P.infer('Juicios ordinarios y ejecutivos'), 'manual');
assert.equal(P.infer('Familia'), 'manual');
assert.equal(P.infer('Pensiones de alimentos'), 'familia_mediacion');
assert.equal(P.infer('Posesión efectiva sin testamento'), 'sucesion_intestada');
assert.equal(P.infer('Posesión efectiva con testamento'), 'sucesion_testada');
assert.equal(P.resolve({procedimiento:'laboral_monitorio', materia:'Tutela laboral'}), 'laboral_monitorio');
assert.equal(P.valid('__proto__'), false);
assert.equal(P.valid('unknown'), false);
assert.ok(!P.suggestions({procedimiento:'laboral_general', steps:[{title:'REDACCIÓN DE DEMANDA'}]}).some(s => s.id === 'draft'));
assert.equal(P.nextRegistered({steps:[{done:true},{done:false,title:'Actual'},{done:false,title:'Siguiente'}]}).title, 'Siguiente');
assert.equal(P.nextRegistered({status:'suspendido',steps:[{done:false},{done:false}]}), null);
assert.equal(P.nextSuggestion({status:'finalizado',procedimiento:'civil_mayor',steps:[]}), null);
assert.equal(P.initialSteps('18 oct 2026')[1].date, '');
assert.equal(P.initialSteps('18 oct 2026').filter(s => s.done).length, 1);

for (const name of ['admin.html','index.html']) {
  const html = fs.readFileSync(name,'utf8');
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/src=|application\/ld\+json/i.test(match[1]) || !match[2].trim()) continue;
    new vm.Script(match[2], { filename: name });
  }
}

process.env.SUPABASE_URL = 'https://test.invalid';
process.env.SUPABASE_SERVICE_KEY = 'test';
process.env.ADMIN_KEY = 'test';
const admin = require('../api/admin');
const cases = require('../api/cases');
let record = { code:'ALX-2026-01', pin:'1234', materia:'Laboral', steps:P.initialSteps('18 oct 2026'), triage:['Nota privada', '__ABOGADO__:Abogado de prueba'], updated_at:'version-1' };
const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  if (options.method === 'PATCH') record = {...record, ...JSON.parse(options.body)};
  if (options.method === 'POST') record = {...record, ...JSON.parse(options.body)};
  return {ok:true, json:async()=>[structuredClone(record)]};
};
async function call(api, method, body) {
  const res = { code:200, data:null, setHeader(){}, status(code){this.code=code; return this;}, json(data){this.data=data;return this;}, end(){} };
  await api({url:'/api/test', method, body, headers:{'x-admin-key':'test'}},res);
  return res;
}
(async () => {
  const originalSteps = structuredClone(record.steps);
  let result = await call(admin,'PATCH',{code:record.code,procedimiento:'laboral_monitorio'});
  assert.equal(result.code,200);
  assert.equal(result.data.case.procedimiento,'laboral_monitorio');
  assert.deepEqual(record.steps,originalSteps);
  assert.ok(record.triage.includes('Nota privada'));
  assert.ok(record.triage.includes('__ABOGADO__:Abogado de prueba'));
  result = await call(admin,'GET',null);
  assert.equal(result.data.cases[0].procedimiento,'laboral_monitorio');
  result = await call(cases,'POST',{code:record.code,pin:'1234'});
  assert.equal(result.data.case.procedimiento,'laboral_monitorio');
  assert.equal(result.data.case.triage,undefined);
  assert.equal(result.data.case.pin,undefined);
  result = await call(admin,'PATCH',{code:record.code,procedimiento:'inexistente'});
  assert.equal(result.code,400);
  result = await call(admin,'PATCH',{code:record.code,detalle:'Otro cambio'});
  assert.equal(result.data.case.procedimiento,'laboral_monitorio');
  result = await call(admin,'POST',{materia:'Civil',procedimiento:'civil_sumario'});
  assert.equal(result.code,201);
  assert.equal(result.data.case.procedimiento,'civil_sumario');
  assert.equal(result.data.case.steps[1].date,'');
  console.log('Procedimientos: rutas, bifurcaciones, inferencia prudente, sintaxis, persistencia y privacidad OK.');
})().catch(error => {console.error(error);process.exitCode=1;}).finally(()=>{global.fetch=originalFetch;});
