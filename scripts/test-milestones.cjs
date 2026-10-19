const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const admin = fs.readFileSync('admin.html', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
function extract(source, name, nextName) {
  return source.slice(source.indexOf(`    function ${name}(`), source.indexOf(`    function ${nextName}(`)).trim();
}
const context = {
  AeroLexProcedures: require('../procedures'),
  escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;'),
  casesDB: { test: { steps: [
    { title: 'Recepción', date: '16 oct 2026', done: true },
    { title: 'Revisión', date: 'En curso', done: false },
    { title: 'Redacción de Demanda', date: '18 oct 2026', done: true }
  ] } },
  currentEditingId: 'test', renderMilestonesUI() {}, markUnsaved() {}
};
vm.createContext(context);
vm.runInContext(extract(admin, 'setCurrentMilestone', 'updateMilestoneTitle'), context);
const cardStart = index.indexOf('        function renderCaseCard(');
const cardEnd = index.indexOf('        async function fetchCaseFromAPI(', cardStart);
vm.runInContext(index.slice(cardStart, cardEnd), context);
context.setCurrentMilestone(2);
const steps = context.casesDB.test.steps;
assert.deepEqual(steps.map(s => s.done), [true, true, false]);
assert.equal(steps[1].date, '');
assert.equal(steps[2].date, '18 oct 2026');
const html = context.renderCaseCard({ steps, estado_actual: 5 }, 'test');
assert.equal((html.match(/timeline-step active/g) || []).length, 2);
assert.equal((html.match(/timeline-step current/g) || []).length, 1);
assert.match(html, /Hito actual · En curso:<\/strong> Redacción de Demanda/);
assert.match(html, /Próximo paso sugerido \(por confirmar\):<\/strong> Presentación de demanda/);
assert.match(html, /Actual · En curso · 18 oct 2026/);
const completed = context.renderCaseCard({ status: 'finalizado', steps: steps.map(s => ({ ...s, done: true })) }, 'test');
assert.doesNotMatch(completed, /timeline-step current|Hito actual/);
const empty = context.renderCaseCard({ steps: [] }, 'test');
assert.match(empty, /Aún no hay hitos/);
context.setCurrentMilestone(0);
assert.deepEqual(steps.map(s => s.done), [false, false, false]);
console.log('Hitos: selección actual, fechas, vista cliente, etapa independiente y casos vacíos/completados OK.');
