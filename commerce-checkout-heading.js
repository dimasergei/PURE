// Preserve the heading while the secure checkout is loading or reporting a service error.
(() => {
  'use strict';
  const main=document.querySelector('main[data-checkout-title]');
  const root=main?.querySelector('#account-root');
  if(!root)return;
  const heading=document.createElement('h1');
  heading.className='commerce-checkout-heading';
  heading.textContent=main.dataset.checkoutTitle;
  function update(){
    if(root.querySelector('h1'))heading.remove();
    else if(!heading.isConnected)root.before(heading);
  }
  update();
  new MutationObserver(update).observe(root,{childList:true,subtree:true});
})();
