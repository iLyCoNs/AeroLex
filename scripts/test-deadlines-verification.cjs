const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  let file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (!path.extname(file)) file += '.html';
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png'
  })[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;

  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });

    console.log('Navigating to AeroLex home...');
    await page.goto(base);

    // Scroll to #herramientas
    console.log('Verifying #herramientas section...');
    const herramientas = page.locator('#herramientas');
    await herramientas.scrollIntoViewIfNeeded();
    await herramientas.waitFor({ state: 'visible' });

    // 1. Verificar pestaña "Situaciones & Plazos Fatales"
    const tabPlazos = page.locator('.tool-navigation button.active');
    const tabText = await tabPlazos.innerText();
    console.log('Tab activo:', tabText);
    assert(tabText.includes('Situaciones & Plazos Fatales'), 'Tab includes Situaciones & Plazos Fatales');

    // 2. Verificar que las tarjetas de situación tienen badge de plazo
    const cards = page.locator('#event-grid .event-card');
    const cardCount = await cards.count();
    console.log(`Encontradas ${cardCount} tarjetas en Paso 1.`);
    assert.equal(cardCount, 16, 'Debe haber 16 situaciones legales');

    const firstCardText = await cards.first().innerText();
    console.log('Texto primera tarjeta:', firstCardText.replace(/\n+/g, ' | '));
    assert(firstCardText.toLowerCase().includes('plazo fatal') || firstCardText.toLowerCase().includes('días'), 'La tarjeta debe mostrar el plazo legal');

    // Captura de pantalla de Paso 1
    await page.screenshot({ path: path.resolve(root, 'deadlines-step1-cards.png') });
    console.log('Captura Paso 1 guardada: deadlines-step1-cards.png');

    // 3. Probar filtro por categoría "Laboral"
    console.log('Probando filtro Laboral...');
    await page.locator('#event-cat-filters button:has-text("Laboral")').click();
    await page.waitForTimeout(200);
    const laboralCount = await page.locator('#event-grid .event-card').count();
    console.log(`Tarjetas laborales mostradas: ${laboralCount}`);
    assert.equal(laboralCount, 2, 'Debe haber 2 situaciones laborales');

    // Probar búsqueda rápida
    console.log('Probando búsqueda rápida "arriendo"...');
    await page.locator('#event-search').fill('arriendo');
    await page.waitForTimeout(200);
    // Como estaba filtrado por laboral, arriendo no coincide, debe mostrar 0 o aviso
    console.log('Restableciendo a todas las materias...');
    await page.locator('#event-cat-filters button:has-text("Todas")').click();
    await page.locator('#event-search').fill('arriendo');
    await page.waitForTimeout(200);
    const searchCount = await page.locator('#event-grid .event-card').count();
    console.log(`Tarjetas que coinciden con "arriendo": ${searchCount}`);
    assert(searchCount >= 1, 'Debe encontrar la tarjeta de arriendo');

    // Limpiar búsqueda
    await page.locator('#event-search').fill('');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#event-grid .event-card').count(), 16);

    // 4. Seleccionar una situación (Despido / Laboral) y pasar al Paso 2
    console.log('Seleccionando situación de despido laboral...');
    await page.locator('#event-grid .event-card:has-text("Perdí mi trabajo")').click();
    await page.waitForTimeout(300);

    // Verificar Paso 2
    assert.equal(await page.locator('#deadline-actions').isVisible(), true, 'Paso 2 debe estar visible');
    assert.equal(await page.locator('#deadline-events').isVisible(), false, 'Paso 1 debe estar oculto');

    // Verificar stepper: Step 1 completed, Step 2 active
    assert.equal(await page.locator('#step-btn-1').evaluate(el => el.classList.contains('completed')), true, 'Step 1 debe ser completed');
    assert.equal(await page.locator('#step-btn-2').evaluate(el => el.classList.contains('active')), true, 'Step 2 debe ser active');

    // Verificar botón de volver visible en el encabezado del paso 2
    const backBtnInContext = page.locator('#deadline-actions button:has-text("Cambiar situación")');
    assert.equal(await backBtnInContext.isVisible(), true, 'Botón visible Cambiar situación en Paso 2');

    const topNavControls = page.locator('#deadline-nav-controls');
    assert.equal(await topNavControls.isVisible(), true, 'Controles superiores de navegación visibles');

    await page.screenshot({ path: path.resolve(root, 'deadlines-step2-actions.png') });
    console.log('Captura Paso 2 guardada: deadlines-step2-actions.png');

    // 5. Seleccionar una acción legal (Reclamar despido injustificado) y pasar al Paso 3
    console.log('Seleccionando acción legal...');
    await page.locator('#deadline-actions button.action-card:has-text("Reclamar despido injustificado")').click();
    await page.waitForTimeout(400);

    // Verificar Paso 3
    assert.equal(await page.locator('#deadline-result').isVisible(), true, 'Paso 3 debe estar visible');
    assert.equal(await page.locator('#step-btn-3').evaluate(el => el.classList.contains('active')), true, 'Step 3 active');

    // Verificar resultado de cálculo
    const wizardOutput = page.locator('#wizard-output');
    await wizardOutput.waitFor({ state: 'visible' });
    const outputText = await wizardOutput.innerText();
    console.log('Resultado del cálculo:', outputText.slice(0, 160).replace(/\n+/g, ' | '));
    assert(outputText.includes('días restantes aproximados') || outputText.includes('Fecha límite estimada'), 'Muestra cómputo de fecha');

    // Verificar botones de volver en Paso 3
    const backToActionsBtn = page.locator('#deadline-result button:has-text("Volver a acciones")');
    assert.equal(await backToActionsBtn.isVisible(), true, 'Botón visible Volver a acciones en Paso 3');

    await page.screenshot({ path: path.resolve(root, 'deadlines-step3-result.png') });
    console.log('Captura Paso 3 guardada: deadlines-step3-result.png');

    // 6. Probar botón "Volver a acciones"
    console.log('Haciendo clic en "Volver a acciones"...');
    await backToActionsBtn.click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#deadline-actions').isVisible(), true, 'Debe regresar al Paso 2');

    // 7. Probar clic en Step 1 en el stepper superior
    console.log('Haciendo clic en Paso 1 en el stepper superior...');
    await page.locator('#step-btn-1').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#deadline-events').isVisible(), true, 'Debe regresar al Paso 1');
    assert.equal(await page.locator('#step-btn-1').evaluate(el => el.classList.contains('active')), true, 'Step 1 active');

    console.log('\nTODAS LAS PRUEBAS DE SITUACIONES & PLAZOS PASARON CON ÉXITO!');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
