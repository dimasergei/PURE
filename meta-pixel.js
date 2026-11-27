(function () {
  'use strict';

  const pixelId = '967677362888639';
  const preferenceKey = 'pure-ad-measurement-v1';
  const landingPaths = new Set(['/', '/shop']);
  const route = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const optedOut = navigator.globalPrivacyControl === true ||
    navigator.doNotTrack === '1' || window.doNotTrack === '1';
  if (location.origin !== 'https://getpurelabs.com' || optedOut) return;

  function eligibleURL(url) {
    if (url.hash) return false;
    return Array.from(url.searchParams).every(([key, value]) =>
      key === 'fbclid' && /^[A-Za-z0-9_-]{1,300}$/.test(value));
  }

  function allowPageView() {
    if (!landingPaths.has(route) || !eligibleURL(new URL(location.href))) return false;
    if (!document.referrer) return true;
    const referrer = new URL(document.referrer);
    if (referrer.origin !== location.origin) return true;
    const from = referrer.pathname.replace(/\/$/, '') || '/';
    return (landingPaths.has(from) || from === '/privacy-policy') && eligibleURL(referrer);
  }

  function startPixel() {
    if (!allowPageView()) return;
    if (!window.fbq) {
      const pixel = function () {
        if (pixel.callMethod) pixel.callMethod.apply(pixel, arguments);
        else pixel.queue.push(arguments);
      };
      pixel.push = pixel;
      pixel.loaded = true;
      pixel.version = '2.0';
      pixel.disablePushState = true;
      pixel.queue = [];
      window.fbq = window._fbq = pixel;

      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://connect.facebook.net/en_US/fbevents.js';
      document.head.appendChild(script);
    }
    window.fbq('set', 'autoConfig', false, pixelId);
    window.fbq('init', pixelId);
    window.fbq('trackSingle', pixelId, 'PageView');
  }

  function savePreference(value) {
    try { localStorage.setItem(preferenceKey, value); } catch {}
    if (value === 'allow') startPixel();
  }

  function showPreferences() {
    if (document.getElementById('pure-ad-measurement')) return;
    const notice = document.createElement('aside');
    notice.id = 'pure-ad-measurement';
    notice.setAttribute('aria-label', 'Advertising measurement');
    notice.style.cssText = 'position:fixed;inset:auto 1rem 1rem auto;z-index:1000;width:min(24rem,calc(100% - 2rem));padding:1rem;background:#fff;color:#111;border:1px solid #aaa;border-radius:12px;box-shadow:0 4px 20px #0002';
    notice.innerHTML = '<p style="margin:0 0 .75rem">Allow Meta to measure homepage and shop visits for PURE ads? <a href="/privacy-policy#advertising-privacy">Privacy policy</a></p>' +
      '<button type="button" data-choice="allow">Allow</button> <button type="button" data-choice="decline">Decline</button>';
    notice.addEventListener('click', event => {
      const choice = event.target.dataset.choice;
      if (!choice) return;
      savePreference(choice);
      notice.remove();
    });
    document.body.appendChild(notice);
  }

  const preferences = document.getElementById('advertising-preferences');
  if (preferences) {
    preferences.hidden = false;
    preferences.addEventListener('click', showPreferences);
  }
  if (!allowPageView()) return;
  let saved;
  try { saved = localStorage.getItem(preferenceKey); } catch {}
  if (saved === 'allow') startPixel();
  else if (saved !== 'decline') showPreferences();
}());
