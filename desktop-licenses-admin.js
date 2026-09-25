/* Panel de licencias de escritorio. Solo licencias: nunca expedientes ni contraseñas. */
(() => {
  const PLANES = {
    aerolex_inicial_gratis: { nombre: 'Inicial (gratis)', corto: 'Inicial', dias: 3650, precio: 'Gratis', nota: '1 abogado · 2 causas · sin nube', detalle: 'Para partir sin costo: ficha, Estado Diario OJV, escritos con plantillas y biblioteca. No incluye vigilancia automática en la nube ni portal de clientes.' },
    aerolex_litigante_mensual: { nombre: 'Litigante', corto: 'Litigante', dias: 30, precio: '$19.990/mes', nota: '1 abogado · 30 causas · nube 5 pases', detalle: 'Abogado independiente: 1 titular, hasta 30 causas activas, vigilancia en la nube (5 pases diarios con el PC apagado), portal de clientes con PIN, escritos con formato real y verificación de vigencia BCN.' },
    aerolex_litigante_anual: { nombre: 'Litigante anual', corto: 'Litigante anual', dias: 365, precio: '$199.900/año', nota: '2 meses gratis · 30 causas', detalle: 'El mismo Plan Litigante con dos meses de regalo (equivale a $16.658 al mes). Ideal para asegurar el año completo.' },
    aerolex_estudio_mensual: { nombre: 'Estudio', corto: 'Estudio', dias: 30, precio: '$39.990/mes', nota: '3 abogados · 100 causas · nube 24/7', detalle: 'Estudio pequeño: hasta 3 abogados con carteras independientes, 100 causas, vigilancia 24/7 cada 45 minutos, tablas de la Corte de Apelaciones, bóveda multi-abogado y CRM/WhatsApp unificado.' },
    aerolex_bufete_mensual: { nombre: 'Bufete', corto: 'Bufete', dias: 30, precio: '$79.990/mes', nota: '8 abogados · ilimitadas · nube 24/7', detalle: 'Firma consolidada: hasta 8 abogados y causas ilimitadas, todo lo del Plan Estudio más atención directa y prioritaria del equipo AeroLex.' },
    aerolex_causas_3: { nombre: 'Pack 3 causas', corto: 'Pack 3', dias: 30, precio: '$8.970/mes', nota: '$2.990 por causa', detalle: 'Pago por uso: 3 causas activas a $2.990 cada una, con vigilancia en la nube y portal de clientes. Sin permanencia.' },
    aerolex_causas_10: { nombre: 'Pack 10 causas', corto: 'Pack 10', dias: 30, precio: '$29.900/mes', nota: '$2.990 por causa', detalle: 'Pago por uso: 10 causas activas a $2.990 cada una, con vigilancia en la nube y portal de clientes. Sin permanencia.' },
  };

  let dialog;
  const pending = new Map();
  let licencias = [];
  let filtro = 'todas';
  let busqueda = '';

  const color = { success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', accent: 'var(--accent)' };
  function elemento(tag, texto, padre) { const nodo = document.createElement(tag); if (texto !== undefined) nodo.textContent = texto; if (padre) padre.append(nodo); return nodo; }
  function boton(texto, padre, clase = 'btn btn-secondary', icono = '') {
    const btn = elemento('button', '', padre); btn.type = 'button'; btn.className = clase;
    if (icono) { const i = elemento('i', '', btn); i.className = icono; }
    elemento('span', texto, btn);
    return btn;
  }
  function campo(padre, etiqueta, tipo, valor = '') {
    const label = elemento('label', '', padre); label.style.cssText = 'display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--text-secondary);font-weight:600;letter-spacing:.03em;text-transform:uppercase';
    elemento('span', etiqueta, label);
    const input = elemento('input', '', label); input.type = tipo; input.value = valor;
    input.style.cssText = 'background:var(--input-bg);border:1px solid var(--border);color:var(--text);padding:9px 11px;border-radius:9px;font-size:13px;font-family:inherit;outline:none';
    input.onfocus = () => { input.style.borderColor = 'var(--accent)'; input.style.background = 'var(--input-focus-bg)'; };
    input.onblur = () => { input.style.borderColor = 'var(--border)'; input.style.background = 'var(--input-bg)'; };
    return input;
  }
  function pildora(texto, colorTexto, padre) {
    const pill = elemento('span', texto, padre);
    pill.style.cssText = `display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;border:1px solid ${colorTexto}44;background:${colorTexto}18;color:${colorTexto}`;
    return pill;
  }
  function tarjeta(padre) {
    const card = elemento('section', '', padre);
    card.style.cssText = 'background:var(--panel-raised);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:10px';
    return card;
  }

  async function request(body, id) {
    const url = id ? `/api/licenses?action=admin&id=${encodeURIComponent(id)}` : '/api/licenses?action=admin';
    const response = await fetch(url, { method: body ? 'POST' : 'GET',
      headers: authHeaders({ 'Content-Type': 'application/json' }), ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'No se pudo consultar licencias.'); return data;
  }
  function copiar(texto, aviso) {
    const listo = () => { aviso.textContent = 'Copiado al portapapeles.'; aviso.style.color = color.success; setTimeout(() => { aviso.textContent = ''; }, 2500); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(texto).then(listo).catch(() => {});
    else { const area = document.createElement('textarea'); area.value = texto; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); listo(); }
  }
  function diasRestantes(fecha) { return Math.ceil((Date.parse(fecha) - Date.now()) / 86400000); }
  function fechaCorta(valor) { const d = new Date(valor); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
  function fechaLarga(valor) { const d = new Date(valor); return Number.isFinite(d.getTime()) ? d.toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }

  function estadoDe(row) {
    const vencida = diasRestantes(row.expires_at) < 0;
    if (row.status === 'suspended') return { clave: 'suspendidas', etiqueta: 'Suspendida', color: color.warning };
    if (vencida) return { clave: 'vencidas', etiqueta: 'Vencida', color: color.danger };
    if (row.status === 'active') return { clave: 'activas', etiqueta: 'Activa', color: color.success };
    return { clave: 'prueba', etiqueta: 'En prueba', color: color.accent };
  }
  function planDe(row) { return PLANES[row.plan] || null; }

  window.openDesktopLicenses = async () => {
    if (dialog) dialog.remove();
    dialog = elemento('dialog');
    dialog.style.cssText = 'margin:auto;padding:0;width:min(1120px,96vw);max-height:92vh;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:18px;box-shadow:var(--card-shadow);overflow:hidden';
    document.body.append(dialog);

    const contenedor = elemento('div', '', dialog);
    contenedor.style.cssText = 'display:flex;flex-direction:column;max-height:92vh';

    // ── Cabecera ──
    const cabecera = elemento('header', '', contenedor);
    cabecera.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 22px 14px;border-bottom:1px solid var(--border);background:var(--panel)';
    const titulos = elemento('div', '', cabecera);
    const h = elemento('h2', '', titulos); h.style.cssText = 'font-size:18px;font-weight:700;display:flex;align-items:center;gap:9px';
    const icono = elemento('i', '', h); icono.className = 'fa-solid fa-id-card'; icono.style.color = 'var(--accent)';
    elemento('span', 'Licencias de escritorio', h);
    const sub = elemento('p', 'Genera el acceso de cada abogado según su plan, amplía días, suspende, reemite códigos, revoca equipos o elimina la licencia. La app verifica cada 15 segundos y tolera hasta 24 horas sin conexión; los expedientes y contraseñas permanecen en el equipo del estudio.', titulos);
    sub.style.cssText = 'margin-top:6px;font-size:12px;line-height:1.6;color:var(--text-secondary);max-width:760px';
    const cerrar = elemento('button', '', cabecera); cerrar.type = 'button'; cerrar.title = 'Cerrar (Esc)'; cerrar.setAttribute('aria-label', 'Cerrar');
    cerrar.style.cssText = 'background:transparent;border:1px solid var(--border);color:var(--text-secondary);width:32px;height:32px;border-radius:9px;cursor:pointer;flex-shrink:0';
    cerrar.innerHTML = '<i class="fa-solid fa-xmark"></i>'; cerrar.onclick = () => dialog.close();

    const cuerpo = elemento('div', '', contenedor);
    cuerpo.style.cssText = 'padding:18px 22px 24px;overflow:auto;display:flex;flex-direction:column;gap:14px';

    // ── Avisos ──
    const aviso = elemento('p', '', cuerpo); aviso.setAttribute('role', 'status');
    aviso.style.cssText = 'display:none;padding:11px 13px;border-radius:11px;font-size:12.5px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--border);background:var(--panel-inset)';
    function mostrarAviso(texto, tipo = 'info') {
      aviso.style.display = 'block';
      aviso.style.borderColor = tipo === 'error' ? color.danger + '66' : tipo === 'ok' ? color.success + '66' : 'var(--border)';
      aviso.style.background = tipo === 'error' ? color.danger + '12' : tipo === 'ok' ? color.success + '12' : 'var(--panel-inset)';
      aviso.style.color = tipo === 'error' ? color.danger : tipo === 'ok' ? color.success : 'var(--text-secondary)';
      aviso.textContent = texto;
    }

    // ── Aviso de columna "plan" pendiente (un paso de SQL en Supabase) ──
    const SQL_PLAN = 'alter table public.desktop_licenses add column if not exists plan text;';
    const avisoPlan = elemento('section', '', cuerpo);
    avisoPlan.style.cssText = 'display:none;border:1px solid ' + color.accent + '55;background:' + color.accent + '0f;border-radius:13px;padding:14px 15px';
    const avisoPlanTexto = elemento('p', '', avisoPlan);
    avisoPlanTexto.style.cssText = 'font-size:12.5px;line-height:1.6;color:var(--text)';
    avisoPlanTexto.innerHTML = '<strong>Falta un paso para guardar el plan de cada licencia.</strong> La base todavía no tiene la columna <code>plan</code>. Copia la línea, ejecútala una vez en Supabase → SQL Editor y pulsa Actualizar. Mientras tanto, todo lo demás del panel funciona con normalidad.';
    const accionPlan = elemento('div', '', avisoPlan);
    accionPlan.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:9px';
    const copiarSql = boton('Copiar el SQL', accionPlan, 'btn btn-primary', 'fa-solid fa-copy');
    copiarSql.onclick = () => copiar(SQL_PLAN, aviso);
    const verSql = elemento('code', SQL_PLAN, accionPlan);
    verSql.style.cssText = 'padding:7px 10px;border-radius:8px;background:var(--panel-inset);border:1px dashed ' + color.accent + '55;font-size:11.5px;user-select:all;overflow-wrap:anywhere';

    // ── Panel del código de activación ──
    const panelCodigo = elemento('section', '', cuerpo);
    panelCodigo.style.cssText = 'display:none;border:1px solid ' + color.accent + '55;background:' + color.accent + '10;border-radius:14px;padding:16px';
    const codigoTitulo = elemento('p', '', panelCodigo); codigoTitulo.style.cssText = 'font-size:12px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.04em';
    const codigoTexto = elemento('code', '', panelCodigo);
    codigoTexto.style.cssText = 'display:block;margin:9px 0;padding:11px 13px;border-radius:10px;background:var(--panel-inset);border:1px dashed ' + color.accent + '66;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;user-select:all';
    const codigoAcciones = elemento('div', '', panelCodigo); codigoAcciones.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center';
    const copiarCodigo = boton('Copiar código', codigoAcciones, 'btn btn-primary', 'fa-solid fa-copy');
    const codigoNota = elemento('span', 'Válido 7 días y de un solo uso. Entrégalo únicamente al titular del correo.', codigoAcciones);
    codigoNota.style.cssText = 'font-size:11.5px;color:var(--text-secondary)';
    function mostrarCodigo(nombre, codigo) {
      panelCodigo.style.display = 'block';
      codigoTitulo.textContent = `Código de activación para ${nombre}`;
      codigoTexto.textContent = codigo;
      copiarCodigo.onclick = () => copiar(codigo, aviso);
      cuerpo.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ── Estadísticas ──
    const stats = elemento('div', '', cuerpo); stats.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px';

    // ── Crear licencia ──
    const crear = tarjeta(cuerpo);
    const crearTitulo = elemento('p', '', crear); crearTitulo.style.cssText = 'font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-secondary);margin-bottom:12px';
    crearTitulo.innerHTML = '<i class="fa-solid fa-plus" style="color:var(--accent)"></i> &nbsp;Crear licencia';
    const form = elemento('form', '', crear); form.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px;align-items:end';
    const nombre = campo(form, 'Nombre del abogado', 'text'); nombre.maxLength = 160;
    const email = campo(form, 'Correo de su cuenta local', 'email'); email.maxLength = 254;
    const planLabel = elemento('label', '', form); planLabel.style.cssText = 'display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--text-secondary);font-weight:600;letter-spacing:.03em;text-transform:uppercase';
    elemento('span', 'Plan', planLabel);
    const plan = elemento('select', '', planLabel);
    plan.style.cssText = 'background:var(--input-bg);border:1px solid var(--border);color:var(--text);padding:9px 11px;border-radius:9px;font-size:13px;outline:none';
    for (const [id, info] of Object.entries(PLANES)) { const opcion = elemento('option', `${info.nombre} — ${info.precio} · ${info.nota}`, plan); opcion.value = id; }
    plan.value = 'aerolex_litigante_mensual';
    const dias = campo(form, 'Días', 'number', '30'); dias.min = '1'; dias.max = '3650';
    const planInfo = elemento('p', '', crear);
    planInfo.style.cssText = 'margin-top:11px;padding:10px 12px;border-radius:10px;background:var(--panel-inset);border:1px solid var(--border);font-size:12px;line-height:1.6;color:var(--text-secondary)';
    function pintarPlan() {
      const info = PLANES[plan.value];
      planInfo.innerHTML = `<strong style="color:var(--text)">${info.nombre}</strong> · ${info.precio} — ${info.detalle}`;
    }
    plan.onchange = () => { dias.value = String(PLANES[plan.value]?.dias ?? 30); pintarPlan(); };
    pintarPlan();
    const crearBoton = boton('Crear y generar código', form, 'btn btn-primary', 'fa-solid fa-key');
    crearBoton.style.gridColumn = '1 / -1';
    crearBoton.style.justifySelf = 'start';
    crearBoton.style.padding = '10px 18px';

    // ── Filtros ──
    const barra = elemento('div', '', cuerpo); barra.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;align-items:center';
    const buscar = elemento('input', '', barra); buscar.placeholder = 'Buscar por nombre o correo…'; buscar.setAttribute('aria-label', 'Buscar licencias');
    buscar.style.cssText = 'flex:1;min-width:220px;background:var(--input-bg);border:1px solid var(--border);color:var(--text);padding:9px 12px;border-radius:10px;font-size:13px;outline:none';
    buscar.oninput = () => { busqueda = buscar.value.trim().toLowerCase(); pintarLista(); };
    const chips = elemento('div', '', barra); chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    const refrescar = boton('Actualizar', barra, 'btn btn-secondary', 'fa-solid fa-rotate');
    const CHIPS = [['todas', 'Todas'], ['activas', 'Activas'], ['prueba', 'En prueba'], ['vencidas', 'Vencidas'], ['suspendidas', 'Suspendidas']];
    const chipsNodos = {};
    for (const [clave, etiqueta] of CHIPS) {
      const chip = elemento('button', etiqueta, chips); chip.type = 'button';
      chip.style.cssText = 'background:var(--panel-inset);border:1px solid var(--border);color:var(--text-secondary);padding:7px 12px;border-radius:999px;font-size:12px;cursor:pointer;font-weight:600';
      chip.onclick = () => { filtro = clave; pintarLista(); };
      chipsNodos[clave] = chip;
    }

    const lista = elemento('div', '', cuerpo);
    let trabajando = false;

    async function mutar(operacion, id, extra = {}) {
      if (trabajando) return;
      const clave = JSON.stringify([operacion, id, extra]);
      const previo = pending.get(clave) || { requestId: crypto.randomUUID(), id: id || crypto.randomUUID() };
      pending.set(clave, previo);
      trabajando = true; crearBoton.disabled = true;
      mostrarAviso('Guardando el cambio en la licencia…');
      try {
        const resultado = await request({ operation: operacion, ...previo, ...extra });
        pending.delete(clave);
        if (resultado.activationCode) {
          mostrarCodigo(extra.name || extra.email || 'el abogado', resultado.activationCode);
          mostrarAviso('Licencia actualizada. Entrega el código al titular del correo.', 'ok');
        } else if (operacion === 'delete') {
          panelCodigo.style.display = 'none';
          mostrarAviso(`Licencia de ${resultado.email} eliminada definitivamente.`, 'ok');
        } else {
          mostrarAviso('Cambio guardado. Se reflejará en la app conectada en su próxima verificación (15 s).', 'ok');
        }
        await cargar();
      } catch (error) {
        mostrarAviso(`${error.message} Si reintentas la misma operación, no se duplicará.`, 'error');
      } finally { trabajando = false; crearBoton.disabled = false; }
    }

    function pintarLista() {
      for (const [clave, nodo] of Object.entries(chipsNodos)) {
        const activo = filtro === clave;
        nodo.style.background = activo ? color.accent : 'var(--panel-inset)';
        nodo.style.color = activo ? '#fff' : 'var(--text-secondary)';
        nodo.style.borderColor = activo ? color.accent : 'var(--border)';
      }
      const filtradas = licencias.filter((row) => {
        const estado = estadoDe(row);
        if (filtro !== 'todas' && estado.clave !== filtro) return false;
        if (busqueda && !`${row.display_name} ${row.email}`.toLowerCase().includes(busqueda)) return false;
        return true;
      });
      // Estadísticas
      const cuenta = { total: licencias.length, activas: 0, prueba: 0, vencidas: 0, suspendidas: 0, proximas: 0 };
      for (const row of licencias) {
        cuenta[estadoDe(row).clave] += 1;
        const dias = diasRestantes(row.expires_at);
        if (dias >= 0 && dias <= 7) cuenta.proximas += 1;
      }
      stats.replaceChildren();
      const TARJETAS = [
        ['Total', cuenta.total, 'var(--text)'], ['Activas', cuenta.activas, color.success], ['En prueba', cuenta.prueba, color.accent],
        ['Vencidas', cuenta.vencidas, color.danger], ['Suspendidas', cuenta.suspendidas, color.warning], ['Vencen ≤ 7 días', cuenta.proximas, color.warning],
      ];
      for (const [etiqueta, valor, colorTexto] of TARJETAS) {
        const caja = elemento('div', '', stats);
        caja.style.cssText = 'background:var(--panel-inset);border:1px solid var(--border);border-radius:12px;padding:12px 14px';
        elemento('p', etiqueta, caja).style.cssText = 'font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-faint);font-weight:700';
        elemento('p', String(valor), caja).style.cssText = `font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;color:${colorTexto};margin-top:4px`;
      }

      lista.replaceChildren();
      if (filtradas.length === 0) {
        const vacio = elemento('p', licencias.length ? 'No hay licencias que coincidan con el filtro.' : 'Aún no hay licencias. Crea la primera con el formulario de arriba.', lista);
        vacio.style.cssText = 'text-align:center;padding:28px;color:var(--text-secondary);font-size:13px';
        return;
      }
      for (const row of filtradas) lista.append(fila(row));
    }

    function fila(row) {
      const estado = estadoDe(row);
      const dias = diasRestantes(row.expires_at);
      const infoPlan = planDe(row);
      const card = tarjeta(lista);
      card.style.cssText += ';display:flex;flex-direction:column;gap:10px';

      const superior = elemento('div', '', card); superior.style.cssText = 'display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap';
      const izquierda = elemento('div', '', superior); izquierda.style.cssText = 'display:flex;gap:12px;align-items:flex-start;min-width:0';
      const iniciales = elemento('div', '', izquierda);
      iniciales.style.cssText = `width:40px;height:40px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;background:${estado.color}1f;color:${estado.color};border:1px solid ${estado.color}44`;
      iniciales.textContent = String(row.display_name || row.email).split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
      const datos = elemento('div', '', izquierda); datos.style.cssText = 'min-width:0';
      const lineaNombre = elemento('div', '', datos); lineaNombre.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
      const nombreN = elemento('strong', row.display_name, lineaNombre); nombreN.style.cssText = 'font-size:14px';
      pildora(estado.etiqueta, estado.color, lineaNombre);
      if (infoPlan) pildora(infoPlan.corto, 'var(--accent)', lineaNombre);
      const correo = elemento('p', row.email, datos); correo.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-top:2px;overflow-wrap:anywhere';
      const vence = elemento('p', '', datos);
      vence.style.cssText = 'font-size:11.5px;color:var(--text-faint);margin-top:3px';
      vence.textContent = `Vence ${fechaCorta(row.expires_at)} · ${dias < 0 ? `hace ${-dias} día(s)` : dias === 0 ? 'hoy' : `en ${dias} día(s)`} · revisión ${row.revision}`;
      if (infoPlan) {
        const planLinea = elemento('p', `Plan: ${infoPlan.nombre} (${infoPlan.precio}) · ${infoPlan.nota}`, datos);
        planLinea.style.cssText = 'font-size:11.5px;color:var(--text-faint);margin-top:3px';
      }
      if (row.activation_expires_at) {
        const codigoPendiente = elemento('p', `Código sin usar (vence ${fechaLarga(row.activation_expires_at)})`, datos);
        codigoPendiente.style.cssText = 'font-size:11px;color:' + color.accent + ';margin-top:3px;font-weight:600';
      }

      const acciones = elemento('div', '', card); acciones.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap;align-items:center;border-top:1px solid var(--border);padding-top:11px';
      const diasInput = elemento('input', '', acciones); diasInput.type = 'number'; diasInput.min = '1'; diasInput.max = '3650'; diasInput.value = '30';
      diasInput.setAttribute('aria-label', `Días adicionales para ${row.display_name}`);
      diasInput.style.cssText = 'width:70px;background:var(--input-bg);border:1px solid var(--border);color:var(--text);padding:7px 9px;border-radius:8px;font-size:12.5px';
      const aplicar = boton('Extender', acciones, 'btn btn-primary', 'fa-solid fa-calendar-plus');
      aplicar.onclick = () => {
        const valor = Number(diasInput.value);
        if (!Number.isInteger(valor) || valor < 1 || valor > 3650) { mostrarAviso('Ingresa entre 1 y 3650 días.', 'error'); return; }
        void mutar('extend', row.id, { days: valor, plan: row.plan || undefined });
      };
      for (const atajo of [30, 90, 365]) {
        const b = boton(`+${atajo}`, acciones, 'btn btn-secondary');
        b.style.padding = '7px 10px';
        b.onclick = () => void mutar('extend', row.id, { days: atajo, plan: row.plan || undefined });
      }
      const fecha = elemento('input', '', acciones); fecha.type = 'date'; fecha.value = String(row.expires_at).slice(0, 10);
      fecha.setAttribute('aria-label', `Fijar vencimiento de ${row.display_name}`);
      fecha.style.cssText = 'background:var(--input-bg);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:8px;font-size:12px';
      fecha.style.colorScheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const fijar = boton('Fijar vencimiento', acciones, 'btn btn-secondary', 'fa-solid fa-calendar-day');
      fijar.onclick = () => {
        if (!fecha.value) { mostrarAviso('Elige una fecha para fijar el vencimiento.', 'error'); return; }
        void mutar('set-expiry', row.id, { date: fecha.value });
      };
      const alternar = boton(row.status === 'suspended' ? 'Reactivar' : 'Suspender', acciones, 'btn btn-secondary', row.status === 'suspended' ? 'fa-solid fa-play' : 'fa-solid fa-pause');
      alternar.onclick = () => void mutar(row.status === 'suspended' ? 'resume' : 'suspend', row.id);
      const estadoBoton = boton(row.status === 'active' ? 'Volver a prueba' : 'Marcar activa', acciones, 'btn btn-secondary', row.status === 'active' ? 'fa-solid fa-flask' : 'fa-solid fa-circle-check');
      estadoBoton.onclick = () => void mutar('set-status', row.id, { status: row.status === 'active' ? 'trial' : 'active' });
      const nuevoCodigo = boton('Nuevo código', acciones, 'btn btn-secondary', 'fa-solid fa-key');
      nuevoCodigo.onclick = () => void mutar('activation', row.id, { name: row.display_name });
      const equipos = boton('Equipos', acciones, 'btn btn-secondary', 'fa-solid fa-desktop');
      const revocar = boton('Revocar equipos', acciones, 'btn btn-secondary', 'fa-solid fa-plug-circle-xmark');
      revocar.onclick = () => confirmar(acciones, `¿Revocar los equipos de ${row.display_name}? Necesitarán un código nuevo.`, () => void mutar('revoke', row.id));
      const eliminar = boton('Eliminar', acciones, 'btn btn-secondary', 'fa-solid fa-trash');
      eliminar.style.cssText = 'color:' + color.danger + ';border-color:' + color.danger + '55';
      eliminar.onclick = () => eliminarConConfirmacion(card, row);
      const copiarCorreo = boton('Copiar correo', acciones, 'btn btn-secondary', 'fa-solid fa-copy');
      copiarCorreo.onclick = () => copiar(row.email, aviso);

      const detalle = elemento('div', '', card); detalle.style.display = 'none';
      let cargado = false;
      equipos.onclick = async () => {
        if (detalle.style.display === 'block') { detalle.style.display = 'none'; return; }
        detalle.style.display = 'block';
        if (cargado) return;
        cargado = true;
        detalle.textContent = 'Cargando equipos e historial…';
        detalle.style.cssText = 'font-size:12px;color:var(--text-secondary);border-top:1px solid var(--border);padding-top:11px';
        try {
          const res = await request(null, row.id);
          detalle.replaceChildren();
          const equiposTitulo = elemento('p', `Equipos vinculados (${(res.devices || []).length})`, detalle);
          equiposTitulo.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-faint);margin-bottom:6px';
          if ((res.devices || []).length === 0) elemento('p', 'Sin equipos vinculados todavía.', detalle).style.color = 'var(--text-secondary)';
          for (const d of res.devices || []) {
            const li = elemento('p', `Alta ${fechaLarga(d.created_at)} · último contacto ${d.last_seen_at ? fechaLarga(d.last_seen_at) : '—'}${d.revoked ? ' · REVOCADO' : ''}`, detalle);
            li.style.cssText = 'font-size:12px;color:' + (d.revoked ? color.warning : 'var(--text-secondary)');
          }
          const histTitulo = elemento('p', 'Historial de operaciones', detalle);
          histTitulo.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-faint);margin:12px 0 6px';
          const NOMBRES = { create: 'Creación', extend: 'Ampliación', suspend: 'Suspensión', resume: 'Reactivación', activation: 'Nuevo código', revoke: 'Revocación de equipos' };
          for (const a of res.audit || []) {
            elemento('p', `${NOMBRES[a.operation] || a.operation}${a.days ? ` (+${a.days} días)` : ''} · ${fechaLarga(a.created_at)}`, detalle).style.cssText = 'font-size:12px;color:var(--text-secondary)';
          }
        } catch (error) {
          detalle.textContent = `No se pudo cargar el detalle: ${error.message}`;
        }
      };
      return card;
    }

    function confirmar(padre, texto, alConfirmar) {
      const caja = elemento('div', '', padre);
      caja.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;width:100%;padding:9px 11px;border-radius:10px;border:1px solid ' + color.warning + '55;background:' + color.warning + '12';
      const aviso = elemento('span', texto, caja); aviso.style.cssText = 'font-size:12px;color:var(--text)';
      const si = boton('Sí, continuar', caja, 'btn btn-primary'); si.style.background = color.warning;
      const no = boton('Cancelar', caja, 'btn btn-secondary');
      no.onclick = () => caja.remove();
      si.onclick = () => { caja.remove(); alConfirmar(); };
      caja.scrollIntoView({ block: 'nearest' });
    }

    function eliminarConConfirmacion(card, row) {
      const caja = elemento('div', '', card);
      caja.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:11px;border-radius:11px;border:1px solid ' + color.danger + '66;background:' + color.danger + '10';
      const texto = elemento('p', `Eliminar es definitivo: se borra la licencia, sus equipos vinculados y su historial. Escribe el correo exacto (${row.email}) para confirmar.`, caja);
      texto.style.cssText = 'font-size:12px;color:var(--text);line-height:1.55';
      const linea = elemento('div', '', caja); linea.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
      const confirmacion = elemento('input', '', linea); confirmacion.placeholder = row.email; confirmacion.setAttribute('aria-label', 'Correo de confirmación');
      confirmacion.style.cssText = 'flex:1;min-width:200px;background:var(--input-bg);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:8px;font-size:12.5px';
      const si = boton('Eliminar definitivamente', linea, 'btn btn-primary'); si.style.background = color.danger;
      const no = boton('Cancelar', linea, 'btn btn-secondary');
      no.onclick = () => caja.remove();
      si.onclick = () => {
        if (confirmacion.value.trim().toLowerCase() !== String(row.email).toLowerCase()) { mostrarAviso('La confirmación no coincide con el correo de la licencia.', 'error'); return; }
        caja.remove();
        void mutar('delete', row.id, { confirmEmail: row.email });
      };
    }

    form.onsubmit = (event) => {
      event.preventDefault();
      void mutar('create', null, { name: nombre.value.trim(), email: email.value.trim().toLowerCase(), days: Number(dias.value), plan: plan.value });
    };
    refrescar.onclick = () => void cargar();

    async function cargar() {
      try {
        const resultado = await request();
        licencias = resultado.licenses || [];
        avisoPlan.style.display = resultado.planColumn === false ? 'block' : 'none';
        pintarLista();
      } catch (error) { mostrarAviso(error.message, 'error'); }
    }

    dialog.showModal();
    buscar.focus();
    await cargar();
  };
})();
