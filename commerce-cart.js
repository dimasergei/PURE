(() => {
  'use strict';
  function openSavedCart() {
    const gate=document.querySelector('#ap-age-dialog');
    if(gate?.open){
      gate.addEventListener('close',openSavedCart,{once:true});
      return;
    }
    const opener = document.querySelector('#commerce-cart [data-action="cart"]');
    if (opener && window.AltaStore) opener.click();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',openSavedCart,{once:true});
  else openSavedCart();
})();
