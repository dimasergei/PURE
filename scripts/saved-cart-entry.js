// Only /cart loads this entry. Open the original drawer after the original gate.
(() => {
  'use strict';
  function openCart() {
    const gate = document.getElementById('ap-age-dialog');
    if (gate?.open) {
      gate.addEventListener('close', openCart, {once: true});
      return;
    }
    document.querySelector('header [data-action="cart"]')?.click();
  }
  function ready() {
    Promise.resolve(window.AltaLocale?.countryReady).then(openCart,openCart);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',ready,{once:true});
  else ready();
})();
