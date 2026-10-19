const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const chatbotADPath = path.resolve(__dirname, '../../chatbotAD');

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
    const copilotJs = fs.readFileSync(path.join(chatbotADPath, 'vibe-copilot.js'), 'utf8');
    const copilotCss = fs.readFileSync(path.join(chatbotADPath, 'vibe-copilot.css'), 'utf8');

    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 420, height: 860 } });

    // Mock CDN files with our local updated files from chatbotAD
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.endsWith('/vibe-copilot.js') || url.includes('/vibe-copilot.js')) {
        return route.fulfill({ contentType: 'application/javascript', body: copilotJs });
      }
      if (url.endsWith('/vibe-copilot.css') || url.includes('/vibe-copilot.css')) {
        return route.fulfill({ contentType: 'text/css', body: copilotCss });
      }
      if (url.includes('/api/config')) {
        return route.fulfill({
          json: {
            config: {
              businessId: 'aerolex',
              businessName: 'AeroLex',
              whatsappNumber: '56950129843',
              enableVoice: false
            }
          }
        });
      }
      // Let local engine test fallback without needing remote internet if API is mocked
      if (url.includes('/api/chat')) {
        return route.abort();
      }
      return route.abort();
    });

    console.log('Navigating to AeroLex...');
    await page.goto(base);

    // Wait for vibe drawer to be attached
    await page.locator('#vibe-drawer').waitFor({ state: 'attached' });

    console.log('Clicking "Entender una notificación o urgencia"...');
    await page.locator('[data-assistant-topic="urgencia"]').click();

    // Wait for drawer to open
    await page.waitForFunction(() => document.querySelector('#vibe-drawer')?.classList.contains('vibe-open'));

    // Wait for bot response message
    await page.waitForFunction(() => {
      const text = document.querySelector('#vibe-drawer')?.textContent || '';
      return text.includes('Notificación judicial: plazos fatales');
    }, { timeout: 10000 });

    const drawerText = await page.locator('#vibe-drawer').innerText();
    console.log('\n--- BOT RESPONSE RECEIVED ---');
    console.log(drawerText.slice(0, 500) + '...');

    // Assertions
    assert(drawerText.includes('Notificación judicial: plazos fatales'), 'Response contains title');
    assert(drawerText.includes('receptor judicial'), 'Explains receptor judicial');
    assert(drawerText.includes('Plazos fatales corriendo'), 'Explains plazos fatales');
    assert(drawerText.includes('Riesgo de rebeldía'), 'Explains riesgo de rebeldía');
    assert(drawerText.includes('¿Le gustaría coordinar de inmediato'), 'Asks to coordinate with lawyer');
    assert(drawerText.includes('WhatsApp'), 'Offers WhatsApp');

    // Verify WhatsApp CTA button
    const ctaButton = page.locator('#vibe-drawer a[href*="wa.me/56950129843"]');
    await ctaButton.waitFor({ state: 'visible' });
    console.log('CTA WhatsApp button is visible!');

    const stacking = await page.evaluate(() => {
      const drawer = document.getElementById('vibe-drawer');
      const rect = drawer.getBoundingClientRect();
      const elAtCenter = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        drawerRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        drawerZIndex: getComputedStyle(drawer).zIndex,
        rootZIndex: getComputedStyle(document.querySelector('.vibe-copilot-root')).zIndex,
        elAtCenterTag: elAtCenter ? elAtCenter.tagName + '.' + elAtCenter.className : null,
        isInsideDrawer: drawer.contains(elAtCenter)
      };
    });
    console.log('STACKING DIAGNOSTIC:', stacking);

    const bg = await page.evaluate(() => {
      const drawer = document.getElementById('vibe-drawer');
      const log = document.getElementById('vibe-log');
      return {
        drawerBg: getComputedStyle(drawer).backgroundColor,
        drawerBackdrop: getComputedStyle(drawer).backdropFilter,
        logBg: getComputedStyle(log).backgroundColor,
        rootSkin: document.querySelector('.vibe-copilot-root')?.getAttribute('data-skin')
      };
    });
    console.log('COMPUTED BACKGROUNDS:', bg);

    // Take screenshot of the open conversation and drawer only
    const screenshotPath = path.resolve(chatbotADPath, '../AeroLex/chatbot-interaction-proof.png');
    await page.screenshot({ path: screenshotPath });
    console.log('Screenshot saved to:', screenshotPath);

    const drawerOnlyPath = path.resolve(chatbotADPath, '../AeroLex/drawer-only.png');
    await page.locator('#vibe-drawer').screenshot({ path: drawerOnlyPath });
    console.log('Drawer screenshot saved to:', drawerOnlyPath);

    // Test 2: Close and test Consulta
    console.log('\nTesting Topic 2: Consulta...');
    await page.evaluate(() => VibeCopilot.close());
    await page.waitForFunction(() => !document.querySelector('#vibe-drawer')?.classList.contains('vibe-open'));
    await page.locator('[data-assistant-topic="consulta"]').click();
    await page.waitForFunction(() => document.querySelector('#vibe-drawer')?.classList.contains('vibe-open'));
    await page.waitForFunction(() => document.querySelector('#vibe-drawer')?.textContent.includes('Orientación legal AeroLex'));
    const consultaText = await page.locator('#vibe-drawer').innerText();
    assert(consultaText.includes('Orientación legal AeroLex — Puerto Montt'));
    assert(consultaText.includes('coordinar'));
    console.log('Topic 2 (Consulta) verified!');

    // Test 3: Arriendo calculation result explanation
    console.log('\nTesting Topic 3: Arriendo Calculator Result Explanation...');
    await page.evaluate(() => VibeCopilot.close());
    await page.waitForFunction(() => !document.querySelector('#vibe-drawer')?.classList.contains('vibe-open'));
    await page.locator('#alc-tab-arriendo').click();
    await page.locator('#arr-renta').fill('450000');
    await page.locator('#arr-meses').fill('3');
    await page.getByRole('button', { name: 'Calcular deuda estimada', exact: true }).click();
    await page.locator('#alc-result-arriendo').waitFor({ state: 'visible' });

    // Click "Explícame este cálculo con IA"
    const explainBtn = page.locator('.assistant-result-help button, [data-assistant-topic="arriendo"]').first();
    await explainBtn.click();
    await page.waitForFunction(() => document.querySelector('#vibe-drawer')?.classList.contains('vibe-open'));
    await page.waitForFunction(() => {
      const t = document.querySelector('#vibe-drawer')?.textContent || '';
      return t.includes('arriendo') && t.includes('Devuélveme mi Casa');
    }, { timeout: 10000 });
    const arriendoText = await page.locator('#vibe-drawer').innerText();
    assert(arriendoText.includes('Devuélveme mi Casa'), 'Explains Devuélveme mi Casa');
    assert(arriendoText.includes('10 días'), 'Explains 10 day deadline');
    assert(arriendoText.includes('abogado civil'), 'Offers civil attorney');
    console.log('Topic 3 (Arriendo Calculator Explanation) verified!');

    console.log('\nALL CHECKS PASSED SUCCESSFULLY!');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
