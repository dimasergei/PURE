'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

test('mobile delivery radios stay outside the full-width address input styles', t => {
  const sheet = readFileSync('checkout-reference.css', 'utf8');
  const dom = new JSDOM(`<style>${sheet}</style>
    <div class="nlx-checkout-root">
      <form class="nlx-step-shipping">
        <input name="street">
        <section data-nlx-inline-delivery>
          <label class="nlx-delivery-card">
            <input type="radio" name="delivery_speed" checked>
            <span class="nlx-delivery-desc">Next business day after dispatch</span>
            <span class="nlx-delivery-price">CA$64.95</span>
          </label>
        </section>
      </form>
    </div>`);
  t.after(() => dom.window.close());

  const doc = dom.window.document;
  const radio = doc.querySelector('[type=radio]');
  const card = radio.closest('.nlx-delivery-card');
  const rules = [...doc.styleSheets[0].cssRules];
  const addressRule = rules.find(rule => rule.selectorText?.startsWith('.nlx-step-shipping input') &&
    rule.style.getPropertyValue('width') === '100%');

  assert.ok(doc.querySelector('[name=street]').matches(addressRule.selectorText));
  assert.equal(radio.matches(addressRule.selectorText), false);
  assert.equal(dom.window.getComputedStyle(radio).width, '19px');
  assert.equal(dom.window.getComputedStyle(radio).height, '19px');

  const mobileCardRule = rules.filter(rule => rule.conditionText === '(max-width:770px)')
    .flatMap(rule => [...rule.cssRules])
    .find(rule => rule.selectorText === '[data-nlx-inline-delivery] .nlx-delivery-card');

  assert.ok(card.matches(mobileCardRule.selectorText));
  assert.equal(mobileCardRule.style.getPropertyValue('grid-template-columns'), '19px minmax(0,1fr) max-content');
  assert.equal(mobileCardRule.style.getPropertyValue('gap'), '14px');
});
