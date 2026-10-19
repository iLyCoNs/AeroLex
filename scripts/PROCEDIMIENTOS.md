# Hitos según procedimiento chileno

Revisión de fuentes: 18 de octubre de 2026.

El catálogo `procedures.js` es compartido por administración, portal y API. Las
rutas describen una secuencia de referencia, no acreditan actuaciones ni fijan
plazos. El abogado selecciona el procedimiento concreto y adapta los hitos a las
resoluciones del expediente. Materias genéricas como «Laboral» o «Civil» no bastan
para decidir entre aplicación general, monitorio, ejecutivo u ordinario.

## Fuentes oficiales

- [Código del Trabajo](https://www.bcn.cl/leychile/navegar?idNorma=207436):
  aplicación general (446–462), tutela (485–495), monitorio (496–502).
- [Ley 19.968](https://www.bcn.cl/leychile/navegar?idNorma=229557): ordinario
  de familia (55–67), protección (68–80), VIF (81–101), mediación (106–111).
- [Código de Procedimiento Civil](https://www.bcn.cl/leychile/navegar?idNorma=22740):
  ordinario de mayor cuantía (Libro II), menor cuantía (698–702), sumario
  (680–692), ejecutivo de obligación de dar (434–529).
- [Ley 18.101](https://www.bcn.cl/leychile/navegar?i=29526): procedimiento
  declarativo de arrendamiento (7–8) y monitorio (18-A–18-K).
- ChileAtiende: [posesión efectiva intestada](https://www.chileatiende.gob.cl/fichas/3364)
  y [posesión efectiva judicial](https://www.chileatiende.gob.cl/fichas/4722).

## Decisiones funcionales

- El siguiente hito registrado tiene prioridad sobre cualquier sugerencia.
- Sin un próximo hito registrado, el portal muestra una sugerencia expresamente
  «por confirmar». Las actuaciones condicionales indican «si corresponde».
- Las sugerencias continúan desde el último hito reconocido. No saltan pasos
  condicionales. Tras el resultado de mediación, no se presupone demanda: puede
  haber un acuerdo. El abogado elige la continuación que corresponda.
- La redacción de una demanda existente permite sugerir su presentación incluso
  si falta seleccionar el subtipo procesal. No se infieren audiencias de la
  simple etiqueta «Laboral» ni ejecución civil del término «cobro».
- Recursos, cautelares, reconvenciones, incidentes, acuerdos y actuaciones
  paralelas se agregan o reordenan manualmente. La línea de tiempo no sustituye
  las bifurcaciones de un expediente real.
- Otros procedimientos —por ejemplo mínima cuantía, penal, recursos
  constitucionales o procedimientos administrativos— utilizan la opción
  personalizada; no se reconducen automáticamente a un ordinario civil.
- Las altas incluyen recepción y revisión. No crean una lista de actuaciones
  judiciales como si fueran hechos confirmados. Una fecha nueva queda vacía
  hasta que se registre una fecha real o fijada.
- Cambiar el procedimiento no reemplaza hitos, fechas ni estados existentes.
- No hay sugerencias de continuación para causas suspendidas o finalizadas.

## Persistencia y compatibilidad

`procedimiento` se guarda con la convención existente de metadatos reservados en
`triage`: `__PROCEDIMIENTO__:<id>`. No requiere una columna nueva en Supabase.
La API administrativa valida el identificador y conserva los otros metadatos.
La consulta del cliente devuelve solo el identificador, nunca el `triage` privado.
Los expedientes anteriores siguen funcionando sin metadatos de procedimiento.

Publicar juntos `procedures.js`, ambos HTML y ambas API. Los expedientes
existentes no se migran ni se clasifican automáticamente al desplegar.

## Comprobaciones

```text
node scripts/test-procedures.cjs
node scripts/test-milestones.cjs
node scripts/fase1-test.cjs
```

Cubren diferenciación de rutas, mediación, audiencias del monitorio, sugerencias,
prioridad de hitos registrados, persistencia administrativa, consulta del cliente,
protección del triage, compatibilidad de los estados y sintaxis de los HTML.
