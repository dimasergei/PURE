'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadNativeEthRate, nativeEthWeiForUsdCents,
  NATIVE_ETH_RATE_MAX_AGE_MS, NATIVE_ETH_RATE_FUTURE_SKEW_MS
} = require('../lib/native-eth-rate');

const now = Date.parse('2026-11-26T19:00:00.000Z');
const coinbaseUrl = 'https://api.exchange.coinbase.com/products/ETH-USD/ticker';
const krakenUrl = 'https://api.kraken.com/0/public/Trades?pair=XETHZUSD&count=3';
const iso = time => new Date(time).toISOString();
const coinbase = (price = '2456.123456', time = iso(now - 1500)) => ({price, time, trade_id: 1001});
const trade = (price = '2456.357891', time = now - 2500) => [price, '0.01000000', time / 1000, 'b', 'm', '', 2001];
const kraken = (...trades) => ({error: [], result: {XETHZUSD: trades, last: '2001'}});
const json = body => new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
const unavailable = {status: 503, message: 'The ETH quote is temporarily unavailable. Please try again.'};

function provider(coinbaseData = coinbase(), krakenData = kraken(trade())) {
  const fetchImpl = async (url, options) => {
    fetchImpl.calls.push({url, options});
    assert.ok(url === coinbaseUrl || url === krakenUrl);
    const data = url === coinbaseUrl ? coinbaseData : krakenData;
    return typeof data === 'function' ? data() : json(data);
  };
  fetchImpl.calls = [];
  return fetchImpl;
}

test('reads the two independent ETH/USD exchanges and preserves the integer midpoint and source audit data', async () => {
  const fetchImpl = provider();
  const pending = loadNativeEthRate({fetchImpl, now});
  assert.deepEqual(fetchImpl.calls.map(call => call.url), [coinbaseUrl, krakenUrl]);
  for (const {options} of fetchImpl.calls) {
    assert.deepEqual({...options, signal: undefined}, {
      method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: {Accept: 'application/json'}, signal: undefined
    });
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.deepEqual(await pending, {
    microUsdPerEth: '2456240673', observedAt: iso(now - 2500), fetchedAt: iso(now),
    observations: [
      {source: 'coinbase-exchange', microUsdPerEth: '2456123456', observedAt: iso(now - 1500)},
      {source: 'kraken', microUsdPerEth: '2456357891', observedAt: iso(now - 2500)}
    ]
  });
});

test('takes the most recent Kraken trade and uses wire order for equal timestamps', async () => {
  const fetchImpl = provider(coinbase(), kraken(trade('2446.12'), trade('2475.32', now - 5000), trade('2456.12')));
  const rate = await loadNativeEthRate({fetchImpl, now});
  assert.deepEqual(rate.observations[1], {source: 'kraken', microUsdPerEth: '2456120000', observedAt: iso(now - 2500)});
  const submillisecond = provider(coinbase(), kraken(trade('2456.12', now - 499.1), trade('2453.12', now - 499.9)));
  const precise = await loadNativeEthRate({fetchImpl: submillisecond, now});
  assert.equal(precise.observations[1].microUsdPerEth, '2456120000');
});

test('checks the age of both trades after the provider requests complete', async () => {
  const atBoundary = provider(coinbase(undefined, iso(now - NATIVE_ETH_RATE_MAX_AGE_MS)), kraken(trade(undefined, now + NATIVE_ETH_RATE_FUTURE_SKEW_MS)));
  assert.equal((await loadNativeEthRate({fetchImpl: atBoundary, now})).observedAt, iso(now - NATIVE_ETH_RATE_MAX_AGE_MS));
  await assert.rejects(loadNativeEthRate({fetchImpl: atBoundary, now: () => now + 1}), unavailable);
  await assert.rejects(loadNativeEthRate({fetchImpl: atBoundary, now: now - 1}), unavailable);

  const staleKraken = provider(coinbase(), kraken(trade(undefined, now - NATIVE_ETH_RATE_MAX_AGE_MS - 1)));
  await assert.rejects(loadNativeEthRate({fetchImpl: staleKraken, now}), unavailable);
  const futureCoinbase = provider(coinbase(undefined, iso(now + NATIVE_ETH_RATE_FUTURE_SKEW_MS + 1)));
  await assert.rejects(loadNativeEthRate({fetchImpl: futureCoinbase, now}), unavailable);
});

test('declines a difference over 75 basis points relative to the lower rate', async () => {
  const onBoundary = provider(coinbase('2015'), kraken(trade('2000')));
  assert.equal((await loadNativeEthRate({fetchImpl: onBoundary, now})).microUsdPerEth, '2007500000');
  const outside = provider(coinbase('2000'), kraken(trade('2015.000001')));
  await assert.rejects(loadNativeEthRate({fetchImpl: outside, now}), unavailable);
});

test('fails closed on invalid prices, timestamps, pair identifiers, data or provider responses', async () => {
  for (const price of [null, 2456, '0', '-1', '0.999999', '1000000.000001', '2.456e3', '2456.1234567', ' 2456']) {
    await assert.rejects(loadNativeEthRate({fetchImpl: provider(coinbase(price)), now}), unavailable);
  }
  for (const time of [null, '2026-02-31T19:00:00Z', '2026-11-26T19:00:00+00:00', '2026-11-26T19:00:00.0000000000Z']) {
    await assert.rejects(loadNativeEthRate({fetchImpl: provider(coinbase(undefined, time)), now}), unavailable);
  }
  for (const data of [
    {error: [], result: {XETHZEUR: [trade()]}},
    {...kraken(trade()), error: ['EGeneral:Unavailable']},
    kraken(), kraken(trade(), trade('invalid', now)), kraken(['2456', '1', '1795719600']),
    () => {throw new Error('mocked provider outage');},
    () => new Response('', {status: 302}), () => new Response('', {status: 503}), () => new Response('not JSON'),
    () => new Response('x'.repeat(8193)), () => new Response('{}', {headers: {'content-length': '8193'}}),
    () => new Response('{}', {headers: {'content-length': 'invalid'}})
  ]) {
    await assert.rejects(loadNativeEthRate({fetchImpl: provider(coinbase(), data), now}), unavailable);
  }
});

test('uses integer ceiling to produce an exact wei amount for canonical USD cents', () => {
  assert.equal(nativeEthWeiForUsdCents(100, '2500000000'), '400000000000000');
  assert.equal(nativeEthWeiForUsdCents(1, '3000000000'), '3333333333334');
  assert.equal(nativeEthWeiForUsdCents(100n, 3_000_000_000n), '333333333333334');
  assert.equal(nativeEthWeiForUsdCents('2147483647', 1_000_000), '21474836470000000000000000');
  const cents = 18_533_381n;
  const rate = 2_448_043_737n;
  const numerator = cents * 10n ** 22n;
  const wei = BigInt(nativeEthWeiForUsdCents(cents, rate));
  assert.ok((wei - 1n) * rate < numerator);
  assert.ok(wei * rate >= numerator);
  for (const amount of [0, -1, '01', '1e2', '1.2', 1.5, 2_147_483_648]) {
    assert.throws(() => nativeEthWeiForUsdCents(amount, '2500000000'), RangeError);
  }
  for (const invalidRate of [null, '999999', '1000000000001', '1e9', ' 2500000000']) {
    assert.throws(() => nativeEthWeiForUsdCents(100, invalidRate), RangeError);
  }
});
