// Run with NODE_PATH pointing to a Playwright installation, or install Playwright separately.
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
  res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.png':'image/png'})[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true, channel:'msedge'});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Test local functionality without sending data to external services.
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    const base = `http://127.0.0.1:${server.address().port}`;
    const results = [];
    for (const width of [390, 1440]) {
      await page.setViewportSize({width, height:1000});
      for (const route of ['/', '/abogado-laboral-puerto-montt', '/abogado-familia-puerto-montt', '/abogado-inmobiliario-puerto-montt', '/abogado-deudas-embargos-puerto-montt', '/posesion-efectiva-puerto-montt', '/peritaje-dron-puerto-montt']) {
        await page.goto(base + route);
        const dimensions = await page.evaluate(() => ({width:innerWidth, scroll:document.documentElement.scrollWidth, font:parseFloat(getComputedStyle(document.querySelector('h1')).fontSize)}));
        assert(dimensions.scroll <= dimensions.width + 1, `${route} overflows at ${width}: ${dimensions.scroll}`);
        assert(dimensions.font >= 30, `${route}: utilities not applied`);
        if (route === '/') {
          await page.getByRole('link', {name:'Consultar mi caso por WhatsApp',exact:true}).isVisible().then(assert);
          await page.evaluate(() => openAssistant());
          assert(await page.locator('dialog[open]').count() > 0, 'Assistant opens');
          await page.evaluate(() => document.querySelector('dialog[open]').close());
          assert.equal(await page.locator('#calculator-details').getAttribute('open'), null);
          assert.equal(await page.locator('#legal-tools-details').getAttribute('open'), null);
          await page.locator('[data-friendly-tool="arriendo"]').click();
          await page.screenshot({path:path.join(require('node:os').tmpdir(), `aerolex-tools-${width}.png`)});
          assert(await page.locator('#alc-panel-arriendo').isVisible());
          assert.equal(await page.locator('#alc-tab-arriendo').getAttribute('aria-pressed'), 'true');
          await page.locator('#arr-renta').fill('450000');
          await page.locator('#arr-meses').fill('2');
          await page.getByRole('button', {name:'Calcular deuda estimada',exact:true}).click();
          assert((await page.locator('#alc-result-arriendo').innerText()).includes('900.000'));
          await page.locator('[data-friendly-tool="glosario"]').click();
          assert(await page.locator('#tool-glosario').isVisible());
          await page.getByRole('textbox', {name:'Buscar una palabra legal'}).fill('finiquito');
          assert((await page.locator('#glos-grid').innerText()).toLowerCase().includes('finiquito'));
          await page.locator('[data-friendly-tool="plazos"]').click();
          assert(await page.locator('#deadline-events').isVisible());
          await page.locator('#event-grid button').first().click();
          assert(await page.locator('#deadline-actions').isVisible());
          await page.getByRole('button', {name:'Cambiar situación',exact:true}).click();
          assert(await page.locator('#deadline-events').isVisible());
          if (width < 1280) {
            await page.locator('#open-mobile-menu').click();
            assert.equal(await page.locator('#mobile-menu').evaluate(el => el.inert), false);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#mobile-menu').evaluate(el => el.inert), true);
            assert(await page.locator('#open-mobile-menu').evaluate(el => el === document.activeElement));
          }
          await page.goto(base + '/#soy-cliente');
          await page.reload();
          assert(await page.locator('#alc-panel-finiquito').isVisible(), 'Existing calculator links still open it');
          await page.goto(base + '/');
          if (width >= 1280) assert.equal(await page.locator('#open-mobile-menu').isVisible(), false);
          await page.screenshot({path:path.join(require('node:os').tmpdir(), `aerolex-seo-${width}.png`)});
        }
        results.push(`${width}px ${route}: OK`);
      }
    }
    for (const width of [320, 768, 1024]) {
      await page.setViewportSize({width,height:1000});
      await page.goto(base + '/');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Home overflow at ${width}`);
      const menu = page.locator('#open-mobile-menu');
      assert(await menu.isVisible());
      assert(await page.locator('.simple-header').evaluate(el => [...el.querySelectorAll('a,button')].filter(x => x.getClientRects().length).every(x => { const b=x.getBoundingClientRect(); return b.left>=0 && b.right<=innerWidth; })), 'Header controls stay on screen');
      await menu.click();
      await page.getByRole('link', {name:'Herramientas',exact:true}).click();
      assert.equal(await page.locator('#mobile-menu').evaluate(el => el.inert), true);
      await page.locator('[data-friendly-tool="finiquito"]').click();
      assert(await page.locator('#fin-inicio').isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Calculator overflow at ${width}`);
      results.push(`${width}px home and calculator: OK`);
    }
    await page.setViewportSize({width:1280,height:1000});
    await page.goto(base + '/');
    await page.evaluate(() => document.documentElement.style.zoom = '2');
    await page.locator('[data-friendly-tool="arriendo"]').click();
    assert(await page.locator('#arr-renta').isVisible(), 'Calculator usable at 200% zoom');
    results.push('200% zoom: calculator accessible');
    assert.deepEqual(errors, [], 'No uncaught client JS errors');
    console.log(results.join('\n'));
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
