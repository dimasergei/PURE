(() => {
  'use strict';

  const endpoint = '/api/customer-config?spin_save';
  const root = document.querySelector('#spin-save-main');
  if (!root) {
    const shortcut = document.querySelector('[data-spin-shortcut]');
    if (!shortcut) return;
    const label = shortcut.querySelector('span');
    async function updateShortcut() {
      let active = false;
      try { active = (await json(endpoint)).active === true; } catch {}
      shortcut.href = active ? '/spin-and-save' : '/gift-cards';
      label.textContent = active ? 'Spin & Save' : 'Gift Cards';
    }
    updateShortcut();
    window.addEventListener('pageshow', event => { if (event.persisted) updateShortcut(); });
    return;
  }
  const find = name => root.querySelector('[data-spin-' + name + ']');
  const state = find('state');
  const form = find('form');
  const result = find('result');
  const wheel = find('wheel');
  const signIn = find('sign-in');
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const tone = ['#161616', '#4b4b4b', '#7a7a7a', '#b9b9b9'];

  let token = '';
  let campaign;
  let sectors;
  let submitted = false;

  async function json(url, options) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Please try again.');
    return data;
  }

  function sessionChanged(session) {
    token = session?.access_token || '';
    signIn.hidden = !!token;
    form.hidden = !token || submitted;
  }

  function render() {
    const total = campaign.prizes.reduce((sum, prize) => sum + prize.remaining, 0);
    let cursor = 0;
    sectors = [];
    for (const prize of campaign.prizes) {
      const item = document.createElement('li');
      const amount = prize.credit_cents > 0 ? ' · ' + usd.format(prize.credit_cents / 100) + ' USD' : '';
      item.textContent = prize.label + amount + ' · ' + prize.remaining + ' of ' + total +
        ' remaining outcomes · ' + prize.quantity + ' initially available';
      find('odds').append(item);

      if (prize.remaining === 0) continue;
      const end = cursor + prize.remaining / total * 360;
      sectors.push({ key: prize.key, center: (cursor + end) / 2, fill: tone[sectors.length % tone.length] + ' ' + cursor + 'deg ' + end + 'deg' });
      cursor = end;
    }
    wheel.style.background = 'conic-gradient(' + sectors.map(sector => sector.fill).join(', ') + ')';
    find('title').textContent = campaign.name;
    find('eligibility').textContent = 'Open to eligible residents of ' + campaign.territory + ' aged ' + campaign.minimum_age + ' or older.';
    find('dates').textContent = date.format(new Date(campaign.starts_at)) + ' to ' + date.format(new Date(campaign.ends_at)) + ' UTC';
    find('rules').href = campaign.rules_path;
    find('question').textContent = campaign.skill_question;
    state.textContent = '';
    find('panel').hidden = false;
    sessionChanged(null);
  }

  function showOutcome(outcome) {
    const sector = sectors.find(candidate => candidate.key === outcome.prize_key);
    if (sector) wheel.style.transform = 'rotate(' + (1800 - sector.center) + 'deg)';
    submitted = true;
    form.querySelector('button').disabled = true;
    form.querySelector('button').textContent = 'Entry recorded';

    if (outcome.status === 'disqualified') {
      result.textContent = 'That answer was incorrect. Your entry has been recorded.';
    } else if (outcome.status === 'credit') {
      result.textContent = 'You earned ' + usd.format(outcome.credit_cents / 100) + ' USD in PURE store credit.';
      find('credit').hidden = false;
    } else {
      result.textContent = 'No prize this time. Your entry has been recorded.';
    }
  }

  async function start() {
    try {
      campaign = await json(endpoint);
      if (!campaign.active) {
        state.textContent = 'Spin & Save is currently closed.';
        return;
      }

      render();
      const config = await json('/api/customer-config');
      const { auth } = window.supabase.createClient(config.supabaseUrl, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' }
      });
      auth.onAuthStateChange((_event, session) => sessionChanged(session));
      const { data } = await auth.getSession();
      sessionChanged(data.session);
    } catch (error) {
      state.textContent = 'Spin & Save is temporarily unavailable.';
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!token || submitted || !form.reportValidity()) return;
    const button = form.querySelector('button');
    if (button.disabled) return;

    button.disabled = true;
    result.textContent = 'Recording your entry…';
    try {
      const outcome = await json(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          answer: form.elements.answer.valueAsNumber,
          eligible: form.elements.eligible.checked,
          terms_version: campaign.terms_version
        })
      });
      showOutcome(outcome);
    } catch (error) {
      result.textContent = error.message;
    } finally {
      button.disabled = submitted;
    }
  });

  start();
})();
