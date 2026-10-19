/* Catálogo compartido por servidor, administración y portal. Revisado: 2026-10-18.
 * Las rutas son sugerencias: no acreditan actuaciones ni calculan plazos legales.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AeroLexProcedures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const sources = {
    familia: ['Ley 19.968', 'https://www.bcn.cl/leychile/navegar?idNorma=229557'],
    laboral: ['Código del Trabajo', 'https://www.bcn.cl/leychile/navegar?idNorma=207436'],
    civil: ['Código de Procedimiento Civil', 'https://www.bcn.cl/leychile/navegar?idNorma=22740'],
    arriendo: ['Ley 18.101', 'https://www.bcn.cl/leychile/navegar?i=29526'],
    sucesion: ['ChileAtiende: posesión efectiva', 'https://www.chileatiende.gob.cl/fichas/3364'],
    testada: ['ChileAtiende: posesión efectiva judicial', 'https://www.chileatiende.gob.cl/fichas/4722']
  };
  const step = (id, title, conditional = false) => ({ id, title, conditional });
  const draft = step('draft', 'Redacción de demanda');
  const file = step('file', 'Presentación de demanda');
  const admit = step('admit', 'Resolución sobre admisibilidad');
  const notify = step('notify', 'Notificación de demanda y resolución');
  const answer = step('answer', 'Contestación de demanda o rebeldía');
  const prep = step('preparatory', 'Audiencia preparatoria');
  const trial = step('trial', 'Audiencia de juicio', true);
  const judgment = step('judgment', 'Sentencia y notificación');
  const enforce = step('enforcement', 'Cumplimiento de lo resuelto', true);
  const familyPath = [draft, file, admit, notify, answer, prep, trial, judgment, enforce];
  const laborPath = [draft, file, admit, notify, answer, prep, trial, judgment, enforce];
  const civilEnd = [step('conciliation', 'Conciliación', true), step('evidence', 'Recepción y rendición de prueba', true), step('observations', 'Observaciones a la prueba', true), step('citation', 'Citación para oír sentencia'), judgment, enforce];
  const catalog = {
    manual: { label: 'Por definir / otro procedimiento', note: 'Selecciona la vía concreta según la acción, cuantía y resolución del tribunal. Puedes crear hitos personalizados.', steps: [] },
    laboral_general: { label: 'Laboral · Aplicación general', source: 'laboral', articles: 'arts. 446–462', note: 'Confirmar procedencia frente a monitorio u otra vía especial. El juicio puede no celebrarse si existe acuerdo.', steps: laborPath },
    laboral_tutela: { label: 'Laboral · Tutela de derechos fundamentales', source: 'laboral', articles: 'arts. 485–495', note: 'La tutela se tramita con las reglas de aplicación general y sus especialidades; revisar cautelares y acumulación de acciones.', steps: laborPath },
    laboral_monitorio: { label: 'Laboral · Monitorio', source: 'laboral', articles: 'arts. 496–502', note: 'Verificar cuantía y supuestos legales. Reclamo previo ante Inspección del Trabajo, salvo excepción del art. 201. Puede resolverse sin audiencia; no usa preparatoria y juicio separados.', steps: [step('inspection', 'Reclamo y comparendo ante Inspección del Trabajo', true), draft, file, step('decision', 'Resolución inicial del tribunal'), step('notify', 'Notificación de resolución monitoria'), step('challenge', 'Reclamación de resolución monitoria', true), step('single_hearing', 'Audiencia única de conciliación, contestación y prueba', true), judgment, enforce] },
    familia_mediacion: { label: 'Familia · Alimentos, cuidado personal o relación directa y regular', source: 'familia', articles: 'arts. 55–67 y 106–111', note: 'Verificar mediación previa y excepciones legales, incluidas situaciones de violencia. Si hay acuerdo aprobado, no corresponde continuar automáticamente a demanda. Alimentos provisorios y cautelares se agregan según resolución.', steps: [step('mediation', 'Mediación previa o acreditación de excepción', true), step('mediation_result', 'Acta de mediación frustrada o acuerdo para aprobación', true), ...familyPath] },
    familia_ordinario: { label: 'Familia · Ordinario (divorcio y otras materias)', source: 'familia', articles: 'arts. 55–67', note: 'No impone mediación previa a todo asunto de familia. Confirmar vía y posibles simplificaciones; divorcio de común acuerdo puede tener tramitación especial.', steps: familyPath },
    familia_proteccion: { label: 'Familia · Protección de niños, niñas y adolescentes', source: 'familia', articles: 'arts. 68–80', note: 'Puede iniciarse de oficio o por requerimiento. Las medidas urgentes no esperan a la secuencia de audiencias. No corresponde mediación.', steps: [step('request', 'Requerimiento o inicio de protección'), step('precaution', 'Medidas cautelares de protección', true), prep, trial, judgment, step('monitor', 'Seguimiento de las medidas decretadas')] },
    familia_vif: { label: 'Familia · Violencia intrafamiliar', source: 'familia', articles: 'arts. 81–101', note: 'Sin mediación. Priorizar cautelares; si los hechos son constitutivos de delito, corresponde remisión al Ministerio Público y adaptar la ruta.', steps: [step('complaint', 'Demanda o denuncia por violencia intrafamiliar'), step('precaution', 'Resolución de medidas cautelares', true), notify, prep, trial, judgment, enforce] },
    civil_mayor: { label: 'Civil · Ordinario de mayor cuantía', source: 'civil', articles: 'Libro II', note: 'Confirmar cuantía y ausencia de procedimiento especial. Excepciones, reconvención, incidentes y recursos se incorporan cuando correspondan.', steps: [draft, file, step('admit', 'Resolución que confiere traslado'), notify, answer, step('reply', 'Réplica'), step('rejoinder', 'Dúplica'), ...civilEnd] },
    civil_menor: { label: 'Civil · Ordinario de menor cuantía', source: 'civil', articles: 'arts. 698–702', note: 'No incluye réplica ni dúplica. Verificar cuantía y ausencia de procedimiento especial.', steps: [draft, file, step('admit', 'Resolución que confiere traslado'), notify, answer, ...civilEnd] },
    civil_sumario: { label: 'Civil · Sumario', source: 'civil', articles: 'arts. 680–692', note: 'Verificar acción y reglas especiales; puede existir sustitución de procedimiento. Prueba y recursos dependen de la tramitación efectiva.', steps: [draft, file, step('admit', 'Citación a comparendo'), notify, step('hearing', 'Comparendo de contestación y conciliación'), step('evidence', 'Recepción y rendición de prueba', true), step('citation', 'Citación para oír sentencia'), judgment, enforce] },
    civil_ejecutivo: { label: 'Civil · Ejecutivo de obligación de dar', source: 'civil', articles: 'arts. 434–529', note: 'Requiere título ejecutivo y demás presupuestos. Cuadernos ejecutivo y de apremio pueden avanzar en paralelo; sin excepciones puede omitirse sentencia.', steps: [step('title', 'Revisión del título ejecutivo y exigibilidad'), draft, file, step('writ', 'Mandamiento de ejecución y embargo'), step('demand_payment', 'Notificación y requerimiento de pago'), step('attachment', 'Embargo', true), step('exceptions', 'Oposición de excepciones', true), step('evidence', 'Prueba de excepciones', true), step('judgment', 'Sentencia sobre excepciones', true), step('realization', 'Realización de bienes y pago', true)] },
    arriendo_especial: { label: 'Arrendamiento · Declarativo especial', source: 'arriendo', articles: 'arts. 7–8', note: 'Distinguir de monitorio por rentas impagas. Restitución anticipada y lanzamiento dependen de sus requisitos y resolución.', steps: [draft, file, step('admit', 'Citación a audiencia'), notify, step('hearing', 'Audiencia de contestación, conciliación y prueba'), judgment, step('restitution', 'Cumplimiento y restitución del inmueble', true)] },
    arriendo_monitorio: { label: 'Arrendamiento · Monitorio por rentas impagas', source: 'arriendo', articles: 'arts. 18-A–18-K', note: 'No se aplica indistintamente a todo desalojo. El pago u oposición pueden terminar la vía monitoria; adaptar la ruta según resolución.', steps: [draft, file, step('writ', 'Resolución y requerimiento de pago'), step('notify', 'Notificación al arrendatario'), step('response', 'Pago, oposición o vencimiento del plazo'), step('restitution', 'Cobro y lanzamiento ordenados judicialmente', true)] },
    sucesion_intestada: { label: 'Sucesión · Posesión efectiva intestada en Chile', source: 'sucesion', articles: 'Trámite ante Registro Civil', note: 'Para sucesiones abiertas en Chile sin testamento. No equivale a partición; revisar impuesto e inscripciones posteriores según bienes.', steps: [step('inventory', 'Identificación de herederos e inventario'), step('request', 'Solicitud ante Registro Civil'), step('resolution', 'Resolución e inscripción de posesión efectiva'), step('tax', 'Trámite de impuesto a la herencia o exención'), step('registration', 'Inscripciones de los bienes hereditarios', true)] },
    sucesion_testada: { label: 'Sucesión · Posesión efectiva judicial', source: 'testada', articles: 'Trámite ante tribunal civil', note: 'Confirmar testamento y competencia. Apertura o protocolización e inscripciones dependen del caso; no confundir con partición.', steps: [step('will', 'Revisión del testamento, herederos e inventario'), step('request', 'Solicitud judicial de posesión efectiva'), step('resolution', 'Resolución y publicaciones que correspondan'), step('registration', 'Inscripciones e impuesto a la herencia', true)] },
    extrajudicial: { label: 'Asesoría / gestión extrajudicial', note: 'Contratos, estudios de títulos y gestiones comerciales no siguen automáticamente un juicio. Define los entregables y trámites reales.', steps: [step('analysis', 'Análisis jurídico de antecedentes'), step('proposal', 'Preparación de propuesta o instrumento'), step('review', 'Revisión con el cliente'), step('delivery', 'Entrega del trabajo acordado')] }
  };
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const valid = id => Object.prototype.hasOwnProperty.call(catalog, id);
  function infer(matter) {
    const s = normalize(matter);
    // Materias genéricas nunca confirman una vía, ni un RIT determina por sí solo la acción.
    if (/tutela laboral/.test(s)) return 'laboral_tutela';
    if (/laboral.*monitorio|monitorio.*laboral/.test(s)) return 'laboral_monitorio';
    if (/laboral.*aplicacion general/.test(s)) return 'laboral_general';
    if (/violencia intrafamiliar|\bvif\b/.test(s)) return 'familia_vif';
    if (/proteccion.*(nino|nina|adolescente)/.test(s)) return 'familia_proteccion';
    if (/alimentos|cuidado personal|relacion directa/.test(s)) return 'familia_mediacion';
    if (/divorcio/.test(s)) return 'familia_ordinario';
    if (/ordinario.*mayor cuantia/.test(s)) return 'civil_mayor';
    if (/ordinario.*menor cuantia/.test(s)) return 'civil_menor';
    if (/juicio ejecutivo|ejecutivo de obligacion/.test(s) && !/ordinario/.test(s)) return 'civil_ejecutivo';
    if (/sumario/.test(s)) return 'civil_sumario';
    if (/monitorio.*(arriendo|arrendamiento)|(arriendo|arrendamiento).*monitorio/.test(s)) return 'arriendo_monitorio';
    if (/posesion efectiva.*(intestada|sin testamento)/.test(s)) return 'sucesion_intestada';
    if (/posesion efectiva.*(testada|con testamento)/.test(s)) return 'sucesion_testada';
    if (/estudio.*titulos|revision.*contratos|redaccion.*contratos|constitucion.*sociedades|asesoria/.test(s)) return 'extrajudicial';
    return 'manual';
  }
  function resolve(c) { return valid(c.procedimiento) ? c.procedimiento : infer(c.materia); }
  const aliases = {
    draft: ['Redacción de Demanda'],
    file: ['Presentación de demanda / descargos', 'Redacción y presentación de demanda', 'Demanda presentada', 'Ingreso Demanda'],
    notify: ['Demanda notificada', 'Notificación de demanda'],
    preparatory: ['Audiencia preparatoria fijada'], trial: ['Audiencia de juicio fijada'],
    judgment: ['Sentencia dictada', 'Sentencia notificada']
  };
  function matches(existing, candidate) {
    return normalize(existing.title) === normalize(candidate.title) || (aliases[candidate.id] || []).some(t => normalize(t) === normalize(existing.title));
  }
  function suggestions(c) {
    const route = catalog[resolve(c)].steps;
    const existing = Array.isArray(c.steps) ? c.steps : [];
    return route.filter(s => !existing.some(e => matches(e, s)));
  }
  function nextSuggestion(c) {
    if (['finalizado', 'suspendido'].includes(c.status)) return null;
    if (resolve(c) === 'manual') {
      const steps = Array.isArray(c.steps) ? c.steps : [];
      return steps.some(s => matches(s, draft)) && !steps.some(s => matches(s, file)) ? file : null;
    }
    const route = catalog[resolve(c)].steps;
    const existing = Array.isArray(c.steps) ? c.steps : [];
    // Continúa desde el último hito reconocido, sin volver a insertar etapas anteriores.
    let last = -1;
    route.forEach((s, i) => { if (existing.some(e => matches(e, s))) last = i; });
    // No saltar actuaciones condicionales: el abogado decide si se aplican.
    // Un acuerdo de mediación puede cerrar la controversia sin demanda.
    if (resolve(c) === 'familia_mediacion' && route[last]?.id === 'mediation_result') return null;
    return route.slice(last + 1).find(s => !existing.some(e => matches(e, s))) || null;
  }
  function initialSteps(today) {
    // La materia no acredita que ya exista demanda, mediación ni audiencia.
    return [
      { title: 'Expediente recibido por AeroLex', date: today, done: true },
      { title: 'Revisión de antecedentes', date: '', done: false }
    ];
  }
  function storedProcedure(triage) {
    const entry = (Array.isArray(triage) ? triage : []).find(s => typeof s === 'string' && s.startsWith('__PROCEDIMIENTO__:'));
    const id = entry ? entry.slice('__PROCEDIMIENTO__:'.length) : '';
    return valid(id) ? id : undefined;
  }
  function nextRegistered(c) {
    if (['finalizado', 'suspendido'].includes(c.status)) return null;
    const steps = Array.isArray(c.steps) ? c.steps : [];
    const current = steps.findIndex(s => !s.done);
    return current < 0 ? null : steps.slice(current + 1).find(s => !s.done) || null;
  }
  return { catalog, sources, valid, infer, resolve, suggestions, nextSuggestion, initialSteps, nextRegistered, storedProcedure };
});
