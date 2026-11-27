(() => {
 'use strict';
 const sections = [
  ['Overview', '/account'],
  ['Orders', '/account/purchases'],
  ['Partner', '/account/partner'],
  ['Subscription', '/monthly-orders'],
  ['Profile', '/account/profile'],
  ['Membership', '/account/membership'],
 ];

 function render(path) {
  const current = path.startsWith('/account/orders') || path === '/account/tracking' ? '/account/purchases' : path;
  const label = sections.find(([, href]) => href === current)?.[0];
  const links = sections.map(([name, href]) =>
   '<a href="' + href + '"' + (current === href ? ' aria-current="page"' : '') + '>' + name + '</a>'
  ).join('');
  return '<nav class="account-nav" aria-label="Account sections">' +
   '<button type="button" class="account-nav-toggle" aria-expanded="false" aria-controls="account-nav-options"' +
   (label ? ' aria-label="Account sections, ' + label + '"' : '') + '>' + (label || 'Account sections') + '</button>' +
   '<div class="account-nav-options" id="account-nav-options">' + links +
   '<button type="button" id="logout" class="account-nav-logout">Log out</button></div></nav>';
 }

 function collapse(toggle) {
  if (toggle.getAttribute('aria-expanded') !== 'true') return;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.focus({preventScroll:true});
 }

 function bind(root) {
  root.addEventListener('click', event => {
   const toggle = event.target.closest('.account-nav')?.querySelector('.account-nav-toggle');
   if (!toggle) return;
   if (toggle.contains(event.target)) {
    toggle.setAttribute('aria-expanded', String(toggle.getAttribute('aria-expanded') === 'false'));
   } else if (event.target.closest('.account-nav-options :is(a, button)')) {
    collapse(toggle);
   }
  });
  root.addEventListener('keydown', event => {
   if (event.key !== 'Escape') return;
   const toggle = event.target.closest('.account-nav')?.querySelector('.account-nav-toggle[aria-expanded="true"]');
   if (!toggle) return;
   event.preventDefault();
   collapse(toggle);
  });
 }

 window.PureAccountNavigation = { render, bind };
})();
