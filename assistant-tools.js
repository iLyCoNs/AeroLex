/* Contextual bridge to chatbotAD's public VibeCopilot API. No credentials or form scraping. */
(function () {
  'use strict';
  const contexts = new Map();
  let pending = false;
  const topics = {
    urgencia: {
      title: 'Entender una notificación o urgencia',
      help: 'Tenga a mano el documento y la fecha en que lo recibió. Para comenzar, identifique quién lo envió y qué le solicita. No necesita un código de expediente.',
      prompt: 'Hola, acabo de recibir una notificación judicial urgente y necesito orientación para saber qué hacer y qué plazos tengo.'
    },
    consulta: {
      title: 'Cuénteme qué le preocupa',
      help: 'Puede describir lo ocurrido con sus propias palabras. No hace falta conocer el nombre de la acción judicial ni ser cliente del estudio.',
      prompt: 'Hola, quisiera orientación legal sobre una situación que me ocurrió. ¿Me podrían orientar en palabras sencillas?'
    },
    finiquito: {
      title: 'Ayuda con mi finiquito',
      help: 'La calculadora necesita las fechas de trabajo, el sueldo bruto y la forma en que terminó el contrato. Su resultado es una estimación, no una suma garantizada.',
      prompt: 'Hola, estoy revisando el cálculo de mi finiquito laboral en la calculadora y tengo dudas sobre las indemnizaciones que me corresponden.'
    },
    arriendo: {
      title: 'Ayuda con una deuda de arriendo',
      help: 'Comience con la renta mensual y los meses impagos. Los depósitos, pagos parciales y reajustes deben revisarse por separado con el contrato.',
      prompt: 'Hola, necesito orientación sobre una deuda o cobro de arriendo y la restitución del inmueble bajo la ley de arriendo.'
    },
    plazos: {
      title: 'Entender un plazo legal',
      help: 'El plazo depende de lo ocurrido, del procedimiento y de cómo se recibió una notificación. La fecha calculada en la página debe ser revisada antes de actuar.',
      prompt: 'Hola, necesito saber qué plazo legal tengo para responder o ejercer acciones en mi caso.'
    },
    glosario: {
      title: 'Entender una palabra legal',
      help: 'Escriba la palabra que no entiende. Puede pedir una explicación sencilla y un ejemplo de uso.',
      prompt: 'Hola, tengo dudas con el significado de un término legal que aparece en mis antecedentes jurídicos.'
    },
    indicadores: {
      title: 'Entender UF y UTM',
      help: 'UF y UTM son unidades de referencia. Revise qué unidad y fecha exige su documento antes de convertir el monto a pesos.',
      prompt: 'Hola, necesito ayuda para calcular montos fijados en UF o UTM según la fecha correspondiente.'
    }
  };

  function ready() {
    return window.VibeCopilot &&
      typeof VibeCopilot.open === 'function' &&
      typeof VibeCopilot.sendMessage === 'function' &&
      document.getElementById('vibe-drawer');
  }

  const dialog = document.createElement('dialog');
  dialog.id = 'assistant-connection';
  dialog.setAttribute('aria-labelledby', 'assistant-connection-title');
  dialog.innerHTML = '<div class="assistant-connection-head"><strong>Asistente AeroLex</strong><button type="button" data-close aria-label="Cerrar ayuda">Cerrar</button></div><h2 id="assistant-connection-title"></h2><p data-help></p><p data-status role="status" aria-live="polite"></p><div class="assistant-connection-actions"><button type="button" data-retry>Volver a conectar</button><a href="https://wa.me/56950129843" target="_blank" rel="noopener">Consultar por WhatsApp</a></div>';
  document.body.appendChild(dialog);
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  let retryTopic = 'consulta';
  dialog.querySelector('[data-retry]').onclick = () => { dialog.close(); window.AeroLexHelp.open(retryTopic); };

  async function open(topic) {
    if (pending) return;
    const context = contexts.get(topic) || topics[topic] || topics.consulta;
    retryTopic = topic;
    pending = true;

    const legacy = document.getElementById('ai-modal');
    if (legacy && legacy.open) legacy.close();

    // Si el chatbot ya está cargado y listo en pantalla, abrirlo de inmediato sin modal intermedio
    if (ready()) {
      try {
        VibeCopilot.open();
        await VibeCopilot.sendMessage(context.prompt);
      } finally {
        pending = false;
      }
      return;
    }

    // Si aún está descargando, mostrar modal informativo con espera
    dialog.querySelector('h2').textContent = context.title;
    dialog.querySelector('[data-help]').textContent = context.help;
    dialog.querySelector('[data-status]').textContent = 'Conectando con el asistente…';
    dialog.querySelector('[data-retry]').hidden = true;
    if (!dialog.open) dialog.showModal();

    try {
      for (let i = 0; i < 25 && !ready() && dialog.open; i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!dialog.open) return;
      if (!ready()) throw new Error('unavailable');
      dialog.close();
      VibeCopilot.open();
      await VibeCopilot.sendMessage(context.prompt);
    } catch (_) {
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('[data-status]').textContent = 'No pudimos abrir el chat en este momento. Puede seguir las indicaciones, volver a intentar o contactar directo a nuestro WhatsApp.';
      dialog.querySelector('[data-retry]').hidden = false;
    } finally {
      pending = false;
    }
  }

  function result(target, key, title, summary) {
    if (!target) return;
    const previous = target.querySelector('.assistant-result-help');
    if (previous) previous.remove();

    contexts.set(key, {
      title: 'Entender mi resultado: ' + title,
      help: 'Este resultado es una estimación referencial. El asistente virtual le explicará qué significa y qué antecedentes deben revisarse.',
      prompt: 'Hola, acabo de calcular una estimación en la calculadora de AeroLex (' + title + '): ' + String(summary).slice(0, 300) + '. ¿Me podrías explicar en palabras sencillas qué significa este resultado y qué debo considerar?'
    });

    const box = document.createElement('div');
    box.className = 'assistant-result-help';
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = '<i class="fas fa-robot mr-1.5" aria-hidden="true"></i> Explícame este cálculo con IA →';
    button.onclick = () => open(key);
    const text = document.createElement('p');
    text.textContent = 'Al pulsar, el asistente virtual le explicará el desglose en lenguaje claro. No se envían datos personales.';
    box.append(button, text);
    target.appendChild(box);
  }

  function service(title) {
    const safeTitle = String(title || 'Consulta jurídica').slice(0, 150);
    contexts.set('servicio', {
      title: safeTitle,
      help: 'El asistente puede explicarle en qué consiste este servicio y qué antecedentes conviene tener listos.',
      prompt: 'Hola, quisiera información y orientación sobre el servicio de ' + safeTitle + ' en Puerto Montt.'
    });
    return open('servicio');
  }

  window.AeroLexHelp = { open, result, service };

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-assistant-topic]');
    if (button) {
      event.preventDefault();
      open(button.dataset.assistantTopic);
    }
  });
})();
