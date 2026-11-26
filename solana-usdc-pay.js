(() => {
  'use strict';

  const chain = 'solana:mainnet';
  const genesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const wallets = new Set();
  const listeners = new Set();
  const register = (...providers) => {
    const added = providers.filter(provider => provider && !wallets.has(provider));
    for (const provider of added) wallets.add(provider);
    for (const listener of listeners) listener();
    return () => {
      for (const provider of added) wallets.delete(provider);
      for (const listener of listeners) listener();
    };
  };
  const walletApi = Object.freeze({ register });
  window.addEventListener('wallet-standard:register-wallet', event => {
    if (typeof event.detail === 'function') event.detail(walletApi);
  });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: walletApi }));

  const signFeature = wallet => wallet?.features?.['solana:signTransaction'];
  const supportsWallet = wallet => typeof wallet?.name === 'string' && wallet.chains?.includes(chain) &&
    typeof wallet.features?.['standard:connect']?.connect === 'function' && typeof signFeature(wallet)?.signTransaction === 'function' &&
    signFeature(wallet).supportedTransactionVersions?.includes('legacy');
  const supportsAccount = account => account?.chains?.includes(chain) && account.features?.includes('solana:signTransaction') && keyValue(account.address) !== null;
  const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
  const asBase64 = bytes => btoa(String.fromCharCode(...bytes));
  const fromBase64 = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));

  function keyValue(value) {
    if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return null;
    let number = 0n;
    for (const digit of value) number = number * 58n + BigInt(alphabet.indexOf(digit));
    const leading = value.match(/^1*/)[0].length;
    const length = number === 0n ? 0 : Math.ceil(number.toString(16).length / 2);
    if (leading + length !== 32) return null;
    const bytes = new Uint8Array(32);
    for (let offset = 31; offset >= leading; offset--) {
      bytes[offset] = Number(number & 255n);
      number >>= 8n;
    }
    return bytes;
  }

  function validateTransaction(value, intent, payer, amount) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{416}$/.test(value)) throw Error('The saved Solana transaction could not be verified.');
    const bytes = fromBase64(value);
    const keys = [payer, intent.recipient_token_account, mint, intent.reference, tokenProgram].map(keyValue);
    const offsets = [69, 133, 165, 197, 229];
    const details = new DataView(bytes.buffer);
    if (bytes.length !== 312 || bytes[0] !== 1 || bytes.subarray(1, 65).some(Boolean) ||
        !sameBytes(bytes.subarray(65, 69), [1, 0, 3, 6]) ||
        keys.some((key, i) => !key || !sameBytes(bytes.subarray(offsets[i], offsets[i] + 32), key)) ||
        !sameBytes(bytes.subarray(293, 303), [1, 5, 5, 1, 3, 2, 0, 4, 10, 12]) ||
        details.getBigUint64(303, true) !== amount || bytes[311] !== 6) {
      throw Error('The Solana transaction differs from the amount, recipient, or reference shown for this order.');
    }
    return bytes;
  }

  function tag(name, text) {
    const element = document.createElement(name);
    if (text) element.textContent = text;
    return element;
  }

  function button(name, alternate = false) {
    const element = tag('button', name);
    element.type = 'button';
    element.className = alternate ? 'ap-button ap-button-secondary' : 'ap-button';
    return element;
  }

  function mount({ host, api, guest, invoice, amount, currency, ready, state, destination }) {
    if (currency !== 'USD' || !Number.isSafeInteger(amount) || amount < 1) throw Error('This Solana payment amount is unavailable.');
    const units = BigInt(amount) * 10000n;
    const total = (amount / 100).toFixed(2) + ' USDC';
    const root = tag('section');
    root.className = 'ap-form pure-usdc-payment';
    const heading = tag('h2', 'Pay with USDC on Solana');
    const details = tag('p', 'Pay ' + total + ' using native USDC. Your wallet pays the Solana network fee in SOL.');
    const recipient = tag('p');
    recipient.style.overflowWrap = 'anywhere';
    const status = tag('p');
    status.className = 'native-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const label = tag('label', 'Solana wallet');
    const selector = tag('select');
    const connect = button('Connect wallet');
    label.append(selector);
    const pay = button('Sign and pay ' + total);
    const retry = button('Retry the same signed transfer', true);
    const check = button('Check payment status', true);
    const handoff = tag('p', guest
      ? 'On mobile, copy a private payment link and open it in your wallet’s browser within five minutes.'
      : 'Open this saved order in your Solana wallet’s browser or use a compatible browser extension.');
    const copy = button(guest ? 'Copy private wallet link' : 'Copy saved order link', true);
    const walletLink = tag('input');
    walletLink.type = 'text';
    walletLink.readOnly = true;
    walletLink.hidden = true;
    walletLink.setAttribute('aria-label', 'Wallet payment link');
    root.append(heading, details, recipient, status, label, connect, pay, retry, check, handoff, copy, walletLink);
    host.replaceChildren(root);

    let current = state || {}, wallet, account, signed, busy = false, disposed = false, timer, polls = 0;
    let choices = [];
    const call = body => api({ ...body, invoice_id: invoice });
    const terminal = () => ['paid', 'review', 'cancel_pending', 'wallet_review'].includes(current.state);
    const unexpired = () => !current.intent || current.intent.valid_before > Date.now() / 1000;
    const storageKey = () => 'pure-solana:' + invoice + ':' + current.intent?.attempt_id;
    const saved = () => {
      try { return sessionStorage.getItem(storageKey()) || signed; } catch { return signed; }
    };
    function save(value) {
      signed = value;
      try {
        if (value) sessionStorage.setItem(storageKey(), value);
        else sessionStorage.removeItem(storageKey());
      } catch {}
    }
    const safeIntent = intent => intent?.invoice_id === invoice && intent.genesis_hash === genesis && intent.token === mint &&
      intent.amount_units === units.toString() && !!keyValue(intent.payer) && !!keyValue(intent.recipient) &&
      !!keyValue(intent.recipient_token_account) && !!keyValue(intent.reference);
    function draw(message) {
      if (disposed) return;
      const canStart = ready && !terminal() && unexpired() && current.state !== 'pending' && !saved();
      const intent = current.intent;
      label.hidden = connect.hidden = !canStart || !!account || choices.length === 0;
      pay.hidden = !canStart || !account || !keyValue(destination?.recipient) || !keyValue(destination?.token_account);
      retry.hidden = !ready || terminal() || !unexpired() || !saved();
      check.hidden = !intent || current.state === 'paid';
      handoff.hidden = copy.hidden = choices.length > 0 || !canStart;
      for (const control of [connect, pay, retry, check, copy]) control.disabled = busy;
      recipient.textContent = safeIntent(intent) ? 'Receiving wallet ' + intent.recipient + ' · USDC account ' + intent.recipient_token_account
        : keyValue(destination?.recipient) && keyValue(destination?.token_account) ? 'Receiving wallet ' + destination.recipient + ' · USDC account ' + destination.token_account : '';
      status.textContent = message || (current.state === 'paid' ? 'Payment confirmed. Your order is paid.'
        : current.state === 'review' ? 'This transfer needs review. Keep your order link and contact support.'
        : current.state === 'wallet_review' ? 'The saved transaction can no longer be sent. Check payment status and contact support to review this order.'
        : current.state === 'cancel_pending' ? 'Cancellation requested. If you sent payment, keep this link and contact support for review.'
        : current.state === 'pending' || saved() ? 'Checking the signed transfer. Keep this link while payment confirmation continues.'
        : !ready ? 'New Solana payments are unavailable for this order.'
        : !unexpired() ? 'The payment window expired. Check the transfer status or contact support.'
        : account ? 'Review the receiving wallet and exact amount before signing.' : 'Connect a compatible Solana wallet.');
    }

    function updateWallets() {
      choices = [...wallets].filter(supportsWallet);
      selector.replaceChildren(...choices.map((provider, index) => {
        const option = tag('option', provider.name);
        option.value = String(index);
        return option;
      }));
      draw();
    }
    listeners.add(updateWallets);

    function apply(result) {
      current = { ...current, ...result };
      if (current.state === 'paid' || current.state === 'review') save(null);
    }

    function poll() {
      clearTimeout(timer);
      if (disposed || terminal() || polls >= 12 || !current.intent || current.state !== 'pending' && !saved()) return;
      timer = setTimeout(async () => {
        if (!disposed && !busy) {
          polls++;
          try {
            const latest = await api();
            if (latest.crypto) apply(latest.crypto);
            draw();
          } catch {}
        }
        poll();
      }, 10000);
    }

    async function run(task) {
      if (busy || disposed) return;
      busy = true;
      draw();
      let message;
      try { await task(); }
      catch (error) { message = error?.code === 4001 ? 'Your wallet declined the request.' : error.message; }
      finally { busy = false; draw(message); poll(); }
    }

    connect.onclick = () => run(async () => {
      wallet = choices[Number(selector.value)];
      if (!supportsWallet(wallet)) throw Error('Choose a compatible Solana wallet.');
      const connected = await wallet.features['standard:connect'].connect();
      const usable = connected.accounts.filter(supportsAccount);
      account = current.intent ? usable.find(candidate => candidate.address === current.intent.payer) : usable[0];
      if (!account) throw Error('Select the Solana mainnet account for this order in your wallet.');
    });
    async function submit(transaction) {
      const result = await call({ action: 'submit_solana', attempt_id: current.intent.attempt_id, signed_transaction: transaction });
      apply(result);
      if (current.state === 'pending') save(null);
    }
    pay.onclick = () => run(async () => {
      if (!ready || terminal() || !account || !unexpired() || current.state === 'pending' || saved()) return;
      const latest = await api();
      if (latest.crypto) apply(latest.crypto);
      if (!latest.gateway?.ready || latest.gateway.provider !== 'solana_usdc' || terminal() || current.state === 'pending' || !unexpired() ||
          latest.gateway.solana_destination?.recipient !== destination?.recipient || latest.gateway.solana_destination?.token_account !== destination?.token_account) {
        throw Error('This Solana order is unavailable for a new transfer.');
      }
      // The receiving details are already visible. Obtain the short-lived wire
      // only when the buyer clicks the explicit wallet signing action.
      const signing = await call({ action: 'pay', attempt_id: current.intent?.attempt_id || crypto.randomUUID(), wallet_address: account.address,
        confirm_amount_cents: amount, confirm_currency: currency, consent: true });
      apply(signing);
      if (current.state === 'wallet_review') return;
      if (current.state !== 'awaiting_wallet' || !safeIntent(current.intent) || !unexpired() || current.intent.payer !== account.address ||
          current.intent.recipient !== destination?.recipient || current.intent.recipient_token_account !== destination?.token_account) {
        throw Error('The saved Solana transaction changed. Check payment status.');
      }
      const prepared = validateTransaction(signing.transaction, current.intent, account.address, units);
      const selected = wallet.accounts.find(candidate => candidate.address === account.address && supportsAccount(candidate));
      if (!selected) throw Error('Reconnect the wallet account selected for this order.');
      const outputs = await signFeature(wallet).signTransaction({ account: selected, chain, transaction: new Uint8Array(prepared) });
      const bytes = outputs?.[0]?.signedTransaction;
      if (outputs?.length !== 1 || !(bytes instanceof Uint8Array) || bytes.length !== prepared.length || bytes[0] !== 1 ||
          !bytes.subarray(1, 65).some(Boolean) || !sameBytes(bytes.subarray(65), prepared.subarray(65))) {
        throw Error('The wallet did not return the exact signed transfer.');
      }
      if (disposed) return;
      save(asBase64(bytes));
      await submit(saved());
    });
    retry.onclick = () => run(async () => {
      const transaction = saved();
      if (ready && !terminal() && unexpired() && transaction) await submit(transaction);
    });
    check.onclick = () => run(async () => {
      if (current.intent) apply(await call({ action: 'confirm_crypto', attempt_id: current.intent.attempt_id }));
    });
    copy.onclick = () => run(async () => {
      const url = new URL('/pay.html', location.origin);
      url.searchParams.set('invoice', invoice);
      if (guest) {
        const { ticket } = await call({ action: 'guest_wallet_link' });
        if (!/^[a-f0-9.-]+\.[A-Za-z0-9_-]{43}$/i.test(ticket || '')) throw Error('Could not create a private wallet link.');
        url.searchParams.set('guest', '1');
        url.hash = 'wallet=' + ticket;
      }
      if (disposed) return;
      try { await navigator.clipboard.writeText(url.href); }
      catch {
        walletLink.value = url.href;
        walletLink.hidden = false;
        walletLink.focus();
        walletLink.select();
      }
    });
    updateWallets();
    poll();
    return { destroy() { disposed = true; listeners.delete(updateWallets); clearTimeout(timer); root.remove(); } };
  }

  window.PureSolanaUSDC = { mount };
})();
