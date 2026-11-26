(() => {
  'use strict';
  const id = new URLSearchParams(location.search).get('invoice');
  const byId = name => document.getElementById('interac-' + name);
  const status = byId('status'), refresh = byId('refresh');
  const summary = byId('summary'), payment = byId('payment'), deadline = byId('deadline');
  const validId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const states = {
    accepted: 'Awaiting Interac payment.',
    paid: 'Payment confirmed.',
    processing: 'Your order is being processed.',
    shipped: 'Your order has shipped.',
    delivered: 'Your order has been delivered.',
    refunded: 'Your order was refunded.',
    void: 'This order was canceled.',
    under_review: 'Your order is under review. Contact support before sending a transfer.',
    expired: 'The payment deadline has passed. Contact support before sending a transfer.'
  };

  async function load() {
    refresh.disabled = true;
    payment.hidden = true;
    deadline.hidden = true;
    status.textContent = 'Checking order status…';
    try {
      const response = await fetch('/api/customer-config?guest_interac=' + encodeURIComponent(id), {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const order = await response.json();
      if (!response.ok) throw Error(order.error || 'Order status could not be loaded.');
      if (order.currency !== 'CAD' || !Number.isSafeInteger(order.total_cents) || order.total_cents <= 0) {
        throw Error('Order total could not be verified. Contact support before sending a transfer.');
      }
      byId('order').textContent = 'Order ' + order.order_number;
      byId('total').textContent = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(order.total_cents / 100);
      summary.hidden = false;
      status.textContent = states[order.status] || 'Order payment details are unavailable. Contact support for assistance.';
      if (order.status === 'accepted' && order.payment) {
        const expires = new Date(order.expires_at);
        if (!Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now()) {
          status.textContent = states.expired;
          return;
        }
        const time = deadline.querySelector('time');
        time.dateTime = expires.toISOString();
        time.textContent = expires.toLocaleString();
        deadline.hidden = false;
        byId('payee').textContent = order.payment.payee;
        byId('instructions').textContent = order.payment.instructions;
        byId('reference').textContent = order.payment.reference;
        payment.hidden = false;
      } else if (order.status === 'accepted') {
        status.textContent = 'Transfer details are unavailable. Contact support before sending a transfer.';
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      refresh.disabled = false;
    }
  }

  if (!validId.test(id || '')) {
    refresh.hidden = true;
    status.textContent = 'Open the payment link from your order.';
    return;
  }
  refresh.addEventListener('click', load);
  void load();
})();
