(function () {
  'use strict';
  const menu = document.getElementById('mobile-menu');
  const trigger = document.getElementById('open-mobile-menu');
  let previous = [];
  window.toggleMobileMenu = function () {
    const opening = menu.inert;
    menu.inert = !opening;
    menu.classList.toggle('translate-x-full', !opening);
    menu.setAttribute('aria-hidden', String(!opening));
    trigger.setAttribute('aria-expanded', String(opening));
    document.body.style.overflow = opening ? 'hidden' : '';
    if (opening) {
      previous = [...document.body.children].filter(el => el !== menu).map(el => [el, el.inert]);
      previous.forEach(([el]) => { el.inert = true; });
      menu.querySelector('button').focus();
    } else {
      previous.forEach(([el,value]) => { el.inert = value; });
      previous = [];
      trigger.focus();
    }
  };
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); window.toggleMobileMenu(); }
    if (event.key !== 'Tab') return;
    const items = [...menu.querySelectorAll('a[href],button')].filter(el => el.getClientRects().length);
    const first = items[0], last = items[items.length-1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  matchMedia('(min-width:1280px)').addEventListener('change', event => {
    if (event.matches && !menu.inert) window.toggleMobileMenu();
  });
})();
