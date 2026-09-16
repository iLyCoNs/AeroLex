/* License administration only. No case files or desktop passwords. */
(() => {
  let dialog;
  const pending = new Map();
  function element(tag, text, parent) { const item = document.createElement(tag); if (text) item.textContent = text; if (parent) parent.append(item); return item; }
  async function request(body) {
    const response = await fetch('/api/licenses?action=admin', { method: body ? 'POST' : 'GET',
      headers: authHeaders({ 'Content-Type': 'application/json' }), ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'No se pudo consultar licencias.'); return data;
  }
  window.openDesktopLicenses = async () => {
    if (dialog) dialog.remove();
    dialog = element('dialog'); dialog.style.cssText = 'margin:auto;padding:24px;width:min(1080px,94vw);max-height:90vh;overflow:auto;background:#111827;color:#f3f4f6;border:1px solid #64748b;border-radius:16px';
    document.body.append(dialog);
    element('h2', 'Licencias de AeroLex de escritorio', dialog).style.cssText = 'font-size:22px;font-weight:bold';
    element('p', 'Crear acceso, ampliar días, suspender y revocar dispositivos. La aplicación consulta cambios cada 15 segundos y tolera hasta 24 horas sin conexión. Los expedientes y contraseñas permanecen locales.', dialog).style.margin = '12px 0';
    const close = element('button', 'Cerrar', dialog); close.className = 'btn btn-secondary'; close.onclick = () => dialog.close();
    const message = element('p', '', dialog); message.setAttribute('role', 'status'); message.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:16px 0;color:#93c5fd';
    const form = element('form', '', dialog); form.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin:16px 0';
    function field(label, type, value = '') { const wrapper = element('label', label, form); const input = element('input', '', wrapper); input.type = type; input.value = value; input.required = true; input.style.cssText = 'display:block;background:#1f2937;border:1px solid #64748b;padding:8px;border-radius:6px'; return input; }
    const name = field('Nombre del abogado', 'text'); name.maxLength = 160;
    const email = field('Correo de su cuenta local', 'email'); email.maxLength = 254;
    const days = field('Días de prueba', 'number', '7'); days.min = '1'; days.max = '3650';
    const create = element('button', 'Crear licencia y código', form); create.className = 'btn btn-primary'; create.type = 'submit';
    const refresh = element('button', 'Actualizar lista', dialog); refresh.className = 'btn btn-secondary'; refresh.onclick = () => void load();
    const table = element('div', '', dialog);
    let working = false;
    async function mutate(operation, id, extra = {}) {
      if (working) return;
      const key = JSON.stringify([operation, id, extra]);
      const previous = pending.get(key) || { requestId: crypto.randomUUID(), id: id || crypto.randomUUID() }; pending.set(key, previous);
      working = true; create.disabled = true; message.textContent = 'Guardando...';
      try {
        const result = await request({ operation, ...previous, ...extra }); pending.delete(key);
        message.textContent = result.activationCode ? `Código de activación (válido 7 días, un solo uso). Entrégalo únicamente al titular del correo:\n${result.activationCode}` : 'Cambio guardado. Se reflejará en la app conectada durante la siguiente verificación.';
        await load();
      } catch (error) { message.textContent = `${error.message} Si reintentas la misma operación, no se duplicará la ampliación.`; }
      finally { working = false; create.disabled = false; }
    }
    form.onsubmit = event => { event.preventDefault(); void mutate('create', null, { name: name.value.trim(), email: email.value.trim().toLowerCase(), days: Number(days.value) }); };
    async function load() {
      try {
        const result = await request(); table.replaceChildren();
        element('p', `${result.licenses.length} licencias (máximo mostrado: 1000)`, table).style.margin = '12px 0';
        for (const row of result.licenses) {
          const card = element('section', '', table); card.style.cssText = 'padding:16px;margin:10px 0;border:1px solid #475569;border-radius:10px';
          element('strong', row.display_name, card); element('p', row.email, card);
          element('p', `Estado: ${row.status} · Vence: ${new Date(row.expires_at).toLocaleString('es-CL')} · Revisión ${row.revision}`, card);
          const controls = element('div', '', card); controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px';
          const amount = element('input', '', controls); amount.type = 'number'; amount.min = '1'; amount.max = '3650'; amount.value = '7'; amount.setAttribute('aria-label', `Días adicionales para ${row.display_name}`); amount.style.cssText = 'width:80px;background:#1f2937;padding:6px';
          function button(label, action) { const btn = element('button', label, controls); btn.className = 'btn btn-secondary'; btn.onclick = action; }
          button('Añadir días', () => { const value = Number(amount.value); if (!Number.isInteger(value) || value < 1 || value > 3650) { message.textContent = 'Ingresa entre 1 y 3650 días.'; return; } void mutate('extend', row.id, { days: value }); });
          button(row.status === 'suspended' ? 'Reactivar' : 'Suspender', () => { if (confirm(`¿${row.status === 'suspended' ? 'Reactivar' : 'Suspender'} la licencia de ${row.email}?`)) void mutate(row.status === 'suspended' ? 'resume' : 'suspend', row.id); });
          button('Nuevo código', () => void mutate('activation', row.id));
          button('Revocar dispositivos', () => { if (confirm('¿Revocar los dispositivos vinculados? Para volver a conectar necesitarán un nuevo código. Sin internet, la última autorización puede durar hasta 24 horas.')) void mutate('revoke', row.id); });
        }
      } catch (error) { message.textContent = error.message; }
    }
    dialog.showModal(); await load();
  };
})();
