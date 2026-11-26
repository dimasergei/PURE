(() => {
  'use strict';
  const endpoint = '/api/customer-config?mobile_funnel=event';
  const key = stage => 'pure-mobile-funnel-' + stage;
  const utcDay = () => new Date().toISOString().slice(0, 10);
  const optedOut = () => navigator.globalPrivacyControl === true ||
    navigator.doNotTrack === '1' || window.doNotTrack === '1';

  function mark(stage) {
    if (!['cart', 'checkout'].includes(stage) || location.origin !== 'https://getpurelabs.com' || optedOut()) return;
    try {
      const day = utcDay();
      const previous = sessionStorage.getItem(key(stage));
      if (previous === day || previous === 'pending:' + day) return;
      sessionStorage.setItem(key(stage), 'pending:' + day);
      void fetch(endpoint, {
        method: 'POST', credentials: 'omit', cache: 'no-store', keepalive: true,
        referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage })
      }).then(response => {
        if (!response.ok) throw Error('Measurement unavailable');
        // The same per-tab marker also suppresses repeated posts from browsers
        // that the endpoint excludes.
        if (sessionStorage.getItem(key(stage)) === 'pending:' + day) sessionStorage.setItem(key(stage), day);
      }).catch(() => {
        try {
          if (sessionStorage.getItem(key(stage)) === 'pending:' + day) sessionStorage.removeItem(key(stage));
        } catch {}
      });
    } catch {}
  }

  function cohort() {
    if (optedOut()) return;
    try {
      const start = sessionStorage.getItem(key('checkout'));
      if (start === utcDay()) return start;
    } catch {}
  }

  window.PureFunnel = { mark, cohort };
})();
