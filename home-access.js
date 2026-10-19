(function () {
  'use strict';
  function reveal(target, focus) {
    if (!target) return;
    for (let parent = target; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    target.scrollIntoView({behavior:'instant', block:'start'});
    if (focus) {
      const heading = target.querySelector('summary, h2, h3') || target;
      if (!heading.matches('summary, a, button, input, select')) heading.setAttribute('tabindex', '-1');
      heading.focus({preventScroll:true});
    }
  }
  window.openFriendlyTool = function (tool) {
    if (tool === 'finiquito' || tool === 'arriendo') {
      window.openCalcTab(tool);
      const summary = document.querySelector('#calculator-details > summary');
      summary.textContent = tool === 'finiquito' ? 'Calcular mi finiquito' : 'Calcular una deuda de arriendo';
      reveal(document.getElementById('calculator-details'), true);
    } else {
      const target = document.getElementById('legal-tools-details');
      const button = target.querySelector('[data-tool="' + tool + '"]');
      if (!button) return;
      window.switchTool(tool, button);
      reveal(target, true);
    }
  };
  document.querySelectorAll('[data-friendly-tool]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      window.openFriendlyTool(link.dataset.friendlyTool);
    });
  });
  const menu = document.getElementById('mobile-menu');
  const menuButton = document.getElementById('open-mobile-menu');
  let previousInert = [];
  window.toggleMobileMenu = function () {
    const opening = menu.inert;
    menu.inert = !opening;
    menu.classList.toggle('translate-x-full', !opening);
    menu.setAttribute('aria-hidden', String(!opening));
    menuButton.setAttribute('aria-expanded', String(opening));
    document.body.style.overflow = opening ? 'hidden' : '';
    if (opening) {
      previousInert = [...document.body.children].filter(el => el !== menu).map(el => [el, el.inert]);
      previousInert.forEach(([el]) => { el.inert = true; });
      menu.querySelector('button').focus();
    } else {
      previousInert.forEach(([el, value]) => { el.inert = value; });
      previousInert = [];
      menuButton.focus();
    }
  };
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); window.toggleMobileMenu(); }
    if (event.key !== 'Tab') return;
    const controls = [...menu.querySelectorAll('a[href], button')].filter(el => el.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  matchMedia('(min-width: 1280px)').addEventListener('change', event => {
    if (event.matches && !menu.inert) window.toggleMobileMenu();
  });
  // Existing links from specialty pages still reach the calculator.
  function followHash() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (_) { return; }
    if (id === 'soy-cliente') {
      const details = document.getElementById('calculator-details');
      if (details) details.open = true;
    }
    reveal(document.getElementById(id), false);
  }
  window.addEventListener('hashchange', followHash);
  if (location.hash) followHash();
})();
