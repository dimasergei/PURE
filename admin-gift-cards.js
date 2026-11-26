(() => {
  'use strict';
  const panel = document.querySelector('#pure-admin-gifts');
  if (!panel) return;
  const root = panel.querySelector('[data-admin-gift-list]');
  const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
  let version = 0, offset = 0;
  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  async function api(payload) {
    const response = await window.PureAdminAuth.fetch('/api/customer-config?gift_order=admin' + (!payload && offset ? '&offset=' + offset : ''), payload ? {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    } : {cache:'no-store'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load gift card orders.');
    return data;
  }
  const actions = {
    fund: ['Confirm funding','I verified the incoming USD bank transfer and its full amount.','Incoming bank reference'],
    refund_start: ['Reserve funds for refund','I confirmed this refund request and want to reserve the gift balance.'],
    refund_finish: ['Record completed refund','I verified the outgoing USD bank refund and its full amount.','Outgoing bank reference'],
    notify: ['Send delivery email']
  };
  function control(order, action) {
    const reviewed = action === 'notify' && order.notification_status === 'review';
    const [title, acknowledgment, referenceLabel] = reviewed ? ['Retry reviewed email','I checked with the email provider and verified that no previous gift email was accepted.'] : actions[action];
    const form = el('form'), feedback = el('p');
    feedback.setAttribute('role','status');
    if (referenceLabel) {
      const reference = el('label',referenceLabel), input = el('input');
      input.required = true; input.name = 'reference'; input.maxLength = 150; input.autocomplete = 'off';
      reference.append(input);
      const total = el('label','Verified amount in USD'), amount = el('input');
      amount.type = 'number'; amount.name = 'amount'; amount.step = '.01'; amount.required = true;
      amount.min = amount.max = (order.amount_cents/100).toFixed(2);
      total.append(amount); form.append(reference,total);
    }
    if (acknowledgment) {
      const label = el('label',undefined,'pag-check'), check = el('input');
      check.type = 'checkbox'; check.name = 'verified'; check.required = true;
      label.append(check,document.createTextNode(acknowledgment)); form.append(label);
    }
    const button = el('button',title,'ghost'); button.type = 'submit'; form.append(button,feedback);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (button.disabled || !form.reportValidity()) return;
      const started = version;
      const payload = {id:order.id, action};
      if (acknowledgment) payload.confirmed = form.elements.verified.checked;
      if (referenceLabel) {
        payload.reference = form.elements.reference.value.trim(); payload.currency = 'USD';
        payload.amount_cents = Math.round(form.elements.amount.valueAsNumber*100);
        if (!payload.reference || payload.amount_cents !== order.amount_cents) { feedback.textContent = 'Verify the exact amount and bank reference.'; return; }
      }
      button.disabled = true;
      try {
        await api(payload); if (version === started) await load('Gift card order updated.');
      } catch (error) { if (version === started) { button.disabled=false;feedback.textContent=error.message; } }
    });
    return form;
  }
  function row(order) {
    const item = el('details',undefined,'pag-order');
    item.append(el('summary',order.reference+' · '+money(order.amount_cents)+' USD · '+order.status.replaceAll('_',' ')));
    const fields = el('dl');
    for (const [name,value] of [['Buyer',order.purchaser_email],['Recipient',order.recipient_email],['Send on (UTC)',order.send_date],['Delivery email',order.notification_status],['Funding reference',order.payment_reference],['Refund reference',order.refund_reference]]) {
      if (value) fields.append(el('dt',name),el('dd',value));
    }
    item.append(fields);
    if (['pending','pending_payment'].includes(order.status)) item.append(control(order,'fund'));
    if (['funded','claimed'].includes(order.status)) item.append(control(order,'refund_start'));
    if (order.status==='refund_pending') item.append(el('p','Return the reserved amount through your bank, then record the completed transfer.'),control(order,'refund_finish'));
    if (['funded','claimed'].includes(order.status) && ['failed','waiting','review'].includes(order.notification_status)) item.append(control(order,'notify'));
    return item;
  }
  async function load(message='') {
    const started=++version;
    const note=el('p','Loading gift card orders…'); note.setAttribute('role','status');
    root.replaceChildren(note);
    try {
      const data=await api();
      if(started!==version) return;
      const refresh=el('button','Refresh gift cards','ghost'); refresh.type='button';refresh.onclick=()=>load();
      note.textContent=message || (data.orders.length?'':'No gift card orders yet.');
      root.append(refresh,...data.orders.map(row));
      if (offset || data.has_more) {
        const nav=el('nav'); nav.setAttribute('aria-label','Gift card order pages');
        const back=el('button','Previous','ghost'),next=el('button','Next','ghost');
        back.type=next.type='button';back.disabled=offset===0;next.disabled=!data.has_more;
        back.onclick=()=>{offset=Math.max(0,offset-100);load();};next.onclick=()=>{offset+=100;load();};
        nav.append(back,el('span',' Page '+(1+offset/100)+' '),next);root.append(nav);
      }
    } catch(error) {
      if(started!==version) return;
      note.textContent=error.message;
      const retry=el('button','Retry','ghost');retry.type='button';retry.onclick=()=>load();root.append(retry);
    }
  }
  panel.addEventListener('toggle',()=>{if(panel.open&&window.PureAdminAuth?.authenticated)load();else{version++;root.replaceChildren();}});
  window.addEventListener('pure-admin-auth-change',event=>{if(!event.detail?.authenticated){version++;offset=0;panel.open=false;root.replaceChildren();}});
})();
