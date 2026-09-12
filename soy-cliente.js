/* AeroLex — Centro Legal del Cliente ("Soy Cliente")
 * Calculadoras referenciales (finiquito/despido y deuda de arriendo), captura de
 * prospectos con consentimiento, informe PDF instantáneo y puente al Bot Jurídico.
 * Legislación chilena citada: Código del Trabajo arts. 162, 163, 168, 172;
 * Ley 18.101 y Ley 21.461. Cálculo orientativo, no constituye asesoría.
 */
(function () {
  "use strict";

  var WHATSAPP = "56950129843";
  var UF_FALLBACK = 40000;
  var UF = 0;
  var lastCalc = { finiquito: null, arriendo: null };

  function $(id) { return document.getElementById(id); }
  function clp(n) {
    try { return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.max(0, Math.round(n || 0))); }
    catch (e) { return "$ " + Math.round(n || 0); }
  }
  function fecha(v) {
    if (!v) return "No indicada";
    var d = new Date(v + "T00:00:00");
    return isNaN(d.getTime()) ? "No indicada" : d.toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" });
  }
  function track(event, detail) {
    try { if (typeof AeroLexTelemetry !== "undefined" && AeroLexTelemetry.track) AeroLexTelemetry.track(event, detail); } catch (e) { /* telemetry is best-effort */ }
  }
  function progress(panel) {
    var fields = panel.querySelectorAll("input, select");
    var filled = 0;
    fields.forEach(function (f) { if (f.type === "checkbox" ? f.checked : String(f.value || "").trim()) filled++; });
    var pct = fields.length ? Math.round((filled / fields.length) * 100) : 0;
    var bar = $("alc-progress");
    if (bar) bar.style.width = pct + "%";
  }
  function loadUf() {
    fetch("https://mindicador.cl/api/uf").then(function (r) { return r.json(); }).then(function (d) {
      var v = d && d.serie && d.serie[0] && Number(d.serie[0].valor);
      if (v > 0) UF = v;
    }).catch(function () { /* fallback below */ }).then(function () {
      if (!UF) UF = UF_FALLBACK;
    });
  }
  loadUf();

  /* jsPDF se carga solo al primer informe: mantiene liviana la página para SEO. */
  var jspdfPromise = null;
  function ensureJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (jspdfPromise) return jspdfPromise;
    jspdfPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      script.onload = function () {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error("jsPDF no disponible"));
      };
      script.onerror = function () { reject(new Error("No se pudo cargar el generador de PDF")); };
      document.head.appendChild(script);
    });
    return jspdfPromise;
  }
  document.addEventListener("input", function (e) {
    var panel = e.target.closest ? e.target.closest('[id^="alc-panel-"]') : null;
    if (panel && !panel.classList.contains("hidden")) progress(panel);
  });

  /* ── Pestañas ─────────────────────────────────────────────── */
  window.openCalcTab = function (tab) {
    ["finiquito", "arriendo", "plazos"].forEach(function (name) {
      var panel = $("alc-panel-" + name);
      var link = $("alc-tab-" + name);
      if (panel) panel.classList.toggle("hidden", name !== tab);
      if (link) link.classList.toggle("active", name === tab);
    });
    var active = $("alc-panel-" + tab);
    if (active) progress(active);
    track("calc_start", "Calculadora abierta: " + tab);
  };

  window.irAAsistentePlazos = function () {
    var target = document.getElementById("herramientas");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    track("calc_step", "Abrió asistente de plazos legales");
  };

  window.abrirMiCausa = function () {
    var code = ($("alc-case-code") && $("alc-case-code").value || "").trim().toUpperCase().replace(/^AXL-/, "ALX-");
    var pin = ($("alc-case-pin") && $("alc-case-pin").value || "").trim();
    if (!code) { alert("Ingrese el código de su expediente, por ejemplo ALX-2026-01."); return; }
    if (!/^\d{4}$/.test(pin)) { alert("Ingrese el PIN de 4 dígitos que le entregó su abogado."); return; }
    track("case_check", "Consulta expediente " + code);
    if (typeof window.openPortalTracking === "function") window.openPortalTracking(code, pin);
    else window.location.hash = "#portal";
  };

  /* ── Cálculo laboral (finiquito y despido) ────────────────── */
  function businessDaysLeft(fromISO) {
    var start = new Date(fromISO + "T00:00:00");
    if (isNaN(start.getTime())) return null;
    var d = new Date(start.getTime());
    var counted = 0;
    var limit = new Date(d.getTime());
    while (counted < 60) {
      limit.setDate(limit.getDate() + 1);
      if (limit.getDay() !== 0) counted++; /* lunes a sábado, referencial */
    }
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var rest = 0;
    var cursor = new Date(today.getTime());
    while (cursor <= limit && rest < 200) {
      if (cursor.getDay() !== 0) rest++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return { limit: limit, rest: Math.max(0, rest - 1) };
  }

  window.calcFiniquito = function () {
    var inicio = $("fin-inicio").value;
    var termino = $("fin-termino").value;
    var sueldo = Number($("fin-sueldo").value) || 0;
    var causal = $("fin-causal").value;
    var aviso = $("fin-aviso").value;
    var feriado = Number($("fin-feriado").value) || 0;
    var otros = Number($("fin-otros").value) || 0;
    if (!inicio || !termino || sueldo <= 0) {
      alert("Complete la fecha de inicio, la fecha de término y el sueldo bruto para calcular.");
      return;
    }
    var di = new Date(inicio + "T00:00:00");
    var dt = new Date(termino + "T00:00:00");
    if (isNaN(di.getTime()) || isNaN(dt.getTime()) || dt <= di) { alert("Revise las fechas: la fecha de término debe ser posterior al inicio."); return; }

    var years = dt.getFullYear() - di.getFullYear();
    var months = dt.getMonth() - di.getMonth();
    if (dt.getDate() < di.getDate()) months--;
    if (months < 0) { years--; months += 12; }
    var serviceYears = years + (months > 6 ? 1 : 0);
    if (serviceYears < 1 && (years > 0 || months > 0)) serviceYears = months > 6 ? 1 : 0;
    var base = UF > 0 ? Math.min(sueldo, 90 * UF) : sueldo;
    var indemn = 0;
    if (causal === "161" || causal === "sin_causa" || causal === "no_se") {
      indemn = serviceYears <= 11 ? serviceYears * base : 11 * base + (serviceYears - 11) * base;
      if (causal === "no_se") indemn = Math.max(indemn, serviceYears <= 11 ? serviceYears * base : 11 * base + (serviceYears - 11) * base);
    }
    var recargoMin = 0, recargoMax = 0;
    if (causal === "sin_causa") { recargoMin = 0.3; recargoMax = 0.5; }
    if (causal === "no_se") { recargoMin = 0.3; recargoMax = 0.5; }
    var avisoMonto = ((causal === "161" || causal === "sin_causa" || causal === "no_se") && aviso !== "si") ? sueldo : 0;
    var feriadoMonto = feriado > 0 ? Math.round(feriado * sueldo / 30) : 0;
    var totalMin = indemn + Math.round(indemn * recargoMin) + avisoMonto + feriadoMonto + otros;
    var totalMax = indemn + Math.round(indemn * recargoMax) + avisoMonto + feriadoMonto + otros;
    if (totalMax < totalMin) totalMax = totalMin;

    var term = businessDaysLeft(termino);
    var urgencia = term ? (term.rest <= 0 ? "Su plazo de reclamo aparece vencido según este cálculo referencial: consúltelo de inmediato." : "Le quedarían aproximadamente " + term.rest + " días hábiles para reclamar (hasta el " + fecha(term.limit.toISOString().slice(0, 10)) + ").") : "";

    lastCalc.finiquito = {
      tipo: "Finiquito y despido",
      casos: [
        ["Antigüedad reconocida", serviceYears + " año(s)"],
        ["Indemnización por años de servicio", clp(indemn)],
        [causal === "sin_causa" ? "Recargo Art. 168 (30%-50%)" : causal === "no_se" ? "Recargo eventual Art. 168 (30%-50%)" : "Sin recargo por causal invocada", causal === "sin_causa" || causal === "no_se" ? clp(indemn * recargoMin) + " a " + clp(indemn * recargoMax) : "—"],
        ["Aviso previo (1 mes)", avisoMonto ? clp(avisoMonto) : "Ya fue avisado o no aplica"],
        ["Feriado proporcional", feriadoMonto ? clp(feriadoMonto) : "Sin días pendientes informados"],
        ["Sueldos u otros pendientes", otros ? clp(otros) : "—"]
      ],
      totalMin: totalMin,
      totalMax: totalMax,
      urgencia: urgencia,
      detalle: "Inicio " + fecha(inicio) + " · Término " + fecha(termino) + " · Sueldo " + clp(sueldo) + " · Causal " + ($("fin-causal").selectedOptions[0] ? $("fin-causal").selectedOptions[0].textContent : causal)
    };
    renderCalcResult("finiquito");
    track("calculator_use", "Finiquito: " + lastCalc.finiquito.detalle + " => " + clp(totalMin) + " a " + clp(totalMax));
  };

  /* ── Cálculo arriendo ─────────────────────────────────────── */
  window.calcArriendo = function () {
    var renta = Number($("arr-renta").value) || 0;
    var meses = Number($("arr-meses").value) || 0;
    var garantia = Number($("arr-garantia").value) || 0;
    var contrato = $("arr-contrato").value;
    if (renta <= 0 || meses <= 0) { alert("Indique la renta mensual y los meses impagos."); return; }
    var deuda = renta * meses;
    var total = deuda + garantia;
    lastCalc.arriendo = {
      tipo: "Deuda de arriendo",
      casos: [
        ["Rentas impagas (" + meses + " mes/es)", clp(deuda)],
        ["Garantía o depósito retenido", garantia ? clp(garantia) : "—"],
        ["Reajuste IPC", "No incluido en esta estimación referencial"]
      ],
      totalMin: total,
      totalMax: total,
      urgencia: contrato === "no" ? "Sin contrato escrito: la Ley 21.461 permite igualmente reclamar con otros antecedentes (transferencias, mensajes, testigos)." : "Con contrato escrito puede solicitarse la restitución y el pago en la vía de la Ley 18.101/21.461.",
      detalle: "Renta " + clp(renta) + " · " + meses + " mes(es) impagos" + (garantia ? " · garantía " + clp(garantia) : "") + " · contrato escrito: " + (contrato === "si" ? "sí" : contrato === "no" ? "no" : "no informado")
    };
    renderCalcResult("arriendo");
    track("calculator_use", "Arriendo: " + lastCalc.arriendo.detalle + " => " + clp(total));
  };

  /* ── Resultado + captura ──────────────────────────────────── */
  function renderCalcResult(kind) {
    var data = lastCalc[kind];
    var box = $("alc-result-" + kind);
    if (!data || !box) return;
    var rango = data.totalMin === data.totalMax ? clp(data.totalMin) : clp(data.totalMin) + " a " + clp(data.totalMax);
    var waText = encodeURIComponent("Hola AeroLex: usé la calculadora de " + data.tipo + " en su sitio. Estimación: " + rango + ". " + data.detalle + ". Quiero revisar mi caso.");
    box.innerHTML =
      '<div class="alc-result p-5 md:p-6 fade-in">' +
        '<div class="flex flex-wrap items-center justify-between gap-2 mb-3">' +
          '<span class="alc-chip"><i class="fas fa-calculator"></i> Estimación referencial</span>' +
          '<span class="text-[11px] text-gray-400">Actualizado ' + new Date().toLocaleDateString("es-CL") + '</span>' +
        '</div>' +
        '<p class="text-[12px] font-bold text-gray-500 uppercase tracking-wider">' + data.tipo + ' — monto estimado</p>' +
        '<div class="alc-big text-emerald-700 my-2">' + rango + '</div>' +
        '<div class="my-4">' +
          data.casos.map(function (row) {
            return '<div class="alc-row"><span class="text-gray-500">' + row[0] + '</span><strong class="text-mac-dark text-right">' + row[1] + '</strong></div>';
          }).join("") +
        '</div>' +
        (data.urgencia ? '<div class="p-3.5 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-[12.5px] leading-relaxed mb-3"><i class="fas fa-clock mr-1.5"></i>' + data.urgencia + '</div>' : "") +
        '<p class="text-[10.5px] text-gray-400 leading-relaxed mb-4">Cálculo orientativo con la legislación chilena vigente citada. No constituye asesoría jurídica, no garantiza resultados y los montos finales dependen de los antecedentes y del tribunal. UF referencial usada: ' + (UF ? clp(UF) : "valor local") + '.</p>' +
        '<div class="p-4 rounded-2xl border border-gray-200 bg-white">' +
          '<p class="text-[13.5px] font-black text-mac-dark mb-1"><i class="fas fa-file-pdf text-red-500 mr-1.5"></i>Su informe PDF sin costo</p>' +
          '<p class="text-[11.5px] text-gray-500 mb-3">Complete sus datos y descargue el informe con la estimación, los artículos aplicables y el siguiente paso. Sin compromiso.</p>' +
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' +
            '<input id="alc-lead-nombre" class="alc-field" placeholder="Su nombre">' +
            '<input id="alc-lead-fono" class="alc-field" inputmode="tel" placeholder="Su WhatsApp (+56 9 ...)">' +
          '</div>' +
          '<label class="flex items-start gap-2 mt-3 text-[11px] text-gray-500 leading-relaxed"><input id="alc-lead-consent" type="checkbox" class="mt-0.5"> Autorizo a AeroLex a usar estos datos únicamente para preparar mi informe y contactarme por mi consulta.</label>' +
          '<div class="flex flex-col sm:flex-row gap-2.5 mt-3.5">' +
            '<button type="button" class="alc-cta flex-1" onclick="alcDescargarPDF(\'' + kind + '\')"><i class="fas fa-file-pdf"></i> Descargar mi informe PDF</button>' +
            '<a class="flex-1 rounded-2xl bg-[#25D366] text-white font-black py-3.5 flex items-center justify-center gap-2 hover:bg-[#1fa855] transition" target="_blank" rel="noopener" href="https://wa.me/' + WHATSAPP + '?text=' + waText + '" onclick="alcRegistrarContacto(\'' + kind + '\')"><i class="fab fa-whatsapp text-lg"></i> Enviar por WhatsApp</a>' +
          '</div>' +
          '<p id="alc-lead-status" class="text-[11px] text-gray-400 mt-2.5 hidden"></p>' +
        '</div>' +
      '</div>';
    track("calc_result", data.tipo + ": " + rango);
  }

  function leadPayload(kind) {
    var data = lastCalc[kind];
    var nombre = ($("alc-lead-nombre") && $("alc-lead-nombre").value || "").trim();
    var fono = ($("alc-lead-fono") && $("alc-lead-fono").value || "").trim();
    var consent = $("alc-lead-consent") && $("alc-lead-consent").checked;
    return { nombre: nombre, fono: fono, consent: consent, data: data };
  }
  function requireLead(kind) {
    var lead = leadPayload(kind);
    var status = $("alc-lead-status");
    if (!lead.nombre || !lead.fono) { if (status) { status.textContent = "Indique su nombre y su WhatsApp para preparar el informe."; status.classList.remove("hidden"); } return null; }
    if (!lead.consent) { if (status) { status.textContent = "Marque la autorización para usar sus datos en su informe."; status.classList.remove("hidden"); } return null; }
    if (status) status.classList.add("hidden");
    return lead;
  }
  window.alcRegistrarContacto = function (kind) {
    var lead = requireLead(kind);
    if (!lead) return;
    var data = lead.data;
    var rango = data.totalMin === data.totalMax ? clp(data.totalMin) : clp(data.totalMin) + " a " + clp(data.totalMax);
    var mensaje = data.tipo + " — estimación " + rango + ". " + data.detalle + ".";
    track("calc_lead", data.tipo + " | " + mensaje);
    fetch("/api/wa-contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "calculadora", topic: "Calculadora " + data.tipo, clientName: lead.nombre, phone: lead.fono, message: mensaje })
    }).catch(function () { /* el lead también queda en telemetría */ });
  };
  window.alcDescargarPDF = async function (kind) {
    var lead = requireLead(kind);
    if (!lead) return;
    var data = lead.data;
    var rango = data.totalMin === data.totalMax ? clp(data.totalMin) : clp(data.totalMin) + " a " + clp(data.totalMax);
    track("calc_lead", data.tipo + " PDF | " + rango);
    fetch("/api/wa-contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "calculadora_pdf", topic: "Calculadora " + data.tipo, clientName: lead.nombre, phone: lead.fono, message: data.tipo + " — estimación " + rango + ". " + data.detalle + "." })
    }).catch(function () { /* best-effort */ });
    try {
      var mod = await ensureJsPDF();
      var doc = new mod({ unit: "mm", format: "a4" });
      var W = 210, M = 18, y = 0;
      doc.setFillColor(29, 29, 31); doc.rect(0, 0, W, 30, "F");
      doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(17);
      doc.text("AEROLEX", M, 13);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
      doc.text("Informe referencial de calculadora legal · Puerto Montt, Región de Los Lagos", M, 20);
      doc.text("aerolex.cl · WhatsApp +56 9 5012 9843", M, 25);
      y = 42; doc.setTextColor(29, 29, 31);
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.text(data.tipo, M, y); y += 8;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      doc.text("Preparado para: " + lead.nombre + " · " + new Date().toLocaleDateString("es-CL"), M, y); y += 10;
      doc.setFillColor(240, 253, 244); doc.roundedRect(M, y - 5, W - M * 2, 18, 3, 3, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(21, 128, 61);
      doc.text("Estimación: " + rango, M + 5, y + 6); y += 26;
      doc.setTextColor(29, 29, 31); doc.setFontSize(10);
      data.casos.forEach(function (row) {
        doc.setFont("helvetica", "bold"); doc.text(String(row[0]).slice(0, 62), M, y);
        doc.setFont("helvetica", "normal"); doc.text(String(row[1]).slice(0, 40), W - M, y, { align: "right" });
        y += 7;
      });
      y += 3;
      if (data.urgencia) {
        doc.setFont("helvetica", "bold"); doc.text("Plazo:", M, y); y += 5;
        doc.setFont("helvetica", "normal");
        doc.splitTextToSize(data.urgencia, W - M * 2 - 4).forEach(function (line) { doc.text(line, M + 4, y); y += 5; });
        y += 4;
      }
      doc.setFont("helvetica", "bold"); doc.text("Base legal aplicada", M, y); y += 5.5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      ["Código del Trabajo, artículos 162 (aviso previo), 163 (indemnización por años de servicio), 168 (recargos) y 172 (tope de 90 UF).",
       "Ley 18.101 y Ley 21.461 para juicios de arrendamiento y restitución del inmueble.",
       "Datos: " + data.detalle + "."].forEach(function (line) {
        doc.splitTextToSize(line, W - M * 2).forEach(function (l) { doc.text(l, M, y); y += 4.6; });
      });
      y += 5;
      doc.setTextColor(120, 120, 120); doc.setFontSize(8.4);
      doc.splitTextToSize("Este informe es orientativo y no constituye asesoría jurídica ni garantiza resultados. Los montos dependen de los antecedentes, del contrato y de lo que resuelva el tribunal competente. Para una evaluación definitiva, un abogado de AeroLex debe revisar su caso.", W - M * 2).forEach(function (l) { doc.text(l, M, y); y += 4; });
      doc.save("AeroLex-Informe-" + kind + ".pdf");
    } catch (e) {
      alert("No se pudo generar el PDF en este navegador. Su informe queda registrado y un abogado puede enviárselo.");
    }
  };

  /* Abandono: útil para saber dónde se pierde el prospecto */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      var done = lastCalc.finiquito || lastCalc.arriendo;
      var leadName = $("alc-lead-nombre") && $("alc-lead-nombre").value;
      if (done && !leadName) track("calc_abandon", "Abandonó tras resultado: " + done.tipo);
    }
  });
})();
