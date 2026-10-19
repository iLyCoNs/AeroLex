const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const urls = [...fs.readFileSync('sitemap.xml', 'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
const titles = new Set();
for (const url of urls) {
  const route = new URL(url).pathname;
  const file = route === '/' ? 'index.html' : route.slice(1) + '.html';
  const html = fs.readFileSync(file, 'utf8');
  assert.equal((html.match(/<h1\b/g) || []).length, 1, `${file}: one main heading`);
  assert(html.includes(`rel="canonical" href="${url}"`), `${file}: canonical`);
  const title = html.match(/<title>(.*?)<\/title>/)[1];
  assert(!titles.has(title), `${file}: unique title`); titles.add(title);
  assert(!html.includes('cdn.tailwindcss.com'), `${file}: no runtime CSS compiler`);
  assert(html.includes('href="/assets/public.css"'), `${file}: compiled styles`);
  for (const script of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (script[1].includes('application/ld+json')) JSON.parse(script[2]);
    else if (!script[1].includes('src=')) new vm.Script(script[2], {filename:file});
  }
  for (const [, href] of html.matchAll(/href="(\/[^"?#]*)(?:[?#][^"]*)?"/g)) {
    const target = href === '/' ? 'index.html' : href.slice(1);
    assert(fs.existsSync(target) || fs.existsSync(target + '.html'), `${file}: broken local link ${href}`);
  }
}
const family = fs.readFileSync('abogado-familia-puerto-montt.html', 'utf8');
assert(!family.includes('año siguiente a la sentencia'));
assert(fs.statSync('assets/public.css').size > 10000);
console.log(`SEO checks passed for ${urls.length} public pages: canonical URLs, headings, links, schema, inline JS and compiled CSS.`);
