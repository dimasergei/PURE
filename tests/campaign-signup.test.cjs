'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { handle } = require('../lib/campaign-signup');
const { promotions } = require('../config/checkout.json');

const site = 'https://getpurelabs.com';
const email = 'researcher@example.test';
const env = {
  SITE_URL: site,
  ORDER_CONFIRMATION_FROM: 'PURE <support@getpurelabs.com>',
  RESEND_API_KEY: 'fake-key',
  CHECKOUT_RATE_LIMIT_SECRET: 'test-secret-only-for-the-campaign-mailer'
};

function fixture(options = {}) {
  const inserts = [];
  const sends = [];
  const dependencies = {
    env: { ...env, ...options.env },
    rateLimit: async () => {},
    db: {
      from(table) {
        assert.equal(table, 'commerce_campaign_signups');
        return {
          async insert(row) {
            inserts.push(row);
            return { error: options.storageError };
          }
        };
      }
    },
    async fetchImpl(url, request) {
      assert.equal(url, 'https://api.resend.com/emails');
      assert.equal(inserts.length, sends.length + 1);
      sends.push(request);
      return options.emailError
        ? new Response('{}', { status: 503 })
        : Response.json({ id: 'fake-mail-id' });
    }
  };
  async function signup(input = email, consent = true, source = 'pure-club') {
    const res = {
      status(code) { this.code = code; return this; },
      json(data) { return { status: this.code, data }; }
    };
    return handle({
      headers: { origin: site, 'content-type': 'application/json' },
      body: { email: input, consent, source }
    }, res, dependencies);
  }
  return { signup, inserts, sends };
}

test('an opted-in subscriber gets the configured code on-screen and in email', async () => {
  const { signup, inserts, sends } = fixture();
  assert.deepEqual(await signup(' RESEARCHER@example.test '), {
    status: 200, data: { code: promotions.coupon, email_sent: true }
  });
  await signup();
  assert.deepEqual(inserts, [{ email }, { email }]);
  const [sent, repeated] = sends;
  const message = JSON.parse(sent.body);
  assert.deepEqual(message.to, [email]);
  assert.equal(message.from, env.ORDER_CONFIRMATION_FROM);
  assert.match(message.subject, /PURE CLUB 10% off code/);
  assert.ok(message.text.includes(promotions.coupon));
  assert.ok(message.text.includes(site + '/shop'));
  const key = sent.headers['Idempotency-Key'];
  assert.match(key, /^pure-club\/[a-f0-9]{64}$/);
  assert.equal(repeated.headers['Idempotency-Key'], key);
});

test('consent and a successful signup write are required before sending', async () => {
  const withoutConsent = fixture();
  assert.equal((await withoutConsent.signup(email, false)).status, 400);
  assert.deepEqual(withoutConsent.inserts, []);
  assert.deepEqual(withoutConsent.sends, []);
  const storageFailure = fixture({ storageError: { code: 'P0001' } });
  assert.equal((await storageFailure.signup()).status, 503);
  assert.deepEqual(storageFailure.sends, []);
});

test('other signup sources keep the existing on-screen code without sending', async () => {
  const { signup, inserts, sends } = fixture();
  assert.deepEqual(await signup(email, true, null), {
    status: 200, data: { code: promotions.coupon }
  });
  assert.deepEqual(inserts, [{ email }]);
  assert.deepEqual(sends, []);
});

test('email failure preserves signup and the on-screen code', async () => {
  for (const options of [
    { emailError: true }, { env: { RESEND_API_KEY: '' } }, { env: { VERCEL_ENV: 'preview' } }
  ]) {
    const { signup, inserts, sends } = fixture(options);
    assert.deepEqual(await signup(), {
      status: 200, data: { code: promotions.coupon, email_sent: false }
    });
    assert.deepEqual(inserts, [{ email }]);
    assert.equal(sends.length, options.emailError ? 1 : 0);
  }
});
