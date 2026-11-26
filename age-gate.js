/* Enhance the same confirmation form delivered in the document. */
(() => {
  'use strict';
  const dialog = document.getElementById('ap-age-dialog');
  if (!dialog || !dialog.dataset.cookie || !dialog.showModal) return;
  const cookie = dialog.dataset.cookie;
  if (document.cookie.split(';').some(part => part.trim() === cookie)) return;
  dialog.addEventListener('cancel', event => event.preventDefault());
  const form = dialog.querySelector('[data-pure-consent]');
  form.elements.returnTo.value = location.pathname + location.search + location.hash;
  form.addEventListener('submit', event => {
    document.cookie = cookie + '; Max-Age=' + Number(dialog.dataset.days)*86400 + '; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    event.preventDefault();
    dialog.close();
  });
  dialog.showModal();
})();
