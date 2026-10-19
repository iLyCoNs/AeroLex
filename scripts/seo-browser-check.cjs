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
          await page.screenshot({path:path.join(require('node:os').tmpdir(), `aerolex-seo-${width}.png`)});
        }
        results.push(`${width}px ${route}: OK`);
      }
    }
    assert.deepEqual(errors, [], 'No uncaught client JS errors');
    console.log(results.join('\n'));
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
