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
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    console.log('Navigating to AeroLex home...');
    await page.goto(base);

    // 1. Verificar sección #soy-cliente y tomar captura
    console.log('Verifying #soy-cliente section...');
    const soyCliente = page.locator('#soy-cliente');
    await soyCliente.scrollIntoViewIfNeeded();
    await soyCliente.waitFor({ state: 'visible' });

    await page.screenshot({ path: path.resolve(root, 'soy-cliente-cards.png') });
    console.log('Screenshot of #soy-cliente cards saved: soy-cliente-cards.png');

    // 2. Probar Modal Calculadora
    console.log('Opening Modal Calculadora...');
    assert.equal(await page.locator('#modal-calculadora').evaluate(el => el.open), false, 'Modal calculadora starts closed');
    
    await page.getByRole('button', { name: 'Abrir Calculadora Legal (Modo Ventana)' }).click();
    assert.equal(await page.locator('#modal-calculadora').evaluate(el => el.open), true, 'Modal calculadora is open');

    // Rellenar finiquito
    await page.locator('#fin-inicio').fill('2021-03-01');
    await page.locator('#fin-termino').fill('2026-09-30');
    await page.locator('#fin-sueldo').fill('1200000');
    await page.getByRole('button', { name: 'Calcular mi estimación ahora' }).click();
    await page.locator('#alc-result-finiquito .alc-result').waitFor({ state: 'visible' });

    const finResultText = await page.locator('#alc-result-finiquito').innerText();
    console.log('Finiquito calculation success:', finResultText.slice(0, 150));
    assert(finResultText.toLowerCase().includes('finiquito y despido'), 'Contains finiquito result');

    // Cambiar a Arriendo dentro del modal
    await page.locator('#modal-tab-arriendo').click();
    await page.locator('#arr-renta').fill('550000');
    await page.locator('#arr-meses').fill('2');
    await page.getByRole('button', { name: 'Calcular deuda estimada' }).click();
    await page.locator('#alc-result-arriendo .alc-result').waitFor({ state: 'visible' });

    await page.screenshot({ path: path.resolve(root, 'modal-calculadora-open.png') });
    console.log('Screenshot of Modal Calculadora saved: modal-calculadora-open.png');

    // Cerrar modal calculadora
    await page.locator('#modal-calculadora button[title*="Cerrar"]').first().click();
    assert.equal(await page.locator('#modal-calculadora').evaluate(el => el.open), false, 'Modal calculadora closed');

    // 3. Probar Modal Mi Causa (Miniventana con Detalle de Causa)
    console.log('Opening Modal Mi Causa...');
    assert.equal(await page.locator('#modal-mi-causa').evaluate(el => el.open), false, 'Modal mi-causa starts closed');

    await page.getByRole('button', { name: 'Consultar Mi Causa (Miniventana)' }).click();
    assert.equal(await page.locator('#modal-mi-causa').evaluate(el => el.open), true, 'Modal mi-causa is open');

    // Probar carga con botón demo o credenciales
    console.log('Testing case ALX-2026-01 login...');
    await page.locator('#alc-case-code').fill('ALX-2026-01');
    await page.locator('#alc-case-pin').fill('1234');
    await page.locator('#mc-btn-submit').click();

    // Esperar a que la vista de detalle se haga visible
    await page.locator('#mc-view-detail').waitFor({ state: 'visible' });
    const codeDisplayed = await page.locator('#mc-display-code').innerText();
    const materiaDisplayed = await page.locator('#mc-display-materia').innerText();
    const detalleDisplayed = await page.locator('#mc-display-detalle').innerText();
    const timelineDisplayed = await page.locator('#mc-display-timeline').innerText();

    console.log('\n--- DETALLES DEL EXPEDIENTE CARGADO ---');
    console.log('Código:', codeDisplayed);
    console.log('Materia:', materiaDisplayed);
    console.log('Detalle de lo sucedido:', detalleDisplayed);
    console.log('Hitos:', timelineDisplayed.replace(/\n+/g, ' | '));

    assert.equal(codeDisplayed, 'ALX-2026-01');
    assert(materiaDisplayed.includes('Compraventa Inmobiliaria'));
    assert(detalleDisplayed.length > 30, 'Detalle de la causa is populated with brief description');
    assert(timelineDisplayed.includes('Cumplido'), 'Timeline shows completed milestones');

    await page.screenshot({ path: path.resolve(root, 'modal-mi-causa-detail.png') });
    console.log('Screenshot of Modal Mi Causa detail saved: modal-mi-causa-detail.png');

    // 4. Probar versión móvil (viewport móvil)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.resolve(root, 'modal-mi-causa-mobile.png') });
    console.log('Screenshot of Modal Mi Causa mobile saved: modal-mi-causa-mobile.png');

    console.log('\nALL MODAL AND TRACKING TESTS PASSED PERFECTLY!');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
