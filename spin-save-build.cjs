'use strict';

const fs = require('node:fs');
const path = require('node:path');

const out = 'public-build';
const shell = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const main = /<main id="ap-main"[^>]*>[\s\S]*?<\/main>/;
if (!main.test(shell)) throw new Error('Spin & Save storefront shell is unavailable.');

const content = `<main id="spin-save-main">
  <section class="ap-container ap-page-intro">
    <span class="ap-eyebrow">PURE</span>
    <h1>SPIN &amp; SAVE.</h1>
    <p data-spin-state role="status">Checking promotion availability…</p>
    <noscript><p>Enable JavaScript to check promotion availability.</p></noscript>
  </section>
  <section class="ap-container spin-save" data-spin-panel hidden>
    <div class="spin-save-wheel" aria-hidden="true">
      <div class="spin-save-pointer"></div>
      <div class="spin-save-disc" data-spin-wheel><strong>PURE</strong></div>
    </div>
    <div class="spin-save-details">
      <h2 data-spin-title></h2>
      <p data-spin-eligibility></p>
      <p data-spin-dates></p>
      <p>No purchase necessary. One entry and one answer attempt per verified account.</p>
      <a data-spin-rules>Read the official rules</a>
      <details class="spin-save-odds">
        <summary>Prizes and current odds</summary>
        <p>Odds change as outcomes are claimed. Counts below reflect when this page loaded. Entry is subject to the official rules.</p>
        <ul data-spin-odds></ul>
      </details>
      <p data-spin-sign-in hidden><a href="/account/login" target="_blank" rel="noopener">Sign in to enter (opens a new tab)</a></p>
      <form class="spin-save-form" data-spin-form hidden>
        <label><span data-spin-question></span><input name="answer" type="number" min="-1000000" max="1000000" step="1" required inputmode="numeric" autocomplete="off"></label>
        <label class="spin-save-confirm"><input name="eligible" type="checkbox" required><span>I meet the eligibility requirements and accept the official rules.</span></label>
        <button type="submit" class="ap-button">Spin the wheel</button>
      </form>
      <p data-spin-result role="status"></p>
      <a data-spin-credit href="/account#rewards-and-credit" hidden>View your store credit</a>
    </div>
  </section>
</main>`;
const page = shell
  .replace(/<title>[\s\S]*?<\/title>/, '<title>Spin &amp; Save | PURE</title>')
  .replace(/<meta name="description"[^>]*>/, '<meta name="description" content="Check availability for PURE Spin &amp; Save.">')
  .replace(/<link rel="canonical"[^>]*>/, '')
  .replace(/<meta property="og:(?:title|description|url)"[^>]*>/g, '')
  .replace('</head>', '<meta name="robots" content="noindex"><link rel="canonical" href="https://getpurelabs.com/spin-and-save"><link rel="stylesheet" href="/spin-save.css?v=1"></head>')
  .replace('href="#ap-main"', 'href="#spin-save-main"')
  .replace(main, content)
  .replace('</body>', '<script src="/spin-save.js?v=1"></script></body>');

fs.writeFileSync(path.join(out, 'spin-and-save.html'), page);
for (const file of ['spin-save.js', 'spin-save.css']) fs.copyFileSync(file, path.join(out, file));
