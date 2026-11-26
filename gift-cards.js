(() => {
  'use strict';
  const root = document.querySelector('#pure-gift-main');
  if (!root) return;
  const find = name => root.querySelector('[data-gift-' + name + ']');
  const form = find('form'), field = form.elements;
  const list = find('account-list'), accountStatus = find('account-status');
  const status = find('status'), submit = find('submit');
  const usd = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2});
  const today = new Date();
  const dateUTC = date => date.toISOString().slice(0, 10);
  field.sendDate.min = dateUTC(today);
  field.sendDate.value = dateUTC(today);
  field.sendDate.max = dateUTC(new Date(today.getTime() + 28 * 86400000));
  let token = '', accountId = '', sale = null, pending = false, completed = false, draft;
  let generation = 0, accountRequest = 0, accountOffset = 0;

  function el(tag, value, className) {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    if (className) node.className = className;
    return node;
  }
  async function request(endpoint, body, authorize = true) {
    const headers = authorize ? {Authorization: 'Bearer ' + token} : {};
    if (body) headers['Content-Type'] = 'application/json';
    const result = await fetch('/api/customer-config?' + endpoint, {
      method: body ? 'POST' : 'GET', cache: 'no-store', headers, ...(body ? {body: JSON.stringify(body)} : {})
    });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || 'Please try again.');
    return data;
  }
  function refresh() {
    const amount = field.amount.valueAsNumber, label = field.amount.validity.valid ? usd.format(amount) : '—';
    find('preview').textContent = label;
    if (Number.isFinite(amount)) field.range.value = String(Math.round(amount));
    for (const button of form.querySelectorAll('[data-value]')) button.setAttribute('aria-pressed', String(Number(button.dataset.value) === amount));
    const gift = field.mode.value === 'gift';
    find('recipient').hidden = !gift;
    for (const input of find('recipient').querySelectorAll('input, textarea')) input.disabled = !gift || pending || completed;
    field.recipientEmail.required = field.confirmEmail.required = Boolean(gift && sale);
    field.confirmEmail.setCustomValidity(gift && field.recipientEmail.value.trim().toLowerCase() !== field.confirmEmail.value.trim().toLowerCase() ? 'Enter the same email address in both fields.' : '');
    const waiting = sale === null;
    find('terms').textContent = waiting ? 'Checking purchase availability…' : sale
      ? 'Pay the full amount by USD bank transfer. Your order includes transfer instructions.' : 'Purchasing is currently unavailable. Support can respond to an availability inquiry.';
    submit.textContent = completed ? (sale ? 'Order created' : 'Request received') : (sale ? 'Continue to payment · ' : 'Request availability · ') + label;
    submit.disabled = waiting || pending || completed;
    submit.hidden = !token;
    find('login').hidden = Boolean(token);
    find('account-login').hidden = Boolean(token);
    find('refresh').hidden = !token;
    for (const node of form.querySelectorAll('fieldset, [name=consent]')) node.disabled = pending || completed;
  }
  function paymentInstructions(order) {
    const block = el('div', undefined, 'pgc-payment');
    if (!order.payment) {
      block.append(el('p','Transfer instructions are unavailable. Contact support@getpurelabs.com with your order reference before sending payment.'));
      return block;
    }
    block.append(el('h4','Bank transfer instructions'), el('p','Transfer ' + usd.format(order.amount_cents / 100) + ' USD and include ' + order.reference + ' as your payment reference.'));
    if (order.payment.label) block.append(el('strong', order.payment.label));
    if (order.payment.payee) block.append(el('p', 'Payee · ' + order.payment.payee));
    block.append(el('p', order.payment.instructions, 'pgc-instructions'));
    return block;
  }
  const names = {pending: 'Awaiting payment', pending_payment: 'Awaiting payment', funded: 'Funded', claimed: 'Claimed', refund_pending: 'Refund pending', refunded: 'Refunded', cancelled: 'Cancelled'};
  function accountRow(order, received) {
    const row = el('article', undefined, 'pgc-order'), text = usd.format(order.amount_cents / 100) + ' USD';
    row.append(el('h4', text), el('p', (received ? 'From ' + order.purchaser_email : 'To ' + order.recipient_email) + ' · ' + (names[order.status] || order.status)));
    if (order.send_date) row.append(el('p', 'Send date · ' + order.send_date + ' UTC'));
    if (received && order.note) row.append(el('p', order.note, 'pgc-message'));
    if (!received) {
      row.append(el('p', 'Order reference · ' + order.reference));
      if (order.status === 'pending') {
        row.append(paymentInstructions(order));
        const cancelForm = el('form', undefined, 'pgc-cancel'), label = el('label'), confirm = el('input');
        confirm.type = 'checkbox'; confirm.required = true;
        label.append(confirm, document.createTextNode('I have not sent the bank transfer for this order.'));
        const cancel = el('button', 'Cancel unpaid order', 'pgc-secondary'); cancel.type = 'submit';
        cancelForm.append(label, cancel);
        cancelForm.addEventListener('submit', async event => {
          event.preventDefault();
          if (cancel.disabled || !confirm.checked || !cancelForm.reportValidity()) return;
          const started = generation; cancel.disabled = true;
          try {
            const result = await request('gift_order=cancel', {id: order.id, confirmed: true});
            if (started !== generation) return;
            if (result.status !== 'cancelled') throw new Error('Cancellation could not be confirmed.');
            await loadAccount('Unpaid gift card order cancelled.');
          } catch (error) {
            if (generation === started) { accountStatus.textContent = error.message; cancel.disabled = false; }
          }
        });
        row.append(cancelForm);
      }
    }
    if (received && order.status === 'funded' && order.send_date <= dateUTC(new Date())) {
      const claim = el('button', 'Claim ' + text + ' as store credit', 'pgc-secondary');
      claim.type = 'button';
      claim.addEventListener('click', async () => {
        const started = generation;
        claim.disabled = true;
        try {
          const result = await request('gift_order=claim', {id: order.id});
          if (generation !== started) return;
          if (result.status !== 'claimed') throw new Error('The claim could not be confirmed.');
          await loadAccount('Claimed ' + usd.format(result.amount_cents / 100) + ' USD as store credit.');
        } catch (error) { if (generation === started) { accountStatus.textContent = error.message; claim.disabled = false; } }
      });
      row.append(claim);
    }
    return row;
  }
  async function loadAccount(message = '', offset = accountOffset) {
    const requestNo = ++accountRequest;
    if (!token) return;
    list.replaceChildren();
    accountStatus.textContent = 'Loading your gift cards…';
    try {
      const data = await request('gift_order=account' + (offset ? '&offset=' + offset : ''));
      if (requestNo !== accountRequest) return;
      list.replaceChildren();
      const groups = [['Gifts received',data.received,true],['Purchases',data.purchases,false]];
      for (const [title, orders, received] of groups) {
        if (!Array.isArray(orders) || !orders.length) continue;
        const section = el('section');
        section.append(el('h3',title),...orders.map(order => accountRow(order, received)));
        list.append(section);
      }
      accountOffset = offset;
      accountStatus.textContent = message || (list.childElementCount ? '' : 'No gift cards on this page.');
      if (offset || data.has_more) {
        const nav = el('nav', undefined, 'pgc-pages'); nav.setAttribute('aria-label', 'Gift card history pages');
        const previous = el('button','Previous','pgc-secondary'), next = el('button','Next','pgc-secondary');
        previous.type = next.type = 'button'; previous.disabled = offset === 0; next.disabled = !data.has_more;
        previous.onclick = () => loadAccount('', Math.max(0, offset - 100)); next.onclick = () => loadAccount('', offset + 100);
        nav.append(previous,el('span','Page ' + (offset / 100 + 1)), next); list.append(nav);
      }
    } catch (error) {
      if (requestNo === accountRequest) accountStatus.textContent = (message ? message + ' ' : '') + 'Your gift card history is unavailable. Try refreshing it.';
    }
  }
  function setSession(session) {
    const next = session?.access_token || '', nextId = session?.user?.id || (next ? 'signed-in' : '');
    if (accountId !== nextId) {
      if (accountId) { form.reset(); field.sendDate.value = dateUTC(new Date()); }
      accountId = nextId; generation++; accountRequest++; accountOffset = 0; completed = false; pending = false; draft = null;
      status.replaceChildren(); list.replaceChildren(); find('requests').hidden = true;
      accountStatus.textContent = 'Sign in with the email used for your purchase or gift.';
    }
    const changed = token !== next;
    token = next;
    refresh();
    if (changed && token) void loadAccount();
  }
  async function connect() {
    try {
      const auth = (await window.AltaWorkspace.authClient()).auth;
      auth.onAuthStateChange((_event, session) => setSession(session));
      const {data} = await auth.getSession(); setSession(data.session);
    } catch { status.textContent = 'Account sign-in is unavailable. Please try again or email support@getpurelabs.com.'; }
  }
  for (const preset of form.querySelectorAll('[data-value]')) preset.addEventListener('click', () => { field.amount.value = preset.dataset.value; refresh(); });
  field.range.addEventListener('input', () => { field.amount.value = field.range.value; });
  form.addEventListener('input', refresh); form.addEventListener('change', refresh);
  find('refresh').addEventListener('click', () => loadAccount());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!token || pending || completed || sale === null || !form.reportValidity()) return;
    const gift = field.mode.value === 'gift';
    const payload = {
      amount_cents: Math.round(field.amount.valueAsNumber * 100), mode: field.mode.value, send_date: field.sendDate.value,
      recipient: gift ? field.recipient.value.trim() : '', recipient_email: gift ? field.recipientEmail.value.trim() : '',
      confirm_email: gift ? field.confirmEmail.value.trim() : '', note: gift ? field.note.value.trim() : '', consent: field.consent.checked
    };
    const signature = JSON.stringify([sale,payload]), started = generation;
    if (signature !== draft?.signature) draft = {signature,id: crypto.randomUUID()};
    pending = true; refresh(); status.textContent = sale ? 'Creating your order…' : 'Sending your inquiry…';
    try {
      const data = await request(sale ? 'gift_order=create' : 'gift_card=request', {...payload, request_id: draft.id});
      if (started !== generation) return;
      if (sale) {
        if (!data.order?.id || !data.order.reference) throw new Error('The order could not be confirmed. Please try again.');
        status.textContent = 'Order ' + data.order.reference + ' created. ';
        const details = el('a','View payment instructions'); details.href = '#gift-card-account'; status.append(details);
        void loadAccount('', 0);
      } else {
        if (!data.saved || !data.reference) throw new Error('The inquiry could not be confirmed. Please try again.');
        status.textContent = 'Your request was received. Reference ' + data.reference + '. Support will reply to your account email.';
        find('requests').hidden = false;
      }
      completed = true;
    } catch (error) { if (started === generation) status.textContent = error.message || 'Please try again.'; }
    finally { if (started === generation) { pending = false; refresh(); } }
  });
  refresh();
  void request('gift_order=availability', null, false).then(data => {sale = data.available === true && data.currency === 'USD';}, () => {sale = false;}).finally(refresh);
  void connect();
})();
