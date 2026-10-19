# AeroLex: captación local — 19 de octubre de 2026

## Punto de partida

Datos aportados por el propietario en Search Console:

- 18 de septiembre a 18 de octubre: 299 impresiones, 5 clics, CTR 1,7 %, posición media agregada 8,7.
- 10 a 16 de octubre, consulta «abogado puerto montt»: 2 impresiones, 0 clics, posición media 5; las impresiones se concentran el 13 de octubre.
- En esa misma semana, «abogados puerto montt»: 8 impresiones y 0 clics.
- La portada figura indexada. Los clics podrían incluir pruebas del propietario. No equivalen a clientes ni personas únicas.

No hay evidencia suficiente para atribuir la baja visibilidad a una penalización, bloqueo técnico o causa única. La posición media se calcula sobre las impresiones; no representa todas las búsquedas del mercado.

## Cambios de esta entrega

- Estilos públicos compilados y servidos desde el propio dominio en siete páginas; se elimina la compilación de Tailwind en cada navegador.
- Contacto directo por WhatsApp y teléfono en la portada; acceso a especialidades desde la primera sección.
- Título y descripción centrados en los servicios y ubicación, sin afirmar liderazgo ni atención humana permanente.
- Identidad de negocio en los datos estructurados sin usar búsquedas genéricas como nombres alternativos.
- Preparación de consulta específica en las seis páginas de servicios y enlace visible al equipo.
- Corrección de compensación económica y cuidado compartido en texto visible y datos estructurados de familia, con fuentes legales.
- Sitemap actualizado por cambios reales, sin prometer frecuencia de rastreo.

## Siguiente trabajo con el Perfil de Empresa

No se ha accedido a su administración ni se han modificado categorías, reseñas o fotografías. Antes de cambiarlo, comprobar la ficha existente para no crear duplicados.

1. Comprobar categoría principal, servicios, teléfono, horario y dirección reales. Mantener el nombre comercial real; no añadir palabras clave artificiales al nombre.
2. Enlazar cada servicio a su página específica cuando la ficha admita ese enlace. Usar la portada como sitio principal.
3. Añadir fotos reales y actuales del acceso a la oficina, placa, espacio de atención y equipo, con autorización de las personas retratadas. No inventar testimonios ni oficinas.
4. Solicitar reseñas honestas a clientes reales de forma neutral, sin incentivos ni selección exclusiva de clientes satisfechos. No revelar detalles de sus causas al responder.
5. Buscar menciones y enlaces pertinentes en entidades o asociaciones con las que el estudio tenga una relación real. No comprar paquetes de enlaces.

## Medición y decisión

Comparar períodos de 28 días y usar 7 días solo como señal temprana. Separar consultas de marca, genéricas locales y por especialidad. Filtrar Chile y comparar móvil/escritorio cuando haya volumen suficiente.

Registrar semanalmente: impresiones, clics y página de destino por consulta; consultas recibidas por WhatsApp/teléfono; reuniones agendadas; contrataciones. Preguntar cómo conocieron al estudio y excluir las pruebas propias de la cuenta comercial. No guardar detalles sensibles de causas en herramientas de analítica.

Si crecen impresiones sin clics, revisar consulta, posición y presentación del resultado. Si llegan visitas sin consultas, revisar propuesta, contacto y claridad de honorarios. Si hay consultas sin contrataciones, revisar atención, calificación y propuesta de servicios. No inferir un problema de CTR con solo dos impresiones.

Una vez publicado: comprobar las URLs en Search Console y solicitar un nuevo rastreo de la portada y las páginas prioritarias modificadas. No repetir solicitudes diariamente. No se ha enviado ninguna solicitud desde esta entrega.

No se han activado anuncios ni comprometido presupuesto. Si se decide usar Ads para captación inmediata, requiere presupuesto explícito, segmentación local y medición de consultas reales; no mejora por sí solo la posición orgánica.

## Mantenimiento

Después de cambiar clases de las páginas públicas: `npm ci`, `npm run build`, `npm run test:seo`. Vercel ejecuta la compilación al desplegar. El CSS generado también se conserva en el repositorio.

Prueba de navegador opcional: `node scripts/seo-browser-check.cjs`, con Playwright disponible y Microsoft Edge instalado. Usa servidor local y bloquea conexiones externas; comprueba las siete páginas en móvil y escritorio y la apertura del asistente. No sustituye la comprobación de fuentes, iconos o integraciones externas en producción.

## Referencias

- Google, posicionamiento local: https://support.google.com/business/answer/7091?hl=es
- Google, contenido útil: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google, datos de negocio: https://developers.google.com/search/docs/appearance/structured-data/local-business
- Tailwind, CDN de desarrollo: https://v3.tailwindcss.com/docs/installation/play-cdn
- Ley 19.947, artículo 64: https://www.bcn.cl/leychile/navegar?idNorma=225128
- Ley 20.680: https://www.bcn.cl/leychile/navegar?idNorma=1052090
